#!/bin/sh
# Flora agent container entrypoint. Runs setup once per container before
# OpenCode starts (PRD 2.3), then starts the private authenticated runtime.
set -eu
: "${OPENCODE_SERVER_PASSWORD:?a private endpoint password is required}"
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
    printf 'ANTHROPIC_API_KEY is not set; model calls will fail until the runtime is replaced with credentials.\n' >&2
fi
# The bind-mounted workspace and home may be owned by the application user on
# the host. The agent runs as uid 1000, so claim both mount points first.
mkdir -p /workspace /home/flora
chown flora:flora /workspace /home/flora
# The done marker lives on this container's writable layer, never on the
# persisted home mount: starting the same stopped container skips setup, and a
# replacement container runs it again. A failed or timed-out setup leaves no
# marker, so the next start retries it.
if [ ! -f /var/lib/flora-setup.done ]; then
    mkdir -p /var/lib /home/flora/setup
    chown flora:flora /home/flora/setup
    set +e
    if [ -n "${SETUP_COMMAND:-}" ]; then
        sudo -E -u flora timeout "${SETUP_TIMEOUT_SECONDS:-600}" sh -c "$SETUP_COMMAND" >> /home/flora/setup/output.log 2>&1
        status=$?
    else
        status=0
    fi
    set -e
    printf '%s\n' "$status" > /home/flora/setup/exit-status
    if [ "$status" -ne 0 ]; then
        printf 'Setup failed (exit %s). Output is saved in setup/output.log on the persisted home mount. Fix the setup command and start the container again to retry.\n' "$status" >&2
        exit "$status"
    fi
    touch /var/lib/flora-setup.done
fi
exec sudo -E -u flora opencode serve --hostname 0.0.0.0 --port 4096
