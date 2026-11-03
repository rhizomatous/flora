#!/bin/sh
# This script and its selected release's Python helpers execute as root.
set -eu
umask 077
[ "$(id -u)" = 0 ] || { printf '%s\n' 'Run the reviewed installer as root.' >&2; exit 1; }
[ "$(uname -s)" = Linux ] || { printf '%s\n' 'Ubuntu 24.04 Linux is required.' >&2; exit 1; }
version=${1:?usage: bootstrap.sh VERSION [HOSTNAME] [installer options]}
case "${2-}" in
  --*|'') hostname=; shift ;;
  *) hostname=$2; shift 2 ;;
esac
case "$version" in
  v[0-9]*.[0-9]*.[0-9]*) ;;
  *) printf '%s\n' 'Select an explicit published release version.' >&2; exit 1 ;;
esac
case "$version" in *[!a-zA-Z0-9.-]*) exit 1 ;; esac
command -v python3 >/dev/null
command -v curl >/dev/null
# Fail unsupported platforms before even creating a staging directory.
python3 -c 'import platform, pathlib; r=platform.freedesktop_os_release(); assert r.get("ID")=="ubuntu" and r.get("VERSION_ID")=="24.04" and platform.machine() in ("x86_64","aarch64") and pathlib.Path("/run/systemd/system").is_dir(), "Ubuntu 24.04 amd64/arm64 with systemd is required"'
stage=$(mktemp -d /tmp/flora-bootstrap.XXXXXXXX)
trap 'rm -rf "$stage"' EXIT HUP INT TERM
for file in ubuntu.py release_download.py; do
  curl --proto '=https' --proto-redir '=https' --fail --silent --show-error --location \
    "https://raw.githubusercontent.com/rhizomatous/flora/$version/packaging/$file" -o "$stage/$file"
done
if [ -n "$hostname" ]; then
  python3 "$stage/ubuntu.py" install --version "$version" --hostname "$hostname" "$@"
else
  python3 "$stage/ubuntu.py" install --version "$version" "$@"
fi
