# ADR 002: Pinned OpenCode execution boundary probe

**Status:** Proposed, live acceptance blocked. **Date:** 2026-10-25.
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

**Actually observed:** upstream source and checked-in OpenAPI at this commit,
registry digests, and local fake-server Go tests. **Not observed:** a running
container, an actual model response, or any live session/interruption/recovery.
`docker info` failed because the configured OrbStack Unix socket does not exist.
No host service was started or installed. No suitable provider key was explicitly
supplied to this probe; no host credential stores were read or copied.

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
| `GET /session/{sessionID}/message` | no limit | 200 `Array<{info:UserMessage\|AssistantMessage,parts:Part[]}>`, complete available history |
| `GET /session/status` | none | 200 `{[sessionID]:SessionStatus}`; idle entries may be absent |
| `POST /session/{sessionID}/shell` | `{agent:"build",command:"sleep 60"}` | 200 `AssistantMessage` after shell finishes; used to interrupt a deterministic tool execution |
| `POST /session/{sessionID}/abort` | no JSON body | 200 boolean; cancellation request, not proof processes have exited |
| `GET /question` | none | 200 `QuestionRequest[]`, pending requests for this runtime instance |
| `POST /question/{requestID}/reply` | `{answers:string[][]}` | 200 boolean |
| `POST /question/{requestID}/reject` | no body | 200 boolean |
| `GET /event` | none | 200 `text/event-stream`, JSON in SSE `data:` frames |

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
workflow. Genuine user questions are separate: **headless serve requires
`OPENCODE_ENABLE_QUESTION_TOOL=true`**, otherwise the registry omits that tool.
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
necessarily finished. The deterministic shell probe waits for its original
request to finish and reconciles idle before the next model turn. Production
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

Local verification on 2026-10-25 passed:
`nix develop --command make deps`,
`nix develop --command make check smoke build-linux`,
`go test -race` for the probe inside `nix develop`, shell syntax checks and
`git diff --check`. The repository check includes Go vet/tests, frontend type
checks/build, standalone-binary smoke test, and Linux amd64/arm64 builds.
`npm ci` reported zero vulnerabilities and a warning about the optional
`fsevents` install script not being allowlisted. No dependency files changed.

- [ ] Build and run the image with Docker and a suitable explicit provider key.
- [ ] Observe two real successive turns, complete parts/tool output/model metadata
  and live event schemas; compare saved `/doc` with the pinned upstream schema.
- [ ] Observe question asked/replied and interrupt a real model-driven tool, then
  continue without per-action approvals. The scripted deterministic shell covers
  the cancellation path but does not prove every model/tool cancellation behavior.
- [ ] Observe driver disconnect during active work, then reconnect/answer/finish.
- [ ] Observe idle stop/start/replacement preserving message IDs, tool outputs and
  workspace; check setup-once markers and new-turn continuation.
- [ ] Drill active runtime restart and pending-question loss; record exact persisted
  state, orphan tool behavior and gaps. Drill setup failure, timeout, retry and sudo.
- [ ] Lock final utility-image inputs before production; review the runtime pin's
  security suitability and provide application-owned durable activity storage.

Until this evidence is attached, issue #2 remains open and this PR is draft.
