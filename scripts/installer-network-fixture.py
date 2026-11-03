#!/usr/bin/env python3
"""Run only in a disposable privileged container, with a Linux Flora at /flora.

This owns a nested Engine, not the host socket. Browser TLS uses a fixture CA,
not public ACME. It does not exercise systemd, provider calls or GitHub writes.
"""
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile
import time
import sys
import installer_acme_fixture
sys.path.insert(0, "/packaging")
import ubuntu


def run(*args, **kwargs):
    return subprocess.run(args, check=True, text=True, capture_output=True, **kwargs).stdout


def wait_for(check):
    last = None
    for _ in range(100):
        try:
            return check()
        except (subprocess.CalledProcessError, OSError, AssertionError) as error:
            last = error
            time.sleep(0.2)
    raise RuntimeError(f"fixture did not become ready: {last}")


def main():
    if not Path("/.dockerenv").exists() or os.environ.get("FLORA_DISPOSABLE_FIXTURE") != "1":
        raise SystemExit("Run inside a disposable privileged test container only.")
    if Path("/var/run/docker.sock").exists():
        raise SystemExit("Refusing a mounted or pre-existing Docker socket.")
    with tempfile.TemporaryDirectory(prefix="flora-network-") as tmp:
        root = Path(tmp)
        os.chmod(root, 0o755)  # Only public fixture certificates are mounted below.
        socket = f"unix://{root}/docker.sock"
        processes = []
        logs = []
        code = None

        def start(name, *args):
            log = (root / f"{name}.log").open("w+")
            logs.append(log)
            process = subprocess.Popen(args, stdout=log, stderr=log)
            processes.append(process)
            return process

        def docker(*args):
            return run("docker", "--host", socket, *args)

        try:
            start("docker", "dockerd", "--host", socket, "--host", "unix:///var/run/docker.sock", "--group", "root", "--data-root", str(root / "docker"),
                  "--exec-root", str(root / "exec"), "--pidfile", str(root / "docker.pid"),
                  "--storage-driver", "vfs")
            wait_for(lambda: docker("info"))
            ubuntu.STATE = root / "installer-state"
            ubuntu.docker = docker
            installation = ubuntu.Installation()
            installation.network()
            installation.firewall()
            # Reruns preserve identity and do not duplicate the scoped rules.
            installation.network()
            installation.firewall()
            network_id = installation.state["network"]["id"]
            network = json.loads(docker("network", "inspect", network_id))[0]
            gateway = network["IPAM"]["Config"][0]["Gateway"]
            assert ipaddress.ip_address(gateway).is_private
            assert gateway != json.loads(docker("network", "inspect", "bridge"))[0]["IPAM"]["Config"][0]["Gateway"]
            external = json.loads(run("ip", "-j", "route", "get", "192.0.2.1"))[0]["prefsrc"]
            assert external != gateway
            # A routed public/NAT address is not an address Caddy can bind here.
            assert ipaddress.ip_address(external).is_private
            run("openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2",
                "-subj", "/CN=Flora fixture CA", "-addext", "basicConstraints=critical,CA:TRUE",
                "-keyout", str(root / "ca.key"), "-out", str(root / "ca.crt"))
            for name in ("flora-github.internal",):
                run("openssl", "req", "-newkey", "rsa:2048", "-nodes", "-subj", f"/CN={name}",
                    "-keyout", str(root / f"{name}.key"), "-out", str(root / f"{name}.csr"))
                (root / "extensions").write_text(f"subjectAltName=DNS:{name}\nextendedKeyUsage=serverAuth\n")
                run("openssl", "x509", "-req", "-in", str(root / f"{name}.csr"), "-CA", str(root / "ca.crt"),
                    "-CAkey", str(root / "ca.key"), "-CAcreateserial", "-days", "2", "-extfile", str(root / "extensions"),
                    "-out", str(root / f"{name}.crt"))
            os.chmod(root / "ca.crt", 0o644)
            transport = root / "transport.pem"
            transport.write_bytes((root / "flora-github.internal.crt").read_bytes() + (root / "flora-github.internal.key").read_bytes())
            transport.chmod(0o600)
            code = secrets.token_urlsafe(32)
            enrollment = root / "enrollment.sha256"
            enrollment.write_text(hashlib.sha256(code.encode()).hexdigest())
            os.chmod(enrollment, 0o600)
            start("flora", "/flora", "-data-dir", str(root / "data"), "-public-url", "https://flora.example.test",
                  "-agent-image=", "-github-listen", f"{gateway}:443", "-github-tls-cert", str(transport),
                  "-github-tls-key", str(transport), "-enrollment-hash-file", str(enrollment))
            wait_for(lambda: run("curl", "--fail", "--silent", "http://127.0.0.1:8080/api/health"))
            config = root / "Caddyfile"
            authority, directory, acme_state = installer_acme_fixture.start(root, external)
            config.write_text(ubuntu.caddy_config("flora.example.test", [external]).replace(
                "issuer acme {", "issuer acme {\n            dir " + directory))
            run("caddy", "validate", "--config", str(config), "--adapter", "caddyfile")
            start("caddy", "caddy", "run", "--config", str(config), "--adapter", "caddyfile")

            def browser(path, *extra):
                return run("curl", "--noproxy", "*", "--silent", "--show-error", "--fail",
                           "--cacert", str(root / "ca.crt"), "--resolve", f"flora.example.test:443:{external}",
                           *extra, f"https://flora.example.test{path}")

            status = json.loads(wait_for(lambda: browser("/api/auth/status")))
            assert acme_state["validated"] and acme_state["certificate"]
            authority.shutdown()
            assert status["setupRequired"] and status["enrollmentRequired"]
            body = json.dumps({"password": "fixture unique administrator password"})
            try:
                browser("/api/auth/bootstrap", "-H", "Content-Type: application/json", "-H", "Origin: https://flora.example.test", "--data-binary", body)
                raise AssertionError("unauthorized bootstrap succeeded")
            except subprocess.CalledProcessError as error:
                assert error.returncode == 22
            # Keep enrollment material out of process arguments, even in fixtures.
            body = json.dumps({"password": "fixture unique administrator password", "enrollmentCode": code})
            result = run("curl", "--noproxy", "*", "--silent", "--show-error", "--fail", "--cacert", str(root / "ca.crt"),
                         "--resolve", f"flora.example.test:443:{external}", "-H", "Content-Type: application/json",
                         "-H", "Origin: https://flora.example.test", "--data-binary", "@-", "https://flora.example.test/api/auth/bootstrap", input=body)
            assert json.loads(result)["authenticated"]
            assert not json.loads(browser("/api/auth/status"))["setupRequired"]
            # The nested diagnostic container receives public CA trust only.
            docker("pull", "curlimages/curl:8.12.1")
            image = json.loads(docker("image", "inspect", "curlimages/curl:8.12.1"))[0]["Id"]
            dockerfile = 'FROM curlimages/curl:8.12.1\nWORKDIR /workspace\nENTRYPOINT ["sleep", "300"]\n'
            run("docker", "--host", socket, "build", "-t", "flora-sdk-fixture:local", "-", input=dockerfile)
            run("/docker-network-test", "-test.run=^TestOwnedBridgeDocker$", "-test.v", env={
                **os.environ, "FLORA_DOCKER_NETWORK_ID": network_id, "FLORA_DOCKER_NETWORK_GATEWAY": gateway,
                "FLORA_DOCKER_NETWORK_SOCKET": str(root / "docker.sock"), "FLORA_DOCKER_NETWORK_IMAGE": "flora-sdk-fixture:local",
                "FLORA_DOCKER_NETWORK_CA": str(root / "ca.crt")})
            status = docker("run", "--rm", "--network", network_id, "--add-host", f"flora-github.internal:{gateway}",
                            "--mount", f"type=bind,src={root}/ca.crt,dst=/ca.crt,readonly", image,
                            "--silent", "--show-error", "--cacert", "/ca.crt", "--output", "/dev/null", "--write-out", "%{http_code}",
                            "https://flora-github.internal/")
            assert status == "401", status
            # Traffic entering from an unrelated bridge must not reach the broker,
            # even though the private gateway is routable inside this host.
            try:
                docker("run", "--rm", "--network", "bridge", "--add-host", f"flora-github.internal:{gateway}",
                       image, "--silent", "--connect-timeout", "3", "--insecure", f"https://flora-github.internal/")
                raise AssertionError("foreign bridge reached the broker")
            except subprocess.CalledProcessError:
                pass
            sockets = run("ss", "-H", "-ltn")
            assert f"{gateway}:443" in sockets and f"{external}:443" in sockets
            assert "0.0.0.0:443" not in sockets and "[::]:443" not in sockets and "*:443" not in sockets
            if Path("/agent-test-image.tar").is_file():
                docker("load", "--input", "/agent-test-image.tar")
                default_gateway = json.loads(docker("network", "inspect", "bridge"))[0]["IPAM"]["Config"][0]["Gateway"]
                runtime_env = {**os.environ, "HOME": "/tmp", "FLORA_PROVISIONING_TEST_IMAGE": "flora-agent-48-test:local",
                               "FLORA_CHAT_TEST_IMAGE": "flora-agent-48-test:local", "FLORA_CHAT_PROVIDER_HOST": default_gateway,
                               "FLORA_BROKER_GH_TOKEN": ""}
                for binary, tests in [("/provisioning-test", "^Test(Provisioning|Settings)Docker$"),
                                      ("/chat-test", "^Test(Chat|Recovery|ThreeChats)Docker$")]:
                    if Path(binary).is_file():
                        try:
                            result = run("setpriv", "--reuid=1001", "--regid=1001", "--groups=0", binary, "-test.run=" + tests,
                                         "-test.v", env=runtime_env)
                        except subprocess.CalledProcessError as error:
                            print(error.stdout)
                            print(error.stderr)
                            raise
                        print(result)
            for log in logs:
                log.flush()
                log.seek(0)
                assert code not in log.read(), "enrollment code reached a service log"
            print(json.dumps({"broker_gateway": gateway, "browser_local_address": external, "network_id": network_id,
                              "diagnostic_image_id": image, "tls": "local ACME HTTP-01 fixture CA, not public ACME",
                              "result": "bound HTTP-01/browser TLS, bridge hostname/SAN/CA, broker 401, protected enrollment passed"}))
        except BaseException:
            # Logs never include enrollment codes, request bodies or upstream keys.
            for log in logs:
                log.flush()
                log.seek(0)
                contents = log.read()
                print(contents.replace(code, "[redacted]") if code else contents)
            raise
        finally:
            for process in reversed(processes):
                process.terminate()
            for process in reversed(processes):
                try:
                    process.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()


if __name__ == "__main__":
    main()
