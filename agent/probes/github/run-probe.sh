#!/bin/sh
# Host-side orchestration for the issue #3 live probe. Requires Docker and
# a designated private test repository. Run from anywhere; paths are
# resolved relative to this script's repository checkout.
#
# Required environment (host only):
#   FLORA_BROKER_GH_TOKEN   fine-grained token restricted to the test repo
#   FLORA_PROBE_REPO        authorized private test repository, owner/name
#   FLORA_PROBE_OTHER_REPO  any repository the token cannot access, owner/name
#
# The token is read from the environment by the broker process only. It is
# never written to the image, the container, command arguments, or files
# the container can read.
set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$HERE/../.." && pwd)
WORK=$(mktemp -d /tmp/flora-probe-3.XXXXXX)
trap 'rm -rf "$WORK"' EXIT

: "${FLORA_BROKER_GH_TOKEN:?set the fine-grained token in the host environment}"
: "${FLORA_PROBE_REPO:?set the authorized test repository}"
: "${FLORA_PROBE_OTHER_REPO:?set an unauthorized repository for denial checks}"

REPO=$(echo "$FLORA_PROBE_REPO" | tr 'A-Z' 'a-z' | sed 's/\.git$//')
OTHER_REPO=$(echo "$FLORA_PROBE_OTHER_REPO" | tr 'A-Z' 'a-z' | sed 's/\.git$//')

echo "== build broker"
go -C "$ROOT/backend" build -o "$WORK/probe-github-broker" ./cmd/probe-github-broker

echo "== host-side PKI and capability"
"$WORK/probe-github-broker" init-pki -pki "$WORK/pki" -hosts flora-broker >/dev/null
CAP_OUT=$("$WORK/probe-github-broker" mint -caps "$WORK/capabilities.json" \
	-chat probe-chat-1 -repos "$REPO" -write -ttl 1h)
CAPABILITY=$(echo "$CAP_OUT" | sed -n 's/^capability=//p')

echo "== build probe image (unprivileged, no docker socket)"
cp "$WORK/pki/ca.pem" "$HERE/ca.pem"
trap 'rm -rf "$WORK" "$HERE/ca.pem"' EXIT
docker build -f "$HERE/Containerfile" -t flora-probe-github "$HERE"

echo "== start broker on the container bridge only"
docker network create flora-probe-net >/dev/null 2>&1 || true
"$WORK/probe-github-broker" serve \
	-listen 0.0.0.0:8443 -caps "$WORK/capabilities.json" -pki "$WORK/pki" \
	-hosts flora-broker &
BROKER_PID=$!
trap 'kill $BROKER_PID 2>/dev/null || true; rm -rf "$WORK" "$HERE/ca.pem"' EXIT
sleep 1

echo "== run container probe"
# host-gateway resolves to the host from inside the container (Docker
# 20.10+). The broker listens on the host; no host ports are published and
# no Docker socket is mounted.
docker run --rm \
	--network flora-probe-net \
	--add-host flora-broker:host-gateway \
	--cap-drop ALL --security-opt no-new-privileges \
	-e BROKER_HOST=flora-broker:8443 \
	-e CAPABILITY="$CAPABILITY" \
	-e REPO="$REPO" \
	-e OTHER_REPO="$OTHER_REPO" \
	flora-probe-github

echo "== revoke capability and confirm denial"
"$WORK/probe-github-broker" revoke -caps "$WORK/capabilities.json" -cap "$CAPABILITY"
sleep 1
if curl -sk -u "$CAPABILITY:" \
	"https://localhost:8443/$REPO.git/info/refs?service=git-upload-pack" \
	-o /dev/null -w '%{http_code}' | grep -q 200; then
	echo "PROBE FAIL: revoked capability still authorized" >&2
	exit 1
fi
echo "revoked capability denied"

echo "PROBE OK"
