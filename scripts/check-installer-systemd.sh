#!/usr/bin/env bash
set -euo pipefail
image=${1:?fixture container image required}
arch=${2:?amd64 or arm64 required}
container=$(docker run --detach --privileged --cgroupns=private --tmpfs /run --tmpfs /run/lock \
  --mount type=volume,dst=/var/lib \
  --mount "type=bind,src=$PWD/agent/image,dst=/agent-image,readonly" \
  --mount "type=bind,src=$PWD/bin/provisioning-test,dst=/provisioning-test,readonly" \
  --label flora.fixture=installer-systemd --entrypoint /sbin/init "$image")
trap 'docker rm --force --volumes "$container" >/dev/null' EXIT
pin=$(docker exec "$container" python3 /scripts/installer-systemd-fixture.py prepare)
printf 'Fixture agent image: %s\n' "$pin"
bash scripts/package-release.sh v0.0.0-fixture "$pin"
docker cp "dist/flora-v0.0.0-fixture-linux-$arch.tar.gz" "$container:/fixture-release.tar.gz"
docker exec -e "FLORA_FIXTURE_COMMIT=$(git rev-parse HEAD)" "$container" python3 /scripts/installer-systemd-fixture.py exercise
docker restart "$container" >/dev/null
docker exec "$container" python3 /scripts/installer-systemd-fixture.py verify-restart
