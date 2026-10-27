# Agent image

This directory owns Flora's agent container image and runtime integration.

`image/` builds the pinned OpenCode agent image (git, GitHub CLI, passwordless
sudo, setup-once entrypoint). The application builds no image at bootstrap;
release builds publish the image and record its digest for provisioning. The
provisioning service in `backend/internal/provisioning` creates and manages
chat containers through the Docker Engine API; the Docker CLI is not a runtime
dependency.

Build and live-test locally:

```sh
docker build -t flora-agent-test:local agent/image
FLORA_PROVISIONING_TEST_IMAGE=flora-agent-test:local \
  go -C backend test -race -count=1 -v -run TestProvisioningDocker ./internal/provisioning
```
