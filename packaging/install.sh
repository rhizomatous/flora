#!/bin/sh
set -eu
[ "$(id -u)" = 0 ] || { printf '%s\n' 'Run as root on the Linux host.' >&2; exit 1; }
[ "$(uname -s)" = Linux ] || exit 1
cd "$(dirname "$0")"
test -f flora && test -f release.json
./flora -version >/dev/null
test -S /var/run/docker.sock
getent group docker >/dev/null
if ! getent passwd flora >/dev/null; then
  useradd --system --user-group --home-dir /var/lib/flora --shell /usr/sbin/nologin flora
fi
test "$(id -u flora)" != 0
install -d -o root -g root -m 0755 /opt/flora
install -d -o root -g flora -m 0750 /etc/flora
install -d -o flora -g flora -m 0700 /var/lib/flora
test ! -e /opt/flora/flora || { printf '%s\n' 'Existing installation: refusing an implicit upgrade.' >&2; exit 1; }
install -o root -g root -m 0755 flora /opt/flora/flora
install -o root -g root -m 0644 release.json /opt/flora/release.json
install -o root -g root -m 0644 flora.service /etc/systemd/system/flora.service
if [ ! -e /etc/flora/flora.env ]; then
  install -o root -g flora -m 0640 flora.env.example /etc/flora/flora.env
fi
printf '%s\n' 'Installed, not started. Configure /etc/flora, private DNS/TLS and the HTTPS proxy before systemctl enable --now flora.'
