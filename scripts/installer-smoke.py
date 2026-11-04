"""Run only on a disposable native Linux CI runner with systemd and Docker.

Only release downloads are substituted with the already verified local archive.
The archived installer, installed binary, host paths and systemd are real.
"""
import http.client
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time


archive = Path(sys.argv[1]).resolve()
stage = Path(sys.argv[2]).resolve()
identity = json.loads((stage / 'release.json').read_text())
version = identity['version']
data = Path('/var/lib/flora')
opt = Path('/opt/flora')
unit = Path('/etc/systemd/system/flora.service')
assert os.getuid() == 0 and Path('/run/systemd/system').is_dir()
for path in (data, opt, unit):
    assert not path.exists() and not path.is_symlink(), f'Fixture path already exists: {path}'
assert subprocess.check_output(['systemctl', 'show', 'flora.service', '--property=LoadState', '--value']).strip() == b'not-found'


def engine(method, path):
    connection = http.client.HTTPConnection('localhost', timeout=15)
    connection.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    connection.sock.connect('/var/run/docker.sock')
    connection.request(method, '/v1.44' + path)
    response = connection.getresponse()
    payload = response.read()
    assert response.status < 300, (method, path, response.status)
    connection.close()
    return json.loads(payload) if payload else None


with tempfile.TemporaryDirectory(prefix='flora-installer-smoke-') as tmp:
    root = Path(tmp)
    wrapper = root / 'curl'
    wrapper.write_text('''#!/usr/bin/env python3
import os, pathlib, shutil, sys
args = sys.argv[1:]
prefix = 'https://github.com/rhizomatous/flora/releases/download/' + os.environ['INSTALLER_VERSION'] + '/'
urls = [arg for arg in args if arg.startswith(prefix)]
if urls:
    assert len(urls) == 1 and args[-2] == '-o', args
    assert args[:5] == ['--disable', '--proto', '=https', '--proto-redir', '=https'], args
    name = urls[0][len(prefix):]
    archive = pathlib.Path(os.environ['INSTALLER_ARCHIVE'])
    assert name in (archive.name, 'SHA256SUMS'), name
    shutil.copyfile(archive if name == archive.name else archive.parent / name, args[-1])
else:
    os.execv(os.environ['INSTALLER_CURL'], [os.environ['INSTALLER_CURL']] + args)
''')
    wrapper.chmod(0o755)
    env = dict(os.environ, INSTALLER_VERSION=version, INSTALLER_ARCHIVE=str(archive),
               INSTALLER_CURL=shutil.which('curl'), PATH=tmp + os.pathsep + os.environ['PATH'])

    def install():
        return subprocess.run(['sh', '-s', '--', '--version', version,
                               '--public-url', 'https://flora.example.test'],
                              input=(stage / 'install.sh').read_text(), text=True,
                              capture_output=True, start_new_session=True, timeout=180, env=env)

    try:
        result = install()
        assert result.returncode == 0, result.stdout + result.stderr
        assert (opt / 'flora').read_bytes() == (stage / 'flora').read_bytes()
        assert json.loads(subprocess.check_output([str(opt / 'flora'), '-version'])) == identity
        assert subprocess.run(['systemctl', 'is-enabled', '--quiet', 'flora.service']).returncode == 0
        deployment = data / 'deployment'
        retained = {name: (deployment / name).read_bytes() for name in
                    ('deployment.json', 'broker-ca.pem', 'enrollment-code')}
        code = retained['enrollment-code'].decode().strip()
        assert code and code not in result.stdout + result.stderr
        assert data.stat().st_mode & 0o777 == 0o700
        assert (deployment / 'enrollment-code').stat().st_mode & 0o777 == 0o600
        assert (deployment / 'enrollment-code').stat().st_uid == 0
        repeat = install()
        assert repeat.returncode != 0 and 'Refusing to overwrite' in repeat.stderr
        subprocess.run(['systemctl', 'restart', 'flora.service'], check=True)
        for _ in range(60):
            probe = subprocess.run([env['INSTALLER_CURL'], '--fail', '--silent', '--max-time', '2',
                                    'http://127.0.0.1:8080/api/health'], stdout=subprocess.DEVNULL)
            if probe.returncode == 0:
                break
            time.sleep(.5)
        else:
            raise AssertionError('Installed service did not become healthy after restart')
        for name, contents in retained.items():
            assert (deployment / name).read_bytes() == contents, name
        journal = subprocess.check_output(['journalctl', '-u', 'flora.service', '--no-pager'], text=True)
        assert code not in journal
        print(f'Installer systemd smoke passed: {version} linux/{identity["arch"]}; restart retains private identity; no enrollment secret in output or journal')
    finally:
        subprocess.run(['systemctl', 'stop', 'flora.service'], capture_output=True)
        subprocess.run(['systemctl', 'disable', 'flora.service'], capture_output=True)
        unit.unlink(missing_ok=True)
        subprocess.run(['systemctl', 'daemon-reload'], check=True)
        saved = data / 'deployment/deployment.json'
        if saved.exists():
            state = json.loads(saved.read_text())
            if state.get('NetworkID'):
                network = engine('GET', '/networks/' + state['NetworkID'])
                assert network['Labels']['flora.deployment'] == state['Owner']
                engine('DELETE', '/networks/' + state['NetworkID'])
        for path in (data, opt):
            if path.exists():
                shutil.rmtree(path)
