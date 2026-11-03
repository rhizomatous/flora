"""Stage an explicit GitHub release without trusting archive paths or file modes."""
import hashlib
import argparse
import json
import os
import platform
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tarfile
import tempfile
import urllib.parse
import urllib.request

REPOSITORY = "https://github.com/rhizomatous/flora"
API = "https://api.github.com/repos/rhizomatous/flora"
VERSION = re.compile(r"v[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?\Z")


class HTTPSOnly(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urllib.parse.urlsplit(newurl).scheme != "https":
            raise ValueError("release download redirected away from HTTPS")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch(url, destination, limit):
    if urllib.parse.urlsplit(url).scheme != "https":
        raise ValueError("release downloads require HTTPS")
    request = urllib.request.Request(url, headers={"User-Agent": "flora-installer"})
    with urllib.request.build_opener(HTTPSOnly()).open(request, timeout=60) as response, destination.open("xb") as out:
        total = 0
        while block := response.read(1024 * 1024):
            total += len(block)
            if total > limit:
                raise ValueError("release download exceeds size limit")
            out.write(block)


def expected_checksum(text, archive):
    matches = []
    for line in text.splitlines():
        match = re.fullmatch(r"([a-f0-9]{64}) [ *]([^/\s]+)", line)
        if not match:
            raise ValueError("malformed SHA256SUMS")
        if match[2] == archive:
            matches.append(match[1])
    if len(matches) != 1:
        raise ValueError("SHA256SUMS must contain the selected archive exactly once")
    return matches[0]


def extract(archive, destination):
    # Reject links, devices, duplicate names and path traversal before writing.
    # The destination must be a new private directory, never an installed tree.
    destination.mkdir(mode=0o700)
    with tarfile.open(archive, "r:gz") as tar:
        members = tar.getmembers()
        seen = set()
        total = 0
        for member in members:
            path = PurePosixPath(member.name)
            if member.name in (".", "./") and member.isdir():
                continue
            if path.is_absolute() or ".." in path.parts or not path.parts or str(path) in seen:
                raise ValueError("unsafe or duplicate release archive path")
            seen.add(str(path))
            if not (member.isfile() or member.isdir()) or member.size < 0:
                raise ValueError("release archives may contain only regular files and directories")
            total += member.size
            if total > 256 * 1024 * 1024 or len(members) > 1000:
                raise ValueError("release archive exceeds extraction limits")
        for member in members:
            path = PurePosixPath(member.name)
            if str(path) == ".":
                continue
            target = destination.joinpath(*path.parts)
            if member.isdir():
                target.mkdir(mode=0o700, parents=True, exist_ok=True)
            else:
                target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                with tar.extractfile(member) as source, target.open("xb") as out:
                    shutil.copyfileobj(source, out)
                target.chmod(0o700 if str(path) == "flora" else 0o600)


def verify_identity(package, version, commit, arch):
    identity = json.loads((package / "release.json").read_text())
    if identity.get("version") != version or identity.get("commit") != commit:
        raise ValueError("release metadata does not match the selected version/source")
    if identity.get("os") != "linux" or identity.get("arch") != arch:
        raise ValueError("release lacks the expected Linux architecture identity")
    if not re.fullmatch(r"[a-z0-9./:_-]+@sha256:[a-f0-9]{64}", identity.get("agent_image", "")):
        raise ValueError("release does not record a digest-pinned agent image")
    actual = json.loads(subprocess.check_output([str(package / "flora"), "-version"], timeout=15))
    if actual != identity:
        raise ValueError("binary identity differs from release.json")
    help_result = subprocess.run([str(package / "flora"), "-help"], capture_output=True, text=True, timeout=15)
    if "-hostname" not in help_result.stderr:
        raise ValueError("selected release does not support built-in HTTPS; use its manual installation instructions")
    return identity


def stage(root, version, arch, allow_prerelease=False):
    if not VERSION.fullmatch(version) or arch not in ("amd64", "arm64"):
        raise ValueError("select an explicit release version and supported architecture")
    if "-" in version and not allow_prerelease:
        raise ValueError("prereleases require --allow-prerelease")
    archive = f"flora-{version}-linux-{arch}.tar.gz"
    tag = urllib.parse.quote(version, safe="")
    fetch(f"{API}/releases/tags/{tag}", root / "release-api.json", 1024 * 1024)
    release = json.loads((root / "release-api.json").read_text())
    if release.get("draft") or release.get("tag_name") != version or (release.get("prerelease") and not allow_prerelease):
        raise ValueError("selected release is not an authorized public release")
    fetch(f"{API}/git/ref/tags/{tag}", root / "ref.json", 1024 * 1024)
    ref = json.loads((root / "ref.json").read_text())["object"]
    for depth in range(8):
        if ref["type"] == "commit":
            break
        if ref["type"] != "tag" or not re.fullmatch(r"[a-f0-9]{40}", ref["sha"]):
            raise ValueError("unexpected release tag object")
        target = root / f"tag-{depth}.json"
        fetch(f"{API}/git/tags/{ref['sha']}", target, 1024 * 1024)
        ref = json.loads(target.read_text())["object"]
    if ref["type"] != "commit" or not re.fullmatch(r"[a-f0-9]{40}", ref["sha"]):
        raise ValueError("cannot resolve the release source commit")
    base = f"{REPOSITORY}/releases/download/{tag}"
    fetch(f"{base}/SHA256SUMS", root / "SHA256SUMS", 1024 * 1024)
    expected = expected_checksum((root / "SHA256SUMS").read_text(), archive)
    fetch(f"{base}/{archive}", root / archive, 128 * 1024 * 1024)
    with (root / archive).open("rb") as source:
        actual = hashlib.file_digest(source, "sha256").hexdigest()
    if actual != expected:
        raise ValueError("release archive checksum mismatch; nothing has been extracted or executed")
    package = root / "package"
    extract(root / archive, package)
    identity = verify_identity(package, version, ref["sha"], arch)
    return package, identity


def main():
    parser = argparse.ArgumentParser(description="Verify a Linux release and place only its Flora binary. Docker must already be installed.")
    parser.add_argument("version")
    parser.add_argument("--allow-prerelease", action="store_true")
    parser.add_argument("--output", type=Path, default=Path("flora"))
    args = parser.parse_args()
    arch = {"x86_64": "amd64", "aarch64": "arm64"}.get(platform.machine())
    if platform.system() != "Linux" or not arch:
        raise ValueError("Linux amd64/arm64 is required")
    with tempfile.TemporaryDirectory(prefix=".flora-download-", dir=args.output.absolute().parent) as temporary:
        package, identity = stage(Path(temporary), args.version, arch, args.allow_prerelease)
        binary = package / "flora"
        if args.output.exists() or args.output.is_symlink():
            if args.output.is_symlink() or not args.output.is_file() or args.output.read_bytes() != binary.read_bytes():
                raise ValueError("output exists with different contents; upgrades require an explicit backup and replacement")
        else:
            binary.chmod(0o755)
            os.link(binary, args.output)
        print(f"Verified {identity['version']} ({identity['commit']}, linux/{arch}). Run: sudo {args.output.absolute()} -hostname flora.example.com")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        raise SystemExit(f"Flora download stopped: {error}")
