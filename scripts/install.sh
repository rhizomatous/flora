#!/bin/sh
# Install a fresh release on a Linux systemd host with local rootful Docker.
set -eu
export LC_ALL=C
umask 077
die() { printf '%s\n' "flora installer: $*" >&2; exit 1; }
version='' public_url=''
while [ "$#" -gt 0 ]; do
    case $1 in
        --version) [ "$#" -ge 2 ] && [ -n "$2" ] || die 'Missing --version value'; version=$2; shift 2 ;;
        --public-url) [ "$#" -ge 2 ] || die 'Missing --public-url value'; public_url=$2; shift 2 ;;
        *) die 'Usage: sh install.sh --public-url https://HOST[:PORT] [--version vX.Y.Z]' ;;
    esac
done
# Only release-tag characters and literal DNS origins can enter URLs or the unit.
validate_version() {
    case $version in v[0-9]*.[0-9]*.[0-9]*) ;; *) die 'Invalid release tag' ;; esac
    case $version in *[!a-zA-Z0-9.-]*) die 'Invalid release tag' ;; esac
}
[ -z "$version" ] || validate_version
case $public_url in https://*) authority=${public_url#https://} ;; *) die 'An HTTPS origin is required' ;; esac
host=${authority%%:*}
case $host in ''|*[!a-z0-9.-]*) die 'Use a lowercase DNS hostname without a path' ;; esac
[ "${#host}" -le 253 ] || die 'Hostname is too long'
set -f
old_ifs=$IFS; IFS=.
# Split DNS labels deliberately; pathname expansion is disabled above.
# shellcheck disable=SC2086
set -- $host
IFS=$old_ifs
for label do
    case $label in ''|-*|*-) die 'Invalid hostname label' ;; esac
    [ "${#label}" -le 63 ] || die 'Hostname label is too long'
done
case $host in *.) die 'Trailing hostname dot is not supported' ;; esac
if [ "$authority" != "$host" ]; then
    port=${authority#*:}
    case $port in ''|0*|*[!0-9]*) die 'Invalid HTTPS port' ;; esac
    [ "${#port}" -le 5 ] || die 'Invalid HTTPS port'
    [ "$port" -le 65535 ] || die 'Invalid HTTPS port'
    [ "$port" != 443 ] || public_url=https://$host
fi
[ "$(id -u)" = 0 ] || die 'Run as root (sudo sh -s -- ...)'
[ "$(uname -s)" = Linux ] || die 'Only Linux is supported'
case $(uname -m) in x86_64) arch=amd64 ;; aarch64|arm64) arch=arm64 ;; *) die 'Only amd64 and arm64 are supported' ;; esac
for command in curl tar sha256sum systemctl mktemp cmp stat install mkdir rm rmdir cat sleep sed; do
    command -v "$command" >/dev/null 2>&1 || die "Required command is missing: $command"
done
[ -d /run/systemd/system ] || die 'A running systemd host is required'
unit=/etc/systemd/system/flora.service
for path in /opt/flora /var/lib/flora "$unit"; do
    if [ -e "$path" ] || [ -L "$path" ]; then
        die "Existing installation path: $path. Refusing to overwrite or upgrade."
    fi
done
[ "$(systemctl show flora.service --property=LoadState --value)" = not-found ] || die 'An existing flora.service is registered'
curl --disable --noproxy '*' --fail --silent --show-error --max-time 10 --unix-socket /var/run/docker.sock \
    http://localhost/v1.44/info >/dev/null || die 'Local Docker Engine with API 1.44 is required'
if curl --disable --noproxy '*' --fail --silent --max-time 2 http://127.0.0.1:8080/api/health >/dev/null 2>&1; then
    die 'A service already answers on 127.0.0.1:8080'
fi
work=$(mktemp -d /tmp/flora-install.XXXXXXXX)
own_opt=0 own_unit=0 started=0 enabled=0 success=0
cleanup() {
    result=$?
    trap - 0
    if [ "$success" = 0 ]; then
        [ "$started" = 0 ] || systemctl stop flora.service >/dev/null 2>&1 || :
        [ "$enabled" = 0 ] || systemctl disable flora.service >/dev/null 2>&1 || :
        if [ "$own_unit" = 1 ]; then
            rm -f "$unit"
            systemctl daemon-reload >/dev/null 2>&1 || :
        fi
        if [ "$own_opt" = 1 ]; then rm -f /opt/flora/flora; rmdir /opt/flora || :; fi
        printf '%s\n' 'Installation failed. Any generated /var/lib/flora data and Docker state were retained.' >&2
    fi
    rm -rf "$work"
    exit "$result"
}
trap cleanup 0
trap 'exit 1' HUP INT TERM
if [ -z "$version" ]; then
    # Anonymous release listings exclude drafts and include prereleases, unlike /latest.
    metadata=$(curl --disable --proto '=https' --proto-redir '=https' --fail --silent --show-error --location \
        --connect-timeout 15 --max-time 60 -H 'Accept: application/vnd.github+json' \
        'https://api.github.com/repos/rhizomatous/flora/releases?per_page=1') || die 'Release lookup failed; retry or use --version'
    # Read only the top-level release fields in GitHub's formatted JSON. Reject unexpected responses.
    draft=$(printf '%s\n' "$metadata" | sed -n 's/^    "draft": \(false\),$/\1/p')
    version=$(printf '%s\n' "$metadata" | sed -n 's/^    "tag_name": "\([^"\\]*\)",$/\1/p')
    [ "$draft" = false ] || die 'No published release found; use --version to select a release'
    validate_version
fi
archive=flora-$version-linux-$arch.tar.gz
base=https://github.com/rhizomatous/flora/releases/download/$version
curl --disable --proto '=https' --proto-redir '=https' --fail --silent --show-error --location \
    --connect-timeout 15 --max-time 300 "$base/$archive" -o "$work/$archive"
curl --disable --proto '=https' --proto-redir '=https' --fail --silent --show-error --location \
    --connect-timeout 15 --max-time 60 "$base/SHA256SUMS" -o "$work/SHA256SUMS"
# Check only the selected archive, never paths supplied by the checksum document.
checksum=
while read -r hash name; do
    if [ "$name" = "$archive" ]; then
        [ -z "$checksum" ] || die 'Duplicate archive checksum'
        checksum=$hash
    fi
done < "$work/SHA256SUMS"
case $checksum in ''|*[!a-fA-F0-9]*) die 'Missing or invalid archive checksum' ;; esac
[ "${#checksum}" = 64 ] || die 'Invalid archive checksum length'
(cd "$work"; printf '%s  %s\n' "$checksum" "$archive" | sha256sum --check -) || die 'Archive checksum failed'
mkdir "$work/unpacked"
# Extract only expected files from the verified, trusted release archive.
tar -xzf "$work/$archive" -C "$work/unpacked" --no-same-owner --no-same-permissions ./flora ./release.json
for file in flora release.json; do
    [ -f "$work/unpacked/$file" ] || die "Archive has no regular $file"
    [ ! -L "$work/unpacked/$file" ] || die "Archive has a symlink for $file"
done
identity=$("$work/unpacked/flora" -version)
printf '%s\n' "$identity" | cmp -s - "$work/unpacked/release.json" || die 'Binary and release identity differ'
case $identity in
    '{"version":"'"$version"'","commit":'*'"os":"linux","arch":"'"$arch"'"}') ;;
    *) die 'Binary version or platform differs from requested release' ;;
esac
if "$work/unpacked/flora" -help 2>&1 | sed -n '/^  -public-url /p' | cmp -s - /dev/null; then
    die 'This release predates the installer; select a newer release with --version'
fi
printf 'Verified release: %s\n' "$identity"

# mkdir and exclusive unit creation protect against concurrent installer runs.
mkdir /opt/flora; own_opt=1
mkdir /var/lib/flora
install -o root -g root -m 0755 "$work/unpacked/flora" /opt/flora/flora
(set -C; : > "$unit") || die 'Service file appeared during installation'
own_unit=1
cat > "$unit" <<EOF
[Unit]
Description=Flora
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service

[Service]
Type=simple
User=root
UMask=0077
WorkingDirectory=/var/lib/flora
ExecStart=/opt/flora/flora -public-url $public_url -data-dir /var/lib/flora
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
enabled=1; systemctl enable flora.service
started=1; systemctl start flora.service
ready=0 attempt=0
while [ "$attempt" -lt 30 ]; do
    if systemctl is-active --quiet flora.service && \
        curl --disable --noproxy '*' --fail --silent --max-time 2 http://127.0.0.1:8080/api/health >/dev/null 2>&1 && \
        [ -f /var/lib/flora/deployment/enrollment-code ]; then
        ready=1; break
    fi
    attempt=$((attempt + 1)); sleep 1
done
[ "$ready" = 1 ] || die 'Startup timed out. Inspect privately with: journalctl -u flora.service'
code=/var/lib/flora/deployment/enrollment-code
[ ! -L "$code" ] || die 'Enrollment file must not be a symlink'
[ "$(stat -c '%u:%a' "$code")" = 0:600 ] || die 'Enrollment file must be root-owned with mode 0600'
success=1
printf 'Flora is running. Open %s\n' "$public_url"
printf 'Enrollment code is in %s (root-only).\n' "$code"
# Never send the enrollment secret to piped stdout, stderr or the journal.
if (exec 3>/dev/tty) 2>/dev/null; then
    (printf 'Flora enrollment code: '; cat "$code"; printf '\n') >/dev/tty || :
fi
