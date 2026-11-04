# Single-host Linux installation

Flora supports one trusted administrator and one local rootful Docker Engine on
Linux amd64 or arm64, with persistent local disk. Install Docker Engine 25+ with
API 1.44 support before starting. Rootless or remote Docker, user-namespace
remapping, network storage and native macOS are not supported production setups.
Docker access is effectively root authority. Agents have passwordless sudo inside
their own containers. Do not share the host with untrusted workloads.

## One-command installation

Before installing, provide a Linux systemd host, local rootful Docker Engine 25+,
`curl`, GNU `tar`, `sha256sum` and the usual coreutils. Configure browser HTTPS
first, using Tailscale Serve or your existing proxy as described below. Arrange
DNS, HTTPS certificates and any firewall access for that endpoint yourself. The
installer does not install packages, Docker, Tailscale or a proxy, or change DNS
or firewall rules. It needs no Python, jq, Go or Node.

Choose an explicit compatible published release, including prerelease tags:

```sh
VERSION=vX.Y.Z # replace with a published compatible release tag
curl --disable --proto '=https' --proto-redir '=https' -fsSL \
  "https://raw.githubusercontent.com/rhizomatous/flora/$VERSION/scripts/install.sh" |
  sudo sh -s -- --public-url https://flora.example.com --version "$VERSION"
```

**Availability:** no compatible installer release has been published yet. Older
alpha archives have a different startup contract and cannot be used here. The
command above needs a publicly readable source tag and release assets. This
repository is currently private, so anonymous raw and release downloads return
404. The installer deliberately has no GitHub token handling. Do not put tokens
in these URLs or arguments.

The candidate script is already committed at
[`8b53d6b8989d6d25a4d2d66705bb754838790a4e`](https://github.com/rhizomatous/flora/blob/8b53d6b8989d6d25a4d2d66705bb754838790a4e/scripts/install.sh),
without needing a new release tag. Authorized maintainers can retrieve its exact
source with their existing GitHub CLI login for inspection:

```sh
gh api -H 'Accept: application/vnd.github.raw+json' \
  'repos/rhizomatous/flora/contents/scripts/install.sh?ref=8b53d6b8989d6d25a4d2d66705bb754838790a4e' > install.sh
```

The script requires root and both flags. It detects amd64 or arm64, downloads only
the selected release archive and its checksums over HTTPS, verifies the checksum
and embedded binary identity, then installs `/opt/flora/flora` and starts a small
root-run `flora.service` with private `/var/lib/flora` storage. Root is needed for
the managed private broker and local Docker. It enables the service for boot and
waits for loopback health and the private enrollment file before reporting success.
The code goes only to `/dev/tty`; without a controlling terminal, only its file
path is printed. No credentials are requested by the script.

Existing binary, data or service paths are refused, including repeat invocations.
This is a fresh-install command, not an upgrade command. A failed installation
removes only its newly installed binary and service. Any generated application
data and Docker state are retained for inspection and same-release recovery.

To inspect before running, download the script to a file and run
`sudo sh install.sh --public-url https://flora.example.com --version "$VERSION"`
after reading it. Same-release checksums detect corruption, not compromise of the
source you chose to trust.

## Manual download and run

Choose an explicit published release with `-public-url` and managed private
networking support. Older experimental releases use different startup contracts.
No Go, Node, Nix, OpenCode installation or Docker CLI is needed by the binary.
Allow outbound HTTPS to GHCR, GitHub and your hosted model provider. Plan for the
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
The archive contains the binary, release identity, license, guides, `install.sh`
and an optional systemd example. Manual startup does not install a service.

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

In Settings, save hosted model and GitHub credentials. Provider/model selection
is fixed after first save. Use a fine-grained GitHub token limited to intended
repositories, with Contents and Pull requests read/write and Metadata read. Add
Workflows write only if needed. Chat capabilities can use all permissions of that
token. Run Check dependencies, then create a project and chat. Metadata checks do
not prove inference quota or repository writes. Startup performs no paid inference
or GitHub writes. See [agent transport limits](agent/README.md).

## Service and recovery

The installer creates and enables the service for you. For a manual installation,
copy the verified binary to `/opt/flora/flora`. Adapt `flora.service` with your
canonical URL and install it yourself at `/etc/systemd/system/flora.service`.
The example runs as root. A non-root service needs Docker socket access, the two
network capabilities above and writable private storage; Docker remains root
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
Never copy a live Docker data root or running workspace. Backups contain plaintext
credentials, login sessions, repository data and signing keys. Keep them encrypted
offline with mode 0600 in a 0700 directory. Restore only the same release and
architecture, same absolute paths and numeric identity, and matching Docker state,
while everything is stopped. Never run original and restored copies together.
Restore can revive old sessions or capabilities, so replace compromised upstream
keys and keep browser access restricted until recovery is checked.

## Maintainer release control

Only explicit version tags run release publication. Normal PRs publish no images,
tags or releases. The tag workflow checks that a release does not already exist,
publishes one multi-platform agent image, and embeds its actual registry digest
and canonical source commit into both binaries. Native amd64 and arm64 jobs check
the archived bytes before publication without rebuilding. Prereleases cannot become
the latest stable release. A failed verification can leave an image tag but no
release. Never retag or overwrite a published release. Build dependencies include
floating Alpine packages, so archives are not claimed to be reproducible.
