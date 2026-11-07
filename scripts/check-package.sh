#!/usr/bin/env bash
set -euo pipefail
export GOTOOLCHAIN=local
arch=${1:-$(go env GOARCH)}
case "$arch" in amd64|arm64) ;; *) exit 1 ;; esac
if [[ $arch == amd64 ]]; then
  python3 -m unittest discover -s scripts -p 'release_*_test.py'
  sh -n scripts/install.sh
  shellcheck --shell=sh scripts/install.sh
  python3 -m unittest discover -s scripts -p 'installer_test.py' -v
fi
cleanup() {
  if docker container inspect flora-release-registry >/dev/null 2>&1; then
    docker rm -f flora-release-registry
  fi
}
trap cleanup EXIT
docker run -d --name flora-release-registry -p 127.0.0.1:51818:5000 registry:2@sha256:a3d8aaa63ed8681a604f1dea0aa03f100d5895b6a58ace528858a7b332415373
docker build -t localhost:51818/flora-agent:fixture agent/image
docker push localhost:51818/flora-agent:fixture
image=$(docker inspect --format '{{index .RepoDigests 0}}' localhost:51818/flora-agent:fixture)
make web
bash scripts/package-release.sh v0.0.0-fixture "$image" "$arch"
docker pull "$image"
docker rm -f flora-release-registry
(cd dist && sha256sum --check SHA256SUMS)
sudo bash scripts/check-release-linux.sh "dist/flora-v0.0.0-fixture-linux-$arch.tar.gz" "$(git rev-parse HEAD)"
mkdir -p bin
bash scripts/check-deployment.sh "$arch" localhost:51818/flora-agent:fixture
