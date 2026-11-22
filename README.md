# Aoostar Display Studio

Local-first Unraid plugin and 960×376 secondary USB LCD studio for **Aoostar NAS** hardware (WTR MAX / GEM12+ PRO, USB-UART `VID 0x0416`, `PID 0x90A1`), created and maintained by **JoshC1994**.

Designed as a 100% local, open-source replacement for proprietary Windows software — zero cloud dependencies and zero outbound telemetry.

## Features

- **960×376 Drag-and-Drop Screen Studio**: Build screens from **Blank**, **Saved**, or **Templates** with real-time preview, premade themes, snap-grid alignment, and block styling (color wheel, swatches, fonts, sizes, background images).
- **Generic & Custom Blocks**: Number, Number List, Line/Area Graph, Radial Gauge, Vertical Bar, Horizontal Bar, Clock & Uptime, Text Label, Divider Line, Image/GIF/Video, Custom HTML, Custom ApexCharts JSON, Docker Containers, Tasks & Backups, and Connected Users.
- **Autonomous Hardware Daemon**: Single **Push to Screen** action deploys active screens to the backend daemon, which renders RGB565 frames directly to `/dev/ttyACM0` (or `/dev/aoostar_lcd`) and keeps updating automatically across browser closes and Unraid reboots.
- **Exposed Entities & Local Integrations**: Always-on Unraid/Linux host telemetry (`emhttp`, `docker.sock`, `hwmon`, `/proc`), plus optional Home Assistant and custom HTTP/JSON endpoints.
- **Saved Screens & Unsaved Prompts**: Manage active vs. paused screens, edit or delete screens, and receive automatic save prompts before leaving the studio, deleting unsaved screens, or pushing changes.
- **Display Hardware Settings**: Configure screen dwell times, polling/push intervals, panel brightness, 0°/90°/180°/270° rotation, overnight sleep schedule, and custom Docker container icons.

## Repository Structure (Unraid Community Applications Compliant)

```
aoostar-display-studio/
├── LICENSE                                  # OSI-approved MIT License
├── ca_profile.xml                           # Unraid Community Apps maintainer profile
├── icon.svg                                 # Vector icon referenced by CA templates
├── aoostar-display-studio.plg               # Native Unraid plugin manifest
├── templates/
│   ├── aoostar-display-studio.xml           # Unraid CA Docker template
│   └── aoostar-display-studio-plugin.xml    # Unraid CA Plugin XML wrapper
├── Dockerfile                               # Container build for GHCR
├── .github/workflows/docker-publish.yml     # Automated GHCR image publishing
├── server.ts                                # Express backend + autonomous LCD daemon
└── src/                                     # React + Vite + Tailwind frontend & server modules
```

## Uploading to GitHub & Publishing to Unraid Community Applications

1. **Create a public GitHub repository** at `https://github.com/JoshC1994/aoostar-display-studio` and push this codebase to the `main` branch.
2. **Container Image (GHCR)**: On push to `main`, `.github/workflows/docker-publish.yml` automatically builds and publishes `ghcr.io/joshc1994/aoostar-display-studio:latest`. Make sure the package visibility in GitHub Packages is set to **Public** so Unraid users can pull it without authentication.
3. **Update Support Thread Link (Recommended)**: Once you create an official support thread on the [Unraid Forums](https://forums.unraid.net/), update `<Forum>` in `ca_profile.xml` and `<Support>` in `templates/*.xml` and `aoostar-display-studio.plg` to point to that thread URL.
4. **Submit to Unraid Community Applications**:
   - Sign in at [ca.unraid.net](https://ca.unraid.net/) and submit `https://github.com/JoshC1994/aoostar-display-studio`.
   - If publishing **Docker only**, remove `templates/aoostar-display-studio-plugin.xml` (or keep both if you want both Docker and Plugin entries reviewed).

## Local Development

```bash
npm install
npm run dev
```

Build for production:

```bash
npm run build
```

## Acknowledgements & License

- Built on reverse-engineered Aoostar USB-UART protocol groundwork from `zehnm/aoostar-rs`.
- Released under the [MIT License](./LICENSE) by **JoshC1994**.
