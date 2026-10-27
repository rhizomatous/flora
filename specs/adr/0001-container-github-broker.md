# ADR 0001: Host-side credential broker for container git and gh

- Status: Proposed. Offline and real private-GitHub feasibility demonstrated; review pending.
- Date: 2026-10-25; authorization model simplified by explicit user decision 2026-10-26.
- Issue: [#3](https://github.com/rhizomatous/flora/issues/3)
- Superseding decision: [issue #3 comment](https://github.com/rhizomatous/flora/issues/3#issuecomment-6409227472)
- PR: [#23](https://github.com/rhizomatous/flora/pull/23), remains draft for review.
- Requirements: PRD Projects §2.1, Execution §4.2–4.4 and §4.8, Review §6.2.

## Context and user decision

PRD §4.3 requires normal git and gh with an administrator fine-grained token
kept outside containers and persisted repository configuration. §4.8 allows
ordinary outbound networking; §4.2 forbids privileged containers and the host
Docker socket.

**The user explicitly permits agents to access every repository and operation
that the administrator's fine-grained token permits. GitHub enforces those
permissions.** Project repository selection determines workspace setup, not an
additional security allowlist. Administrators must restrict the token at GitHub
to the repositories and permissions they intend agents to have.

This supersedes issue #3's narrower acceptance criterion for per-chat selected
repository authorization and cross-chat repository denial. We do **not** claim
that old criterion is met. Each chat has an independent bearer capability for
expiry, attribution and revocation, but all valid capabilities exercise the same
upstream token authority. Chat IDs do not prevent a stolen capability from being
used by another chat. A compromised container can use all that authority until
its capability expires or is revoked. Workspace isolation remains separate.

## Feasibility decision

**Feasible for the demonstrated offline and private-GitHub workflows.** A host-side HTTPS reverse
proxy can keep the real token outside containers while stock git and gh work
through separate container credentials. The operator-authorized live run against
private `rhizomatous/flora` passed on 2026-10-27 UTC, including git push and stock
gh draft-PR create/view. The temporary PR and branch were cleaned up without merge.

## Decision and exact boundary

1. The broker runs host-side, with the administrator token read only from
   `FLORA_BROKER_GH_TOKEN`. The host-only capability store and TLS keys must
   never be mounted into agent containers. Only the public CA certificate is
   provisioned in the image.
2. Each chat receives a random, expiring, revocable capability. git uses it as
   the Basic username in `https://CAPABILITY@flora-broker/owner/repo.git`.
   gh uses `GH_HOST=flora-broker` and `GH_ENTERPRISE_TOKEN=CAPABILITY`, speaking
   GHES-style REST `/api/v3/...` and GraphQL `/api/graphql` over TLS.
3. The broker replaces capability authentication with the real token only on
   fixed `https://github.com` git smart-HTTP and `https://api.github.com` API
   requests (Basic `x-access-token` for git, Bearer for API). GitHub smart HTTP
   rejects Bearer authentication; the first live read-only check exposed this
   mismatch and both broker and fixture were corrected before the passing run.
   Upstream origins cannot be set to arbitrary destinations. The
   injecting transport checks scheme, host and port; environment HTTP proxies
   are disabled. Inbound Host, absolute URLs, query data and request bodies
   cannot select another upstream. Forward-proxy requests and CONNECT are denied.
4. Redirects are returned without following them. The real token is never sent
   to a redirect target. Container Authorization, Cookie and proxy credentials
   are removed on the upstream hop; hop-by-hop headers are removed. Upstream
   `WWW-Authenticate` is stripped to avoid interactive credential prompts.
   The real token itself is rejected as a broker credential. Logs omit URLs,
   query strings, bodies, credentials and transport error details.
5. **No repository allowlist, read/write flags, REST PR-only restriction,
   GraphQL parser, type policy, AST rewriting or node ownership lookup.**
   Methods, escaped paths, query strings and request bodies are forwarded
   unchanged apart from the documented GHES-to-GitHub route mapping and
   credential/hop-header handling. GitHub decides whether any REST or GraphQL
   operation is valid and authorized. This includes account endpoints,
   multiple repositories, forks, opaque node IDs, directives, multiple
   operations, mutations and nested traversal. No broker policy upgrades are
   required when gh changes its queries. GitHub response statuses, payloads,
   permission errors and rate-limit headers pass through.
6. Capability expiry and revocation are checked per request. They prevent new
   requests, not already authenticated in-flight requests. Capability files
   persist revocation across restart. This is a spike's single-writer file
   store, not production concurrent capability administration.
7. Offline overrides require `-offline-test`, the public literal
   `local-test-admin-token`, and HTTP loopback origin URLs. A real token is
   rejected in that mode. The fixture token has no GitHub authority.

## Supported transport and topology

- Ordinary git clone/fetch/push over smart HTTPS. No SSH shim.
- General GitHub REST and GraphQL forwarding for gh, with upstream-enforced
  permissions. Stock gh 2.103.2 is pinned for reproducible probe evidence,
  not because its GraphQL shapes need a custom broker policy.
- Stock gh matches repository remotes at the default HTTPS port. The probes
  use a raw-TCP sidecar relay at `flora-broker:443` pointing to the host broker.
  TLS terminates only at the broker. Both offline and live scripts use this
  topology. A private bridge gateway listener on 443 is an alternative.
- Probes run non-root, with `--cap-drop ALL` and `no-new-privileges`, without
  the host Docker socket, host namespaces, devices or other chats' storage.
  Normal outbound networking remains available. The broker is an additional
  authenticated path, not a network firewall.

## Evidence and remaining limits

Automated tests cover real git clone/fetch/push to two repositories using one
capability; byte-for-byte GraphQL and REST forwarding (including formerly
pruned fields); no extra node lookups; upstream HTTP and GraphQL denials;
invalid, expired and revoked capabilities; independent chat revocation;
fixed destinations, redirect non-following, credential isolation and logs.

The revised `run-local.sh` passed on 2026-10-26 on OrbStack, with stock
**gh 2.103.2 `pr create --draft` and `pr view`**, git clone/commit/push/fetch,
second-repository access, fake-upstream permission denials and revoked
capability denial from both host and a fresh container. The fake API is a
canned transport fixture, not evidence of real GitHub authorization behavior.

Live evidence on 2026-10-27 UTC:

- `TestLiveGitHub` passed API metadata (`private=true`), git ls-remote and
  revoked-capability denial using the operator-provided host-only token.
- Docker `run-probe.sh` passed TLS git clone/commit/push/fetch and actual stock
  gh 2.103.2 draft-PR create/view, then exact 401 after revocation.
- [Test PR #24](https://github.com/rhizomatous/flora/pull/24) used branch
  `probe/flora-broker-20261027T004825Z-5feaa2c3`, based on `main`. It was closed
  without merge; only that exact branch was deleted. Main was not mutated.
- No second repository was designated. That live negative check is optional;
  upstream-denial unit/offline tests still run. This is not evidence of live
  cross-repository denial or independent auditing of every token permission.

Remaining limits:

- Real private-GitHub evidence covers the tested same-repository workflow, not
  all GitHub operations. The PR stays draft for review.
- Fork requests are no longer altered, but cross-fork PR behavior is not yet
  verified. SSH, git archive, LFS, release asset download hosts and arbitrary
  GitHub web paths are not proxied. External redirects need unauthenticated
  handling outside this broker; the real token must never follow them.
- Only trusted GitHub upstreams receive real credentials. The broker is not a
  response content sanitizer for a malicious upstream that reflects secrets.
- Host filesystem, process environment and broker TLS keys are trusted.
  Capabilities are secrets too, though independently revocable and unusable
  directly at GitHub. Persisted git config can contain a capability.
- Bridge-only listener placement/firewall rules, capability delivery, resource
  limits, robust persistence and lifecycle wiring remain production work.
  OrbStack/Desktop loopback reachability is not universal on Linux.

## Alternatives

- Real token in a container credential helper or `extraHeader`: violates token
  isolation, rejected.
- Per-chat repository policy with a custom GraphQL parser and field pruning:
  removed by user decision. It added maintenance cost and changed normal gh
  semantics without serving the approved authorization model.
- GitHub App or deploy-key provisioning: outside this spike's scope. Separate
  broker capabilities provide independent revocation without exposing the
  administrator token.

Implementation: `backend/internal/githubbroker`,
`backend/cmd/probe-github-broker`. Reproduction: `agent/probes/github/README.md`.
