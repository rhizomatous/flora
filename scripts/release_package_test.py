import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import unittest


class ReleasePackageTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        (self.root / 'packaging').mkdir()
        for name in ('packaging/flora.service', 'LICENSE', 'README.md', 'INSTALL.md'):
            (self.root / name).write_text('fixture\n')
        (self.root / '.gitignore').write_text('/dist/\n/tools/\n')
        for args in (('init', '-q'), ('add', '.'),
                     ('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com',
                      'commit', '-qm', 'fixture')):
            subprocess.run(['git', *args], cwd=self.root, check=True, capture_output=True)
        tools = self.root / 'tools'
        tools.mkdir()
        compiler = tools / 'go'
        compiler.write_text('''#!/bin/sh
while [ "$#" -gt 0 ]; do
  if [ "$1" = -o ]; then
    printf '%s' "$GOARCH" > "$2"
    exit 0
  fi
  shift
done
exit 1
''')
        compiler.chmod(0o700)
        self.env = dict(os.environ, PATH=str(tools) + os.pathsep + os.environ['PATH'])
        self.script = Path(__file__).with_name('package-release.sh').resolve()
        self.image = 'ghcr.io/fixture/agent@sha256:' + 'a' * 64

    def package(self, *args):
        return subprocess.run(['bash', str(self.script), 'v1.2.3', self.image, *args],
                              cwd=self.root, env=self.env, capture_output=True, text=True)

    def check_archives(self, architectures):
        checksums = (self.root / 'dist/SHA256SUMS').read_text().splitlines()
        self.assertEqual(len(checksums), len(architectures))
        for arch, line in zip(architectures, checksums):
            name = f'flora-v1.2.3-linux-{arch}.tar.gz'
            archive = self.root / 'dist' / name
            self.assertEqual(line, hashlib.sha256(archive.read_bytes()).hexdigest() + '  ' + name)
            with tarfile.open(archive) as contents:
                self.assertEqual(contents.extractfile('./flora').read().decode(), arch)
                metadata = json.load(contents.extractfile('./release.json'))
                self.assertEqual(metadata['arch'], arch)
                self.assertEqual(metadata['agent_image'], self.image)
                self.assertEqual(metadata['version'], 'v1.2.3')

    def test_default_packages_both_architectures(self):
        result = self.package()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.check_archives(['amd64', 'arm64'])

    def test_native_package_excludes_stale_other_archive(self):
        for arch in ('amd64', 'arm64'):
            with self.subTest(arch=arch):
                dist = self.root / 'dist'
                shutil.rmtree(dist, ignore_errors=True)
                dist.mkdir()
                other = 'arm64' if arch == 'amd64' else 'amd64'
                stale = dist / f'flora-v1.2.3-linux-{other}.tar.gz'
                stale.write_text('stale archive')
                result = self.package(arch)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.check_archives([arch])
                self.assertEqual(stale.read_text(), 'stale archive')

    def test_invalid_architecture_or_extra_arguments_produce_no_archives(self):
        for args in (('',), ('386',), ('amd64 arm64',), ('amd64', 'arm64')):
            with self.subTest(args=args):
                result = self.package(*args)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse((self.root / 'dist').exists())
