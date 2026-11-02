# Single-host Linux installation

Flora supports one trusted administrator, one Docker Engine and persistent local
storage on the same Linux host. The service runs as a non-root account, but access
to Docker is effectively root authority. Agents have passwordless sudo **inside
their own containers**. Do not share the host with untrusted workloads. No runtime
Node, Go, Nix, OpenCode installation, SQLite library or Docker CLI is required.
The administrative examples below use the Docker CLI for inspection and backups;
Flora itself talks directly to the Engine API.

## Select a release

Use a published `vX.Y.Z` release, or an explicitly labeled prerelease such as
`v0.0.1-alpha.1`, from this repository. Prereleases are for early testing and do not
establish completion of the v0.1 acceptance criteria. Until an administrator tags
and publishes one, there is no released artifact to download. Do not substitute a
development binary or guess an agent digest. The tag workflow builds the image for
both architectures, gets its real registry index digest, and embeds that identity,
the source commit and OpenCode 1.2.27 in both binaries. Assets include checksums,
`release.json`, the installer and service/proxy examples. `flora -version` prints
the embedded identity without opening storage. Compare it to `release.json`.

Build inputs are locked, but Alpine packages added to the pinned OpenCode base
float within Alpine 3.23. Rebuilding the tag can produce different image bytes.
Use the recorded digest, not the mutable image tag, for installation and recovery.
Archives are not claimed to be bit-for-bit reproducible. Checksums detect damaged
downloads; obtain them and the assets from the trusted GitHub release over HTTPS.

On a Debian 12 or Ubuntu 24.04 host, install Docker Engine from Docker's official
repository, systemd, Caddy (or another HTTPS proxy), CA certificates, curl, tar,
coreutils, openssl and user-management tools. Use a rootful Engine with its default
bridge and `/var/run/docker.sock`, with the `docker` group allowed to access the
socket. Rootless Docker, remote daemons, user-namespace remapping, network storage
and Docker Desktop are not the supported production configuration. Allow outbound
HTTPS to GHCR, GitHub and the chosen hosted model API. Size disk and memory for
the configured number of chats; defaults allow ten containers at 8 GiB each.

```sh
VERSION=vX.Y.Z                    # replace with an actually published release
ARCH=amd64                       # use arm64 on aarch64 Linux
curl -fLO "https://github.com/rhizomatous/flora/releases/download/$VERSION/flora-$VERSION-linux-$ARCH.tar.gz"
curl -fLO "https://github.com/rhizomatous/flora/releases/download/$VERSION/SHA256SUMS"
sha256sum --ignore-missing --check SHA256SUMS
mkdir flora-release
tar -xzf "flora-$VERSION-linux-$ARCH.tar.gz" -C flora-release
./flora-release/flora -version
sudo sh flora-release/install.sh
```

The installer refuses to overwrite an existing binary and does not start the
service. It creates `/opt/flora` (root-owned binaries and release identity),
`/etc/flora` (root-owned, service-readable configuration/TLS), and `/var/lib/flora`
(service-owned, mode 0700). Keep the same numeric service UID/GID for recovery.
Never recursively relax storage permissions. The database, WAL/SHM, workspaces,
runtime-state, logs and artifacts must remain together. Only each chat's workspace
and runtime-state subdirectories are mounted into its agent, never the storage
root, database, TLS keys or Docker socket.

## Private GitHub transport: required before starting

The browser proxy alone is insufficient. Git and stock `gh` in agents need a
**separate private TLS hostname on port 443** to reach Flora's GitHub broker.
For a default Docker bridge, use its actual host gateway (often `172.17.0.1`).
Check the gateway, do not blindly copy the example. Reserve that address so it
does not change. Set the values in `/etc/flora/flora.env` to your browser origin,
private gateway listener and private hostname.

Configure DNS used by the Docker daemon's containers so
`flora-github.internal` resolves to that gateway. For example, an existing private
DNS server can serve an A record for this name; configure Docker's `dns` setting
to that server if the host resolver is not reachable from containers. Merge with
existing daemon configuration, then restart Docker during installation, before
there are chats. Flora does not add host aliases. Verify DNS **from a container**.
Do not publish this hostname in public DNS or expose the listener publicly.

If you do not already run private DNS, a dedicated Debian/Ubuntu host can run
`dnsmasq` on the Docker bridge. Install it and add a file such as
`/etc/dnsmasq.d/flora.conf` with the following values, replacing the gateway and
upstream resolver for your network:

```ini
interface=docker0
bind-dynamic
listen-address=172.17.0.1
no-resolv
server=1.1.1.1
address=/flora-github.internal/172.17.0.1
```

Merge `"dns": ["172.17.0.1"]` into `/etc/docker/daemon.json` (a JSON object),
without discarding existing settings. Start Docker before dnsmasq; restart dnsmasq
after the bridge exists, then restart Docker to apply its DNS setting. Allow
bridge traffic to gateway UDP/TCP 53 as well as TCP 443, and deny external access.
Do not enable this example on a host with another resolver already using that
address: use the existing resolver instead. With an administrative Docker CLI,
verify using the exact image printed by `flora -version`:

```sh
sudo docker run --rm --entrypoint getent IMAGE@sha256:DIGEST hosts flora-github.internal
```

The result must be the private gateway IP. This diagnostic container has no host
mounts or credentials. Do not start a chat until name resolution works.

Create a private CA and server certificate with a matching DNS SAN. These commands
use a root-only temporary directory and install only the public CA into agent
trust. Keep the CA signing key offline, outside `/etc/flora`:

```sh
sudo -i
umask 077
mkdir /root/flora-transport-ca
cd /root/flora-transport-ca
openssl req -x509 -newkey rsa:3072 -nodes -days 3650 \
  -subj '/CN=Flora private transport CA' -addext 'basicConstraints=critical,CA:TRUE' \
  -addext 'keyUsage=critical,keyCertSign,cRLSign' -keyout ca.key -out ca.crt
openssl req -newkey rsa:3072 -nodes -subj '/CN=flora-github.internal' \
  -keyout transport.key -out transport.csr
printf 'subjectAltName=DNS:flora-github.internal\nextendedKeyUsage=serverAuth\n' > extensions
openssl x509 -req -in transport.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -days 365 -extfile extensions -out transport.crt
install -o root -g flora -m 0640 ca.crt /etc/flora/transport-ca.crt
install -o root -g flora -m 0640 transport.crt transport.key /etc/flora/
exit
sudoedit /etc/flora/flora.env
```

The systemd unit grants only `CAP_NET_BIND_SERVICE` for private port 443. Bind it
to the bridge gateway, not `0.0.0.0`; allow bridge containers through the host
firewall to that IP:443. Do not put this transport behind an HTTP reverse proxy.
A TCP-only relay is an alternative, but must pass TLS unchanged and expose 443 to
agents. The browser proxy can still own public IP:443. Caddy's default wildcard
443 binding can conflict: configure its `bind` directive to your **public host IP**
if it shares this host with the private listener. Check listening addresses before
starting. Renew the private certificate before expiry and restart Flora. CA
rotation is not transparent to existing containers, which keep their saved CA.

## Browser HTTPS and first start

Point public DNS at the host. Adapt `Caddyfile.example`, including the public-IP
`bind` directive when needed, to Caddy's configuration. Allow public 80/443 for
certificate issuance, keep backend 8080 loopback-only, and leave SSE responses
unbuffered. Set `FLORA_PUBLIC_URL` to the exact HTTPS origin, without a path.
Forwarded headers are not trusted; secure session cookies require HTTPS.

If GHCR denies an unauthenticated image pull, the repository administrator must
make the agent package public or arrange registry authentication for the Engine.
An interactive Docker CLI login for a different account does not automatically
give Flora credentials. Public readability is the supported simple path. Release
CI uses only its scoped `GITHUB_TOKEN`: package write for the image build, package
read for verification, and contents write only for release creation. It can verify
a newly created private package by authenticating a CLI pull of the exact digest
on each native runner; the fixture reuses that local identity without a second,
unauthenticated pull. Credentials remain available through verification and are
removed in an always-run cleanup step. Organizations must permit package creation
and link an existing package to this repository. No personal publishing token is
used. CI authentication does not make the package public for end users.

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now flora
sudo systemctl status flora
sudo journalctl -u flora --since '5 minutes ago'
curl --fail http://127.0.0.1:8080/api/health
```

Restrict public browser access to yourself until the first administrator account
is created. There is no second-user onboarding. In Settings save one hosted
provider (OpenAI, Anthropic or Google), its exact model ID and API key. Provider
and model are fixed after first save. Use a provider account with inference access
and budget controls; metadata validation is not a paid inference test.

Create a fine-grained GitHub token limited to the selected repositories, with
Contents read/write, Pull requests read/write, and Metadata read (automatic).
Add Workflows write only if the agent must modify workflow files. Complete any
organization approval. Keep the token in Flora Settings, never in setup commands,
agent environments, clone URLs or service files. The broker holds it on the host.
Chat capabilities can use **all permissions of this token**, not just the chat's
selected repository. Store only the least authority you intend to delegate.

Run Settings **Check dependencies**. Create a project with at least one core
repository, then start a chat and check setup, a follow-up and a stopped/resumed
workspace. See [agent transport limits](agent/README.md). SSH, LFS and GitHub
asset-download redirects are not implemented by the private broker. No provider
calls or GitHub writes are performed by the installer.

## Operations and same-release offline recovery

`systemctl restart flora` restarts the application only. It does **not** stop chat
containers. Saved activity is reconciled after startup; uncertain deliveries are
never automatically resent. Use the UI's Stop container control to stop each chat
and revoke its GitHub capability before planned downtime. Confirm no working or
waiting chats remain. Stopping in-flight tools can leave partial files, so prefer
to let work finish first. `journalctl -u flora` and authenticated setup logs and
Settings diagnostics explain storage, Docker, image and credential failures.
Health reports process liveness, not dependency readiness. Do not post logs or
backups publicly.

Offline backup procedure, on this dedicated single-installation host:

1. Block browser access and stop **every chat through Flora's UI**. This revokes
   its broker credential. If a container cannot be stopped by Flora, stop it via
   Docker and rotate/revoke the upstream GitHub token before proceeding. External
   Docker stops do not revoke saved capabilities. Also revoke/rotate the provider
   key if an agent or backup may have been exposed.
2. `sudo systemctl stop flora`. Disable automatic/external restarts for the whole
   backup window. Verify `systemctl is-active flora` is inactive. Inspect
   `sudo docker ps --filter label=flora.managed=true`; there must be **no running
   managed containers**. Fail the backup if any remain. Never just stop Flora and
   copy a live workspace.
3. Keep a root-owned mode-0700 backup directory on encrypted offline storage. With
   `sudo -i` and `umask 077`, archive `/var/lib/flora`, `/etc/flora` and `/opt/flora`
   together: `tar --numeric-owner -cpf /srv/flora-backups/flora.tar -C / var/lib/flora
   etc/flora opt/flora`. Include WAL/SHM if present. Save the service UID/GID,
   Docker version, DNS/firewall/proxy settings and `flora -version` identity.
4. Preserve the same Docker daemon's stopped chat containers and image. Their
   writable layers contain setup markers and installed packages that are **not**
   in the bind-mounted storage. Take a cold host/volume snapshot including Docker's
   data root after stopping Docker, using your host snapshot tool. Do not copy a
   running Docker data root. A data-only tar preserves files and history but is
   **not** a recoverable running-chat backup: missing containers are not recreated.
   Keep an offline copy of the exact image with `docker image save` before stopping
   Docker if registry availability is uncertain.
5. Restrict backup files to the backup owner (0600). They contain plaintext
   GitHub/provider keys, account/session material, broker capability digests,
   private transport keys, repository contents and model context. Keep the CA
   signing key separately offline. Treat old backups as credentials even after
   rotating the live keys.

Restore only to the **same release and architecture**, same absolute paths and
numeric UID/GID, and the matching cold Docker state. Keep Flora, Docker and chats
stopped while restoring. Restore into an empty dedicated target, never overlay
a running or newer database. Use `tar --numeric-owner -xpf ... -C /` as root;
retain root ownership of `/opt/flora`, root:flora read-only configuration/TLS and
flora ownership/mode 0700 for the data root. Agent-created files may have their
own modes, so do not recursively chmod the workspace. Verify the archive checksum
and embedded binary identity, restore private DNS/trust/proxy settings, then start
Docker and verify chats remain stopped. Start Flora and check saved history,
settings and diagnostics before allowing browser access. Explicitly resume one
chat and verify its previous files and OpenCode session. Keep the backup until
recovery is confirmed. Never run original and restored installations together.

Do not use restore to undo a credential revocation. Replace any compromised or
since-revoked upstream keys before resuming. Backups can revive old login sessions
and capability records; keep the endpoint private until verified. Live backup,
data-only reconstruction of missing containers, upgrades with existing chats and
cross-release chat compatibility are outside this release.

## Maintainer release control

Only an explicit `vMAJOR.MINOR.PATCH` (optionally prerelease) tag runs
`.github/workflows/release.yml`. Normal PRs do not publish images or releases.
Prerelease tags publish with GitHub's prerelease flag and cannot become the latest release.
Before any image push, the workflow verifies repository access and checks for an
existing release by tag. Only a release-endpoint 404 permits publication; an
existing release, authentication failure, outage or unexpected response fails
closed. Per-tag workflow concurrency prevents two runs from racing this check.
Rerunning a completed release therefore stops before rebuilding or changing its
image tag. Do not create a release manually while its tag workflow is running.

The workflow publishes an image before building the binary because its actual
registry digest is the build input. Native amd64 and arm64 jobs verify the same
archived bytes and pinned image before a final job publishes those archives,
without rebuilding. Source identity comes from `git rev-parse HEAD`, including
for annotated tags. A failed verification can leave an unreferenced image tag,
but no GitHub release. Do not retag or overwrite a published release. No release
tag is created by the implementation or installer.
