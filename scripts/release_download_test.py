import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "packaging"))
import release_download


class ReleaseTests(unittest.TestCase):
    def test_archive_rejects_paths_links_and_duplicate_names_before_writing(self):
        for names, link in [(["../escape"], False), (["/escape"], False), (["flora", "flora"], False), (["key"], True)]:
            with self.subTest(names=names), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                archive = root / "package.tar.gz"
                with tarfile.open(archive, "w:gz") as tar:
                    for name in names:
                        member = tarfile.TarInfo(name)
                        if link:
                            member.type = tarfile.SYMTYPE
                            member.linkname = "/etc/passwd"
                            tar.addfile(member)
                        else:
                            member.size = 4
                            tar.addfile(member, io.BytesIO(b"data"))
                with self.assertRaises(ValueError):
                    release_download.extract(archive, root / "package")
                self.assertEqual(list((root / "package").iterdir()), [])

    def test_bad_checksum_never_extracts_or_executes(self):
        with tempfile.TemporaryDirectory() as temporary:
            def fetch(url, target, _limit):
                self.assertTrue(url.startswith("https://"))
                if target.name == "release-api.json":
                    target.write_text(json.dumps({"tag_name": "v1.2.3", "draft": False, "prerelease": False}))
                elif target.name == "ref.json":
                    target.write_text(json.dumps({"object": {"type": "commit", "sha": "a" * 40}}))
                elif target.name == "SHA256SUMS":
                    target.write_text("0" * 64 + "  flora-v1.2.3-linux-amd64.tar.gz\n")
                else:
                    target.write_bytes(b"corrupted archive")
            with patch.object(release_download, "fetch", side_effect=fetch), patch.object(release_download, "extract") as extract, patch.object(release_download.subprocess, "check_output") as execute:
                with self.assertRaisesRegex(ValueError, "checksum mismatch"):
                    release_download.stage(Path(temporary), "v1.2.3", "amd64")
                extract.assert_not_called()
                execute.assert_not_called()

    def test_prerelease_and_architecture_fail_before_download(self):
        with patch.object(release_download, "fetch") as fetch:
            for version, arch in [("v1.2.3-alpha.1", "amd64"), ("latest", "arm64"), ("v1.2.3", "386"), ("v1.2.3/../../main", "amd64")]:
                with self.assertRaises(ValueError):
                    release_download.stage(Path("unused"), version, arch)
            fetch.assert_not_called()

    def test_checksum_requires_exact_unambiguous_archive(self):
        checksum = "a" * 64 + "  flora-v1.2.3-linux-arm64.tar.gz\n"
        self.assertEqual(release_download.expected_checksum(checksum, "flora-v1.2.3-linux-arm64.tar.gz"), "a" * 64)
        for text in (checksum + checksum, "bad checksum", checksum.replace("arm64", "amd64")):
            with self.assertRaises(ValueError):
                release_download.expected_checksum(text, "flora-v1.2.3-linux-arm64.tar.gz")

    def test_wrong_source_or_platform_never_executes_binary(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            identity = {"version": "v1.2.3", "commit": "a" * 40, "os": "linux", "arch": "amd64"}
            for change in ({"commit": "b" * 40}, {"arch": "arm64"}, {"os": "darwin"}):
                (root / "release.json").write_text(json.dumps({**identity, **change}))
                with patch.object(release_download.subprocess, "check_output") as execute:
                    with self.assertRaises(ValueError):
                        release_download.verify_identity(root, "v1.2.3", "a" * 40, "amd64")
                    execute.assert_not_called()

    def test_placement_is_atomic_same_version_only_and_no_service_changes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            package = root / "package"
            package.mkdir()
            (package / "flora").write_bytes(b"verified binary")
            output = root / "flora"
            identity = {"version": "v1.2.3", "commit": "a" * 40}
            with patch.object(sys, "argv", ["release_download.py", "v1.2.3", "--output", str(output)]), patch.object(release_download.platform, "system", return_value="Linux"), patch.object(release_download.platform, "machine", return_value="aarch64"), patch.object(release_download, "stage", return_value=(package, identity)), patch.object(release_download.subprocess, "run") as run:
                release_download.main()
                release_download.main()
                self.assertEqual(output.read_bytes(), b"verified binary")
                self.assertEqual(output.stat().st_mode & 0o777, 0o755)
                output.unlink()
                output.write_bytes(b"foreign binary")
                with self.assertRaisesRegex(ValueError, "different contents"):
                    release_download.main()
                self.assertEqual(output.read_bytes(), b"foreign binary")
                output.unlink()
                output.symlink_to(package / "flora")
                with self.assertRaises(ValueError):
                    release_download.main()
                run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
