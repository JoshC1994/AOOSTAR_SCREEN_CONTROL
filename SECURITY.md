# Security Policy

## Authentication & Network Exposure

- By default outside containers (`server.ts`), the server binds to `127.0.0.1` (`AOOSTAR_BIND=0.0.0.0` in Docker bridge mode).
- All `/api/*` endpoints (except liveness `GET /api/info`, `GET /api/auth/status`, `POST /api/auth/login`, `POST /api/auth/logout`, and script token exchange `POST /api/auth/session`) and `/uploads/*` require authentication via a signed `HttpOnly; SameSite=Strict` session cookie or `Authorization: Bearer <token>`.
- First run initializes `admin` / `admin` stored as a salted `scrypt` hash (`data/credentials.json`, mode `0600`) with `usingDefaultPassword: true` (no plaintext stored on disk). `AOOSTAR_ADMIN_USER` / `AOOSTAR_ADMIN_PASSWORD` override the default (`usingDefaultPassword: false`).
- While `usingDefaultPassword` is `true`, logins are restricted to RFC1918/loopback/ULA addresses unless `AOOSTAR_ALLOW_DEFAULT_PASSWORD_PUBLIC=true` (`X-Forwarded-For` ignored unless `AOOSTAR_TRUST_PROXY=true`).
- Per-IP sliding-window rate limiting locks repeated failed login or API token attempts (5 failures in 5 minutes -> escalating lockout) without logging passwords or tokens.
- Host-header verification (`AOOSTAR_ALLOWED_HOSTS`) and `Origin`/`Referer` verification protect against DNS rebinding and CSRF.
- Optional script API tokens generated in **Settings > Security** are shown once and stored salted and hashed (`scrypt`); **Sign out everywhere** and credential changes rotate the HMAC `sessionSecret`.

## Secret Handling

- Integration tokens (`agentToken`, `haToken`, and `customConnections[].token`) are persisted in `data/studio-config.json` with atomic `0600` file writes and `.bak` recovery, and are masked (`*TokenSet: true`) on API reads.

## Outbound Request Controls

- Integration checks and custom HTTP polling allow only `http:` and `https:` URLs, resolve DNS via `dns.lookup(..., { all: true, verbatim: true })`, block loopback/link-local/metadata/CGNAT/private IPv4 & IPv6 ranges unless explicitly allowed via `AOOSTAR_SSRF_ALLOWLIST` (or `AOOSTAR_BLOCK_PRIVATE_NETS=false` for local LAN integrations), cap redirects, enforce response size limits (`2 MiB`), and avoid reflecting upstream bodies on test endpoints.

## Media Uploads

- Only raster and video formats (`PNG`, `JPG`, `WebP`, `GIF`, `AVIF`, `MP4`, `WebM`) verified by file magic bytes are accepted. SVG, XML, and `<script>` payloads are rejected.
- Uploads enforce per-file (`25 MiB`), total directory (`250 MiB`), concurrency (`10` sessions), and orphan expiry (`15m`) limits.

## Hardware Safety Gate

- Physical writes to `/dev/ttyACM0` require `AOOSTAR_ENABLE_SERIAL_WRITES=true` and `serialWritesEnabled` unlocked, and can be halted immediately with the Emergency Stop latch or locked permanently via `AOOSTAR_LOCK_SERIAL_WRITES=true`.

## Reporting a Vulnerability

Please open a private security advisory or issue at `https://github.com/JoshC1994/AOOSTAR_SCREEN_CONTROL/security`.
