# Probe: brokered GitHub access (issue #3)

Host-side credential isolation for ordinary container git and gh. The real
administrator fine-grained token stays in the host broker environment.
Containers receive independent expiring, revocable bearer capabilities.

**Authorization boundary:** every valid capability can exercise every repository
and operation permitted by the administrator token. GitHub enforces permissions.
There are no per-chat repo allowlists, read-only capabilities, REST write bounds
or GraphQL policies. The user explicitly approved this model on 2026-10-26,
superseding issue #3's narrower per-chat selected-repository criterion. That old
criterion is not claimed as met. Restrict the token at GitHub to the authority
you want agents to have. Chat identity is for attribution and independent
revocation, not protection against another chat using a stolen capability.

See [ADR 0001](../../../specs/adr/0001-container-github-broker.md) for the
decision, exact trust boundary and limitations.

## Transport

- git: `https://CAPABILITY@flora-broker/owner/repo.git`.
- gh: `GH_HOST=flora-broker`, `GH_ENTERPRISE_TOKEN=CAPABILITY`.
- Host broker maps smart HTTP to `https://github.com`, `/api/v3/...` to
  `https://api.github.com/...`, `/api/graphql` to `/graphql`.
- Requests are not parsed or rewritten. Methods, escaped paths, queries and
  bodies are preserved; authentication is replaced, Cookie and hop headers
  removed. Upstream statuses, errors and response bodies pass through.
- Real-token destinations are fixed GitHub origins. No arbitrary upstreams,
  forward-proxy requests, CONNECT, redirect following or environment proxies.
- Stock gh requires default HTTPS port remote matching. Both Docker probes use
  a raw-TCP sidecar at `flora-broker:443` to the host TLS broker. The container
  trusts only the provisioned public broker CA. Host TLS keys stay outside.

## Automated tests (no secrets, no Docker)

```sh
go -C backend test ./internal/githubbroker -count=1
```

Real git clone/fetch/push to multiple repositories; transparent GraphQL/REST
forwarding including aliases, fragments, directives, opaque IDs and formerly
pruned fields; upstream denial preservation; invalid/expired/revoked capability
denial; independent revocation; destination/redirect checks; token isolation.

Mint/revoke host-side credentials (no repo or write settings):

```sh
probe-github-broker mint -caps /host-only/capabilities.json -chat chat-1 -ttl 1h
probe-github-broker revoke -caps /host-only/capabilities.json -cap CAPABILITY
```

Do not reuse old scoped capability stores: this revision intentionally removes
those scopes. Stop the broker, discard the old probe store and mint fresh
credentials after accepting the broader upstream authorization boundary.

## Offline Docker integration (no real credentials)

```sh
agent/probes/github/run-local.sh
```

Uses a public fixture token and token-demanding fake upstream. Upstream overrides
require `-offline-test`, the exact public token `local-test-admin-token`, and
HTTP loopback origins. A real token cannot be used for these overrides.

Verified 2026-10-26 on OrbStack: `LOCAL RUN OK`, with stock **gh 2.103.2**
`pr create --draft` / `pr view`, TLS git clone/commit/push/fetch, access to a
second repository, explicit fake-upstream permission denials, rejection of the
upstream token as a container credential and revocation from host and container.
The fixture API is canned JSON, not a GitHub authorization emulator. Probe
containers are non-root, unprivileged and have no Docker socket.

## Live evidence (not run, authorization still pending)

Do not run these until the operator authorizes the designated private repository
and host-only token. Do not pass the real token to Docker or enable shell tracing.

Read-only host test:

```sh
FLORA_PROBE_LIVE=1 FLORA_PROBE_REPO=owner/name FLORA_BROKER_GH_TOKEN=... \
  go -C backend test ./internal/githubbroker -run TestLiveGitHub -count=1
```

Container test, **pushes a branch and creates a draft PR**:

```sh
export FLORA_PROBE_LIVE=1
export FLORA_BROKER_GH_TOKEN=...       # host only, restricted at GitHub
export FLORA_PROBE_REPO=owner/name    # authorized private mutation test repo
export FLORA_PROBE_OTHER_REPO=owner/x # private repo denied by GitHub/token
agent/probes/github/run-probe.sh
```

The live script uses the offline-verified relay topology, exercises git/gh,
checks upstream denial and exact revoked 401, then cleans up local probe
resources. Keep the branch/draft PR as evidence or remove them manually.
Loopback access via host-gateway is OrbStack/Desktop-specific; Linux requires
a private bridge gateway listener and corresponding relay destination.

PR #23 remains draft pending real private-GitHub evidence. SSH, LFS, git
archive and alternate release/download hosts are outside the transport. Fork
semantics are no longer rewritten, but cross-fork workflows remain unverified.
