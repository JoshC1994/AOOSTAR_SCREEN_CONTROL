import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import {execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {safeOutboundFetch} from './security.ts';
import type {
  ActiveSessionInfo,
  CustomConnection,
  DataSourceMode,
  DiskInfo,
  DockerContainerInfo,
  EntityOverride,
  ExposedEntity,
  FanSensorInfo,
  GpuInfo,
  HomeAssistantEntity,
  HostSensorReading,
  NetworkInterfaceInfo,
  ServerTaskInfo,
  ShareInfo,
  StudioConfig,
  TelemetrySnapshot,
  TempSensorInfo,
  UpsInfo,
  VmInfo,
  ZfsPoolInfo,
} from '../types.ts';

const execFileAsync = promisify(execFile);

interface CpuSample {
  idle: number;
  total: number;
}

interface NetSample {
  rxBytes: number;
  txBytes: number;
  timestamp: number;
}

interface RaplSample {
  energyUj: number;
  timestamp: number;
}

interface IntelRc6Sample {
  rc6Ms: number;
  timestamp: number;
}

let prevCpuSample: CpuSample | null = null;
let lastCpuSampleAt = 0;
let lastCpuPercent = 0;
let prevNetSample: NetSample | null = null;
let prevRaplSample: RaplSample | null = null;
const prevIntelRc6Map = new Map<string, IntelRc6Sample>();

function parseProcStatLine(): CpuSample | null {
  try {
    const stat = fs.readFileSync('/proc/stat', 'utf8');
    const line = stat.split('\n')[0];
    // Use first 8 fields: user, nice, system, idle, iowait, irq, softirq, steal
    // (Linux already includes guest/guest_nice inside user/nice; summing beyond 8 double-counts VMs)
    const parts = line
      .trim()
      .split(/\s+/)
      .slice(1, 9)
      .map((v) => (Number.isFinite(Number(v)) ? Number(v) : 0));
    if (parts.length < 4) return null;
    const idle = (parts[3] || 0) + (parts[4] || 0);
    const total = parts.reduce((acc, v) => acc + v, 0);
    return {idle, total};
  } catch {
    return null;
  }
}

// Seed initial CPU sample immediately so the first /api/telemetry call has a real delta
prevCpuSample = parseProcStatLine();
lastCpuSampleAt = prevCpuSample ? Date.now() : 0;

const historyBuffer = {
  timestamps: [] as string[],
  cpuSeries: [] as number[],
  ramSeries: [] as number[],
  netRxSeries: [] as number[],
  netTxSeries: [] as number[],
};

const entityHistoryMap = new Map<string, number[]>();

function recordEntityHistory(id: string, val: number | null) {
  if (val === null || !Number.isFinite(val)) return;
  const arr = entityHistoryMap.get(id) ?? [];
  arr.push(Number(val.toFixed(2)));
  if (arr.length > 24) arr.shift();
  entityHistoryMap.set(id, arr);
}

function pushHistoryPoint(cpu: number, ram: number, rx: number, tx: number) {
  const label = new Date().toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  historyBuffer.timestamps.push(label);
  historyBuffer.cpuSeries.push(Math.round(cpu));
  historyBuffer.ramSeries.push(Math.round(ram));
  historyBuffer.netRxSeries.push(Number(rx.toFixed(1)));
  historyBuffer.netTxSeries.push(Number(tx.toFixed(1)));
  if (historyBuffer.timestamps.length > 24) {
    historyBuffer.timestamps.shift();
    historyBuffer.cpuSeries.shift();
    historyBuffer.ramSeries.shift();
    historyBuffer.netRxSeries.shift();
    historyBuffer.netTxSeries.shift();
  }
}

const taskOverrides: Record<
  string,
  {status: 'running' | 'scheduled' | 'idle'; progressPercent: number; speedText: string; etaText: string}
> = {};

export function triggerTaskState(taskId: string, action: 'start' | 'stop') {
  if (action === 'start') {
    taskOverrides[taskId] = {
      status: 'running',
      progressPercent: 12,
      speedText: taskId === 'task-parity' ? '218 MB/s' : taskId === 'task-mover' ? '485 MB/s' : '310 MB/s',
      etaText: taskId === 'task-parity' ? '14h 22m' : '6m 40s',
    };
  } else {
    taskOverrides[taskId] = {
      status: 'idle',
      progressPercent: 100,
      speedText: 'Completed',
      etaText: '-',
    };
  }
}

function readCpuPercentFromProc(): number {
  const now = Date.now();
  if (lastCpuSampleAt > 0 && now - lastCpuSampleAt < 450 && prevCpuSample) {
    return lastCpuPercent;
  }

  const cur = parseProcStatLine();
  if (!cur) return lastCpuPercent;

  if (!prevCpuSample) {
    prevCpuSample = cur;
    lastCpuSampleAt = now;
    const load1 = os.loadavg()[0];
    lastCpuPercent = Math.min(100, Math.max(0, Math.round((load1 / Math.max(1, os.cpus().length)) * 100)));
    return lastCpuPercent;
  }

  const diffIdle = cur.idle - prevCpuSample.idle;
  const diffTotal = cur.total - prevCpuSample.total;
  if (diffTotal <= 0) {
    return lastCpuPercent;
  }

  prevCpuSample = cur;
  lastCpuSampleAt = now;
  lastCpuPercent = Math.min(100, Math.max(0, Math.round(((diffTotal - diffIdle) / diffTotal) * 100)));
  return lastCpuPercent;
}

function readProcMemInfo(): {total: number; used: number; cached: number; swapTotal: number; swapUsed: number} {
  try {
    const raw = fs.readFileSync('/proc/meminfo', 'utf8');
    const map: Record<string, number> = {};
    for (const line of raw.split('\n')) {
      const m = line.match(/^(\w+):\s+(\d+)\s+kB/);
      if (m) map[m[1]] = Number(m[2]) * 1024;
    }
    const total = map.MemTotal || os.totalmem();
    const cached = (map.Cached || 0) + (map.Buffers || 0) + (map.SReclaimable || 0);
    const available =
      map.MemAvailable !== undefined
        ? map.MemAvailable
        : (map.MemFree || 0) + cached;
    const swapTotal = map.SwapTotal || 0;
    const swapFree = map.SwapFree || 0;
    return {
      total,
      used: Math.max(0, total - available),
      cached,
      swapTotal,
      swapUsed: Math.max(0, swapTotal - swapFree),
    };
  } catch {
    const total = os.totalmem();
    const free = os.freemem();
    return {total, used: total - free, cached: 0, swapTotal: 0, swapUsed: 0};
  }
}

function readLocalNetworkStats(): {rxMbps: number; txMbps: number; interfaces: NetworkInterfaceInfo[]} {
  const ifaces: NetworkInterfaceInfo[] = [];
  let totalRxBytes = 0;
  let totalTxBytes = 0;

  try {
    const procNet = fs.readFileSync('/proc/net/dev', 'utf8');
    const lines = procNet.split('\n').slice(2);
    const osIfaces = os.networkInterfaces();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('lo:')) continue;
      const [namePart, dataPart] = trimmed.split(':');
      if (!dataPart) continue;
      const name = namePart.trim();
      const cols = dataPart.trim().split(/\s+/).map(Number);
      const rxBytes = cols[0] || 0;
      const txBytes = cols[8] || 0;
      totalRxBytes += rxBytes;
      totalTxBytes += txBytes;

      const addrInfo = osIfaces[name]?.find((a) => a.family === 'IPv4');
      ifaces.push({
        name,
        linkSpeedMbps: 1000,
        ipAddress: addrInfo?.address || '0.0.0.0',
        rxMbps: 0,
        txMbps: 0,
        rxTotalGB: Number((rxBytes / 1024 ** 3).toFixed(2)),
        txTotalGB: Number((txBytes / 1024 ** 3).toFixed(2)),
      });
    }
  } catch {
    // ignore
  }

  const now = Date.now();
  let rxMbps = 0;
  let txMbps = 0;
  if (prevNetSample && now > prevNetSample.timestamp) {
    const dtSec = (now - prevNetSample.timestamp) / 1000;
    rxMbps = Math.max(0, ((totalRxBytes - prevNetSample.rxBytes) * 8) / (dtSec * 1_000_000));
    txMbps = Math.max(0, ((totalTxBytes - prevNetSample.txBytes) * 8) / (dtSec * 1_000_000));
  }
  prevNetSample = {rxBytes: totalRxBytes, txBytes: totalTxBytes, timestamp: now};

  if (ifaces.length > 0) {
    ifaces[0].rxMbps = Number(rxMbps.toFixed(2));
    ifaces[0].txMbps = Number(txMbps.toFixed(2));
  }

  return {rxMbps, txMbps, interfaces: ifaces};
}

interface DetailedTempSensor extends TempSensorInfo {
  chipName: string;
}

function readLocalCpuDetails(): {model: string; cores: number; freqMhz: number | null} {
  let model = os.cpus()[0]?.model?.trim() || 'x86_64 Processor';
  let cores = os.cpus().length;
  let freqMhz: number | null = null;

  try {
    const cpuinfo = fs.readFileSync('/proc/cpuinfo', 'utf8');
    const freqs: number[] = [];
    let procCount = 0;
    for (const line of cpuinfo.split('\n')) {
      const mModel = line.match(/^model name\s*:\s*(.+)$/i);
      if (mModel && mModel[1].trim()) {
        model = mModel[1].trim().replace(/\s+/g, ' ');
      }
      const mFreq = line.match(/^cpu MHz\s*:\s*([\d.]+)/i);
      if (mFreq) {
        const val = Number(mFreq[1]);
        if (Number.isFinite(val) && val > 0) freqs.push(val);
      }
      if (/^processor\s*:/i.test(line)) {
        procCount++;
      }
    }
    if (procCount > 0) cores = procCount;
    if (freqs.length > 0) {
      freqMhz = Math.round(freqs.reduce((a, b) => a + b, 0) / freqs.length);
    }
  } catch {
    // fallback to os.cpus()
  }

  // Prefer cpufreq scaling_cur_freq when exposed
  try {
    const cpufreqBase = '/sys/devices/system/cpu/cpufreq';
    if (fs.existsSync(cpufreqBase)) {
      const policies = fs.readdirSync(cpufreqBase).filter((d) => d.startsWith('policy'));
      const policyFreqs: number[] = [];
      for (const p of policies) {
        const pFile = `${cpufreqBase}/${p}/scaling_cur_freq`;
        if (fs.existsSync(pFile)) {
          const khz = Number(fs.readFileSync(pFile, 'utf8').trim());
          if (Number.isFinite(khz) && khz > 0) policyFreqs.push(khz / 1000);
        }
      }
      if (policyFreqs.length > 0) {
        freqMhz = Math.round(policyFreqs.reduce((a, b) => a + b, 0) / policyFreqs.length);
      }
    }
    if (freqMhz === null) {
      const cpu0Freq = '/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq';
      if (fs.existsSync(cpu0Freq)) {
        const khz = Number(fs.readFileSync(cpu0Freq, 'utf8').trim());
        if (Number.isFinite(khz) && khz > 0) freqMhz = Math.round(khz / 1000);
      }
    }
  } catch {
    // ignore
  }

  return {model, cores, freqMhz};
}

interface SensorsCliResult {
  available: boolean;
  temps: DetailedTempSensor[];
  fans: FanSensorInfo[];
  rawSensors: HostSensorReading[];
  cpuPowerW: number | null;
  amdGpuTempC: number | null;
  amdGpuPowerW: number | null;
}

interface IntelGpuTopResult {
  utilPercent: number | null;
  freqMhz: number | null;
  powerW: number | null;
}

interface RadeonTopResult {
  utilPercent: number | null;
  vramUsedMB: number | null;
  freqMhz: number | null;
}

interface HostCliCache {
  updatedAt: number;
  sensors: SensorsCliResult | null;
  nvidiaGpus: GpuInfo[];
  nvidiaAvailable: boolean;
  intelGpuTop: IntelGpuTopResult | null;
  intelGpuTopAvailable: boolean;
  radeonTop: RadeonTopResult | null;
  radeonTopAvailable: boolean;
}

const hostCliCache: HostCliCache = {
  updatedAt: 0,
  sensors: null,
  nvidiaGpus: [],
  nvidiaAvailable: false,
  intelGpuTop: null,
  intelGpuTopAvailable: false,
  radeonTop: null,
  radeonTopAvailable: false,
};

let cliProbeInFlight: Promise<void> | null = null;
const toolBinaryAvailable = new Map<string, boolean>();

function hasBinaryInPath(bin: string): boolean {
  const cached = toolBinaryAvailable.get(bin);
  if (cached !== undefined) return cached;
  const searchDirs = (process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin').split(':');
  let found = false;
  for (const dir of searchDirs) {
    if (!dir) continue;
    try {
      const full = `${dir}/${bin}`;
      if (fs.existsSync(full)) {
        found = true;
        break;
      }
    } catch {
      // ignore
    }
  }
  toolBinaryAvailable.set(bin, found);
  return found;
}

function detectDrmVendors(): {hasIntel: boolean; hasAmd: boolean} {
  let hasIntel = false;
  let hasAmd = false;
  try {
    const drmBase = '/sys/class/drm';
    if (!fs.existsSync(drmBase)) return {hasIntel, hasAmd};
    for (const card of fs.readdirSync(drmBase)) {
      if (!/^card\d+$/.test(card)) continue;
      const vendor = (readSysfsText(`${drmBase}/${card}/device/vendor`) || '').toLowerCase();
      if (vendor === '0x8086') hasIntel = true;
      if (vendor === '0x1002') hasAmd = true;
    }
  } catch {
    // ignore
  }
  return {hasIntel, hasAmd};
}

function slugSensorPart(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

async function probeSensorsJson(): Promise<SensorsCliResult | null> {
  if (!hasBinaryInPath('sensors')) return null;
  try {
    const {stdout} = await execFileAsync('sensors', ['-j'], {encoding: 'utf8', timeout: 1400});
    const parsed = JSON.parse(stdout) as Record<string, Record<string, unknown>>;
    const temps: DetailedTempSensor[] = [];
    const fans: FanSensorInfo[] = [];
    const rawSensors: HostSensorReading[] = [];
    let cpuPowerW: number | null = null;
    let amdGpuTempC: number | null = null;
    let amdGpuPowerW: number | null = null;

    for (const [chipFull, chipObj] of Object.entries(parsed)) {
      if (!chipObj || typeof chipObj !== 'object') continue;
      const chipLower = chipFull.toLowerCase();
      const chipShort = chipFull.split('-')[0] || chipFull;

      for (const [featureName, featureVal] of Object.entries(chipObj)) {
        if (featureName === 'Adapter' || !featureVal || typeof featureVal !== 'object') continue;
        const sub = featureVal as Record<string, unknown>;
        let maxTempC = 85;

        for (const [subKey, rawNum] of Object.entries(sub)) {
          if (typeof rawNum !== 'number' || !Number.isFinite(rawNum)) continue;
          if (/^temp\d+_max$/.test(subKey) || /^temp\d+_crit$/.test(subKey)) {
            if (rawNum > 20 && rawNum < 150) maxTempC = Number(rawNum.toFixed(1));
          }
        }

        for (const [subKey, rawNum] of Object.entries(sub)) {
          if (typeof rawNum !== 'number' || !Number.isFinite(rawNum)) continue;

          if (/^temp\d+_input$/.test(subKey)) {
            if (rawNum <= -50 || rawNum >= 150) continue;
            const tempC = Number(rawNum.toFixed(1));
            const sid = `sensor.${slugSensorPart(chipShort)}.${slugSensorPart(featureName)}`;
            temps.push({
              id: sid,
              chipName: chipLower,
              label: featureName,
              tempC,
              highC: maxTempC,
            });
            rawSensors.push({
              id: sid,
              chip: chipFull,
              label: `${chipShort} ${featureName}`,
              value: tempC,
              unit: '°C',
            });
            if (chipLower.includes('amdgpu') && (amdGpuTempC === null || /edge|junction/i.test(featureName))) {
              amdGpuTempC = tempC;
            }
          } else if (/^fan\d+_input$/.test(subKey)) {
            const rpm = Math.round(rawNum);
            const sid = `sensor.${slugSensorPart(chipShort)}.${slugSensorPart(featureName)}`;
            fans.push({
              id: sid,
              label: `${chipShort} ${featureName}`,
              rpm,
              pwmPercent: Math.min(100, Math.round((rpm / 2400) * 100)),
            });
            rawSensors.push({
              id: sid,
              chip: chipFull,
              label: `${chipShort} ${featureName}`,
              value: rpm,
              unit: 'RPM',
            });
          } else if (/^power\d+_(average|input)$/.test(subKey)) {
            const watts = Number(rawNum.toFixed(1));
            const sid = `sensor.${slugSensorPart(chipShort)}.${slugSensorPart(featureName)}`;
            rawSensors.push({
              id: sid,
              chip: chipFull,
              label: `${chipShort} ${featureName}`,
              value: watts,
              unit: 'W',
            });
            if (
              cpuPowerW === null &&
              (chipLower.includes('energy') ||
                chipLower.includes('zenergy') ||
                chipLower.includes('zenpower') ||
                chipLower.includes('k10temp') ||
                chipLower.includes('coretemp'))
            ) {
              cpuPowerW = watts;
            }
            if (chipLower.includes('amdgpu') && (amdGpuPowerW === null || /ppt/i.test(featureName))) {
              amdGpuPowerW = watts;
            }
          }
        }
      }
    }

    return {
      available: true,
      temps,
      fans,
      rawSensors,
      cpuPowerW,
      amdGpuTempC,
      amdGpuPowerW,
    };
  } catch {
    return null;
  }
}

async function probeNvidiaSmi(): Promise<{available: boolean; gpus: GpuInfo[]}> {
  if (!hasBinaryInPath('nvidia-smi')) return {available: false, gpus: []};
  try {
    const {stdout} = await execFileAsync(
      'nvidia-smi',
      [
        '--query-gpu=name,temperature.gpu,utilization.gpu,memory.used,memory.total,power.draw,clocks.current.graphics',
        '--format=csv,noheader,nounits',
      ],
      {encoding: 'utf8', timeout: 1200}
    );
    const gpus: GpuInfo[] = [];
    const lines = stdout.trim().split('\n').filter(Boolean);
    lines.forEach((line, idx) => {
      const parts = line.split(',').map((s) => s.trim());
      if (parts.length < 5) return;
      const parseMaybe = (v: string | undefined) => {
        if (!v || v === '[N/A]' || v === 'N/A') return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };
      gpus.push({
        id: `nvidia-${idx}`,
        name: parts[0] || `NVIDIA GPU ${idx}`,
        vendor: 'nvidia',
        tempC: parseMaybe(parts[1]),
        utilPercent: parseMaybe(parts[2]),
        vramUsedMB: parseMaybe(parts[3]),
        vramTotalMB: parseMaybe(parts[4]),
        powerW: parseMaybe(parts[5]),
        freqMhz: parseMaybe(parts[6]),
      });
    });
    return {available: true, gpus};
  } catch {
    return {available: false, gpus: []};
  }
}

async function probeIntelGpuTop(): Promise<{available: boolean; data: IntelGpuTopResult | null}> {
  if (!hasBinaryInPath('intel_gpu_top')) return {available: false, data: null};
  return new Promise((resolve) => {
    let stdout = '';
    let settled = false;
    const child = spawn('intel_gpu_top', ['-J', '-s', '250'], {stdio: ['ignore', 'pipe', 'ignore']});

    const finish = (available: boolean, data: IntelGpuTopResult | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill('SIGINT');
      } catch {
        // ignore
      }
      resolve({available, data});
    };

    const timer = setTimeout(() => {
      // Parse whatever first JSON object arrived if stream started
      const parsed = tryExtractIntelJson(stdout);
      finish(Boolean(parsed), parsed);
    }, 750);

    child.on('error', () => finish(false, null));
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      const parsed = tryExtractIntelJson(stdout);
      if (parsed) finish(true, parsed);
    });
    child.on('exit', () => {
      const parsed = tryExtractIntelJson(stdout);
      finish(Boolean(parsed), parsed);
    });
  });
}

function tryExtractIntelJson(raw: string): IntelGpuTopResult | null {
  const cleaned = raw.trim().replace(/^\[/, '').replace(/^,/, '');
  let depth = 0;
  let start = -1;
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        const slice = cleaned.slice(start, i + 1);
        try {
          const obj = JSON.parse(slice) as {
            frequency?: {actual?: number};
            power?: {GPU?: number; Package?: number};
            engines?: Record<string, {busy?: number}>;
          };
          const busyVals = Object.values(obj.engines || {})
            .map((e) => (typeof e?.busy === 'number' ? e.busy : 0))
            .filter((n) => Number.isFinite(n));
          const maxBusy = busyVals.length > 0 ? Math.round(Math.max(...busyVals)) : null;
          const freqMhz =
            typeof obj.frequency?.actual === 'number' ? Math.round(obj.frequency.actual) : null;
          const rawPower = obj.power?.GPU ?? obj.power?.Package;
          const powerW = typeof rawPower === 'number' ? Number(rawPower.toFixed(1)) : null;
          return {utilPercent: maxBusy, freqMhz, powerW};
        } catch {
          // continue looking
        }
      }
    }
  }
  return null;
}

async function probeRadeonTop(): Promise<{available: boolean; data: RadeonTopResult | null}> {
  if (!hasBinaryInPath('radeontop')) return {available: false, data: null};
  try {
    const {stdout} = await execFileAsync('radeontop', ['-d', '-', '-l', '1'], {
      encoding: 'utf8',
      timeout: 1200,
    });
    const line = stdout.trim().split('\n').pop() || '';
    const gpuMatch = line.match(/gpu\s+([\d.]+)%/i);
    const vramMatch = line.match(/vram\s+[\d.]+%\s+([\d.]+)mb/i);
    const sclkMatch = line.match(/sclk\s+([\d.]+)(ghz|mhz)/i);
    let freqMhz: number | null = null;
    if (sclkMatch) {
      const val = Number(sclkMatch[1]);
      freqMhz = sclkMatch[2].toLowerCase() === 'ghz' ? Math.round(val * 1000) : Math.round(val);
    }
    return {
      available: true,
      data: {
        utilPercent: gpuMatch ? Math.round(Number(gpuMatch[1])) : null,
        vramUsedMB: vramMatch ? Math.round(Number(vramMatch[1])) : null,
        freqMhz,
      },
    };
  } catch {
    return {available: false, data: null};
  }
}

async function refreshHostCliCacheIfNeeded(): Promise<void> {
  const now = Date.now();
  if (now - hostCliCache.updatedAt < 2000 && hostCliCache.updatedAt > 0) {
    return;
  }
  if (cliProbeInFlight) {
    await cliProbeInFlight;
    return;
  }

  cliProbeInFlight = (async () => {
    try {
      const {hasIntel, hasAmd} = detectDrmVendors();
      const [sensorsRes, nvidiaRes, intelRes, radeonRes] = await Promise.all([
        probeSensorsJson(),
        probeNvidiaSmi(),
        hasIntel ? probeIntelGpuTop() : Promise.resolve({available: false, data: null}),
        hasAmd ? probeRadeonTop() : Promise.resolve({available: false, data: null}),
      ]);

      hostCliCache.sensors = sensorsRes;
      hostCliCache.nvidiaAvailable = nvidiaRes.available;
      hostCliCache.nvidiaGpus = nvidiaRes.gpus;
      hostCliCache.intelGpuTopAvailable = intelRes.available;
      hostCliCache.intelGpuTop = intelRes.data;
      hostCliCache.radeonTopAvailable = radeonRes.available;
      hostCliCache.radeonTop = radeonRes.data;
      hostCliCache.updatedAt = Date.now();
    } finally {
      cliProbeInFlight = null;
    }
  })();

  await cliProbeInFlight;
}

function readLocalHwmon(): {
  temps: DetailedTempSensor[];
  fans: FanSensorInfo[];
  rawSensors: HostSensorReading[];
  cpuTempC: number | null;
  hwmonCpuPowerW: number | null;
} {
  const temps: DetailedTempSensor[] = [];
  const fans: FanSensorInfo[] = [];
  const rawSensors: HostSensorReading[] = [];
  let hwmonCpuPowerW: number | null = null;

  const cliSensors = hostCliCache.sensors;
  if (cliSensors?.available) {
    temps.push(...cliSensors.temps);
    fans.push(...cliSensors.fans);
    rawSensors.push(...cliSensors.rawSensors);
    hwmonCpuPowerW = cliSensors.cpuPowerW;
  }

  // Merge /sys/class/hwmon entries (provides sensors even if lm-sensors isn't installed or misses a node)
  try {
    const base = '/sys/class/hwmon';
    if (fs.existsSync(base)) {
      for (const dir of fs.readdirSync(base)) {
        const fullDir = `${base}/${dir}`;
        let chipName = dir;
        try {
          chipName = fs.readFileSync(`${fullDir}/name`, 'utf8').trim().toLowerCase();
        } catch {
          // ignore
        }
        const files = fs.readdirSync(fullDir);
        for (const file of files) {
          if (/^temp\d+_input$/.test(file)) {
            const idx = file.match(/\d+/)?.[0] || '1';
            try {
              const milli = Number(fs.readFileSync(`${fullDir}/${file}`, 'utf8').trim());
              if (!Number.isFinite(milli) || milli <= -50000 || milli >= 150000) continue;
              let label = `${chipName} temp${idx}`;
              try {
                label = fs.readFileSync(`${fullDir}/temp${idx}_label`, 'utf8').trim();
              } catch {
                // ignore
              }
              const alreadyFromCli = temps.some(
                (t) => t.chipName.startsWith(chipName) && t.label.toLowerCase() === label.toLowerCase()
              );
              const tempC = Number((milli / 1000).toFixed(1));
              if (!alreadyFromCli) {
                const sid = `sensor.${slugSensorPart(chipName)}.${slugSensorPart(label || `temp${idx}`)}`;
                temps.push({
                  id: sid,
                  chipName,
                  label,
                  tempC,
                  highC: 85,
                });
                rawSensors.push({
                  id: sid,
                  chip: chipName,
                  label: `${chipName} ${label}`,
                  value: tempC,
                  unit: '°C',
                });
              }
            } catch {
              // ignore unreadable sensor
            }
          }
          if (/^fan\d+_input$/.test(file)) {
            const idx = file.match(/\d+/)?.[0] || '1';
            try {
              const rpm = Number(fs.readFileSync(`${fullDir}/${file}`, 'utf8').trim());
              if (Number.isFinite(rpm)) {
                const fanLabel = `${chipName} Fan ${idx}`;
                const alreadyFromCli = fans.some((f) => f.label.toLowerCase().includes(`${chipName} fan${idx}`));
                if (!alreadyFromCli && !cliSensors?.available) {
                  const sid = `sensor.${slugSensorPart(chipName)}.fan${idx}`;
                  fans.push({
                    id: sid,
                    label: fanLabel,
                    rpm,
                    pwmPercent: Math.min(100, Math.round((rpm / 2400) * 100)),
                  });
                  rawSensors.push({
                    id: sid,
                    chip: chipName,
                    label: fanLabel,
                    value: rpm,
                    unit: 'RPM',
                  });
                }
              }
            } catch {
              // ignore
            }
          }
          if (
            hwmonCpuPowerW === null &&
            (chipName.includes('energy') ||
              chipName.includes('zenergy') ||
              chipName.includes('zenpower') ||
              chipName.includes('k10temp') ||
              chipName.includes('coretemp')) &&
            /^power\d+_(average|input)$/.test(file)
          ) {
            try {
              const uw = Number(fs.readFileSync(`${fullDir}/${file}`, 'utf8').trim());
              if (Number.isFinite(uw) && uw > 0) {
                hwmonCpuPowerW = Number((uw / 1_000_000).toFixed(1));
              }
            } catch {
              // ignore
            }
          }
        }
      }
    }
  } catch {
    // ignore
  }

  // Fallback thermal zones if hwmon missing or empty
  let thermalPkgTemp: number | null = null;
  let thermalAcpiTemp: number | null = null;
  try {
    const tzBase = '/sys/class/thermal';
    if (fs.existsSync(tzBase)) {
      for (const dir of fs.readdirSync(tzBase)) {
        if (!dir.startsWith('thermal_zone')) continue;
        const fullDir = `${tzBase}/${dir}`;
        try {
          const type = fs.readFileSync(`${fullDir}/type`, 'utf8').trim().toLowerCase();
          const milli = Number(fs.readFileSync(`${fullDir}/temp`, 'utf8').trim());
          if (Number.isFinite(milli) && milli > 0 && milli < 150000) {
            const c = Number((milli / 1000).toFixed(1));
            if (type.includes('pkg') || type.includes('cpu') || type.includes('tctl')) {
              thermalPkgTemp ??= c;
            } else if (type.includes('acpitz')) {
              thermalAcpiTemp ??= c;
            }
            if (!temps.some((t) => t.label.toLowerCase() === type)) {
              temps.push({id: dir, chipName: type, label: type, tempC: c, highC: 90});
            }
          }
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }

  // Pick CPU temp strictly by sensor priority matching Unraid / lm-sensors conventions
  const pickTemp = (pred: (t: DetailedTempSensor) => boolean): number | null => {
    const hit = temps.find(pred);
    return hit ? hit.tempC : null;
  };

  const cpuTempC =
    pickTemp(
      (t) =>
        (t.chipName.includes('k10temp') || t.chipName.includes('zenpower') || t.chipName.includes('ryzen')) &&
        /tctl|tdie|tccd/i.test(t.label)
    ) ??
    pickTemp((t) => t.chipName.includes('k10temp') || t.chipName.includes('zenpower')) ??
    pickTemp((t) => t.chipName.includes('coretemp') && /package|pkg|core\s*0/i.test(t.label)) ??
    pickTemp((t) => t.chipName.includes('coretemp')) ??
    pickTemp(
      (t) =>
        (t.chipName.startsWith('nct') || t.chipName.startsWith('it8') || t.chipName.startsWith('f71')) &&
        /cpu|peci|cputin/i.test(t.label)
    ) ??
    thermalPkgTemp ??
    thermalAcpiTemp ??
    pickTemp((t) => !t.chipName.includes('nvme') && !t.chipName.includes('amdgpu') && !t.chipName.includes('nouveau')) ??
    temps[0]?.tempC ??
    null;

  return {temps, fans, rawSensors, cpuTempC, hwmonCpuPowerW};
}

function readRaplPowerWatts(): number | null {
  try {
    let raplDir = '/sys/class/powercap/intel-rapl:0';
    if (!fs.existsSync(`${raplDir}/energy_uj`)) {
      const base = '/sys/class/powercap';
      if (fs.existsSync(base)) {
        for (const d of fs.readdirSync(base)) {
          const candidate = `${base}/${d}`;
          const energyFile = `${candidate}/energy_uj`;
          if (!fs.existsSync(energyFile)) continue;
          const domainName = readSysfsText(`${candidate}/name`) || '';
          if (domainName.includes('package') || d.endsWith(':0')) {
            raplDir = candidate;
            break;
          }
        }
      }
    }
    const raplPath = `${raplDir}/energy_uj`;
    if (!fs.existsSync(raplPath)) return null;
    const energyUj = Number(fs.readFileSync(raplPath, 'utf8').trim());
    const now = Date.now();
    if (!Number.isFinite(energyUj) || energyUj <= 0) return null;
    if (!prevRaplSample || now <= prevRaplSample.timestamp) {
      prevRaplSample = {energyUj, timestamp: now};
      return null;
    }
    let deltaUj = energyUj - prevRaplSample.energyUj;
    if (deltaUj < 0) {
      const maxPath = `${raplDir}/max_energy_range_uj`;
      const maxUj = fs.existsSync(maxPath) ? Number(fs.readFileSync(maxPath, 'utf8').trim()) : 0;
      deltaUj = maxUj > 0 ? maxUj - prevRaplSample.energyUj + energyUj : 0;
    }
    const dtSec = (now - prevRaplSample.timestamp) / 1000;
    prevRaplSample = {energyUj, timestamp: now};
    if (dtSec <= 0 || deltaUj <= 0) return null;
    const watts = deltaUj / 1_000_000 / dtSec;
    return watts > 0 && watts < 600 ? Number(watts.toFixed(1)) : null;
  } catch {
    return null;
  }
}

function readSysfsText(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch {
    return null;
  }
}

function readSysfsNumber(filePath: string): number | null {
  const txt = readSysfsText(filePath);
  if (!txt) return null;
  const n = Number(txt);
  return Number.isFinite(n) ? n : null;
}

function readLocalGpus(): GpuInfo[] {
  const gpus: GpuInfo[] = [...hostCliCache.nvidiaGpus];

  // DRM sysfs GPUs (AMD amdgpu e.g. Radeon 780M on WTR MAX, Intel i915/xe Arc/UHD, etc.)
  // enriched with radeontop / intel_gpu_top / lm-sensors CLI readings when available
  try {
    const drmBase = '/sys/class/drm';
    if (fs.existsSync(drmBase)) {
      const cards = fs
        .readdirSync(drmBase)
        .filter((d) => /^card\d+$/.test(d))
        .sort();

      for (const card of cards) {
        const devDir = `${drmBase}/${card}/device`;
        if (!fs.existsSync(devDir)) continue;

        const vendorHex = (readSysfsText(`${devDir}/vendor`) || '').toLowerCase();
        const deviceHex = (readSysfsText(`${devDir}/device`) || '').toLowerCase();
        const uevent = readSysfsText(`${devDir}/uevent`) || '';
        const driverMatch = uevent.match(/^DRIVER=(.+)$/m);
        const driver = driverMatch ? driverMatch[1].trim().toLowerCase() : '';
        const pciIdMatch = uevent.match(/^PCI_ID=([0-9A-Fa-f:]+)$/m);
        const pciId = pciIdMatch ? pciIdMatch[1].toUpperCase() : '';

        if (vendorHex === '0x10de' && gpus.some((g) => g.vendor === 'nvidia')) {
          continue; // already captured with richer stats via nvidia-smi
        }

        const vendor: GpuInfo['vendor'] =
          vendorHex === '0x1002'
            ? 'amd'
            : vendorHex === '0x8086'
              ? 'intel'
              : vendorHex === '0x10de'
                ? 'nvidia'
                : 'unknown';

        // Read nested hwmon under DRM device
        let tempC: number | null = null;
        let powerW: number | null = null;
        let freqMhz: number | null = null;

        try {
          const hwmonDir = `${devDir}/hwmon`;
          if (fs.existsSync(hwmonDir)) {
            for (const hw of fs.readdirSync(hwmonDir)) {
              const p = `${hwmonDir}/${hw}`;
              const t1 = readSysfsNumber(`${p}/temp1_input`);
              if (t1 !== null && t1 > -50000 && t1 < 150000) {
                tempC = Number((t1 / 1000).toFixed(1));
              }
              const pw = readSysfsNumber(`${p}/power1_average`) ?? readSysfsNumber(`${p}/power1_input`);
              if (pw !== null && pw > 0) {
                powerW = Number((pw / 1_000_000).toFixed(1));
              }
              const fq = readSysfsNumber(`${p}/freq1_input`);
              if (fq !== null && fq > 0) {
                freqMhz = Math.round(fq / 1_000_000);
              }
            }
          }
        } catch {
          // ignore
        }

        let utilPercent: number | null = readSysfsNumber(`${devDir}/gpu_busy_percent`);
        const vramUsedBytes = readSysfsNumber(`${devDir}/mem_info_vram_used`);
        const vramTotalBytes = readSysfsNumber(`${devDir}/mem_info_vram_total`);
        let vramUsedMB = vramUsedBytes !== null ? Math.round(vramUsedBytes / (1024 * 1024)) : null;
        const vramTotalMB = vramTotalBytes !== null ? Math.round(vramTotalBytes / (1024 * 1024)) : null;

        if (vendor === 'amd') {
          if (freqMhz === null) {
            const dpm = readSysfsText(`${devDir}/pp_dpm_sclk`);
            const activeLine = dpm?.split('\n').find((l) => l.includes('*'));
            const m = activeLine?.match(/(\d+)\s*Mhz/i);
            if (m) freqMhz = Number(m[1]);
          }
          if (hostCliCache.radeonTop) {
            utilPercent = utilPercent ?? hostCliCache.radeonTop.utilPercent;
            vramUsedMB = vramUsedMB ?? hostCliCache.radeonTop.vramUsedMB;
            freqMhz = freqMhz ?? hostCliCache.radeonTop.freqMhz;
          }
          if (hostCliCache.sensors) {
            tempC = tempC ?? hostCliCache.sensors.amdGpuTempC;
            powerW = powerW ?? hostCliCache.sensors.amdGpuPowerW;
          }
        }

        if (vendor === 'intel') {
          freqMhz =
            hostCliCache.intelGpuTop?.freqMhz ??
            freqMhz ??
            readSysfsNumber(`${drmBase}/${card}/gt_cur_freq_mhz`) ??
            readSysfsNumber(`${drmBase}/${card}/gt/gt0/rps_cur_freq_mhz`) ??
            readSysfsNumber(`${drmBase}/${card}/tile0/gt0/freq0/cur_freq`);

          powerW = hostCliCache.intelGpuTop?.powerW ?? powerW;
          utilPercent = hostCliCache.intelGpuTop?.utilPercent ?? utilPercent;

          if (utilPercent === null) {
            const rc6Ms =
              readSysfsNumber(`${drmBase}/${card}/gt/gt0/rc6_residency_ms`) ??
              readSysfsNumber(`${drmBase}/${card}/power/rc6_residency_ms`);
            if (rc6Ms !== null) {
              const now = Date.now();
              const prev = prevIntelRc6Map.get(card);
              if (prev && now > prev.timestamp && rc6Ms >= prev.rc6Ms) {
                const dt = now - prev.timestamp;
                const dRc6 = rc6Ms - prev.rc6Ms;
                utilPercent = Math.max(0, Math.min(100, Math.round(100 - (dRc6 / dt) * 100)));
              }
              prevIntelRc6Map.set(card, {rc6Ms, timestamp: now});
            }
          }
        }

        let name = readSysfsText(`${devDir}/product_name`) || readSysfsText(`${devDir}/label`);
        if (!name) {
          if (vendor === 'amd') {
            name =
              pciId === '1002:15BF' || pciId === '1002:1900' || pciId === '1002:15C8'
                ? 'AMD Radeon 780M Graphics'
                : `AMD Radeon GPU (${deviceHex || driver || 'amdgpu'})`;
          } else if (vendor === 'intel') {
            name = `Intel Graphics (${deviceHex || driver || 'i915'})`;
          } else if (vendor === 'nvidia') {
            name = `NVIDIA GPU (${deviceHex || 'nouveau'})`;
          } else {
            name = `GPU ${card} (${driver || pciId || 'drm'})`;
          }
        }

        gpus.push({
          id: card,
          name,
          vendor,
          tempC,
          utilPercent,
          freqMhz,
          powerW,
          vramUsedMB,
          vramTotalMB,
        });
      }
    }
  } catch {
    // ignore
  }

  return gpus;
}

async function readLocalDockerSocket(): Promise<DockerContainerInfo[]> {
  const sockPath = '/var/run/docker.sock';
  if (!fs.existsSync(sockPath)) return [];
  return new Promise((resolve) => {
    const req = http.request(
      {
        socketPath: sockPath,
        path: '/containers/json?all=1',
        method: 'GET',
        timeout: 1200,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            const list = JSON.parse(body) as Array<{
              Id: string;
              Names?: string[];
              Image: string;
              State: string;
              Status: string;
              Ports?: Array<{PublicPort?: number}>;
            }>;
            resolve(
              list.map((c) => ({
                id: c.Id.slice(0, 12),
                name: (c.Names?.[0] || c.Id.slice(0, 12)).replace(/^\//, ''),
                image: c.Image,
                state: c.State === 'running' ? 'running' : c.State === 'paused' ? 'paused' : 'exited',
                statusText: c.Status,
                cpuPercent: 0,
                memUsedMB: 0,
                memLimitMB: 0,
                ports:
                  c.Ports?.filter((p) => p.PublicPort)
                    .map((p) => String(p.PublicPort))
                    .slice(0, 3)
                    .join(', ') || '-',
                updateAvailable: false,
              }))
            );
          } catch {
            resolve([]);
          }
        });
      }
    );
    req.on('error', () => resolve([]));
    req.end();
  });
}

async function readLocalDisks(): Promise<{disks: DiskInfo[]; totalBytes: number; usedBytes: number; freeBytes: number}> {
  const disks: DiskInfo[] = [];
  let totalBytes = 0;
  let usedBytes = 0;
  let freeBytes = 0;

  try {
    let output = '';
    try {
      const res = await execFileAsync('df', ['-kP', '-x', 'tmpfs', '-x', 'devtmpfs', '-x', 'overlay'], {
        encoding: 'utf8',
        timeout: 1500,
      });
      output = res.stdout;
    } catch {
      const res = await execFileAsync('df', ['-kP'], {encoding: 'utf8', timeout: 1500});
      output = res.stdout;
    }
    const lines = output.trim().split('\n').slice(1);
    const seen = new Set<string>();
    for (const line of lines) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 6) continue;
      const fsName = cols[0];
      const sizeK = Number(cols[1]) * 1024;
      const usedK = Number(cols[2]) * 1024;
      const availK = Number(cols[3]) * 1024;
      const mount = cols[5];
      if (!sizeK || seen.has(fsName + mount)) continue;
      seen.add(fsName + mount);

      if (mount === '/' || mount.startsWith('/mnt')) {
        totalBytes += sizeK;
        usedBytes += usedK;
        freeBytes += availK;
      }

      disks.push({
        id: `local-${disks.length}`,
        name: mount === '/' ? 'Root Filesystem' : mount,
        device: fsName,
        role: mount.includes('cache') ? 'cache' : 'data',
        model: 'Linux Block Volume',
        sizeBytes: sizeK,
        usedBytes: usedK,
        tempC: 36,
        smartStatus: 'PASSED',
        spinState: 'active',
        readMBps: 0,
        writeMBps: 0,
        errors: 0,
      });
    }
  } catch {
    // ignore
  }

  return {disks, totalBytes, usedBytes, freeBytes};
}

function readUnraidEmhttpVars(): Record<string, string> {
  const vars: Record<string, string> = {};
  try {
    const varPath = '/var/local/emhttp/var.ini';
    if (!fs.existsSync(varPath)) return vars;
    const raw = fs.readFileSync(varPath, 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^([^=]+)="?(.*?)"?$/);
      if (m) vars[m[1].trim()] = m[2].trim();
    }
  } catch {
    // ignore
  }
  return vars;
}

function readUnraidDisksIni(): DiskInfo[] {
  const disks: DiskInfo[] = [];
  try {
    const iniPath = '/var/local/emhttp/disks.ini';
    if (!fs.existsSync(iniPath)) return disks;
    const raw = fs.readFileSync(iniPath, 'utf8');
    let currentSection = '';
    let current: Record<string, string> = {};

    const flush = () => {
      if (!currentSection || !current.device) return;
      const status = (current.status || '').toUpperCase();
      if (status === 'DISK_NP' || status === 'DISK_NP_DSBL') return;
      const name = current.name || currentSection;
      const role: DiskInfo['role'] =
        name.startsWith('parity')
          ? 'parity'
          : name.startsWith('cache') || (current.fsType || '').includes('zfs')
            ? name.startsWith('cache')
              ? 'cache'
              : 'zfs'
            : 'data';
      const sizeBytes = (Number(current.size || 0) || 0) * 1024;
      const fsSizeBytes = (Number(current.fsSize || 0) || 0) * 1024;
      const fsFreeBytes = (Number(current.fsFree || 0) || 0) * 1024;
      const usedBytes = fsSizeBytes > 0 ? Math.max(0, fsSizeBytes - fsFreeBytes) : 0;
      const tempNum = Number(current.temp);
      const color = (current.color || '').toLowerCase();

      disks.push({
        id: name,
        name: name.charAt(0).toUpperCase() + name.slice(1),
        device: `/dev/${current.device}`,
        role,
        model: (current.id || current.model || 'Unraid Drive').trim(),
        sizeBytes: fsSizeBytes || sizeBytes,
        usedBytes,
        tempC: Number.isFinite(tempNum) && tempNum > 0 ? tempNum : 0,
        smartStatus: Number(current.numErrors || 0) > 0 ? 'WARNING' : 'PASSED',
        spinState: color.includes('blink') ? 'standby' : 'active',
        readMBps: 0,
        writeMBps: 0,
        errors: Number(current.numErrors || 0) || 0,
      });
    };

    for (const line of raw.split('\n')) {
      const sec = line.match(/^\[(?:"([^"]+)"|([^\]]+))\]/);
      if (sec) {
        flush();
        currentSection = (sec[1] || sec[2] || '').trim();
        current = {};
        continue;
      }
      const kv = line.match(/^([^=]+)="?(.*?)"?$/);
      if (kv) {
        current[kv[1].trim()] = kv[2].trim();
      }
    }
    flush();
  } catch {
    // ignore
  }
  return disks;
}

async function readSmbSessions(): Promise<ActiveSessionInfo[]> {
  try {
    const {stdout} = await execFileAsync('smbstatus', ['-b', '--json'], {encoding: 'utf8', timeout: 1200});
    const parsed = JSON.parse(stdout) as {
      sessions?: Record<
        string,
        {username?: string; remote_machine?: string; protocol_version?: string; session_id?: string}
      >;
    };
    if (!parsed.sessions) return [];
    return Object.entries(parsed.sessions).map(([id, s]) => ({
      id,
      username: s.username || 'smbuser',
      protocol: 'SMB3_11',
      clientIp: s.remote_machine || 'LAN',
      shareOrPath: '/mnt/user',
      openFiles: 1,
      durationSec: 60,
      throughputMBps: 0,
    }));
  } catch {
    return [];
  }
}

export async function getLocalHostTelemetry(haConnected: boolean): Promise<TelemetrySnapshot> {
  await refreshHostCliCacheIfNeeded();

  const cpuPercent = readCpuPercentFromProc();
  const cpuDetails = readLocalCpuDetails();
  const mem = readProcMemInfo();
  const net = readLocalNetworkStats();
  const hwmon = readLocalHwmon();
  const raplWatts = readRaplPowerWatts();
  const gpus = readLocalGpus();
  const emhttp = readUnraidEmhttpVars();
  const emhttpDisks = readUnraidDisksIni();
  const [containers, localDisks, sessions] = await Promise.all([
    readLocalDockerSocket(),
    readLocalDisks(),
    readSmbSessions(),
  ]);
  const ramPct = mem.total > 0 ? Math.round((mem.used / mem.total) * 100) : 0;

  pushHistoryPoint(cpuPercent, ramPct, net.rxMbps, net.txMbps);

  const isUnraidHost = Object.keys(emhttp).length > 0 || emhttpDisks.length > 0;
  const disks = emhttpDisks.length > 0 ? emhttpDisks : localDisks.disks;
  const arrayDataDisks = emhttpDisks.filter((d) => d.role === 'data');
  const totalBytes =
    arrayDataDisks.length > 0
      ? arrayDataDisks.reduce((a, d) => a + d.sizeBytes, 0)
      : localDisks.totalBytes;
  const usedBytes =
    arrayDataDisks.length > 0
      ? arrayDataDisks.reduce((a, d) => a + d.usedBytes, 0)
      : localDisks.usedBytes;
  const freeBytes = Math.max(0, totalBytes - usedBytes);

  const cpuTempC = hwmon.cpuTempC ?? 0;
  const cpuPowerW =
    raplWatts ?? hwmon.hwmonCpuPowerW ?? Number((12 + cpuPercent * 0.4).toFixed(1));

  const collectorTools: string[] = ['procfs', 'sysfs'];
  if (isUnraidHost) collectorTools.push('emhttp');
  if (hostCliCache.sensors?.available) collectorTools.push('lm-sensors');
  if (hostCliCache.nvidiaAvailable) collectorTools.push('nvidia-smi');
  if (hostCliCache.intelGpuTopAvailable) collectorTools.push('intel_gpu_top');
  if (hostCliCache.radeonTopAvailable) collectorTools.push('radeontop');

  const mdResync = Number(emhttp.mdResync || 0);
  const mdResyncPos = Number(emhttp.mdResyncPos || 0);
  const mdResyncSize = Number(emhttp.mdResyncSize || 0);
  const parityProgressPercent =
    mdResync > 0 && mdResyncSize > 0
      ? Math.min(100, Math.max(0, Number(((mdResyncPos / mdResyncSize) * 100).toFixed(1))))
      : 0;
  const moverRunning = fs.existsSync('/var/run/mover.pid');
  const localTasks: ServerTaskInfo[] = [];
  if (mdResync > 0) {
    localTasks.push({
      id: 'task-parity',
      name: 'Unraid Parity Sync / Check',
      category: 'parity',
      status: 'running',
      progressPercent: parityProgressPercent,
      speedText: emhttp.mdResyncSpeed ? `${emhttp.mdResyncSpeed}` : 'Running',
      etaText: 'Active',
      schedule: 'Array Maintenance',
      lastRun: 'In progress',
    });
  }
  if (moverRunning) {
    localTasks.push({
      id: 'task-mover',
      name: 'Unraid Mover',
      category: 'mover',
      status: 'running',
      progressPercent: 50,
      speedText: 'Moving',
      etaText: 'Active',
      schedule: 'Scheduled',
      lastRun: 'In progress',
    });
  }

  return {
    timestamp: Date.now(),
    sourceMode: 'local',
    sourceLabel: isUnraidHost
      ? `Local Unraid Host (${collectorTools.join(' + ')})`
      : `Local Linux Host (${collectorTools.join(' + ')})`,
    isRealUnraidHost: isUnraidHost || fs.existsSync('/var/run/docker.sock'),
    agentConnected: false,
    haConnected,
    collectorTools,
    system: {
      hostname: emhttp.NAME || os.hostname(),
      unraidVersion: emhttp.version ? `Unraid OS ${emhttp.version}` : `${os.type()} ${os.release()}`,
      kernel: os.release(),
      uptimeSeconds: Math.floor(os.uptime()),
      cpuModel: cpuDetails.model,
      cpuCores: cpuDetails.cores,
      cpuPercent,
      cpuFreqMhz: cpuDetails.freqMhz,
      cpuTempC,
      cpuPowerW,
      loadAvg: os.loadavg().map((v) => Number(v.toFixed(2))) as [number, number, number],
      ramTotalBytes: mem.total,
      ramUsedBytes: mem.used,
      ramCachedBytes: mem.cached,
      swapTotalBytes: mem.swapTotal,
      swapUsedBytes: mem.swapUsed,
    },
    array: {
      state:
        mdResync > 0
          ? 'PARITY_SYNC'
          : emhttp.mdState === 'STOPPED'
            ? 'STOPPED'
            : 'STARTED',
      parityValid: emhttp.mdResync === '0' || !emhttp.mdResync,
      parityCheckRunning: mdResync > 0,
      parityProgressPercent,
      totalBytes,
      usedBytes,
      freeBytes,
      moverRunning,
    },
    history: {
      timestamps: [...historyBuffer.timestamps],
      cpuSeries: [...historyBuffer.cpuSeries],
      ramSeries: [...historyBuffer.ramSeries],
      netRxSeries: [...historyBuffer.netRxSeries],
      netTxSeries: [...historyBuffer.netTxSeries],
    },
    disks,
    zfsPools: [],
    shares: [],
    containers,
    vms: [],
    sessions,
    tasks: localTasks,
    ups: {
      connected: false,
      model: 'No UPS detected on host',
      status: 'ONLINE',
      loadPercent: 0,
      batteryPercent: 100,
      runtimeMinutes: 0,
      inputVoltage: 0,
      nominalPowerW: 0,
      currentPowerW: 0,
    },
    fans: hwmon.fans,
    temps: hwmon.temps.map(({id, label, tempC, highC}) => ({id, label, tempC, highC})),
    network: net.interfaces,
    gpus,
    sensors: hwmon.rawSensors,
  };
}

async function fetchJsonWithTimeout(url: string, token?: string): Promise<unknown | null> {
  try {
    const headers: Record<string, string> = {Accept: 'application/json'};
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await safeOutboundFetch(url, {
      headers,
      timeoutMs: 2200,
      maxBytes: 2 * 1024 * 1024,
    });
    if (!res.ok) return null;
    return JSON.parse(res.bodyBuffer.toString('utf8')) as unknown;
  } catch {
    return null;
  }
}

export async function fetchAgentTelemetry(
  agentUrl: string,
  agentToken: string,
  haConnected: boolean
): Promise<TelemetrySnapshot | null> {
  const base = agentUrl.replace(/\/+$/, '');
  const health = await fetchJsonWithTimeout(`${base}/api/v1/health`, agentToken);
  if (!health) return null;

  const [systemRaw, arrayRaw, dockerRaw, vmsRaw, upsRaw, netRaw, disksRaw, sharesRaw, zfsRaw] =
    await Promise.all([
      fetchJsonWithTimeout(`${base}/api/v1/system`, agentToken),
      fetchJsonWithTimeout(`${base}/api/v1/array`, agentToken),
      fetchJsonWithTimeout(`${base}/api/v1/docker`, agentToken),
      fetchJsonWithTimeout(`${base}/api/v1/vms`, agentToken),
      fetchJsonWithTimeout(`${base}/api/v1/ups`, agentToken),
      fetchJsonWithTimeout(`${base}/api/v1/network`, agentToken),
      fetchJsonWithTimeout(`${base}/api/v1/disks`, agentToken),
      fetchJsonWithTimeout(`${base}/api/v1/shares`, agentToken),
      fetchJsonWithTimeout(`${base}/api/v1/zfs`, agentToken),
    ]);

  const sys = (systemRaw as Record<string, unknown>) || {};
  const arr = (arrayRaw as Record<string, unknown>) || {};
  const ups = (upsRaw as Record<string, unknown>) || {};

  const cpuPercent = Number(sys.cpu_usage_percent ?? sys.cpu_percent ?? 18);
  const ramTotalBytes = Number(sys.ram_total_bytes ?? 64 * 1024 ** 3);
  const ramUsedBytes = Number(sys.ram_used_bytes ?? 24 * 1024 ** 3);
  const ramPct = ramTotalBytes > 0 ? Math.round((ramUsedBytes / ramTotalBytes) * 100) : 0;

  const netList: NetworkInterfaceInfo[] = Array.isArray(netRaw)
    ? netRaw.map((n: Record<string, unknown>) => ({
        name: String(n.name ?? 'eth0'),
        linkSpeedMbps: Number(n.speed_mbps ?? 1000),
        ipAddress: String(n.ip_address ?? '192.168.1.50'),
        rxMbps: Number(n.rx_mbps ?? 0),
        txMbps: Number(n.tx_mbps ?? 0),
        rxTotalGB: Number(n.rx_gb ?? 0),
        txTotalGB: Number(n.tx_gb ?? 0),
        sfpTempC: n.sfp_temp_c ? Number(n.sfp_temp_c) : undefined,
      }))
    : [];

  const rxTotal = netList.reduce((acc, n) => acc + n.rxMbps, 0);
  const txTotal = netList.reduce((acc, n) => acc + n.txMbps, 0);
  pushHistoryPoint(cpuPercent, ramPct, rxTotal, txTotal);

  const disks: DiskInfo[] = Array.isArray(disksRaw)
    ? disksRaw.map((d: Record<string, unknown>, i: number) => ({
        id: String(d.id ?? `disk-${i}`),
        name: String(d.name ?? `disk${i}`),
        device: String(d.device ?? `/dev/sd${String.fromCharCode(97 + i)}`),
        role: (String(d.role ?? 'data').toLowerCase() as DiskInfo['role']),
        model: String(d.model ?? 'Unknown Drive'),
        sizeBytes: Number(d.size_bytes ?? 0),
        usedBytes: Number(d.used_bytes ?? 0),
        tempC: Number(d.temperature_c ?? d.temp ?? 35),
        smartStatus: (String(d.smart_status ?? 'PASSED') as DiskInfo['smartStatus']),
        spinState: d.spin_state === 'standby' ? 'standby' : 'active',
        readMBps: Number(d.read_mbps ?? 0),
        writeMBps: Number(d.write_mbps ?? 0),
        errors: Number(d.errors ?? 0),
      }))
    : [];

  const containers: DockerContainerInfo[] = Array.isArray(dockerRaw)
    ? dockerRaw.map((c: Record<string, unknown>) => ({
        id: String(c.id ?? c.name ?? 'container'),
        name: String(c.name ?? 'container'),
        image: String(c.image ?? 'unknown'),
        state: c.state === 'running' ? 'running' : 'exited',
        statusText: String(c.status ?? c.state ?? 'unknown'),
        cpuPercent: Number(c.cpu_percent ?? 0),
        memUsedMB: Number(c.memory_used_mb ?? 0),
        memLimitMB: Number(c.memory_limit_mb ?? 2048),
        ports: String(c.ports ?? '-'),
        updateAvailable: Boolean(c.update_available),
      }))
    : [];

  const vms: VmInfo[] = Array.isArray(vmsRaw)
    ? vmsRaw.map((v: Record<string, unknown>) => ({
        id: String(v.id ?? v.name ?? 'vm'),
        name: String(v.name ?? 'VM'),
        state: v.state === 'running' ? 'running' : 'shutoff',
        vcpus: Number(v.vcpus ?? 2),
        memoryMB: Number(v.memory_mb ?? 4096),
        cpuPercent: Number(v.cpu_percent ?? 0),
      }))
    : [];

  const shares: ShareInfo[] = Array.isArray(sharesRaw)
    ? sharesRaw.map((s: Record<string, unknown>) => ({
        name: String(s.name ?? 'share'),
        usedBytes: Number(s.used_bytes ?? 0),
        freeBytes: Number(s.free_bytes ?? 0),
        cachePolicy: (String(s.cache_policy ?? 'Yes') as ShareInfo['cachePolicy']),
        smbExported: Boolean(s.smb_exported ?? true),
      }))
    : [];

  const zfsPools: ZfsPoolInfo[] = Array.isArray(zfsRaw)
    ? zfsRaw.map((z: Record<string, unknown>) => ({
        name: String(z.name ?? 'tank'),
        health: (String(z.health ?? 'ONLINE') as ZfsPoolInfo['health']),
        sizeBytes: Number(z.size_bytes ?? 0),
        usedBytes: Number(z.used_bytes ?? 0),
        arcHitRatio: Number(z.arc_hit_ratio ?? 94.2),
        dedupRatio: Number(z.dedup_ratio ?? 1.0),
      }))
    : [];

  return {
    timestamp: Date.now(),
    sourceMode: 'agent',
    sourceLabel: `Unraid Management Agent (${base})`,
    isRealUnraidHost: true,
    agentConnected: true,
    haConnected,
    system: {
      hostname: String(sys.hostname ?? 'Unraid-Server'),
      unraidVersion: String(sys.unraid_version ?? 'Unraid OS 7.0.1'),
      kernel: String(sys.kernel ?? '6.6.68-Unraid'),
      uptimeSeconds: Number(sys.uptime_seconds ?? 86400),
      cpuModel: String(sys.cpu_model ?? 'AMD Ryzen 7 PRO 8845HS'),
      cpuCores: Number(sys.cpu_cores ?? 16),
      cpuPercent,
      cpuTempC: Number(sys.cpu_temp_c ?? 46),
      cpuPowerW: Number(sys.cpu_power_w ?? 28.4),
      loadAvg: (Array.isArray(sys.load_avg) ? sys.load_avg : [0.85, 0.72, 0.64]) as [number, number, number],
      ramTotalBytes,
      ramUsedBytes,
      ramCachedBytes: Number(sys.ram_cached_bytes ?? 14 * 1024 ** 3),
      swapTotalBytes: Number(sys.swap_total_bytes ?? 0),
      swapUsedBytes: Number(sys.swap_used_bytes ?? 0),
    },
    array: {
      state: (String(arr.state ?? 'STARTED') as TelemetrySnapshot['array']['state']),
      parityValid: Boolean(arr.parity_valid ?? true),
      parityCheckRunning: Boolean(arr.parity_check_running ?? false),
      parityProgressPercent: Number(arr.parity_progress_percent ?? 0),
      totalBytes: Number(arr.total_bytes ?? 72 * 1024 ** 4),
      usedBytes: Number(arr.used_bytes ?? 41 * 1024 ** 4),
      freeBytes: Number(arr.free_bytes ?? 31 * 1024 ** 4),
      moverRunning: Boolean(arr.mover_running ?? false),
    },
    history: {
      timestamps: [...historyBuffer.timestamps],
      cpuSeries: [...historyBuffer.cpuSeries],
      ramSeries: [...historyBuffer.ramSeries],
      netRxSeries: [...historyBuffer.netRxSeries],
      netTxSeries: [...historyBuffer.netTxSeries],
    },
    disks,
    zfsPools,
    shares,
    containers,
    vms,
    sessions: [],
    tasks: [],
    ups: {
      connected: Boolean(ups.connected ?? false),
      model: String(ups.model ?? 'UPS'),
      status: (String(ups.status ?? 'ONLINE') as UpsInfo['status']),
      loadPercent: Number(ups.load_percent ?? 0),
      batteryPercent: Number(ups.battery_percent ?? 100),
      runtimeMinutes: Number(ups.runtime_minutes ?? 0),
      inputVoltage: Number(ups.input_voltage ?? 230),
      nominalPowerW: Number(ups.nominal_power_w ?? 900),
      currentPowerW: Number(ups.current_power_w ?? 0),
    },
    fans: [],
    temps: [],
    network: netList,
    gpus: [],
  };
}

export function getSimulationTelemetry(haConnected: boolean): TelemetrySnapshot {
  const t = Date.now() / 1000;
  const realCpu = readCpuPercentFromProc();
  const cpuPercent = Math.round(realCpu * 0.4 + 20 + Math.sin(t * 0.45) * 8);
  const ramTotalBytes = 64 * 1024 ** 3;
  const ramUsedBytes = Math.round((38.4 + Math.sin(t * 0.15) * 0.8) * 1024 ** 3);
  const ramCachedBytes = 18.6 * 1024 ** 3;
  const ramPct = Math.round((ramUsedBytes / ramTotalBytes) * 100);

  const rxMbps = Number((142 + Math.sin(t * 0.6) * 48 + Math.cos(t * 1.3) * 18).toFixed(1));
  const txMbps = Number((38 + Math.cos(t * 0.5) * 14).toFixed(1));

  pushHistoryPoint(cpuPercent, ramPct, rxMbps, txMbps);

  for (const id of Object.keys(taskOverrides)) {
    if (taskOverrides[id].status === 'running') {
      taskOverrides[id].progressPercent =
        taskOverrides[id].progressPercent >= 99 ? 4 : Number((taskOverrides[id].progressPercent + 0.4).toFixed(1));
    }
  }

  const disks: DiskInfo[] = [
    {
      id: 'parity1',
      name: 'Parity',
      device: '/dev/sdb',
      role: 'parity',
      model: 'Seagate Exos X20 18TB',
      sizeBytes: 18 * 1024 ** 4,
      usedBytes: 0,
      tempC: 37,
      smartStatus: 'PASSED',
      spinState: 'active',
      readMBps: 18.4,
      writeMBps: 42.1,
      errors: 0,
    },
    {
      id: 'disk1',
      name: 'Disk 1',
      device: '/dev/sdc',
      role: 'data',
      model: 'Seagate Exos X20 18TB',
      sizeBytes: 18 * 1024 ** 4,
      usedBytes: 14.2 * 1024 ** 4,
      tempC: 36,
      smartStatus: 'PASSED',
      spinState: 'active',
      readMBps: 64.2,
      writeMBps: 12.0,
      errors: 0,
    },
    {
      id: 'disk2',
      name: 'Disk 2',
      device: '/dev/sdd',
      role: 'data',
      model: 'Seagate Exos X20 18TB',
      sizeBytes: 18 * 1024 ** 4,
      usedBytes: 13.8 * 1024 ** 4,
      tempC: 38,
      smartStatus: 'PASSED',
      spinState: 'active',
      readMBps: 22.8,
      writeMBps: 18.5,
      errors: 0,
    },
    {
      id: 'disk3',
      name: 'Disk 3',
      device: '/dev/sde',
      role: 'data',
      model: 'WD Ultrastar HC550 18TB',
      sizeBytes: 18 * 1024 ** 4,
      usedBytes: 11.4 * 1024 ** 4,
      tempC: 35,
      smartStatus: 'PASSED',
      spinState: 'active',
      readMBps: 0.4,
      writeMBps: 0.2,
      errors: 0,
    },
    {
      id: 'disk4',
      name: 'Disk 4',
      device: '/dev/sdf',
      role: 'data',
      model: 'WD Ultrastar HC550 18TB',
      sizeBytes: 18 * 1024 ** 4,
      usedBytes: 6.1 * 1024 ** 4,
      tempC: 29,
      smartStatus: 'PASSED',
      spinState: 'standby',
      readMBps: 0,
      writeMBps: 0,
      errors: 0,
    },
    {
      id: 'nvme0',
      name: 'Cache NVMe 1',
      device: '/dev/nvme0n1',
      role: 'cache',
      model: 'WD Red SN700 2TB',
      sizeBytes: 2 * 1024 ** 4,
      usedBytes: 0.84 * 1024 ** 4,
      tempC: 44,
      smartStatus: 'PASSED',
      spinState: 'active',
      readMBps: 412.0,
      writeMBps: 188.5,
      errors: 0,
    },
    {
      id: 'nvme1',
      name: 'ZFS Pool NVMe',
      device: '/dev/nvme1n1',
      role: 'zfs',
      model: 'Samsung 990 PRO 4TB',
      sizeBytes: 4 * 1024 ** 4,
      usedBytes: 2.15 * 1024 ** 4,
      tempC: 46,
      smartStatus: 'PASSED',
      spinState: 'active',
      readMBps: 290.1,
      writeMBps: 94.3,
      errors: 0,
    },
  ];

  const containers: DockerContainerInfo[] = [
    {
      id: 'c-plex',
      name: 'plex',
      image: 'lscr.io/linuxserver/plex:1.41.3',
      state: 'running',
      statusText: 'Up 14 days (healthy)',
      cpuPercent: Number((8.4 + Math.sin(t * 0.7) * 3.1).toFixed(1)),
      memUsedMB: 2140,
      memLimitMB: 8192,
      ports: '32400',
      updateAvailable: false,
    },
    {
      id: 'c-ha',
      name: 'homeassistant',
      image: 'ghcr.io/home-assistant/home-assistant:2026.11',
      state: 'running',
      statusText: 'Up 14 days (healthy)',
      cpuPercent: 3.2,
      memUsedMB: 1180,
      memLimitMB: 4096,
      ports: '8123',
      updateAvailable: false,
    },
    {
      id: 'c-immich',
      name: 'immich-server',
      image: 'ghcr.io/immich-app/immich-server:v1.124',
      state: 'running',
      statusText: 'Up 6 days (healthy)',
      cpuPercent: 5.1,
      memUsedMB: 1890,
      memLimitMB: 8192,
      ports: '2283',
      updateAvailable: true,
    },
    {
      id: 'c-frigate',
      name: 'frigate',
      image: 'ghcr.io/blakeblackshear/frigate:0.15.0',
      state: 'running',
      statusText: 'Up 14 days',
      cpuPercent: 6.8,
      memUsedMB: 1620,
      memLimitMB: 4096,
      ports: '5000, 8554',
      updateAvailable: false,
    },
    {
      id: 'c-traefik',
      name: 'traefik',
      image: 'traefik:v3.2',
      state: 'running',
      statusText: 'Up 14 days',
      cpuPercent: 0.4,
      memUsedMB: 142,
      memLimitMB: 1024,
      ports: '80, 443',
      updateAvailable: false,
    },
  ];

  const sessions: ActiveSessionInfo[] = [
    {
      id: 'sess-1',
      username: 'joshua',
      protocol: 'SMB3_11',
      clientIp: '192.168.1.42',
      shareOrPath: '/mnt/user/media',
      openFiles: 3,
      durationSec: 4920,
      throughputMBps: 112.4,
    },
    {
      id: 'sess-2',
      username: 'timemachine',
      protocol: 'SMB3_11',
      clientIp: '192.168.1.88',
      shareOrPath: '/mnt/user/backups',
      openFiles: 1,
      durationSec: 1285,
      throughputMBps: 64.8,
    },
  ];

  const tasks: ServerTaskInfo[] = [
    {
      id: 'task-backup',
      name: 'Appdata Backup (CA Backup v2)',
      category: 'backup',
      status: taskOverrides['task-backup']?.status ?? 'running',
      progressPercent: taskOverrides['task-backup']?.progressPercent ?? 64,
      speedText: taskOverrides['task-backup']?.speedText ?? '312 MB/s',
      etaText: taskOverrides['task-backup']?.etaText ?? '4m 18s',
      schedule: 'Daily 03:00',
      lastRun: 'In progress',
    },
    {
      id: 'task-parity',
      name: 'Monthly Parity Check (Non-Correcting)',
      category: 'parity',
      status: taskOverrides['task-parity']?.status ?? 'scheduled',
      progressPercent: taskOverrides['task-parity']?.progressPercent ?? 0,
      speedText: taskOverrides['task-parity']?.speedText ?? 'Avg 218 MB/s',
      etaText: taskOverrides['task-parity']?.etaText ?? 'Scheduled',
      schedule: '1st of Month 00:00',
      lastRun: '21 days ago (0 errors)',
    },
    {
      id: 'task-mover',
      name: 'Unraid Mover (Cache -> Array)',
      category: 'mover',
      status: taskOverrides['task-mover']?.status ?? 'idle',
      progressPercent: taskOverrides['task-mover']?.progressPercent ?? 100,
      speedText: taskOverrides['task-mover']?.speedText ?? '485 MB/s',
      etaText: taskOverrides['task-mover']?.etaText ?? 'Idle',
      schedule: 'Hourly (>70% cache)',
      lastRun: '42m ago (38.4 GB moved)',
    },
  ];

  const parityRunning = tasks.find((tk) => tk.id === 'task-parity')?.status === 'running';
  const moverRunning = tasks.find((tk) => tk.id === 'task-mover')?.status === 'running';

  return {
    timestamp: Date.now(),
    sourceMode: 'auto',
    sourceLabel: 'Local Server Stats (Host + Unraid Profile)',
    isRealUnraidHost: false,
    agentConnected: false,
    haConnected,
    system: {
      hostname: 'WTR-MAX-UNRAID',
      unraidVersion: 'Unraid OS 7.0.1',
      kernel: '6.6.68-Unraid',
      uptimeSeconds: 1219420,
      cpuModel: 'AMD Ryzen 7 PRO 8845HS (16T)',
      cpuCores: 16,
      cpuPercent,
      cpuTempC: Math.round(48 + Math.sin(t * 0.3) * 3),
      cpuPowerW: Number((26.4 + cpuPercent * 0.42).toFixed(1)),
      loadAvg: [Number((cpuPercent / 20).toFixed(2)), 1.18, 0.96],
      ramTotalBytes,
      ramUsedBytes,
      ramCachedBytes,
      swapTotalBytes: 0,
      swapUsedBytes: 0,
    },
    array: {
      state: parityRunning ? 'PARITY_SYNC' : 'STARTED',
      parityValid: true,
      parityCheckRunning: parityRunning,
      parityProgressPercent: tasks.find((tk) => tk.id === 'task-parity')?.progressPercent ?? 0,
      totalBytes: 72 * 1024 ** 4,
      usedBytes: 45.5 * 1024 ** 4,
      freeBytes: 26.5 * 1024 ** 4,
      moverRunning,
    },
    history: {
      timestamps: [...historyBuffer.timestamps],
      cpuSeries: [...historyBuffer.cpuSeries],
      ramSeries: [...historyBuffer.ramSeries],
      netRxSeries: [...historyBuffer.netRxSeries],
      netTxSeries: [...historyBuffer.netTxSeries],
    },
    disks,
    zfsPools: [
      {
        name: 'nvme_fast',
        health: 'ONLINE',
        sizeBytes: 4 * 1024 ** 4,
        usedBytes: 2.15 * 1024 ** 4,
        arcHitRatio: 96.4,
        dedupRatio: 1.0,
      },
    ],
    shares: [
      {name: 'media', usedBytes: 34.2 * 1024 ** 4, freeBytes: 26.5 * 1024 ** 4, cachePolicy: 'Yes', smbExported: true},
      {name: 'backups', usedBytes: 8.6 * 1024 ** 4, freeBytes: 26.5 * 1024 ** 4, cachePolicy: 'Yes', smbExported: true},
    ],
    containers,
    vms: [],
    sessions,
    tasks,
    ups: {
      connected: true,
      model: 'CyberPower CP1500PFCLCD',
      status: 'ONLINE',
      loadPercent: 18,
      batteryPercent: 100,
      runtimeMinutes: 47,
      inputVoltage: 234.2,
      nominalPowerW: 900,
      currentPowerW: 162,
    },
    fans: [
      {id: 'fan-1', label: 'Chassis Rear 120mm', rpm: 1180, pwmPercent: 48},
      {id: 'fan-2', label: 'Drive Cage Fan', rpm: 1340, pwmPercent: 55},
    ],
    temps: [
      {id: 't-cpu', label: 'Ryzen Tctl', tempC: 48.2, highC: 90},
      {id: 't-sfp', label: '10GbE SFP+', tempC: 51.8, highC: 75},
    ],
    network: [
      {
        name: 'eth0 (10GbE SFP+)',
        linkSpeedMbps: 10000,
        ipAddress: '192.168.1.50',
        rxMbps,
        txMbps,
        rxTotalGB: 1428.4,
        txTotalGB: 412.9,
        sfpTempC: 51.8,
      },
    ],
    gpus: [
      {
        id: 'gpu-0',
        name: 'AMD Radeon 780M Graphics',
        vendor: 'amd',
        tempC: Math.round(44 + Math.sin(t * 0.25) * 2),
        utilPercent: Math.max(2, Math.round(14 + Math.sin(t * 0.4) * 9)),
        freqMhz: 1100,
        powerW: Number((8.5 + Math.sin(t * 0.35) * 2.1).toFixed(1)),
        vramUsedMB: 512,
        vramTotalMB: 4096,
      },
    ],
  };
}

export async function fetchHomeAssistantEntities(
  haEnabled: boolean,
  haUrl: string,
  haToken: string
): Promise<{connected: boolean; entities: HomeAssistantEntity[]}> {
  if (haEnabled && haUrl && haToken) {
    const base = haUrl.replace(/\/+$/, '');
    const data = await fetchJsonWithTimeout(`${base}/api/states`, haToken);
    if (Array.isArray(data)) {
      return {
        connected: true,
        entities: data as HomeAssistantEntity[],
      };
    }
  }

  return {
    connected: false,
    entities: [],
  };
}

function getByJsonPath(obj: unknown, dotPath?: string): string | number | null {
  if (!dotPath) {
    if (typeof obj === 'string' || typeof obj === 'number') return obj;
    return null;
  }
  const parts = dotPath.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return null;
    }
  }
  if (typeof cur === 'string' || typeof cur === 'number' || typeof cur === 'boolean') {
    return typeof cur === 'boolean' ? (cur ? 1 : 0) : cur;
  }
  return null;
}

export async function pollCustomConnections(connections: CustomConnection[]): Promise<CustomConnection[]> {
  return await Promise.all(
    connections.map(async (conn) => {
      if (!conn.enabled || !conn.url) return conn;
      try {
        const headers: Record<string, string> = {Accept: 'application/json'};
        if (conn.token) headers.Authorization = `Bearer ${conn.token}`;
        const res = await safeOutboundFetch(conn.url, {
          headers,
          timeoutMs: 2200,
          maxBytes: 2 * 1024 * 1024,
        });
        if (!res.ok) {
          return {...conn, lastError: `HTTP ${res.status} from upstream`};
        }
        const data = JSON.parse(res.bodyBuffer.toString('utf8')) as unknown;
        const extracted = getByJsonPath(data, conn.jsonPath);
        return {
          ...conn,
          lastValue: extracted !== null ? String(extracted) : JSON.stringify(data).slice(0, 48),
          lastError: undefined,
        };
      } catch (err) {
        return {
          ...conn,
          lastError: err instanceof Error ? err.message : 'Fetch error',
        };
      }
    })
  );
}

export interface IntegrationPollCache {
  updatedAt: number;
  haConnected: boolean;
  haEntities: HomeAssistantEntity[];
  customConnections: CustomConnection[];
}

let cachedIntegrationPoll: IntegrationPollCache = {
  updatedAt: 0,
  haConnected: false,
  haEntities: [],
  customConnections: [],
};
let integrationPollTimer: NodeJS.Timeout | null = null;
let integrationPollInFlight: Promise<IntegrationPollCache> | null = null;

export async function refreshIntegrationsCache(cfg: StudioConfig): Promise<IntegrationPollCache> {
  if (integrationPollInFlight) return await integrationPollInFlight;
  integrationPollInFlight = (async () => {
    try {
      const {haEnabled, haUrl, haToken, customConnections} = cfg.integrations;
      const [haRes, polledCustom] = await Promise.all([
        fetchHomeAssistantEntities(haEnabled, haUrl, haToken),
        pollCustomConnections(customConnections),
      ]);
      cachedIntegrationPoll = {
        updatedAt: Date.now(),
        haConnected: haRes.connected,
        haEntities: haRes.entities,
        customConnections: polledCustom,
      };
      return cachedIntegrationPoll;
    } finally {
      integrationPollInFlight = null;
    }
  })();
  return await integrationPollInFlight;
}

export async function getCachedOrRefreshIntegrations(
  cfg: StudioConfig,
  maxAgeMs = 4500
): Promise<IntegrationPollCache> {
  if (Date.now() - cachedIntegrationPoll.updatedAt < maxAgeMs && cachedIntegrationPoll.updatedAt > 0) {
    return cachedIntegrationPoll;
  }
  return await refreshIntegrationsCache(cfg);
}

export function startIntegrationPoller(getConfig: () => StudioConfig, intervalMs = 5000): void {
  stopIntegrationPoller();
  void refreshIntegrationsCache(getConfig()).catch(() => {});
  integrationPollTimer = setInterval(() => {
    void refreshIntegrationsCache(getConfig()).catch(() => {});
  }, Math.max(2000, intervalMs));
  integrationPollTimer.unref?.();
}

export function stopIntegrationPoller(): void {
  if (integrationPollTimer) {
    clearInterval(integrationPollTimer);
    integrationPollTimer = null;
  }
}

function hasRealHostHardwarePaths(): boolean {
  try {
    if (fs.existsSync('/var/local/emhttp/var.ini') || fs.existsSync('/var/local/emhttp/disks.ini')) {
      return true;
    }
    if (fs.existsSync('/var/run/docker.sock')) {
      return true;
    }
    if (fs.existsSync('/sys/class/hwmon') && fs.readdirSync('/sys/class/hwmon').length > 0) {
      return true;
    }
    if (fs.existsSync('/sys/class/drm') && fs.readdirSync('/sys/class/drm').some((d) => /^card\d+$/.test(d))) {
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

export async function resolveTelemetry(
  sourceMode: DataSourceMode,
  agentEnabled: boolean,
  agentUrl: string,
  agentToken: string,
  haConnected: boolean
): Promise<TelemetrySnapshot> {
  // 1. Check Unraid Management Agent first if configured and enabled
  if (agentEnabled && agentUrl) {
    const agentData = await fetchAgentTelemetry(agentUrl, agentToken, haConnected);
    if (agentData) return agentData;
  }

  if (sourceMode === 'simulation') {
    return getSimulationTelemetry(haConnected);
  }

  // 2. Use real host telemetry whenever running on Unraid or Linux with real host hardware paths
  if (sourceMode === 'local' || hasRealHostHardwarePaths()) {
    return await getLocalHostTelemetry(haConnected);
  }

  // 3. Browser preview sandbox fallback when no Unraid / Linux hardware sensors exist
  return getSimulationTelemetry(haConnected);
}

export function buildExposedEntities(
  snapshot: TelemetrySnapshot,
  haEntities: HomeAssistantEntity[],
  customConnections: CustomConnection[],
  overrides: Record<string, EntityOverride>
): ExposedEntity[] {
  const list: ExposedEntity[] = [];

  const pushEntity = (
    id: string,
    source: ExposedEntity['source'],
    defaultTag: string,
    rawValue: string | number,
    defaultUnit: string,
    explicitHistory?: number[]
  ) => {
    const ov = overrides[id] || {};
    const num = typeof rawValue === 'number' ? rawValue : Number(rawValue);
    const numericValue = Number.isFinite(num) && String(rawValue).trim() !== '' ? num : null;
    recordEntityHistory(id, numericValue);

    list.push({
      id,
      source,
      tag: ov.tag?.trim() || defaultTag,
      rawValue,
      numericValue,
      unit: ov.unit !== undefined ? ov.unit : defaultUnit,
      history: explicitHistory ?? [...(entityHistoryMap.get(id) ?? (numericValue !== null ? [numericValue] : []))],
      enabled: ov.enabled !== undefined ? ov.enabled : true,
    });
  };

  const ramPct = Math.round((snapshot.system.ramUsedBytes / Math.max(1, snapshot.system.ramTotalBytes)) * 100);
  const ramUsedGb = Number((snapshot.system.ramUsedBytes / 1024 ** 3).toFixed(1));
  const arrayPct = Math.round((snapshot.array.usedBytes / Math.max(1, snapshot.array.totalBytes)) * 100);
  const arrayUsedTb = Number((snapshot.array.usedBytes / 1024 ** 4).toFixed(2));
  const rxTotal = Number(snapshot.network.reduce((a, n) => a + n.rxMbps, 0).toFixed(1));
  const txTotal = Number(snapshot.network.reduce((a, n) => a + n.txMbps, 0).toFixed(1));

  pushEntity('server.hostname', 'server', 'Server Hostname', snapshot.system.hostname, '');
  pushEntity('server.cpu_model', 'server', 'CPU Model', snapshot.system.cpuModel, '');
  pushEntity('server.cpu_percent', 'server', 'CPU Load', snapshot.system.cpuPercent, '%', snapshot.history.cpuSeries);
  if (snapshot.system.cpuFreqMhz !== undefined && snapshot.system.cpuFreqMhz !== null) {
    pushEntity('server.cpu_freq_mhz', 'server', 'CPU Clock', snapshot.system.cpuFreqMhz, 'MHz');
  }
  pushEntity('server.cpu_temp', 'server', 'CPU Temp', snapshot.system.cpuTempC, '°C');
  pushEntity('server.cpu_power_w', 'server', 'CPU Power', snapshot.system.cpuPowerW, 'W');
  pushEntity('server.load_1m', 'server', 'Load Avg (1m)', snapshot.system.loadAvg[0], '');
  pushEntity('server.ram_percent', 'server', 'Memory Usage', ramPct, '%', snapshot.history.ramSeries);
  pushEntity('server.ram_used_gb', 'server', 'Memory Used', ramUsedGb, 'GB');

  const primaryGpu = snapshot.gpus?.[0];
  if (primaryGpu) {
    pushEntity('server.gpu_name', 'server', 'GPU Model', primaryGpu.name, '');
    if (primaryGpu.utilPercent !== null) {
      pushEntity('server.gpu_util_percent', 'server', 'GPU Load', primaryGpu.utilPercent, '%');
    }
    if (primaryGpu.tempC !== null) {
      pushEntity('server.gpu_temp', 'server', 'GPU Temp', primaryGpu.tempC, '°C');
    }
    if (primaryGpu.powerW !== null) {
      pushEntity('server.gpu_power_w', 'server', 'GPU Power', primaryGpu.powerW, 'W');
    }
    if (primaryGpu.freqMhz !== null) {
      pushEntity('server.gpu_freq_mhz', 'server', 'GPU Clock', primaryGpu.freqMhz, 'MHz');
    }
    if (primaryGpu.vramUsedMB !== null) {
      pushEntity('server.gpu_vram_used_mb', 'server', 'GPU VRAM Used', primaryGpu.vramUsedMB, 'MB');
    }
    if (primaryGpu.vramUsedMB !== null && primaryGpu.vramTotalMB && primaryGpu.vramTotalMB > 0) {
      pushEntity(
        'server.gpu_vram_percent',
        'server',
        'GPU VRAM %',
        Math.round((primaryGpu.vramUsedMB / primaryGpu.vramTotalMB) * 100),
        '%'
      );
    }
  }

  pushEntity('server.array_used_pct', 'server', 'Array Used', arrayPct, '%');
  pushEntity('server.array_used_tb', 'server', 'Array Used TB', arrayUsedTb, 'TB');
  pushEntity('server.array_state', 'server', 'Array State', snapshot.array.state, '');
  pushEntity('server.net_rx_mbps', 'server', 'Network Download', rxTotal, 'Mbps', snapshot.history.netRxSeries);
  pushEntity('server.net_tx_mbps', 'server', 'Network Upload', txTotal, 'Mbps', snapshot.history.netTxSeries);
  pushEntity(
    'server.docker_running_count',
    'server',
    'Running Dockers',
    snapshot.containers.filter((c) => c.state === 'running').length,
    ''
  );
  pushEntity('server.active_users_count', 'server', 'Connected Users', snapshot.sessions.length, '');
  pushEntity(
    'server.running_tasks_count',
    'server',
    'Active Tasks',
    snapshot.tasks.filter((t) => t.status === 'running').length,
    ''
  );
  pushEntity('server.ups_load_pct', 'server', 'UPS Load', snapshot.ups.loadPercent, '%');
  pushEntity('server.ups_power_w', 'server', 'UPS Draw', snapshot.ups.currentPowerW, 'W');

  for (const disk of snapshot.disks) {
    pushEntity(`disk.${disk.id}.temp_c`, 'server', `${disk.name} Temp`, disk.tempC, '°C');
  }

  const seenSensorIds = new Set<string>(list.map((item) => item.id));
  for (const s of snapshot.sensors ?? []) {
    let uniqueId = s.id;
    let suffix = 2;
    while (seenSensorIds.has(uniqueId)) {
      uniqueId = `${s.id}_${suffix++}`;
    }
    seenSensorIds.add(uniqueId);
    pushEntity(uniqueId, 'server', s.label, s.value, s.unit);
  }

  for (const ha of haEntities) {
    pushEntity(
      `ha.${ha.entity_id}`,
      'home_assistant',
      ha.attributes.friendly_name || ha.entity_id,
      ha.state,
      ha.attributes.unit_of_measurement || ''
    );
  }

  for (const cc of customConnections) {
    if (cc.enabled) {
      pushEntity(
        `custom.${cc.id}`,
        'custom_http',
        cc.name,
        cc.lastValue ?? 'pending',
        cc.unit || ''
      );
    }
  }

  return list;
}
