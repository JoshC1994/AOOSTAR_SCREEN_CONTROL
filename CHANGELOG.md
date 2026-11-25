# Changelog

## 1.0.5

### Authentication & Security UX
- Replaced first-run `.auth-token` login modal with username/password authentication (`admin / admin` default on first run, stored as salted `scrypt` hashes in `data/credentials.json` mode `0600`, or overridden via `AOOSTAR_ADMIN_USER` / `AOOSTAR_ADMIN_PASSWORD`).
- Added non-blocking default-password reminders: login screen hint (`Default login: admin / admin` only while active), dismissible-per-session banner, one-time post-login modal (`Change now` / `Remind me later`), and startup/login warning logs.
- Added **Settings > Security** panel for updating username/password, resetting to default (`admin / admin`), generating/rotating/revoking optional hashed script API tokens, and **Sign Out Everywhere** (`sessionSecret` rotation).
- Enforced per-IP sliding-window rate limiting + lockout on failed login and API token attempts, `HttpOnly; SameSite=Strict` session cookies, and LAN-only guard while `usingDefaultPassword` is active (`AOOSTAR_ALLOW_DEFAULT_PASSWORD_PUBLIC=true` opt-in).

## 1.0.4

### Transport Architecture & Packaging
- Made Node async diff-cached USB-UART serial transport the sole live LCD driver; removed `monitor.json`, `values.txt`, `sensor-mapping.cfg`, `startOrRestartAsterctlDaemon`, and one-shot `asterctl --image` fallback paths.
- Restricted `asterctl` to optional startup `--version` probe caching, `--simulate --save` comparison, and mutex-guarded `--on`/`--off` diagnostics with RX buffer drain and post-run diff cache invalidation.
- Removed client-side Canvas upload on **Push to Screen** so preview (`/api/hardware/preview.png`), manual deploy, and background daemon pushes use the exact same server-side `@resvg/resvg-js` rasterizer.
- Added diff-cache invalidation when effective brightness or rotation changes.
- Removed the Rust `asterctl-builder` stage from `Dockerfile` for a smaller Node-only Unraid Docker image, and added clock-seconds diff, event-loop lag (`< 50 ms`), and `asterctl`-absent daemon tests.

## 1.0.3

### Security
- Added API token authentication (`data/.auth-token` mode `0600` / `AOOSTAR_API_TOKEN`), timing-safe token validation, signed session cookie exchange (`POST /api/auth/session`), and JS-memory Bearer client (`src/utils/apiClient.ts`) with WebUI sign-in modal.
- Added Host-header DNS rebinding guard (`AOOSTAR_ALLOWED_HOSTS`) and Origin/Referer CSRF enforcement.
- Masked integration tokens in `GET /api/config` and `GET /api/telemetry`, using atomic `0600` writes with `.bak` recovery.
- Blocked SVG uploads, enforced magic-byte validation on raster/video uploads, added per-file/total/concurrency/TTL quotas, and sandboxed `/uploads/*` CSP headers.
- Enforced Zod schema validation across API routes and SSRF protection with zero upstream body reflection on integration tests.
- Hardened Docker container to multi-stage build with pinned `zehnm/aoostar-rs` SHA and non-root `USER node`.

### Hardware & Rendering
- Replaced synchronous serial writes and fake software rendering with non-blocking async diff-cached `0416:90a1` serial transport (`LinuxAsyncSerialTransport`) and unified `@resvg/resvg-js` 960×376 server-side renderer (`GET /api/hardware/preview.png`).
- Added `bootDisplayOff`, `powerOffOnEmergencyStop`, `POST /api/display/{on,off}`, `POST /api/hardware/force-refresh`, `POST /api/hardware/serial-writes`, and `90° / 270°` orientation support.
- Added autonomous daemon startup auto-resume, exponential backoff, edge-triggered sleep/array-stopped blanking, and graceful `SIGINT`/`SIGTERM` shutdown.
- Removed fake telemetry sine-wave/mock fallbacks and fixed `App.tsx` config initialization on unauthenticated responses.

### Packaging
- Removed legacy native `.plg` Unraid plugin packaging in favor of Docker-only deployment (`ghcr.io/joshc1994/aoostar_screen_control:latest`).
