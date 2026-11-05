"""Exercise the shipped shell script without changing host paths or services."""
import hashlib
import io
import json
import os
from pathlib import Path
import pty
import platform
import select
import subprocess
import tarfile
import tempfile
import unittest


SOURCE = Path(__file__).with_name('install.sh').read_text()
SECRET = 'fixture-enrollment-secret'
FAKE = r'''#!/usr/bin/env python3
import json, os, pathlib, shutil, sys
p = pathlib.Path(os.environ['FIXTURE'])
name, args = pathlib.Path(sys.argv[0]).name, sys.argv[1:]
with (p/'calls').open('a') as f: f.write(json.dumps([name, args])+'\n')
mode = os.environ.get('MODE', '')
if name == 'id': print('1' if mode == 'nonroot' else '0')
elif name == 'uname':
    print(('Darwin' if mode == 'darwin' else 'Linux') if args == ['-s'] else
          ('riscv64' if mode == 'riscv' else ('aarch64' if mode == 'arm' else 'x86_64')))
elif name == 'sleep': pass
elif name == 'stat':
    print('0:' + oct(pathlib.Path(args[-1]).stat().st_mode & 0o777)[2:])
elif name == 'install':
    if mode == 'install-fail': sys.exit(1)
    assert args[:6] == ['-o', 'root', '-g', 'root', '-m', '0755'], args
    shutil.copyfile(args[-2], args[-1]); pathlib.Path(args[-1]).chmod(0o755)
elif name == 'curl':
    if '--unix-socket' in args:
        assert args[-1] == 'http://localhost/v1.44/info', args
        sys.exit(1 if mode == 'docker-fail' else 0)
    if args[-1] == 'http://127.0.0.1:8080/api/health':
        sys.exit(0 if mode == 'occupied' or ((p/'started').exists() and mode != 'unhealthy') else 7)
    assert args[:9] == ['--disable', '--proto', '=https', '--proto-redir', '=https', '--fail', '--silent', '--show-error', '--location'], args
    if args[-1] == 'https://api.github.com/repos/rhizomatous/flora/releases?per_page=1':
        assert args[-3:-1] == ['-H', 'Accept: application/vnd.github+json'], args
        if mode == 'lookup-fail': sys.exit(22)
        sys.stdout.write((p/'releases.json').read_text())
        sys.exit(0)
    assert args[-2] == '-o', args
    url = args[-3]
    assert url.startswith('https://github.com/rhizomatous/flora/releases/download/' + os.environ['RELEASE_TAG'] + '/'), url
    if mode == 'download-fail': sys.exit(22)
    shutil.copyfile(p/'assets'/url.rsplit('/', 1)[-1], args[-1])
elif name == 'systemctl':
    if args[0] == 'show':
        assert args == ['show', 'flora.service', '--property=LoadState', '--value'], args
        print('loaded' if mode == 'loaded' else 'not-found')
    elif args[0] == 'start':
        d = p/'data/deployment'; d.mkdir()
        code = d/'enrollment-code'; code.write_text('fixture-enrollment-secret')
        code.chmod(0o644 if mode == 'public-code' else 0o600)
        (p/'started').touch()
        if mode == 'start-fail': sys.exit(1)
    elif args[0] == 'is-active': sys.exit(0)
    elif args[0] == 'enable' and mode == 'enable-fail': sys.exit(1)
    elif args[0] == 'daemon-reload' and mode == 'reload-fail': sys.exit(1)
else: raise AssertionError(name)
'''


class InstallerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='flora-installer-test-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        for directory in ('bin', 'assets', 'systemd', 'tmp'):
            (self.root / directory).mkdir()
        for command in ('id', 'uname', 'curl', 'systemctl', 'install', 'stat', 'sleep'):
            path = self.root / 'bin' / command
            path.write_text(FAKE)
            path.chmod(0o755)
        self.source = SOURCE
        for old, new in [('/opt/flora', '/opt'), ('/var/lib/flora', '/data'),
                         ('/etc/systemd/system/flora.service', '/unit'),
                         ('/run/systemd/system', '/systemd'),
                         ('/tmp/flora-install.', '/tmp/flora-install.')]:
            self.source = self.source.replace(old, str(self.root) + new)
        self.assets()
        self.releases()

    def releases(self, version='v1.2.3', draft=False, prerelease=False):
        (self.root / 'releases.json').write_text(json.dumps([
            dict(tag_name=version, draft=draft, prerelease=prerelease,
                 body='Text with "tag_name": "v9.9.9" and a newline\n    "draft": false,',
                 assets=[dict(name='nested', label='tag_name')])], indent=2) + '\n')

    def assets(self, arch='amd64', version='v1.2.3', mismatch=False, legacy=False, tag='v1.2.3'):
        self.tag = tag
        identity = json.dumps(dict(version=version, commit='a' * 40,
                                   agent_image='example/agent@sha256:' + 'b' * 64,
                                   harness_version='1.2.27', os='linux', arch=arch), separators=(',', ':'))
        help_text = '-hostname string' if legacy else '-public-url string'
        binary = f"#!/bin/sh\nif [ \"$1\" = -help ]; then printf '%s\\n' '  {help_text}' >&2; exit 0; fi\n[ \"$1\" = -version ] || exit 1\nprintf '%s\\n' '{identity}'\n".encode()
        archive = self.root / 'assets' / f'flora-{tag}-linux-{arch}.tar.gz'
        with tarfile.open(archive, 'w:gz') as tar:
            for name, content, mode in [('./flora', binary, 0o755),
                                        ('./release.json', (identity + (' ' if mismatch else '') + '\n').encode(), 0o644)]:
                info = tarfile.TarInfo(name); info.size = len(content); info.mode = mode
                tar.addfile(info, io.BytesIO(content))
        (self.root / 'assets/SHA256SUMS').write_text(
            hashlib.sha256(archive.read_bytes()).hexdigest() + '  ' + archive.name + '\n')

    def run_installer(self, mode='', args=None, tty=False):
        env = dict(os.environ, FIXTURE=str(self.root), MODE=mode, RELEASE_TAG=self.tag,
                   PATH=str(self.root / 'bin') + os.pathsep + os.environ['PATH'])
        command = ['sh', '-s', '--'] + (args if args is not None else [
            '--public-url', 'https://flora.example.com:8443', '--version', 'v1.2.3'])
        master = slave = None
        options = dict(start_new_session=True)
        if tty:
            import fcntl
            import termios
            master, slave = pty.openpty()

            def controlling_terminal():
                fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
            options['preexec_fn'] = controlling_terminal
            options['pass_fds'] = (slave,)
        try:
            result = subprocess.run(command, input=self.source, text=True, capture_output=True,
                                    env=env, timeout=20, **options)
            terminal = ''
            if tty and select.select([master], [], [], 1)[0]:
                terminal = os.read(master, 4096).decode()
            self.assertNotIn(SECRET, result.stdout + result.stderr)
            return result, terminal
        finally:
            if master is not None: os.close(master); os.close(slave)

    def calls(self):
        path = self.root / 'calls'
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

    def assert_clean(self):
        self.assertFalse((self.root / 'opt').exists())
        self.assertFalse((self.root / 'unit').exists())
        self.assertEqual(list((self.root / 'tmp').iterdir()), [])

    def test_install_and_repeat(self):
        result, terminal = self.run_installer()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(terminal, '')
        unit = (self.root / 'unit').read_text()
        self.assertIn('-public-url https://flora.example.com:8443 -data-dir ', unit)
        self.assertIn('User=root\nUMask=0077', unit)
        self.assertEqual((self.root / 'data').stat().st_mode & 0o777, 0o700)
        self.assertEqual((self.root / 'opt/flora').stat().st_mode & 0o777, 0o755)
        before = (self.root / 'opt/flora').read_bytes()
        result, _ = self.run_installer()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Refusing to overwrite', result.stderr)
        self.assertEqual(before, (self.root / 'opt/flora').read_bytes())

    def test_arm(self):
        self.assets(arch='arm64')
        result, _ = self.run_installer('arm')
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_default_release(self):
        for prerelease in (False, True):
            with self.subTest(prerelease=prerelease):
                tag = 'v1.2.3-alpha.1' if prerelease else 'v1.2.3'
                self.assets(version=tag, tag=tag)
                self.releases(version=tag, prerelease=prerelease)
                result, _ = self.run_installer(args=['--public-url', 'https://flora.example.com'])
                self.assertEqual(result.returncode, 0, result.stderr)
                import shutil
                for name in ('opt', 'data'):
                    shutil.rmtree(self.root / name)
                (self.root / 'unit').unlink()
                (self.root / 'started').unlink()
        self.assertEqual(sum('https://api.github.com/' in ' '.join(args) for _, args in self.calls()), 2)

    def test_explicit_version_skips_lookup(self):
        result, _ = self.run_installer('lookup-fail')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(any('https://api.github.com/' in ' '.join(args) for _, args in self.calls()))

    def test_bad_release_lookup(self):
        responses = ['[]', '{}', 'not JSON', json.dumps({'message': 'API rate limit exceeded'})]
        for version, draft in [('v1.2.3', True), ('v1.2.3/../../x', False),
                               ('v1.2.3\nmalicious', False), ('v1.2.3;touch x', False)]:
            self.releases(version=version, draft=draft)
            responses.append((self.root / 'releases.json').read_text())
        self.releases()
        responses.append((self.root / 'releases.json').read_text().replace(
            '    "tag_name": "v1.2.3",', '    "tag_name": "v1.2.3",\n    "tag_name": "v1.2.4",'))
        for response in responses:
            with self.subTest(response=response):
                (self.root / 'releases.json').write_text(response)
                result, _ = self.run_installer(args=['--public-url', 'https://flora.example.com'])
                self.assertNotEqual(result.returncode, 0)
                self.assert_clean()
        result, _ = self.run_installer('lookup-fail', args=['--public-url', 'https://flora.example.com'])
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Release lookup failed', result.stderr)
        self.assert_clean()
        self.assertFalse(any('releases/download/' in ' '.join(args) for _, args in self.calls()))

    def test_legacy_release(self):
        self.assets(legacy=True)
        result, _ = self.run_installer()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('predates the installer', result.stderr)
        self.assert_clean()

    @unittest.skipUnless(platform.system() == 'Linux', 'controlling-terminal fixture requires Linux')
    def test_tty(self):
        result, terminal = self.run_installer(tty=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(SECRET, terminal)

    def test_default_https_port(self):
        result, _ = self.run_installer(args=['--version', 'v1.2.3', '--public-url', 'https://flora.example.com:443'])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('-public-url https://flora.example.com -data-dir', (self.root / 'unit').read_text())

    def test_bad_arguments(self):
        urls = ['http://flora.test', 'https://x/y', 'https://x?y', 'https://x#y',
                'https://x%ny', 'https://x$USER', 'https://x\\y', 'https://x\ny',
                'https://x"y', 'https://user@x', 'https://x:1:2', 'https://x:0',
                'https://x:65536', 'https://x:0443', 'https://-x', 'https://x..y',
                'https://x.', 'https://[::1]', 'https://X.test', 'https://x:']
        for url in urls:
            with self.subTest(url=url):
                result, _ = self.run_installer(args=['--version', 'v1.2.3', '--public-url', url])
                self.assertNotEqual(result.returncode, 0)
                self.assert_clean()
        for args in [[], ['--version'], ['--version', ''], ['--public-url'], ['--what'],
                     ['--version', 'v1.2.3/../../x', '--public-url', 'https://x']]:
            self.assertNotEqual(self.run_installer(args=args)[0].returncode, 0)
        self.assertEqual(self.calls(), [])

    def test_preflight(self):
        for mode in ('nonroot', 'darwin', 'riscv', 'loaded', 'docker-fail', 'occupied'):
            with self.subTest(mode=mode):
                self.assertNotEqual(self.run_installer(mode)[0].returncode, 0)
                self.assert_clean()

    def test_existing_paths(self):
        for name in ('opt', 'data', 'unit'):
            with self.subTest(name=name):
                path = self.root / name
                path.symlink_to(self.root / 'absent')
                self.assertNotEqual(self.run_installer()[0].returncode, 0)
                self.assertTrue(path.is_symlink())
                path.unlink()

    def test_download_and_identity_failures(self):
        for mode in ('download-fail', ''):
            if not mode:
                self.assets(mismatch=True)
            self.assertNotEqual(self.run_installer(mode)[0].returncode, 0)
            self.assert_clean()
        self.assets(version='v1.2.4')
        self.assertNotEqual(self.run_installer()[0].returncode, 0)
        self.assert_clean()
        self.assets()
        sums = self.root / 'assets/SHA256SUMS'
        sums.write_text('0' * 64 + '  flora-v1.2.3-linux-amd64.tar.gz\n')
        self.assertNotEqual(self.run_installer()[0].returncode, 0)
        self.assert_clean()

    def test_rollback_keeps_generated_data(self):
        for mode in ('install-fail', 'reload-fail', 'enable-fail', 'start-fail', 'unhealthy', 'public-code'):
            with self.subTest(mode=mode):
                self.assertNotEqual(self.run_installer(mode)[0].returncode, 0)
                self.assert_clean()
                self.assertTrue((self.root / 'data').is_dir())
                code = self.root / 'data/deployment/enrollment-code'
                if code.exists():
                    self.assertEqual(code.read_text(), SECRET)
                import shutil
                shutil.rmtree(self.root / 'data')
                (self.root / 'started').unlink(missing_ok=True)
        self.assertIn(['systemctl', ['stop', 'flora.service']], self.calls())
        self.assertIn(['systemctl', ['disable', 'flora.service']], self.calls())


if __name__ == '__main__':
    unittest.main()
