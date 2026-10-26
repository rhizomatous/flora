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
capabilities, REST scoping with pull-request-only write bounds, path
normalization rejection (dot segments, percent-encoded forms),
structural GraphQL authorization (allowed gh shapes plus adversarial
decoy/alias/fragment/multi-operation/node-ID documents, and R1 nested
traversal: `owner.repositories` enumeration, fork/parent routes,
mutation-result traversal, unknown nested fields at any depth, all
denied before forwarding; gh-requested `parent`/`headRepository`
verified pruned from the forwarded document), redirect
protection, and credential-boundary checks (token never in responses,
git config, or error output; admin token never accepted as a container
credential).

## Offline container integration (Docker, no secrets)

```
agent/probes/github/run-local.sh
```

Runs the real topology with a token-demanding fake upstream fixture
(`fake-upstream` subcommand serving git smart HTTP plus canned API JSON,
from `Containerfile.fake-upstream`): host-side broker bound to loopback,
a raw-TCP sidecar relay presenting the broker as `flora-broker:443`
inside the container network (stock gh only matches remotes to GH_HOST
on the default HTTPS port), and an unprivileged probe container
(`--cap-drop ALL`, `no-new-privileges`, no Docker socket) with a per-chat
capability. Verified on 2026-10-26 with OrbStack (Docker 29.8.2):

- fake upstream rejects tokenless requests (401) and serves the fixture
  with the bearer token (200)
- container git clone, commit, push, and fetch through the broker over
  TLS succeed; broker logs show the per-chat capability scope
- **stock gh 2.63.0 `gh pr create --draft` and `gh pr view` succeed
  through the broker**, including gh's introspection and
  repository-network GraphQL queries; `gh api` REST reads work too
- cross-repository access denied inside the container for both git and
  the API; the upstream token itself is rejected as a container
  credential; the environment boundary check rejects unexpected
  credential-shaped variables (and no longer false-matches `GH_HOST`)
- after `revoke`, the capability is denied from the host (401) and inside
  a fresh container run

The GraphQL authorization is structural and deny-by-default (see ADR
0001); the fake upstream's response shaping is fixture-only and makes no
security decisions.

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

The offline container integration run (`run-local.sh`, including stock
gh `pr create --draft` / `pr view`) and the automated suite pass in
full. Remaining gap: a run against **real GitHub** with a designated
private test repository and restricted token (`run-probe.sh` +
`TestLiveGitHub`), which needs environment inputs that were not
available at implementation time. Main uncertainties to confirm there:
real api.github.com GraphQL response shapes beyond the fixture, and
end-to-end push to a real private repository.
