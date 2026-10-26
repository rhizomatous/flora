#!/usr/bin/env bash
# Run from the repository root inside nix develop. No host services are started.
set -euo pipefail
: "${ANTHROPIC_API_KEY:?explicitly supply a suitable Anthropic key}"
: "${OPENCODE_SERVER_PASSWORD:?explicitly supply a fresh runtime password}"
if [[ $# != 1 || ! -d "$1" ]]; then
  printf 'Usage: bash agent/probes/opencode/probe.sh EXISTING-PRIVATE-EVIDENCE-DIRECTORY\n' >&2
  exit 1
fi
evidence=$(realpath "$1")
if [[ -e "$evidence/session" ]]; then
  printf 'Evidence directory already contains a run. Refusing to overwrite.\n' >&2
  exit 1
fi
chmod 700 "$evidence"
umask 077
docker info >/dev/null
name="flora-opencode-probe-$(date +%s)-$$"
printf '%s\n' "$name" > "$evidence/container-name"
go -C backend build -mod=readonly -o "$evidence/probe" ./cmd/probe-opencode
docker build -t "$name" agent/probes/opencode
docker image inspect "$name" --format '{{.Id}}' > "$evidence/image-id"
docker volume create "$name-home" >/dev/null
docker volume create "$name-workspace" >/dev/null
# Keep resources on failure for private diagnostics. Never print docker inspect:
# container configuration includes the explicitly injected model credential.
start() {
  docker run -d --name "$name" --cpus 2 --memory 8g --pids-limit 512 \
    -p 127.0.0.1::4096 -v "$name-home:/home/flora" -v "$name-workspace:/workspace" \
    -e ANTHROPIC_API_KEY -e OPENCODE_SERVER_PASSWORD \
    -e 'SETUP_COMMAND=git init /workspace && git -C /workspace config user.name Flora && git -C /workspace config user.email flora@rhizomato.us && echo setup >> /home/flora/setup/runs' \
    "$name" >/dev/null
}
ready() {
  port=$(docker port "$name" 4096/tcp)
  endpoint="http://$port"
  for ((i=0; i<60; i++)); do
    if "$evidence/probe" -url "$endpoint" -timeout 2s; then return; fi
    sleep 1
  done
  printf 'Runtime did not become ready. Inspect private container/setup logs.\n' >&2
  exit 1
}
start
ready
"$evidence/probe" -url "$endpoint" -mode schema > "$evidence/openapi.json"
"$evidence/probe" -url "$endpoint" -mode events -timeout 10m > "$evidence/events.ndjson" 2> "$evidence/events-status" &
events_pid=$!
trap 'kill "$events_pid" 2>/dev/null || true' EXIT
for ((i=0; i<50; i++)); do
  if [[ -s "$evidence/events.ndjson" ]]; then break; fi
  sleep 0.1
done
test -s "$evidence/events.ndjson"
"$evidence/probe" -url "$endpoint" -mode scenario -session-file "$evidence/session" > "$evidence/history-before.json"
session=$(<"$evidence/session")
# A new process and a new SSE connection model driver disconnect/reconnect.
kill "$events_pid" 2>/dev/null || true
wait "$events_pid" 2>/dev/null || true
trap - EXIT
"$evidence/probe" -url "$endpoint" -mode recover -session "$session"
"$evidence/probe" -url "$endpoint" -mode events -timeout 2s > "$evidence/events-reconnected.ndjson" 2>/dev/null || true
test -s "$evidence/events.ndjson"
test -s "$evidence/events-reconnected.ndjson"
node --input-type=module - "$evidence/events.ndjson" <<'JS'
import { readFileSync } from 'node:fs';
const types = new Set(readFileSync(process.argv[2], 'utf8').trim().split('\n').map(line => JSON.parse(line).type));
for (const type of ['server.connected', 'message.updated', 'message.part.updated', 'session.status', 'question.asked', 'question.replied']) {
  if (!types.has(type)) throw new Error(`Missing live event: ${type}`);
}
JS
docker stop -t 10 "$name" >/dev/null
docker start "$name" >/dev/null
ready
"$evidence/probe" -url "$endpoint" -mode recover -session "$session"
docker exec "$name" sh -c 'test "$(wc -l < /home/flora/setup/runs)" -eq 1'
# Replacement gets the same isolated state/workspace but its own setup marker.
docker rm -f "$name" >/dev/null
start
ready
"$evidence/probe" -url "$endpoint" -mode recover -session "$session"
docker exec "$name" sh -c 'test "$(wc -l < /home/flora/setup/runs)" -eq 2'
"$evidence/probe" -url "$endpoint" -mode inspect -session "$session" > "$evidence/history-after.json"
node --input-type=module - "$evidence/history-before.json" "$evidence/history-after.json" <<'JS'
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const [before, after] = process.argv.slice(2).map(path => JSON.parse(readFileSync(path, 'utf8')));
const recovered = new Map(after.map(message => [message.info.id, message]));
for (const message of before) {
  const restored = recovered.get(message.info.id);
  assert.ok(restored, `Lost message ${message.info.id}`);
  for (const field of ['role', 'providerID', 'modelID']) assert.equal(restored.info[field], message.info[field]);
  const parts = new Map(restored.parts.map(part => [part.id, part]));
  for (const part of message.parts) {
    assert.ok(parts.has(part.id), `Lost part ${part.id}`);
    if (part.type === 'tool') assert.equal(parts.get(part.id).state.output, part.state.output);
  }
}
JS
printf 'Probe finished. Private evidence: %s\nContainer/volumes retained: %s\n' "$evidence" "$name"
