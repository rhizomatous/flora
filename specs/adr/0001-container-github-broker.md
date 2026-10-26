# ADR 0001: Host-side credential broker for container git and gh

- Status: Proposed (spike evidence gathered; live container run pending environment)
- Date: 2026-10-25
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
a smart-HTTP upstream that demands the administrator token, plus
REST/GraphQL scoping tests) and the offline Docker integration run
(`agent/probes/github/run-local.sh`, 2026-10-25), in which an
unprivileged container cloned, pushed, fetched, and made gh API calls
through the TLS broker against a token-demanding fake upstream, with
cross-repository denial and revocation verified. The remaining
uncertainty is confined to live-GitHub behavior (real `gh pr` GraphQL
routes, GH_HOST details, pushing to a real private repository); the live
run is scripted (`run-probe.sh`, opt-in `TestLiveGitHub`) and awaits a
designated test repository and restricted token. If that run surfaces a
blocker, this ADR must be revised rather than falling back to injecting
the token into containers.

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
4. The broker never follows redirects (so the token cannot be carried to
   a redirect target), strips upstream `WWW-Authenticate` challenges (so
   a container can never be prompted for the administrator credential),
   and refuses the administrator token if presented as a container
   credential.
5. Scoping rules: git smart-HTTP only (`info/refs`, `git-upload-pack`,
   `git-receive-pack`; receive-pack requires the write flag); REST only
   under `/api/v3/repos/<owner>/<repo>/...` for allowlisted repositories
   (mutations require the write flag); GraphQL only when every repository
   referenced in the query is allowlisted (conservative heuristic, see
   limitations). Revocation and expiry are enforced per request.

## Supported operations

- git clone, fetch, push over smart HTTP(S).
- gh operations that stay on repository-scoped REST paths, including
  draft PR create (`POST /repos/{o}/{r}/pulls`) and PR view.
- gh PR view/create via GraphQL with attributable repository references.

## Constraints honored

- PRD §4.2: container is unprivileged (`--cap-drop ALL`,
  `no-new-privileges`, non-root user); no host Docker socket; no host
  namespaces or devices.
- PRD §4.3: administrator token never in container files, environment,
  process arguments, agent-readable broker responses, or persisted git
  configuration (automated tests assert each of these).
- PRD §4.4: the broker endpoint is private to the execution/application
  boundary (container bridge only, no published host ports) and every
  request is authenticated by capability.
- PRD §4.8: the container keeps ordinary unrestricted outbound network
  access; the broker is an additional path, not a firewall. Direct
  unauthenticated access to github.com (public clones) still works.

## Limitations and uncertainties

- **GraphQL scoping is heuristic.** The probe attributes queries to
  repositories via variables and inline literals and denies anything
  unattributed. This is deliberately conservative and may reject some
  legitimate gh commands (for example ones that only reference the
  viewer). Production should parse the GraphQL document properly.
- **Account-level API endpoints are denied** (`/user`, `/notifications`,
  etc.), because they act on the administrator rather than a repository.
  gh commands needing them will fail; the PR workflow does not.
- **GitHub web-flow endpoints** (LFS batch API is `/.git/info/lfs` on
  github.com, currently unhandled), `git archive`, and SSH are out of
  scope for the spike. LFS repositories need explicit follow-up work.
- **TLS bootstrap**: the agent image must carry the broker CA. This is
  fine for the Flora-provided image but means the broker and image are
  coupled at build/provision time.
- **Bridge confidentiality**: capability traffic crosses the container
  bridge over TLS, so other containers cannot read it; a compromised
  container could still misuse its own capability until revoked, which is
  the intended blast radius (per-chat, repo-scoped, expiring).
- **Untested live**: the offline Docker integration passes, but real
  GitHub behavior is unconfirmed because no designated test
  repository/token was available. `agent/probes/github/run-probe.sh`
  plus the opt-in `TestLiveGitHub` are the acceptance evidence to collect
  once the environment exists. gh's exact GH_HOST behaviors (port
  handling, GraphQL routes used by `gh pr view`) are the main
  uncertainties to confirm there.

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
