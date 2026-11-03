#!/usr/bin/env python3
"""Full installer exercise inside an owned systemd container and nested Engine.

The only substituted inputs are the release HTTPS transport and ACME issuer.
Accounts, permissions, storage preflight, systemd units, Docker and TLS are real.
The NIC is a test-only dummy interface, not a public ingress path or VM boot.
"""
import fcntl
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import platform
import pty
import re
import select
import shlex
import socket
import ssl
import subprocess
import sys
import tarfile
import termios
import threading
import time
import urllib.request
from unittest.mock import patch

sys.path.insert(0, "/packaging")
sys.path.insert(0, "/")
import ubuntu
import release_download
import installer_acme_fixture

ROOT = Path("/fixture-support")
DOMAIN = "flora.example.invalid"
ADDRESS = "192.0.2.48"
VERSION = "v0.0.0-fixture"


def run(*args, **kwargs):
    return subprocess.run(args, check=True, text=True, capture_output=True, timeout=600, **kwargs).stdout.strip()


def wait(check):
    for attempt in range(120):
        try:
            return check()
        except (subprocess.CalledProcessError, OSError, AssertionError):
            if attempt == 119:
                raise
            time.sleep(0.5)


def guard():
    assert Path("/.dockerenv").exists() and Path("/proc/1/comm").read_text().strip() == "systemd"
    assert os.geteuid() == 0


def prepare():
    wait(lambda: run("docker", "info"))
    ROOT.mkdir(mode=0o700)
    run("systemctl", "disable", "--now", "caddy.service")
    Path("/etc/systemd/system/fixture-nic.service").write_text(f"""[Unit]
Description=Disposable browser NIC
Before=network-online.target
[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/sbin/ip link add fixture-nic type dummy
ExecStart=/usr/sbin/ip address add {ADDRESS}/32 dev fixture-nic
ExecStart=/usr/sbin/ip link set fixture-nic up
ExecStart=/usr/sbin/ip route add default dev fixture-nic metric 1000
[Install]
WantedBy=network-online.target
""")
    run("systemctl", "daemon-reload")
    run("systemctl", "enable", "--now", "fixture-nic.service")
    with Path("/etc/hosts").open("a") as out:
        out.write(f"\n{ADDRESS} {DOMAIN}\n")
    # The registry and all published fixture bytes remain in this nested Engine.
    run("docker", "run", "-d", "--name", "fixture-registry", "-p", "127.0.0.1:51848:5000",
        "registry:2@sha256:a3d8aaa63ed8681a604f1dea0aa03f100d5895b6a58ace528858a7b332415373")
    run("docker", "build", "-t", "localhost:51848/flora-agent:fixture", "/agent-image")
    run("docker", "push", "localhost:51848/flora-agent:fixture")
    image = json.loads(run("docker", "image", "inspect", "localhost:51848/flora-agent:fixture"))[0]
    print(image["RepoDigests"][0])


def browser(path, body=None):
    headers = {"Origin": f"https://{DOMAIN}", "Content-Type": "application/json"}
    request = urllib.request.Request(f"https://{DOMAIN}{path}", data=json.dumps(body).encode() if body else None, headers=headers)
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=10) as response:
        return json.load(response)


def snapshot():
    state = json.loads((ubuntu.STATE / "state.json").read_text())
    return {"owner": state["owner"], "network": state["network"], "flora": state["flora"], "flora-proxy": state["flora-proxy"],
            "ca": state["ca"], "enrollment": Path("/etc/flora/enrollment.sha256").read_text()}


def cli(command, interrupt=False):
    master, slave = pty.openpty()

    def terminal():
        os.setsid()
        fcntl.ioctl(slave, termios.TIOCSCTTY, 0)

    child = subprocess.Popen([sys.executable, __file__, command], stdin=slave, stdout=slave, stderr=slave,
                             preexec_fn=terminal, env={**os.environ, "FLORA_FIXTURE_INTERRUPT": "1" if interrupt else "0"})
    os.close(slave)
    output = bytearray()
    deadline = time.monotonic() + 600
    try:
        while time.monotonic() < deadline:
            if select.select([master], [], [], 0.2)[0]:
                try:
                    data = os.read(master, 65536)
                except OSError:
                    break
                if not data:
                    break
                output.extend(data)
            elif child.poll() is not None:
                break
        else:
            child.kill()
            raise AssertionError("installer did not finish within ten minutes")
        child.wait(timeout=10)
    finally:
        os.close(master)
    text = output.decode(errors="replace")
    code = re.search(r"enrollment code \(not a URL\):\s+([^\s]+)", text)
    secret = code[1] if code else None
    if child.returncode not in (0, 75):
        print(text.replace(secret, "[redacted]") if secret else text)
    return child.returncode, secret


def fixture_install():
    configuration = json.loads((ROOT / "transport.json").read_text())
    real_opener = urllib.request.build_opener
    real_config = ubuntu.caddy_config
    real_atomic = ubuntu.atomic

    class Transport:
        def __init__(self):
            self.opener = real_opener(release_download.HTTPSOnly(), urllib.request.ProxyHandler({}))

        def open(self, request, timeout):
            assert request.full_url in configuration["urls"], "unexpected production release URL"
            destination = configuration["base"] + configuration["urls"][request.full_url]
            return self.opener.open(urllib.request.Request(destination, headers=dict(request.header_items())), timeout=timeout)

    def atomic(path, *args, **kwargs):
        real_atomic(path, *args, **kwargs)
        if str(path) == "/etc/systemd/system/flora.service" and os.environ.get("FLORA_FIXTURE_INTERRUPT") == "1":
            os._exit(75)

    def config(domain, bindings):
        return real_config(domain, bindings).replace("issuer acme {", "issuer acme {\n            dir " + configuration["acme"])

    sys.argv = ["ubuntu.py", "install", "--version", VERSION, "--hostname", DOMAIN, "--experimental", "--allow-prerelease", "--yes"]
    with patch.object(release_download.urllib.request, "build_opener", side_effect=lambda *_: Transport()), patch.object(ubuntu, "caddy_config", side_effect=config), patch.object(ubuntu, "atomic", side_effect=atomic):
        ubuntu.main()


def exercise():
    run("openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-subj", "/CN=Disposable fixture CA",
        "-addext", "basicConstraints=critical,CA:TRUE", "-keyout", str(ROOT / "ca.key"), "-out", str(ROOT / "ca.crt"))
    run("openssl", "req", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=localhost", "-keyout", str(ROOT / "server.key"), "-out", str(ROOT / "server.csr"))
    (ROOT / "extensions").write_text("subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n")
    run("openssl", "x509", "-req", "-in", str(ROOT / "server.csr"), "-CA", str(ROOT / "ca.crt"), "-CAkey", str(ROOT / "ca.key"),
        "-CAcreateserial", "-days", "2", "-extfile", str(ROOT / "extensions"), "-out", str(ROOT / "server.crt"))
    Path("/usr/local/share/ca-certificates/fixture.crt").write_bytes((ROOT / "ca.crt").read_bytes())
    run("update-ca-certificates")
    archive = Path("/fixture-release.tar.gz")
    with tarfile.open(archive) as package:
        identity = json.load(package.extractfile("./release.json"))
    assert identity["commit"] == os.environ["FLORA_FIXTURE_COMMIT"]
    arch = identity["arch"]
    filename = f"flora-{VERSION}-linux-{arch}.tar.gz"
    checksum = hashlib.sha256(archive.read_bytes()).hexdigest()
    payloads = {"/release": json.dumps({"tag_name": VERSION, "draft": False, "prerelease": True}).encode(),
                "/ref": json.dumps({"object": {"type": "commit", "sha": identity["commit"]}}).encode(),
                "/SHA256SUMS": f"{checksum}  {filename}\n".encode()}

    class Release(BaseHTTPRequestHandler):
        corrupt = False

        def log_message(self, *_):
            pass

        def do_GET(self):
            self.send_response(200)
            self.end_headers()
            if self.path == "/archive":
                self.wfile.write(b"damaged" if self.corrupt else archive.read_bytes())
            else:
                self.wfile.write(payloads[self.path])

    server = ThreadingHTTPServer(("127.0.0.1", 0), Release)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(ROOT / "server.crt", ROOT / "server.key")
    server.socket = context.wrap_socket(server.socket, server_side=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    authority, acme, validated = installer_acme_fixture.start(ROOT, ADDRESS, DOMAIN)
    (ROOT / "transport.json").write_text(json.dumps({"base": f"https://127.0.0.1:{server.server_port}", "acme": acme, "urls": {
        f"{release_download.API}/releases/tags/{VERSION}": "/release",
        f"{release_download.API}/git/ref/tags/{VERSION}": "/ref",
        f"{release_download.REPOSITORY}/releases/download/{VERSION}/SHA256SUMS": "/SHA256SUMS",
        f"{release_download.REPOSITORY}/releases/download/{VERSION}/{filename}": "/archive"}}))
    Release.corrupt = True
    assert cli("install")[0] != 0
    assert not Path("/opt/flora").exists() and not Path("/etc/flora").exists()
    Release.corrupt = False
    status, code = cli("install", interrupt=True)
    assert status == 75 and code
    before = snapshot()
    assert cli("install")[0] == 0
    assert snapshot() == before
    assert validated["validated"] and validated["certificate"]
    assert browser("/api/auth/status")["enrollmentRequired"]
    browser("/api/auth/bootstrap", {"password": "disposable fixture administrator password", "enrollmentCode": code})
    assert not browser("/api/auth/status")["setupRequired"]
    sentinel = Path("/var/lib/flora/recovery-sentinel")
    sentinel.write_text("preserved edits")
    run("systemctl", "restart", "flora.service")
    wait(lambda: browser("/api/health"))
    assert cli("install")[0] == 0 and snapshot() == before
    gateway = before["network"]["gateway"]
    assert run("curl", "--noproxy", "*", "--silent", "--cacert", "/etc/flora/transport-ca.crt", "--resolve", f"{ubuntu.ALIAS}:443:{gateway}",
               "--output", "/dev/null", "--write-out", "%{http_code}", f"https://{ubuntu.ALIAS}/") == "401"
    run_owned_lifecycle(identity, before)
    owner = before["owner"]
    name = "flora-install-probe-" + owner
    foreign = run("docker", "run", "-d", "--name", name, "--entrypoint", "sleep", identity["agent_image"], "300")
    assert cli("uninstall")[0] != 0
    assert run("docker", "inspect", "--format", "{{.State.Running}}", foreign) == "true"
    assert browser("/api/health")["status"] == "ok"
    run("docker", "rm", "-f", foreign)
    orphan = run("docker", "run", "-d", "--name", name, "--label", f"flora.installer={owner}", "--entrypoint", "sleep", identity["agent_image"], "300")
    assert cli("uninstall")[0] == 0
    assert not run("docker", "ps", "-aq", "--filter", f"id={orphan}")
    assert sentinel.read_text() == "preserved edits" and snapshot() == before
    assert cli("install")[0] == 0
    assert not browser("/api/auth/status")["setupRequired"] and snapshot() == before
    journal = run("journalctl", "-u", "flora", "-u", "flora-proxy", "--no-pager")
    assert code not in journal
    (ROOT / "snapshot.json").write_text(json.dumps(before))
    server.shutdown()
    authority.shutdown()
    print("Full orchestration passed: HTTPS release verification, interrupted placement/resume, real systemd/Docker/TLS probe, enrollment, same-version rerun, orphan-safe uninstall/reinstall.")


def run_owned_lifecycle(identity, state):
    uid, gid = state["flora"]
    run("setpriv", f"--reuid={uid}", f"--regid={gid}", "--groups=" + str(__import__("grp").getgrnam("docker").gr_gid),
        "/provisioning-test", "-test.run=^TestProvisioningOwnedDocker$", "-test.v", env={**os.environ,
        "FLORA_PROVISIONING_TEST_IMAGE": identity["agent_image"], "FLORA_OWNED_NETWORK_ID": state["network"]["id"],
        "FLORA_OWNED_NETWORK_GATEWAY": state["network"]["gateway"]})


def verify_restart():
    wait(lambda: run("systemctl", "is-active", "flora.service", "flora-proxy.service"))
    wait(lambda: browser("/api/health"))
    assert snapshot() == json.loads((ROOT / "snapshot.json").read_text())
    assert not browser("/api/auth/status")["setupRequired"]
    assert Path("/var/lib/flora/recovery-sentinel").read_text() == "preserved edits"
    print("Systemd container restart preserved administrator, data, CA, numeric accounts and network identity. This is not a VM/host reboot.")


if __name__ == "__main__":
    guard()
    command = sys.argv[1]
    if command == "prepare":
        prepare()
    elif command == "exercise":
        exercise()
    elif command == "install":
        fixture_install()
    elif command == "uninstall":
        sys.argv = ["ubuntu.py", "uninstall", "--yes"]
        ubuntu.main()
    elif command == "verify-restart":
        verify_restart()
