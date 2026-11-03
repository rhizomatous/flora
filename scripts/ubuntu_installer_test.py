import io
import json
import os
from pathlib import Path
import sys
import tarfile
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from unittest.mock import Mock
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "packaging"))
import release_download
import ubuntu


class ReleaseTests(unittest.TestCase):
    def test_archive_rejects_paths_links_and_duplicate_names_before_writing(self):
        for names, link in [(["../escape"], False), (["/escape"], False), (["flora", "flora"], False), (["key"], True)]:
            with self.subTest(names=names, link=link), tempfile.TemporaryDirectory() as temporary:
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
            root = Path(temporary)

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
                    release_download.stage(root, "v1.2.3", "amd64")
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


class NetworkTests(unittest.TestCase):
    def test_default_route_selects_host_nic_despite_docker_bridges_and_veths(self):
        interfaces = [
            {"ifname": "lo", "link_type": "loopback", "addr_info": [{"local": "127.0.0.1", "scope": "host"}]},
            {"ifname": "ens5", "link_type": "ether", "addr_info": [{"local": "10.0.0.2", "scope": "global"}]},
            {"ifname": "docker0", "linkinfo": {"info_kind": "bridge"}, "addr_info": [{"local": "172.17.0.1", "scope": "global"}]},
            {"ifname": "br-abcdef", "linkinfo": {"info_kind": "bridge"}, "addr_info": [{"local": "172.30.64.1", "scope": "global"}]},
            {"ifname": "custom-bridge", "linkinfo": {"info_kind": "bridge"}, "addr_info": [{"local": "10.99.0.1", "scope": "global"}]},
            {"ifname": "custom-peer", "linkinfo": {"info_kind": "veth"}, "addr_info": [{"local": "10.98.0.1", "scope": "global"}]},
        ]

        def ip(*args):
            if "address" in args:
                return json.dumps(interfaces)
            if "default" in args:
                return json.dumps([{"dst": "default", "gateway": "10.0.0.1", "dev": "ens5"}])
            return json.dumps([{"dst": "1.1.1.1", "gateway": "10.0.0.1", "dev": "ens5", "prefsrc": "10.0.0.2"}])

        with patch.object(ubuntu, "run", side_effect=ip), patch.object(ubuntu.socket, "getaddrinfo", return_value=[(None, None, None, None, ("203.0.113.2", 443))]):
            self.assertEqual(ubuntu.addresses(None, "flora.example.com"), ["10.0.0.2"])
            for invalid in ("203.0.113.2", "0.0.0.0", "172.17.0.1", "10.99.0.1", "10.98.0.1"):
                with self.assertRaisesRegex(ValueError, "assigned local NIC"):
                    ubuntu.addresses([invalid], "flora.example.com")

    def test_resource_failures_precede_release_download_and_execution(self):
        args = SimpleNamespace(experimental=True, hostname="flora.example.com", version="v1.2.3")
        installation = SimpleNamespace(state={}, verify_files=Mock())
        for disk, filesystem, memory, error in ((0, "ext4", 4 * 1024**3, "free local disk"),
                                                (20 * 1024**3, "nfs", 4 * 1024**3, "local ext4"),
                                                (20 * 1024**3, "ext4", 1024**3, "host memory")):
            with patch.object(ubuntu.shutil, "disk_usage", return_value=SimpleNamespace(free=disk)), patch.object(ubuntu, "run", return_value=filesystem), patch.object(ubuntu.os, "sysconf", side_effect=lambda key: memory if key == "SC_PHYS_PAGES" else 1), patch.object(ubuntu, "stage") as stage:
                with self.assertRaisesRegex(ValueError, error):
                    ubuntu.install(args, "amd64", installation)
                stage.assert_not_called()

    def test_multiple_real_default_sources_require_explicit_binding(self):
        nics = [{"ifname": name, "addr_info": [{"local": address, "scope": "global"}]} for name, address in (("ens5", "10.0.0.2"), ("ens6", "10.1.0.2"))]

        def ip(*args):
            if "address" in args:
                return json.dumps(nics)
            if "default" in args:
                return json.dumps([{"dev": nic["ifname"], "dst": "default"} for nic in nics])
            return json.dumps([{"dev": args[-1], "prefsrc": next(nic["addr_info"][0]["local"] for nic in nics if nic["ifname"] == args[-1])}])

        with patch.object(ubuntu, "run", side_effect=ip), patch.object(ubuntu.socket, "getaddrinfo", return_value=[(None, None, None, None, ("203.0.113.2", 443))]):
            with self.assertRaisesRegex(ValueError, "ambiguous external interface"):
                ubuntu.addresses(None, "flora.example.com")
            self.assertEqual(ubuntu.addresses(["10.1.0.2"], "flora.example.com"), ["10.1.0.2"])

    def test_unsupported_hosts_fail_before_installer_state_is_created(self):
        with patch.object(ubuntu.os, "geteuid", return_value=0), patch.object(ubuntu.platform, "system", return_value="Linux"), patch.object(ubuntu.platform, "freedesktop_os_release", return_value={"ID": "ubuntu", "VERSION_ID": "22.04"}), patch.object(ubuntu, "Installation") as installation, patch.object(sys, "argv", ["ubuntu.py", "install", "--version", "v1.2.3", "--experimental"]):
            with self.assertRaisesRegex(ValueError, "24.04"):
                ubuntu.main()
            installation.assert_not_called()

    def test_uninstall_refuses_running_chats_without_stopping_services(self):
        files = {"/etc/systemd/system/" + name: {} for name in ("flora-proxy.service", "flora.service", "flora-renew.timer", "flora-network.service")}
        installation = SimpleNamespace(state={"version": "v1.2.3", "files": files}, verify_files=Mock())
        with patch.object(ubuntu.Path, "is_file", return_value=True), patch.object(ubuntu, "run", side_effect=lambda *args: "/etc/systemd/system/" + args[2]) as command, patch.object(ubuntu, "docker", return_value="running-chat-id"):
            with self.assertRaisesRegex(ValueError, "running chats"):
                ubuntu.uninstall(SimpleNamespace(yes=True), installation)
            self.assertTrue(all(call.args[:2] == ("systemctl", "show") for call in command.call_args_list))

    def test_routes_vpn_and_docker_subnets_are_not_reused(self):
        subnet, gateway = ubuntu.choose_subnet([{"dst": "default"}, {"dst": "172.30.64.9/32"}],
                                               [{"IPAM": {"Config": None}}, {"IPAM": {"Config": [{"Subnet": "172.30.65.0/24"}]}}])
        self.assertEqual((subnet, gateway), ("172.30.66.0/24", "172.30.66.1"))
        with self.assertRaisesRegex(ValueError, "VPN overlap"):
            ubuntu.choose_subnet([{"dst": "172.30.0.0/16"}], [])

    def test_hostname_rejects_injection_and_private_browser_modes(self):
        self.assertEqual(ubuntu.hostname("Flora.Example.COM"), "flora.example.com")
        for value in ("$(touch /tmp/no)", "example.com\nfoo", "https://example.com", "*.example.com", "foo.local", "foo.internal", "foo.test", "example.com:443", "-bad.example.com"):
            with self.assertRaises(ValueError):
                ubuntu.hostname(value)

    def test_aaaa_without_ipv6_path_and_unassigned_nat_ip_fail(self):
        interfaces = [{"ifname": "ens5", "link_type": "ether", "addr_info": [{"local": "10.0.0.2", "scope": "global"}]}]
        dns = [(None, None, None, None, ("2001:db8::2", 443))]
        with patch.object(ubuntu, "run", return_value=json.dumps(interfaces)), patch.object(ubuntu.socket, "getaddrinfo", return_value=dns):
            with self.assertRaisesRegex(ValueError, "AAAA"):
                ubuntu.addresses(["10.0.0.2"], "flora.example.com")
            with self.assertRaisesRegex(ValueError, "assigned local NIC"):
                ubuntu.addresses(["203.0.113.2"], "flora.example.com")


@unittest.skipUnless(os.geteuid() == 0, "ownership tests run as root only inside the disposable fixture container")
class OwnershipTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.state_patch = patch.object(ubuntu, "STATE", self.root / "state")
        self.state_patch.start()
        self.installation = ubuntu.Installation()

    def tearDown(self):
        self.installation.lock.close()
        self.state_patch.stop()
        self.temporary.cleanup()

    def test_foreign_files_symlinks_and_permission_drift_are_preserved(self):
        foreign = self.root / "foreign"
        foreign.write_text("foreign content")
        with self.assertRaisesRegex(ValueError, "foreign"):
            self.installation.file(foreign, b"replacement")
        self.assertEqual(foreign.read_text(), "foreign content")
        link = self.root / "link"
        link.symlink_to(foreign)
        with self.assertRaises(ValueError):
            self.installation.file(link, b"replacement")
        target = self.root / "owned"
        self.installation.file(target, b"original", 0o640)
        target.chmod(0o644)
        with self.assertRaisesRegex(ValueError, "drift"):
            self.installation.verify_files()

    def test_missing_state_commands_fail_without_creating_an_installation(self):
        self.installation.lock.close()
        missing = self.root / "missing-state"
        with patch.object(ubuntu, "STATE", missing), patch.object(ubuntu, "platform_check", return_value="amd64"):
            for command in ("renew", "enrollment-code"):
                with patch.object(sys, "argv", ["ubuntu.py", command]):
                    with self.assertRaisesRegex(ValueError, "no recorded installer state"):
                        ubuntu.main()
                self.assertFalse(missing.exists())

    def test_probe_cleanup_requires_both_exact_name_and_owner_label(self):
        name = ubuntu.probe_name(self.installation)
        for actual_name, owner in ((name, "foreign"), ("foreign-name", self.installation.state["owner"])):
            calls = []

            def docker(*args):
                calls.append(args)
                return "candidate" if args[0] == "ps" else json.dumps([{"Id": "candidate", "Name": "/" + actual_name, "Config": {"Labels": {"flora.installer": owner}}}])

            with patch.object(ubuntu, "docker", side_effect=docker):
                with self.assertRaisesRegex(ValueError, "foreign container"):
                    ubuntu.cleanup_probe(self.installation)
            self.assertFalse(any("rm" in call for call in calls))

    def test_interrupted_atomic_private_key_change_recovers_one_pem(self):
        target = self.root / "transport.pem"
        self.installation.file(target, b"old certificate and key", 0o640)
        original = ubuntu.atomic

        def fail_target(path, *args, **kwargs):
            if path == target:
                raise OSError("fixture power loss")
            return original(path, *args, **kwargs)

        with patch.object(ubuntu, "atomic", side_effect=fail_target):
            with self.assertRaises(OSError):
                self.installation.replace_file(str(target), b"new certificate and key")
        self.installation.lock.close()
        self.installation = ubuntu.Installation()
        self.installation.verify_files()
        self.assertEqual(target.read_bytes(), b"new certificate and key")
        self.assertEqual(target.stat().st_mode & 0o777, 0o640)
        self.assertNotIn("pending", self.installation.state)

    def test_foreign_network_is_not_adopted_and_missing_recorded_network_is_not_recreated(self):
        calls = []

        def docker(*args):
            calls.append(args)
            if args[:2] == ("network", "ls"):
                return "foreign-id"
            return json.dumps([{"Id": "foreign-id", "Name": ubuntu.NETWORK_NAME, "Labels": {}}])

        with patch.object(ubuntu, "docker", side_effect=docker):
            with self.assertRaisesRegex(ValueError, "foreign"):
                self.installation.network()
        self.assertFalse(any("create" in call or "rm" in call for call in calls))
        self.installation.state["network"] = {"id": "lost-id"}
        with patch.object(ubuntu, "docker", side_effect=RuntimeError("missing recorded network")) as command:
            with self.assertRaises(RuntimeError):
                self.installation.network()
            self.assertEqual(command.call_count, 1)

    def test_renewal_keeps_ca_and_replaces_leaf_and_key_atomically(self):
        directory = self.root / "transport"
        directory.mkdir(mode=0o700)
        ubuntu.pki(self.installation, 0, directory=directory)
        before = (directory / "transport.pem").read_bytes()
        ca = (ubuntu.STATE / "pki/ca.key").read_bytes()
        original_run = ubuntu.run
        original_subprocess = subprocess.run
        restarts = []

        def run(*args, **kwargs):
            if args[0] == "systemctl":
                restarts.append(args)
                return ""
            return original_run(*args, **kwargs)

        def expired(args, **kwargs):
            if "-checkend" in args and str(directory / "transport.pem") in args:
                return subprocess.CompletedProcess(args, 1)
            return original_subprocess(args, **kwargs)

        with patch.object(ubuntu, "run", side_effect=run), patch.object(ubuntu.subprocess, "run", side_effect=expired):
            ubuntu.pki(self.installation, 0, renew=True, directory=directory)
        self.assertNotEqual(before, (directory / "transport.pem").read_bytes())
        self.assertEqual(ca, (ubuntu.STATE / "pki/ca.key").read_bytes())
        self.assertEqual((ubuntu.STATE / "pki/ca.key").stat().st_mode & 0o777, 0o600)
        self.assertEqual((directory / "transport.pem").stat().st_mode & 0o777, 0o640)
        original_run("openssl", "verify", "-CAfile", str(directory / "transport-ca.crt"), str(directory / "transport.pem"))
        original_run("openssl", "x509", "-in", str(directory / "transport.pem"), "-noout", "-checkhost", ubuntu.ALIAS)
        self.assertEqual(restarts, [("systemctl", "try-restart", "flora.service")])
        self.installation.verify_files()


if __name__ == "__main__":
    unittest.main()
