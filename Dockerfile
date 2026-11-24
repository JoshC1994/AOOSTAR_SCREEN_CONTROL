# Stage 1: Compile authoritative asterctl & aster-sysinfo binaries from zehnm/aoostar-rs
FROM rust:1-bookworm AS asterctl-builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    pkg-config \
    libudev-dev \
    git \
    && rm -rf /var/lib/apt/lists/*

RUN git clone --depth 1 https://github.com/zehnm/aoostar-rs.git /build/aoostar-rs && \
    cd /build/aoostar-rs && \
    cargo build --release --bin asterctl --bin aster-sysinfo

# Stage 2: Production Aoostar Display Studio Node.js runtime
FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    coreutils \
    curl \
    lm-sensors \
    libudev1 \
    udev \
    usbutils \
    ca-certificates \
    && (apt-get install -y --no-install-recommends radeontop || true) \
    && (apt-get install -y --no-install-recommends intel-gpu-tools || true) \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -f dialout \
    && usermod -a -G dialout node || true

COPY --from=asterctl-builder /build/aoostar-rs/target/release/asterctl /usr/local/bin/asterctl
COPY --from=asterctl-builder /build/aoostar-rs/target/release/aster-sysinfo /usr/local/bin/aster-sysinfo
COPY --from=asterctl-builder /build/aoostar-rs/fonts /app/asterctl-fonts

RUN chmod +x /usr/local/bin/asterctl /usr/local/bin/aster-sysinfo && \
    /usr/local/bin/asterctl --version

COPY package.json bun.lock* package-lock.json* ./
RUN npm install

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000
ENV AOOSTAR_ENABLE_SERIAL_WRITES=false
ENV AOOSTAR_ASTERCTL_BIN=/usr/local/bin/asterctl

EXPOSE 3000

VOLUME ["/app/data"]

# Safe read-only health check: never touches or writes to /dev/ttyACM0
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT:-3000}/api/info" >/dev/null || exit 1

CMD ["sh", "-c", "echo \"[docker-boot] Aoostar Display Studio starting (AOOSTAR_ENABLE_SERIAL_WRITES=${AOOSTAR_ENABLE_SERIAL_WRITES:-false})\"; ls -l /dev/ttyACM* /dev/aoostar_lcd 2>/dev/null || echo '[docker-boot] No /dev/ttyACM* device mapped'; /usr/local/bin/asterctl --version || true; exec npx tsx server.ts"]
