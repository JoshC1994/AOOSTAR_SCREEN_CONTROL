export function generateUnraidCommunityAppsXml(port = 3000): string {
  return `<?xml version="1.0"?>
<Container version="2">
  <Name>aoostar-display-studio</Name>
  <Repository>ghcr.io/joshc1994/aoostar_screen_control:latest</Repository>
  <Registry>https://ghcr.io</Registry>
  <Network>bridge</Network>
  <MyIP/>
  <Shell>bash</Shell>
  <Privileged>false</Privileged>
  <Support>https://github.com/JoshC1994/AOOSTAR_SCREEN_CONTROL/issues</Support>
  <Project>https://github.com/JoshC1994/AOOSTAR_SCREEN_CONTROL</Project>
  <Overview>Local-first Aoostar 960x376 USB LCD Studio and Exposed Entities engine for Unraid by JoshC1994. Docker-only Unraid deployment with authenticated API, SSRF/CSRF hardening, async diff-cached USB-UART streaming, and server-side SVG rendering.</Overview>
  <Category>Tools:Utilities System:</Category>
  <WebUI>http://[IP]:[PORT:${port}]/</WebUI>
  <TemplateURL>https://raw.githubusercontent.com/JoshC1994/AOOSTAR_SCREEN_CONTROL/main/templates/aoostar-display-studio.xml</TemplateURL>
  <Icon>https://raw.githubusercontent.com/JoshC1994/AOOSTAR_SCREEN_CONTROL/main/icon.svg</Icon>
  <ExtraParams>--device=/dev/ttyACM0:/dev/ttyACM0 --group-add=20</ExtraParams>
  <Config Name="WebUI Port" Target="3000" Default="${port}" Mode="tcp" Description="Web interface port" Type="Port" Display="always" Required="true" Mask="false">${port}</Config>
  <Config Name="Config &amp; Custom Images" Target="/app/data" Default="/mnt/user/appdata/aoostar-display-studio" Mode="rw" Description="Persistent config (0600), hashed credentials (credentials.json, 0600), and uploaded raster/video media" Type="Path" Display="always" Required="true" Mask="false">/mnt/user/appdata/aoostar-display-studio</Config>
  <Config Name="Docker Socket (Optional)" Target="/var/run/docker.sock" Default="/var/run/docker.sock" Mode="ro" Description="Read-only Docker socket or tecnativa/docker-socket-proxy" Type="Path" Display="always" Required="false" Mask="false">/var/run/docker.sock</Config>
  <Config Name="Unraid emhttp State" Target="/var/local/emhttp" Default="/var/local/emhttp" Mode="ro" Description="Read-only Unraid array state" Type="Path" Display="always" Required="false" Mask="false">/var/local/emhttp</Config>
  <Config Name="Hardware Sensors (hwmon)" Target="/sys/class/hwmon" Default="/sys/class/hwmon" Mode="ro" Description="Read-only Linux hwmon sensor telemetry" Type="Path" Display="always" Required="false" Mask="false">/sys/class/hwmon</Config>
  <Config Name="Enable Serial Writes" Target="AOOSTAR_ENABLE_SERIAL_WRITES" Default="false" Mode="" Description="Safety gate: set to true only after validating Dry Run on Diagnostics (or toggle in Settings)" Type="Variable" Display="always" Required="false" Mask="false">false</Config>
  <Config Name="Runtime UID (Optional)" Target="AOOSTAR_UID" Default="1000" Mode="" Description="Non-root UID for the Node process after /app/data ownership repair (default 1000)" Type="Variable" Display="advanced" Required="false" Mask="false">1000</Config>
  <Config Name="Runtime GID (Optional)" Target="AOOSTAR_GID" Default="1000" Mode="" Description="Non-root GID for the Node process after /app/data ownership repair (default 1000)" Type="Variable" Display="advanced" Required="false" Mask="false">1000</Config>
  <Config Name="Allowed Host Headers" Target="AOOSTAR_ALLOWED_HOSTS" Default="" Mode="" Description="Comma-separated hostnames for reverse proxy access (e.g. lcd.unraid.local)" Type="Variable" Display="advanced" Required="false" Mask="false"/>
</Container>`;
}

export function generateDockerCompose(): string {
  return `services:
  aoostar-display-studio:
    image: ghcr.io/joshc1994/aoostar_screen_control:latest
    container_name: aoostar-display-studio
    restart: unless-stopped
    ports:
      - "3000:3000"
    group_add:
      - "20"
    environment:
      - NODE_ENV=production
      - PORT=3000
      - AOOSTAR_BIND=0.0.0.0
      - AOOSTAR_ENABLE_SERIAL_WRITES=false
      # Optional: override runtime UID/GID after /app/data ownership repair (default 1000:1000)
      # - AOOSTAR_UID=1000
      # - AOOSTAR_GID=1000
      # Optional: override initial admin/admin login (also configurable in Settings > Security)
      # - AOOSTAR_ADMIN_USER=admin
      # - AOOSTAR_ADMIN_PASSWORD=change-me
      # Optional: allow default admin/admin login over public IPs (not recommended)
      # - AOOSTAR_ALLOW_DEFAULT_PASSWORD_PUBLIC=false
      # Optional: restrict LAN hostnames if using a reverse proxy
      # - AOOSTAR_ALLOWED_HOSTS=lcd.unraid.local
      # - AOOSTAR_TRUST_PROXY=true
    devices:
      - /dev/ttyACM0:/dev/ttyACM0
    volumes:
      - /mnt/user/appdata/aoostar-display-studio:/app/data
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - /var/local/emhttp:/var/local/emhttp:ro
      - /sys/class/hwmon:/sys/class/hwmon:ro
`;
}
