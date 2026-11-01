"""Exercise an installed archive on a disposable Linux host, without build tools.

Only fixture-owned containers are created or stopped. No upstream credentials or
model responses are used. The service uid is intentionally not the image uid.
"""

import hashlib
import http.client
import json
import os
from pathlib import Path
import pwd
import re
import secrets
import shutil
import signal
import socket
import ssl
import subprocess
import tarfile
import time
import urllib.request

from release_image import EngineError, ensure_image


class UnixHTTP(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.connect('/var/run/docker.sock')


def engine(method, path, body=None):
    c = UnixHTTP('localhost', timeout=180)
    c.request(method, '/v1.45' + path, None if body is None else json.dumps(body),
              {'Content-Type': 'application/json'})
    r = c.getresponse()
    data = r.read()
    if r.status >= 300:
        raise EngineError(method, path, r.status)  # never print secret bodies
    return json.loads(data) if data and not path.startswith('/images/create') else None


def request(url, body=None, headers=None, context=None):
    req = urllib.request.Request(url, None if body is None else json.dumps(body).encode(),
                                 {'Content-Type': 'application/json', **(headers or {})})
    with urllib.request.urlopen(req, timeout=5, context=context) as r:
        return r.read(), r.headers


def wait_for(fn):
    for _ in range(180):
        try:
            return fn()
        except (OSError, AssertionError, ValueError):
            time.sleep(.5)
    raise AssertionError('fixture readiness timeout')


identity = json.loads(subprocess.check_output(['/opt/flora/flora', '-version']))
assert identity == json.loads(Path('/opt/flora/release.json').read_text())
assert re.fullmatch(r'.+@sha256:[a-f0-9]{64}', identity['agent_image'])
assert identity['harness_version'] == '1.2.27'
user = pwd.getpwnam('flora')
assert user.pw_uid not in (0, 1000)
root = Path('/var/lib/flora')
config = Path('/etc/flora')
os.umask(0o077)
subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
                '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost',
                '-keyout', str(config / 'transport.key'), '-out', str(config / 'transport.crt')],
               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
shutil.copyfile(config / 'transport.crt', config / 'transport-ca.crt')
for p in config.glob('transport*'):
    os.chown(p, 0, user.pw_gid)
    p.chmod(0o640)
key_hash = hashlib.sha256((config / 'transport.key').read_bytes()).digest()
image = os.environ.get('FLORA_RELEASE_LOCAL_IMAGE', identity['agent_image'])
info = ensure_image(engine, image)
image_id = info['Id']
assert info['Config']['Env'] and 'OPENCODE_CONFIG=/etc/flora/opencode.json' in info['Config']['Env']


def demote():
    import grp
    os.setgroups([grp.getgrnam('docker').gr_gid])
    os.setgid(user.pw_gid)
    os.setuid(user.pw_uid)


def start():
    args = ['/opt/flora/flora', '-listen', '127.0.0.1:18080', '-public-url', 'https://flora.test',
            '-data-dir', str(root), '-github-listen', '127.0.0.1:18443',
            '-github-host', 'localhost', '-github-ca', str(config / 'transport-ca.crt'),
            '-github-tls-cert', str(config / 'transport.crt'),
            '-github-tls-key', str(config / 'transport.key')]
    if image != identity['agent_image']:
        args += ['-agent-image', image, '-agent-image-id', image_id,
                 '-agent-image-digest', identity['agent_image']]
    p = subprocess.Popen(args, cwd='/', preexec_fn=demote, env={'PATH': '/nonexistent'},
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    wait_for(lambda: request('http://127.0.0.1:18080/api/health'))
    assert p.poll() is None
    return p


def stop(p):
    p.send_signal(signal.SIGTERM)
    assert p.wait(timeout=20) == 0


p = None
container = None
try:
    p = start()
    base = 'http://127.0.0.1:18080'
    html, _ = request(base)
    assets = re.findall(rb'(?:src|href)="(/assets/[^" ]+)"', html)
    assert len(assets) >= 2
    for asset in assets:
        assert len(request(base + asset.decode())[0]) > 0
    _, headers = request(base + '/api/auth/bootstrap', {'password': secrets.token_urlsafe(24)},
                         {'Origin': 'https://flora.test'})
    cookie = headers['Set-Cookie'].split(';')[0]
    auth = {'Cookie': cookie, 'Origin': 'https://flora.test'}
    assert json.loads(request(base + '/api/auth/status', headers=auth)[0])['authenticated']
    diagnostics = json.loads(request(base + '/api/settings/diagnostics', {}, auth)[0])
    for name in ('Docker', 'Agent image'):
        assert any(d['name'] == name and d['ok'] for d in diagnostics)
    tls = ssl.create_default_context(cafile=str(config / 'transport-ca.crt'))
    try:
        request('https://localhost:18443/', context=tls)
    except urllib.error.HTTPError as e:
        assert e.code == 401  # TLS trust succeeded, unauthenticated broker rejected access
    else:
        raise AssertionError('broker accepted an unauthenticated request')
    assert (root / 'flora.db').stat().st_mode & 0o777 == 0o600
    workspace = root / 'workspaces' / 'release-fixture'
    home = root / 'runtime-state' / 'release-fixture'
    for path in (workspace, home):
        path.mkdir(mode=0o700)
        os.chown(path, user.pw_uid, user.pw_gid)
    password = secrets.token_urlsafe(24)
    container = engine('POST', '/containers/create', {
        'Image': image_id,
        'Env': [f'FLORA_UID={user.pw_uid}', f'FLORA_GID={user.pw_gid}',
                'OPENCODE_SERVER_PASSWORD=' + password,
                'SETUP_COMMAND=printf preserved-workspace > /workspace/saved.txt'],
        'Labels': {'flora.release-fixture': 'true'},
        'HostConfig': {'Binds': [f'{workspace}:/workspace', f'{home}:/home/flora'],
                       'Memory': 2 * 1024**3, 'NanoCpus': 2 * 10**9, 'PidsLimit': 512}
    })['Id']
    engine('POST', '/containers/' + container + '/start')
    details = engine('GET', '/containers/' + container + '/json')
    assert details['Image'] == image_id
    assert not details['HostConfig']['Privileged']
    assert len(details['Mounts']) == 2
    assert all(m['Destination'] in ('/workspace', '/home/flora') for m in details['Mounts'])
    addr = details['NetworkSettings']['IPAddress']
    import base64
    runtime_headers = {'Authorization': 'Basic ' + base64.b64encode(('opencode:' + password).encode()).decode()}
    runtime = 'http://' + addr + ':4096'
    health = json.loads(wait_for(lambda: request(runtime + '/global/health', headers=runtime_headers))[0])
    assert health['version'] == identity['harness_version']
    session = json.loads(request(runtime + '/session', {'title': 'offline recovery fixture'}, runtime_headers)[0])
    session_id = session['id']
    assert (workspace / 'saved.txt').stat().st_uid == user.pw_uid
    engine('POST', '/containers/' + container + '/stop?t=15')
    stop(p)
    p = None
    assert not engine('GET', '/containers/' + container + '/json')['State']['Running']
    backup = Path('/root/flora-release-fixture.tar')
    assert not backup.exists()
    with tarfile.open(backup, 'w') as tar:
        tar.add(root, arcname='var/lib/flora')
        tar.add(config, arcname='etc/flora')
    assert backup.stat().st_mode & 0o777 == 0o600
    shutil.rmtree(root)
    shutil.rmtree(config)
    with tarfile.open(backup) as tar:
        tar.extractall('/', filter='fully_trusted')  # local, fixture-created archive only
    assert hashlib.sha256((config / 'transport.key').read_bytes()).digest() == key_hash
    assert root.stat().st_uid == user.pw_uid and root.stat().st_mode & 0o777 == 0o700
    p = start()
    assert json.loads(request(base + '/api/auth/status', headers=auth)[0])['authenticated']
    assert (workspace / 'saved.txt').read_text() == 'preserved-workspace'
    engine('POST', '/containers/' + container + '/start')
    addr = engine('GET', '/containers/' + container + '/json')['NetworkSettings']['IPAddress']
    runtime = 'http://' + addr + ':4096'
    wait_for(lambda: request(runtime + '/global/health', headers=runtime_headers))
    restored = json.loads(request(runtime + '/session/' + session_id, headers=runtime_headers)[0])
    assert restored['id'] == session_id
    backup.unlink()
    print(json.dumps({'result': 'passed', 'identity': identity, 'local_image_id': image_id,
                      'service_uid': user.pw_uid, 'restored': ['account', 'workspace', 'OpenCode session', 'private TLS key']}))
finally:
    if container:
        engine('DELETE', '/containers/' + container + '?force=true')
    if p and p.poll() is None:
        stop(p)
