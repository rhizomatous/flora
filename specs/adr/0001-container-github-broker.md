# ADR 0001: Host-side credential broker for container git and gh

- Status: Proposed (spike evidence gathered; live container run pending environment)
- Date: 2026-10-25; hardened 2026-10-26 after review (structural GraphQL
  authorization, REST write bounds, path normalization, gh port topology,
  full selection-tree policy with traversal pruning)
- Issue: #3. Requirements: PRD §2.1, §4.2–4.4, §4.8, §6.2.

## Context

PRD §4.3 requires git and gh inside agent containers with authenticated
access to the chat's repositories, while the administrator's fine-grained
GitHub token stays outside agent-accessible containers and persisted
repository configuration. PRD §4.8 requires unrestricted outbound network
access for containers, and §4.2 forbids privileged containers and host
Docker socket access. Anything that places the token on the container's
network path in usable form (for example a transparent proxy that accepts
and forwards the token, or a container-side credential helper holding the
token) violates the isolation requirement.

## Feasibility decision (explicit, per issue #3)

**Feasible.** A host-side broker that terminates container requests and
re-originates them upstream satisfies ordinary git/gh use and token
isolation, with the constraints and uncertainties listed below. Evidence:
the automated suite (real git clone/fetch/push through the broker against
a smart-HTTP upstream that demands the administrator token; structural
GraphQL authorization including adversarial documents; REST write-scope
and path-normalization tests) and the offline Docker integration run
(`agent/probes/github/run-local.sh`, 2026-10-26), in which an
unprivileged container cloned, pushed, fetched, and ran **stock gh
2.103.2 (and earlier 2.63.0) `gh pr create --draft` and `gh pr view`**
through the TLS broker against a token-demanding fake upstream, with
cross-repository denial, nested-traversal denial and pruning, path and
credential-boundary checks, and revocation verified. The remaining
uncertainty is confined to live-GitHub behavior (real api.github.com
GraphQL shapes beyond the fixture, pushing to a real private repository);
the live run is scripted (`run-probe.sh`, opt-in `TestLiveGitHub`) and
awaits a designated test repository and restricted token. If that run
surfaces a blocker, this ADR must be revised rather than falling back to
injecting the token into containers.

## Decision

Adopt a **host-side HTTPS reverse-proxy broker** with **per-chat
capability tokens**:

1. The broker runs on the host, reachable from containers over the
   container bridge at a well-known name (`flora-broker`). It serves TLS
   with a host-generated CA; the CA certificate is baked into the agent
   image. gh requires HTTPS for enterprise-style hosts, so plain HTTP is
   not an option for the gh surface.
2. The administrator fine-grained token enters the broker only through
   the host process environment. The broker injects it as
   `Authorization: Bearer ...` on the upstream hop to `github.com` and
   `api.github.com`, and nowhere else (enforced in the transport).
3. Each chat gets a **capability**: an opaque random string bound to a
   chat ID, an explicit repository allowlist, a read/write flag, an
   expiry, and a revocation flag. Capabilities live in a host-only store
   file and are the only credentials containers ever see.
   - git: remote URL `https://<capability>@flora-broker/<owner>/<repo>.git`.
     The broker answers a Basic challenge so stock git retries with the
     URL credential; no custom git build or credential helper is needed.
   - gh: `GH_HOST=flora-broker`, `GH_ENTERPRISE_TOKEN=<capability>`. gh
     then speaks GHES-style REST (`/api/v3/...`) and GraphQL
     (`/api/graphql`) to the broker.
   - **Port constraint:** stock gh (verified 2.63.0 and 2.103.2) only
     matches git remotes to `GH_HOST` on the default HTTPS port; a port
     in the remote host makes gh refuse the remote. Containers therefore
     reach the broker through a **raw-TCP sidecar relay** presenting it
     as `flora-broker:443` inside the container network. The relay never
     terminates TLS and never sees credentials. On a Linux production
     host, binding the broker to the bridge gateway address on 443 is an
     equivalent alternative.
4. The broker never follows redirects (so the token cannot be carried to
   a redirect target), strips upstream `WWW-Authenticate` challenges (so
   a container can never be prompted for the administrator credential),
   and refuses the administrator token if presented as a container
   credential. Ambiguous request paths (dot segments, any
   percent-encoded path) are rejected before authorization and
   forwarding.
5. Scoping rules, all deny-by-default:
   - git smart HTTP only (`info/refs`, `git-upload-pack`,
     `git-receive-pack`; receive-pack requires the write flag) for
     allowlisted repositories.
   - REST: read (GET/HEAD) under `/api/v3/repos/<owner>/<repo>/...` for
     allowlisted repositories; **write is bounded to pull-request
     operations** (`POST`/`PATCH` on `/pulls` and `/pulls/<n>`).
     Destructive and unrelated mutating endpoints are denied even for
     write capabilities.
   - GraphQL: every document is parsed structurally (operations,
     fragments with type conditions, aliases, variables, defaults,
     directives) and authorized at two levels, both deny-by-default:
     (1) root field shapes — query introspection (`__schema`, `__type`),
     `repository(owner:, name:)` naming an allowlisted repository,
     `viewer`, `node(id:)` whose ID the broker resolves upstream to an
     allowlisted repository or an issue/PR of one, and mutation
     `createPullRequest` whose `input.repositoryId` resolves the same
     way (write flag required); (2) the **entire nested selection tree**
     against an explicit type/field allowlist (`gqlTypePolicy` in
     `gqlauthz.go`) containing only repo-local scalar fields and safe
     object/connection structures for the pull-request workflow. No
     policy field can traverse to a repository outside the authorized
     set: there is no `parent`, no `forks`, no `owner.repositories`
     enumeration, no `headRepository`. Two traversal fields stock gh
     requests itself — `Repository.parent` (RepoNetwork) and
     `PullRequest.headRepository` (some views) — are **pruned** from the
     forwarded document, so gh sees null and proceeds as if the
     repository were not a fork; a document needing pruning that also
     carries directives is denied (the rewriter does not preserve
     directive semantics). Unknown nested fields, unknown types, scalar
     fields with selections, aliases/fragments/     directives used to hide
     traversal, and oversized documents all fail closed before any
     container document is forwarded. Node IDs are re-resolved upstream
     on every use — deliberately uncached, so a repository rename or
     transfer can never leave a stale mapping that bypasses the
     allowlist.
   - Revocation and expiry are enforced per request.

## Supported operations

- git clone, fetch, push over smart HTTP(S).
- gh repository-scoped REST reads (`gh api`, `gh repo view` style) and
  pull-request writes (`POST`/`PATCH /pulls`).
- Stock `gh pr create --draft` and `gh pr view` (GraphQL): verified
  end-to-end with gh 2.63.0 and 2.103.2 in the offline Docker
  integration run. gh's enterprise `GET /meta` probe is denied and
  tolerated; its aliased feature-detection introspection is answered.
  **A gh upgrade requires reviewing `gqlTypePolicy` against the new
  version's queries** — the policy is allowlist-based, so new gh fields
  fail closed until added.

## Constraints honored

- PRD §4.2: container is unprivileged (`--cap-drop ALL`,
  `no-new-privileges`, non-root user); no host Docker socket; no host
  namespaces or devices.
- PRD §4.3: administrator token never in container files, environment,
  process arguments, agent-readable broker responses, or persisted git
  configuration (automated tests assert each of these).
- PRD §4.4: the broker binds host loopback (verified reachable from
  OrbStack containers through the relay; on Linux, bind the bridge
  gateway address). It is not exposed to the LAN, publishes no ports,
  and every request is authenticated by capability.
- PRD §4.8: the container keeps ordinary unrestricted outbound network
  access; the broker is an additional path, not a firewall. Direct
  unauthenticated access to github.com (public clones) still works.

## Limitations and uncertainties

- **GraphQL is a narrow structural allowlist at every depth, not generic
  proxying.** Read scope is exactly the policy's repo-local fields:
  repository identity/feature metadata, refs, pull requests and issues of
  authorized repositories (scalar fields plus author/labels/assignees/
  milestone/reviews identity structures), schema introspection, and the
  administrator's identity fields (`viewer` id/login/name). Cross-repo
  traversal (`parent`, `forks`, `owner.repositories`, `headRepository`,
  or any unlisted field at any depth) is pruned when gh needs it or
  denied otherwise; neither route forwards the administrator credential
  along an unauthorized path. Mutation scope is strictly
  `createPullRequest` on allowlisted repositories with the same deep
  output policy. Node IDs are resolved broker-side upstream before
  authorization. gh commands needing other fields fail closed.
- **Fork semantics:** because `parent`/`headRepository` are pruned, gh
  treats repositories as non-forks. The same-repository PR workflow
  (Flora's PRD scope) is unaffected; cross-fork PR creation is not
  supported and would need explicit policy work.
- **`viewer` identity fields disclose the administrator's account
  id/login/name** to chats. Accepted as benign metadata required by
  stock gh; revisit if the account identity itself is sensitive.
- **REST write scope is pull requests only.** Creating issues, comments,
  reviews, or merges is denied; those need explicit ADR extension if
  required later.
- **Account-level API endpoints are denied** (`/user` REST,
  `/notifications`, etc.). The PR workflow does not need them.
- **GitHub web-flow endpoints** (LFS batch API is `/.git/info/lfs` on
  github.com, currently unhandled), `git archive`, and SSH are out of
  scope for the spike. LFS repositories need explicit follow-up work.
- **TLS bootstrap**: the agent image must carry the broker CA, coupling
  broker and image at build/provision time.
- **Sidecar relay**: stock gh requires the broker on the default HTTPS
  port inside the container network. The probe uses a raw-TCP relay
  sidecar; production can equivalently bind the broker on the bridge
  gateway:443. Either way the relay/broker never terminates container
  TLS except at the broker itself.
- **Bridge confidentiality**: capability traffic crosses the container
  network over TLS. A compromised container can misuse its own
  capability until revoked, which is the intended blast radius
  (per-chat, repo-scoped, expiring).
- **Untested live**: the offline Docker integration passes with stock gh
  2.103.2, but real GitHub behavior is unconfirmed because no designated
  test repository/token was available. Remaining unknowns:
  real api.github.com GraphQL shapes for `gh pr` beyond the fixture,
  and pushing to a real private repository.
  `agent/probes/github/run-probe.sh` plus the opt-in `TestLiveGitHub`
  collect that evidence once the environment exists.

## Alternatives considered

- **Token in container via credential helper / extraHeader**: simplest,
  violates PRD §4.3 outright. Rejected.
- **Transparent HTTPS proxy with SNI-based token injection**: cannot
  distinguish authorized repositories from unauthorized ones at the git
  path level without terminating TLS, and a misconfigured container could
  still exfiltrate via the allowed host. The explicit broker endpoint
  gives per-repository and per-chat scoping.
- **Per-chat deploy keys or GitHub App installation tokens minted into
  the container**: keeps the admin token out but still hands the agent a
  broadly usable GitHub credential, and PRD scope excludes GitHub App
  onboarding for the initial release. The capability model keeps every
  usable credential broker-mediated and revocable.
- **SSH transport**: would require host key management and a custom ssh
  shim for scoping; HTTPS covers both git and gh with one mechanism.

## References

- Implementation: `backend/internal/githubbroker`,
  `backend/cmd/probe-github-broker`.
- Probe assets: `agent/probes/github/`.
- Tests: `backend/internal/githubbroker/*_test.go` (automated suite;
  `TestLiveGitHub` opt-in live check).
