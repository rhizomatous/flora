#!/usr/bin/env bash
# Run only on a disposable Linux host with a rootful Engine.
set -euo pipefail
[[ $(id -u) == 0 && $(uname -s) == Linux ]]
archive=$(realpath "${1:?release archive required}")
commit=${2:?expected source commit required}
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
tar -xzf "$archive" -C "$stage"
python3 - "$stage" "$archive" "$commit" <<'PY'
import json
from pathlib import Path
import platform
import re
import subprocess
import sys

stage, archive = map(Path, sys.argv[1:3])
identity = json.loads((stage / 'release.json').read_text())
arch = {'x86_64': 'amd64', 'aarch64': 'arm64'}[platform.machine()]
assert identity['os'] == 'linux' and identity['arch'] == arch
assert re.fullmatch(r'v[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?', identity['version'])
assert archive.name == f"flora-{identity['version']}-linux-{arch}.tar.gz"
assert identity['commit'] == sys.argv[3]
assert re.fullmatch(r'[a-z0-9./:_-]+@sha256:[a-f0-9]{64}', identity['agent_image'])
assert identity['harness_version'] == '1.2.27'
assert json.loads(subprocess.check_output([str(stage / 'flora'), '-version'], timeout=15)) == identity
help_result = subprocess.run([str(stage / 'flora'), '-help'], capture_output=True, text=True, timeout=15)
assert '-public-url' in help_result.stderr
assert '-hostname' not in help_result.stderr
assert (stage / 'install.sh').read_bytes() == Path('scripts/install.sh').read_bytes()
PY
python3 "$(dirname "$0")/release-fixture.py" "$stage"
python3 "$(dirname "$0")/installer-smoke.py" "$archive" "$stage"
