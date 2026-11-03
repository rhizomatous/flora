#!/usr/bin/env python3
"""Opinionated single-host Ubuntu installation. Run a reviewed copy as root."""
import argparse
import fcntl
import grp
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import platform
import pwd
import re
import secrets
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import time

from release_download import stage, VERSION

STATE = Path("/var/lib/flora-installer")
NETWORK_NAME = "flora-owned"
ALIAS = "flora-github.internal"


def run(*args, **kwargs):
    kwargs.setdefault("timeout", 600)
    result = subprocess.run(args, text=True, capture_output=True, **kwargs)
    if result.returncode:
        # Do not repeat arbitrary subprocess output: it can contain credentials.
        raise RuntimeError(f"{args[0]} failed (exit {result.returncode}); inspect the service or dependency directly")
    return result.stdout.strip()


def docker(*args):
    return run("docker", "--host", "unix:///var/run/docker.sock", *args)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def ask(message):
    with open("/dev/tty", "r+") as tty:
        tty.write(message)
        tty.flush()
        return tty.readline().strip()


def private_directory(path, uid=0, gid=0, mode=0o700):
    if path.exists() or path.is_symlink():
        info = path.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != uid or info.st_gid != gid or stat.S_IMODE(info.st_mode) != mode:
            raise ValueError(f"unexpected ownership/type/mode at {path}; restore the recorded installation permissions")
    else:
        path.mkdir(mode=mode)
        os.chown(path, uid, gid)
        path.chmod(mode)


def atomic(path, data, mode=0o600, uid=0, gid=0):
    fd, name = tempfile.mkstemp(prefix=".flora-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as out:
            out.write(data)
            out.flush()
            os.fchmod(out.fileno(), mode)
            os.fchown(out.fileno(), uid, gid)
            os.fsync(out.fileno())
        os.replace(name, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def platform_check():
    if os.geteuid() != 0 or platform.system() != "Linux":
        raise ValueError("run as root on Ubuntu 24.04, not on a macOS or other host")
    release = platform.freedesktop_os_release()
    if release.get("ID") != "ubuntu" or release.get("VERSION_ID") != "24.04":
        raise ValueError("only Ubuntu 24.04 LTS is supported")
    arch = {"x86_64": "amd64", "aarch64": "arm64"}.get(platform.machine())
    if not arch or not Path("/run/systemd/system").is_dir():
        raise ValueError("Ubuntu amd64/arm64 with running systemd is required")
    # All fixed parents are root-controlled. Never follow a substituted directory.
    for path in ("/opt", "/etc", "/etc/systemd", "/etc/systemd/system", "/var", "/var/lib", "/run"):
        info = Path(path).lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise ValueError(f"unsafe installation parent: {path}")
    return arch


def hostname(value):
    value = value.lower()
    if len(value) > 253 or "." not in value or any(not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", part) for part in value.split(".")):
        raise ValueError("supply a DNS hostname without a scheme, port, wildcard or path")
    if value.endswith((".localhost", ".local", ".internal", ".test")):
        raise ValueError("this installer requires a public domain and ACME; private browser trust is manual")
    return value


def choose_subnet(routes, networks):
    occupied = []
    for route in routes:
        dst = route.get("dst", "default")
        if dst != "default":
            occupied.append(ipaddress.ip_network(dst, strict=False))
    for network in networks:
        for config in network.get("IPAM", {}).get("Config") or []:
            if config.get("Subnet"):
                occupied.append(ipaddress.ip_network(config["Subnet"], strict=False))
    for third in range(64, 224):
        candidate = ipaddress.ip_network(f"172.30.{third}.0/24")
        if not any(other.version == 4 and candidate.overlaps(other) for other in occupied):
            return str(candidate), str(candidate.network_address + 1)
    raise ValueError("no free subnet among 172.30.64.0/24 through 172.30.223.0/24; resolve route/VPN overlap manually")


def addresses(selected, domain):
    interfaces = json.loads(run("ip", "-j", "-details", "address", "show"))
    # A veth or bridge address is assigned too, but is not a browser NIC. Use
    # link metadata as well as Docker's usual names, including custom bridges.
    nics = {interface["ifname"]: interface for interface in interfaces
            if interface.get("link_type") != "loopback"
            and interface.get("linkinfo", {}).get("info_kind") not in ("bridge", "veth")
            and not interface["ifname"].startswith(("docker", "br-", "veth"))}
    assigned = {entry["local"] for interface in nics.values() for entry in interface["addr_info"]
                if entry.get("scope") == "global" and not ipaddress.ip_address(entry["local"]).is_loopback
                and not {"tentative", "dadfailed", "deprecated"}.intersection(entry.get("flags", []))}
    if not selected:
        routes = json.loads(run("ip", "-j", "route", "show", "default"))
        candidates = set()
        for route in routes:
            if route.get("dev") not in nics or route.get("type", "unicast") != "unicast":
                continue
            resolved = json.loads(run("ip", "-j", "route", "get", "1.1.1.1", "oif", route["dev"]))
            for actual in resolved:
                sources = {entry["local"] for entry in nics[route["dev"]]["addr_info"]}
                if actual.get("dev") == route["dev"] and actual.get("prefsrc") in assigned & sources:
                    candidates.add(actual["prefsrc"])
        if len(candidates) != 1:
            raise ValueError("ambiguous external interface; pass --bind-address for each local NIC address serving browser traffic (not an unassigned NAT public IP)")
        selected = sorted(candidates)
    selected = [str(ipaddress.ip_address(value)) for value in selected]
    if not selected or len(set(selected)) != len(selected) or not set(selected) <= assigned:
        raise ValueError("browser bindings must be distinct, assigned local NIC addresses")
    dns = {entry[4][0] for entry in socket.getaddrinfo(domain, 443, type=socket.SOCK_STREAM)}
    if not dns or any(ipaddress.ip_address(value).is_loopback for value in dns):
        raise ValueError("hostname must resolve to this host's working public/NAT ingress")
    if any(ipaddress.ip_address(value).version == 6 for value in dns) and not any(ipaddress.ip_address(value).version == 6 for value in selected):
        raise ValueError("hostname has AAAA records but no selected IPv6 path; fix DNS/routing or select the working local IPv6 address")
    return selected


def caddy_config(domain, bindings):
    bind = " ".join(bindings)
    return f"""{{
    admin off
    auto_https disable_redirects
}}
http://{domain} {{
    bind {bind}
    redir https://{domain}{{uri}} 308
}}
https://{domain} {{
    bind {bind}
    tls {{
        issuer acme {{
            disable_tlsalpn_challenge
        }}
    }}
    reverse_proxy 127.0.0.1:8080 {{
        flush_interval -1
    }}
}}
"""


class Installation:
    def __init__(self, lock=True, existing=False):
        if (existing or not lock) and not (STATE / "state.json").is_file():
            raise ValueError("no recorded installer state; install or restore the same-release state first")
        private_directory(STATE)
        if lock:
            fd = os.open(STATE / "lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
            self.lock = os.fdopen(fd, "w")
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        manifest = STATE / "state.json"
        if manifest.exists() or manifest.is_symlink():
            info = manifest.lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o600:
                raise ValueError("unsafe installer manifest")
            self.state = json.loads(manifest.read_text())
        else:
            self.state = {"schema": 1, "owner": secrets.token_hex(16), "files": {}}
        if self.state.get("schema") != 1:
            raise ValueError("unsupported installer state version")
        if lock and self.state.get("pending"):
            pending = self.state["pending"]
            path = Path(pending["path"])
            if path.is_symlink() or (path.exists() and digest(path.read_bytes()) not in (pending["old"]["sha256"], pending["new"]["sha256"])):
                raise ValueError("pending private file replacement has foreign content")
            data = (STATE / "pending-file").read_bytes()
            if digest(data) != pending["new"]["sha256"]:
                raise ValueError("pending private file replacement is damaged")
            atomic(path, data, pending["new"]["mode"], pending["new"]["uid"], pending["new"]["gid"])
            self.state["files"][str(path)] = pending["new"]
            del self.state["pending"]
            self.save()
            (STATE / "pending-file").unlink()

    def save(self):
        atomic(STATE / "state.json", json.dumps(self.state, sort_keys=True).encode())

    def file(self, path, data, mode=0o644, uid=0, gid=0):
        path = Path(path)
        receipt = {"sha256": digest(data), "mode": mode, "uid": uid, "gid": gid}
        previous = self.state["files"].get(str(path))
        if previous and previous != receipt:
            raise ValueError(f"refusing implicit configuration change at {path}")
        if path.exists() or path.is_symlink():
            info = path.lstat()
            if not previous or not stat.S_ISREG(info.st_mode) or digest(path.read_bytes()) != previous["sha256"] or stat.S_IMODE(info.st_mode) != mode or info.st_uid != uid or info.st_gid != gid:
                raise ValueError(f"foreign or changed installed file: {path}")
            return
        # Persist the intended content before placement so interruption can resume.
        self.state["files"][str(path)] = receipt
        self.save()
        atomic(path, data, mode, uid, gid)

    def verify_files(self):
        for name, receipt in self.state["files"].items():
            path = Path(name)
            if not path.exists() and not path.is_symlink():
                continue  # A receipt can precede atomic placement after interruption.
            info = path.lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_uid != receipt["uid"] or info.st_gid != receipt["gid"] or stat.S_IMODE(info.st_mode) != receipt["mode"] or digest(path.read_bytes()) != receipt["sha256"]:
                raise ValueError(f"installed file drift: {path}; restore the original before rerunning")

    def replace_file(self, path, data):
        self.verify_files()
        previous = self.state["files"][path]
        receipt = {**previous, "sha256": digest(data)}
        atomic(STATE / "pending-file", data)
        self.state["pending"] = {"path": path, "old": previous, "new": receipt}
        self.save()
        atomic(Path(path), data, receipt["mode"], receipt["uid"], receipt["gid"])
        self.state["files"][path] = receipt
        del self.state["pending"]
        self.save()
        (STATE / "pending-file").unlink()

    def network(self):
        intended = self.state.get("network")
        if intended and intended.get("id"):
            self.check_network()
            return
        ids = docker("network", "ls", "--quiet").splitlines()
        networks = json.loads(docker("network", "inspect", *ids)) if ids else []
        same = next((item for item in networks if item["Name"] == NETWORK_NAME), None)
        if same and (not intended or same.get("Labels", {}).get("flora.installer") != self.state["owner"]):
            raise ValueError("foreign flora-owned network exists; never adopting or deleting it")
        if not intended:
            routes = json.loads(run("ip", "-j", "-4", "route", "show", "table", "all"))
            subnet, gateway = choose_subnet(routes, networks)
            intended = self.state["network"] = {"subnet": subnet, "gateway": gateway}
            self.save()
        if not same:
            network_id = docker("network", "create", "--driver", "bridge", "--label", f"flora.installer={self.state['owner']}",
                                "--subnet", intended["subnet"], "--gateway", intended["gateway"], NETWORK_NAME)
            same = json.loads(docker("network", "inspect", network_id))[0]
        intended["id"] = same["Id"]
        intended["bridge"] = same.get("Options", {}).get("com.docker.network.bridge.name", "br-" + same["Id"][:12])
        self.save()
        self.check_network()

    def check_network(self):
        network = self.state["network"]
        actual = json.loads(docker("network", "inspect", network["id"]))[0]
        configs = actual.get("IPAM", {}).get("Config", [])
        bridge = actual.get("Options", {}).get("com.docker.network.bridge.name", "br-" + actual["Id"][:12])
        if actual["Id"] != network["id"] or actual["Name"] != NETWORK_NAME or actual.get("Labels", {}).get("flora.installer") != self.state["owner"] or actual["Driver"] != "bridge" or actual["Internal"] or len(configs) != 1 or configs[0]["Subnet"] != network["subnet"] or configs[0]["Gateway"] != network["gateway"] or bridge != network["bridge"]:
            raise ValueError("owned network identity/configuration drift; restore it, do not recreate it under retained chats")
        interface = json.loads(run("ip", "-j", "address", "show", "dev", bridge))
        if not any(entry["local"] == network["gateway"] for item in interface for entry in item["addr_info"]):
            raise ValueError("owned bridge gateway is missing from its recorded interface")

    def firewall(self):
        network = self.state["network"]
        chain = "FLORA_" + self.state["owner"][:12]
        scope = ["-d", network["gateway"] + "/32", "-p", "tcp", "-m", "tcp", "--dport", "443"]
        rules = [[*scope[:2], "-i", interface, *scope[2:], "-j", "ACCEPT"] for interface in ("lo", network["bridge"])]
        rules.append([*scope, "-j", "REJECT", "--reject-with", "icmp-port-unreachable"])
        result = subprocess.run(["iptables", "-w", "-S", chain], capture_output=True, text=True)
        expected = ["-N " + chain] + ["-A " + chain + " " + " ".join(rule) for rule in rules]
        if result.returncode == 0:
            actual = result.stdout.strip().splitlines()
            if actual != expected[:len(actual)] or len(actual) > len(expected):
                raise ValueError("installer firewall chain differs from its scoped loopback/bridge rules")
            for rule in rules[max(0, len(actual) - 1):]:
                run("iptables", "-w", "-A", chain, *rule)
        else:
            run("iptables", "-w", "-N", chain)
            for rule in rules:
                run("iptables", "-w", "-A", chain, *rule)
        jump = ["-d", network["gateway"], "-p", "tcp", "--dport", "443", "-j", chain]
        if subprocess.run(["iptables", "-w", "-C", "INPUT", *jump], capture_output=True).returncode:
            run("iptables", "-w", "-I", "INPUT", "1", *jump)


def account(name, home):
    run("useradd", "--system", "--user-group", "--home-dir", home, "--shell", "/usr/sbin/nologin", name)
    return pwd.getpwnam(name)


def dependencies(consent):
    packages = {"docker": "docker.io", "caddy": "caddy", "openssl": "openssl", "ip": "iproute2", "iptables": "iptables", "curl": "curl", "ss": "iproute2", "findmnt": "util-linux"}
    missing = sorted({package for command, package in packages.items() if not shutil.which(command)})
    if missing:
        if not consent:
            raise ValueError("missing dependencies: " + ", ".join(missing) + "; install them yourself or pass --install-dependencies to consent to authenticated Ubuntu apt installation")
        if "docker.io" in missing and (Path("/var/run/docker.sock").exists() or shutil.which("dockerd")):
            raise ValueError("existing Engine socket without administrative CLI; install a compatible CLI manually")
        new_caddy = "caddy" in missing
        if new_caddy and run("systemctl", "show", "caddy.service", "--property=LoadState", "--value") != "not-found":
            raise ValueError("existing Caddy unit without its executable; restore that installation manually")
        run("apt-get", "update")
        run("apt-get", "install", "-y", "--no-install-recommends", *missing, env={**os.environ, "DEBIAN_FRONTEND": "noninteractive"})
        if new_caddy:
            # Only the package first installed by this invocation is disabled.
            # Existing proxies are never stopped or reconfigured.
            run("systemctl", "disable", "--now", "caddy.service")
    server = json.loads(docker("version", "--format", "{{json .Server}}"))
    version = tuple(int(part) for part in server["ApiVersion"].split("."))
    minimum = tuple(int(part) for part in server.get("MinAPIVersion", "1.44").split("."))
    if version < (1, 44) or minimum > (1, 44) or server.get("Os") != "linux":
        raise ValueError("Docker 25+ / API 1.44+ required; refusing to replace/restart an existing Engine")
    info = json.loads(docker("info", "--format", "{{json .}}"))
    if any("rootless" in option or "userns" in option for option in info.get("SecurityOptions") or []):
        raise ValueError("rootless Docker and user namespace remapping are unsupported")
    sock = Path("/var/run/docker.sock").stat()
    if not stat.S_ISSOCK(sock.st_mode) or sock.st_uid != 0 or sock.st_mode & 0o007:
        raise ValueError("Docker socket must be root-owned and not accessible to other users")
    if sock.st_gid != grp.getgrnam("docker").gr_gid or sock.st_mode & 0o060 != 0o060:
        raise ValueError("Docker socket must grant read/write access to the docker group used by Flora")


def unit(description, user, command, after="network-online.target", extra=""):
    return f"""[Unit]
Description={description}
Wants=network-online.target
After={after}
{extra}
[Service]
User={user}
ExecStart={command}
Restart=on-failure
UMask=0077
NoNewPrivileges=true
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
AmbientCapabilities=CAP_NET_BIND_SERVICE
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/lib/{user}

[Install]
WantedBy=multi-user.target
"""


def install(args, arch, installation):
    if not args.experimental:
        raise ValueError("Ubuntu host orchestration is not acceptance-tested; --experimental is required for disposable evaluation only")
    state = installation.state
    domain = hostname(args.hostname or state.get("hostname") or ask("Public DNS hostname: "))
    if not VERSION.fullmatch(args.version):
        raise ValueError("select an explicit published version")
    if state.get("version") and (state["version"] != args.version or state["hostname"] != domain):
        raise ValueError("refusing an implicit upgrade or hostname change")
    installation.verify_files()
    resource_preflight()
    # No application changes before package integrity/identity verification.
    with tempfile.TemporaryDirectory(prefix="download-", dir=STATE) as temporary:
        package, identity = stage(Path(temporary), args.version, arch, args.allow_prerelease)
        dependencies(args.install_dependencies)
        bindings = addresses(args.bind_address or state.get("bindings"), domain)
        if state.get("bindings") and state["bindings"] != bindings:
            raise ValueError("refusing an implicit browser interface change")
        if not state.get("version"):
            for name in ("flora", "flora-proxy"):
                try:
                    pwd.getpwnam(name)
                except KeyError:
                    pass
                else:
                    raise ValueError(f"existing unmanaged {name} account; use the manual installation path")
            for path in ("/opt/flora", "/etc/flora", "/etc/flora-proxy", "/var/lib/flora", "/var/lib/flora-proxy",
                         "/etc/systemd/system/flora.service", "/etc/systemd/system/flora-proxy.service"):
                if Path(path).exists() or Path(path).is_symlink():
                    raise ValueError(f"existing unmanaged path: {path}")
            for name in ("flora.service", "flora-proxy.service", "flora-network.service", "flora-renew.service", "flora-renew.timer"):
                if run("systemctl", "show", name, "--property=LoadState", "--value") != "not-found":
                    raise ValueError(f"existing unmanaged systemd unit: {name}")
            # A wildcard proxy is a conflict, even though the private bridge does not yet exist.
            listeners = run("ss", "-H", "-ltn")
            if any(line.split()[3].rsplit(":", 1)[-1] in ("80", "443", "8080") for line in listeners.splitlines()):
                raise ValueError("existing 80/443/8080 listener; configure a dedicated host/address manually, never stop unrelated services")
            print("This installs root-owned services, an owned NAT bridge, scoped broker firewall rules and an online root-only CA signer.")
            print("Public DNS and inbound 80/443 must already reach the selected local NIC, including through NAT. No DNS/cloud firewall changes are made.")
            print("Defaults allow ten chats, each with 2 CPUs, 8 GiB and 512 PIDs. Process health does not establish capacity or paid inference readiness.")
            if not args.yes and ask("Apply these host changes? [yes/no] ") != "yes":
                raise ValueError("installation cancelled")
            # Ensure the enrollment code can be shown privately before changing state.
            with open("/dev/tty", "w"):
                pass
            state.update(version=args.version, hostname=domain, bindings=bindings, identity=identity)
            installation.save()
        elif state["identity"] != identity:
            raise ValueError("release identity changed; refusing same-version replacement")
        for name in ("flora", "flora-proxy"):
            recorded = state.get(name)
            if recorded:
                user = pwd.getpwnam(name)
                if [user.pw_uid, user.pw_gid] != recorded:
                    raise ValueError(f"numeric identity changed for {name}")
            else:
                # Record intended account name first; a crash after useradd requires manual
                # inspection instead of silently claiming an existing privileged account.
                try:
                    pwd.getpwnam(name)
                except KeyError:
                    user = account(name, "/var/lib/" + name)
                else:
                    raise ValueError(f"interrupted account creation for {name}; inspect ownership before recovery")
                state[name] = [user.pw_uid, user.pw_gid]
                installation.save()
        uid, gid = state["flora"]
        proxy_uid, proxy_gid = state["flora-proxy"]
        private_directory(Path("/opt/flora"), mode=0o755)
        private_directory(Path("/etc/flora"), gid=gid, mode=0o750)
        private_directory(Path("/var/lib/flora"), uid, gid)
        private_directory(Path("/var/lib/flora-proxy"), proxy_uid, proxy_gid)
        private_directory(Path("/etc/flora-proxy"), gid=proxy_gid, mode=0o750)
        installation.file("/opt/flora/flora", (package / "flora").read_bytes(), 0o755)
        installation.file("/opt/flora/release.json", (package / "release.json").read_bytes())
        for name in ("ubuntu.py", "release_download.py"):
            installation.file("/opt/flora/" + name, (package / name).read_bytes(), 0o755 if name == "ubuntu.py" else 0o644)
        installation.network()
        installation.firewall()
        pki(installation, gid)
        enrollment(installation, gid)
        network = state["network"]
        command = (f"/opt/flora/flora -data-dir /var/lib/flora -public-url https://{domain} "
                   f"-github-listen {network['gateway']}:443 -github-host {ALIAS} "
                   "-github-tls-cert /etc/flora/transport.pem -github-tls-key /etc/flora/transport.pem "
                   "-github-ca /etc/flora/transport-ca.crt -enrollment-hash-file /etc/flora/enrollment.sha256 "
                   f"-agent-network-id {network['id']} -agent-broker-gateway {network['gateway']}")
        installation.file("/etc/systemd/system/flora-network.service", b"""[Unit]
Description=Check Flora owned network and scoped broker firewall
Requires=docker.service
After=docker.service
Before=flora.service
[Service]
Type=oneshot
ExecStart=/usr/bin/python3 /opt/flora/ubuntu.py check-network
RemainAfterExit=yes
[Install]
WantedBy=multi-user.target
""")
        app_unit = unit("Flora", "flora", command, "network-online.target docker.service flora-network.service",
                        "Requires=docker.service flora-network.service")
        app_unit = app_unit.replace("[Service]\n", "[Service]\nSupplementaryGroups=docker\n")
        app_unit = app_unit.replace("[Service]\n", "[Service]\nExecStartPre=+/usr/bin/python3 /opt/flora/ubuntu.py verify-network\n")
        installation.file("/etc/systemd/system/flora.service", app_unit.encode())
        config = caddy_config(domain, bindings).encode()
        installation.file("/etc/flora-proxy/Caddyfile", config, 0o640, gid=proxy_gid)
        run("caddy", "validate", "--config", "/etc/flora-proxy/Caddyfile", "--adapter", "caddyfile")
        proxy_unit = unit("Flora browser HTTPS", "flora-proxy", "/usr/bin/caddy run --config /etc/flora-proxy/Caddyfile --adapter caddyfile")
        proxy_unit = proxy_unit.replace("[Service]\n", "[Service]\nEnvironment=HOME=/var/lib/flora-proxy\n")
        installation.file("/etc/systemd/system/flora-proxy.service", proxy_unit.encode())
        installation.file("/etc/systemd/system/flora-renew.service", b"""[Unit]
Description=Renew Flora private broker certificate
[Service]
Type=oneshot
ExecStart=/usr/bin/python3 /opt/flora/ubuntu.py renew
""")
        installation.file("/etc/systemd/system/flora-renew.timer", b"""[Unit]
Description=Check Flora private broker certificate daily
[Timer]
OnCalendar=daily
Persistent=true
RandomizedDelaySec=1h
[Install]
WantedBy=timers.target
""")
        run("systemctl", "daemon-reload")
        run("systemctl", "enable", "--now", "flora-network.service", "flora.service", "flora-proxy.service", "flora-renew.timer")
        probe(installation)
        print(f"Open https://{domain}. Complete administrator, GitHub and hosted-provider setup in the browser.")
        print("Verified private TLS route and runtime image only. Real checkout and paid model inference require your explicit browser actions.")
        print("Recovery: systemctl status flora flora-proxy; journalctl -u flora -u flora-proxy; rerun this same explicit version.")
        print("Private signing key is retained root-only for automated renewal. This is an online-key tradeoff, not encrypted-at-rest credential storage.")


def resource_preflight():
    if shutil.disk_usage("/var/lib").free < 10 * 1024**3:
        raise ValueError("at least 10 GiB free local disk is required before installation; chats need additional space")
    if run("findmnt", "-n", "-o", "FSTYPE", "-T", "/var/lib") not in ("ext4", "xfs", "btrfs", "zfs"):
        raise ValueError("persistent local ext4, xfs, btrfs or zfs storage is required; remote/overlay filesystems are unsupported")
    if os.sysconf("SC_PHYS_PAGES") * os.sysconf("SC_PAGE_SIZE") < 2 * 1024**3:
        raise ValueError("at least 2 GiB host memory is required; each default chat allows 8 GiB and needs separate capacity planning")


def pki(installation, gid, renew=False, directory=Path("/etc/flora")):
    state = installation.state
    private_directory(STATE / "pki")
    ca_key, ca_cert = STATE / "pki/ca.key", STATE / "pki/ca.crt"
    if not state.get("ca"):
        if ca_key.exists() or ca_cert.exists():
            raise ValueError("interrupted CA generation; preserve and inspect it, never rotate trust automatically")
        run("openssl", "req", "-x509", "-newkey", "rsa:3072", "-nodes", "-days", "3650", "-subj", "/CN=Flora broker CA",
            "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign", "-keyout", str(ca_key), "-out", str(ca_cert))
        ca_key.chmod(0o600)
        ca_cert.chmod(0o600)
        state["ca"] = {"key": digest(ca_key.read_bytes()), "cert": digest(ca_cert.read_bytes())}
        installation.save()
    for path in (ca_key, ca_cert):
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o600:
            raise ValueError("private CA files must be root-owned regular files with mode 0600")
    if subprocess.run(["openssl", "x509", "-in", str(ca_cert), "-checkend", "7776000", "-noout"], capture_output=True).returncode:
        raise ValueError("private CA expires within 90 days; plan an explicit trust migration for retained chats, never rotate it on rerun")
    if digest(ca_key.read_bytes()) != state["ca"]["key"] or digest(ca_cert.read_bytes()) != state["ca"]["cert"]:
        raise ValueError("private CA identity changed; restore original trust")
    installation.file(str(directory / "transport-ca.crt"), ca_cert.read_bytes(), 0o640, gid=gid)
    cert = directory / "transport.pem"
    if cert.exists():
        if subprocess.run(["openssl", "x509", "-in", str(cert), "-checkend", "2592000", "-noout"], capture_output=True).returncode == 0:
            return
        if not renew:
            raise ValueError("broker certificate expires within 30 days; run ubuntu.py renew and inspect flora-renew.service")
    with tempfile.TemporaryDirectory(dir=STATE / "pki") as tmp:
        root = Path(tmp)
        run("openssl", "req", "-newkey", "rsa:3072", "-nodes", "-subj", f"/CN={ALIAS}", "-keyout", str(root / "key"), "-out", str(root / "csr"))
        (root / "extensions").write_text(f"subjectAltName=DNS:{ALIAS}\nextendedKeyUsage=serverAuth\n")
        run("openssl", "x509", "-req", "-in", str(root / "csr"), "-CA", str(ca_cert), "-CAkey", str(ca_key),
            "-set_serial", "0x" + secrets.token_hex(16), "-days", "90", "-extfile", str(root / "extensions"), "-out", str(root / "crt"))
        # One atomically replaced PEM prevents a mismatched certificate/key pair
        # across power loss. Flora accepts this same file for both TLS options.
        pem = (root / "crt").read_bytes() + (root / "key").read_bytes()
        if renew:
            installation.replace_file(str(cert), pem)
            run("systemctl", "try-restart", "flora.service")
        else:
            installation.file(str(cert), pem, 0o640, gid=gid)


def enrollment(installation, gid, reset=False):
    path = "/etc/flora/enrollment.sha256"
    if path in installation.state["files"] and not reset:
        if not Path(path).exists():
            raise ValueError("enrollment digest placement was interrupted; recover the private digest before exposing HTTPS")
        return
    code = secrets.token_urlsafe(32)
    with open("/dev/tty", "w") as tty:
        if path in installation.state["files"]:
            installation.replace_file(path, digest(code.encode()).encode())
        else:
            installation.file(path, digest(code.encode()).encode(), 0o640, gid=gid)
        tty.write("\nFlora one-time administrator enrollment code (not a URL):\n" + code + "\nStore it privately until browser enrollment completes. It is not recoverable from the saved hash.\n")
        tty.flush()


def probe(installation):
    state = installation.state
    image = state["identity"]["agent_image"]
    with tempfile.TemporaryDirectory(prefix="anonymous-pull-", dir=STATE) as configuration:
        run("docker", "--config", configuration, "--host", "unix:///var/run/docker.sock", "pull", image)
    actual = json.loads(docker("image", "inspect", image))[0]
    if image not in actual.get("RepoDigests", []):
        raise ValueError("pulled image does not report the recorded digest")
    state["image_id"] = actual["Id"]
    installation.save()
    gateway = state["network"]["gateway"]
    name = probe_name(installation)
    cleanup_probe(installation)
    # No host keys, database, upstream credentials or Engine socket enter this
    # temporary runtime. Its endpoint password exists only in a private env file.
    environment = STATE / "probe.env"
    uid, gid = state["flora"]
    atomic(environment, f"OPENCODE_SERVER_PASSWORD={secrets.token_urlsafe(32)}\nFLORA_UID={uid}\nFLORA_GID={gid}\n".encode())
    try:
        container_id = docker("create", "--name", name, "--label", f"flora.installer={state['owner']}", "--network", state["network"]["id"],
                              "--add-host", f"{ALIAS}:{gateway}", "--env-file", str(environment),
                              "--mount", "type=bind,src=/etc/flora/transport-ca.crt,dst=/tmp/ca.crt,readonly", image)
        state["probe_id"] = container_id
        installation.save()
        docker("start", container_id)
        status = docker("exec", container_id, "curl", "--silent", "--show-error", "--cacert", "/tmp/ca.crt", "--output", "/dev/null", "--write-out", "%{http_code}", f"https://{ALIAS}/")
        if status != "401":
            raise ValueError("container-to-broker CA/SAN/host mapping check failed")
        docker("exec", container_id, "curl", "--fail", "--silent", "--max-time", "30", "--output", "/dev/null", "https://github.com")
        for attempt in range(60):
            try:
                health = json.loads(docker("exec", container_id, "sh", "-c",
                                          'printf \'user = "opencode:%s"\\n\' "$OPENCODE_SERVER_PASSWORD" | curl --config - --fail --silent http://127.0.0.1:4096/global/health'))
                if not health.get("healthy") or health.get("version") != state["identity"]["harness_version"]:
                    raise ValueError("agent runtime health/version mismatch")
                break
            except RuntimeError:
                if attempt == 59:
                    raise ValueError("agent runtime did not become healthy within 60 seconds")
                time.sleep(1)
    finally:
        cleanup_probe(installation)
        environment.unlink(missing_ok=True)
    # Verify the local proxy, without requiring NAT hairpin routing or accepting
    # an unrelated host reached through a stale public DNS record.
    for address in state["bindings"]:
        resolved = f"[{address}]" if ":" in address else address
        for attempt in range(60):
            try:
                run("curl", "--noproxy", "*", "--fail", "--silent", "--connect-timeout", "2", "--max-time", "5",
                    "--resolve", f"{state['hostname']}:443:{resolved}", f"https://{state['hostname']}/api/health")
                break
            except RuntimeError:
                if attempt == 59:
                    raise ValueError("browser ACME/TLS is unavailable on a selected NIC; check public DNS A/AAAA, inbound 80/443, NAT and flora-proxy journal")
                time.sleep(1)


def probe_name(installation):
    return "flora-install-probe-" + installation.state["owner"]


def cleanup_probe(installation):
    name = probe_name(installation)
    ids = docker("ps", "--all", "--quiet", "--filter", f"name=^/{name}$").splitlines()
    for container_id in ids:
        info = json.loads(docker("container", "inspect", container_id))[0]
        if info["Name"] != "/" + name or info["Config"].get("Labels", {}).get("flora.installer") != installation.state["owner"]:
            raise ValueError("foreign container occupies the installer probe name; refusing cleanup")
        docker("container", "rm", "--force", info["Id"])
    installation.state.pop("probe_id", None)
    installation.save()
    (STATE / "probe.env").unlink(missing_ok=True)


def uninstall(args, installation):
    installation.verify_files()
    if not installation.state.get("version"):
        raise ValueError("no owned installation to uninstall")
    for service in ("flora-proxy.service", "flora.service", "flora-renew.timer", "flora-network.service"):
        expected = "/etc/systemd/system/" + service
        actual = run("systemctl", "show", service, "--property=FragmentPath", "--value")
        if actual != expected or expected not in installation.state["files"] or not Path(expected).is_file():
            raise ValueError("uninstall found an unmanaged/missing service definition; restore the recorded unit before retrying")
    running = docker("ps", "--quiet", "--filter", "label=flora.managed=true")
    if running:
        raise ValueError("running chats block uninstall; stop/revoke every chat through Flora first")
    if not args.yes and ask("Disable only Flora services, preserving data, keys, accounts, stopped containers, image and network? [yes/no] ") != "yes":
        raise ValueError("uninstall cancelled")
    cleanup_probe(installation)
    for service in ("flora-proxy.service", "flora.service", "flora-renew.timer", "flora-network.service"):
        run("systemctl", "disable", "--now", service)
    cleanup_probe(installation)
    if docker("ps", "--quiet", "--filter", "label=flora.managed=true"):
        run("systemctl", "enable", "--now", "flora-network.service", "flora.service", "flora-proxy.service", "flora-renew.timer")
        raise ValueError("a chat started during uninstall; Flora was re-enabled, stop/revoke chats through the browser before retrying")
    # Keep files and the private firewall protection for recoverable same-release
    # reinstall. Never remove Docker/Caddy packages, images or retained chat layers.
    print("Flora services disabled. All installation data and runtime resources retained. Same-release install re-enables them. No purge is provided.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    install_parser = sub.add_parser("install")
    install_parser.add_argument("--version", required=True)
    install_parser.add_argument("--hostname")
    install_parser.add_argument("--bind-address", action="append")
    install_parser.add_argument("--allow-prerelease", action="store_true")
    install_parser.add_argument("--install-dependencies", action="store_true")
    install_parser.add_argument("--yes", action="store_true")
    install_parser.add_argument("--experimental", action="store_true")
    uninstall_parser = sub.add_parser("uninstall")
    uninstall_parser.add_argument("--yes", action="store_true")
    uninstall_parser.add_argument("--runtime", choices=("retain",), default="retain", help="retain stopped containers, network and image (the only supported recovery-safe choice)")
    sub.add_parser("check-network")
    sub.add_parser("verify-network")
    sub.add_parser("renew")
    sub.add_parser("enrollment-code")
    args = parser.parse_args()
    arch = platform_check()
    if args.command == "install" and not args.experimental:
        raise ValueError("--experimental is required for disposable evaluation; full host acceptance is outstanding")
    os.umask(0o077)
    installation = Installation(lock=args.command not in ("check-network", "verify-network"), existing=args.command != "install")
    if args.command in ("renew", "enrollment-code") and not installation.state.get("flora"):
        raise ValueError("installation has no recorded Flora account; finish or restore the same-release installation first")
    if args.command == "install":
        install(args, arch, installation)
    elif args.command == "uninstall":
        uninstall(args, installation)
    elif args.command in ("check-network", "verify-network"):
        installation.check_network()
        if args.command == "check-network":
            installation.firewall()
    elif args.command == "enrollment-code":
        enrollment(installation, installation.state["flora"][1], reset=True)
        run("systemctl", "try-restart", "flora.service")
    else:
        installation.verify_files()
        pki(installation, installation.state["flora"][1], renew=True)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print(f"Flora installer stopped: {error}. Retained owned state is in {STATE}; no broad cleanup was attempted.", file=sys.stderr)
        sys.exit(1)
