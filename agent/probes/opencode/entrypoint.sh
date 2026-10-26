#!/bin/sh
set -eu
: "${OPENCODE_SERVER_PASSWORD:?a private endpoint password is required}"
: "${ANTHROPIC_API_KEY:?an explicitly supplied Anthropic API key is required}"
# The marker belongs to this container's writable layer, never the state volume.
# Starting the same stopped container skips setup; replacement runs it again.
mkdir -p /workspace /home/flora
chown flora:flora /workspace /home/flora
if [ ! -f /var/lib/flora-setup.done ]; then
    mkdir -p /var/lib /home/flora/setup
    chown flora:flora /home/flora/setup
    set +e
    sudo -E -u flora timeout "${SETUP_TIMEOUT_SECONDS:-600}" sh -c "${SETUP_COMMAND:-git init /workspace}" >> /home/flora/setup/output.log 2>&1
    status=$?
    set -e
    printf '%s\n' "$status" > /home/flora/setup/exit-status
    if [ "$status" -ne 0 ]; then
        printf 'Setup failed (exit %s). See persisted setup/output.log.\n' "$status" >&2
        exit "$status"
    fi
    touch /var/lib/flora-setup.done
fi
exec sudo -E -u flora opencode serve --hostname 0.0.0.0 --port 4096
