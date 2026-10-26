# Runtime and both Linux architectures are pinned by the OCI index digest.
FROM ghcr.io/anomalyco/opencode:1.2.27@sha256:f2bbfa29335cade41bf6928673582b42c56acbaaa75c0020dba34650adb7ce0a
USER root
# Probe utilities only. A release image must also lock the APK repository inputs.
RUN apk add --no-cache git github-cli sudo coreutils && \
    adduser -D -u 1000 flora && \
    printf 'flora ALL=(ALL) NOPASSWD: ALL\n' > /etc/sudoers.d/flora
COPY entrypoint.sh /usr/local/bin/flora-probe-entrypoint
COPY opencode.json /etc/flora/opencode.json
ENV HOME=/home/flora XDG_DATA_HOME=/home/flora/.local/share \
    XDG_STATE_HOME=/home/flora/.local/state XDG_CONFIG_HOME=/home/flora/.config \
    OPENCODE_CONFIG=/etc/flora/opencode.json OPENCODE_DISABLE_PROJECT_CONFIG=true \
    OPENCODE_DISABLE_DEFAULT_PLUGINS=true OPENCODE_ENABLE_QUESTION_TOOL=true
WORKDIR /workspace
ENTRYPOINT ["sh", "/usr/local/bin/flora-probe-entrypoint"]
