#!/bin/sh
# Offline container integration run for issue #3. Proves the full topology
# with Docker but without any real GitHub credentials:
#
#   probe container --TLS/capability--> host broker --bearer--> fake upstream
#
# The fake upstream is a token-demanding fixture (git smart HTTP plus
# canned API JSON), so a passing run demonstrates that ordinary container
# git and gh work through the broker and that the broker injects the
# administrator credential only upstream. Requires Docker and a git
# binary on the host. No secrets needed.
set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$HERE/../../.." && pwd)
WORK=$(mktemp -d /tmp/flora-probe-3-local.XXXXXX)
BROKER_PORT=18443
FAKE_PORT=18080
NET=flora-probe-local-net
FAKE_NAME=flora-probe-fake-upstream
RELAY_NAME=flora-probe-relay
TEST_TOKEN=local-test-admin-token

cleanup() {
	[ -n "${FAKE_DEBUG:-}" ] && docker logs "$FAKE_NAME" 2>&1 | tail -60 || true
	docker rm -f "$FAKE_NAME" "$RELAY_NAME" >/dev/null 2>&1 || true
	docker network rm "$NET" >/dev/null 2>&1 || true
	[ -n "${BROKER_PID:-}" ] && kill "$BROKER_PID" 2>/dev/null || true
	rm -rf "$WORK" "$HERE/ca.pem" "$HERE/probe-github-broker-linux"
}
trap cleanup EXIT

ARCH=$(uname -m)
case "$ARCH" in
arm64|aarch64) GOARCH=arm64 ;;
*) GOARCH=amd64 ;;
esac

echo "== build broker (host and linux/$GOARCH)"
go -C "$ROOT/backend" build -o "$WORK/probe-github-broker" ./cmd/probe-github-broker
CGO_ENABLED=0 GOOS=linux GOARCH=$GOARCH go -C "$ROOT/backend" build \
	-o "$HERE/probe-github-broker-linux" ./cmd/probe-github-broker

echo "== seed bare repository fixture"
mkdir -p "$WORK/gitroot/octo"
git init --bare -b main -q "$WORK/gitroot/octo/demo.git"
git clone -q "$WORK/gitroot/octo/demo.git" "$WORK/seed"
echo "probe fixture" > "$WORK/seed/README.md"
git -C "$WORK/seed" add README.md
git -C "$WORK/seed" -c user.email=probe@example.com -c user.name=Probe commit -q -m initial
git -C "$WORK/seed" push -q origin HEAD:main
git clone --bare -q "$WORK/gitroot/octo/demo.git" "$WORK/gitroot/octo/other.git"

echo "== host-side PKI and capability"
"$WORK/probe-github-broker" init-pki -pki "$WORK/pki" -hosts flora-broker >/dev/null
CAPABILITY=$("$WORK/probe-github-broker" mint -caps "$WORK/capabilities.json" \
	-chat probe-chat-1 -ttl 1h | sed -n 's/^capability=//p')

echo "== build images"
cp "$WORK/pki/ca.pem" "$HERE/ca.pem"
docker build -q -f "$HERE/Containerfile" -t flora-probe-github "$HERE" >/dev/null
docker build -q -f "$HERE/Containerfile.fake-upstream" -t flora-probe-fake-github "$HERE" >/dev/null

echo "== start fake upstream container (published on host loopback only)"
docker network create "$NET" >/dev/null
docker run -d --name "$FAKE_NAME" --network "$NET" \
	-p 127.0.0.1:$FAKE_PORT:8080 \
	-v "$WORK/gitroot:/srv/git" \
	flora-probe-fake-github \
	-listen 0.0.0.0:8080 -root /srv/git -token "$TEST_TOKEN" \
	${FAKE_DEBUG:+-debug} >/dev/null
sleep 1
curl -s -o /dev/null -w 'fake upstream direct, no token: %{http_code}\n' \
	"http://127.0.0.1:$FAKE_PORT/octo/demo.git/info/refs?service=git-upload-pack"
curl -s -o /dev/null -H "Authorization: Bearer $TEST_TOKEN" \
	-w 'fake upstream direct, with token: %{http_code}\n' \
	"http://127.0.0.1:$FAKE_PORT/octo/demo.git/info/refs?service=git-upload-pack"

echo "== start host-side broker (token in host process environment only)"
# Bound to host loopback only: containers reach it through host-gateway,
# and nothing on the LAN can. Verified reachable from OrbStack
# containers; on Linux production, bind the container bridge gateway
# address instead (see ADR 0001).
FLORA_BROKER_GH_TOKEN="$TEST_TOKEN" "$WORK/probe-github-broker" serve \
	-offline-test -listen 127.0.0.1:$BROKER_PORT -caps "$WORK/capabilities.json" \
	-pki "$WORK/pki" -hosts flora-broker \
	-git-upstream "http://127.0.0.1:$FAKE_PORT" \
	-api-upstream "http://127.0.0.1:$FAKE_PORT" &
BROKER_PID=$!
sleep 1

echo "== start sidecar relay (containers see the broker as flora-broker:443)"
# Stock gh only matches git remotes to GH_HOST on the default HTTPS port,
# so a raw-TCP sidecar presents the loopback-bound broker inside the
# container network at flora-broker:443. The relay never terminates TLS
# and never sees credentials.
docker run -d --name "$RELAY_NAME" --network "$NET" \
	--network-alias flora-broker \
	--add-host hostgw:host-gateway \
	--entrypoint /usr/local/bin/probe-github-broker \
	flora-probe-fake-github \
	tcp-relay -listen 0.0.0.0:443 -to hostgw:$BROKER_PORT >/dev/null
sleep 1

echo "== run unprivileged probe container"
docker run --rm \
	--network "$NET" \
	--cap-drop ALL --security-opt no-new-privileges \
	-e BROKER_HOST=flora-broker \
	-e CAPABILITY="$CAPABILITY" \
	-e REPO=octo/demo \
	-e OTHER_REPO=octo/other \
	-e DENIED_REPO=octo/denied \
	--entrypoint /bin/sh \
	flora-probe-github /home/agent/container-local.sh

echo "== revoke capability and confirm denial from host"
"$WORK/probe-github-broker" revoke -caps "$WORK/capabilities.json" -cap "$CAPABILITY"
sleep 1
CODE=$(curl -sk -u "$CAPABILITY:" \
	"https://127.0.0.1:$BROKER_PORT/octo/demo.git/info/refs?service=git-upload-pack" \
	-o /dev/null -w '%{http_code}')
if [ "$CODE" != 401 ]; then
	echo "LOCAL PROBE FAIL: revoked capability got $CODE, want 401" >&2
	exit 1
fi
echo "revoked capability denied (401)"

echo "== run revoked capability inside the container"
if docker run --rm \
	--network "$NET" \
	--cap-drop ALL --security-opt no-new-privileges \
	-e BROKER_HOST=flora-broker \
	-e CAPABILITY="$CAPABILITY" \
	-e REPO=octo/demo \
	-e OTHER_REPO=octo/other \
	--entrypoint /bin/sh \
	flora-probe-github -c \
	'git ls-remote "https://$CAPABILITY@$BROKER_HOST/$REPO.git"'; then
	echo "LOCAL PROBE FAIL: revoked capability worked inside container" >&2
	exit 1
fi
echo "revoked capability denied inside container"

echo "LOCAL RUN OK"
