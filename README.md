# Flora ✿

A self-hosted autonomous coding agent. Describe a task, let the agent work, then
return to review its changes and open a draft pull request.

**Status:** administrator onboarding, protected settings, projects, and durable storage.
The binary serves first-time account creation, login/logout, and hosted-model
and GitHub credential settings. Container provisioning and host-side GitHub
transport are available as backend services; browser chat execution is not wired
yet. See [agent setup](agent/README.md), the [roadmap](https://github.com/rhizomatous/flora/issues/20)
and [product requirements](specs/PRD.md).

## Develop

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
./bin/flora -public-url https://flora.example.com
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
Neither Docker nor a model-provider credential is needed for these checks.

Create the administrator before exposing a new installation to other people.
Only the first account creation succeeds. Sessions expire seven days after login;
logout immediately revokes that session on the server. All API data routes require
authentication, except health and account status. Login and setup require the
configured same-origin HTTPS address.

Settings accept a fine-grained GitHub token and an OpenAI, Anthropic, or Google
API key. Save validates the GitHub account and access to the chosen model through
the provider's model metadata endpoint. This initial account check does not
validate repository permissions. Provider and model
are fixed on first save; keys can be replaced later. Blank keys keep saved values.
HTTP responses expose only the provider, model, and whether each key is saved.
Credentials are stored in the private SQLite database, not encrypted separately.
Protect the storage directory and backups, and never mount them into agents.

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

The same commands run in GitHub Actions on Linux. One-shot commands work too:
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

## Repository layout

- `backend/`: Go module, HTTP server, executable, and embedded web assets.
- `web/`: React/TypeScript application, built with Vite and Tailwind.
- `florets/`: shared React components and shadcn-compatible semantic CSS tokens.
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
a Linux host is sufficient to run the bootstrap. No Node.js, source tree, external
asset directory, C runtime, or SQLite shared library is needed at runtime.

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
