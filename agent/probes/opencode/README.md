# Pinned OpenCode execution probe

Issue [#2](https://github.com/rhizomatous/flora/issues/2), contract and decisions:
[runtime ADR](../../../specs/ADR-002-opencode-runtime.md).
This is an isolated M0 experiment, not the production agent image or an HTTP API
exposed to browsers. It adds no Go dependencies.

## Offline checks

From the repository root:

```sh
nix develop --command go -C backend test -race ./cmd/probe-opencode
bash -n agent/probes/opencode/probe.sh
sh -n agent/probes/opencode/entrypoint.sh
```

The Go tests use a fake HTTP server. They verify authentication/version checks,
the actual prompt and answer request shapes, completion versus idle races,
interruption confirmation, SSE framing, deadlines and error-body redaction.
They are **not** live OpenCode or provider evidence.

## Live Docker checks without a provider credential

These tests use the real pinned OpenCode server. They deliberately inject an
invalid sentinel key and only call `noReply` storage and shell APIs, never model
generation. They cannot establish successful model responses or question answers.

```sh
docker build -t flora-issue2-validation:1.2.27 agent/probes/opencode
FLORA_OPENCODE_TEST_IMAGE=flora-issue2-validation:1.2.27 \
  nix develop --command go -C backend test -race -count=1 -v -run TestDockerWithoutProvider ./cmd/probe-opencode
```

The opt-in test verifies actual auth/readiness, config/prompt and question-tool
registration, selected `/doc` routes, stored messages, shell output/interruption,
HTTP and SSE disconnect/reconnect during execution, stop/start and replacement
persistence, setup-once counts, passwordless sudo/package installation, setup
failure/timeout/retry, and SIGKILL/restart diagnostics. It has a four-minute
deadline and removes its own containers and volumes, including after test failure.
It does not touch other containers or credential stores. Ordinary `make check`
skips it unless `FLORA_OPENCODE_TEST_IMAGE` is set. To test amd64 on an arm64 host,
build with `--platform linux/amd64` and use a separate image tag in that variable.

Both arm64 and emulated amd64 passed on 2026-10-26 UTC. One important runtime
finding: `/shell` exposes a running tool part without reporting a busy session
status. Interruption therefore watches the new persisted part, not just status.
After SIGKILL, the last persisted part still said `running` while runtime status
was absent. The test verifies snapshot access and a new explicit shell operation;
this is not automatic resumption of an interrupted tool or model turn.

## Live Docker + hosted model run

Prerequisites: a running Docker daemon, registry/network access, an explicitly
supplied Anthropic API key authorized for `claude-sonnet-4-6`, and a fresh private
runtime password. Do not reuse the GitHub administrator token. Do not mount host
OpenCode config, auth stores, the Docker socket, or another chat's data.

Use your secret manager to export `ANTHROPIC_API_KEY` and
`OPENCODE_SERVER_PASSWORD`. Values are deliberately not shown here. Create an
empty private evidence directory outside the checkout, then run:

```sh
nix develop --command bash agent/probes/opencode/probe.sh /absolute/private/evidence-directory
```

For the initial validation environment, `ANTHROPIC_API_KEY` was unset and the
standard OpenCode auth store had no Anthropic API-key entry. The user later
supplied a local test environment and the full model probe passed on 2026-10-27
UTC, along with the extended drills below. Other provider credentials were not
copied. For another run, supply an
Anthropic API key with access to `claude-sonnet-4-6` through the environment or
your secret manager, and generate a fresh random runtime password. Do not paste
either secret into an issue, PR, terminal command argument or committed file.

The script creates a unique image, container and two volumes, with loopback-only
publication on a random port, 2 CPU / 8 GiB / 512 PID limits, no privileged mode
and no host mounts. Passwordless sudo is intentional inside the sandbox. Model
credentials are allowed inside this trusted single-administrator agent boundary;
GitHub administrator credentials are not. Model turns can incur provider costs.

The script builds the Go driver, requires an exact healthy runtime version and
401 responses without auth, saves `/doc`, and records live SSE. It creates one
session, sends two turns against a marker file, requires recorded bash output,
answers an actual question-tool request, interrupts a deterministic 60-second
shell operation, and sends another model turn. Each driver invocation has an
overall deadline (5 minutes by default), body/frame limits are 16 MiB, and
readiness retries are bounded. Docker build/network operations use Docker's own
timeouts; interrupt the script if the daemon or registry stalls.

Then new driver processes reconnect, stop/start the same container, and replace
the container using the same volumes. New turns must read the marker with bash.
The script verifies setup ran once on stop/start and twice after replacement,
and compares message/part identities, tool output and model metadata before and
after. It checks for actual message, part, status and question events, not merely
an open SSE connection. Reconnection explicitly reports an activity gap.

Evidence includes `image-id`, `container-name`, `session`, `openapi.json`,
`history-before.json`, `history-after.json`, `events.ndjson` and
`events-reconnected.ndjson`. Logs and evidence can contain private workspace
content. Never commit these files or raw `docker inspect` output, which includes
injected secrets. Failed runs retain the container and volumes for diagnosis.
Setup output/exit status are in `/home/flora/setup/` on the home volume. Setup
failure or timeout prevents server startup; another start retries failed setup.

Cleanup explicitly after inspecting evidence (substitute the recorded name):

```sh
docker rm -f CONTAINER_NAME
docker volume rm CONTAINER_NAME-home CONTAINER_NAME-workspace
docker image rm CONTAINER_NAME
```

## Individual probes and remaining drills

Build `go -C backend build -o /absolute/private/probe ./cmd/probe-opencode` in
`nix develop`. The password comes only from `OPENCODE_SERVER_PASSWORD`.

```sh
/absolute/private/probe -url http://127.0.0.1:PORT -mode ready
/absolute/private/probe -url http://127.0.0.1:PORT -mode events -timeout 30s
/absolute/private/probe -url http://127.0.0.1:PORT -mode questions
/absolute/private/probe -url http://127.0.0.1:PORT -mode answer -request que_ID -answers '[["Yes"]]'
/absolute/private/probe -url http://127.0.0.1:PORT -mode abort -session ses_ID
/absolute/private/probe -url http://127.0.0.1:PORT -mode inspect -session ses_ID
/absolute/private/probe -url http://127.0.0.1:PORT -mode recover -session ses_ID
```

`events` intentionally exits nonzero at its deadline or EOF. It does not silently
retry or imply replay. `inspect` preserves the complete JSON history, including
unknown fields. `turn -text '...'` fails on unexpected questions rather than
approving actions. Only `scenario` automatically answers its requested probe
question with the first option. No production approval UI is implemented.

Extended manual acceptance, observed across 2026-10-26/27 UTC and needed when
repeating the complete acceptance exercise:

1. Run `turn` asking for a question. Once `questions` shows it, terminate only
   that driver process if it has not already exited reporting an unexpected
   question, leaving the runtime running. Reconnect events and inspect
   history/questions from a fresh process, answer via `answer`, and verify work
   finishes. This tests disconnect **during** work, not just idle reconnection.
2. Restart the runtime during a running tool and while a question is pending.
   Save the pre-restart snapshot. Reconcile persisted parts with missing status
   and pending requests. Do not resend the original turn automatically. Record
   the interruption and visible gap, then explicitly send a new turn.
3. Test setup exit failure and timeout with disposable containers using
   `SETUP_COMMAND='exit 23'` and `SETUP_COMMAND='sleep 30'` plus
   `SETUP_TIMEOUT_SECONDS=1`. Confirm no server starts, exit statuses are 23/124,
   logs survive and a failed setup is retried on the next start. Verify setup can
   install a package using sudo. Never reuse a successful container marker for
   the failure tests.

Also exercise a **model-issued** long bash command, not only `/shell`: wait for
its running part, abort, confirm the delayed side effect did not happen, then
explicitly send another model turn that reads the existing marker. Repeat with
SIGKILL/restart instead of abort. The 2026-10-27 model run passed both. After kill,
the saved tool part remained `running` despite absent runtime status; explicit
new-turn reconciliation worked, but automatic in-flight continuation is not
provided. See the ADR for question-restart results, schema comparison and
runtime-reported cost. Keep raw evidence private and stop/remove the test
resources after inspection. Do not interpret these results as production UI or
durable activity-store implementation.

Changing the bundled OpenCode configuration requires restarting the runtime.
Existing host OpenCode installations and config are untouched.
