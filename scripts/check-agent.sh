#!/usr/bin/env bash
set -euo pipefail
export GOTOOLCHAIN=local
image=flora-agent-test:ci
docker build -t "$image" agent/image
FLORA_PROVISIONING_TEST_IMAGE=$image go -C backend test -race -count=1 -v -run '^Test(Provisioning|Settings)Docker$' ./internal/provisioning
FLORA_GITHUB_TEST_IMAGE=$image FLORA_MULTI_TEST_IMAGE=$image FLORA_BROKER_GH_TOKEN= go -C backend test -race -count=1 -v -run '^Test(Checkout|MultiRepository)Docker$' ./internal/githubbroker
FLORA_CHAT_TEST_IMAGE=$image FLORA_CHAT_TEST_LSP=1 FLORA_CHAT_PROVIDER_HOST="$(docker network inspect bridge --format '{{(index .IPAM.Config 0).Gateway}}')" go -C backend test -race -count=1 -v -run '^Test(Chat|Recovery|ThreeChats)Docker$' ./internal/chat
FLORA_CHANGES_DOCKER_TEST=1 FLORA_CHANGES_TEST_IMAGE=$image go -C backend test -race -count=1 -v -run '^TestDockerCaptureAndRemoval$' ./internal/changes
