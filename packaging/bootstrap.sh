#!/bin/sh
# Download verification only. No packages, accounts or services are changed.
set -eu
umask 077
[ "$(uname -s)" = Linux ] || { printf '%s\n' 'Linux amd64/arm64 is required.' >&2; exit 1; }
version=${1:?usage: bootstrap.sh VERSION [--allow-prerelease] [--output PATH]}
shift
case "$version" in
  v[0-9]*.[0-9]*.[0-9]*) ;;
  *) printf '%s\n' 'Select an explicit published release version.' >&2; exit 1 ;;
esac
case "$version" in *[!a-zA-Z0-9.-]*) exit 1 ;; esac
command -v python3 >/dev/null
command -v curl >/dev/null
stage=$(mktemp -d /tmp/flora-bootstrap.XXXXXXXX)
trap 'rm -rf "$stage"' EXIT HUP INT TERM
curl --proto '=https' --proto-redir '=https' --fail --silent --show-error --location \
  "https://raw.githubusercontent.com/rhizomatous/flora/$version/packaging/release_download.py" -o "$stage/release_download.py"
python3 "$stage/release_download.py" "$version" "$@"
