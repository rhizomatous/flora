# Flora ✿

A self-hosted autonomous coding agent. Describe a task, let the agent work, then
return to review its changes and open a draft pull request.

**Status:** application bootstrap (M0). The binary serves a minimal React shell
and `GET /api/health`. Agent execution, onboarding, and project management are
subsequent milestones. See the [roadmap](https://github.com/rhizomatous/flora/issues/20)
and [product requirements](specs/PRD.md).

## Develop

Install [Nix](https://nixos.org/download/) with flakes and `nix-command` enabled.
The committed `flake.lock` pins the development environment on Linux and macOS
(x86-64 and ARM64): Go 1.26, Node.js 24 with npm, Make, and Git.

```sh
nix develop
make deps
make check smoke build-linux
./bin/flora
```

Open <http://127.0.0.1:8080>. The server binds to loopback by default; override with
`./bin/flora -listen 127.0.0.1:9000`. It handles SIGINT/SIGTERM gracefully.
Neither Docker nor a model-provider credential is needed for this bootstrap.

For fast frontend iteration, run `npm run dev` inside the development shell.
Vite serves the web app and proxies `/api` to a backend on port 8080. After a web
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

## Repository layout

- `backend/`: Go module, HTTP server, executable, and embedded web assets.
- `web/`: React/TypeScript application, built with Vite and Tailwind.
- `florets/`: shared React components and shadcn-compatible semantic CSS tokens.
- `agent/`: home for the upcoming pinned agent image and runtime probes.
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
`database/sql` driver. All builds and tests use `CGO_ENABLED=0`; a test writes a
database, closes it, reopens it, and checks persistence. Product schemas and data
directories belong to issue #4. The health route is process liveness only.

`flake.lock`, `package-lock.json`, and `backend/go.mod`/`go.sum` pin tooling and
dependencies. Builds use `GOTOOLCHAIN=local` and readonly Go modules. To update,
deliberately update the relevant lockfile, then rerun the documented checks.
The initial build downloads dependencies; it is not an offline Nix derivation.
