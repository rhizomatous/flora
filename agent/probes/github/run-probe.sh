#!/bin/sh
# Opt-in LIVE probe. Mutates only the designated test repo (push + draft PR).
# Obtain explicit authorization and provision the host-only token first.
set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$HERE/../../.." && pwd)
WORK=$(mktemp -d /tmp/flora-probe-3.XXXXXX)
NET=flora-probe-live-net
RELAY=flora-probe-live-relay
cleanup() {
	docker rm -f "$RELAY" >/dev/null 2>&1 || true
	docker network rm "$NET" >/dev/null 2>&1 || true
	[ -n "${BROKER_PID:-}" ] && kill "$BROKER_PID" 2>/dev/null || true
	rm -rf "$WORK" "$HERE/ca.pem" "$HERE/probe-github-broker-linux"
}
trap cleanup EXIT

: "${FLORA_PROBE_LIVE:?set FLORA_PROBE_LIVE=1 after authorizing this live mutation probe}"
[ "$FLORA_PROBE_LIVE" = 1 ] || exit 1
: "${FLORA_BROKER_GH_TOKEN:?set the fine-grained token in the host environment}"
: "${FLORA_PROBE_REPO:?set the authorized private test repository}"
: "${FLORA_PROBE_OTHER_REPO:?set a private repository denied by the upstream token}"
REPO=$FLORA_PROBE_REPO
OTHER_REPO=$FLORA_PROBE_OTHER_REPO

echo "== build broker (host and relay image)"
case "$(uname -m)" in arm64|aarch64) GOARCH=arm64 ;; *) GOARCH=amd64 ;; esac
go -C "$ROOT/backend" build -o "$WORK/probe-github-broker" ./cmd/probe-github-broker
CGO_ENABLED=0 GOOS=linux GOARCH=$GOARCH go -C "$ROOT/backend" build \
	-o "$HERE/probe-github-broker-linux" ./cmd/probe-github-broker

echo "== host-side PKI and capability"
"$WORK/probe-github-broker" init-pki -pki "$WORK/pki" -hosts flora-broker >/dev/null
CAPABILITY=$("$WORK/probe-github-broker" mint -caps "$WORK/capabilities.json" \
	-chat probe-chat-1 -ttl 1h | sed -n 's/^capability=//p')
cp "$WORK/pki/ca.pem" "$HERE/ca.pem"
docker build -f "$HERE/Containerfile" -t flora-probe-github "$HERE"
# Reuse the fixture image for its raw-TCP relay binary only, no fake server.
docker build -f "$HERE/Containerfile.fake-upstream" -t flora-probe-relay "$HERE"

echo "== start host broker and TLS-pass-through relay"
docker network create "$NET" >/dev/null
# OrbStack/Desktop: loopback is reachable through host-gateway. On Linux,
# bind the private bridge gateway instead and adjust the relay destination.
"$WORK/probe-github-broker" serve -listen 127.0.0.1:8443 \
	-caps "$WORK/capabilities.json" -pki "$WORK/pki" -hosts flora-broker &
BROKER_PID=$!
sleep 1
docker run -d --name "$RELAY" --network "$NET" --network-alias flora-broker \
	--add-host hostgw:host-gateway --entrypoint /usr/local/bin/probe-github-broker \
	flora-probe-relay tcp-relay -listen 0.0.0.0:443 -to hostgw:8443 >/dev/null
sleep 1

echo "== run container probe (real GitHub mutations)"
docker run --rm --network "$NET" \
	--cap-drop ALL --security-opt no-new-privileges \
	-e BROKER_HOST=flora-broker -e CAPABILITY="$CAPABILITY" \
	-e REPO="$REPO" -e OTHER_REPO="$OTHER_REPO" flora-probe-github

echo "== revoke capability and confirm exact 401"
"$WORK/probe-github-broker" revoke -caps "$WORK/capabilities.json" -cap "$CAPABILITY"
CODE=$(curl --cacert "$WORK/pki/ca.pem" --resolve flora-broker:8443:127.0.0.1 \
	-u "$CAPABILITY:" "https://flora-broker:8443/$REPO.git/info/refs?service=git-upload-pack" \
	-o /dev/null -w '%{http_code}')
[ "$CODE" = 401 ] || { echo "PROBE FAIL: revoked capability got $CODE" >&2; exit 1; }
echo "PROBE OK (leave the pushed branch/draft PR as evidence; clean them up manually)"
