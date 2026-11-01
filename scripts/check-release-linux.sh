#!/usr/bin/env bash
# Run only on a disposable Linux host. The installer uses its real absolute paths.
set -euo pipefail
[[ $(id -u) == 0 && $(uname -s) == Linux ]]
[[ ! -e /opt/flora/flora && ! -e /var/lib/flora ]]
archive=$(realpath "${1:?release archive required}")
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
tar -xzf "$archive" -C "$stage"
sh "$stage/install.sh"
python3 "$(dirname "$0")/release-fixture.py"
