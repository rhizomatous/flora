# Durable storage foundation

Issue [#4](https://github.com/rhizomatous/flora/issues/4) implements the local
storage contract behind the PRD's projects, chats, activity, and message limits.
It adds no public API or UI. Production chat orchestration will consume
`backend/internal/storage` in later issues.

## Files and initialization

`flora -data-dir /path/to/data` opens private, application-owned local storage.
The default is `./flora-data`. Use an absolute path for a service installation.
The application user must own the directory and its contents. Do not share this
root with other applications or mount it into agent containers. SQLite WAL needs
a local filesystem, not an NFS or multi-host shared volume.

```text
data/
  flora.db                  # product records, schema version
  flora.db-wal, flora.db-shm # SQLite-managed while open
  workspaces/<chat-id>/     # repository files, including .git
  runtime-state/<chat-id>/  # persisted OpenCode state/home, mounted separately
  logs/<chat-id>/           # setup and application-captured diagnostic files
  artifacts/<chat-id>/      # future retained review outputs
```

Startup creates the root and four parent directories with mode 0700, and the
database with mode 0600. Existing owned directories and database permissions are
tightened. Symlinks at these owned paths are rejected. Ancestors must already be
trusted; this is not a defense against another process with the same host UID.
`Paths` creates the four private directories for a known chat, returning stable
absolute paths. File contents remain the caller's responsibility. Container
mount ownership and agent UID permissions belong to #7. Logs and artifacts have
no retention/deletion policy in this release.

The existing pure-Go SQLite driver is used with foreign keys, WAL, FULL sync,
and a five-second busy timeout on every connection. One connection per Store
keeps local access simple; immediate transactions also serialize admission
across independent Store handles. Transactions contain no runtime/network work.
Busy, cancellation, disk, and constraint errors reach the caller. A failed
operation must not be reported as accepted or published as live activity.

SQL files in `backend/internal/storage/migrations` are embedded in the binary
and applied in filename order within one transaction using `PRAGMA user_version`.
Append sequentially numbered files for new schema changes. Do not edit applied
migrations. A failed migration rolls back both DDL and version changes. A newer
schema is refused. This supports development schema evolution, not a promise of
cross-release compatibility of existing chats, which the PRD excludes.

## Durable records

- Projects contain a name and configuration with a repository collection,
  core/extra roles, base branches, and setup command. Configuration URLs must be
  credential-free HTTPS GitHub URLs. Repository access and branch validation
  belong to #6. There is no credential field. Never place credentials in setup
  commands, message metadata, or activity payloads.
- `CreateChat` generates a stable opaque ID and atomically copies the current
  project configuration. Later project edits affect only later chats. A schema
  trigger protects the immutable configuration, image digest, harness version,
  and project association. Chats initially have Stopped status, with no runtime.
- `RecordStartingCommit` records a resolved full commit hash per snapshot
  repository at checkout. Identical retries succeed and conflicting replacements
  fail. An unfetched extra repository has no starting-commit record yet.
- `BindRuntime` records the container and OpenCode session IDs. Identical retries
  succeed; changing identities is rejected. The container can be saved before
  OpenCode starts and the session added later. Reusing the same stopped container is
  supported by this identity model. Replacement-container policy remains a later
  decision, not implicit recovery behavior.
- User messages have stable local IDs and chat-scoped request IDs. Runtime
  response snapshots have a local ID and a chat-scoped runtime message ID, full
  JSON parts/output, provider, and model. `SaveRuntimeMessage` updates a snapshot
  and captures its activity in one transaction. Capture must be serialized per
  chat, in observed order. Stable update event IDs make retries harmless; a retry
  of an older saved update cannot overwrite a newer snapshot.
- The five saved statuses are Working, Waiting, Failed, Idle, and Stopped, with
  explanations. `Transition` compares the expected active message ID to prevent
  a stale completion from releasing a newer turn. Working and Waiting retain
  ownership. Confirmed completion, failure, or stop releases it. Lifecycle work
  without a user turn may also use Working/Waiting and blocks message admission.
- Activity has a stable event ID per chat and a globally increasing durable
  sequence. `Activities(chat, after, limit)` returns bounded ordered pages.
  Sequence gaps within a chat are normal. Payloads can contain full tool output,
  questions, diagnostics, and capture gaps. `AppendActivity` deduplicates identical
  event IDs and rejects conflicting reuse. Payload identity is byte-exact, so
  retry the same serialized payload. Do not write status changes through this
  generic API; use `Transition` so status and activity commit together.

## Message acceptance and retry rules

1. The caller retains a stable chat ID and request ID across a browser retry.
   Chat creation is separate; a retry must not create another chat. The eventual
   HTTP flow and browser identity handling belong to #9.
2. `AcceptMessage` validates UTF-8 and the **byte** limit of 128 KiB before saving.
3. An already accepted `(chat ID, request ID)` returns its original message and
   `Duplicate=true`, even if the chat is now active or the turn has completed.
   Reusing that identity with different text is a conflict.
4. Otherwise, active ownership or Working/Waiting status rejects the request.
   Rejection saves nothing, reserves no identity, and creates no queue.
5. The user message, active message ID, Working status, and activity are committed
   together. Only a successful new acceptance is eligible for runtime submission.
   Publish events only after the storage call succeeds.
6. The caller must never submit a duplicate acceptance. If delivery is uncertain
   or the process dies between acceptance and submission, retain the saved record
   for later reconciliation. Do not automatically resend it. There is no durable
   dispatch queue, automatic in-flight resumption, or exactly-once tool guarantee.

## Runtime findings and remaining integration

The #2 findings in [PR #22](https://github.com/rhizomatous/flora/pull/22) informed
this design. No spike code is adopted. Runtime history persists, but runtime
status and pending questions are process-local, and runtime SSE has no replay
cursor. Saved Waiting status or a running tool part cannot establish liveness.
Reopening this store preserves evidence and active ownership without inventing
success, resuming work, or replaying an agent action.

Activity capture before browser delivery, authenticated routes, runtime questions,
SSE replay of **Flora's saved activity**, and frontend integration belong to #9.
Startup/runtime reconciliation, explicit output gaps, and stale-question handling
belong to #12. Checkout and resolved commits are integrated in #8. Container
admission/capacity accounting is #13; this package only serializes per-chat turn
acceptance. No model calls or external effects are exercised by storage tests.

## Automated evidence

```sh
nix develop --command make deps
nix develop --command make check smoke build-linux
nix develop --command sh -c 'CGO_ENABLED=0 go -C backend test -count=10 ./internal/storage'
nix develop --command sh -c 'CGO_ENABLED=1 go -C backend test -race -count=3 ./internal/storage'
```

The race detector uses a host C toolchain; production builds and the regular
checks remain pure Go with CGO disabled.

The storage tests use real on-disk SQLite databases. They verify persisted
configuration, identities, full output, statuses, ordered activity, and paths
after close/reopen; late acceptance and runtime-update failures with rollback;
same-request and competing-request concurrency through two database handles;
the exact multibyte message boundary; active rejection and stale turn completion;
incremental activity paging; and transactional migrations and newer-version
refusal. The standalone smoke test also checks private storage initialization
outside the source tree and failure before listening with unusable storage.
