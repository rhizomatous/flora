#!/usr/bin/env bash
set -euo pipefail

: "${GITHUB_REF_NAME:?}" "${GITHUB_REPOSITORY:?}" "${SOURCE_COMMIT:?}" "${RELEASE_IMAGE:?}"
if [[ ! "$GITHUB_REF_NAME" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.-]+)?$ ]]; then
  exit 1
fi

set --
if [[ "$GITHUB_REF_NAME" == *-* ]]; then
  set -- --prerelease --latest=false
fi

gh release create "$GITHUB_REF_NAME" dist/*.tar.gz dist/SHA256SUMS \
  --repo "$GITHUB_REPOSITORY" --verify-tag --title "Flora $GITHUB_REF_NAME" \
  "$@" \
  --notes "Linux amd64 and arm64. Source: $SOURCE_COMMIT. See the installation guide in this tag. Agent: $RELEASE_IMAGE. OpenCode: 1.2.27. Existing-chat upgrades are not supported."
