export type DataSourceMode = 'auto' | 'simulation' | 'local' | 'agent';

export interface DiskInfo {
  id: string;
  name: string;
  device: string;
  role: 'parity' | 'data' | 'cache' | 'zfs';
  model: string;
  sizeBytes: number;
  usedBytes: number;
  tempC: number;
  smartStatus: 'PASSED' | 'WARNING' | 'FAILED';
  spinState: 'active' | 'standby';
  readMBps: number;
  writeMBps: number;
  errors: number;
}

export interface DockerContainerInfo {
  id: string;
  name: string;
  image: string;
  state: 'running' | 'exited' | 'paused';
  statusText: string;
  cpuPercent: number;
  memUsedMB: number;
  memLimitMB: number;
  ports: string;
  updateAvailable: boolean;
}

export interface VmInfo {
  id: string;
  name: string;
  state: 'running' | 'shutoff' | 'paused';
  vcpus: number;
  memoryMB: number;
  cpuPercent: number;
}

export interface ActiveSessionInfo {
  id: string;
  username: string;
  protocol: 'SMB3_11' | 'SSH' | 'WebUI' | 'NFS';
  clientIp: string;
  shareOrPath: string;
  openFiles: number;
  durationSec: number;
  throughputMBps: number;
}

export interface ServerTaskInfo {
  id: string;
  name: string;
  category: 'parity' | 'mover' | 'backup' | 'scrub' | 'update';
  status: 'running' | 'scheduled' | 'idle';
  progressPercent: number;
  speedText: string;
  etaText: string;
  schedule: string;
  lastRun: string;
}

export interface UpsInfo {
  connected: boolean;
  model: string;
  status: 'ONLINE' | 'ONBATT' | 'CHARGING';
  loadPercent: number;
  batteryPercent: number;
  runtimeMinutes: number;
  inputVoltage: number;
  nominalPowerW: number;
  currentPowerW: number;
}

export interface FanSensorInfo {
  id: string;
  label: string;
  rpm: number;
  pwmPercent: number;
}

export interface TempSensorInfo {
  id: string;
  label: string;
  tempC: number;
  highC: number;
}

export interface NetworkInterfaceInfo {
  name: string;
  linkSpeedMbps: number;
  ipAddress: string;
  rxMbps: number;
  txMbps: number;
  rxTotalGB: number;
  txTotalGB: number;
  sfpTempC?: number;
}

export interface ZfsPoolInfo {
  name: string;
  health: 'ONLINE' | 'DEGRADED' | 'FAULTED';
  sizeBytes: number;
  usedBytes: number;
  arcHitRatio: number;
  dedupRatio: number;
}

export interface ShareInfo {
  name: string;
  usedBytes: number;
  freeBytes: number;
  cachePolicy: 'Yes' | 'Only' | 'Prefer' | 'No';
  smbExported: boolean;
}

export interface GpuInfo {
  id: string;
  name: string;
  vendor: 'amd' | 'intel' | 'nvidia' | 'unknown';
  tempC: number | null;
  utilPercent: number | null;
  freqMhz: number | null;
  powerW: number | null;
  vramUsedMB: number | null;
  vramTotalMB: number | null;
}

export interface TelemetrySnapshot {
  timestamp: number;
  sourceMode: DataSourceMode;
  sourceLabel: string;
  isRealUnraidHost: boolean;
  agentConnected: boolean;
  haConnected: boolean;
  system: {
    hostname: string;
    unraidVersion: string;
    kernel: string;
    uptimeSeconds: number;
    cpuModel: string;
    cpuCores: number;
    cpuPercent: number;
    cpuFreqMhz?: number | null;
    cpuTempC: number;
    cpuPowerW: number;
    loadAvg: [number, number, number];
    ramTotalBytes: number;
    ramUsedBytes: number;
    ramCachedBytes: number;
    swapTotalBytes: number;
    swapUsedBytes: number;
  };
  array: {
    state: 'STARTED' | 'STOPPED' | 'PARITY_SYNC';
    parityValid: boolean;
    parityCheckRunning: boolean;
    parityProgressPercent: number;
    totalBytes: number;
    usedBytes: number;
    freeBytes: number;
    moverRunning: boolean;
  };
  history: {
    timestamps: string[];
    cpuSeries: number[];
    ramSeries: number[];
    netRxSeries: number[];
    netTxSeries: number[];
  };
  disks: DiskInfo[];
  zfsPools: ZfsPoolInfo[];
  shares: ShareInfo[];
  containers: DockerContainerInfo[];
  vms: VmInfo[];
  sessions: ActiveSessionInfo[];
  tasks: ServerTaskInfo[];
  ups: UpsInfo;
  fans: FanSensorInfo[];
  temps: TempSensorInfo[];
  network: NetworkInterfaceInfo[];
  gpus: GpuInfo[];
}

export interface HomeAssistantEntity {
  entity_id: string;
  state: string;
  attributes: {
    friendly_name?: string;
    unit_of_measurement?: string;
    device_class?: string;
    icon?: string;
  };
  last_changed: string;
}

export interface ExposedEntity {
  id: string;
  source: 'server' | 'home_assistant' | 'custom_http';
  tag: string;
  rawValue: string | number;
  numericValue: number | null;
  unit: string;
  history: number[];
  enabled: boolean;
}

export interface EntityOverride {
  tag?: string;
  unit?: string;
  enabled?: boolean;
}

export interface CustomConnection {
  id: string;
  name: string;
  type: 'http_json' | 'prometheus_text' | 'unraid_agent';
  url: string;
  token?: string;
  jsonPath?: string;
  unit?: string;
  enabled: boolean;
  lastValue?: string;
  lastError?: string;
}

export type WidgetType =
  | 'entity_number'
  | 'entity_list'
  | 'clock'
  | 'cpu_load'
  | 'memory_bar'
  | 'array_status'
  | 'docker_list'
  | 'active_tasks'
  | 'active_users'
  | 'disk_thermals'
  | 'ha_entity'
  | 'apex_area'
  | 'apex_radial'
  | 'apex_bar'
  | 'apex_hbar'
  | 'apex_custom'
  | 'custom_html'
  | 'image_layer'
  | 'custom_text'
  | 'divider';

export type MetricBinding =
  | 'cpu_percent'
  | 'ram_percent'
  | 'array_percent'
  | 'net_rx_tx'
  | 'ups_load'
  | 'disk_temps'
  | 'cpu_temp';

export type FontFamilyOption = 'sans' | 'display' | 'mono';
export type FontSizePreset = 'sm' | 'md' | 'lg' | 'xl' | '2xl';

export interface ScreenWidget {
  id: string;
  type: WidgetType;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  accentColor: string;
  textColor: string;
  bgColor: string;
  bgOpacity: number;
  borderOpacity: number;
  fontScale: number;
  fontFamily?: FontFamilyOption;
  fontSizePreset?: FontSizePreset;
  entityId?: string;
  entityIds?: string[];
  chartVariant?: 'area' | 'line';
  binding?: MetricBinding;
  haEntityId?: string;
  customText?: string;
  htmlCode?: string;
  imageUrl?: string;
  imageFit?: 'cover' | 'contain';
  mediaType?: 'image' | 'video';
  bgImageUrl?: string;
  bgImageFit?: 'cover' | 'contain';
  bgImageOpacity?: number;
  apexCode?: string;
  maxItems?: number;
  chartSmooth?: boolean;
}

export interface LcdTheme {
  id: string;
  name: string;
  description: string;
  backgroundType: 'solid' | 'image';
  backgroundColor: string;
  backgroundImage?: string;
  backgroundDim: number;
  widgetBgColor: string;
  widgetBgOpacity: number;
  widgetBorderOpacity: number;
  widgetTextColor: string;
  widgetAccentColor: string;
  fontFamily: FontFamilyOption;
}

export interface LcdScreen {
  id: string;
  name: string;
  enabled: boolean;
  durationSec: number;
  transition: 'cut' | 'fade' | 'slide';
  backgroundType: 'solid' | 'image';
  backgroundColor: string;
  backgroundImage?: string;
  backgroundDim: number;
  themeId?: string;
  widgets: ScreenWidget[];
}

export interface HardwareSettings {
  devicePath: string;
  baudRate: number;
  brightness: number;
  rotation: 0 | 90 | 180 | 270;
  autoPushEnabled: boolean;
  pushIntervalSec: number;
  pollIntervalMs?: number;
  sleepScheduleEnabled: boolean;
  sleepStart: string;
  sleepEnd: string;
  sleepMode?: 'off' | 'dim';
  sleepDimPercent?: number;
}

export interface IntegrationSettings {
  sourceMode: DataSourceMode;
  agentEnabled: boolean;
  agentUrl: string;
  agentToken: string;
  haEnabled: boolean;
  haUrl: string;
  haToken: string;
  customConnections: CustomConnection[];
}

export interface SavedScreen {
  id: string;
  name: string;
  savedAt: string;
  screen: LcdScreen;
}

export interface HardwareDeployState {
  deployed: boolean;
  deployedAt: string | null;
  activeIndex: number;
  currentScreenId: string | null;
  currentScreenName: string | null;
  isSleeping: boolean;
  effectiveBrightness: number;
  screens: LcdScreen[];
}

export interface StudioConfig {
  screens: LcdScreen[];
  savedScreens: SavedScreen[];
  activeScreenId: string;
  rotationEnabled: boolean;
  hardware: HardwareSettings;
  hardwareDeploy: HardwareDeployState;
  integrations: IntegrationSettings;
  entityOverrides: Record<string, EntityOverride>;
  dockerIcons: Record<string, string>;
  customImages: Array<{
    id: string;
    name: string;
    url: string;
    mediaType?: 'image' | 'video';
    createdAt: string;
  }>;
}

export interface DetectedUsbDevice {
  path: string;
  name: string;
  vendorId: string;
  productId: string;
  isAoostarMatch: boolean;
  writable: boolean;
}

export interface LastFrameMeta {
  pushedAt: string | null;
  screenId: string | null;
  screenName: string | null;
  width: number;
  height: number;
  byteLength: number;
  crc16Hex: string;
  devicePath: string;
  deliveryMode: 'usb-serial' | 'virtual-buffer';
  headerHex: string;
  chunksSent?: number;
  totalChunks?: number;
  initAck?: boolean;
  powerState?: 'on' | 'off';
  lastError?: string | null;
}

export type UiThemePreference = 'dark' | 'light' | 'system';
