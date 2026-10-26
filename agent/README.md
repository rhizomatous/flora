# Agent image

This directory owns Flora's Docker image and runtime integration. The pinned
OpenCode probe is tracked in issue #2; the production image and isolated container
lifecycle are tracked in issue #7. No image is built by the application bootstrap.

The brokered GitHub access probe for issue #3 lives in
[probes/github](probes/github): an unprivileged probe container that uses
ordinary git and gh through the host-side credential broker.

The application talks to Docker through its API. Docker is not required to build
or run the initial health endpoint and web shell.
