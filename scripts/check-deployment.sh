#!/usr/bin/env bash
set -euo pipefail
arch=${1:-arm64}
image=${2:-flora-agent-test:local}
case "$arch" in amd64|arm64) ;; *) exit 1 ;; esac
test -x "bin/flora-linux-$arch"
test -d bin
CGO_ENABLED=0 GOOS=linux GOARCH=$arch go -C backend test -c -o "../bin/deployment-test-linux-$arch" ./cmd/flora
# This daemon has no host socket, published ports, credentials or shared storage.
id=$(docker run -d --privileged --label flora.fixture=deployment \
  -e DOCKER_TLS_CERTDIR= \
  --mount "type=bind,src=$PWD/bin/flora-linux-$arch,dst=/flora,readonly" \
  --mount "type=bind,src=$PWD/bin/deployment-test-linux-$arch,dst=/deployment-test,readonly" \
  docker:28-dind@sha256:2a232a42256f70d78e3cc5d2b5d6b3276710a0de0596c145f627ecfae90282ac \
  --host=unix:///var/run/docker.sock)
trap 'docker rm -f "$id" >/dev/null' EXIT
for attempt in $(seq 1 60); do
  if docker exec "$id" docker info >/dev/null 2>&1; then break; fi
  if [ "$attempt" = 60 ]; then docker logs "$id"; exit 1; fi
  sleep 1
done
docker image save "$image" | docker exec -i "$id" docker image load
docker exec -e FLORA_DEPLOYMENT_TEST=1 -e "FLORA_TEST_IMAGE=$image" "$id" \
  /deployment-test -test.v -test.timeout=5m -test.run '^TestDeploymentEngine$'
