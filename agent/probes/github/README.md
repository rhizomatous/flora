# Probe: brokered GitHub access (issue #3)

This probe proves that an agent container can use ordinary `git`
clone/fetch/push and `gh` draft-PR create/view against an authorized
private GitHub repository without the administrator's fine-grained token
ever entering the container. Design and feasibility decision:
[specs/adr/0001-container-github-broker.md](../../../specs/adr/0001-container-github-broker.md).

## Shape

- `backend/cmd/probe-github-broker` runs on the host. It reads the
  administrator token from `FLORA_BROKER_GH_TOKEN` and injects it only on
  the upstream hop to github.com / api.github.com.
- The container receives a per-chat capability: repo-scoped, optionally
  read-only, time-limited, revocable. git carries it as the username in the
  remote URL; gh carries it as `GH_ENTERPRISE_TOKEN` with
  `GH_HOST=<broker>`.
- The broker never follows redirects and never forwards the administrator
  token to any host other than the pinned upstreams.

## Automated checks (no Docker, no live GitHub needed)

```
go -C backend test ./internal/githubbroker/ -count=1
```

Covers real git clone/fetch/push through the broker against a local
smart-HTTP upstream that requires the administrator token, read-only
scoping, cross-chat/cross-repository denial, revoked and expired
capabilities, REST and GraphQL repository scoping, redirect protection,
and credential-boundary checks (token never in responses, git config, or
error output; admin token never accepted as a container credential).

## Offline container integration (Docker, no secrets)

```
agent/probes/github/run-local.sh
```

Runs the real topology with a token-demanding fake upstream fixture
(`fake-upstream` subcommand serving git smart HTTP plus canned API JSON,
from `Containerfile.fake-upstream`): host-side broker with TLS,
unprivileged probe container (`--cap-drop ALL`, `no-new-privileges`, no
Docker socket), per-chat capability. Verified on 2026-10-25 with OrbStack
(Docker 29.8.2):

- fake upstream rejects tokenless requests (401) and serves the fixture
  with the bearer token (200)
- container git clone, commit, push, and fetch through the broker over
  TLS succeed; broker logs show the per-chat capability scope
- `gh api` repository view, draft PR create (`POST /pulls`), and PR view
  through the broker succeed
- cross-repository access denied inside the container for both git and
  the API; the upstream token itself is rejected as a container
  credential
- after `revoke`, the capability is denied from the host (401) and inside
  the container

## Opt-in live checks (real GitHub, no mutations)

```
FLORA_PROBE_LIVE=1 FLORA_PROBE_REPO=owner/name FLORA_BROKER_GH_TOKEN=... \
  go -C backend test ./internal/githubbroker/ -run TestLiveGitHub -count=1
```

## Container end-to-end (requires Docker and a designated test repo)

```
export FLORA_BROKER_GH_TOKEN=...        # fine-grained, restricted to the test repo
export FLORA_PROBE_REPO=owner/name      # authorized private test repository
export FLORA_PROBE_OTHER_REPO=owner/x   # a repository the token cannot access
agent/probes/github/run-probe.sh
```

`run-probe.sh` builds the broker and probe image, mints a capability,
runs the unprivileged container (no Docker socket, no published ports,
`--cap-drop ALL`), exercises clone/fetch/push plus draft-PR create/view,
checks cross-repository denial, revokes the capability, and confirms the
revoked capability is denied.

## Status

The offline container integration run (`run-local.sh`) and the automated
suite pass in full. Remaining gap: a run against **real GitHub** with a
designated private test repository and restricted token
(`run-probe.sh` + `TestLiveGitHub`), which needs environment inputs that
were not available at implementation time. Main uncertainties to confirm
there: gh's GH_HOST behavior against api.github.com-shaped endpoints,
including the GraphQL routes `gh pr create/view` use, and end-to-end push
to a real private repository.
