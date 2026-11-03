"""Run the archived binary's managed private runtime on disposable native Linux.

The HTTPS proxy and all Docker resources belong to this fixture. No upstream
credentials, provider calls, host services or installer paths are used.
"""

import http.client
import http.server
import json
import os
from pathlib import Path
import secrets
import signal
import socket
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request

from release_image import EngineError, ensure_image


class UnixHTTP(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.connect('/var/run/docker.sock')


def engine(method, path, body=None):
    c = UnixHTTP('localhost', timeout=180)
    c.request(method, '/v1.44' + path, None if body is None else json.dumps(body),
              {'Content-Type': 'application/json'})
    r = c.getresponse()
    data = r.read()
    if r.status >= 300:
        raise EngineError(method, path, r.status)
    return json.loads(data) if data and not path.startswith('/images/create') else None


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


stage = Path(sys.argv[1]).resolve()
identity = json.loads(subprocess.check_output([str(stage / 'flora'), '-version']))
image = identity['agent_image']
ensure_image(engine, image)
os.umask(0o077)
with tempfile.TemporaryDirectory(prefix='flora-release-') as tmp:
    root = Path(tmp)
    backend_port = free_port()

    class Proxy(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            self.forward()

        def do_POST(self):
            self.forward()

        def forward(self):
            upstream = http.client.HTTPConnection('127.0.0.1', backend_port, timeout=5)
            body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
            upstream.request(self.command, self.path, body, dict(self.headers))
            response = upstream.getresponse()
            self.send_response(response.status)
            for key, value in response.getheaders():
                self.send_header(key, value)
            self.end_headers()
            self.wfile.write(response.read())
            upstream.close()

        def log_message(self, *_):
            pass

    subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
                    '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost',
                    '-keyout', str(root / 'key'), '-out', str(root / 'cert')],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
    proxy = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Proxy)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(root / 'cert', root / 'key')
    proxy.socket = context.wrap_socket(proxy.socket, server_side=True)
    threading.Thread(target=proxy.serve_forever, daemon=True).start()
    base = f'https://localhost:{proxy.server_port}'
    trust = ssl.create_default_context(cafile=str(root / 'cert'))
    data = root / 'data'

    def request(path, body=None, cookie=None, origin=base, expected=200):
        headers = {'Content-Type': 'application/json', 'Origin': origin}
        if cookie:
            headers['Cookie'] = cookie
        req = urllib.request.Request(base + path, None if body is None else json.dumps(body).encode(), headers)
        try:
            response = urllib.request.urlopen(req, timeout=5, context=trust)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            assert response.status == expected, (path, response.status)
            return response.read(), response.headers

    def start():
        process = subprocess.Popen([str(stage / 'flora'), '-public-url', base,
                                    '-listen', f'127.0.0.1:{backend_port}', '-data-dir', str(data)],
                                   cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(100):
            assert process.poll() is None, 'archived application exited during startup'
            try:
                request('/api/health')
                return process
            except (OSError, AssertionError):
                time.sleep(.1)
        process.kill()
        process.wait()
        raise AssertionError('managed runtime readiness timeout')

    def stop(process):
        process.send_signal(signal.SIGTERM)
        assert process.wait(timeout=20) == 0

    process = None
    try:
        process = start()
        html, _ = request('/')
        import re
        assets = re.findall(rb'(?:src|href)="(/assets/[^" ]+)"', html)
        assert len(assets) >= 2
        for asset in assets:
            assert request(asset.decode())[0]
        state = json.loads((data / 'deployment/deployment.json').read_text())
        ca = (data / 'deployment/broker-ca.pem').read_bytes()
        code = (data / 'deployment/enrollment-code').read_text()
        password = secrets.token_urlsafe(24)
        body = {'password': password, 'enrollmentCode': code}
        request('/api/auth/bootstrap', body, origin='https://attacker.test', expected=403)
        request('/api/auth/bootstrap', {'password': password}, expected=403)
        _, headers = request('/api/auth/bootstrap', body)
        assert all(s in headers['Set-Cookie'] for s in ('Secure', 'HttpOnly', 'SameSite=Strict'))
        cookie = headers['Set-Cookie'].split(';')[0]
        assert json.loads(request('/api/auth/status', cookie=cookie)[0])['authenticated']
        stop(process)
        process = start()
        assert state == json.loads((data / 'deployment/deployment.json').read_text())
        assert ca == (data / 'deployment/broker-ca.pem').read_bytes()
        assert json.loads(request('/api/auth/status', cookie=cookie)[0])['authenticated']
        request('/api/auth/bootstrap', body, expected=409)
        _, login = request('/api/auth/login', {'password': password})
        assert 'Secure' in login['Set-Cookie']
        assert (data / 'flora.db').stat().st_mode & 0o777 == 0o600
        print(json.dumps({'result': 'passed', 'identity': identity,
                          'checks': ['archive HTTP backend through HTTPS proxy', 'protected enrollment',
                                     'secure login', 'restart keeps account, network and private trust']}))
    finally:
        if process and process.poll() is None:
            stop(process)
        state_path = data / 'deployment/deployment.json'
        if state_path.exists():
            saved = json.loads(state_path.read_text())
            network = saved.get('NetworkID')
            if network:
                info = engine('GET', '/networks/' + network)
                assert info['Labels']['flora.deployment'] == saved['Owner']
                engine('DELETE', '/networks/' + network)
        proxy.shutdown()
        proxy.server_close()
