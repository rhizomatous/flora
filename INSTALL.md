# Single-host Linux installation

Flora supports one trusted administrator and one local rootful Docker Engine on
Linux amd64 or arm64, with persistent local disk. Install Docker Engine 25+ with
API 1.44 support before starting. Rootless or remote Docker, user-namespace
remapping, network storage and native macOS are not supported production setups.
Docker access is effectively root authority. Agents have passwordless sudo inside
their own containers. Do not share the host with untrusted workloads.

## One-command installation

Before installing, provide a Linux systemd host, local rootful Docker Engine 25+,
`curl`, GNU `tar`, `sed`, `sha256sum` and the usual coreutils. Configure browser HTTPS
first, using Tailscale Serve or your existing proxy as described below. Arrange
DNS, HTTPS certificates and any firewall access for that endpoint yourself. The
installer does not install packages, Docker, Tailscale or a proxy, or change DNS
or firewall rules. It needs no Python, jq, Go or Node.

Run the installer from its stable URL:

```sh
curl --disable --proto '=https' --proto-redir '=https' -fsSL \
  https://raw.githubusercontent.com/rhizomatous/flora/main/scripts/install.sh |
  sudo sh -s -- --public-url https://flora.example.com
```

The default is the most recent release listed by GitHub, including alpha and other
prereleases but never drafts. Add `--version vX.Y.Z` to choose a specific published
release instead. This bypasses the release lookup if GitHub's API is rate-limited.

**Availability:** anonymous installation requires this repository, its release
assets and the pinned agent image to be publicly readable. No compatible release
has been published yet; `v0.0.1-alpha.1` predates this installer. The installer does
not handle GitHub credentials. Do not put tokens in the command or URLs.

The script requires root and `--public-url`. It detects amd64 or arm64, downloads
only the selected release archive and its checksums over HTTPS, verifies the checksum
and embedded binary identity, then installs `/opt/flora/flora` and starts a small
root-run `flora.service` with private `/var/lib/flora` storage. Root is needed for
the managed private broker and local Docker. It enables the service for boot and
waits for loopback health and the private enrollment file before reporting success.
The code goes only to `/dev/tty`; without a controlling terminal, only its file
path is printed. Open the displayed HTTPS URL and use that code to create the
administrator account, then configure credentials and connect a project in the
browser. No credentials are requested by the script.

Existing binary, data or service paths are refused, including repeat invocations.
This is a fresh-install command, not an upgrade command. A failed installation
removes only its newly installed binary and service. Any generated application
data and Docker state are retained for inspection and same-release recovery.

Same-release checksums detect corruption, not compromise of the release source.

## Manual download and run

Choose an explicit published release with `-public-url` and managed private
networking support. Older experimental releases use different startup contracts.
No Go, Node, Nix, OpenCode installation or Docker CLI is needed by the binary.
Allow outbound HTTPS to GHCR, GitHub, models.dev (OpenCode's metadata catalog),
and your hosted model provider. Plan for the
default ten running chats, each limited to 2 CPUs, 8 GiB and 512 processes.

```sh
VERSION=vX.Y.Z # replace with a published version
ARCH=amd64     # arm64 on aarch64 Linux
mkdir flora-release
cd flora-release
curl --proto '=https' --proto-redir '=https' -fLO \
  "https://github.com/rhizomatous/flora/releases/download/$VERSION/flora-$VERSION-linux-$ARCH.tar.gz"
curl --proto '=https' --proto-redir '=https' -fLO \
  "https://github.com/rhizomatous/flora/releases/download/$VERSION/SHA256SUMS"
sha256sum --ignore-missing --check SHA256SUMS
tar -xzf "flora-$VERSION-linux-$ARCH.tar.gz"
./flora -version
sudo ./flora -public-url https://flora.example.com -data-dir /var/lib/flora
```

Continue only when the selected archive reports `OK`. Compare `-version` against
`release.json`, including source commit, architecture and digest-pinned image.
Same-release checksums detect corruption, not compromise of the release source.
The archive contains the binary, release identity, license, guides and an optional
systemd example. Manual startup does not install a service.

## Browser HTTPS

Flora serves browser HTTP only at `127.0.0.1:8080`. `-listen` can select another
literal loopback address and port; wildcard and non-loopback addresses are refused.
An external HTTPS endpoint must forward to that listener without buffering SSE.
Flora does not obtain browser certificates or listen on public ports 80 or 443.

For an already configured Tailscale host, an administrator can use Tailscale Serve:

```sh
sudo tailscale serve --bg --https=443 http://127.0.0.1:8080
```

Use the actual HTTPS URL printed by Serve as the installer's `--public-url` (or
the binary's `-public-url` for manual startup). See the
[Serve command reference](https://tailscale.com/kb/1242/tailscale-serve).
Flora has no Tailscale dependency and does not trust Tailscale identity headers.
An existing generic HTTPS proxy is equally supported. On the same host, bind its
443 listener to the intended external IP rather than a wildcard that would
conflict with Flora's private bridge listener. Keep backend HTTP private and
forward the original Host. Forwarded headers never bypass password or origin checks.

`-public-url` is required and must be an HTTPS origin with no path. Its canonical
form defines the allowed browser mutation origin. Plain localhost HTTP cannot
support the secure browser session cookie. To change browser URLs, stop Flora,
adjust the HTTPS proxy and `-public-url`, then restart with the same data directory.
The private network and CA do not depend on the browser hostname. Cookies are
host-only, so a different browser hostname requires login there; old database
sessions are not automatically revoked. Remove access to the old endpoint and use
logout to revoke its session before changing endpoints when needed.

## Private runtime and enrollment

Every startup manages the same private infrastructure, regardless of browser TLS.
Flora creates an owner-labeled Docker bridge, saves its immutable ID and inspected
IPv4 gateway, and puts each agent on that bridge. Docker allocates the subnet from
its configured pools; arrange pools to avoid LAN/VPN overlap before first startup.
Agents resolve `flora-github.internal` through an injected hosts entry. No private
DNS server or public domain is needed for the broker.

The private broker listens on the owned gateway's **TCP 443**, bound to the Linux
bridge device with `SO_BINDTODEVICE`. Foreign-interface ingress cannot reach it,
even when a route exists. Flora still requires root or `CAP_NET_BIND_SERVICE` and
`CAP_NET_RAW`, plus Docker socket access. Loopback browser HTTP does not remove
these privileges. A root process gives agents a saved non-root UID/GID of 1000.
Only their workspace/runtime directories receive that ownership.

The private CA, signing key, network identity and enrollment code are persisted in
`data-dir/deployment` with private permissions. The online signer renews short-lived
broker leaves under the same CA. Agents receive public CA trust and scoped chat
capabilities, never CA/broker private keys, the administrator session, upstream
GitHub token, database or Docker socket. This network is not an egress sandbox.
Missing saved networks, changed CA trust, or existing application data without a
managed identity fail clearly. Restore the saved state rather than deleting it.

Open your configured HTTPS URL. Enter the enrollment code shown only on the
controlling terminal, or read `data-dir/deployment/enrollment-code` privately as
the app owner. Never put it in URLs, service arguments or logs. Enrollment closes
permanently once the first administrator exists, including after restart.

In Settings, save hosted model and GitHub credentials. The provider and installation
default model are fixed after first save. Individual chat turns can select other
models from the installed provider and use their supported reasoning options. Use
a fine-grained GitHub token limited to intended repositories, with Contents and Pull requests read/write and Metadata read. Add
Workflows write only if needed. Chat capabilities can use all permissions of that
token. Run Check dependencies, then create a project and chat. Metadata checks do
not prove inference quota or repository writes. Startup performs no paid inference
or GitHub writes. See [agent transport limits](agent/README.md).

## Service and recovery

The installer creates and enables the service for you. For a manual installation,
copy the verified binary to `/opt/flora/flora`. Adapt `flora.service` with your
canonical URL and install it yourself at `/etc/systemd/system/flora.service`.
The example runs as root and restricts writes to the data directory.
Before its first start on a fresh installation, provision the key as root with
`sudo sh -c 'umask 077; set -C; head -c 32 /dev/urandom > /var/lib/flora.key'`.
This refuses to overwrite an existing key. Restore an existing installation's
matching key instead. If using another key path, update ExecStart. The service
only needs to read the key. A non-root service needs Docker socket access, the
two network capabilities above and writable private storage; Docker remains root
authority. The binary itself never installs, enables or changes host services.

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now flora
sudo journalctl -u flora --since '5 minutes ago'
curl --fail http://127.0.0.1:8080/api/health
```

Health is liveness, not dependency readiness. Before downtime or removal, stop
every chat through Flora to revoke its capability. Stopping Flora alone does not
stop containers. Remove only the binary and service you installed, retaining the
data directory, numeric ownership, owned network, image and stopped containers.
Restart the same release with the same data path. Cross-release upgrades and
reconstruction of missing chat containers are not supported.

For backup, stop chats through Flora, stop the app, and archive its entire private
data directory and verified binary/identity with numeric ownership intact. Keep a
cold host/volume snapshot of the Docker data root, including stopped containers,
images and the owned network. Writable container layers are not in the data tar.
Never copy a live Docker data root or running workspace. Backups contain encrypted
credentials, login sessions, repository data and signing keys. Back up the matching
credential encryption key separately as described below. Keep backups encrypted
offline with mode 0600 in a 0700 directory. Restore only the same release and
architecture, same absolute paths and numeric identity, and matching Docker state,
while everything is stopped. Never run original and restored copies together.
Restore can revive old sessions or capabilities, so replace compromised upstream
keys and keep browser access restricted until recovery is checked.

## Credential storage and recovery

Flora encrypts recoverable GitHub and model-provider credentials with AES-256-GCM,
using a fresh random 96-bit nonce per value and authenticated record/field identity.
The versioned ciphertext lives in SQLite. Administrator passwords remain one-way
hashes and browser session handling is unchanged. This protects credentials in a
copied database when the key was not also copied. It does not protect a compromised
running host, process memory, or a container that receives a provider key for use.

On first startup, Flora generates a random 32-byte key at `data-dir.key`, outside
the data directory. With the installer default this is `/var/lib/flora.key`.
Use `-credential-key-file /private/path/key` to select a different path. Its parent
must already exist and be controlled by the service owner. The key must be a
regular file owned by that user with mode 0400 or 0600. Flora rejects symlinks and
paths inside the data directory. Data directories stay mode 0700 and SQLite files
mode 0600. Do not mount the key or storage directory into agents. Configure the same
key path on every service start. An existing key file must contain exactly 32 raw
random bytes; text, hex and base64 encodings are not accepted.

Encrypted storage never generates a replacement for a missing key. Missing,
incorrect or damaged keys and modified ciphertext stop startup without replacing
credentials or falling back to plaintext. Restore the matching key and intact
database from trusted backups. There is no password-based key recovery. If every
copy of a key is lost, the encrypted credentials cannot be recovered. Keep the
original data intact; provision a new installation and supply replacement upstream
credentials rather than editing the database to bypass its encryption marker.

Credentials are encrypted from their first save. Plaintext development databases
are unsupported; start with a fresh data directory. Existing development databases
and backups may contain plaintext and are not rewritten.

### Backups, restore and rotation

With chats and Flora stopped, back up the complete data directory and deployment
state using the procedure above. Save the matching encryption key in a separate
protected store with a reference identifying its database backup. A database
archive containing its key defeats the separation. Test restore on an isolated
host with the same release, the matching key, mode 0400 or 0600, and the configured
key path. Never start a restored production copy beside the original. Keep
historical keys for as long as corresponding backups must be recoverable.

To rotate the at-rest encryption key, first stop chats and Flora and retain a cold
backup and its key. Run as the service owner:

```sh
sudo /opt/flora/flora -data-dir /var/lib/flora \
  -credential-key-file /var/lib/flora.key \
  -rotate-credential-key-to /var/lib/flora-next.key
```

The command requires no Docker or public URL. It takes the same exclusive lock
as the server, creates the destination key if absent, authenticates the saved
values, and re-encrypts both values and the key verifier in one transaction. An
existing destination must be a valid private key file. It never overwrites the
source key. On success, set `-credential-key-file /var/lib/flora-next.key` in the
service's ExecStart, reload systemd and restart.
Verify settings and dependencies before removing any old key from active storage.
This changes encryption at rest; it does not replace upstream tokens or keys
already in container environments.

If interrupted, retain both keys. Before the transaction commits, the source key
still opens the database; after commit, only the destination does. Retry with the
source and the same destination if the source still opens. Otherwise start with
the destination, which also finishes any pending SQLite cleanup. Wrong-key opens
fail without rewriting secrets. Backups made before rotation still need the old
key. Rotation cannot revoke access to an old database and old key already copied
by someone else; replace the upstream credentials to revoke that access.

After rotation, Flora runs VACUUM and truncates the WAL to remove old-key
ciphertext from the current SQLite files, retrying unfinished cleanup on startup.
This does not guarantee secure deletion from SSDs, filesystem journals, snapshots
or underlying media. Historical backups still require their original key and
remain readable to anyone who has both copies.

## Maintainer release control

Only explicit version tags run release publication. Normal PRs publish no images,
tags or releases. The tag workflow checks that a release does not already exist,
publishes one multi-platform agent image, and embeds its actual registry digest
and canonical source commit into both binaries. Native amd64 and arm64 jobs check
the archived bytes before publication without rebuilding. Prereleases cannot become
the latest stable release. A failed verification can leave an image tag but no
release. Never retag or overwrite a published release. Build dependencies include
floating Alpine packages, so archives are not claimed to be reproducible.
