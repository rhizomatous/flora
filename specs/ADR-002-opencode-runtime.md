# ADR 002: Pinned OpenCode execution boundary probe

**Status:** Proposed; live non-provider checks pass, model acceptance blocked.
**Date:** 2026-10-25. **Docker follow-up:** 2026-10-26 UTC.
**Scope:** [issue #2](https://github.com/rhizomatous/flora/issues/2),
[roadmap #20](https://github.com/rhizomatous/flora/issues/20).
[PRD](PRD.md) is authoritative: Agent environment 2.1–2.5, Chats 3.1–3.2,
3.4–3.7, Execution 4.4/4.6 and Recovery 5.3. No production UI or application
lifecycle integration is added by this spike.

## Decision and evidence level

Use one OpenCode HTTP session per chat, one isolated persisted workspace/home
pair per container, and one installation-fixed hosted model. The Go probe lives
in `backend/cmd/probe-opencode/`; Docker inputs and the reproducible lifecycle
script live in `agent/probes/opencode/`. See its [runbook](../agent/probes/opencode/README.md).

| Identity | Pin |
| --- | --- |
| OpenCode | `1.2.27` |
| Upstream source commit | `4ee426ba549131c4903a71dfb6259200467aca81` |
| OCI index | `ghcr.io/anomalyco/opencode:1.2.27@sha256:f2bbfa29335cade41bf6928673582b42c56acbaaa75c0020dba34650adb7ce0a` |
| Linux amd64 manifest | `sha256:763ea3bce6bdaee6d6092775c83c03a90b11b2a74dcfb89942a4cb82a99f974e` |
| Linux arm64 manifest | `sha256:3c0b435b8a6bfb7cc9a7b6a60b4f332218715454ab509677b3bbfe1dab4a8a7a` |
| Hosted provider/model | `anthropic/claude-sonnet-4-6` for primary **and** small-model work |

The tag commit was resolved with `gh api repos/anomalyco/opencode/git/ref/tags/v1.2.27`.
Both manifests and the index digest were retrieved with
`docker buildx imagetools inspect ghcr.io/anomalyco/opencode:1.2.27`, which does
not need the local daemon. This is an explicit API-baseline choice, not a claim
that this is the latest release or a security-reviewed production version.
Runtime bytes are pinned. Added APK utilities still resolve from Alpine's package
repositories; a release build must lock those inputs and publish its final image
digest. The script records the actual derived image ID. Hosted model behavior is
not bit-for-bit reproducible even with an exact model identifier.

**Initial evidence:** upstream source/OpenAPI, registry digests and fake-server
tests. Docker was initially unavailable. On follow-up the user started OrbStack,
and live non-provider tests passed on both Linux architectures, as detailed below.
No host service was started or installed by the agent. The environment did not
have `ANTHROPIC_API_KEY`; a metadata-only check of the standard OpenCode auth store
found no Anthropic API-key entry. No secret values were printed or copied, and no
unrelated provider credential was used. Actual hosted-model responses and question
interactions remain unverified.

## Exact API contract

The complete machine-readable schema is upstream
[packages/sdk/openapi.json](https://github.com/anomalyco/opencode/blob/4ee426ba549131c4903a71dfb6259200467aca81/packages/sdk/openapi.json).
The live script saves authenticated `GET /doc` as `openapi.json` to compare with
that baseline. The OpenAPI document's own `info.version` is not the runtime pin;
use `/global/health.version`. The following are the exact request shapes used
by this probe and the response fields the driver inspects. Other response fields
are retained by `inspect`, not dropped by a reduced application DTO.

All scoped requests carry `x-opencode-directory: /workspace` (the `directory`
query parameter is another supported selector). Paths and casing matter:

| Method/path | Request | Successful response |
| --- | --- | --- |
| `GET /global/health` | none | 200 `{healthy:true, version:string}` |
| `POST /session` | `{title:"Flora issue 2 probe"}` | 200 `Session` |
| `GET /session/{sessionID}` | none | 200 `Session` |
| `POST /session/{sessionID}/prompt_async` | `{agent:"build",model:{providerID:"anthropic",modelID:"claude-sonnet-4-6"},parts:[{type:"text",text:string}]}` | 204, no response body; acceptance is not completion |
| `POST /session/{sessionID}/message` | Same prompt shape plus `noReply:true` for storage-only testing | 200 `{info:UserMessage,parts:Part[]}` with no inference |
| `GET /session/{sessionID}/message` | no limit | 200 `Array<{info:UserMessage\|AssistantMessage,parts:Part[]}>`, complete available history |
| `GET /session/status` | none | 200 `{[sessionID]:SessionStatus}`; idle entries may be absent |
| `POST /session/{sessionID}/shell` | `{agent:"build",command:"sleep 60"}` | 200 `{info:AssistantMessage,parts:Part[]}` after shell finishes; used to interrupt a deterministic tool execution |
| `POST /session/{sessionID}/abort` | no JSON body | 200 boolean; cancellation request, not proof processes have exited |
| `GET /question` | none | 200 `QuestionRequest[]`, pending requests for this runtime instance |
| `POST /question/{requestID}/reply` | `{answers:string[][]}` | 200 boolean |
| `POST /question/{requestID}/reject` | no body | 200 boolean |
| `GET /event` | none | 200 `text/event-stream`, JSON in SSE `data:` frames |

**Confirmed schema discrepancy:** live `/doc` declares `/shell`'s 200 response
as `#/components/schemas/AssistantMessage`, but both architecture runtimes actually
return `{info:AssistantMessage,parts:Part[]}`. Use the observed envelope for this
pin; generated clients that trust the bare-message declaration need an override.
The Docker test checks the actual envelope and reports the declared schema.

Relevant schema definitions, from the pinned OpenAPI and source:

```ts
type Session = {
  id: string; slug: string; projectID: string; directory: string;
  title: string; version: string;
  time: { created: number; updated: number; compacting?: number; archived?: number };
  // Optional parentID, workspaceID, summary, share, permission, revert.
};
type SessionStatus = { type: "idle" } | { type: "busy" } |
  { type: "retry"; attempt: number; message: string; next: number };
type QuestionRequest = {
  id: string; sessionID: string;
  questions: Array<{
    question: string; header: string;
    options: Array<{ label: string; description: string }>;
    multiple?: boolean; custom?: boolean;
  }>;
  tool?: { messageID: string; callID: string };
};
```

IDs have `ses`, `msg`, `prt`, `que` prefixes respectively. Message times are
milliseconds. `UserMessage` requires `id`, `sessionID`, `role:"user"`,
`time:{created}`, `agent`, `model:{providerID,modelID}`. It may also include
`system`, `tools`, `format`, `variant` and `summary`.

`AssistantMessage` requires `id`, `sessionID`, `role:"assistant"`,
`time:{created,completed?}`, `parentID`, **`providerID`, `modelID`**, `mode`,
`agent`, `path:{cwd,root}`, `cost`, and
`tokens:{input,output,reasoning,cache:{read,write},total?}`. Optional fields include
`error`, `finish`, `summary`, `structured` and `variant`. Model identity is on
assistant `info`, not inferred from the currently configured installation model.
Errors include provider authentication/API errors and `MessageAbortedError`.

Parts form a discriminated union, not a string transcript. A `ToolPart` requires
`id`, `sessionID`, `messageID`, `type:"tool"`, `callID`, `tool`, `state`, with
optional part-level metadata. Its state is:

```ts
type ToolState =
  | { status:"pending"; input:Record<string,unknown>; raw:string }
  | { status:"running"; input:Record<string,unknown>;
      time:{start:number}; title?:string; metadata?:Record<string,unknown> }
  | { status:"completed"; input:Record<string,unknown>; output:string;
      title:string; metadata:Record<string,unknown>;
      time:{start:number;end:number;compacted?:number}; attachments?:FilePart[] }
  | { status:"error"; input:Record<string,unknown>; error:string;
      metadata?:Record<string,unknown>; time:{start:number;end:number} };
```

Retain text, reasoning, file/attachment, patch, step, compaction and other part
variants too. Tool output can be truncated by OpenCode with a file pointer in
metadata; persisting the home volume retains these tool-output files. Do not
promise unlimited inline output or treat the latest part snapshot as an archive
of every output delta. Compaction/pruning can also alter older tool state.

`/event` emits `{type,properties}` directly. `/global/event` instead wraps events
as `{directory,payload}` and is not used by this probe. Exact selected payloads:

```ts
{type:"server.connected", properties:{}}
{type:"server.heartbeat", properties:{}} // every 10 seconds
{type:"message.updated", properties:{info:UserMessage|AssistantMessage}}
{type:"message.part.updated", properties:{part:Part}}
{type:"message.part.delta", properties:{sessionID,messageID,partID,field,delta}}
{type:"session.status", properties:{sessionID,status:SessionStatus}}
{type:"question.asked", properties:QuestionRequest}
{type:"question.replied", properties:{sessionID,requestID,answers:string[][]}}
{type:"question.rejected", properties:{sessionID,requestID}}
```

Canonical implementation references at the same pin:
[server/auth/events](https://github.com/anomalyco/opencode/blob/4ee426ba549131c4903a71dfb6259200467aca81/packages/opencode/src/server/server.ts),
[session routes](https://github.com/anomalyco/opencode/blob/4ee426ba549131c4903a71dfb6259200467aca81/packages/opencode/src/server/routes/session.ts),
[prompt/cancellation](https://github.com/anomalyco/opencode/blob/4ee426ba549131c4903a71dfb6259200467aca81/packages/opencode/src/session/prompt.ts),
[question state](https://github.com/anomalyco/opencode/blob/4ee426ba549131c4903a71dfb6259200467aca81/packages/opencode/src/question/service.ts),
[tool registration](https://github.com/anomalyco/opencode/blob/4ee426ba549131c4903a71dfb6259200467aca81/packages/opencode/src/tool/registry.ts).

## Private endpoints, readiness and prompt

`OPENCODE_SERVER_PASSWORD` is mandatory in the entrypoint. Username defaults to
`opencode`; the driver uses HTTP Basic auth. The server listens on `0.0.0.0:4096`
inside the container. The local-only probe publishes it on a random loopback port.
Production should use a private Docker/application network with **no public port**
and no direct browser access. Browser authentication and CSRF checks belong to
Flora Backend. OpenCode's CORS defaults are not a security boundary, and its
`OPTIONS` preflight deliberately bypasses Basic auth.

Readiness requires setup success, unauthenticated health/history/events/mutations
returning 401, and authenticated health reporting `healthy:true` and the exact
version. Model readiness is separately demonstrated by real completed turns;
health does not validate the provider key or model availability. The client
rejects redirects to avoid accidentally forwarding credentials elsewhere.

The bundled `opencode.json` sets `permission:"allow"`, including bash/edit,
external directory and doom-loop permissions. There is no per-action approval
workflow. Genuine user questions are separate. At this pin,
[`OPENCODE_CLIENT` defaults to `cli`](https://github.com/anomalyco/opencode/blob/4ee426ba549131c4903a71dfb6259200467aca81/packages/opencode/src/flag/flag.ts#L112-L115),
and the registry includes the question tool for `app`, `cli` or `desktop`, **or**
when `OPENCODE_ENABLE_QUESTION_TOOL` is true. The `serve` command does not override
that client default, so headless serve does not require the explicit flag. The
probe sets `OPENCODE_ENABLE_QUESTION_TOOL=true` as a safeguard to keep registration
enabled if the client identity is changed; it is not a requirement of headless mode.
The build-agent prompt identifies Flora, permits autonomous tool execution,
requests local commits and limits pushing/draft PR creation to explicit requests.
This overrides the build agent prompt, while runtime environment/instruction
context still exists. Project config is disabled for a controlled spike.

Both `model` and `small_model` are fixed, the provider allowlist contains only
Anthropic, and each prompt explicitly names the same model. A future backend
must reject user model overrides and snapshot this identity per chat. Credential
rotation must reconnect/restart the runtime to reliably reload provider state;
do not silently migrate existing chats to a new model. Configuration changes
require runtime restart. This spike does not implement Flora settings.

## State and lifecycle mapping

| Observed condition | PRD state / action |
| --- | --- |
| provisioning/setup, message delivery, busy execution, stop in progress | **Working** |
| pending question or known retry/external wait | **Waiting**, retain reason; retry carries next/attempt/message |
| assistant/provider error, unexpected runtime exit or unresolved interrupted turn | **Failed**, preserve known history and explanation |
| reconciled running runtime with no work or pending question | **Idle** |
| Docker confirms container stopped | **Stopped**, regardless of empty runtime status |

Missing status alone never proves Idle after disconnect/restart. Session error
events and persisted errors must be reconciled. The driver waits for a **new**
completed assistant message and idle status, so an initial idle poll cannot
mistakenly count as completed work. It does not retry prompt submission. The
runtime permits overlapping prompts; Flora must enforce no queue/follow-ups
during active work itself.

`abort` calls cancel and sets idle immediately, before all command teardown is
necessarily finished. **Live finding:** `/shell` does not report `busy` status,
even while its persisted bash part says `running`. The original probe's status-only
wait therefore failed; it now watches the new tool part before sending abort,
waits for the original request, and checks that part is no longer pending/running
as well as reconciling idle. Production
must additionally reconcile active tool parts and process cleanup. Full
model-driven long-tool interruption remains a live acceptance drill.

For a question, the browser renders each question/options and sends an ordered
array of selected labels (or custom text) through authenticated Flora Backend.
For example `{answers:[["Yes"]]}`. Reject explicitly to dismiss it. The pinned
question implementation silently ignores unknown/stale request IDs even though
the route returns success, so a 200 alone does not confirm an answer was applied.
Reconcile pending requests and subsequent tool state/events. Never replay a stale
answer automatically after runtime replacement.

Persist the **whole home** (OpenCode data/SQLite including WAL, state, config,
logs, caches and tool-output files) and workspace at fixed paths. Stop/start the
**same** container and reuse the same session ID, never create a fresh session
for a normal follow-up. Container replacement uses the same isolated volumes
and pinned runtime. Do not live-copy just the SQLite file; stop first or use a
proper consistent backup strategy.

Setup's success marker is `/var/lib/flora-setup.done` on the container writable
layer, separate from persisted chat data. Successful setup runs once per
container, skips on stop/start, and runs again for a replacement. Setup must be
idempotent against an existing workspace. Output is appended under
`/home/flora/setup/output.log`, latest status is saved in `exit-status`, and the
success marker is written only after exit zero. A timeout/nonzero exit prevents
OpenCode startup and leaves no marker, allowing a subsequent start to retry.
Production must archive setup diagnostics in application-owned storage too.

## Recovery limits and blockers

Source shows session/messages/parts use persisted storage, but execution
controllers, session status and pending question deferreds are process-local.
This means continuation after restart is a **new explicit turn using persisted
context**, not resumption of an in-flight process. A stopped container can be
started and continued; a killed active turn cannot be declared successful or
silently replayed. Pending questions lost on restart require explanation and
explicit new user input, not answering the old request ID.

SSE has no event IDs, cursor, `Last-Event-ID` replay, or durable event log. On a
driver-only disconnect the runtime can keep working; messages and latest parts
can be reread, and pending questions can be listed while that process survives.
Intermediate status transitions, output deltas and event ordering missed while
disconnected cannot be reconstructed exactly. After reconnect, subscribe/buffer
events, read/reconcile the snapshot by stable IDs, then continue live updates.
Flora must persist activity while connected and insert an **explicit activity
gap** for unrecoverable intervals. The probe prints that warning on recovery.

These are incompatible with any assumption that OpenCode alone provides full
durable activity replay or automatic in-flight recovery. They are not grounds
to relax PRD 5.3: the application needs its own durable activity and reconciliation
logic. Live failure drills must confirm that persisted snapshots are usable and
that interrupted tools do not run twice.

## Acceptance still outstanding

### Live non-provider evidence, 2026-10-26 UTC

Built and tested the unchanged digest-pinned Docker inputs with Docker 29.8.2 on
OrbStack (aarch64). arm64 ran natively; amd64 used the host's emulation. Derived
image IDs as returned by `docker image inspect --format '{{.Id}}'`:

| Architecture | Local test image ID |
| --- | --- |
| arm64 | `sha256:62ad0371d6c09a803e229c846a3b18afbb6c691e0aa4f24b7bcc4d005fa60dd3` |
| amd64 | `sha256:5f29bdf894c56fadc38740066ec731170e7c595cc8c221911a093d1862563184` |

Reproduce with the runbook's `FLORA_OPENCODE_TEST_IMAGE` command. Both executions
of `TestDockerWithoutProvider` passed under Go's race detector (about 11 and 20
seconds respectively). The test uses an intentionally invalid sentinel key, never
calls model generation, and automatically removes its own containers and volumes.
Observed on **both** architectures:

- Authenticated exact-version health; unauthenticated health/session/event/mutation
  rejection; actual fixed config and Flora agent prompt; registered question tool;
  selected live `/doc` paths. This checks parsing/registration, not provider access
  or a complete schema diff.
- Two `noReply` user messages in one session; actual bash command output; a new
  explicit shell operation after confirmed interruption. Shell responses use an
  `info`/`parts` envelope despite the upstream declaration noted above.
- Actual `server.connected`, message, part and status SSE events. HTTP caller and
  SSE disconnect while a shell runs, then a fresh client/SSE stream receives the
  completion and recovers the command's resulting file without replaying it.
- Identical persisted message IDs, part JSON, stored model fields and workspace
  marker after stop/start and replacement. Setup count is one after same-container
  restart and two after replacement. These model fields are runtime metadata for
  stored/shell messages, **not evidence of provider-generated responses**.
- Setup installs `jq` with passwordless sudo as uid 1000. Exit 23 and timeout 124
  prevent startup and preserve logs/status. Restart retries setup; the initially
  failing setup succeeds on its second attempt, and timeout is attempted twice.
- SIGKILL during a 30-second shell, then restart: `/session/status` has no entry,
  the saved last tool state is still **`running`**, and no question is pending
  (none was generated in this test). The shell's delayed side-effect file is
  absent at reconciliation. Existing history/workspace and a new explicit shell
  call remain usable. **Stale running parts must not be interpreted as live work,
  success, or automatic resumed execution.** Pending-question loss still needs a
  real question drill.

### Remaining hosted-model acceptance

Local verification on 2026-10-25 passed:
`nix develop --command make deps`,
`nix develop --command make check smoke build-linux`,
`go test -race` for the probe inside `nix develop`, shell syntax checks and
`git diff --check`. The repository check includes Go vet/tests, frontend type
checks/build, standalone-binary smoke test, and Linux amd64/arm64 builds.
`npm ci` reported zero vulnerabilities and a warning about the optional
`fsevents` install script not being allowlisted. No dependency files changed.

- [x] Build/run both pinned architecture images and non-provider lifecycle checks.
- [ ] Run the full hosted-model script with a suitable explicit provider key.
- [ ] Observe two real successive turns, complete parts/tool output/model metadata
  and live event schemas; compare saved `/doc` with the pinned upstream schema.
- [ ] Observe question asked/replied and interrupt a real model-driven tool, then
  continue without per-action approvals. The scripted deterministic shell covers
  the cancellation path but does not prove every model/tool cancellation behavior.
- [x] Observe caller/SSE disconnect during shell execution and reconnect/completion.
- [ ] Observe driver disconnect during model/question work, then answer/finish.
- [x] Observe stop/start/replacement preserving stored message IDs, tool outputs,
  workspace and setup counts; verify new explicit shell continuation.
- [x] Drill active shell restart and setup failure, timeout, retry and sudo.
- [ ] Verify actual model-context continuation after stop/start/replacement and
  model-tool restart behavior; drill real pending-question loss and visible gaps.
- [ ] Lock final utility-image inputs before production; review the runtime pin's
  security suitability and provide application-owned durable activity storage.

Until this evidence is attached, issue #2 remains open and this PR is draft.
