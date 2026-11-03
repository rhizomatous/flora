FROM ubuntu:24.04
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    ca-certificates docker.io caddy curl openssl python3 iproute2 iptables git util-linux systemd systemd-sysv libcap2-bin \
    && rm -rf /var/lib/apt/lists/*
COPY scripts/installer-network-fixture.py /fixture.py
COPY scripts/installer_acme_fixture.py /installer_acme_fixture.py
COPY scripts/installer-systemd-fixture.py /scripts/installer-systemd-fixture.py
COPY packaging/ubuntu.py packaging/release_download.py /packaging/
COPY scripts/ubuntu_installer_test.py /scripts/ubuntu_installer_test.py
RUN python3 -B /scripts/ubuntu_installer_test.py
ENTRYPOINT ["python3", "/fixture.py"]
