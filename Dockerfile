# Stage 1: Build Aoostar Display Studio client + server bundle
FROM node:22-bookworm-slim AS app-builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev

# Stage 2: Minimal production runtime (repairs /app/data ownership at start, then drops to UID/GID 1000 via gosu)
FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    coreutils \
    curl \
    fonts-dejavu-core \
    gosu \
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

COPY --from=app-builder /app/package.json ./package.json
COPY --from=app-builder /app/node_modules ./node_modules
COPY --from=app-builder /app/dist ./dist
COPY --from=app-builder /app/dist-server ./dist-server
COPY --from=app-builder /app/index.html ./index.html
COPY --from=app-builder /app/metadata.json ./metadata.json
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod 0755 /usr/local/bin/docker-entrypoint.sh && \
    mkdir -p /app/data/uploads && \
    chown -R node:node /app /app/data

ENV NODE_ENV=production
ENV PORT=3000
ENV AOOSTAR_BIND=0.0.0.0
ENV AOOSTAR_ENABLE_SERIAL_WRITES=false

EXPOSE 3000

VOLUME ["/app/data"]

# Safe read-only health check: never touches or writes to /dev/ttyACM0
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT:-3000}/api/info" >/dev/null || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist-server/server.mjs"]
