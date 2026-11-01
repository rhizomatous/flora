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

## GitHub transport and checkout

The host-side `githubbroker` package holds the administrator GitHub token outside
containers. Each chat receives a separate seven-day bearer credential. Every valid
credential can exercise all permissions of the saved token. GitHub enforces those
permissions; project repository selection only chooses what to check out.

The optional binary listener is separate from the browser server:

```sh
./bin/flora -public-url https://flora.example.com \
  -github-listen 172.17.0.1:443 \
  -github-tls-cert /private/github-transport.crt \
  -github-tls-key /private/github-transport.key
```

Use an actual private host address reachable from the Docker bridge. Configure a
private hostname resolving to that address inside containers, with a matching TLS
certificate. Stock `gh` needs the advertised hostname on port 443 to recognize Git
remotes. Linux can grant the non-root service `CAP_NET_BIND_SERVICE` to bind this
port. Alternatively a TCP-only relay can present private port 443 to a higher
listener port while passing TLS through unchanged. Do not expose this listener
through the public browser proxy. Keep its private key and the storage root out of
container mounts. Only the public CA certificate is delivered to containers.

Construct `githubbroker.NewAccess` with the broker, Docker client, private hostname,
CA PEM, and optional commit author override, then pass it to `provisioning.New`.
This is the provisioning checkout callback used by browser chat startup.
It clones the initial core repository into `/workspace`, creates a chat branch,
records the resolved starting SHA, and releases setup only after persistence
succeeds. Checkout failure stops the container and retains bounded output in the
chat's host-side `logs/checkout.log` and activity records. Retrying preserves a
completed checkout, its original starting SHA, and local edits.
Automatic checkout currently requires exactly one core repository. Multiple core
checkouts are not supported; saved configurations still retain their collections.

Git remotes and configuration contain only the broker hostname and revocable
credential. Normal HTTPS Git and `gh` REST/GraphQL traffic goes to fixed GitHub
destinations without query rewriting or operation restrictions. The broker blocks
redirects rather than forwarding credentials to download hosts. SSH, Git LFS, and
external asset downloads are not provided by this transport. Outbound container
network access is otherwise unchanged.

Explicitly stopping a chat or failing checkout revokes its credential. Starting
renews it; token replacement in installation settings takes effect on the next upstream
request without replacing container credentials. Saved credential digests survive
host process restart. There is no automatic renewal while a container runs. Expiry
requires an explicit start to renew. Every `Start`, even for an already running
container, replaces its credential, so callers must first quiesce git/gh work.
Use `Endpoint` to retrieve a running container's address without rotating access.
Revocation blocks new requests, not already accepted upstream work. A stolen chat
credential grants the same GitHub authority until revoked or expired.
External daemon stops are not monitored by this service and do not themselves
revoke a credential.

### Integration checks

```sh
FLORA_GITHUB_TEST_IMAGE=flora-agent-test:local \
  go -C backend test -race -count=1 -v -run TestCheckoutDocker ./internal/githubbroker
```

The default run uses a local Git HTTP fixture for clone, local commit, push, and
stock `gh pr create --draft`. It also checks failed-checkout blocking and retained
diagnostics, retry, author configuration, starting-SHA persistence, preserved edits,
stop/restart, and revoked access. A disposable container relays port 443 without
terminating TLS. The test uses the Docker CLI only to manage that relay; checkout
and runtime provisioning use the Engine API. It removes only its own containers.
On Linux the host listener defaults to `172.17.0.1`; override
`FLORA_GITHUB_TEST_BIND` with another container-reachable private `IP:0` if needed.

To check a real private repository, supply `FLORA_BROKER_GH_TOKEN` through the host
environment without printing it or putting it in arguments. The same test then
uses private `rhizomatous/flora` and performs only clone, fetch, branch resolution,
and `gh` metadata reads. It does not push or create a GitHub PR. Model generation
is never requested. Live results belong in the implementation PR; the local fixture
does not prove GitHub write permissions or cross-fork behavior.
