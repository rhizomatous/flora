#!/bin/sh
# Flora agent container entrypoint. Runs setup once per container before
# OpenCode starts, then starts the private authenticated runtime.
set -eu
: "${OPENCODE_SERVER_PASSWORD:?a private endpoint password is required}"
: "${FLORA_UID:?the storage owner uid is required}"
: "${FLORA_GID:?the storage owner gid is required}"
if [ "$FLORA_UID" = "0" ] || [ "$FLORA_GID" = "0" ]; then
    printf 'Refusing to run: storage owned by root would map the agent to root. Run Flora as a non-root service user.\n' >&2
    exit 1
fi
if [ -z "${ANTHROPIC_API_KEY:-}${OPENAI_API_KEY:-}${GOOGLE_GENERATIVE_AI_API_KEY:-}" ]; then
    printf 'No model-provider key is set; model calls will fail until a new container receives credentials.\n' >&2
fi
# Map the agent user onto the storage owner's uid/gid. The bind-mounted
# workspace and home stay owned by the backend's service account on the host,
# and files either side creates remain readable and writable by the other.
# Only the two mount points are chowned; nothing else changes hands.
if [ "$(id -u flora)" != "$FLORA_UID" ]; then
    groupmod -o -g "$FLORA_GID" flora
    usermod -o -u "$FLORA_UID" -g "$FLORA_GID" flora
fi
mkdir -p /workspace /home/flora
chown "$FLORA_UID:$FLORA_GID" /workspace /home/flora
# Checkout runs through Docker exec as the storage owner. Setup cannot run
# until the host has saved the resolved commit and released this container.
if [ "${FLORA_CHECKOUT_REQUIRED:-}" = "1" ]; then
    while [ ! -f /var/lib/flora-checkout.ready ]; do sleep 0.1; done
    . /home/flora/.flora-github.env
fi
# The done marker lives on this container's writable layer, never on the
# persisted home mount: starting the same stopped container skips setup, and a
# replacement container runs it again. A failed or timed-out setup leaves no
# marker, so the next start retries it.
if [ ! -f /var/lib/flora-setup.done ]; then
    mkdir -p /var/lib /home/flora/setup
    chown "$FLORA_UID:$FLORA_GID" /home/flora/setup
    set +e
    if [ -n "${SETUP_COMMAND:-}" ]; then
        # The kill-after bound stops a command that ignores SIGTERM from
        # running forever and holding its capacity slot without a result.
        sudo -E -u flora timeout -k "${SETUP_KILL_GRACE_SECONDS:-30}" "${SETUP_TIMEOUT_SECONDS:-600}" sh -c "$SETUP_COMMAND" >> /home/flora/setup/output.log 2>&1
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
