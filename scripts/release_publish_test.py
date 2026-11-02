import os
from pathlib import Path
import subprocess
import tempfile
import unittest


class ReleasePublicationTest(unittest.TestCase):
    def publish(self, tag):
        script = Path(__file__).with_name('publish-release.sh').resolve()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            gh = root / 'gh'
            gh.write_text('#!/bin/sh\nprintf "%s\\n" "$@"\n')
            gh.chmod(0o700)
            (root / 'dist').mkdir()
            for asset in ('amd64.tar.gz', 'arm64.tar.gz', 'SHA256SUMS'):
                (root / 'dist' / asset).touch()
            env = {'PATH': directory + os.pathsep + os.defpath,
                   'GITHUB_REF_NAME': tag, 'GITHUB_REPOSITORY': 'owner/repo',
                   'SOURCE_COMMIT': 'fixture-source', 'RELEASE_IMAGE': 'fixture-image'}
            return subprocess.run(['bash', str(script)], cwd=root, env=env,
                                  text=True, capture_output=True)

    def test_prereleases_cannot_be_latest(self):
        for tag in ('v0.0.1-alpha.1', 'v1.0.0-rc.2'):
            result = self.publish(tag)
            self.assertEqual(result.returncode, 0, result.stderr)
            args = result.stdout.splitlines()
            self.assertEqual(args[:3], ['release', 'create', tag])
            for expected in ('--prerelease', '--latest=false', '--verify-tag',
                             'dist/amd64.tar.gz', 'dist/arm64.tar.gz', 'dist/SHA256SUMS'):
                self.assertIn(expected, args)

    def test_stable_release_keeps_normal_latest_behavior(self):
        result = self.publish('v1.2.3')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn('--prerelease', result.stdout)
        self.assertNotIn('--latest', result.stdout)

    def test_invalid_tag_never_calls_gh(self):
        result = self.publish('latest')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, '')
