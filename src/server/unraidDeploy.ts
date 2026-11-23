export function generateUnraidPluginPlg(port = 3088, appVersion = '1.0.1'): string {
  return `<?xml version='1.0' standalone='yes'?>
<!DOCTYPE PLUGIN [
  <!ENTITY name      "aoostar-display-studio">
  <!ENTITY author    "JoshC1994">
  <!ENTITY version   "2026.11.23">
  <!ENTITY pluginURL "https://raw.githubusercontent.com/JoshC1994/aoostar-display-studio/main/aoostar-display-studio.plg">
  <!ENTITY plugdir   "/usr/local/emhttp/plugins/&name;">
  <!ENTITY configdir "/boot/config/plugins/&name;">
]>
<PLUGIN name="&name;" author="&author;" version="&version;" pluginURL="&pluginURL;" min="6.12.0" icon="desktop" support="https://forums.unraid.net/">
  <CHANGES>
### 2026.11.23 (v${appVersion}) - Real Unraid Sensor &amp; GPU Parity by JoshC1994
- Local-only Aoostar 960x376 USB LCD Studio &amp; Unraid Exposed Entities Engine
- Zero OEM software, zero outbound telemetry
- Native Slackware/Unraid rc.d service &amp; WebGUI Settings/Utilities integration
- Built on reverse-engineered protocol groundwork from zehnm/aoostar-rs
  </CHANGES>

  <!-- Udev rule so Aoostar USB-UART LCD (0416:90a1) gets predictable symlink & rw permissions -->
  <FILE Name="/etc/udev/rules.d/99-aoostar-lcd.rules" Mode="0644">
    <INLINE><![CDATA[
SUBSYSTEM=="tty", ATTRS{idVendor}=="0416", ATTRS{idProduct}=="90a1", MODE="0666", SYMLINK+="aoostar_lcd"
]]></INLINE>
  </FILE>

  <!-- Service control script -->
  <FILE Name="&configdir;/rc.&name;" Mode="0755">
    <INLINE><![CDATA[
#!/bin/sh
APP_DIR="/usr/local/emhttp/plugins/aoostar-display-studio/app"
PIDFILE="/var/run/aoostar-display-studio.pid"
LOGFILE="/var/log/aoostar-display-studio.log"
NODE_BIN=$(which node 2>/dev/null || echo "/usr/local/bin/node")

start() {
  if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "aoostar-display-studio is already running (PID $(cat "$PIDFILE"))"
    return 0
  fi
  if [ ! -x "$NODE_BIN" ]; then
    echo "Node.js 22+ is required. Install NerdTools/NodeJS or run via Docker."
    return 1
  fi
  cd "$APP_DIR" || return 1
  PORT=${port} NODE_ENV=production nohup "$NODE_BIN" server.ts >"$LOGFILE" 2>&1 &
  echo $! > "$PIDFILE"
  echo "Started aoostar-display-studio on port ${port}"
}

stop() {
  if [ -f "$PIDFILE" ]; then
    kill "$(cat "$PIDFILE")" 2>/dev/null
    rm -f "$PIDFILE"
    echo "Stopped aoostar-display-studio"
  fi
}

status() {
  if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "Running (PID $(cat "$PIDFILE")) on port ${port}"
  else
    echo "Stopped"
  fi
}

case "$1" in
  start)   start ;;
  stop)    stop ;;
  restart) stop; sleep 1; start ;;
  status)  status ;;
  *)       echo "Usage: $0 {start|stop|restart|status}"; exit 1 ;;
esac
]]></INLINE>
  </FILE>

  <!-- Unraid WebGUI Page (Appears under Utilities -> Aoostar Display Studio) -->
  <FILE Name="&plugdir;/AoostarDisplayStudio.page" Mode="0644">
    <INLINE><![CDATA[
Menu="Utilities"
Title="Aoostar Display Studio"
Icon="desktop"
---
<?PHP
$host = explode(':', $_SERVER['HTTP_HOST'])[0];
?>
<div style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;">
  <span>Running locally on port ${port} · Built by JoshC1994</span>
  <a href="http://<?=$host?>:${port}" target="_blank" class="button">Open Fullscreen</a>
</div>
<iframe src="http://<?=$host?>:${port}" style="width:100%;height:84vh;border:1px solid #1f2937;border-radius:8px;background:#0b0e14;"></iframe>
]]></INLINE>
  </FILE>

  <!-- Auto-start daemon on Unraid boot / array start -->
  <FILE Name="&plugdir;/event/started" Mode="0755">
    <INLINE><![CDATA[
#!/bin/sh
/boot/config/plugins/aoostar-display-studio/rc.aoostar-display-studio start
]]></INLINE>
  </FILE>

  <!-- Install hook -->
  <FILE Run="/bin/bash" Method="install">
    <INLINE><![CDATA[
mkdir -p /boot/config/plugins/aoostar-display-studio/data
mkdir -p /usr/local/emhttp/plugins/aoostar-display-studio/app
mkdir -p /usr/local/emhttp/plugins/aoostar-display-studio/event
udevadm control --reload-rules && udevadm trigger
echo "Aoostar Display Studio plugin files installed (auto-starts on boot with your saved hardware playlist)."
echo "Copy your built dist/ + server.ts + package.json into /usr/local/emhttp/plugins/aoostar-display-studio/app and run:"
echo "  /boot/config/plugins/aoostar-display-studio/rc.aoostar-display-studio start"
]]></INLINE>
  </FILE>

  <!-- Remove hook -->
  <FILE Run="/bin/bash" Method="remove">
    <INLINE><![CDATA[
/boot/config/plugins/aoostar-display-studio/rc.aoostar-display-studio stop 2>/dev/null
rm -f /etc/udev/rules.d/99-aoostar-lcd.rules
rm -rf /usr/local/emhttp/plugins/aoostar-display-studio
udevadm control --reload-rules
]]></INLINE>
  </FILE>
</PLUGIN>`;
}

export function generateUnraidCommunityAppsXml(port = 3000): string {
  return `<?xml version="1.0"?>
<Container version="2">
  <Name>aoostar-display-studio</Name>
  <Repository>ghcr.io/joshc1994/aoostar-display-studio:latest</Repository>
  <Registry>https://ghcr.io</Registry>
  <Network>bridge</Network>
  <MyIP/>
  <Shell>bash</Shell>
  <Privileged>false</Privileged>
  <Support>https://forums.unraid.net/</Support>
  <Project>https://github.com/JoshC1994/aoostar-display-studio</Project>
  <Overview>Local-first Aoostar 960x376 USB LCD Studio and Exposed Entities engine for Unraid by JoshC1994. Replaces untrustworthy OEM software with direct local USB-UART streaming, ApexCharts, custom images, and Home Assistant integration.</Overview>
  <Category>Tools:Utilities System:</Category>
  <WebUI>http://[IP]:[PORT:${port}]/</WebUI>
  <TemplateURL>https://raw.githubusercontent.com/JoshC1994/aoostar-display-studio/main/templates/aoostar-display-studio.xml</TemplateURL>
  <Icon>https://raw.githubusercontent.com/JoshC1994/aoostar-display-studio/main/icon.svg</Icon>
  <ExtraParams>--device=/dev/ttyACM0:/dev/ttyACM0</ExtraParams>
  <Config Name="WebUI Port" Target="3000" Default="${port}" Mode="tcp" Description="Web interface port" Type="Port" Display="always" Required="true" Mask="false">${port}</Config>
  <Config Name="Config &amp; Custom Images" Target="/app/data" Default="/mnt/user/appdata/aoostar-display-studio" Mode="rw" Description="Persistent config, entity tags, and uploaded images" Type="Path" Display="always" Required="true" Mask="false">/mnt/user/appdata/aoostar-display-studio</Config>
  <Config Name="Docker Socket" Target="/var/run/docker.sock" Default="/var/run/docker.sock" Mode="ro" Description="Read-only Docker socket" Type="Path" Display="always" Required="false" Mask="false">/var/run/docker.sock</Config>
  <Config Name="Unraid emhttp State" Target="/var/local/emhttp" Default="/var/local/emhttp" Mode="ro" Description="Read-only Unraid array state" Type="Path" Display="always" Required="false" Mask="false">/var/local/emhttp</Config>
  <Config Name="USB LCD Device" Target="/dev/ttyACM0" Default="/dev/ttyACM0" Mode="rw" Description="Aoostar USB-UART display device (0416:90a1)" Type="Device" Display="always" Required="true" Mask="false">/dev/ttyACM0</Config>
</Container>`;
}

export function generateDockerCompose(): string {
  return `services:
  aoostar-display-studio:
    image: node:22-alpine
    container_name: aoostar-display-studio
    working_dir: /app
    command: ["sh", "-c", "npm ci --omit=dev && npm run build && node server.ts"]
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
    devices:
      - /dev/ttyACM0:/dev/ttyACM0
    volumes:
      - ./:/app
      - /mnt/user/appdata/aoostar-display-studio:/app/data
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - /var/local/emhttp:/var/local/emhttp:ro
      - /sys/class/hwmon:/sys/class/hwmon:ro
`;
}
