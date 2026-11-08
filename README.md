# Flora ✿

A self-hosted autonomous coding agent. Describe a task, let the agent work, then
return to review its changes and open a draft pull request.

**Status:** authenticated projects and persistent browser chats with full activity,
follow-ups, runtime questions, reconnectable saved events, and separate interrupt
and container stop controls. Chat execution uses the pinned agent image and
private host-side GitHub transport. Changes review retains committed and uncommitted
diffs and verified PR links. Restart reconciliation reconnects to surviving work;
failed execution requires explicit new input and is never automatically replayed.
Multi-repository projects, capacity controls, settings, and completion notifications
are implemented. Release acceptance and publication are tracked on the roadmap.
See [agent setup](agent/README.md), the [roadmap](https://github.com/rhizomatous/flora/issues/20)
and [product requirements](specs/PRD.md).

## Develop

For Linux installation, provide local rootful Docker and Tailscale Serve or an
existing HTTPS proxy in front of loopback HTTP 8080. The POSIX shell installer
downloads the most recent published release for amd64 or arm64, including
prereleases, verifies it, installs Flora and starts a systemd service. An explicit
version is optional. See the [installation and operations guide](INSTALL.md) for
the one-command install, prerequisites, release availability and offline recovery.

Install [Nix](https://nixos.org/download/) with flakes and `nix-command` enabled.
The committed `flake.lock` pins the development environment on Linux (x86-64 and
ARM64) and macOS (ARM64): Go 1.26, Node.js 24 with npm, Make, Git, curl, jq, and
ripgrep. The flake also declares Intel macOS, but the current nixpkgs pin has
dropped support for it, so that shell cannot currently be evaluated.
Make and Git support the build and source workflows; curl and jq are useful for
calling the backend and inspecting JSON responses, and ripgrep searches the
Go/TypeScript source tree. The scripts do not require these last three tools.

```sh
nix develop
make deps
make check smoke build-linux
# On Linux with Docker and a locally built agent image:
sudo ./bin/flora -public-url https://flora.example.com -agent-image IMAGE@sha256:DIGEST
```

Put an HTTPS reverse proxy in front of <http://127.0.0.1:8080> and open the
`-public-url` address. This required flag is the browser origin used to reject
cross-site changes. Forwarded headers are not trusted. Secure session cookies
require HTTPS, including during browser development. The server binds to loopback
by default; override with `-listen 127.0.0.1:9000`. It handles SIGINT/SIGTERM gracefully.
Storage defaults to `./flora-data`; set `-data-dir /absolute/path/to/private/data`
for a stable service location. Keep this directory on persistent local storage,
owned by the application user, outside any agent mount. Unusable storage or an
unsupported newer schema prevents startup before HTTP begins listening.
Unit checks do not need Docker or provider credentials. Running the app requires
Linux, local rootful Docker and a pinned agent image.

Create the administrator with the private enrollment code from the terminal or
`data-dir/deployment/enrollment-code`.
Only the first account creation succeeds. Sessions expire seven days after login by default;
logout immediately revokes that session on the server. All API data routes require
authentication, except health and account status. Login and setup require the
configured same-origin HTTPS address.

Settings accept a fine-grained GitHub token and an OpenAI, Anthropic, or Google
API key. Save validates the GitHub account and access to the chosen model through
the provider's model metadata endpoint. This initial account check does not
validate repository permissions. Provider and model
are fixed on first save; keys can be replaced later. Blank keys keep saved values.
HTTP responses expose non-secret settings and whether each key is saved, never key values.
Credentials are stored in the private SQLite database, not encrypted separately.
Protect the storage directory and backups, and never mount them into agents.

Installation settings also control container capacity, CPU/memory/process limits,
setup and continuous-activity timeouts, inline diff and message sizes, absolute
session lifetime, notification sound, and Git author. CPU, memory, processes,
setup timeout and Git author are saved with each new chat. Existing chat snapshots
are unchanged, including on restart. Older chats keep the original defaults.
Capacity applies to future starts without stopping running containers. An explicit
`-max-running` flag overrides the saved cap until removed and Flora restarted.
Activity timeout changes apply to all active work at the next check. Message and
diff limits apply to future submissions and views; saved full diffs remain available.
Session lifetime changes affect new logins, never existing expiry times.

**Check dependencies** probes storage, Docker, the local agent image and credential
metadata without generating model responses, pulling images or writing to GitHub.
Successful metadata validation does not establish inference quota or repository
write access. Setup and runtime failures remain visible in each chat's saved activity.

### Chat UI preview

Run `npm ci`, then `npm run preview:chat` and open the loopback URL printed by Vite.
The sidebar includes working, completed, waiting-for-an-answer, recovered-failure,
and long-response chats. The preview uses the real app components, API requests,
and EventSource connection. Its toolbar can replay, pause, or resume the working
chat. Reload restores hidden controls. Playback is shared by tabs on that dev server.

This mode needs no backend, Docker, credentials, or model access. All API routes
are intercepted locally; mutations return a read-only error and unknown routes
never reach an installation. Changed-file review data is illustrative. The preview
plugin and fixtures are not included in production builds.

Message and question fixtures were captured from Flora's pinned OpenCode 1.2.27
server using a local deterministic Anthropic-compatible provider. OpenCode executes
the tools and produces the payloads; only the temporary workspace path is replaced
with `/workspace`. The committed captures are checked against that exact SDK version.
Flora's saved-message and activity envelopes are constructed separately, since the
browser does not consume OpenCode's API directly. This is a UI fixture, not a claim
that the sample prose came from a live model.

To recapture, install OpenCode **1.2.27** separately, then run
`OPENCODE_BIN=/absolute/path/to/opencode npm run preview:capture` followed by
`npm run format` and `npm run check`. The capture command rejects other versions,
uses temporary HOME/XDG directories, disables project config and default plugins,
and supplies only a local provider with a fake key. It runs a bounded shell check
and a missing-file read in its temporary workspace. No existing OpenCode sessions
or credentials are used. Update the image, SDK pin, and captures together when
changing the runtime version.

### Enable chat execution

Build the pinned image as described in `agent/README.md`, then supply
`-agent-image` with its digest-pinned reference. For a local build, also supply
`-agent-image-digest` with its recorded `name@sha256:...` identity and
`-agent-image-id` with the expected Docker content ID. The harness version is
fixed to the image's OpenCode 1.2.27. Docker must run on the same host as Flora's
storage. `-docker-socket` defaults to `/var/run/docker.sock`.

Every app startup manages an owned private Docker bridge and broker CA, independent
of browser HTTPS. The broker uses the bridge gateway on TCP 443 and binds to the
bridge device, requiring root or CAP_NET_RAW plus CAP_NET_BIND_SERVICE. Agents
receive the private hostname mapping and public CA automatically. The
administrator's GitHub token stays on the host. See the installation guide.

After saving installation credentials and connecting a project with one core
repository, choose **Start chat**. New containers receive the installation's
provider key and fixed model. Replacing a saved key does not change an existing
container's environment. Follow-ups use the existing endpoint, workspace, and
OpenCode session without rotating its git/gh capability.

Messages accept up to 128 KiB of decoded UTF-8 by default, editable in settings. An accepted request identity
deduplicates retries, including after completion. New requests during active
work are rejected instead of queued. Browser disconnection does not cancel work;
saved events replay in order on reconnect. OpenCode has no upstream replay cursor,
so a runtime stream disconnection records a visible capture gap. Uncertain
delivery remains blocked and is never automatically resent. Saved status alone
does not prove runtime liveness after an application restart. Before delivering a
follow-up, Flora checks that the existing runtime session is idle. An uncertain
or busy runtime remains blocked until an explicit interrupt or container stop.

**Interrupt current work** keeps the container running. Flora waits for terminal
runtime parts, closes OpenCode's workspace resources including language-server
clients, and verifies that tool processes have exited before allowing new work.
Language servers start again on demand in later work. Background jobs or custom
services that survive resource shutdown can prevent confirmation. A service still
starting during disposal may also survive and require a container stop. The chat
remains blocked until teardown is confirmed. Question replies are also blocked
after capture has been abandoned, so they cannot restart unmonitored work. Interrupt during
preparation requires a container stop because no runtime session exists to abort yet.
**Stop container** frees capacity after Docker confirms the stop. Both controls
preserve workspace, conversation, and saved activity. Send a new message to resume
a stopped chat in the same container and session. Successful setup does not rerun,
and the interrupted turn is never automatically replayed. Missing containers are
not automatically replaced.

Setup progress uses bounded previews, capped at 1 MiB of saved progress plus a
final preview. When setup ends, Flora retains the complete redacted output once
as an authenticated log download. Preview omissions and full-log capture failures
are explicit in the saved activity. Waiting for a user question pauses the
continuous-activity timer; provider retries still count as active work.
The active turn checks pending questions independently of the browser and SSE.
Failed checks preserve known waits, and stale checks cannot undo newer questions
or confirmed answers.

The pinned runtime may buffer prompt response headers until a turn ends. Flora
bounds the wait for acceptance evidence and for a response after saved completion,
rather than imposing a short header deadline on valid work or question waits.
An unresponsive history/capture path also ends the HTTP worker with delivery
marked uncertain. These bounds never authorize resending an accepted message.

For a no-paid-provider runtime integration check, build a uniquely named local
agent image and run `FLORA_CHAT_TEST_IMAGE=<local-tag> go -C backend test -v
-run TestChatDocker ./internal/chat` inside the Nix shell. It uses a local
Anthropic-compatible fixture with the real pinned runtime, setup, Git workspace,
bash tool, questions, and follow-ups. On native Linux, set
`FLORA_CHAT_PROVIDER_HOST` to a host address reachable from the container.
Set `FLORA_CHAT_TEST_LSP=1` to install Go and gopls during the fixture's setup and
verify interruption with a real connected language server, followed by lazy LSP
restart in the same saved session. CI enables this coverage.

For the Chromium app check, run `npx playwright install chromium` and
`make browser` in the Nix shell. This launches the compiled UI against the real
authenticated app APIs and a deterministic runtime HTTP fixture. It checks chat
creation, reload during execution, question/answer, full output/model metadata, follow-up,
reconnect, grouped listing, mobile width, and logout protection.

For fast frontend iteration, run `npm run dev` inside the development shell.
Vite serves the web app and proxies `/api` to a backend on port 8080. For interactive
login, proxy Vite through HTTPS and use that origin as `-public-url`. After a web
change, rebuild the Go binary to update its embedded production assets.

| Command | Purpose |
| --- | --- |
| `make deps` | Install exact npm lockfile dependencies and download Go modules |
| `make web` | Type-check and compile the React app into Go's embed directory |
| `make build` | Build web assets and the native `bin/flora` binary |
| `make check` | Build web, check TypeScript and Go formatting, run vet and Go tests |
| `make smoke` | Build and exercise the native binary from outside the source tree |
| `make build-linux` | Build standalone Linux binaries for amd64 and arm64 |

GitHub Actions uses Nx to select tasks from the whole PR diff. Main-branch pushes
run every check. Florets and web changes run frontend, browser, and binary smoke
checks without starting container or native packaging jobs. Backend changes run
Go, browser, container, and packaging checks. Shared configuration and scripts
trigger all checks. Documentation-only changes skip runtime checks, including
edits to documents shipped in archives.

Inside the Nix shell after `make deps`, inspect or run tasks with:

```sh
npx nx affected -t frontend-check,styleguide,go-check,race,smoke --base=origin/main --graph
npx nx affected -t frontend-check,styleguide,go-check,race,smoke --base=origin/main
npx nx run backend:browser
npx nx graph
```

Nx caches web and styleguide builds locally in `.nx/cache`. Tests run fresh when
selected. Task inputs are declared in `nx.json`, package manifests, and
`project.json` files. Container and packaging tasks require a disposable native
Linux runner with Docker; packaging also requires systemd, shellcheck, and sudo.
The `result` CI job fails if task selection or any check fails or is cancelled.
It can be used as the required branch check.

The Make commands remain available. One-shot commands work too:
`nix develop --command make check smoke build-linux`. Before newly created Nix
files are tracked by Git, use `nix develop path:.` so Nix includes them.

### Automatic shell activation with direnv (optional)

Install [direnv](https://direnv.net/) and
[nix-direnv](https://github.com/nix-community/nix-direnv) on your host, outside
the development shell. For example, using Nix's default user profile:

```sh
nix profile add nixpkgs#direnv nixpkgs#nix-direnv
```

Add `eval "$(direnv hook zsh)"` to `~/.zshrc` (or
`eval "$(direnv hook bash)"` to `~/.bashrc`). Add this line to
`~/.config/direnv/direnvrc`, creating the directory and file if needed:

```sh
source "$HOME/.nix-profile/share/nix-direnv/direnvrc"
```

If you install nix-direnv another way, use its installed `direnvrc` path instead;
skip this line if your host configuration already enables nix-direnv. Restart
your shell, then run this once from the repository root after reviewing `.envrc`:

```sh
direnv allow
```

The committed `.envrc` uses `use flake` to load the same locked environment as
`nix develop`. Direnv activates it when you enter the repository and restores
your environment when you leave; nix-direnv caches it for faster re-entry.
Local `.direnv/` state is ignored. Re-run `direnv allow` after approving changes
to `.envrc`. Manual `nix develop` and CI do not need direnv or any host hook.

### Florets documentation

Run `npm run docs:dev` to browse the documentation at <http://127.0.0.1:5176>.
The site lives in `florets/docs/` and uses the library directly. Searchable component
and AI pattern pages include live examples, copyable source, and on-page navigation.
Foundation pages cover setup, themes, typography, and identity. Full-page sidebar
examples run in isolated preview frames. The site supports light and dark themes
and mobile navigation, and needs no backend. Import components from `@flora/florets`
and the shared theme from `@flora/florets/styles.css`. The `@flora/florets/ai` entry
point uses the same components and theme. `florets/components.json` records the
Radix/Nova registry configuration. `florets/docs/src/examples/upstream.json` records
the source URLs and original source hashes for the imported example collections.
Use `npm run docs:build` to produce a standalone static site in `florets/docs-dist/`,
and `npm run docs:preview` to preview that build. `make check` builds the guide too.

## Repository layout

- `backend/`: Go module, HTTP server, executable, and embedded web assets.
- `web/`: React/TypeScript application, built with Vite and Tailwind.
- `florets/`: shared shadcn Radix/Nova components, AI elements, and theme.
- `agent/`: pinned agent image and container integration checks.
- `specs/`: authoritative product requirements and visual direction.
- `scripts/`: standalone-binary smoke test.

Npm workspaces and Make provide the small amount of build coordination needed.
Generated assets, dependencies, and binaries are ignored. `make web` must precede
direct Go commands because `go:embed` requires its input files to exist; Make's
build/check targets enforce this order. There is no placeholder bundle to hide a
missing frontend build.

## Single-binary contract

Vite outputs into `backend/internal/webassets/dist/`; Go embeds the complete build
at compile time. Copying only `bin/flora-linux-amd64` (or the ARM64 equivalent) to
a Linux host is sufficient to run the application. Chat execution also needs Docker,
the pinned agent image, and the configuration in the installation guide. No Node.js,
source tree, external asset directory, C runtime, or SQLite shared library is needed
at runtime.

SQLite uses [`modernc.org/sqlite`](https://pkg.go.dev/modernc.org/sqlite), a pure-Go
`database/sql` driver. All production builds and checks use `CGO_ENABLED=0`.
Embedded SQL migrations initialize the product schema at startup. Storage tests
cover reopen persistence, immutable chat configuration, request deduplication,
concurrent submissions, rollback, and migration failures. The health route is
process liveness only; it does not claim runtime or container readiness.

`flake.lock`, `package-lock.json`, and `backend/go.mod`/`go.sum` pin tooling and
dependencies. Builds use `GOTOOLCHAIN=local` and readonly Go modules. To update,
deliberately update the relevant lockfile, then rerun the documented checks.
The initial build downloads dependencies; it is not an offline Nix derivation.
