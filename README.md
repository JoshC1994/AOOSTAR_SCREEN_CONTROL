# Aoostar Display Studio

Local-first Dockerized Unraid telemetry monitor and 960×376 secondary USB LCD studio for **Aoostar NAS** hardware (WTR MAX / GEM12+ PRO, USB-UART `VID 0x0416`, `PID 0x90A1`), created and maintained by **JoshC1994**.

Repository: `https://github.com/JoshC1994/AOOSTAR_SCREEN_CONTROL`  
Container Image: `ghcr.io/joshc1994/aoostar_screen_control:latest`

---

## Features

- **960×376 Drag-and-Drop Screen Studio**: Build screens from **Blank**, **Saved**, or **Templates** with live telemetry preview, custom fonts, and `0° / 90° / 180° / 270°` orientation support.
- **Unified Headless Renderer (`@resvg/resvg-js`)**: Client preview (`/api/hardware/preview.png`) and background LCD daemon pushes share the same server-side 960×376 compositor.
- **Async Diff-Cached USB-UART Streaming (Sole Live Driver)**: Mirrors the `zehnm/aoostar-rs` wire protocol (`1,500,000` baud, `47B` chunks, `15,360` total chunks, `'A'` ACK, zero wire CRC) directly from Node.js without spawning `asterctl` per tick, supporting per-screen `durationSec` dwell rotation, software brightness scaling, and chunk diff updates with periodic full refresh.
- **Unraid / Linux Telemetry**: Reads real CPU, GPU (`nvidia-smi`, `intel_gpu_top`, `radeontop`, DRM sysfs), `lm-sensors` / `hwmon`, `/var/local/emhttp` array & parity progress, Docker containers, and SMB/SSH sessions.
- **Security Hardening**: Username/password login (`data/credentials.json` mode `0600`, salted `scrypt` hashes), default-password LAN-only guard, login rate limiting, optional hashed script API token, masked stored secrets, host-header & origin CSRF protection, outbound SSRF IP/CIDR filtering, and magic-byte validated raster/video uploads (SVG disabled).

---

## Transport Architecture & Compatibility Trade-Offs

- **Single Serial Owner (`Node.js`)**: All live rendering, rotation, sleep blanking (`DISPLAY_OFF`/`DISPLAY_ON`), brightness scaling, and frame diff-caching run directly in the Node.js async USB-UART driver. `asterctl` is **not** required or bundled by default, which keeps the Docker image lightweight with no Rust build stage.
- **No `monitor.json` / `sensor-mapping.cfg` Compatibility**: External `zehnm/aoostar-rs` `monitor.json` panel definitions and `sensor-mapping.cfg` files are **not** consumed by Aoostar Display Studio, because the app renders live widget layouts server-side via `@resvg/resvg-js` with per-screen `durationSec` dwell timers.
- **Optional `asterctl` Diagnostics**: If you mount an `asterctl` binary into the container (`/usr/local/bin/asterctl` or `AOOSTAR_ASTERCTL_BIN`), Diagnostics exposes `--simulate --save` reference comparison and manual `--on` / `--off` checks serialized under the single serial port mutex (closing the active Node serial handle first and resetting the diff cache afterwards).

---

## Unraid Docker Installation

1. In Unraid **Docker** -> **Add Container** (or Community Applications using `templates/aoostar-display-studio.xml`):
   - **Repository**: `ghcr.io/joshc1994/aoostar_screen_control:latest`
   - **WebUI Port**: `3000` -> `3000`
   - **Appdata**: `/mnt/user/appdata/aoostar-display-studio` -> `/app/data`
   - **Extra Parameters (included automatically by the template)**: `--device=/dev/ttyACM0:/dev/ttyACM0 --group-add=20` (passes the LCD device and Unraid `dialout` group GID `20` without duplicating device flags; adjust `--group-add` only if your host uses a different `dialout` GID, e.g. `stat -c '%g' /dev/ttyACM0`)
   - **Mounts**:
     - `/var/local/emhttp` -> `/var/local/emhttp` (`ro`)
     - `/sys/class/hwmon` -> `/sys/class/hwmon` (`ro`)
     - `/var/run/docker.sock` -> `/var/run/docker.sock` (`ro`, optional; see Docker Socket Proxy below)
2. Automatic permissions & non-root runtime:
   - On startup, `docker-entrypoint.sh` starts briefly as `root`, automatically creates/repairs ownership of `/app/data` and `/app/data/uploads` when needed (logging a concise warning only when mismatched ownership is repaired), and immediately drops privileges via `gosu` before launching Node as UID/GID `1000:1000` (`node`).
   - You do **not** need to run manual `chown -R 1000:1000 /mnt/user/appdata/aoostar-display-studio` commands or add `--user=1000:1000` in Extra Parameters.
   - To override the runtime UID/GID if needed (e.g., to match `nobody:users` `99:100`), set the optional **Advanced** template variables `AOOSTAR_UID` and `AOOSTAR_GID` (defaults are `1000` and `1000`; `0` is rejected).
3. First-run login & account recovery:
   - Open `http://<SERVER-IP>:3000` and sign in with default credentials **`admin` / `admin`** (non-blocking prompts encourage changing them in **Settings > Security**).
   - While the default password is active, logins from outside local private networks (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, loopback, `fc00::/7`) are blocked unless `AOOSTAR_ALLOW_DEFAULT_PASSWORD_PUBLIC=true` or you change the password.
   - To preset credentials declaratively, set `AOOSTAR_ADMIN_USER` and `AOOSTAR_ADMIN_PASSWORD` environment variables.
   - **Account Recovery**: If you forget your password, delete `/mnt/user/appdata/aoostar-display-studio/credentials.json` and restart the container to restore `admin / admin` without losing saved screens, connections, or uploaded media.
4. Validate safely before enabling hardware writes:
   - Keep `AOOSTAR_ENABLE_SERIAL_WRITES=false` initially, open **Diagnostics**, and run **Dry run** first to validate packet framing safely.
   - Only after validating Dry Run, set `AOOSTAR_ENABLE_SERIAL_WRITES=true` or unlock serial writes in **Settings**.

---

## Unraid Reverse Proxy Configuration

Because Aoostar Display Studio enforces strict `Host` and `Origin` validation to block DNS rebinding and CSRF:

1. Point your reverse proxy (SWAG, Nginx Proxy Manager, Caddy, or Unraid Tailscale/Proxy) to `http://<SERVER-IP>:3000`.
2. Add these environment variables to the container:
   - `AOOSTAR_ALLOWED_HOSTS=lcd.yourdomain.com` (comma-separated hostnames)
   - `AOOSTAR_TRUST_PROXY=true`
3. Forward `Host`, `X-Forwarded-Host`, and `X-Forwarded-Proto` headers in your proxy config.

---

## Host Udev Rule (Recommended on Unraid / Linux)

Prevent `ModemManager` from probing the Aoostar LCD CDC-ACM device and create a deterministic `/dev/aoostar_lcd` symlink. Add `/boot/config/rules.d/99-aoostar-lcd.rules` (and copy to `/etc/udev/rules.d/` on boot via `go` script):

```udev
SUBSYSTEM=="tty", ATTRS{idVendor}=="0416", ATTRS{idProduct}=="90a1", SYMLINK+="aoostar_lcd", MODE="0660", GROUP="dialout", ENV{ID_MM_DEVICE_IGNORE}="1"
```

Reload udev rules:

```bash
udevadm control --reload-rules && udevadm trigger --subsystem-match=tty
```

---

## Optional Docker Socket Proxy

To avoid mounting `/var/run/docker.sock` directly into the container, run a read-only proxy (such as `tecnativa/docker-socket-proxy` with `CONTAINERS=1`) and configure:

```env
DOCKER_HOST=tcp://dockerproxy:2375
```

---

## Host LCD Power Control (`On` / `Off` / Optional `asterctl`)

Power state transitions (`DISPLAY_ON` / `DISPLAY_OFF`) are handled directly over the Node USB-UART transport via **Settings**, **Diagnostics**, `/api/display/on`, `/api/display/off`, sleep schedules, and graceful container `SIGTERM` shutdown—even without `asterctl` installed. If you mount an optional host `asterctl` binary separately, CLI `--on`/`--off` also works when the container's serial writes are stopped:

```bash
# Power LCD off using host asterctl (optional)
asterctl --off --device /dev/ttyACM0

# Power LCD on using host asterctl (optional)
asterctl --on --device /dev/ttyACM0
```

You can also toggle **Power off LCD at boot** and **Off on emergency stop** inside **Settings -> Brightness, Orientation & Sleep Schedule**.

---

## Local Development & Verification

```bash
npm install
npm run lint
npm test
npm run build
```

Production server run:

```bash
npm start
```

---

## Known Limitations

- **Physical Hardware Verification**: Protocol framing, chunk diffing, ACK handshakes, retry/backoff, and serial error handling were verified against a Linux PTY USB-UART emulator (`tests/pty-emulator.py` / `tests/serial-pty.test.ts`) and mocked serial transports (`tests/serial-integration.test.ts`), rather than an attached physical Aoostar `0416:90a1` LCD module. Always run **Dry run** in Diagnostics first on real hardware.
- **Standalone Live Canvas Parity**: `apex_custom` dynamic ApexCharts JSON uses native browser Canvas/SVG in the studio UI and falls back to structured data visualization in the headless server renderer.

## License

Released under the [MIT License](./LICENSE) by **JoshC1994**.
