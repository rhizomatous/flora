# OpenCode runtime and both Linux architectures are pinned by the OCI index
# digest. The base image tracks Alpine's v3.23 release line (see
# /etc/apk/repositories inside the pinned base); packages added below resolve
# from that release line. Runtime bytes are pinned; apk package versions float
# within the v3.23 line and are reviewed when the base pin moves.
FROM ghcr.io/anomalyco/opencode:1.2.27@sha256:f2bbfa29335cade41bf6928673582b42c56acbaaa75c0020dba34650adb7ce0a
USER root
# git and github-cli give the agent authenticated repository access without
# interactive login (PRD 4.3); sudo gives passwordless package installation
# inside the sandbox (PRD 2.2); coreutils provides timeout(1) for setup;
# shadow provides usermod/groupmod so the entrypoint can map the agent user
# onto the storage owner's uid/gid.
RUN apk add --no-cache git github-cli sudo coreutils shadow && \
    adduser -D -u 1000 flora && \
    printf 'flora ALL=(ALL) NOPASSWD: ALL\n' > /etc/sudoers.d/flora && \
    chmod 0440 /etc/sudoers.d/flora
COPY entrypoint.sh /usr/local/bin/flora-entrypoint
COPY opencode.json /etc/flora/opencode.json
# Project config is disabled so the baked installation config is the only
# runtime configuration. The question tool flag is a safeguard; the pinned
# cli client identity already registers it in headless serve mode.
ENV HOME=/home/flora XDG_DATA_HOME=/home/flora/.local/share \
    XDG_STATE_HOME=/home/flora/.local/state XDG_CONFIG_HOME=/home/flora/.config \
    OPENCODE_CONFIG=/etc/flora/opencode.json OPENCODE_DISABLE_PROJECT_CONFIG=true \
    OPENCODE_DISABLE_DEFAULT_PLUGINS=true OPENCODE_ENABLE_QUESTION_TOOL=true \
    GIT_AUTHOR_NAME=Flora GIT_AUTHOR_EMAIL=flora@rhizomato.us \
    GIT_COMMITTER_NAME=Flora GIT_COMMITTER_EMAIL=flora@rhizomato.us
WORKDIR /workspace
ENTRYPOINT ["sh", "/usr/local/bin/flora-entrypoint"]
