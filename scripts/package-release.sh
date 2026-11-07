#!/usr/bin/env bash
set -euo pipefail
version=${1:?usage: package-release.sh VERSION IMAGE@sha256:DIGEST [amd64|arm64]}
image=${2:?digest-pinned registry image required}
[[ $version =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.-]+)?$ ]] || exit 1
[[ $image =~ ^[a-z0-9./:_-]+@sha256:[a-f0-9]{64}$ ]] || exit 1
architectures=(amd64 arm64)
if (( $# >= 3 )); then
  case "$3" in amd64|arm64) architectures=("$3") ;; *) exit 1 ;; esac
fi
(( $# <= 3 )) || exit 1
[[ -z $(git status --porcelain) ]] || { printf '%s\n' 'Release packaging requires a clean committed source tree.' >&2; exit 1; }
commit=$(git rev-parse HEAD)
export CGO_ENABLED=0 GOTOOLCHAIN=local
mkdir -p dist
archives=()
for arch in "${architectures[@]}"; do
  stage=$(mktemp -d)
  trap 'rm -rf "$stage"' EXIT
  GOOS=linux GOARCH=$arch go -C backend build -mod=readonly -trimpath -buildvcs=false \
    -ldflags "-buildid= -X main.releaseVersion=$version -X main.releaseCommit=$commit -X main.releaseImage=$image" \
    -o "$stage/flora" ./cmd/flora
  jq -cn --arg version "$version" --arg commit "$commit" --arg image "$image" --arg arch "$arch" \
    '{version:$version,commit:$commit,agent_image:$image,harness_version:"1.2.27",os:"linux",arch:$arch}' > "$stage/release.json"
  cp packaging/flora.service LICENSE README.md INSTALL.md "$stage/"
  tar -czf "dist/flora-$version-linux-$arch.tar.gz" -C "$stage" .
  archives+=("flora-$version-linux-$arch.tar.gz")
  rm -rf "$stage"
  trap - EXIT
done
(cd dist && sha256sum "${archives[@]}" > SHA256SUMS)
