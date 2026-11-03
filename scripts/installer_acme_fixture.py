"""Local HTTP-01 authority for disposable tests. Does not authenticate JWS."""
import base64
import hashlib
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import secrets
import subprocess
import threading


def start(root, external, domain="flora.example.test"):
    state = {"validated": False, "certificate": None, "thumbprint": None}
    token = secrets.token_urlsafe(24)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def reply(self, body, status=200, location=None, content_type="application/json"):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Replay-Nonce", secrets.token_urlsafe(24))
            if location:
                self.send_header("Location", base + location)
            self.end_headers()
            if body is not None:
                self.wfile.write(body if isinstance(body, bytes) else json.dumps(body).encode())

        def do_HEAD(self):
            self.reply(None)

        def do_GET(self):
            self.reply({key: base + path for key, path in {
                "newNonce": "/nonce", "newAccount": "/account", "newOrder": "/order"}.items()})

        def do_POST(self):
            def decode(value):
                return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))

            request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            payload = json.loads(decode(request["payload"])) if request["payload"] else {}
            protected = json.loads(decode(request["protected"]))
            if self.path == "/account":
                state["thumbprint"] = base64.urlsafe_b64encode(hashlib.sha256(
                    json.dumps(protected["jwk"], sort_keys=True, separators=(",", ":")).encode()).digest()).decode().rstrip("=")
                self.reply({"status": "valid"}, 201, "/account/1")
            elif self.path in ("/order", "/order/1"):
                order = {"status": "valid" if state["certificate"] else "ready" if state["validated"] else "pending",
                         "identifiers": [{"type": "dns", "value": domain}],
                         "authorizations": [base + "/authz/1"], "finalize": base + "/finalize/1"}
                if state["certificate"]:
                    order["certificate"] = base + "/certificate/1"
                self.reply(order, 201 if self.path == "/order" else 200, "/order/1")
            elif self.path == "/authz/1":
                self.reply({"status": "valid" if state["validated"] else "pending",
                            "identifier": {"type": "dns", "value": domain},
                            "challenges": [{"type": "http-01", "url": base + "/challenge/1", "token": token,
                                            "status": "valid" if state["validated"] else "pending"}]})
            elif self.path == "/challenge/1":
                connection = http.client.HTTPConnection(external, 80, timeout=10)
                connection.request("GET", f"/.well-known/acme-challenge/{token}", headers={"Host": domain})
                response = connection.getresponse()
                actual = response.read().decode()
                connection.close()
                assert response.status == 200 and actual == token + "." + state["thumbprint"], "HTTP-01 response mismatch"
                sockets = subprocess.check_output(["ss", "-H", "-ltn"], text=True)
                assert f"{external}:80" in sockets
                assert all(address not in sockets for address in ("0.0.0.0:80", "[::]:80", "*:80", "0.0.0.0:443", "[::]:443", "*:443"))
                state["validated"] = True
                self.reply({"type": "http-01", "url": base + "/challenge/1", "token": token, "status": "valid"})
            elif self.path == "/finalize/1":
                assert state["validated"]
                (root / "browser.csr").write_bytes(decode(payload["csr"]))
                subprocess.run(["openssl", "x509", "-req", "-inform", "DER", "-in", str(root / "browser.csr"),
                                "-CA", str(root / "ca.crt"), "-CAkey", str(root / "ca.key"), "-CAcreateserial",
                                "-days", "2", "-copy_extensions", "copy", "-out", str(root / "browser.crt")],
                               check=True, capture_output=True)
                state["certificate"] = (root / "browser.crt").read_bytes() + (root / "ca.crt").read_bytes()
                self.reply({"status": "valid", "certificate": base + "/certificate/1"})
            elif self.path == "/certificate/1":
                self.reply(state["certificate"], content_type="application/pem-certificate-chain")
            else:
                self.reply({"type": "urn:ietf:params:acme:error:malformed"}, 400)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    base = f"http://127.0.0.1:{server.server_port}"
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, base + "/directory", state
