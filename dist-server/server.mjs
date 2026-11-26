// server.ts
import crypto5 from "node:crypto";
import express from "express";
import fs7 from "node:fs";
import path6 from "node:path";

// src/presets.ts
var PRESET_BACKGROUNDS = [
  {
    id: "bg-anodized",
    name: "Anodized Carbon",
    url: "/src/assets/images/lcd_bg_anodized_carbon_1795344155261.jpg"
  },
  {
    id: "bg-topo",
    name: "Topographic Blueprint",
    url: "/src/assets/images/lcd_bg_topographic_grid_1795344156163.jpg"
  },
  {
    id: "bg-copper",
    name: "Copper Waveform",
    url: "/src/assets/images/lcd_bg_copper_waveform_1795344156492.jpg"
  },
  {
    id: "bg-hawaiian",
    name: "Hawaiian Dusk",
    url: "/src/assets/images/lcd_theme_hawaiian_1795346897893.jpg"
  },
  {
    id: "bg-light",
    name: "Brushed Alabaster",
    url: "/src/assets/images/lcd_theme_light_1795346898169.jpg"
  },
  {
    id: "bg-tech",
    name: "Silicon Circuit",
    url: "/src/assets/images/lcd_theme_tech_1795346898367.jpg"
  }
];
var PREMADE_SCREENS = [
  {
    id: "scr-overview",
    name: "System & Storage Overview",
    enabled: true,
    durationSec: 15,
    transition: "fade",
    backgroundType: "image",
    backgroundColor: "#0B0E14",
    backgroundImage: PRESET_BACKGROUNDS[0].url,
    backgroundDim: 0.45,
    widgets: [
      {
        id: "w-ov-clock",
        type: "clock",
        x: 16,
        y: 16,
        w: 300,
        h: 168,
        title: "System Clock",
        accentColor: "#F59E0B",
        textColor: "#F8FAFC",
        bgColor: "#0D131D",
        bgOpacity: 0.78,
        borderOpacity: 0.25,
        fontScale: 1
      },
      {
        id: "w-ov-cpu",
        type: "cpu_load",
        x: 16,
        y: 196,
        w: 300,
        h: 164,
        title: "CPU Utilization",
        accentColor: "#F59E0B",
        textColor: "#F8FAFC",
        bgColor: "#0D131D",
        bgOpacity: 0.78,
        borderOpacity: 0.25,
        fontScale: 1
      },
      {
        id: "w-ov-chart",
        type: "apex_area",
        x: 328,
        y: 16,
        w: 364,
        h: 196,
        title: "CPU & Memory Load",
        accentColor: "#F59E0B",
        textColor: "#F8FAFC",
        bgColor: "#0D131D",
        bgOpacity: 0.82,
        borderOpacity: 0.25,
        fontScale: 1,
        entityIds: ["server.cpu_percent", "server.ram_percent"],
        chartVariant: "area",
        chartSmooth: true
      },
      {
        id: "w-ov-radial",
        type: "apex_radial",
        x: 704,
        y: 16,
        w: 240,
        h: 196,
        title: "Array Capacity",
        accentColor: "#10B981",
        textColor: "#F8FAFC",
        bgColor: "#0D131D",
        bgOpacity: 0.82,
        borderOpacity: 0.25,
        fontScale: 1,
        entityId: "server.array_used_pct",
        binding: "array_percent"
      },
      {
        id: "w-ov-array",
        type: "array_status",
        x: 328,
        y: 224,
        w: 616,
        h: 136,
        title: "Unraid Array Status",
        accentColor: "#10B981",
        textColor: "#F8FAFC",
        bgColor: "#0D131D",
        bgOpacity: 0.82,
        borderOpacity: 0.25,
        fontScale: 1
      }
    ]
  },
  {
    id: "scr-docker-tasks",
    name: "Dockers, Tasks & Thermals",
    enabled: true,
    durationSec: 15,
    transition: "slide",
    backgroundType: "image",
    backgroundColor: "#0B0E14",
    backgroundImage: PRESET_BACKGROUNDS[1].url,
    backgroundDim: 0.5,
    widgets: [
      {
        id: "w-dt-docker",
        type: "docker_list",
        x: 16,
        y: 16,
        w: 460,
        h: 344,
        title: "Running Containers",
        accentColor: "#38BDF8",
        textColor: "#F8FAFC",
        bgColor: "#0D131D",
        bgOpacity: 0.84,
        borderOpacity: 0.28,
        fontScale: 1,
        maxItems: 7
      },
      {
        id: "w-dt-bar",
        type: "apex_bar",
        x: 488,
        y: 16,
        w: 456,
        h: 184,
        title: "Drive Bay Temps (\xB0C)",
        accentColor: "#F59E0B",
        textColor: "#F8FAFC",
        bgColor: "#0D131D",
        bgOpacity: 0.84,
        borderOpacity: 0.28,
        fontScale: 1,
        entityIds: ["disk.parity1.temp_c", "disk.disk1.temp_c", "disk.disk2.temp_c", "disk.nvme0.temp_c"]
      },
      {
        id: "w-dt-tasks",
        type: "active_tasks",
        x: 488,
        y: 212,
        w: 456,
        h: 148,
        title: "Running & Scheduled Tasks",
        accentColor: "#F59E0B",
        textColor: "#F8FAFC",
        bgColor: "#0D131D",
        bgOpacity: 0.84,
        borderOpacity: 0.28,
        fontScale: 1,
        maxItems: 2
      }
    ]
  },
  {
    id: "scr-net-gpu",
    name: "Network, GPU & Memory",
    enabled: true,
    durationSec: 12,
    transition: "fade",
    backgroundType: "image",
    backgroundColor: "#0B0E14",
    backgroundImage: PRESET_BACKGROUNDS[2].url,
    backgroundDim: 0.42,
    widgets: [
      {
        id: "w-ng-gpu-load",
        type: "entity_number",
        x: 16,
        y: 16,
        w: 300,
        h: 132,
        title: "GPU Utilization",
        accentColor: "#F59E0B",
        textColor: "#F8FAFC",
        bgColor: "#0D131D",
        bgOpacity: 0.82,
        borderOpacity: 0.28,
        fontScale: 1,
        entityId: "server.gpu_util_percent"
      },
      {
        id: "w-ng-gpu-temp",
        type: "entity_number",
        x: 328,
        y: 16,
        w: 300,
        h: 132,
        title: "GPU Temperature",
        accentColor: "#38BDF8",
        textColor: "#F8FAFC",
        bgColor: "#0D131D",
        bgOpacity: 0.82,
        borderOpacity: 0.28,
        fontScale: 1,
        entityId: "server.gpu_temp"
      },
      {
        id: "w-ng-cpu-pwr",
        type: "entity_number",
        x: 640,
        y: 16,
        w: 304,
        h: 132,
        title: "CPU Package Power",
        accentColor: "#10B981",
        textColor: "#F8FAFC",
        bgColor: "#0D131D",
        bgOpacity: 0.82,
        borderOpacity: 0.28,
        fontScale: 1,
        entityId: "server.cpu_power_w"
      },
      {
        id: "w-ng-netchart",
        type: "apex_area",
        x: 16,
        y: 160,
        w: 612,
        h: 200,
        title: "Network Throughput (Mbps)",
        accentColor: "#38BDF8",
        textColor: "#F8FAFC",
        bgColor: "#0D131D",
        bgOpacity: 0.84,
        borderOpacity: 0.28,
        fontScale: 1,
        entityIds: ["server.net_rx_mbps", "server.net_tx_mbps"],
        chartVariant: "area",
        chartSmooth: true
      },
      {
        id: "w-ng-ram",
        type: "apex_radial",
        x: 640,
        y: 160,
        w: 304,
        h: 200,
        title: "Memory Usage %",
        accentColor: "#10B981",
        textColor: "#F8FAFC",
        bgColor: "#0D131D",
        bgOpacity: 0.84,
        borderOpacity: 0.28,
        fontScale: 1,
        entityId: "server.ram_percent",
        binding: "ram_percent"
      }
    ]
  },
  {
    id: "scr-night-clock",
    name: "Minimal Night Clock",
    enabled: true,
    durationSec: 20,
    transition: "fade",
    backgroundType: "solid",
    backgroundColor: "#07090E",
    backgroundDim: 0,
    themeId: "dark",
    widgets: [
      {
        id: "w-nc-clock",
        type: "clock",
        x: 24,
        y: 20,
        w: 584,
        h: 208,
        title: "System Time",
        accentColor: "#F59E0B",
        textColor: "#F8FAFC",
        bgColor: "#0E141F",
        bgOpacity: 0.72,
        borderOpacity: 0.2,
        fontScale: 1.2,
        fontSizePreset: "lg"
      },
      {
        id: "w-nc-ambient",
        type: "entity_number",
        x: 624,
        y: 20,
        w: 312,
        h: 98,
        title: "CPU Package Temp",
        accentColor: "#38BDF8",
        textColor: "#F8FAFC",
        bgColor: "#0E141F",
        bgOpacity: 0.72,
        borderOpacity: 0.2,
        fontScale: 1,
        entityId: "server.cpu_temp_c"
      },
      {
        id: "w-nc-power",
        type: "entity_number",
        x: 624,
        y: 130,
        w: 312,
        h: 98,
        title: "Power Draw",
        accentColor: "#10B981",
        textColor: "#F8FAFC",
        bgColor: "#0E141F",
        bgOpacity: 0.72,
        borderOpacity: 0.2,
        fontScale: 1,
        entityId: "server.power_watts"
      },
      {
        id: "w-nc-summary",
        type: "entity_list",
        x: 24,
        y: 240,
        w: 912,
        h: 116,
        title: "Quick Status",
        accentColor: "#F59E0B",
        textColor: "#CBD5E1",
        bgColor: "#0E141F",
        bgOpacity: 0.72,
        borderOpacity: 0.2,
        fontScale: 1,
        maxItems: 3,
        entityIds: ["server.cpu_percent", "server.ram_percent", "server.array_used_pct"]
      }
    ]
  },
  {
    id: "scr-nvme-thermals",
    name: "NVMe & Drive Thermals",
    enabled: true,
    durationSec: 15,
    transition: "fade",
    backgroundType: "image",
    backgroundColor: "#0B0E14",
    backgroundImage: PRESET_BACKGROUNDS[5].url,
    backgroundDim: 0.48,
    themeId: "tech",
    widgets: [
      {
        id: "w-nt-bars",
        type: "apex_bar",
        x: 16,
        y: 16,
        w: 516,
        h: 184,
        title: "Drive Bay Temperatures (C)",
        accentColor: "#38BDF8",
        textColor: "#F8FAFC",
        bgColor: "#0A101C",
        bgOpacity: 0.86,
        borderOpacity: 0.28,
        fontScale: 1,
        entityIds: ["disk.parity1.temp_c", "disk.disk1.temp_c", "disk.disk2.temp_c", "disk.nvme0.temp_c"]
      },
      {
        id: "w-nt-hbar",
        type: "apex_hbar",
        x: 544,
        y: 16,
        w: 400,
        h: 184,
        title: "Utilization %",
        accentColor: "#A78BFA",
        textColor: "#F8FAFC",
        bgColor: "#0A101C",
        bgOpacity: 0.86,
        borderOpacity: 0.28,
        fontScale: 1,
        entityIds: ["server.array_used_pct", "server.cpu_percent", "server.ram_percent"]
      },
      {
        id: "w-nt-area",
        type: "apex_area",
        x: 16,
        y: 212,
        w: 612,
        h: 148,
        title: "CPU Thermal Trend (C)",
        accentColor: "#F59E0B",
        textColor: "#F8FAFC",
        bgColor: "#0A101C",
        bgOpacity: 0.86,
        borderOpacity: 0.28,
        fontScale: 1,
        entityIds: ["server.cpu_temp"],
        chartVariant: "area",
        chartSmooth: true
      },
      {
        id: "w-nt-radial",
        type: "apex_radial",
        x: 640,
        y: 212,
        w: 304,
        h: 148,
        title: "Array Space %",
        accentColor: "#38BDF8",
        textColor: "#F8FAFC",
        bgColor: "#0A101C",
        bgOpacity: 0.86,
        borderOpacity: 0.28,
        fontScale: 1,
        entityId: "server.array_used_pct"
      }
    ]
  },
  {
    id: "scr-docker-net",
    name: "Docker & Network Ops",
    enabled: true,
    durationSec: 15,
    transition: "slide",
    backgroundType: "image",
    backgroundColor: "#0B0E14",
    backgroundImage: PRESET_BACKGROUNDS[1].url,
    backgroundDim: 0.45,
    widgets: [
      {
        id: "w-dn-dockers",
        type: "docker_list",
        x: 16,
        y: 16,
        w: 460,
        h: 344,
        title: "Running Containers",
        accentColor: "#38BDF8",
        textColor: "#F8FAFC",
        bgColor: "#0D131D",
        bgOpacity: 0.85,
        borderOpacity: 0.28,
        fontScale: 1,
        maxItems: 6
      },
      {
        id: "w-dn-net",
        type: "apex_area",
        x: 488,
        y: 16,
        w: 456,
        h: 188,
        title: "Network RX / TX (Mbps)",
        accentColor: "#10B981",
        textColor: "#F8FAFC",
        bgColor: "#0D131D",
        bgOpacity: 0.85,
        borderOpacity: 0.28,
        fontScale: 1,
        entityIds: ["server.net_rx_mbps", "server.net_tx_mbps"],
        chartVariant: "line",
        chartSmooth: true
      },
      {
        id: "w-dn-users",
        type: "active_users",
        x: 488,
        y: 216,
        w: 222,
        h: 144,
        title: "Active Users",
        accentColor: "#10B981",
        textColor: "#F8FAFC",
        bgColor: "#0D131D",
        bgOpacity: 0.85,
        borderOpacity: 0.28,
        fontScale: 1,
        maxItems: 2
      },
      {
        id: "w-dn-tasks",
        type: "active_tasks",
        x: 722,
        y: 216,
        w: 222,
        h: 144,
        title: "Tasks & Backups",
        accentColor: "#F59E0B",
        textColor: "#F8FAFC",
        bgColor: "#0D131D",
        bgOpacity: 0.85,
        borderOpacity: 0.28,
        fontScale: 1,
        maxItems: 2
      }
    ]
  },
  {
    id: "scr-hawaiian-ops",
    name: "Hawaiian Sunset Telemetry",
    enabled: true,
    durationSec: 15,
    transition: "fade",
    backgroundType: "image",
    backgroundColor: "#1B1018",
    backgroundImage: PRESET_BACKGROUNDS[3].url,
    backgroundDim: 0.35,
    themeId: "hawaiian",
    widgets: [
      {
        id: "w-hw-clock",
        type: "clock",
        x: 20,
        y: 20,
        w: 340,
        h: 136,
        title: "Island Time",
        accentColor: "#FB7185",
        textColor: "#FFF7ED",
        bgColor: "#2A1424",
        bgOpacity: 0.72,
        borderOpacity: 0.3,
        fontScale: 1.05,
        fontFamily: "display"
      },
      {
        id: "w-hw-cpu",
        type: "entity_number",
        x: 372,
        y: 20,
        w: 200,
        h: 136,
        title: "CPU Load",
        accentColor: "#FB7185",
        textColor: "#FFF7ED",
        bgColor: "#2A1424",
        bgOpacity: 0.72,
        borderOpacity: 0.3,
        fontScale: 1,
        fontFamily: "display",
        entityId: "server.cpu_percent"
      },
      {
        id: "w-hw-ram",
        type: "entity_number",
        x: 584,
        y: 20,
        w: 180,
        h: 136,
        title: "RAM Usage",
        accentColor: "#F59E0B",
        textColor: "#FFF7ED",
        bgColor: "#2A1424",
        bgOpacity: 0.72,
        borderOpacity: 0.3,
        fontScale: 1,
        fontFamily: "display",
        entityId: "server.ram_percent"
      },
      {
        id: "w-hw-array",
        type: "apex_radial",
        x: 776,
        y: 20,
        w: 164,
        h: 136,
        title: "Array %",
        accentColor: "#FB7185",
        textColor: "#FFF7ED",
        bgColor: "#2A1424",
        bgOpacity: 0.72,
        borderOpacity: 0.3,
        fontScale: 1,
        fontFamily: "display",
        entityId: "server.array_used_pct"
      },
      {
        id: "w-hw-chart",
        type: "apex_area",
        x: 20,
        y: 168,
        w: 920,
        h: 188,
        title: "Live System Load & Temp",
        accentColor: "#FB7185",
        textColor: "#FFF7ED",
        bgColor: "#2A1424",
        bgOpacity: 0.72,
        borderOpacity: 0.3,
        fontScale: 1,
        fontFamily: "display",
        entityIds: ["server.cpu_percent", "server.cpu_temp"],
        chartVariant: "area",
        chartSmooth: true
      }
    ]
  }
];
var INITIAL_SCREENS = PREMADE_SCREENS.slice(0, 3);
var DEFAULT_CONFIG = {
  screens: INITIAL_SCREENS,
  savedScreens: INITIAL_SCREENS.map((scr) => ({
    id: `saved-${scr.id}`,
    name: scr.name,
    savedAt: "2026-11-22T00:00:00.000Z",
    screen: structuredClone(scr)
  })),
  activeScreenId: INITIAL_SCREENS[0].id,
  rotationEnabled: true,
  hardware: {
    devicePath: "/dev/ttyACM0",
    baudRate: 15e5,
    brightness: 85,
    rotation: 0,
    autoPushEnabled: false,
    pushIntervalSec: 2,
    pollIntervalMs: 2500,
    sleepScheduleEnabled: false,
    sleepStart: "23:30",
    sleepEnd: "07:00",
    sleepMode: "off",
    sleepDimPercent: 5,
    bootDisplayOff: false,
    powerOffOnEmergencyStop: false,
    serialWritesEnabled: false
  },
  hardwareDeploy: {
    deployed: false,
    deployedAt: null,
    activeIndex: 0,
    currentScreenId: INITIAL_SCREENS[0].id,
    currentScreenName: INITIAL_SCREENS[0].name,
    isSleeping: false,
    effectiveBrightness: 85,
    daemonState: "idle",
    lastError: null,
    screens: INITIAL_SCREENS
  },
  integrations: {
    sourceMode: "auto",
    agentEnabled: false,
    agentUrl: "http://192.168.1.50:8043",
    agentToken: "",
    agentTokenSet: false,
    haEnabled: false,
    haUrl: "http://192.168.1.10:8123",
    haToken: "",
    haTokenSet: false,
    customConnections: []
  },
  entityOverrides: {},
  dockerIcons: {},
  customImages: []
};

// src/server/aoostar/asterctl.ts
import { execFileSync as execFileSync2, spawn } from "node:child_process";
import fs2 from "node:fs";
import path2 from "node:path";

// src/server/aoostar/protocol.ts
import crypto from "node:crypto";
import zlib from "node:zlib";
var DISPLAY_WIDTH = 960;
var DISPLAY_HEIGHT = 376;
var USB_UART_VID_HEX = "0416";
var USB_UART_PID_HEX = "90a1";
var UART_BAUDRATE = 15e5;
var IMG_CHUNK_SIZE = 47;
var SERIAL_RETRY = 3;
var INIT_ACK_WAIT_MS = 1e3;
var INIT_ACK_BYTE = 65;
var EXPECTED_PIXEL_COUNT = DISPLAY_WIDTH * DISPLAY_HEIGHT;
var EXPECTED_RGB565_BYTES = EXPECTED_PIXEL_COUNT * 2;
var EXPECTED_TOTAL_CHUNKS = EXPECTED_RGB565_BYTES / IMG_CHUNK_SIZE;
var DATA_CHUNK_PACKET_SIZE = 8 + 4 + IMG_CHUNK_SIZE;
var CRC_ALGORITHM = "none";
var DISPLAY_OFF = Buffer.from([170, 85, 170, 85, 10, 0, 0, 0]);
var DISPLAY_ON = Buffer.from([170, 85, 170, 85, 11, 0, 0, 0]);
var HEADER_START = Buffer.from([
  170,
  85,
  170,
  85,
  5,
  0,
  0,
  0,
  4,
  0,
  15,
  47,
  0,
  4,
  11,
  0
]);
var HEADER_END = Buffer.from([170, 85, 170, 85, 6, 0, 0, 0]);
var CHUNK_HEADER = Buffer.from([170, 85, 170, 85, 8, 0, 0, 0]);
function formatHexPreview(buf, maxBytes = 32) {
  const slice = buf.subarray(0, Math.min(buf.length, maxBytes));
  const hex = Array.from(slice).map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ");
  return buf.length > maxBytes ? `${hex} ... (+${buf.length - maxBytes}B)` : hex;
}
function rgb888ToRgb565(r, g, b) {
  return ((r & 248) << 8 | (g & 252) << 3 | (b & 255) >> 3) & 65535;
}
function rgbaToRgb565Le(rgbaBuffer, width = DISPLAY_WIDTH, height = DISPLAY_HEIGHT) {
  const pixelCount = width * height;
  if (rgbaBuffer.length < pixelCount * 4) {
    throw new Error(
      `Invalid RGBA buffer length: expected at least ${pixelCount * 4} bytes for ${width}x${height}, got ${rgbaBuffer.length}`
    );
  }
  const out = Buffer.allocUnsafe(pixelCount * 2);
  for (let i = 0; i < pixelCount; i++) {
    const srcIdx = i * 4;
    const val = rgb888ToRgb565(rgbaBuffer[srcIdx], rgbaBuffer[srcIdx + 1], rgbaBuffer[srcIdx + 2]);
    out.writeUInt16LE(val, i * 2);
  }
  return out;
}
function applyBrightnessScaleRgba(rgbaBuffer, brightnessPercent, width = DISPLAY_WIDTH, height = DISPLAY_HEIGHT) {
  const expected = width * height * 4;
  if (rgbaBuffer.length < expected) {
    throw new Error(
      `Invalid RGBA buffer length: expected at least ${expected} bytes, got ${rgbaBuffer.length}`
    );
  }
  const pct = Number.isFinite(brightnessPercent) ? Math.max(0, Math.min(100, brightnessPercent)) : 100;
  if (pct >= 100) {
    return Buffer.from(rgbaBuffer.subarray(0, expected));
  }
  const scale = pct / 100;
  const out = Buffer.allocUnsafe(expected);
  for (let i = 0; i < expected; i += 4) {
    out[i] = Math.round(rgbaBuffer[i] * scale);
    out[i + 1] = Math.round(rgbaBuffer[i + 1] * scale);
    out[i + 2] = Math.round(rgbaBuffer[i + 2] * scale);
    out[i + 3] = rgbaBuffer[i + 3];
  }
  return out;
}
function buildDataChunkPacket(byteOffset, chunkPayload) {
  if (!Number.isInteger(byteOffset) || byteOffset < 0) {
    throw new Error(`Invalid chunk byte offset: ${byteOffset}`);
  }
  if (chunkPayload.length === 0 || chunkPayload.length > IMG_CHUNK_SIZE) {
    throw new Error(
      `Invalid chunk payload length: expected 1..${IMG_CHUNK_SIZE}, got ${chunkPayload.length}`
    );
  }
  const packet = Buffer.allocUnsafe(8 + 4 + chunkPayload.length);
  CHUNK_HEADER.copy(packet, 0);
  packet.writeUInt32LE(byteOffset >>> 0, 8);
  Buffer.from(chunkPayload.buffer, chunkPayload.byteOffset, chunkPayload.byteLength).copy(packet, 12);
  return packet;
}
function buildFramePacketSequence(rgb565Le) {
  if (rgb565Le.length !== EXPECTED_RGB565_BYTES) {
    throw new Error(
      `Invalid RGB565 frame length: expected ${EXPECTED_RGB565_BYTES} bytes (${DISPLAY_WIDTH}x${DISPLAY_HEIGHT}x2), got ${rgb565Le.length}`
    );
  }
  const chunks = [];
  let totalBytesOnWire = HEADER_START.length + HEADER_END.length;
  for (let offset = 0; offset < rgb565Le.length; offset += IMG_CHUNK_SIZE) {
    const slice = rgb565Le.subarray(offset, Math.min(rgb565Le.length, offset + IMG_CHUNK_SIZE));
    const packet = buildDataChunkPacket(offset, slice);
    chunks.push(packet);
    totalBytesOnWire += packet.length;
  }
  const frameSha256Short = crypto.createHash("sha256").update(rgb565Le).digest("hex").slice(0, 12).toUpperCase();
  return {
    headerStart: Buffer.from(HEADER_START),
    chunks,
    headerEnd: Buffer.from(HEADER_END),
    totalBytesOnWire,
    frameSha256Short
  };
}
function computeDiffChunkIndices(prevRgb565, nextRgb565, forceFull = false) {
  if (nextRgb565.length !== EXPECTED_RGB565_BYTES) {
    throw new Error(
      `Invalid RGB565 frame length: expected ${EXPECTED_RGB565_BYTES} bytes (${DISPLAY_WIDTH}x${DISPLAY_HEIGHT}x2), got ${nextRgb565.length}`
    );
  }
  const hasValidPrev = Boolean(prevRgb565 && prevRgb565.length === EXPECTED_RGB565_BYTES);
  const fullSync = forceFull || !hasValidPrev;
  const changedIndices = [];
  if (fullSync) {
    for (let idx = 0; idx < EXPECTED_TOTAL_CHUNKS; idx++) {
      changedIndices.push(idx);
    }
  } else if (prevRgb565) {
    for (let idx = 0; idx < EXPECTED_TOTAL_CHUNKS; idx++) {
      const offset = idx * IMG_CHUNK_SIZE;
      for (let j = 0; j < IMG_CHUNK_SIZE; j++) {
        if (prevRgb565[offset + j] !== nextRgb565[offset + j]) {
          changedIndices.push(idx);
          break;
        }
      }
    }
  }
  const frameSha256Short = crypto.createHash("sha256").update(nextRgb565).digest("hex").slice(0, 12).toUpperCase();
  return { changedIndices, fullSync, frameSha256Short };
}
function parseInitAckResponse(responseBuf) {
  const bytesRead = responseBuf.length;
  if (bytesRead === 0) {
    return {
      ok: false,
      bytesRead: 0,
      containsAckByte: false,
      hexPreview: "",
      errorMessage: 'Initialization failed, no response received (expected ASCII "A" / 0x41)'
    };
  }
  let containsAckByte = false;
  for (let i = 0; i < responseBuf.length; i++) {
    if (responseBuf[i] === INIT_ACK_BYTE) {
      containsAckByte = true;
      break;
    }
  }
  const hexPreview = formatHexPreview(responseBuf, 32);
  if (!containsAckByte) {
    const textPreview = Buffer.from(responseBuf).toString("utf8").replace(/[^\x20-\x7E]/g, "?");
    return {
      ok: false,
      bytesRead,
      containsAckByte: false,
      hexPreview,
      errorMessage: `Initialization failed, received unexpected bytes [${hexPreview}] ("${textPreview}")`
    };
  }
  return {
    ok: true,
    bytesRead,
    containsAckByte: true,
    hexPreview,
    errorMessage: null
  };
}
var PNG_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 3988292384 ^ c >>> 1 : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();
function pngCrc32(buf) {
  let c = 4294967295;
  for (let i = 0; i < buf.length; i++) {
    c = PNG_CRC_TABLE[(c ^ buf[i]) & 255] ^ c >>> 8;
  }
  return (c ^ 4294967295) >>> 0;
}
function makePngChunk(type, data) {
  const len = Buffer.allocUnsafe(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.allocUnsafe(4);
  crcBuf.writeUInt32BE(pngCrc32(crcInput), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}
function encodePngRgba(rgba, width = DISPLAY_WIDTH, height = DISPLAY_HEIGHT) {
  const expected = width * height * 4;
  if (rgba.length < expected) {
    throw new Error(`PNG encode expected at least ${expected} RGBA bytes, got ${rgba.length}`);
  }
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const stride = width * 4;
  const rawScanlines = Buffer.allocUnsafe(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const dstStart = y * (stride + 1);
    rawScanlines[dstStart] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(rawScanlines, dstStart + 1);
  }
  const compressed = zlib.deflateSync(rawScanlines, { level: 3 });
  return Buffer.concat([
    signature,
    makePngChunk("IHDR", ihdr),
    makePngChunk("IDAT", compressed),
    makePngChunk("IEND", Buffer.alloc(0))
  ]);
}

// src/server/aoostar/serial.ts
import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
var execFileAsync = promisify(execFile);
var MAX_LOG_ENTRIES = 160;
var ASYNC_WRITE_BATCH_BYTES = 8192;
var FULL_SYNC_EVERY_N_FRAMES = 60;
var logSeq = 1;
var serialLogs = [];
var dryRunLog = [];
var emergencyStopped = false;
var configSerialWritesEnabled = false;
var lastProtocolError = null;
var lastPacketPreview = null;
var lastDryRunSummary = null;
var activeTransport = null;
var activeAsyncTransport = null;
var lastSentRgb565 = null;
var lastBrightnessKey = null;
var framesSinceFullSync = 0;
var serialLockChain = Promise.resolve();
async function withSerialLock(fn) {
  const previous = serialLockChain;
  let release;
  serialLockChain = new Promise((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}
var sleepArray = new Int32Array(new SharedArrayBuffer(4));
function sleepAsyncMs(ms) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function isSerialWritesEnvLocked() {
  return process.env.AOOSTAR_LOCK_SERIAL_WRITES === "true";
}
function isSerialWritesEnvEnabled() {
  return process.env.AOOSTAR_ENABLE_SERIAL_WRITES === "true";
}
function setConfigSerialWritesEnabled(enabled) {
  configSerialWritesEnabled = Boolean(enabled);
}
function isSerialWritesActive() {
  if (isSerialWritesEnvEnabled()) return true;
  if (!isSerialWritesEnvLocked() && configSerialWritesEnabled) return true;
  return false;
}
function isEmergencyStopped() {
  return emergencyStopped;
}
function canPerformRealSerialWrite() {
  if (emergencyStopped) {
    return {
      allowed: false,
      reason: "Emergency stop is active. Clear the emergency stop latch on Diagnostics before writing to hardware."
    };
  }
  if (!isSerialWritesActive()) {
    return {
      allowed: false,
      reason: isSerialWritesEnvLocked() ? "Serial writes are locked off by AOOSTAR_LOCK_SERIAL_WRITES=true." : "Serial writes are disabled by safety policy (AOOSTAR_ENABLE_SERIAL_WRITES=false). Enable via env or unlock in Settings after Dry Run validation."
    };
  }
  return { allowed: true, reason: null };
}
function recordSerialLog(direction, label, dataOrCount, error) {
  const byteCount = typeof dataOrCount === "number" ? dataOrCount : dataOrCount.length;
  const hexPreview = typeof dataOrCount === "number" ? "" : formatHexPreview(dataOrCount, 32);
  const entry = {
    id: logSeq++,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    direction,
    label,
    byteCount,
    hexPreview,
    error
  };
  if (direction === "TX" || direction === "DRY_RUN") {
    lastPacketPreview = hexPreview ? `${label}: ${hexPreview}` : label;
  }
  if (error) {
    lastProtocolError = error;
  }
  if (direction === "DRY_RUN") {
    dryRunLog.unshift(entry);
    if (dryRunLog.length > MAX_LOG_ENTRIES) dryRunLog.length = MAX_LOG_ENTRIES;
  } else {
    serialLogs.unshift(entry);
    if (serialLogs.length > MAX_LOG_ENTRIES) serialLogs.length = MAX_LOG_ENTRIES;
  }
}
function getSerialDiagnosticsState() {
  return {
    serialWritesEnabled: isSerialWritesActive(),
    serialWritesEnvEnabled: isSerialWritesEnvEnabled(),
    serialWritesConfigEnabled: configSerialWritesEnabled,
    serialWritesEnvLocked: isSerialWritesEnvLocked(),
    emergencyStopped,
    lastProtocolError,
    lastPacketPreview,
    lastDryRunSummary,
    serialLogs: [...serialLogs],
    dryRunLog: [...dryRunLog]
  };
}
function setLastProtocolError(msg) {
  lastProtocolError = msg;
}
function resetFrameDiffCache() {
  lastSentRgb565 = null;
  lastBrightnessKey = null;
  framesSinceFullSync = 0;
}
function closeActiveSerialTransport() {
  if (activeTransport) {
    try {
      activeTransport.transport.close();
    } catch {
    }
    activeTransport = null;
  }
  if (activeAsyncTransport) {
    const t = activeAsyncTransport.transport;
    activeAsyncTransport = null;
    void t.close().catch(() => {
    });
  }
  resetFrameDiffCache();
}
async function closeActiveSerialTransportAsync() {
  if (activeTransport) {
    try {
      activeTransport.transport.close();
    } catch {
    }
    activeTransport = null;
  }
  if (activeAsyncTransport) {
    const t = activeAsyncTransport.transport;
    activeAsyncTransport = null;
    try {
      await t.close();
    } catch {
    }
  }
  resetFrameDiffCache();
}
function activateEmergencyStop(reason = "Emergency stop triggered by operator") {
  emergencyStopped = true;
  closeActiveSerialTransport();
  recordSerialLog("ERROR", "EMERGENCY_STOP", 0, reason);
  console.warn(`[aoostar-serial] ${reason}`);
}
function clearEmergencyStop() {
  emergencyStopped = false;
  lastProtocolError = null;
  resetFrameDiffCache();
  recordSerialLog("INFO", "EMERGENCY_STOP_CLEARED", 0);
}
function normalizeUsbId(raw) {
  const cleaned = raw.trim().toLowerCase().replace(/^0x/, "");
  return cleaned ? cleaned.padStart(4, "0") : "unknown";
}
function decodeLinuxDevNumber(rdev) {
  if (!Number.isFinite(rdev) || rdev <= 0) return null;
  const d = BigInt(Math.trunc(rdev));
  const major = Number(d >> 8n & 0xfffn | d >> 32n & ~0xfffn);
  const minor = Number(d & 0xffn | d >> 12n & ~0xffn);
  if (major <= 0 && minor <= 0) return null;
  return { major, minor };
}
function parseUsbUeventProduct(ueventText, dirName) {
  const isUsbNode = /^DEVTYPE=usb_(device|interface)$/m.test(ueventText) || /^SUBSYSTEM=usb$/m.test(ueventText) || /^INTERFACE=/m.test(ueventText) || /^\d+-[\d.]+(?::[\d.]+)?$/.test(dirName);
  if (!isUsbNode) return null;
  const prodMatch = /^PRODUCT=([0-9a-fA-F]+)\/([0-9a-fA-F]+)(?:\/|$)/m.exec(ueventText);
  if (!prodMatch) return null;
  const vendorId = normalizeUsbId(prodMatch[1]);
  const productId = normalizeUsbId(prodMatch[2]);
  if (vendorId === "unknown" || productId === "unknown") return null;
  return { vendorId, productId };
}
function readUsbAttrsUpTree(startDir, sysRoot, defaultName) {
  const devicesRoot = path.resolve(sysRoot, "devices");
  const resolvedSysRoot = path.resolve(sysRoot);
  let cur;
  try {
    cur = fs.realpathSync(startDir);
  } catch {
    return null;
  }
  let fallbackIds = null;
  let detectedName = defaultName;
  for (let depth = 0; depth < 14; depth++) {
    try {
      const productPath = path.join(cur, "product");
      if (fs.existsSync(productPath)) {
        const prod = fs.readFileSync(productPath, "utf8").trim();
        if (prod) detectedName = prod;
      }
      const idVendorPath = path.join(cur, "idVendor");
      const idProductPath = path.join(cur, "idProduct");
      if (fs.existsSync(idVendorPath) && fs.existsSync(idProductPath)) {
        const vendorId = normalizeUsbId(fs.readFileSync(idVendorPath, "utf8"));
        const productId = normalizeUsbId(fs.readFileSync(idProductPath, "utf8"));
        if (vendorId !== "unknown" && productId !== "unknown") {
          return { vendorId, productId, name: detectedName, source: cur };
        }
      }
      if (!fallbackIds) {
        const ueventPath = path.join(cur, "uevent");
        if (fs.existsSync(ueventPath)) {
          const parsed = parseUsbUeventProduct(
            fs.readFileSync(ueventPath, "utf8"),
            path.basename(cur)
          );
          if (parsed) {
            fallbackIds = parsed;
          }
        }
      }
    } catch {
    }
    if (cur === devicesRoot || cur === resolvedSysRoot) break;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  if (fallbackIds) {
    return {
      vendorId: fallbackIds.vendorId,
      productId: fallbackIds.productId,
      name: detectedName,
      source: "uevent"
    };
  }
  return null;
}
function readUsbAttrsForTty(devPath, options) {
  const sysRoot = options?.sysRoot ?? "/sys";
  const requestedName = path.basename(devPath);
  let realPath = options?.devRealPath ?? devPath;
  if (!options?.devRealPath) {
    try {
      realPath = fs.realpathSync(devPath);
    } catch {
      realPath = devPath;
    }
  }
  const realName = path.basename(realPath);
  const ttyNames = /* @__PURE__ */ new Set([realName, requestedName]);
  const startDirs = [];
  const addStartDir = (candidate) => {
    try {
      const resolved = fs.realpathSync(candidate);
      if (!startDirs.includes(resolved)) {
        startDirs.push(resolved);
      }
      return resolved;
    } catch {
      return null;
    }
  };
  let rdev = options?.rdev;
  if (rdev === void 0) {
    try {
      rdev = fs.statSync(devPath).rdev;
    } catch {
      rdev = void 0;
    }
  }
  if (rdev !== void 0) {
    const devNum = decodeLinuxDevNumber(rdev);
    if (devNum) {
      const charBase = path.join(sysRoot, "dev", "char", `${devNum.major}:${devNum.minor}`);
      addStartDir(path.join(charBase, "device"));
      const resolvedChar = addStartDir(charBase);
      if (resolvedChar) {
        ttyNames.add(path.basename(resolvedChar));
      }
    }
  }
  for (const name of ttyNames) {
    const ttyBase = path.join(sysRoot, "class", "tty", name);
    addStartDir(path.join(ttyBase, "device"));
    addStartDir(ttyBase);
  }
  for (const startDir of startDirs) {
    const attrs = readUsbAttrsUpTree(startDir, sysRoot, realName);
    if (attrs) return attrs;
  }
  const usbDevicesRoot = path.join(sysRoot, "bus", "usb", "devices");
  try {
    const entries = fs.readdirSync(usbDevicesRoot);
    for (const entry of entries) {
      const entryDir = path.join(usbDevicesRoot, entry);
      for (const name of ttyNames) {
        if (fs.existsSync(path.join(entryDir, "tty", name)) || fs.existsSync(path.join(entryDir, name))) {
          const attrs = readUsbAttrsUpTree(entryDir, sysRoot, realName);
          if (attrs) return attrs;
        }
      }
    }
  } catch {
  }
  return { vendorId: "unknown", productId: "unknown", name: realName };
}
function isAllowedTestPtyPath(candidatePath) {
  const ptyOverride = (process.env.AOOSTAR_TEST_PTY_PATH || "").trim();
  if (!ptyOverride) return false;
  try {
    const reqReal = fs.realpathSync(candidatePath);
    const ptyReal = fs.realpathSync(ptyOverride);
    return reqReal === ptyReal && /^\/dev\/pts\/\d+$/.test(reqReal);
  } catch {
    return false;
  }
}
function isAllowedSerialDevicePath(candidatePath) {
  if (!candidatePath.startsWith("/dev/")) return false;
  if (isAllowedTestPtyPath(candidatePath)) return true;
  if (candidatePath === "/dev/aoostar_lcd") return true;
  if (/^\/dev\/tty(ACM|USB)\d+$/.test(candidatePath)) return true;
  if (candidatePath.startsWith("/dev/serial/by-id/")) {
    try {
      const resolved = fs.realpathSync(candidatePath);
      return /^\/dev\/tty(ACM|USB)\d+$/.test(resolved);
    } catch {
      return false;
    }
  }
  return false;
}
function scanUsbSerialDevices() {
  const devices = [];
  const seenRealPaths = /* @__PURE__ */ new Set();
  const candidates = [];
  if (fs.existsSync("/dev/aoostar_lcd")) {
    candidates.push("/dev/aoostar_lcd");
  }
  try {
    const devFiles = fs.readdirSync("/dev").filter((f) => f.startsWith("ttyACM") || f.startsWith("ttyUSB")).sort();
    for (const f of devFiles) {
      candidates.push(`/dev/${f}`);
    }
  } catch {
  }
  for (const fullPath of candidates) {
    let realPath = fullPath;
    try {
      realPath = fs.realpathSync(fullPath);
    } catch {
    }
    if (seenRealPaths.has(realPath) && fullPath !== "/dev/aoostar_lcd") continue;
    seenRealPaths.add(realPath);
    const attrs = readUsbAttrsForTty(fullPath);
    let writable = false;
    try {
      fs.accessSync(fullPath, fs.constants.R_OK | fs.constants.W_OK);
      writable = true;
    } catch {
      writable = false;
    }
    devices.push({
      path: fullPath,
      name: attrs.name,
      vendorId: attrs.vendorId === "unknown" ? "unknown" : `0x${attrs.vendorId}`,
      productId: attrs.productId === "unknown" ? "unknown" : `0x${attrs.productId}`,
      isAoostarMatch: attrs.vendorId === USB_UART_VID_HEX && attrs.productId === USB_UART_PID_HEX,
      writable
    });
  }
  return devices;
}
function resolveStrictAoostarDevice(requestedPath, options) {
  const trimmed = (requestedPath || "").trim();
  const forceAllowed = Boolean(options?.forceUnverifiedDevice && options?.confirmUnverifiedDevice);
  if (trimmed) {
    if (!isAllowedSerialDevicePath(trimmed)) {
      return {
        devicePath: null,
        match: null,
        error: `Rejected serial device path "${trimmed}": only /dev/ttyACM*, /dev/ttyUSB*, /dev/aoostar_lcd, or /dev/serial/by-id/* are allowed.`
      };
    }
    if (isAllowedTestPtyPath(trimmed)) {
      let writable2 = false;
      try {
        fs.accessSync(trimmed, fs.constants.R_OK | fs.constants.W_OK);
        writable2 = true;
      } catch {
        writable2 = false;
      }
      return {
        devicePath: trimmed,
        match: {
          path: trimmed,
          name: "PTY Hardware Emulator",
          vendorId: `0x${USB_UART_VID_HEX}`,
          productId: `0x${USB_UART_PID_HEX}`,
          isAoostarMatch: true,
          writable: writable2
        },
        error: null
      };
    }
    if (!fs.existsSync(trimmed)) {
      return {
        devicePath: null,
        match: null,
        error: `Serial device ${trimmed} does not exist`
      };
    }
    const attrs = readUsbAttrsForTty(trimmed, options?.sysRoot ? { sysRoot: options.sysRoot } : void 0);
    const isMatch = attrs.vendorId === USB_UART_VID_HEX && attrs.productId === USB_UART_PID_HEX;
    if (!isMatch && !forceAllowed) {
      const gotId = attrs.vendorId === "unknown" || attrs.productId === "unknown" ? "unknown USB VID/PID" : `0x${attrs.vendorId}:0x${attrs.productId}`;
      const sysRootCheck = options?.sysRoot ?? "/sys";
      const sysfsHint = gotId === "unknown USB VID/PID" && !fs.existsSync(path.join(sysRootCheck, "class", "tty")) && !fs.existsSync(path.join(sysRootCheck, "dev", "char")) ? " (sysfs tty/dev metadata unavailable in container; ensure /sys is accessible)" : "";
      return {
        devicePath: null,
        match: null,
        error: `Device ${trimmed} failed strict VID/PID validation (${gotId}; expected 0x${USB_UART_VID_HEX}:0x${USB_UART_PID_HEX})${sysfsHint}.`
      };
    }
    let writable = false;
    try {
      fs.accessSync(trimmed, fs.constants.R_OK | fs.constants.W_OK);
      writable = true;
    } catch {
      writable = false;
    }
    return {
      devicePath: trimmed,
      match: {
        path: trimmed,
        name: attrs.name,
        vendorId: attrs.vendorId === "unknown" ? "unknown" : `0x${attrs.vendorId}`,
        productId: attrs.productId === "unknown" ? "unknown" : `0x${attrs.productId}`,
        isAoostarMatch: isMatch,
        writable
      },
      error: null
    };
  }
  const ptyOverride = (process.env.AOOSTAR_TEST_PTY_PATH || "").trim();
  if (ptyOverride && isAllowedTestPtyPath(ptyOverride)) {
    return resolveStrictAoostarDevice(ptyOverride);
  }
  const devices = scanUsbSerialDevices();
  const exact = devices.find((d) => d.isAoostarMatch);
  if (exact) {
    return { devicePath: exact.path, match: exact, error: null };
  }
  return {
    devicePath: null,
    match: null,
    error: `Aoostar USB serial device (VID 0x${USB_UART_VID_HEX}, PID 0x${USB_UART_PID_HEX}) not found`
  };
}
function inspectSerialPermissions(preferredPath) {
  const devices = scanUsbSerialDevices();
  const exact = devices.find((d) => d.isAoostarMatch);
  const candidatePath = exact?.path || (preferredPath && fs.existsSync(preferredPath) ? preferredPath : null) || (fs.existsSync("/dev/ttyACM0") ? "/dev/ttyACM0" : null);
  if (!candidatePath || !fs.existsSync(candidatePath)) {
    return {
      devicePath: preferredPath || "/dev/ttyACM0",
      exists: false,
      readable: false,
      writable: false,
      modeOctal: null,
      usbVidPid: null,
      isAoostarMatch: false,
      error: `Device ${preferredPath || "/dev/ttyACM0"} not present`
    };
  }
  let readable = false;
  let writable = false;
  let modeOctal = null;
  let permError = null;
  try {
    const stat = fs.statSync(candidatePath);
    modeOctal = `0${(stat.mode & 511).toString(8)}`;
  } catch (err) {
    permError = err instanceof Error ? err.message : String(err);
  }
  try {
    fs.accessSync(candidatePath, fs.constants.R_OK);
    readable = true;
  } catch (err) {
    permError = err instanceof Error ? err.message : String(err);
  }
  try {
    fs.accessSync(candidatePath, fs.constants.W_OK);
    writable = true;
  } catch (err) {
    permError = err instanceof Error ? err.message : String(err);
  }
  const attrs = readUsbAttrsForTty(candidatePath);
  const vidPid = attrs.vendorId !== "unknown" && attrs.productId !== "unknown" ? `0x${attrs.vendorId}:0x${attrs.productId}` : null;
  const isAoostarMatch = attrs.vendorId === USB_UART_VID_HEX && attrs.productId === USB_UART_PID_HEX || isAllowedTestPtyPath(candidatePath);
  return {
    devicePath: candidatePath,
    exists: true,
    readable,
    writable,
    modeOctal,
    usbVidPid: vidPid,
    isAoostarMatch,
    error: !readable || !writable ? permError || "Missing R/W permissions on serial device" : null
  };
}
function buildSttyArgs(devicePath) {
  return [
    "-F",
    devicePath,
    String(UART_BAUDRATE),
    "cs8",
    "-cstopb",
    "-parenb",
    "clocal",
    "cread",
    "-crtscts",
    "-hupcl",
    "raw",
    "-echo",
    "-echoe",
    "-echok",
    "-onlcr",
    "-icrnl",
    "-ixon",
    "-ixoff",
    "-opost"
  ];
}
function assertSerialDeviceRwAccess(realPath) {
  try {
    fs.accessSync(realPath, fs.constants.R_OK | fs.constants.W_OK);
  } catch (err) {
    let detail = "";
    try {
      const st = fs.statSync(realPath);
      const modeOctal = `0${(st.mode & 511).toString(8)}`;
      const procUid = typeof process.getuid === "function" ? process.getuid() : "?";
      const procGid = typeof process.getgid === "function" ? process.getgid() : "?";
      const procGroups = typeof process.getgroups === "function" ? process.getgroups().join(",") : "";
      detail = ` (device owner=${st.uid}:${st.gid} mode=${modeOctal}; process uid=${procUid} gid=${procGid} groups=[${procGroups}])`;
    } catch {
    }
    const baseMsg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Permission denied accessing ${realPath}${detail}. Ensure the container runs via docker-entrypoint.sh or passes --group-add=<host_device_gid>. (${baseMsg})`
    );
  }
}
var LinuxAsyncSerialTransport = class _LinuxAsyncSerialTransport {
  constructor(devicePath, handle) {
    this.handle = null;
    this.pendingReadBuf = Buffer.alloc(0);
    this.datasyncUnsupported = false;
    this.devicePath = devicePath;
    this.handle = handle;
  }
  static async open(devicePath) {
    const realPath = await fsp.realpath(devicePath);
    assertSerialDeviceRwAccess(realPath);
    try {
      await execFileAsync("stty", buildSttyArgs(realPath), { timeout: 2e3 });
    } catch (err) {
      if (!isAllowedTestPtyPath(realPath)) {
        throw err;
      }
      await execFileAsync("stty", ["-F", realPath, "raw", "-echo", "cs8", "-parenb", "-cstopb"], {
        timeout: 2e3
      });
    }
    const flags = fs.constants.O_RDWR | fs.constants.O_NOCTTY | (fs.constants.O_NONBLOCK ?? 0);
    const handle = await fsp.open(realPath, flags);
    const transport = new _LinuxAsyncSerialTransport(realPath, handle);
    await transport.drainRx();
    return transport;
  }
  async writeAll(data) {
    if (!this.handle) throw new Error("Async serial port is closed");
    let offset = 0;
    const deadline = Date.now() + 8e3;
    while (offset < data.length) {
      const sliceLen = Math.min(ASYNC_WRITE_BATCH_BYTES, data.length - offset);
      try {
        const res = await this.handle.write(data, offset, sliceLen, null);
        if (res.bytesWritten > 0) {
          offset += res.bytesWritten;
        } else {
          if (Date.now() > deadline) {
            throw new Error(`Async serial write timed out after ${offset}/${data.length} bytes`);
          }
          await sleepAsyncMs(1);
        }
      } catch (err) {
        const code = err?.code;
        if (code === "EAGAIN" || code === "EWOULDBLOCK" || code === "EINTR") {
          if (Date.now() > deadline) {
            throw new Error(`Async serial write timed out (${code}) after ${offset}/${data.length} bytes`);
          }
          await sleepAsyncMs(1);
          continue;
        }
        throw err;
      }
    }
  }
  async flush() {
    if (!this.handle) throw new Error("Async serial port is closed");
    if (this.datasyncUnsupported) return;
    try {
      await this.handle.datasync();
    } catch (err) {
      const code = err?.code;
      if (code === "EINVAL" || code === "ENOTSUP") {
        this.datasyncUnsupported = true;
        return;
      }
      throw err;
    }
  }
  async pollIncoming() {
    if (!this.handle) return;
    const scratch = Buffer.alloc(512);
    while (true) {
      try {
        const { bytesRead } = await this.handle.read(scratch, 0, scratch.length, null);
        if (bytesRead <= 0) break;
        this.pendingReadBuf = Buffer.concat([this.pendingReadBuf, scratch.subarray(0, bytesRead)]);
      } catch (err) {
        const code = err?.code;
        if (code === "EAGAIN" || code === "EWOULDBLOCK") break;
        if (code === "EINTR") continue;
        throw err;
      }
    }
  }
  async drainRx() {
    await this.pollIncoming();
    if (this.pendingReadBuf.length > 0) {
      this.pendingReadBuf = Buffer.alloc(0);
    }
  }
  async bytesToRead() {
    await this.pollIncoming();
    return this.pendingReadBuf.length;
  }
  async read(maxBytes) {
    await this.pollIncoming();
    const n = Math.min(maxBytes, this.pendingReadBuf.length);
    const out = this.pendingReadBuf.subarray(0, n);
    this.pendingReadBuf = this.pendingReadBuf.subarray(n);
    return Buffer.from(out);
  }
  async sleepMs(ms) {
    await sleepAsyncMs(ms);
  }
  async close() {
    if (this.handle) {
      const h = this.handle;
      this.handle = null;
      await h.close().catch(() => {
      });
    }
  }
};
async function writePacketWithRetryAsync(transport, packet, label, logPacket = true) {
  let retry = 0;
  while (true) {
    try {
      await transport.writeAll(packet);
      await transport.flush();
      if (logPacket) {
        recordSerialLog("TX", label, packet);
      }
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (retry < SERIAL_RETRY) {
        retry += 1;
        recordSerialLog("INFO", `${label}_RETRY_${retry}`, packet.length, msg);
        await sleepAsyncMs(10);
        continue;
      }
      recordSerialLog("ERROR", `${label}_FAILED`, packet.length, msg);
      throw err;
    }
  }
}
async function sendDisplayOnHandshakeAsync(transport, options) {
  await transport.drainRx();
  await writePacketWithRetryAsync(transport, DISPLAY_ON, "DISPLAY_ON", true);
  if (options?.noInitCheck) {
    recordSerialLog("INFO", "DISPLAY_ON_NO_INIT_CHECK", 0);
    return { ackOk: true, ackBytesHex: "SKIPPED (no-init-check)" };
  }
  await transport.sleepMs(INIT_ACK_WAIT_MS);
  const available = await transport.bytesToRead();
  if (available === 0) {
    const errMsg = 'Initialization failed, no response received after 1000ms (expected "A" / 0x41)';
    recordSerialLog("ERROR", "INIT_ACK_TIMEOUT", 0, errMsg);
    throw new Error(errMsg);
  }
  const rxBuf = await transport.read(available);
  const ack = parseInitAckResponse(rxBuf);
  recordSerialLog("RX", "INIT_ACK", rxBuf, ack.errorMessage ?? void 0);
  if (!ack.ok) {
    throw new Error(ack.errorMessage || "Initialization failed, invalid ACK response");
  }
  return { ackOk: true, ackBytesHex: ack.hexPreview };
}
async function pushFrameViaAsyncTransport(params) {
  let ackBytesHex = null;
  if (params.initializeDisplay) {
    const init = await sendDisplayOnHandshakeAsync(params.transport);
    ackBytesHex = init.ackBytesHex;
  }
  const forceFull = Boolean(params.forceFullRefresh || params.initializeDisplay || !params.prevRgb565);
  const diff = computeDiffChunkIndices(params.prevRgb565, params.rgb565Le, forceFull);
  const changedCount = diff.changedIndices.length;
  if (changedCount === 0) {
    recordSerialLog("INFO", "FRAME_UNCHANGED_SKIPPED", 0);
    return {
      chunksSent: 0,
      totalChunks: EXPECTED_TOTAL_CHUNKS,
      totalBytesOnWire: 0,
      ackBytesHex,
      frameSha256Short: diff.frameSha256Short,
      unchangedSkipped: true,
      fullSync: false
    };
  }
  const totalBytesOnWire = HEADER_START.length + changedCount * DATA_CHUNK_PACKET_SIZE + HEADER_END.length;
  await writePacketWithRetryAsync(params.transport, Buffer.from(HEADER_START), "HEADER_START", true);
  const YIELD_EVERY_PACKETS = 128;
  for (let i = 0; i < changedCount; i++) {
    const chunkIdx = diff.changedIndices[i];
    const byteOffset = chunkIdx * IMG_CHUNK_SIZE;
    const pkt = buildDataChunkPacket(
      byteOffset,
      params.rgb565Le.subarray(byteOffset, byteOffset + IMG_CHUNK_SIZE)
    );
    const logChunk = i === 0 || i === changedCount - 1;
    const label = diff.fullSync ? `DATA_CHUNK[${chunkIdx}/${EXPECTED_TOTAL_CHUNKS}]` : `DIFF_CHUNK[${i + 1}/${changedCount} @${chunkIdx}/${EXPECTED_TOTAL_CHUNKS}]`;
    await writePacketWithRetryAsync(params.transport, pkt, label, logChunk);
    if (changedCount > YIELD_EVERY_PACKETS && (i & 127) === 127) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
  await writePacketWithRetryAsync(params.transport, Buffer.from(HEADER_END), "HEADER_END", true);
  await params.transport.drainRx();
  recordSerialLog(
    "INFO",
    diff.fullSync ? "FRAME_COMPLETE_FULL" : `FRAME_COMPLETE_DIFF (${changedCount}/${EXPECTED_TOTAL_CHUNKS})`,
    totalBytesOnWire
  );
  return {
    chunksSent: changedCount,
    totalChunks: EXPECTED_TOTAL_CHUNKS,
    totalBytesOnWire,
    ackBytesHex,
    frameSha256Short: diff.frameSha256Short,
    unchangedSkipped: false,
    fullSync: diff.fullSync
  };
}
function runDryRunFrame(params) {
  const width = params.width ?? DISPLAY_WIDTH;
  const height = params.height ?? DISPLAY_HEIGHT;
  const rgb565Le = rgbaToRgb565Le(params.rgbaBuffer, width, height);
  const seq = buildFramePacketSequence(rgb565Le);
  recordSerialLog("DRY_RUN", "DISPLAY_ON (simulated TX)", DISPLAY_ON);
  recordSerialLog("DRY_RUN", "HEADER_START (simulated TX)", seq.headerStart);
  if (seq.chunks.length > 0) {
    recordSerialLog("DRY_RUN", `DATA_CHUNK[0/${seq.chunks.length}] (simulated TX)`, seq.chunks[0]);
  }
  if (seq.chunks.length > 1) {
    recordSerialLog("DRY_RUN", `DATA_CHUNK[1/${seq.chunks.length}] (simulated TX)`, seq.chunks[1]);
  }
  if (seq.chunks.length > 2) {
    const lastIdx = seq.chunks.length - 1;
    recordSerialLog(
      "DRY_RUN",
      `DATA_CHUNK[${lastIdx}/${seq.chunks.length}] (simulated TX)`,
      seq.chunks[lastIdx]
    );
  }
  recordSerialLog("DRY_RUN", "HEADER_END (simulated TX)", seq.headerEnd);
  lastDryRunSummary = {
    ranAt: (/* @__PURE__ */ new Date()).toISOString(),
    screenId: params.screenId,
    screenName: params.screenName,
    totalChunks: seq.chunks.length,
    totalBytesOnWire: seq.totalBytesOnWire,
    frameSha256Short: seq.frameSha256Short
  };
  return {
    ok: true,
    dryRun: true,
    wroteToDevice: false,
    width,
    height,
    rgb565Bytes: rgb565Le.length,
    expectedRgb565Bytes: EXPECTED_RGB565_BYTES,
    totalChunks: seq.chunks.length,
    expectedTotalChunks: EXPECTED_TOTAL_CHUNKS,
    totalBytesOnWire: seq.totalBytesOnWire,
    crcAlgorithm: "none",
    frameSha256Short: seq.frameSha256Short,
    headerStartHex: formatHexPreview(seq.headerStart, 16),
    displayOnHex: formatHexPreview(DISPLAY_ON, 8),
    headerEndHex: formatHexPreview(seq.headerEnd, 8),
    firstChunkHex: formatHexPreview(seq.chunks[0], 59),
    lastChunkHex: formatHexPreview(seq.chunks[seq.chunks.length - 1], 59),
    logEntries: dryRunLog.slice(0, 12)
  };
}
async function pushFrameOverRealSerialAsync(params) {
  return await withSerialLock(async () => {
    const gate = canPerformRealSerialWrite();
    if (!gate.allowed) {
      setLastProtocolError(gate.reason);
      throw new Error(gate.reason || "Serial writes blocked");
    }
    const resolved = resolveStrictAoostarDevice(params.requestedDevicePath);
    if (!resolved.devicePath) {
      const err = resolved.error || "Aoostar USB device (0416:90a1) not found";
      setLastProtocolError(err);
      recordSerialLog("ERROR", "DEVICE_RESOLVE_FAILED", 0, err);
      throw new Error(err);
    }
    const rgb565Le = rgbaToRgb565Le(params.rgbaBuffer, DISPLAY_WIDTH, DISPLAY_HEIGHT);
    await new Promise((resolve) => setImmediate(resolve));
    let initializeDisplay = Boolean(params.forceDisplayOn);
    try {
      if (!activeAsyncTransport || activeAsyncTransport.devicePath !== resolved.devicePath) {
        await closeActiveSerialTransportAsync();
        const opened = await LinuxAsyncSerialTransport.open(resolved.devicePath);
        activeAsyncTransport = {
          devicePath: resolved.devicePath,
          transport: opened,
          initialized: false
        };
        initializeDisplay = true;
      } else if (!activeAsyncTransport.initialized) {
        initializeDisplay = true;
      }
      const brightnessChanged = params.brightnessKey !== void 0 && lastBrightnessKey !== null && params.brightnessKey !== lastBrightnessKey;
      const periodicFull = framesSinceFullSync >= FULL_SYNC_EVERY_N_FRAMES;
      const forceFull = Boolean(
        params.forceFullRefresh || brightnessChanged || periodicFull || initializeDisplay
      );
      const res = await pushFrameViaAsyncTransport({
        transport: activeAsyncTransport.transport,
        rgb565Le,
        prevRgb565: forceFull ? null : lastSentRgb565,
        initializeDisplay,
        forceFullRefresh: forceFull
      });
      activeAsyncTransport.initialized = true;
      lastSentRgb565 = rgb565Le;
      if (params.brightnessKey !== void 0) {
        lastBrightnessKey = params.brightnessKey;
      }
      framesSinceFullSync = res.fullSync ? 0 : framesSinceFullSync + 1;
      setLastProtocolError(null);
      return {
        devicePath: resolved.devicePath,
        usbVidPid: resolved.match ? `${resolved.match.vendorId}:${resolved.match.productId}` : "0x0416:0x90a1",
        ...res
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLastProtocolError(msg);
      await closeActiveSerialTransportAsync();
      throw err;
    }
  });
}
async function runSafeDisplayOnOverSerialAsync(requestedDevicePath) {
  return await withSerialLock(async () => {
    const gate = canPerformRealSerialWrite();
    if (!gate.allowed) {
      setLastProtocolError(gate.reason);
      throw new Error(gate.reason || "Serial writes blocked");
    }
    const resolved = resolveStrictAoostarDevice(requestedDevicePath);
    if (!resolved.devicePath) {
      const err = resolved.error || "Aoostar USB device (0416:90a1) not found";
      setLastProtocolError(err);
      recordSerialLog("ERROR", "SAFE_TEST_DEVICE_MISSING", 0, err);
      throw new Error(err);
    }
    try {
      if (!activeAsyncTransport || activeAsyncTransport.devicePath !== resolved.devicePath) {
        await closeActiveSerialTransportAsync();
        const opened = await LinuxAsyncSerialTransport.open(resolved.devicePath);
        activeAsyncTransport = {
          devicePath: resolved.devicePath,
          transport: opened,
          initialized: false
        };
      }
      const ack = await sendDisplayOnHandshakeAsync(activeAsyncTransport.transport);
      activeAsyncTransport.initialized = true;
      setLastProtocolError(null);
      return {
        devicePath: resolved.devicePath,
        ackOk: ack.ackOk,
        ackBytesHex: ack.ackBytesHex
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLastProtocolError(msg);
      await closeActiveSerialTransportAsync();
      throw err;
    }
  });
}
async function sendDisplayOffOverSerialAsync(requestedDevicePath) {
  return await withSerialLock(async () => {
    const gate = canPerformRealSerialWrite();
    if (!gate.allowed) {
      setLastProtocolError(gate.reason);
      throw new Error(gate.reason || "Serial writes blocked");
    }
    const resolved = resolveStrictAoostarDevice(requestedDevicePath);
    if (!resolved.devicePath) {
      const err = resolved.error || "Aoostar USB device (0416:90a1) not found";
      setLastProtocolError(err);
      throw new Error(err);
    }
    let transient = null;
    try {
      let target;
      if (activeAsyncTransport && activeAsyncTransport.devicePath === resolved.devicePath) {
        target = activeAsyncTransport.transport;
        activeAsyncTransport.initialized = false;
      } else {
        transient = await LinuxAsyncSerialTransport.open(resolved.devicePath);
        target = transient;
      }
      await writePacketWithRetryAsync(target, DISPLAY_OFF, "DISPLAY_OFF", true);
      resetFrameDiffCache();
      setLastProtocolError(null);
      return { devicePath: resolved.devicePath };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLastProtocolError(msg);
      await closeActiveSerialTransportAsync();
      throw err;
    } finally {
      if (transient) {
        await transient.close().catch(() => {
        });
      }
    }
  });
}

// src/server/aoostar/asterctl.ts
var DATA_DIR = path2.resolve(process.cwd(), "data");
var ASTERCTL_DIAG_DIR = path2.join(DATA_DIR, "asterctl-diag");
var MAX_ASTERCTL_LOGS = 120;
var asterctlLogs = [];
var activeChild = null;
var lastExitCode = null;
var lastAsterctlError = null;
function pushAsterctlLog(stream, rawLine) {
  const line = rawLine.trim();
  if (!line) return;
  const entry = {
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    stream,
    line
  };
  asterctlLogs.unshift(entry);
  if (asterctlLogs.length > MAX_ASTERCTL_LOGS) asterctlLogs.length = MAX_ASTERCTL_LOGS;
  if (stream === "stderr") {
    console.error(`[asterctl] ${line}`);
  } else {
    console.log(`[asterctl] ${line}`);
  }
}
var cachedBinaryProbe = null;
function getCandidateBinaries() {
  const envBin = (process.env.AOOSTAR_ASTERCTL_BIN || "").trim();
  if (envBin) {
    return [envBin];
  }
  return [
    "/usr/local/bin/asterctl",
    "/usr/bin/asterctl",
    path2.resolve(process.cwd(), "bin/asterctl")
  ];
}
function detectAsterctlBinary(forceRefresh = false) {
  const envKey = (process.env.AOOSTAR_ASTERCTL_BIN || "").trim();
  if (!forceRefresh && cachedBinaryProbe && cachedBinaryProbe.envKey === envKey) {
    return cachedBinaryProbe;
  }
  for (const candidate of getCandidateBinaries()) {
    if (!fs2.existsSync(candidate)) continue;
    try {
      fs2.accessSync(candidate, fs2.constants.X_OK);
    } catch {
      cachedBinaryProbe = {
        envKey,
        available: false,
        binaryPath: candidate,
        executable: false,
        version: null,
        error: `Binary at ${candidate} is not executable`
      };
      return cachedBinaryProbe;
    }
    try {
      const out = execFileSync2(candidate, ["--version"], {
        encoding: "utf8",
        timeout: 3e3
      }).trim();
      cachedBinaryProbe = {
        envKey,
        available: true,
        binaryPath: candidate,
        executable: true,
        version: out || "asterctl (version unknown)",
        error: null
      };
      return cachedBinaryProbe;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      cachedBinaryProbe = {
        envKey,
        available: false,
        binaryPath: candidate,
        executable: true,
        version: null,
        error: `Failed to execute ${candidate} --version: ${msg}`
      };
      return cachedBinaryProbe;
    }
  }
  cachedBinaryProbe = {
    envKey,
    available: false,
    binaryPath: null,
    executable: false,
    version: null,
    error: null
  };
  return cachedBinaryProbe;
}
function getAsterctlStatus() {
  const bin = detectAsterctlBinary(false);
  const running = Boolean(activeChild && activeChild.exitCode === null && !activeChild.killed);
  return {
    available: bin.available,
    binaryPath: bin.binaryPath,
    version: bin.version,
    running,
    pid: activeChild?.pid ?? null,
    mode: !bin.available ? "absent" : running ? "running" : "idle",
    cfgDir: ASTERCTL_DIAG_DIR,
    lastExitCode,
    lastError: lastAsterctlError || (!bin.available && bin.binaryPath ? bin.error : null),
    logs: [...asterctlLogs]
  };
}
async function stopAsterctlProcess() {
  const proc = activeChild;
  if (!proc) return;
  activeChild = null;
  if (proc.exitCode !== null || proc.killed) return;
  pushAsterctlLog("system", `Stopping one-shot asterctl PID ${proc.pid}...`);
  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    const killTimer = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
      }
      finish();
    }, 2500);
    proc.once("exit", () => {
      clearTimeout(killTimer);
      finish();
    });
    try {
      proc.kill("SIGTERM");
    } catch {
      clearTimeout(killTimer);
      finish();
    }
  });
}
function createCalibrationTestRgba() {
  const buf = Buffer.alloc(DISPLAY_WIDTH * DISPLAY_HEIGHT * 4);
  const bars = [
    [245, 158, 11],
    // Amber
    [16, 185, 129],
    // Emerald
    [56, 189, 248],
    // Cyan
    [244, 63, 94],
    // Rose
    [248, 250, 252],
    // White
    [30, 41, 59]
    // Slate
  ];
  for (let y = 0; y < DISPLAY_HEIGHT; y++) {
    for (let x = 0; x < DISPLAY_WIDTH; x++) {
      const idx = (y * DISPLAY_WIDTH + x) * 4;
      const isBorder = x < 6 || x >= DISPLAY_WIDTH - 6 || y < 6 || y >= DISPLAY_HEIGHT - 6;
      if (isBorder) {
        buf[idx] = 245;
        buf[idx + 1] = 158;
        buf[idx + 2] = 11;
        buf[idx + 3] = 255;
      } else if (y < 240) {
        const barIdx = Math.min(bars.length - 1, Math.floor(x / DISPLAY_WIDTH * bars.length));
        const [r, g, b] = bars[barIdx];
        buf[idx] = r;
        buf[idx + 1] = g;
        buf[idx + 2] = b;
        buf[idx + 3] = 255;
      } else {
        const checker = (Math.floor(x / 16) + Math.floor(y / 16) & 1) === 0 ? 18 : 34;
        buf[idx] = checker;
        buf[idx + 1] = checker + 4;
        buf[idx + 2] = checker + 12;
        buf[idx + 3] = 255;
      }
    }
  }
  return buf;
}
async function runOneShotAsterctlCommand(args) {
  const bin = detectAsterctlBinary(false);
  if (!bin.available || !bin.binaryPath) {
    throw new Error(bin.error || "Optional asterctl binary not found");
  }
  fs2.mkdirSync(ASTERCTL_DIAG_DIR, { recursive: true });
  return await new Promise((resolve, reject) => {
    const child = spawn(bin.binaryPath, args, {
      cwd: ASTERCTL_DIAG_DIR,
      env: { ...process.env, RUST_LOG: process.env.RUST_LOG || "info" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    activeChild = child;
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
      }
      if (activeChild === child) activeChild = null;
      reject(new Error(`asterctl command timed out after 20s (${args.join(" ")})`));
    }, 2e4);
    child.stdout?.on("data", (d) => {
      const txt = d.toString("utf8");
      stdout += txt;
      for (const line of txt.split(/\r?\n/)) pushAsterctlLog("stdout", line);
    });
    child.stderr?.on("data", (d) => {
      const txt = d.toString("utf8");
      stderr += txt;
      for (const line of txt.split(/\r?\n/)) pushAsterctlLog("stderr", line);
    });
    child.once("error", (err) => {
      clearTimeout(timer);
      if (activeChild === child) activeChild = null;
      reject(err);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (activeChild === child) activeChild = null;
      lastExitCode = code;
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      } else {
        const errMsg = `asterctl exited with code ${code}: ${(stderr || stdout).trim() || "no output"}`;
        lastAsterctlError = errMsg;
        setLastProtocolError(errMsg);
        reject(new Error(errMsg));
      }
    });
  });
}
async function runAsterctlPowerDiagnostic(params) {
  if (!params.confirmed) {
    throw new Error("Explicit user confirmation is required before invoking asterctl on the USB device.");
  }
  const gate = canPerformRealSerialWrite();
  if (!gate.allowed) {
    throw new Error(gate.reason || "Serial writes disabled");
  }
  const bin = detectAsterctlBinary(false);
  if (!bin.available || !bin.binaryPath) {
    throw new Error(bin.error || "Optional asterctl binary is not installed");
  }
  return await withSerialLock(async () => {
    const resolved = resolveStrictAoostarDevice(params.requestedDevicePath);
    if (!resolved.devicePath) {
      throw new Error(resolved.error || "Aoostar device (0416:90a1) not found");
    }
    await closeActiveSerialTransportAsync();
    try {
      const flag = params.action === "off" ? "--off" : "--on";
      recordSerialLog("INFO", `ASTERCTL_DIAG_${params.action.toUpperCase()} (${resolved.devicePath})`, 0);
      const res = await runOneShotAsterctlCommand(["--device", resolved.devicePath, flag]);
      setLastProtocolError(null);
      return {
        devicePath: resolved.devicePath,
        action: params.action,
        output: [res.stdout, res.stderr].filter(Boolean).join("\n")
      };
    } finally {
      resetFrameDiffCache();
    }
  });
}
async function testAsterctlIntegration(params) {
  const bin = detectAsterctlBinary(false);
  const perms = inspectSerialPermissions(params.requestedDevicePath);
  if (!bin.available || !bin.binaryPath) {
    return {
      ok: false,
      optionalAbsent: true,
      binaryFound: false,
      binaryPath: bin.binaryPath,
      version: bin.version,
      simulateOk: false,
      deviceReady: perms.exists && perms.readable && perms.writable && perms.isAoostarMatch,
      permissions: perms,
      realHardwareTested: false,
      message: "Optional asterctl binary is not installed. Live LCD updates run natively over the Node async serial transport."
    };
  }
  fs2.mkdirSync(ASTERCTL_DIAG_DIR, { recursive: true });
  const calibrationRgba = createCalibrationTestRgba();
  const simPngPath = path2.join(ASTERCTL_DIAG_DIR, "simulate_test.png");
  fs2.writeFileSync(simPngPath, encodePngRgba(calibrationRgba, DISPLAY_WIDTH, DISPLAY_HEIGHT));
  const nodeRgb565Bytes = rgbaToRgb565Le(calibrationRgba, DISPLAY_WIDTH, DISPLAY_HEIGHT).length;
  let simulateOk = false;
  let simOutput = "";
  try {
    const res = await runOneShotAsterctlCommand(["--simulate", "--save", "--image", simPngPath]);
    simulateOk = true;
    simOutput = [res.stdout, res.stderr].filter(Boolean).join("\n");
  } catch (err) {
    return {
      ok: false,
      binaryFound: true,
      binaryPath: bin.binaryPath,
      version: bin.version,
      simulateOk: false,
      deviceReady: perms.exists && perms.readable && perms.writable && perms.isAoostarMatch,
      permissions: perms,
      realHardwareTested: false,
      message: err instanceof Error ? err.message : String(err)
    };
  }
  let realHardwareTested = false;
  let realOutput = "";
  const powerAction = params.action === "off" ? "off" : params.testRealDevice || params.action === "on" ? "on" : null;
  if (powerAction) {
    const res = await runAsterctlPowerDiagnostic({
      action: powerAction,
      requestedDevicePath: params.requestedDevicePath,
      confirmed: Boolean(params.confirmed)
    });
    realHardwareTested = true;
    realOutput = res.output;
  }
  const deviceReady = perms.exists && perms.readable && perms.writable && perms.isAoostarMatch;
  return {
    ok: simulateOk && (!powerAction || realHardwareTested),
    binaryFound: true,
    binaryPath: bin.binaryPath,
    version: bin.version,
    simulateOk,
    simulateOutput: simOutput,
    nodeReferenceBytes: nodeRgb565Bytes,
    deviceReady,
    permissions: perms,
    realHardwareTested,
    realOutput,
    message: realHardwareTested ? `asterctl ${bin.version} --simulate --save + --${powerAction} verified cleanly on ${perms.devicePath}.` : deviceReady ? `asterctl ${bin.version} --simulate --save passed (${nodeRgb565Bytes}B RGB565); ${perms.devicePath} (${perms.usbVidPid}) is R/W ready.` : `asterctl ${bin.version} --simulate --save passed; hardware device issue: ${perms.error || "not connected"}.`
  };
}

// src/server/hardware.ts
import crypto2 from "node:crypto";
var HEADER_START_HEX = formatHexPreview(HEADER_START, 16);
var lastFrameMeta = {
  pushedAt: null,
  screenId: null,
  screenName: null,
  width: DISPLAY_WIDTH,
  height: DISPLAY_HEIGHT,
  byteLength: EXPECTED_RGB565_BYTES,
  crc16Hex: "NONE (aoostar-rs uses no wire CRC)",
  crcAlgorithm: CRC_ALGORITHM,
  devicePath: "/dev/ttyACM0",
  deliveryMode: "blocked",
  headerHex: HEADER_START_HEX,
  chunksSent: 0,
  totalChunks: EXPECTED_TOTAL_CHUNKS,
  diffMode: true,
  unchangedSkipped: false,
  initAck: false,
  powerState: "off",
  lastError: null
};
var lastRgb565Buffer = null;
function getLastFrameMeta() {
  return lastFrameMeta;
}
function getLastFrameBuffer() {
  return lastRgb565Buffer;
}
function setLastFrameMeta(meta) {
  lastFrameMeta = meta;
}
function buildDiagnosticsSnapshot(sessionPushArmed2, preferredDevicePath, daemonState) {
  const devices = scanUsbSerialDevices();
  const perms = inspectSerialPermissions(preferredDevicePath);
  const asterctl = getAsterctlStatus();
  const serialDiag = getSerialDiagnosticsState();
  const aoostarMatch = devices.find((d) => d.isAoostarMatch);
  const activeTransport2 = !serialDiag.serialWritesEnabled || serialDiag.emergencyStopped ? "blocked" : "protocol-serial";
  return {
    detectedDevicePath: aoostarMatch?.path ?? perms.devicePath ?? null,
    usbVidPid: aoostarMatch ? `${aoostarMatch.vendorId}:${aoostarMatch.productId}` : perms.usbVidPid,
    serialPermissions: perms,
    detectedDevices: devices,
    asterctl,
    serialWritesEnabled: serialDiag.serialWritesEnabled,
    serialWritesEnvEnabled: serialDiag.serialWritesEnvEnabled,
    serialWritesConfigEnabled: serialDiag.serialWritesConfigEnabled,
    serialWritesEnvLocked: serialDiag.serialWritesEnvLocked,
    emergencyStopped: serialDiag.emergencyStopped,
    sessionPushArmed: sessionPushArmed2,
    daemonState,
    activeTransport: activeTransport2,
    lastProtocolError: serialDiag.lastProtocolError || (asterctl.mode === "absent" ? null : asterctl.lastError),
    lastPacketPreview: serialDiag.lastPacketPreview,
    lastDryRunSummary: serialDiag.lastDryRunSummary,
    lastFrame: lastFrameMeta,
    serialLogs: serialDiag.serialLogs,
    dryRunLog: serialDiag.dryRunLog
  };
}
function dryRunScreenFrame(params) {
  const dry = runDryRunFrame({
    rgbaBuffer: params.rgbaBuffer,
    screenId: params.screenId,
    screenName: params.screenName,
    width: DISPLAY_WIDTH,
    height: DISPLAY_HEIGHT
  });
  lastRgb565Buffer = rgbaToRgb565Le(params.rgbaBuffer, DISPLAY_WIDTH, DISPLAY_HEIGHT);
  lastFrameMeta = {
    pushedAt: (/* @__PURE__ */ new Date()).toISOString(),
    screenId: params.screenId,
    screenName: params.screenName,
    width: DISPLAY_WIDTH,
    height: DISPLAY_HEIGHT,
    byteLength: dry.rgb565Bytes,
    crc16Hex: `SHA256:${dry.frameSha256Short}`,
    frameDigestHex: dry.frameSha256Short,
    crcAlgorithm: "none",
    devicePath: "DRY_RUN (no serial write)",
    deliveryMode: "dry-run",
    headerHex: dry.headerStartHex,
    chunksSent: 0,
    totalChunks: dry.totalChunks,
    diffMode: false,
    unchangedSkipped: false,
    initAck: false,
    powerState: "off",
    lastError: null
  };
  return dry;
}
async function pushHardwareFrame(params) {
  const rawRgba = params.rgbaBuffer ? params.rgbaBuffer : params.rgbaBase64 ? Buffer.from(params.rgbaBase64, "base64") : Buffer.alloc(DISPLAY_WIDTH * DISPLAY_HEIGHT * 4);
  const scaledRgba = params.brightnessPercent !== void 0 && params.brightnessPercent < 100 ? applyBrightnessScaleRgba(rawRgba, params.brightnessPercent, DISPLAY_WIDTH, DISPLAY_HEIGHT) : rawRgba;
  const rgb565 = rgbaToRgb565Le(scaledRgba, DISPLAY_WIDTH, DISPLAY_HEIGHT);
  const digestShort = crypto2.createHash("sha256").update(rgb565).digest("hex").slice(0, 12).toUpperCase();
  lastRgb565Buffer = rgb565;
  const gate = canPerformRealSerialWrite();
  if (!gate.allowed) {
    lastFrameMeta = {
      pushedAt: (/* @__PURE__ */ new Date()).toISOString(),
      screenId: params.screenId,
      screenName: params.screenName,
      width: DISPLAY_WIDTH,
      height: DISPLAY_HEIGHT,
      byteLength: rgb565.length,
      crc16Hex: `SHA256:${digestShort}`,
      frameDigestHex: digestShort,
      crcAlgorithm: "none",
      devicePath: params.devicePath,
      deliveryMode: "blocked",
      headerHex: HEADER_START_HEX,
      chunksSent: 0,
      totalChunks: EXPECTED_TOTAL_CHUNKS,
      diffMode: true,
      unchangedSkipped: false,
      initAck: false,
      powerState: "off",
      lastError: gate.reason
    };
    throw new Error(gate.reason || "Serial writes blocked");
  }
  try {
    if (getAsterctlStatus().running) {
      await stopAsterctlProcess();
    }
    if (params.powerOff) {
      const offRes = await sendDisplayOffOverSerialAsync(params.devicePath);
      lastFrameMeta = {
        pushedAt: (/* @__PURE__ */ new Date()).toISOString(),
        screenId: params.screenId,
        screenName: params.screenName,
        width: DISPLAY_WIDTH,
        height: DISPLAY_HEIGHT,
        byteLength: rgb565.length,
        crc16Hex: `SHA256:${digestShort}`,
        frameDigestHex: digestShort,
        crcAlgorithm: "none",
        devicePath: offRes.devicePath,
        deliveryMode: "usb-serial",
        headerHex: HEADER_START_HEX,
        chunksSent: 0,
        totalChunks: EXPECTED_TOTAL_CHUNKS,
        diffMode: false,
        unchangedSkipped: false,
        initAck: true,
        powerState: "off",
        lastError: null
      };
      return lastFrameMeta;
    }
    const res = await pushFrameOverRealSerialAsync({
      rgbaBuffer: scaledRgba,
      requestedDevicePath: params.devicePath,
      forceFullRefresh: Boolean(params.forceFullRefresh),
      brightnessKey: params.brightnessKey ?? params.brightnessPercent
    });
    lastFrameMeta = {
      pushedAt: (/* @__PURE__ */ new Date()).toISOString(),
      screenId: params.screenId,
      screenName: params.screenName,
      width: DISPLAY_WIDTH,
      height: DISPLAY_HEIGHT,
      byteLength: rgb565.length,
      crc16Hex: `SHA256:${res.frameSha256Short}`,
      frameDigestHex: res.frameSha256Short,
      crcAlgorithm: "none",
      devicePath: res.devicePath,
      deliveryMode: "usb-serial",
      headerHex: HEADER_START_HEX,
      chunksSent: res.chunksSent,
      totalChunks: res.totalChunks,
      diffMode: !res.fullSync,
      unchangedSkipped: res.unchangedSkipped,
      initAck: true,
      powerState: "on",
      lastError: null
    };
    return lastFrameMeta;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setLastProtocolError(msg);
    lastFrameMeta = {
      pushedAt: (/* @__PURE__ */ new Date()).toISOString(),
      screenId: params.screenId,
      screenName: params.screenName,
      width: DISPLAY_WIDTH,
      height: DISPLAY_HEIGHT,
      byteLength: rgb565.length,
      crc16Hex: `SHA256:${digestShort}`,
      frameDigestHex: digestShort,
      crcAlgorithm: "none",
      devicePath: params.devicePath,
      deliveryMode: "error",
      headerHex: HEADER_START_HEX,
      chunksSent: 0,
      totalChunks: EXPECTED_TOTAL_CHUNKS,
      diffMode: true,
      unchangedSkipped: false,
      initAck: false,
      powerState: "off",
      lastError: msg
    };
    throw err;
  }
}
async function runSafeHardwareTest(params) {
  if (!params.confirmed) {
    throw new Error("Explicit user confirmation is required before running a hardware test.");
  }
  const gate = canPerformRealSerialWrite();
  if (!gate.allowed) {
    throw new Error(gate.reason || "Serial writes disabled");
  }
  if (getAsterctlStatus().running) {
    await stopAsterctlProcess();
  }
  if (params.mode === "display-on") {
    const res = await runSafeDisplayOnOverSerialAsync(params.devicePath);
    return {
      ok: true,
      transport: "protocol-serial",
      devicePath: res.devicePath,
      ackOk: res.ackOk,
      ackBytesHex: res.ackBytesHex
    };
  }
  const testRgba = params.rgbaBuffer ?? createCalibrationTestRgba();
  const meta = await pushHardwareFrame({
    rgbaBuffer: testRgba,
    screenId: params.screenId || "safe-test-frame",
    screenName: params.screenName || "Aoostar Safe Test Pattern",
    devicePath: params.devicePath,
    forceFullRefresh: true
  });
  return {
    ok: true,
    transport: meta.deliveryMode,
    devicePath: meta.devicePath,
    meta
  };
}

// src/server/frameRenderer.ts
import fs3 from "node:fs";
import path3 from "node:path";
import { Resvg } from "@resvg/resvg-js";
var LCD_W = DISPLAY_WIDTH;
var LCD_H = DISPLAY_HEIGHT;
var MULTI_SERIES_PALETTE = ["#F59E0B", "#38BDF8", "#10B981", "#A78BFA", "#F43F5E", "#FB923C"];
var FONT_SIZE_MULTIPLIER = {
  sm: 0.85,
  md: 1,
  lg: 1.2,
  xl: 1.45,
  "2xl": 1.75
};
var cachedFontFiles = null;
function discoverFontFiles() {
  if (cachedFontFiles) return cachedFontFiles;
  const candidates = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
    "/usr/share/fonts/truetype/jetbrains-mono/JetBrainsMono-Regular.ttf",
    "/usr/share/fonts/truetype/jetbrains-mono/JetBrainsMono-Medium.ttf",
    "/usr/share/fonts/truetype/jetbrains-mono/JetBrainsMono-SemiBold.ttf",
    "/usr/share/fonts/truetype/jetbrains-mono/JetBrainsMono-Bold.ttf",
    "/app/asterctl-fonts/DejaVuSans.ttf",
    "/app/asterctl-fonts/JetBrainsMono-Regular.ttf"
  ];
  const found = [];
  for (const p of candidates) {
    try {
      if (fs3.existsSync(p)) found.push(p);
    } catch {
    }
  }
  cachedFontFiles = found;
  return found;
}
var imageDataUriCache = /* @__PURE__ */ new Map();
function resolveLocalImageDataUri(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  const url = rawUrl.trim();
  if (!url) return null;
  if (/^data:image\/(png|jpeg|jpg|webp|gif|avif);base64,[a-z0-9+/=\s]+$/i.test(url)) {
    return url;
  }
  let diskPath = null;
  const cwd = process.cwd();
  if (url.startsWith("/uploads/")) {
    const uploadsRoot = path3.resolve(cwd, "data", "uploads");
    const candidate = path3.resolve(uploadsRoot, path3.basename(url.split("?")[0]));
    if (candidate.startsWith(uploadsRoot + path3.sep)) {
      diskPath = candidate;
    }
  } else if (url.startsWith("/src/assets/images/")) {
    const baseName = path3.basename(url.split("?")[0]);
    const assetsRoot = path3.resolve(cwd, "src", "assets", "images");
    const candidate = path3.resolve(assetsRoot, baseName);
    if (candidate.startsWith(assetsRoot + path3.sep) && fs3.existsSync(candidate)) {
      diskPath = candidate;
    } else {
      const distAssetsRoot = path3.resolve(cwd, "dist", "assets");
      if (fs3.existsSync(distAssetsRoot)) {
        const parsed = path3.parse(baseName);
        try {
          const matched = fs3.readdirSync(distAssetsRoot).find(
            (f) => f === baseName || f.startsWith(`${parsed.name}-`) && f.endsWith(parsed.ext)
          );
          if (matched) {
            const distCandidate = path3.resolve(distAssetsRoot, matched);
            if (distCandidate.startsWith(distAssetsRoot + path3.sep)) {
              diskPath = distCandidate;
            }
          }
        } catch {
        }
      }
    }
  } else if (url.startsWith("/assets/")) {
    const distAssetsRoot = path3.resolve(cwd, "dist", "assets");
    const candidate = path3.resolve(distAssetsRoot, path3.basename(url.split("?")[0]));
    if (candidate.startsWith(distAssetsRoot + path3.sep)) {
      diskPath = candidate;
    }
  }
  if (!diskPath) return null;
  try {
    const st = fs3.statSync(diskPath);
    if (!st.isFile() || st.size <= 0 || st.size > 16 * 1024 * 1024) return null;
    const cached = imageDataUriCache.get(diskPath);
    if (cached && cached.mtimeMs === st.mtimeMs) {
      return cached.dataUri;
    }
    const ext = path3.extname(diskPath).toLowerCase();
    const mime = ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : ext === ".gif" ? "image/gif" : ext === ".avif" ? "image/avif" : null;
    if (!mime) return null;
    const b64 = fs3.readFileSync(diskPath).toString("base64");
    const dataUri = `data:${mime};base64,${b64}`;
    if (imageDataUriCache.size > 64) imageDataUriCache.clear();
    imageDataUriCache.set(diskPath, { mtimeMs: st.mtimeMs, dataUri });
    return dataUri;
  } catch {
    return null;
  }
}
function escapeXml(raw) {
  return String(raw ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function safeColor(raw, fallback = "#0F1520") {
  const val = (raw || "").trim();
  if (/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3}|[0-9a-fA-F]{5})?$/.test(val)) return val;
  if (/^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+(\s*,\s*[\d.]+)?\s*\)$/i.test(val)) return val;
  return fallback;
}
function formatBytesCompact(bytes, decimals = 1) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  return `${(bytes / Math.pow(k, i)).toFixed(decimals)} ${sizes[i]}`;
}
function formatUptimeShort(sec) {
  const s = Math.max(0, Math.floor(sec));
  const d = Math.floor(s / 86400);
  const h = Math.floor(s % 86400 / 3600);
  const m = Math.floor(s % 3600 / 60);
  return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`;
}
function fontForOption(option) {
  if (option === "display" || option === "sans") {
    return "DejaVu Sans, sans-serif";
  }
  return "JetBrains Mono, DejaVu Sans Mono, monospace";
}
function resolveTemplateText(template, exposedEntities) {
  return template.replace(/\{\{([^}]+)\}\}/g, (_match, rawKey) => {
    const cleanKey = rawKey.trim();
    if (cleanKey.startsWith("tag:")) {
      const id = cleanKey.slice(4).trim();
      const found2 = exposedEntities.find((e) => e.id === id);
      return found2 ? found2.tag : id;
    }
    const found = exposedEntities.find((e) => e.id === cleanKey);
    if (!found) return cleanKey;
    return `${found.rawValue}${found.unit ? found.unit : ""}`;
  });
}
function isVideoMedia(url, mediaType) {
  if (mediaType === "video") return true;
  if (!url) return false;
  return /\.(mp4|webm)(\?|$)/i.test(url) || url.startsWith("data:video/");
}
function truncateChars(text, maxChars) {
  if (text.length <= maxChars) return text;
  if (maxChars <= 1) return text.slice(0, maxChars);
  return `${text.slice(0, maxChars - 1)}\u2026`;
}
function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = (angleDeg - 90) * Math.PI / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad)
  };
}
function describeArc(cx, cy, r, startDeg, endDeg) {
  const clampedEnd = Math.min(startDeg + 359.6, endDeg);
  const start = polarToCartesian(cx, cy, r, clampedEnd);
  const end = polarToCartesian(cx, cy, r, startDeg);
  const largeArcFlag = clampedEnd - startDeg <= 180 ? "0" : "1";
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${largeArcFlag} 0 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}
function renderLineAreaSeriesSvg(params) {
  const { x, y, w, h, seriesList, isArea, isSmooth, unit, textColor, uid } = params;
  if (w < 24 || h < 24) return "";
  const fScale = Math.max(0.75, Math.min(1.35, params.fontScale ?? 1));
  const labelSize = Number((11.5 * fScale).toFixed(1));
  const legendSize = Number((11.5 * fScale).toFixed(1));
  const nonEmpty = seriesList.filter((s) => s.data.length > 0);
  if (nonEmpty.length === 0) {
    return `<text x="${x + w / 2}" y="${y + h / 2 + 5}" text-anchor="middle" font-size="${Math.round(13 * fScale)}" fill="#94A3B8">Collecting telemetry\u2026</text>`;
  }
  const allVals = nonEmpty.flatMap((s) => s.data);
  let minV = params.yMinOverride !== void 0 ? params.yMinOverride : Math.min(...allVals);
  let maxV = params.yMaxOverride !== void 0 ? params.yMaxOverride : Math.max(...allVals);
  if (minV === maxV) {
    minV = Math.max(0, minV - 5);
    maxV = maxV + 5;
  }
  const span = Math.max(1e-3, maxV - minV);
  const legendH = nonEmpty.length > 1 ? Math.round(18 * fScale) : 0;
  const padLeft = Math.round(36 * fScale);
  const padRight = 8;
  const padTop = 8 + legendH;
  const padBottom = 10;
  const plotX = x + padLeft;
  const plotY = y + padTop;
  const plotW = Math.max(16, w - padLeft - padRight);
  const plotH = Math.max(16, h - padTop - padBottom);
  const parts = [];
  if (nonEmpty.length > 1) {
    let lx = x + w - 4;
    for (let i = nonEmpty.length - 1; i >= 0; i--) {
      const s = nonEmpty[i];
      const lbl = truncateChars(s.name, 14);
      const estW = lbl.length * (legendSize * 0.62) + 18;
      lx -= estW;
      if (lx < x + 4) break;
      parts.push(`<circle cx="${lx + 5}" cy="${y + 9}" r="4" fill="${safeColor(s.color)}" />`);
      parts.push(
        `<text x="${lx + 13}" y="${y + 13}" font-size="${legendSize}" fill="${textColor}" fill-opacity="0.86">${escapeXml(lbl)}</text>`
      );
    }
  }
  for (let g = 0; g <= 2; g++) {
    const frac = g / 2;
    const gy = plotY + frac * plotH;
    const valAtLine = Math.round(maxV - frac * span);
    parts.push(
      `<line x1="${plotX}" y1="${gy.toFixed(1)}" x2="${plotX + plotW}" y2="${gy.toFixed(1)}" stroke="#94A3B8" stroke-opacity="0.22" stroke-dasharray="3 3" stroke-width="1.2" />`
    );
    parts.push(
      `<text x="${plotX - 5}" y="${(gy + 4).toFixed(1)}" text-anchor="end" font-size="${labelSize}" fill="#94A3B8">${escapeXml(
        `${valAtLine}${unit}`
      )}</text>`
    );
  }
  nonEmpty.forEach((s, idx) => {
    const ptsRaw = s.data.length === 1 ? [s.data[0], s.data[0]] : s.data;
    const pts = ptsRaw.map((v, i) => {
      const px = plotX + i / Math.max(1, ptsRaw.length - 1) * plotW;
      const py = plotY + plotH - (v - minV) / span * plotH;
      return { x: px, y: Math.max(plotY, Math.min(plotY + plotH, py)) };
    });
    let lineD = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    if (isSmooth && pts.length > 2) {
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i];
        const p1 = pts[i + 1];
        const midX = ((p0.x + p1.x) / 2).toFixed(1);
        lineD += ` C ${midX} ${p0.y.toFixed(1)}, ${midX} ${p1.y.toFixed(1)}, ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`;
      }
    } else {
      for (let i = 1; i < pts.length; i++) {
        lineD += ` L ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)}`;
      }
    }
    const col = safeColor(s.color, "#F59E0B");
    if (isArea) {
      const gradId = `grad-${uid}-${idx}`;
      parts.push(
        `<defs><linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${col}" stop-opacity="0.4" /><stop offset="100%" stop-color="${col}" stop-opacity="0.04" /></linearGradient></defs>`
      );
      const areaD = `${lineD} L ${pts[pts.length - 1].x.toFixed(1)} ${(plotY + plotH).toFixed(1)} L ${pts[0].x.toFixed(1)} ${(plotY + plotH).toFixed(1)} Z`;
      parts.push(`<path d="${areaD}" fill="url(#${gradId})" />`);
    }
    parts.push(`<path d="${lineD}" fill="none" stroke="${col}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />`);
  });
  return parts.join("");
}
function renderWidgetSvg(params) {
  const { w, telemetry, haEntities, exposedEntities, dockerIcons, index, now } = params;
  const uid = `w${index}`;
  const accent = safeColor(w.accentColor, "#F59E0B");
  const textCol = safeColor(w.textColor, "#F8FAFC");
  const bgCol = safeColor(w.bgColor, "#0D131D");
  const bgOpacity = Math.max(0, Math.min(1, w.bgOpacity ?? 0.78));
  const borderOpacity = Math.max(0, Math.min(1, w.borderOpacity ?? 0.25));
  const fontFamily = fontForOption(w.fontFamily);
  const fontPresetScale = FONT_SIZE_MULTIPLIER[w.fontSizePreset ?? "md"] ?? 1;
  const scale = Math.max(0.5, Math.min(2.5, (w.fontScale || 1) * fontPresetScale));
  if (w.type === "divider") {
    const cy = w.y + w.h / 2;
    return `<line x1="${w.x + 4}" y1="${cy}" x2="${w.x + w.w - 4}" y2="${cy}" stroke="${accent}" stroke-opacity="0.65" stroke-width="1.2" />`;
  }
  const clipId = `clip-${uid}`;
  const parts = [
    `<defs><clipPath id="${clipId}"><rect x="${w.x}" y="${w.y}" width="${w.w}" height="${w.h}" rx="4" ry="4" /></clipPath></defs>`,
    `<g font-family="${fontFamily}" clip-path="url(#${clipId})">`
  ];
  const bgImageData = resolveLocalImageDataUri(w.bgImageUrl);
  if (bgImageData) {
    const par = w.bgImageFit === "contain" ? "xMidYMid meet" : "xMidYMid slice";
    const bgImgOp = Math.max(0, Math.min(1, w.bgImageOpacity ?? 1));
    parts.push(
      `<image href="${bgImageData}" x="${w.x}" y="${w.y}" width="${w.w}" height="${w.h}" preserveAspectRatio="${par}" opacity="${bgImgOp}" />`
    );
  }
  if (w.type === "image_layer") {
    parts.push(
      `<rect x="${w.x}" y="${w.y}" width="${w.w}" height="${w.h}" rx="4" ry="4" fill="${bgCol}" fill-opacity="${bgOpacity}" />`
    );
    if (isVideoMedia(w.imageUrl, w.mediaType)) {
      parts.push(
        `<text x="${w.x + w.w / 2}" y="${w.y + w.h / 2 - 4}" text-anchor="middle" font-size="11" font-weight="600" fill="${accent}">VIDEO LAYER</text>`
      );
      parts.push(
        `<text x="${w.x + w.w / 2}" y="${w.y + w.h / 2 + 13}" text-anchor="middle" font-size="10" fill="#94A3B8">${escapeXml(
          truncateChars(w.title || "Looping Media", 24)
        )}</text>`
      );
    } else {
      const layerData = resolveLocalImageDataUri(w.imageUrl);
      if (layerData) {
        const par = w.imageFit === "contain" ? "xMidYMid meet" : "xMidYMid slice";
        parts.push(
          `<image href="${layerData}" x="${w.x}" y="${w.y}" width="${w.w}" height="${w.h}" preserveAspectRatio="${par}" />`
        );
      } else {
        parts.push(
          `<text x="${w.x + w.w / 2}" y="${w.y + w.h / 2 + 4}" text-anchor="middle" font-size="11" fill="#94A3B8">No image selected</text>`
        );
      }
    }
    parts.push(
      `<rect x="${w.x + 0.5}" y="${w.y + 0.5}" width="${Math.max(0, w.w - 1)}" height="${Math.max(
        0,
        w.h - 1
      )}" rx="4" ry="4" fill="none" stroke="#94A3B8" stroke-opacity="${borderOpacity}" stroke-width="1" />`
    );
    parts.push("</g>");
    return parts.join("");
  }
  parts.push(
    `<rect x="${w.x}" y="${w.y}" width="${w.w}" height="${w.h}" rx="4" ry="4" fill="${bgCol}" fill-opacity="${bgOpacity}" stroke="#94A3B8" stroke-opacity="${borderOpacity}" stroke-width="1" />`
  );
  if (w.type === "custom_text") {
    const renderedText = resolveTemplateText(w.customText || w.title, exposedEntities);
    const fsPx = Math.round(18 * scale);
    parts.push(
      `<text x="${w.x + 14}" y="${w.y + w.h / 2 + fsPx * 0.36}" font-size="${fsPx}" font-weight="600" fill="${textCol}">${escapeXml(
        truncateChars(renderedText, Math.max(6, Math.floor((w.w - 28) / (fsPx * 0.62))))
      )}</text>`
    );
    parts.push("</g>");
    return parts.join("");
  }
  if (w.type === "custom_html") {
    const resolved = resolveTemplateText(w.htmlCode || w.title, exposedEntities).replace(/<br\s*\/?>/gi, "\n").replace(/<\/(div|p|li|tr|h\d)>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ");
    const lines = resolved.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 5);
    const bodyLines = lines.length > 0 ? lines : [w.title];
    const htmlScale = Math.min(1.4, scale);
    bodyLines.forEach((line, idx) => {
      const ly = w.y + 26 + idx * Math.round(24 * htmlScale);
      if (ly > w.y + w.h - 8) return;
      const isHighlight = idx === 1;
      const fs8 = Math.round((isHighlight ? 22 : 14) * htmlScale);
      parts.push(
        `<text x="${w.x + 14}" y="${ly}" font-size="${fs8}" font-weight="${isHighlight ? 700 : 500}" fill="${isHighlight ? accent : textCol}">${escapeXml(truncateChars(line, Math.max(10, Math.floor((w.w - 28) / (fs8 * 0.62)))))}</text>`
      );
    });
    parts.push("</g>");
    return parts.join("");
  }
  const boundEntity = exposedEntities.find((e) => e.id === w.entityId);
  const boundIds = w.entityIds && w.entityIds.length > 0 ? w.entityIds : w.entityId ? [w.entityId] : [];
  const boundEntities = boundIds.map((id) => exposedEntities.find((e) => e.id === id)).filter((e) => Boolean(e));
  const displayTitle = boundEntity && w.type === "entity_number" ? w.title || boundEntity.tag : w.title;
  const uiScale = Math.min(1.35, scale);
  const titleSize = Number((13.5 * Math.min(1.3, scale)).toFixed(1));
  const titleY = Math.round(w.y + 11 + titleSize * 0.85);
  const dotY = Math.round(w.y + 11 + titleSize * 0.45);
  parts.push(
    `<text x="${w.x + 12}" y="${titleY}" font-size="${titleSize}" font-weight="600" fill="${textCol}" fill-opacity="0.8">${escapeXml(
      truncateChars(displayTitle, Math.max(6, Math.floor((w.w - 38) / (titleSize * 0.62))))
    )}</text>`
  );
  parts.push(`<circle cx="${w.x + w.w - 14}" cy="${dotY}" r="4" fill="${accent}" />`);
  const headerBottom = titleY + 10;
  const bodyX = w.x + 12;
  const bodyY = headerBottom;
  const bodyW = Math.max(24, w.w - 24);
  const bodyH = Math.max(20, w.y + w.h - headerBottom - 10);
  if (w.type === "entity_number") {
    const valStr = boundEntity ? String(boundEntity.rawValue) : "\u2014";
    const unitStr = boundEntity?.unit ?? "";
    const tagStr = boundEntity?.tag ?? w.entityId ?? "Unbound";
    const subSize = Math.round(13 * uiScale);
    const availH = Math.max(24, bodyH - subSize - 6);
    const baseNum = Math.max(28, Math.min(54, availH * 0.72));
    const charUnits = Math.max(1.5, valStr.length + (unitStr ? unitStr.length * 0.62 + 0.5 : 0));
    const maxFitW = bodyW / (charUnits * 0.64);
    const numSize = Math.round(Math.max(22, Math.min(baseNum * uiScale, maxFitW)));
    const centerY = bodyY + availH * 0.54 + numSize * 0.34;
    parts.push(
      `<text x="${bodyX}" y="${centerY.toFixed(1)}" font-size="${numSize}" font-weight="700" fill="${accent}">${escapeXml(
        valStr
      )}${unitStr ? `<tspan font-size="${Math.round(numSize * 0.55)}" font-weight="600" fill="${accent}" fill-opacity="0.88"> ${escapeXml(
        unitStr
      )}</tspan>` : ""}</text>`
    );
    parts.push(
      `<text x="${bodyX}" y="${w.y + w.h - 11}" font-size="${subSize}" fill="${textCol}" fill-opacity="0.68">${escapeXml(
        truncateChars(tagStr, Math.max(8, Math.floor(bodyW / (subSize * 0.62))))
      )}</text>`
    );
  } else if (w.type === "entity_list") {
    const itemSize = Math.round(Math.max(12.5, Math.min(16, bodyH * 0.145)) * Math.min(1.25, scale));
    const rowStep = Math.round(itemSize * 1.58);
    const maxRows = Math.min(w.maxItems ?? 5, Math.max(1, Math.floor((bodyH + 2) / rowStep)));
    if (boundEntities.length === 0) {
      parts.push(
        `<text x="${bodyX}" y="${bodyY + itemSize + 4}" font-size="${itemSize}" fill="${textCol}" fill-opacity="0.6">No bound entities</text>`
      );
    } else {
      const rows = boundEntities.slice(0, maxRows);
      const startY = bodyY + itemSize + Math.max(0, Math.floor((bodyH - rows.length * rowStep) / 2));
      rows.forEach((ent, idx) => {
        const ry = startY + idx * rowStep;
        const valText = `${ent.rawValue}${ent.unit ? ent.unit : ""}`;
        const valWReserve = valText.length * (itemSize * 0.66) + 12;
        parts.push(
          `<text x="${bodyX}" y="${ry}" font-size="${itemSize}" fill="${textCol}" fill-opacity="0.88">${escapeXml(
            truncateChars(ent.tag, Math.max(6, Math.floor((bodyW - valWReserve) / (itemSize * 0.62))))
          )}</text>`
        );
        parts.push(
          `<text x="${w.x + w.w - 12}" y="${ry}" text-anchor="end" font-size="${itemSize}" font-weight="700" fill="${accent}">${escapeXml(
            valText
          )}</text>`
        );
      });
    }
  } else if (w.type === "clock") {
    const timeStr = now.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
    const dateStr = now.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric"
    });
    const footerSize = Math.round(13 * uiScale);
    const availH = Math.max(28, bodyH - footerSize - 8);
    const maxByWidth = bodyW / 4.95;
    const maxByHeight = availH * 0.78;
    const clockSize = Math.round(Math.max(26, Math.min(maxByWidth, Math.min(80, maxByHeight * uiScale))));
    const clockY = bodyY + availH * 0.52 + clockSize * 0.34;
    parts.push(
      `<text x="${bodyX}" y="${clockY.toFixed(1)}" font-size="${clockSize}" font-weight="700" fill="${textCol}">${escapeXml(
        timeStr
      )}</text>`
    );
    parts.push(
      `<text x="${bodyX}" y="${w.y + w.h - 11}" font-size="${footerSize}" fill="${textCol}" fill-opacity="0.74">${escapeXml(
        dateStr
      )}</text>`
    );
    parts.push(
      `<text x="${w.x + w.w - 12}" y="${w.y + w.h - 11}" text-anchor="end" font-size="${footerSize}" fill="${textCol}" fill-opacity="0.74">UP ${escapeXml(
        formatUptimeShort(telemetry.system.uptimeSeconds)
      )}</text>`
    );
  } else if (w.type === "cpu_load") {
    const cpuPct = Math.max(0, Math.min(100, telemetry.system.cpuPercent));
    const heroSize = Math.round(Math.max(26, Math.min(44, bodyH * 0.42)) * uiScale);
    const metaSize = Math.round(14 * uiScale);
    const footerSize = Math.round(13 * uiScale);
    const topY = bodyY + heroSize * 0.9;
    parts.push(
      `<text x="${bodyX}" y="${topY.toFixed(1)}" font-size="${heroSize}" font-weight="700" fill="${accent}">${cpuPct}%</text>`
    );
    parts.push(
      `<text x="${w.x + w.w - 12}" y="${(topY - 2).toFixed(1)}" text-anchor="end" font-size="${metaSize}" fill="${textCol}" fill-opacity="0.86">${telemetry.system.cpuTempC}\xB0C \xB7 ${telemetry.system.cpuPowerW}W</text>`
    );
    const barY = Math.round(topY + Math.max(10, (w.y + w.h - footerSize - 22 - topY) * 0.45));
    parts.push(`<rect x="${bodyX}" y="${barY}" width="${bodyW}" height="10" rx="3" fill="#1E293B" />`);
    parts.push(
      `<rect x="${bodyX}" y="${barY}" width="${Math.round(cpuPct / 100 * bodyW)}" height="10" rx="3" fill="${accent}" />`
    );
    parts.push(
      `<text x="${bodyX}" y="${w.y + w.h - 11}" font-size="${footerSize}" fill="${textCol}" fill-opacity="0.72">LOAD</text>`
    );
    parts.push(
      `<text x="${w.x + w.w - 12}" y="${w.y + w.h - 11}" text-anchor="end" font-size="${footerSize}" fill="${textCol}" fill-opacity="0.72">${escapeXml(
        telemetry.system.loadAvg.join(" / ")
      )}</text>`
    );
  } else if (w.type === "memory_bar") {
    const total = Math.max(1, telemetry.system.ramTotalBytes);
    const used = telemetry.system.ramUsedBytes;
    const pct = Math.min(100, Math.max(0, Math.round(used / total * 100)));
    const heroSize = Math.round(Math.max(24, Math.min(40, bodyH * 0.4)) * uiScale);
    const metaSize = Math.round(13.5 * uiScale);
    const footerSize = Math.round(13 * uiScale);
    const topY = bodyY + heroSize * 0.9;
    parts.push(
      `<text x="${bodyX}" y="${topY.toFixed(1)}" font-size="${heroSize}" font-weight="700" fill="${textCol}">${pct}%</text>`
    );
    parts.push(
      `<text x="${w.x + w.w - 12}" y="${(topY - 2).toFixed(1)}" text-anchor="end" font-size="${metaSize}" fill="${textCol}" fill-opacity="0.86">${escapeXml(
        `${formatBytesCompact(used, 1)} / ${formatBytesCompact(total, 0)}`
      )}</text>`
    );
    const barY = Math.round(topY + Math.max(10, (w.y + w.h - footerSize - 22 - topY) * 0.45));
    parts.push(`<rect x="${bodyX}" y="${barY}" width="${bodyW}" height="10" rx="3" fill="#1E293B" />`);
    parts.push(
      `<rect x="${bodyX}" y="${barY}" width="${Math.round(pct / 100 * bodyW)}" height="10" rx="3" fill="${accent}" />`
    );
    parts.push(
      `<text x="${bodyX}" y="${w.y + w.h - 11}" font-size="${footerSize}" fill="${textCol}" fill-opacity="0.72">ARC / Cache</text>`
    );
    parts.push(
      `<text x="${w.x + w.w - 12}" y="${w.y + w.h - 11}" text-anchor="end" font-size="${footerSize}" fill="${textCol}" fill-opacity="0.72">${escapeXml(
        formatBytesCompact(telemetry.system.ramCachedBytes, 1)
      )}</text>`
    );
  } else if (w.type === "array_status") {
    const total = Math.max(1, telemetry.array.totalBytes);
    const used = telemetry.array.usedBytes;
    const pct = Math.min(100, Math.max(0, Math.round(used / total * 100)));
    const stateColor = telemetry.array.parityValid ? "#10B981" : "#EF4444";
    const stateSize = Math.round(19 * uiScale);
    const capSize = Math.round(16 * uiScale);
    const footerSize = Math.round(13 * uiScale);
    const topY = bodyY + stateSize + 2;
    parts.push(
      `<text x="${bodyX}" y="${topY}" font-size="${stateSize}" font-weight="700" fill="${stateColor}">${escapeXml(
        telemetry.array.state
      )}</text>`
    );
    parts.push(
      `<text x="${w.x + w.w - 12}" y="${topY}" text-anchor="end" font-size="${capSize}" font-weight="600" fill="${textCol}" fill-opacity="0.9">${escapeXml(
        `${formatBytesCompact(used, 1)} / ${formatBytesCompact(total, 1)}`
      )}</text>`
    );
    const barY = Math.round(topY + Math.max(10, (w.y + w.h - footerSize - 22 - topY) * 0.45));
    parts.push(`<rect x="${bodyX}" y="${barY}" width="${bodyW}" height="11" rx="3" fill="#1E293B" />`);
    parts.push(
      `<rect x="${bodyX}" y="${barY}" width="${Math.round(pct / 100 * bodyW)}" height="11" rx="3" fill="${accent}" />`
    );
    parts.push(
      `<text x="${bodyX}" y="${w.y + w.h - 11}" font-size="${footerSize}" fill="${textCol}" fill-opacity="0.74">Parity: ${telemetry.array.parityValid ? "Valid" : "Degraded"}</text>`
    );
    parts.push(
      `<text x="${w.x + w.w - 12}" y="${w.y + w.h - 11}" text-anchor="end" font-size="${footerSize}" fill="${textCol}" fill-opacity="0.74">Free: ${escapeXml(
        formatBytesCompact(telemetry.array.freeBytes, 1)
      )}</text>`
    );
  } else if (w.type === "docker_list") {
    const running = telemetry.containers.filter((c) => c.state === "running");
    const itemSize = Math.round(14 * Math.min(1.25, scale));
    const statSize = Math.round(13 * Math.min(1.25, scale));
    const rowStep = Math.round(itemSize * 1.85);
    const iconSize = Math.round(itemSize * 1.28);
    const maxRows = Math.min(w.maxItems ?? 5, Math.max(1, Math.floor((bodyH + 2) / rowStep)));
    if (running.length === 0) {
      parts.push(
        `<text x="${bodyX}" y="${bodyY + 20}" font-size="${itemSize}" fill="${textCol}" fill-opacity="0.6">No running containers</text>`
      );
    } else {
      running.slice(0, maxRows).forEach((c, idx) => {
        const ry = bodyY + itemSize + 4 + idx * rowStep;
        const iconData = resolveLocalImageDataUri(dockerIcons[c.name]);
        const iconY = ry - iconSize + 3;
        if (iconData) {
          parts.push(
            `<image href="${iconData}" x="${bodyX}" y="${iconY}" width="${iconSize}" height="${iconSize}" preserveAspectRatio="xMidYMid slice" />`
          );
        } else {
          parts.push(
            `<rect x="${bodyX}" y="${iconY}" width="${iconSize}" height="${iconSize}" rx="3" fill="#94A3B8" fill-opacity="0.2" />`
          );
          parts.push(
            `<text x="${bodyX + iconSize / 2}" y="${ry - 1}" text-anchor="middle" font-size="${Math.round(iconSize * 0.5)}" font-weight="700" fill="${accent}">${escapeXml(
              c.name.slice(0, 2).toUpperCase()
            )}</text>`
          );
        }
        const statStr = `${c.cpuPercent.toFixed(1)}% \xB7 ${c.memUsedMB}M`;
        const statReserve = statStr.length * (statSize * 0.64) + iconSize + 18;
        parts.push(
          `<text x="${bodyX + iconSize + 8}" y="${ry}" font-size="${itemSize}" fill="${textCol}" fill-opacity="0.95">${escapeXml(
            truncateChars(c.name, Math.max(6, Math.floor((bodyW - statReserve) / (itemSize * 0.62))))
          )}</text>`
        );
        parts.push(
          `<text x="${w.x + w.w - 12}" y="${ry}" text-anchor="end" font-size="${statSize}" fill="${textCol}" fill-opacity="0.74">${statStr}</text>`
        );
      });
    }
  } else if (w.type === "active_tasks") {
    const itemSize = Math.round(13.5 * Math.min(1.25, scale));
    const rowStep = Math.round(itemSize * 2.15);
    const maxRows = Math.min(w.maxItems ?? 3, Math.max(1, Math.floor((bodyH + 2) / rowStep)));
    const tasks = telemetry.tasks.slice(0, maxRows);
    if (tasks.length === 0) {
      parts.push(
        `<text x="${bodyX}" y="${bodyY + 20}" font-size="${itemSize}" fill="${textCol}" fill-opacity="0.6">No active tasks</text>`
      );
    } else {
      tasks.forEach((tk, idx) => {
        const ry = bodyY + itemSize + 2 + idx * rowStep;
        const pct = tk.status === "running" ? tk.progressPercent : tk.status === "idle" ? 100 : 0;
        const statusStr = tk.status === "running" ? `${tk.progressPercent}%` : tk.status;
        parts.push(
          `<text x="${bodyX}" y="${ry}" font-size="${itemSize}" fill="${textCol}" fill-opacity="0.92">${escapeXml(
            truncateChars(tk.name, Math.max(8, Math.floor((bodyW - 76) / (itemSize * 0.62))))
          )}</text>`
        );
        parts.push(
          `<text x="${w.x + w.w - 12}" y="${ry}" text-anchor="end" font-size="${itemSize}" font-weight="600" fill="${tk.status === "running" ? accent : "#94A3B8"}">${escapeXml(statusStr)}</text>`
        );
        parts.push(`<rect x="${bodyX}" y="${ry + 6}" width="${bodyW}" height="6" rx="3" fill="#1E293B" />`);
        parts.push(
          `<rect x="${bodyX}" y="${ry + 6}" width="${Math.round(Math.min(100, Math.max(0, pct)) / 100 * bodyW)}" height="6" rx="3" fill="${tk.status === "running" ? accent : "#334155"}" />`
        );
      });
    }
  } else if (w.type === "active_users") {
    const itemSize = Math.round(13.5 * Math.min(1.25, scale));
    const rowStep = Math.round(itemSize * 1.7);
    const maxRows = Math.min(w.maxItems ?? 3, Math.max(1, Math.floor((bodyH + 2) / rowStep)));
    const sessions = telemetry.sessions.slice(0, maxRows);
    if (sessions.length === 0) {
      parts.push(
        `<text x="${bodyX}" y="${bodyY + 20}" font-size="${itemSize}" fill="${textCol}" fill-opacity="0.6">No active SMB/SSH sessions</text>`
      );
    } else {
      sessions.forEach((s, idx) => {
        const ry = bodyY + itemSize + 3 + idx * rowStep;
        const rightStr = `${s.protocol} \xB7 ${s.throughputMBps.toFixed(1)} MB/s`;
        const reserve = rightStr.length * (itemSize * 0.62) + 12;
        parts.push(
          `<text x="${bodyX}" y="${ry}" font-size="${itemSize}" fill="${textCol}" fill-opacity="0.92">${escapeXml(
            truncateChars(`${s.username}@${s.clientIp}`, Math.max(8, Math.floor((bodyW - reserve) / (itemSize * 0.62))))
          )}</text>`
        );
        parts.push(
          `<text x="${w.x + w.w - 12}" y="${ry}" text-anchor="end" font-size="${Math.round(itemSize * 0.92)}" fill="${textCol}" fill-opacity="0.74">${escapeXml(
            rightStr
          )}</text>`
        );
      });
    }
  } else if (w.type === "disk_thermals") {
    const itemSize = Math.round(13.5 * Math.min(1.25, scale));
    const rowStep = Math.round(itemSize * 1.7);
    const maxCols = 2;
    const maxRows = Math.max(1, Math.floor((bodyH + 2) / rowStep));
    const disks = telemetry.disks.slice(0, Math.min(w.maxItems ?? 6, maxCols * maxRows));
    const colW = (bodyW - 14) / 2;
    disks.forEach((d, idx) => {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      const dx = bodyX + col * (colW + 14);
      const dy = bodyY + itemSize + 3 + row * rowStep;
      if (dy > w.y + w.h - 6) return;
      const tempCol = d.tempC >= 48 ? "#EF4444" : d.spinState === "standby" ? "#64748B" : "#10B981";
      parts.push(
        `<text x="${dx}" y="${dy}" font-size="${itemSize}" fill="${textCol}" fill-opacity="0.88">${escapeXml(
          truncateChars(d.name, Math.max(6, Math.floor((colW - 44) / (itemSize * 0.62))))
        )}</text>`
      );
      parts.push(
        `<text x="${dx + colW}" y="${dy}" text-anchor="end" font-size="${itemSize}" font-weight="700" fill="${tempCol}">${d.spinState === "standby" ? "STBY" : `${d.tempC}\xB0C`}</text>`
      );
    });
  } else if (w.type === "ha_entity") {
    const ha = haEntities.find((e) => e.entity_id === w.haEntityId);
    const unit = ha?.attributes.unit_of_measurement ?? "";
    const friendly = ha?.attributes.friendly_name ?? (w.haEntityId || (haEntities.length === 0 ? "Connect Home Assistant" : "Select HA Entity"));
    const valStr = ha ? `${ha.state}${unit ? ` ${unit}` : ""}` : "HA Offline";
    const subSize = Math.round(13 * uiScale);
    const availH = Math.max(24, bodyH - subSize - 6);
    const baseNum = Math.max(24, Math.min(46, availH * 0.68));
    const maxFitW = bodyW / (Math.max(2, valStr.length) * 0.64);
    const valSize = Math.round(Math.max(18, Math.min(baseNum * uiScale, maxFitW)));
    parts.push(
      `<text x="${bodyX}" y="${(bodyY + availH * 0.54 + valSize * 0.34).toFixed(1)}" font-size="${valSize}" font-weight="700" fill="${accent}">${escapeXml(
        truncateChars(valStr, Math.max(8, Math.floor(bodyW / (valSize * 0.62))))
      )}</text>`
    );
    parts.push(
      `<text x="${bodyX}" y="${w.y + w.h - 11}" font-size="${subSize}" fill="${textCol}" fill-opacity="0.72">${escapeXml(
        truncateChars(friendly, Math.max(8, Math.floor(bodyW / (subSize * 0.62))))
      )}</text>`
    );
  } else if (w.type === "apex_area") {
    const palette = [
      accent,
      ...MULTI_SERIES_PALETTE.filter((c) => c.toLowerCase() !== accent.toLowerCase())
    ];
    let seriesList = [];
    let unit = "";
    let yMin;
    let yMax;
    const numericEntities = boundEntities.filter((e) => e.history.length > 0 || e.numericValue !== null);
    if (numericEntities.length > 0) {
      const allPct = numericEntities.every((e) => e.unit === "%");
      unit = numericEntities.length === 1 ? numericEntities[0].unit : "";
      if (allPct) {
        yMin = 0;
        yMax = 100;
      }
      seriesList = numericEntities.map((ent, idx) => ({
        name: ent.tag,
        color: palette[idx % palette.length],
        data: ent.history.length > 0 ? ent.history : [ent.numericValue ?? 0, ent.numericValue ?? 0]
      }));
    } else {
      const binding = w.binding ?? "cpu_percent";
      if (binding === "net_rx_tx") {
        seriesList = [
          { name: "RX Mbps", color: accent, data: telemetry.history.netRxSeries },
          { name: "TX Mbps", color: "#38BDF8", data: telemetry.history.netTxSeries }
        ];
        yMin = 0;
      } else if (binding === "ram_percent") {
        seriesList = [{ name: "Memory %", color: accent, data: telemetry.history.ramSeries }];
        unit = "%";
        yMin = 0;
        yMax = 100;
      } else {
        seriesList = [{ name: "CPU %", color: accent, data: telemetry.history.cpuSeries }];
        unit = "%";
        yMin = 0;
        yMax = 100;
      }
    }
    parts.push(
      renderLineAreaSeriesSvg({
        x: bodyX,
        y: bodyY,
        w: bodyW,
        h: bodyH,
        seriesList,
        isArea: w.chartVariant !== "line",
        isSmooth: w.chartSmooth !== false,
        unit,
        textColor: textCol,
        uid,
        fontScale: uiScale,
        yMinOverride: yMin,
        yMaxOverride: yMax
      })
    );
  } else if (w.type === "apex_radial") {
    let value = null;
    let unit = "%";
    let label = "Value";
    if (boundEntity && boundEntity.numericValue !== null) {
      value = boundEntity.numericValue;
      unit = boundEntity.unit || "%";
      label = boundEntity.tag.slice(0, 14);
    } else if (w.binding === "cpu_percent") {
      value = telemetry.system.cpuPercent;
      label = "CPU";
    } else if (w.binding === "ram_percent") {
      value = Math.round(telemetry.system.ramUsedBytes / Math.max(1, telemetry.system.ramTotalBytes) * 100);
      label = "RAM";
    } else if (w.binding === "ups_load") {
      value = telemetry.ups.loadPercent;
      label = `${telemetry.ups.currentPowerW}W`;
    } else if (w.binding === "array_percent") {
      value = Math.round(telemetry.array.usedBytes / Math.max(1, telemetry.array.totalBytes) * 100);
      label = "ARRAY";
    } else if (!w.entityId) {
      value = Math.round(telemetry.array.usedBytes / Math.max(1, telemetry.array.totalBytes) * 100);
      label = "ARRAY";
    }
    const cx = bodyX + bodyW / 2;
    const cy = bodyY + bodyH / 2 + 2;
    const r = Math.max(20, Math.min(bodyW, bodyH) * 0.43);
    const strokeW = Math.max(9, Math.round(r * 0.24));
    parts.push(
      `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="none" stroke="#94A3B8" stroke-opacity="0.18" stroke-width="${strokeW}" />`
    );
    if (value !== null) {
      const clamped = Math.min(100, Math.max(0, value));
      if (clamped > 0.5) {
        parts.push(
          `<path d="${describeArc(cx, cy, r, 0, clamped / 100 * 360)}" fill="none" stroke="${accent}" stroke-width="${strokeW}" stroke-linecap="round" />`
        );
      }
    }
    const centerVal = value === null ? "\u2014" : `${Math.round(value)}${unit}`;
    const valSize = Math.round(Math.max(22, Math.min(34, r * 0.52)) * Math.min(1.25, scale));
    const lblSize = Math.round(Math.max(11.5, Math.min(15, r * 0.22)) * Math.min(1.25, scale));
    parts.push(
      `<text x="${cx.toFixed(1)}" y="${(cy + valSize * 0.14).toFixed(1)}" text-anchor="middle" font-size="${valSize}" font-weight="700" fill="${textCol}">${escapeXml(
        centerVal
      )}</text>`
    );
    parts.push(
      `<text x="${cx.toFixed(1)}" y="${(cy + valSize * 0.14 + lblSize + 5).toFixed(1)}" text-anchor="middle" font-size="${lblSize}" fill="#94A3B8">${escapeXml(
        label
      )}</text>`
    );
  } else if (w.type === "apex_bar" || w.type === "apex_hbar") {
    const items = boundEntities.length > 0 ? boundEntities.slice(0, 6).map((e) => ({
      label: truncateChars(e.tag, 10),
      val: e.numericValue ?? 0,
      unit: e.unit || ""
    })) : telemetry.disks.slice(0, 6).map((d) => ({
      label: truncateChars(d.name, 10),
      val: d.tempC,
      unit: "\xB0"
    }));
    if (items.length === 0) {
      parts.push(
        `<text x="${bodyX}" y="${bodyY + 20}" font-size="${Math.round(13 * uiScale)}" fill="#94A3B8">No bar data available</text>`
      );
    } else {
      const maxVal = Math.max(10, ...items.map((i) => i.val));
      if (w.type === "apex_hbar") {
        const hSize = Math.round(12.5 * Math.min(1.25, scale));
        const rowH = Math.min(32, Math.max(20, Math.floor(bodyH / items.length)));
        items.forEach((it, idx) => {
          const ry = bodyY + 4 + idx * rowH;
          const labelW = Math.min(104, Math.round(bodyW * 0.36));
          const trackX = bodyX + labelW;
          const trackW = Math.max(20, bodyW - labelW - 52);
          const barW = Math.max(3, Math.round(Math.max(0, it.val) / maxVal * trackW));
          parts.push(
            `<text x="${bodyX}" y="${ry + hSize + 2}" font-size="${hSize}" fill="${textCol}" fill-opacity="0.88">${escapeXml(
              it.label
            )}</text>`
          );
          parts.push(
            `<rect x="${trackX}" y="${ry + 3}" width="${trackW}" height="13" rx="3" fill="#1E293B" />`
          );
          parts.push(
            `<rect x="${trackX}" y="${ry + 3}" width="${barW}" height="13" rx="3" fill="${accent}" />`
          );
          parts.push(
            `<text x="${w.x + w.w - 12}" y="${ry + hSize + 2}" text-anchor="end" font-size="${hSize}" font-weight="700" fill="${textCol}">${escapeXml(
              `${Math.round(it.val)}${it.unit}`
            )}</text>`
          );
        });
      } else {
        const valSize = Math.round(12.5 * Math.min(1.25, scale));
        const lblSize = Math.round(11.5 * Math.min(1.2, scale));
        const colStep = bodyW / items.length;
        const barW = Math.max(14, Math.min(54, colStep * 0.58));
        const chartBaseY = bodyY + bodyH - (lblSize + 8);
        const maxBarH = Math.max(16, bodyH - (lblSize + valSize + 18));
        items.forEach((it, idx) => {
          const cx = bodyX + idx * colStep + colStep / 2;
          const bh = Math.max(3, Math.round(Math.max(0, it.val) / maxVal * maxBarH));
          const bx = cx - barW / 2;
          const by = chartBaseY - bh;
          parts.push(`<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh}" rx="3" fill="${accent}" />`);
          parts.push(
            `<text x="${cx.toFixed(1)}" y="${(by - 5).toFixed(1)}" text-anchor="middle" font-size="${valSize}" font-weight="700" fill="${textCol}">${escapeXml(
              `${Math.round(it.val)}${it.unit}`
            )}</text>`
          );
          parts.push(
            `<text x="${cx.toFixed(1)}" y="${bodyY + bodyH - 2}" text-anchor="middle" font-size="${lblSize}" fill="#94A3B8">${escapeXml(
              truncateChars(it.label, 8)
            )}</text>`
          );
        });
      }
    }
  } else if (w.type === "apex_custom") {
    try {
      let hydrated = (w.apexCode || "{}").replace(/"\{\{history:([^}]+)\}\}"/g, (_m, id) => {
        const ent = exposedEntities.find((e) => e.id === id.trim());
        return JSON.stringify(ent?.history ?? []);
      });
      hydrated = hydrated.replace(/"\{\{([^}]+)\}\}"/g, (_m, id) => {
        const ent = exposedEntities.find((e) => e.id === id.trim());
        return JSON.stringify(ent?.numericValue ?? ent?.rawValue ?? 0);
      });
      const parsed = JSON.parse(hydrated);
      const chartType = parsed.chart?.type || "area";
      const cols = Array.isArray(parsed.colors) && parsed.colors.length > 0 ? parsed.colors : [accent];
      if (chartType === "radialBar" || chartType === "donut") {
        const firstVal = typeof parsed.series?.[0] === "number" ? parsed.series[0] : 0;
        const cx = bodyX + bodyW / 2;
        const cy = bodyY + bodyH / 2 + 2;
        const r = Math.max(20, Math.min(bodyW, bodyH) * 0.43);
        const strokeW = Math.max(9, Math.round(r * 0.24));
        parts.push(
          `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#94A3B8" stroke-opacity="0.18" stroke-width="${strokeW}" />`
        );
        if (firstVal > 0) {
          parts.push(
            `<path d="${describeArc(cx, cy, r, 0, Math.min(100, firstVal) / 100 * 360)}" fill="none" stroke="${safeColor(
              cols[0],
              accent
            )}" stroke-width="${strokeW}" stroke-linecap="round" />`
          );
        }
        parts.push(
          `<text x="${cx}" y="${cy + 7}" text-anchor="middle" font-size="${Math.round(24 * uiScale)}" font-weight="700" fill="${textCol}">${Math.round(
            firstVal
          )}%</text>`
        );
      } else {
        const seriesList = Array.isArray(parsed.series) ? parsed.series.filter((s) => typeof s === "object" && s !== null).map((s, idx) => ({
          name: s.name || `Series ${idx + 1}`,
          color: safeColor(cols[idx % cols.length], accent),
          data: Array.isArray(s.data) ? s.data.map(Number).filter((n) => Number.isFinite(n)) : []
        })) : [];
        parts.push(
          renderLineAreaSeriesSvg({
            x: bodyX,
            y: bodyY,
            w: bodyW,
            h: bodyH,
            seriesList,
            isArea: chartType !== "line",
            isSmooth: parsed.stroke?.curve !== "straight",
            unit: "",
            textColor: textCol,
            uid,
            fontScale: uiScale
          })
        );
      }
    } catch {
      parts.push(
        `<text x="${bodyX}" y="${bodyY + 20}" font-size="13" fill="#F87171">Invalid ApexCharts JSON</text>`
      );
    }
  }
  parts.push("</g>");
  return parts.join("");
}
function buildPortraitReflowWidgets(widgets) {
  const portW = LCD_H;
  const portH = LCD_W;
  const pad = 10;
  const colW = portW - pad * 2;
  const sorted = [...widgets].filter((w) => w.type !== "divider").sort((a, b) => Math.round(a.y / 36) - Math.round(b.y / 36) || a.x - b.x);
  if (sorted.length === 0) return [];
  const gap = 8;
  const availableH = portH - pad * 2 - gap * Math.max(0, sorted.length - 1);
  const rawTotalH = sorted.reduce((acc, w) => acc + Math.max(48, w.h), 0);
  const scaleH = rawTotalH > availableH ? availableH / rawTotalH : 1;
  let curY = pad;
  return sorted.map((w) => {
    const h = Math.max(46, Math.round(Math.max(48, w.h) * scaleH));
    const cloned = {
      ...w,
      x: pad,
      y: curY,
      w: colW,
      h
    };
    curY += h + gap;
    return cloned;
  });
}
function buildScreenSvgDocument(params) {
  const { screen, telemetry, haEntities, exposedEntities, dockerIcons, rotation } = params;
  const now = params.now ?? /* @__PURE__ */ new Date();
  const isPortrait = rotation === 90 || rotation === 270;
  const canvasW = isPortrait ? LCD_H : LCD_W;
  const canvasH = isPortrait ? LCD_W : LCD_H;
  const bgCol = safeColor(screen.backgroundColor, "#0B0E14");
  const bodyParts = [
    `<rect x="0" y="0" width="${canvasW}" height="${canvasH}" fill="${bgCol}" />`
  ];
  if (screen.backgroundType === "image" && screen.backgroundImage) {
    const bgData = resolveLocalImageDataUri(screen.backgroundImage);
    if (bgData) {
      bodyParts.push(
        `<image href="${bgData}" x="0" y="0" width="${canvasW}" height="${canvasH}" preserveAspectRatio="xMidYMid slice" />`
      );
    }
    const dim = Math.max(0, Math.min(1, screen.backgroundDim ?? 0));
    if (dim > 0) {
      bodyParts.push(
        `<rect x="0" y="0" width="${canvasW}" height="${canvasH}" fill="#000000" fill-opacity="${dim}" />`
      );
    }
  }
  const widgetsToRender = isPortrait ? buildPortraitReflowWidgets(screen.widgets) : screen.widgets;
  widgetsToRender.forEach((w, idx) => {
    bodyParts.push(
      renderWidgetSvg({
        w,
        telemetry,
        haEntities,
        exposedEntities,
        dockerIcons,
        index: idx,
        now
      })
    );
  });
  const innerContent = rotation === 180 ? `<g transform="rotate(180 ${canvasW / 2} ${canvasH / 2})">${bodyParts.join("")}</g>` : bodyParts.join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${canvasH}" viewBox="0 0 ${canvasW} ${canvasH}">${innerContent}</svg>`;
  return { svg, canvasW, canvasH };
}
function rotatePortraitRgbaToPhysicalLcd(portraitBuf, rotation) {
  const out = Buffer.allocUnsafe(LCD_W * LCD_H * 4);
  for (let sy = 0; sy < LCD_W; sy++) {
    for (let sx = 0; sx < LCD_H; sx++) {
      const srcIdx = (sy * LCD_H + sx) * 4;
      const dstX = rotation === 90 ? LCD_W - 1 - sy : sy;
      const dstY = rotation === 90 ? sx : LCD_H - 1 - sx;
      const dstIdx = (dstY * LCD_W + dstX) * 4;
      out[dstIdx] = portraitBuf[srcIdx];
      out[dstIdx + 1] = portraitBuf[srcIdx + 1];
      out[dstIdx + 2] = portraitBuf[srcIdx + 2];
      out[dstIdx + 3] = portraitBuf[srcIdx + 3];
    }
  }
  return out;
}
function renderScreenToRgbaBuffer(params) {
  if (params.blank) {
    const black = Buffer.alloc(LCD_W * LCD_H * 4);
    for (let i = 3; i < black.length; i += 4) black[i] = 255;
    return black;
  }
  const rotation = params.rotation ?? 0;
  const { svg } = buildScreenSvgDocument({
    screen: params.screen,
    telemetry: params.telemetry,
    haEntities: params.haEntities,
    exposedEntities: params.exposedEntities,
    dockerIcons: params.dockerIcons ?? {},
    rotation,
    now: params.now
  });
  const fontFiles = discoverFontFiles();
  const resvg = new Resvg(svg, {
    fitTo: { mode: "original" },
    font: {
      fontFiles,
      loadSystemFonts: fontFiles.length === 0,
      defaultFontFamily: "DejaVu Sans",
      sansSerifFamily: "DejaVu Sans",
      monospaceFamily: "JetBrains Mono"
    }
  });
  const rendered = resvg.render();
  const rawPixels = rendered.pixels;
  let physicalRgba;
  if (rotation === 90 || rotation === 270) {
    physicalRgba = rotatePortraitRgbaToPhysicalLcd(rawPixels, rotation);
  } else {
    physicalRgba = Buffer.from(rawPixels.buffer, rawPixels.byteOffset, rawPixels.byteLength);
  }
  if (params.brightnessPercent !== void 0 && params.brightnessPercent < 100) {
    return applyBrightnessScaleRgba(physicalRgba, params.brightnessPercent, LCD_W, LCD_H);
  }
  return physicalRgba;
}
function renderScreenToPngBuffer(params) {
  const rgba = renderScreenToRgbaBuffer(params);
  return encodePngRgba(rgba, LCD_W, LCD_H);
}

// src/server/telemetry.ts
import fs5 from "node:fs";
import http from "node:http";
import os2 from "node:os";
import { execFile as execFile2, spawn as spawn2 } from "node:child_process";
import { promisify as promisify2 } from "node:util";

// src/server/security.ts
import crypto3 from "node:crypto";
import dns from "node:dns/promises";
import fs4 from "node:fs";
import net from "node:net";
import os from "node:os";
import path4 from "node:path";
import { z } from "zod";
var MAX_UPLOAD_FILE_BYTES = 25 * 1024 * 1024;
var MAX_UPLOADS_TOTAL_BYTES = 250 * 1024 * 1024;
var MAX_PENDING_UPLOADS = 10;
var PENDING_UPLOAD_TTL_MS = 15 * 60 * 1e3;
var DEFAULT_UPSTREAM_MAX_BYTES = 2 * 1024 * 1024;
var SESSION_COOKIE_NAME = "aoostar_session";
function writeFileAtomic0600(filePath, content, keepBackup = true) {
  const dir = path4.dirname(filePath);
  fs4.mkdirSync(dir, { recursive: true, mode: 448 });
  const rand = crypto3.randomBytes(6).toString("hex");
  const tmpPath = `${filePath}.tmp.${process.pid}.${rand}`;
  let fd = null;
  try {
    fd = fs4.openSync(tmpPath, fs4.constants.O_WRONLY | fs4.constants.O_CREAT | fs4.constants.O_TRUNC, 384);
    const buf = typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content);
    let offset = 0;
    while (offset < buf.length) {
      offset += fs4.writeSync(fd, buf, offset, buf.length - offset);
    }
    fs4.fsyncSync(fd);
    fs4.closeSync(fd);
    fd = null;
    if (keepBackup && fs4.existsSync(filePath)) {
      try {
        const existing = fs4.readFileSync(filePath);
        if (existing.length > 0) {
          const bakTmp = `${filePath}.bak.tmp.${process.pid}.${rand}`;
          fs4.writeFileSync(bakTmp, existing, { mode: 384 });
          fs4.renameSync(bakTmp, `${filePath}.bak`);
          fs4.chmodSync(`${filePath}.bak`, 384);
        }
      } catch {
      }
    }
    fs4.renameSync(tmpPath, filePath);
    fs4.chmodSync(filePath, 384);
  } catch (err) {
    if (fd !== null) {
      try {
        fs4.closeSync(fd);
      } catch {
      }
    }
    try {
      if (fs4.existsSync(tmpPath)) fs4.unlinkSync(tmpPath);
    } catch {
    }
    throw err;
  }
}
function readJsonWithBackupFallback(filePath) {
  const tryParse = (p) => {
    if (!fs4.existsSync(p)) return null;
    const raw = fs4.readFileSync(p, "utf8");
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  };
  try {
    const primary = tryParse(filePath);
    if (primary !== null) {
      return { data: primary, recoveredFromBackup: false, error: null };
    }
  } catch (err) {
    const primaryErr = err instanceof Error ? err.message : String(err);
    const bakPath = `${filePath}.bak`;
    try {
      const backup = tryParse(bakPath);
      if (backup !== null) {
        console.warn(`[aoostar-config] Primary config corrupt (${primaryErr}); recovered from ${bakPath}`);
        return { data: backup, recoveredFromBackup: true, error: primaryErr };
      }
    } catch (bakErr) {
      return {
        data: null,
        recoveredFromBackup: false,
        error: `Primary (${primaryErr}) and backup (${bakErr instanceof Error ? bakErr.message : String(bakErr)}) unreadable`
      };
    }
    return { data: null, recoveredFromBackup: false, error: primaryErr };
  }
  try {
    const backup = tryParse(`${filePath}.bak`);
    if (backup !== null) {
      return { data: backup, recoveredFromBackup: true, error: null };
    }
  } catch {
  }
  return { data: null, recoveredFromBackup: false, error: null };
}
function safeTokenEqual(expected, provided) {
  if (!expected || !provided) return false;
  const hExpected = crypto3.createHash("sha256").update(expected).digest();
  const hProvided = crypto3.createHash("sha256").update(provided).digest();
  return crypto3.timingSafeEqual(hExpected, hProvided);
}
function extractBearerToken(req) {
  const auth = req.headers.authorization;
  if (typeof auth === "string") {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m && m[1].trim()) return m[1].trim();
  }
  const xToken = req.headers["x-api-token"];
  if (typeof xToken === "string" && xToken.trim()) return xToken.trim();
  return null;
}
function signSessionCookieValue(apiToken, ttlMs = 7 * 24 * 60 * 60 * 1e3) {
  const exp = Date.now() + ttlMs;
  const payload = String(exp);
  const sig = crypto3.createHmac("sha256", apiToken).update(`aoostar-session:${payload}`).digest("hex");
  return `${payload}.${sig}`;
}
function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    try {
      out[key] = decodeURIComponent(val);
    } catch {
      out[key] = val;
    }
  }
  return out;
}
function verifySessionCookieValue(apiToken, cookieHeader) {
  const cookies = parseCookies(cookieHeader);
  const raw = cookies[SESSION_COOKIE_NAME];
  if (!raw) return false;
  const dotIdx = raw.indexOf(".");
  if (dotIdx <= 0) return false;
  const payload = raw.slice(0, dotIdx);
  const sig = raw.slice(dotIdx + 1);
  const exp = Number(payload);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expectedSig = crypto3.createHmac("sha256", apiToken).update(`aoostar-session:${payload}`).digest("hex");
  return safeTokenEqual(expectedSig, sig);
}
function parseHostnameAndPort(rawHost) {
  const cleaned = rawHost.trim().toLowerCase();
  if (cleaned.startsWith("[")) {
    const endIdx = cleaned.indexOf("]");
    if (endIdx !== -1) {
      return {
        hostname: cleaned.slice(1, endIdx),
        hostLower: cleaned
      };
    }
  }
  const colonIdx = cleaned.lastIndexOf(":");
  if (colonIdx > 0 && !cleaned.includes("]")) {
    return {
      hostname: cleaned.slice(0, colonIdx),
      hostLower: cleaned
    };
  }
  return { hostname: cleaned, hostLower: cleaned };
}
function isIpLiteral(hostname) {
  return net.isIP(hostname) !== 0;
}
function isPrivateOrLocalIp(ip) {
  const clean = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (net.isIPv4(clean)) {
    const p = clean.split(".").map(Number);
    if (p.length !== 4) return false;
    if (p[0] === 127) return true;
    if (p[0] === 10) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 169 && p[1] === 254) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    return lower === "::1" || lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd");
  }
  return false;
}
function isAllowedHostHeader(req, bindHost, allowedHostsEnv = process.env.AOOSTAR_ALLOWED_HOSTS || "") {
  const rawHost = req.headers.host;
  if (!rawHost || typeof rawHost !== "string") return false;
  const { hostname, hostLower } = parseHostnameAndPort(rawHost);
  if (!hostname) return false;
  const allowlist = allowedHostsEnv.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (allowlist.includes(hostLower) || allowlist.includes(hostname)) {
    return true;
  }
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
    return true;
  }
  const localAddr = req.socket?.localAddress;
  if (localAddr) {
    const normalizedLocal = localAddr.startsWith("::ffff:") ? localAddr.slice(7) : localAddr;
    if (hostname === normalizedLocal.toLowerCase()) {
      return true;
    }
  }
  if (bindHost === "0.0.0.0" || bindHost === "::") {
    if (isIpLiteral(hostname) && isPrivateOrLocalIp(hostname)) {
      return true;
    }
    const sysHost = os.hostname().toLowerCase();
    if (hostname === sysHost || hostname === `${sysHost}.local` || /^[a-z0-9-]+\.local$/i.test(hostname)) {
      return true;
    }
  }
  if (process.env.DISABLE_HMR === "true" && (process.env.AOOSTAR_ALLOW_PROXY_HOSTS === "true" || hostname.endsWith(".run.app") || hostname.endsWith(".aistudio.google.com"))) {
    return true;
  }
  return false;
}
function validateOriginAndReferer(req, allowedHostsEnv = process.env.AOOSTAR_ALLOWED_HOSTS || "") {
  const hostHeader = (req.headers.host || "").toLowerCase();
  const trustProxy = process.env.AOOSTAR_TRUST_PROXY === "true" || process.env.DISABLE_HMR === "true";
  const rawForwardedHost = trustProxy ? req.headers["x-forwarded-host"] : void 0;
  const forwardedHost = typeof rawForwardedHost === "string" ? rawForwardedHost.split(",")[0].trim().toLowerCase() : Array.isArray(rawForwardedHost) && rawForwardedHost[0] ? rawForwardedHost[0].split(",")[0].trim().toLowerCase() : "";
  const forwardedHostname = forwardedHost ? parseHostnameAndPort(forwardedHost).hostname : "";
  const originHeader = req.headers.origin;
  const refererHeader = req.headers.referer;
  const allowlist = new Set(
    allowedHostsEnv.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean)
  );
  const matchesExpectedHost = (candidateHost, candidateHostname) => {
    if (candidateHost === hostHeader || allowlist.has(candidateHost) || allowlist.has(candidateHostname)) {
      return true;
    }
    if (forwardedHost && (candidateHost === forwardedHost || candidateHostname === forwardedHostname)) {
      return true;
    }
    return false;
  };
  if (originHeader !== void 0) {
    if (typeof originHeader !== "string" || originHeader === "null" || !originHeader.trim()) {
      return { ok: false, hasBrowserOrigin: true, reason: "Blocked null or empty Origin header (CSRF protection)" };
    }
    try {
      const originUrl = new URL(originHeader);
      if (originUrl.protocol !== "http:" && originUrl.protocol !== "https:") {
        return { ok: false, hasBrowserOrigin: true, reason: "Blocked unsupported Origin scheme" };
      }
      const originHost = originUrl.host.toLowerCase();
      const originHostname = originUrl.hostname.toLowerCase();
      if (matchesExpectedHost(originHost, originHostname)) {
        return { ok: true, hasBrowserOrigin: true };
      }
      return {
        ok: false,
        hasBrowserOrigin: true,
        reason: `Cross-origin request blocked: Origin (${originHost}) does not match Host (${forwardedHost || hostHeader})`
      };
    } catch {
      return { ok: false, hasBrowserOrigin: true, reason: "Malformed Origin header" };
    }
  }
  if (refererHeader && typeof refererHeader === "string") {
    try {
      const refUrl = new URL(refererHeader);
      const refHost = refUrl.host.toLowerCase();
      const refHostname = refUrl.hostname.toLowerCase();
      if (matchesExpectedHost(refHost, refHostname)) {
        return { ok: true, hasBrowserOrigin: true };
      }
      return {
        ok: false,
        hasBrowserOrigin: true,
        reason: `Cross-origin Referer blocked (${refHost} != ${forwardedHost || hostHeader})`
      };
    } catch {
      return { ok: false, hasBrowserOrigin: true, reason: "Malformed Referer header" };
    }
  }
  return { ok: true, hasBrowserOrigin: false };
}
function extractIndexHtmlInlineScriptHashes(indexHtmlPath) {
  try {
    if (!fs4.existsSync(indexHtmlPath)) return [];
    const html = fs4.readFileSync(indexHtmlPath, "utf8");
    const hashes = [];
    const scriptRegex = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = scriptRegex.exec(html)) !== null) {
      const body = m[1];
      if (body && body.trim()) {
        const digest = crypto3.createHash("sha256").update(body, "utf8").digest("base64");
        hashes.push(`'sha256-${digest}'`);
      }
    }
    return hashes;
  } catch {
    return [];
  }
}
function createSecurityHeadersMiddleware(inlineScriptHashes) {
  const scriptSrc = [`'self'`, ...inlineScriptHashes].join(" ");
  const allowIframePreview = process.env.DISABLE_HMR === "true";
  return (req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (req.path.startsWith("/uploads/")) {
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'none'; img-src 'self'; media-src 'self'; sandbox"
      );
      if (!allowIframePreview) res.setHeader("X-Frame-Options", "SAMEORIGIN");
      next();
      return;
    }
    if (req.path.startsWith("/api/")) {
      res.setHeader("Cache-Control", "no-store");
    }
    const frameDirective = allowIframePreview ? "" : "; frame-ancestors 'self'";
    if (!allowIframePreview) {
      res.setHeader("X-Frame-Options", "SAMEORIGIN");
    }
    res.setHeader(
      "Content-Security-Policy",
      `default-src 'self'; base-uri 'self'; object-src 'none'; script-src ${scriptSrc}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'${frameDirective}`
    );
    next();
  };
}
function createHostAndAuthMiddleware(params) {
  return (req, res, next) => {
    if (!isAllowedHostHeader(req, params.bindHost)) {
      res.status(403).json({
        error: "Forbidden: untrusted Host header (DNS rebinding protection). Configure AOOSTAR_ALLOWED_HOSTS if accessing via reverse proxy."
      });
      return;
    }
    const isApi = req.path.startsWith("/api/");
    const isUploadAsset = req.path.startsWith("/uploads/");
    if (!isApi && !isUploadAsset) {
      next();
      return;
    }
    const isStateChanging = !["GET", "HEAD", "OPTIONS"].includes(req.method.toUpperCase());
    if (isApi && isStateChanging) {
      const originCheck = validateOriginAndReferer(req);
      if (!originCheck.ok) {
        res.status(403).json({ error: originCheck.reason || "Cross-origin request blocked" });
        return;
      }
    }
    if (req.path === "/api/info") {
      next();
      return;
    }
    if (req.path === "/api/auth/status" && req.method.toUpperCase() === "GET") {
      next();
      return;
    }
    if ((req.path === "/api/auth/login" || req.path === "/api/auth/logout" || req.path === "/api/auth/session") && req.method.toUpperCase() === "POST") {
      next();
      return;
    }
    void (async () => {
      const bearer = extractBearerToken(req);
      let hasValidBearer = false;
      if (bearer !== null) {
        const clientIp = params.getClientIp(req);
        const rate = params.rateLimiter.check(clientIp);
        if (!rate.allowed) {
          res.setHeader("Retry-After", String(rate.retryAfterSec));
          res.status(429).json({
            error: `Too many failed authentication attempts. Try again in ${rate.retryAfterSec}s.`,
            retryAfterSec: rate.retryAfterSec
          });
          return;
        }
        if (params.verifyApiToken(bearer)) {
          params.rateLimiter.recordSuccess(clientIp);
          hasValidBearer = true;
        } else {
          const fail = params.rateLimiter.recordFailure(clientIp, "api-token");
          await params.rateLimiter.applyFailureDelay(fail.attemptsInWindow);
          if (fail.locked) {
            res.setHeader("Retry-After", String(fail.retryAfterSec));
            res.status(429).json({
              error: `Too many failed API token attempts. Try again in ${fail.retryAfterSec}s.`,
              retryAfterSec: fail.retryAfterSec
            });
            return;
          }
          res.status(401).json({
            error: "Unauthorized: invalid API token.",
            authRequired: true
          });
          return;
        }
      }
      const hasValidCookie = verifySessionCookieValue(params.getSessionSecret(), req.headers.cookie);
      if (!hasValidBearer && !hasValidCookie) {
        res.status(401).json({
          error: "Authentication required. Sign in with your Studio credentials or a valid API token.",
          authRequired: true
        });
        return;
      }
      if (!hasValidBearer && hasValidCookie && isStateChanging) {
        const originCheck = validateOriginAndReferer(req);
        if (!originCheck.hasBrowserOrigin) {
          res.status(403).json({
            error: "Forbidden: cookie-authenticated state change requires matching Origin/Referer or Bearer token."
          });
          return;
        }
      }
      next();
    })().catch(next);
  };
}
function maskConfigForClient(cfg) {
  return {
    ...cfg,
    integrations: {
      ...cfg.integrations,
      agentToken: "",
      agentTokenSet: Boolean(cfg.integrations.agentToken),
      haToken: "",
      haTokenSet: Boolean(cfg.integrations.haToken),
      customConnections: (cfg.integrations.customConnections || []).map((cc) => ({
        ...cc,
        token: "",
        tokenSet: Boolean(cc.token)
      }))
    }
  };
}
function mergeIncomingConfig(current, incoming) {
  const prevCustomById = new Map(
    (current.integrations.customConnections || []).map((cc) => [cc.id, cc])
  );
  let nextAgentToken = current.integrations.agentToken;
  if (incoming.integrations?.clearAgentToken) {
    nextAgentToken = "";
  } else if (typeof incoming.integrations?.agentToken === "string" && incoming.integrations.agentToken.trim() !== "") {
    nextAgentToken = incoming.integrations.agentToken.trim();
  }
  let nextHaToken = current.integrations.haToken;
  if (incoming.integrations?.clearHaToken) {
    nextHaToken = "";
  } else if (typeof incoming.integrations?.haToken === "string" && incoming.integrations.haToken.trim() !== "") {
    nextHaToken = incoming.integrations.haToken.trim();
  }
  const nextCustomConnections = Array.isArray(incoming.integrations?.customConnections) ? incoming.integrations.customConnections.map((cc) => {
    const prev = prevCustomById.get(cc.id);
    const nextTok = typeof cc.token === "string" && cc.token.trim() !== "" ? cc.token.trim() : prev?.token || "";
    return {
      ...cc,
      token: nextTok || void 0,
      tokenSet: Boolean(nextTok)
    };
  }) : current.integrations.customConnections;
  return {
    ...current,
    ...incoming,
    hardware: { ...current.hardware, ...incoming.hardware || {} },
    integrations: {
      ...current.integrations,
      ...incoming.integrations || {},
      agentToken: nextAgentToken,
      agentTokenSet: Boolean(nextAgentToken),
      clearAgentToken: void 0,
      haToken: nextHaToken,
      haTokenSet: Boolean(nextHaToken),
      clearHaToken: void 0,
      customConnections: nextCustomConnections
    },
    entityOverrides: incoming.entityOverrides ?? current.entityOverrides,
    dockerIcons: incoming.dockerIcons ?? current.dockerIcons,
    savedScreens: Array.isArray(incoming.savedScreens) ? incoming.savedScreens : current.savedScreens,
    customImages: Array.isArray(incoming.customImages) ? incoming.customImages : current.customImages,
    hardwareDeploy: current.hardwareDeploy
  };
}
function ipv4ToInt(ip) {
  const parts = ip.split(".").map(Number);
  return (parts[0] << 24 | parts[1] << 16 | parts[2] << 8 | parts[3]) >>> 0;
}
function ipv4InCidr(ip, cidrBase, prefixLen) {
  if (!net.isIPv4(ip) || !net.isIPv4(cidrBase)) return false;
  const mask = prefixLen === 0 ? 0 : ~0 << 32 - prefixLen >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(cidrBase) & mask);
}
function matchesAllowlist(hostname, ip, allowlistRaw) {
  const items = allowlistRaw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const hostLow = hostname.toLowerCase();
  const cleanIp = ip ? (ip.startsWith("::ffff:") ? ip.slice(7) : ip).toLowerCase() : null;
  for (const entry of items) {
    if (entry === hostLow) return true;
    if (cleanIp && entry === cleanIp) return true;
    if (cleanIp && entry.includes("/")) {
      const [base, bitsStr] = entry.split("/");
      const bits = Number(bitsStr);
      if (net.isIPv4(cleanIp) && net.isIPv4(base) && Number.isInteger(bits) && bits >= 0 && bits <= 32) {
        if (ipv4InCidr(cleanIp, base, bits)) return true;
      }
    }
  }
  return false;
}
function isBlockedSsrfIp(ipRaw, blockPrivateNets = false) {
  let ip = ipRaw.trim().toLowerCase();
  const zoneIdx = ip.indexOf("%");
  if (zoneIdx !== -1) ip = ip.slice(0, zoneIdx);
  if (ip.startsWith("::ffff:")) {
    ip = ip.slice(7);
  }
  if (net.isIPv4(ip)) {
    const p = ip.split(".").map(Number);
    if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
      return { blocked: true, reason: "Invalid IPv4 address" };
    }
    if (p[0] === 127) return { blocked: true, reason: `Loopback IP ${ip} is blocked` };
    if (p[0] === 0) return { blocked: true, reason: `Unspecified IP ${ip} is blocked` };
    if (p[0] === 169 && p[1] === 254) {
      return { blocked: true, reason: `Link-local / cloud metadata IP ${ip} is blocked` };
    }
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) {
      return { blocked: true, reason: `Carrier-grade NAT IP ${ip} is blocked` };
    }
    if (p[0] >= 224) return { blocked: true, reason: `Multicast / reserved IP ${ip} is blocked` };
    if (blockPrivateNets) {
      if (p[0] === 10 || p[0] === 172 && p[1] >= 16 && p[1] <= 31 || p[0] === 192 && p[1] === 168) {
        return { blocked: true, reason: `Private network IP ${ip} is blocked by AOOSTAR_BLOCK_PRIVATE_NETS` };
      }
    }
    return { blocked: false };
  }
  if (net.isIPv6(ip)) {
    if (ip === "::" || ip === "0:0:0:0:0:0:0:0") {
      return { blocked: true, reason: "Unspecified IPv6 address :: is blocked" };
    }
    if (ip === "::1" || ip === "0:0:0:0:0:0:0:1") {
      return { blocked: true, reason: "Loopback IPv6 address ::1 is blocked" };
    }
    if (ip.startsWith("fe8") || ip.startsWith("fe9") || ip.startsWith("fea") || ip.startsWith("feb")) {
      return { blocked: true, reason: `Link-local IPv6 address ${ip} is blocked` };
    }
    if (ip.startsWith("ff")) {
      return { blocked: true, reason: `Multicast IPv6 address ${ip} is blocked` };
    }
    if (blockPrivateNets && (ip.startsWith("fc") || ip.startsWith("fd"))) {
      return { blocked: true, reason: `Unique-local IPv6 address ${ip} is blocked` };
    }
    return { blocked: false };
  }
  return { blocked: true, reason: `Unrecognized IP format: ${ipRaw}` };
}
async function assertSafeOutboundUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error("Invalid URL format.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Unsupported URL scheme "${parsed.protocol}" \u2014 only http:// and https:// are allowed.`);
  }
  if (parsed.username || parsed.password) {
    throw new Error("URLs containing embedded credentials are not allowed.");
  }
  const allowlistRaw = process.env.AOOSTAR_SSRF_ALLOWLIST || "";
  const blockPrivateNets = process.env.AOOSTAR_BLOCK_PRIVATE_NETS === "true";
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!hostname) {
    throw new Error("URL hostname is missing.");
  }
  if (matchesAllowlist(hostname, isIpLiteral(hostname) ? hostname : null, allowlistRaw)) {
    return parsed;
  }
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("Loopback hostname localhost is blocked by SSRF policy.");
  }
  if (isIpLiteral(hostname)) {
    const check = isBlockedSsrfIp(hostname, blockPrivateNets);
    if (check.blocked) {
      throw new Error(check.reason || `Target IP ${hostname} is blocked by SSRF policy.`);
    }
    return parsed;
  }
  let resolved;
  try {
    resolved = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error(`DNS resolution failed for host "${hostname}".`);
  }
  if (!resolved || resolved.length === 0) {
    throw new Error(`DNS returned no addresses for host "${hostname}".`);
  }
  for (const addr of resolved) {
    if (matchesAllowlist(hostname, addr.address, allowlistRaw)) continue;
    const check = isBlockedSsrfIp(addr.address, blockPrivateNets);
    if (check.blocked) {
      throw new Error(check.reason || `Resolved address ${addr.address} is blocked by SSRF policy.`);
    }
  }
  return parsed;
}
async function safeOutboundFetch(rawUrl, options) {
  const timeoutMs = options?.timeoutMs ?? 2500;
  const maxBytes = options?.maxBytes ?? DEFAULT_UPSTREAM_MAX_BYTES;
  const maxRedirects = options?.maxRedirects ?? 3;
  let currentUrl = (await assertSafeOutboundUrl(rawUrl)).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const res = await fetch(currentUrl, {
        headers: options?.headers,
        signal: controller.signal,
        redirect: "manual"
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) {
          return { status: res.status, ok: false, bodyBuffer: Buffer.alloc(0), finalUrl: currentUrl };
        }
        if (hop === maxRedirects) {
          throw new Error("Too many upstream redirects.");
        }
        const nextUrl = new URL(location, currentUrl).toString();
        currentUrl = (await assertSafeOutboundUrl(nextUrl)).toString();
        continue;
      }
      const contentLength = Number(res.headers.get("content-length") || 0);
      if (contentLength > maxBytes) {
        throw new Error(`Upstream response exceeds ${maxBytes} byte limit.`);
      }
      const chunks = [];
      let total = 0;
      if (res.body) {
        const reader = res.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            total += value.byteLength;
            if (total > maxBytes) {
              await reader.cancel();
              throw new Error(`Upstream response exceeded ${maxBytes} byte limit.`);
            }
            chunks.push(Buffer.from(value));
          }
        }
      }
      return {
        status: res.status,
        ok: res.ok,
        bodyBuffer: Buffer.concat(chunks),
        finalUrl: currentUrl
      };
    }
    throw new Error("Too many upstream redirects.");
  } finally {
    clearTimeout(timer);
  }
}
function resolveRasterOrVideoType(mimeRaw, filename) {
  const mime = (mimeRaw || "").toLowerCase().trim();
  const lowerName = (filename || "").toLowerCase().trim();
  if (mime === "image/svg+xml" || lowerName.endsWith(".svg") || lowerName.endsWith(".svgz")) {
    return null;
  }
  if (mime === "image/png" || lowerName.endsWith(".png")) return { kind: "image", ext: "png" };
  if (mime === "image/jpeg" || mime === "image/jpg" || lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")) {
    return { kind: "image", ext: "jpg" };
  }
  if (mime === "image/gif" || lowerName.endsWith(".gif")) return { kind: "image", ext: "gif" };
  if (mime === "image/webp" || lowerName.endsWith(".webp")) return { kind: "image", ext: "webp" };
  if (mime === "image/avif" || lowerName.endsWith(".avif")) return { kind: "image", ext: "avif" };
  if (mime === "video/mp4" || lowerName.endsWith(".mp4")) return { kind: "video", ext: "mp4" };
  if (mime === "video/webm" || lowerName.endsWith(".webm")) return { kind: "video", ext: "webm" };
  return null;
}
function validateMediaMagicBytes(buf, expectedExt) {
  if (buf.length < 12) {
    return { ok: false, error: "Uploaded file is too small or empty to be a valid media file." };
  }
  const headText = Buffer.from(buf.subarray(0, Math.min(buf.length, 256))).toString("utf8").trimStart().toLowerCase();
  if (headText.startsWith("<svg") || headText.startsWith("<?xml") || headText.includes("<script")) {
    return { ok: false, error: "SVG or XML/HTML payloads are not permitted." };
  }
  switch (expectedExt) {
    case "png": {
      const sig = [137, 80, 78, 71, 13, 10, 26, 10];
      const match = sig.every((b, idx) => buf[idx] === b);
      return match ? { ok: true } : { ok: false, error: "File content does not match PNG magic header." };
    }
    case "jpg": {
      const match = buf[0] === 255 && buf[1] === 216 && buf[2] === 255;
      return match ? { ok: true } : { ok: false, error: "File content does not match JPEG magic header." };
    }
    case "gif": {
      const hdr = Buffer.from(buf.subarray(0, 6)).toString("ascii");
      const match = hdr === "GIF87a" || hdr === "GIF89a";
      return match ? { ok: true } : { ok: false, error: "File content does not match GIF87a/GIF89a header." };
    }
    case "webp": {
      const riff = Buffer.from(buf.subarray(0, 4)).toString("ascii");
      const webp = Buffer.from(buf.subarray(8, 12)).toString("ascii");
      return riff === "RIFF" && webp === "WEBP" ? { ok: true } : { ok: false, error: "File content does not match RIFF/WEBP header." };
    }
    case "avif": {
      const box = Buffer.from(buf.subarray(4, 12)).toString("ascii");
      return box === "ftypavif" || box === "ftypavis" || box === "ftypmif1" ? { ok: true } : { ok: false, error: "File content does not match AVIF ISO BMFF header." };
    }
    case "mp4": {
      const box = Buffer.from(buf.subarray(4, 8)).toString("ascii");
      return box === "ftyp" ? { ok: true } : { ok: false, error: "File content does not match MP4 ftyp header." };
    }
    case "webm": {
      const match = buf[0] === 26 && buf[1] === 69 && buf[2] === 223 && buf[3] === 163;
      return match ? { ok: true } : { ok: false, error: "File content does not match WebM EBML header." };
    }
  }
}
function getDirectorySizeBytes(dirPath) {
  if (!fs4.existsSync(dirPath)) return 0;
  let total = 0;
  for (const name of fs4.readdirSync(dirPath)) {
    try {
      const st = fs4.statSync(path4.join(dirPath, name));
      if (st.isFile()) total += st.size;
    } catch {
    }
  }
  return total;
}
var WidgetSchema = z.object({
  id: z.string().min(1).max(120),
  type: z.enum([
    "entity_number",
    "entity_list",
    "clock",
    "cpu_load",
    "memory_bar",
    "array_status",
    "docker_list",
    "active_tasks",
    "active_users",
    "disk_thermals",
    "ha_entity",
    "apex_area",
    "apex_radial",
    "apex_bar",
    "apex_hbar",
    "apex_custom",
    "custom_html",
    "image_layer",
    "custom_text",
    "divider"
  ]),
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().finite().positive(),
  h: z.number().finite().positive(),
  title: z.string().max(120),
  accentColor: z.string().max(32),
  textColor: z.string().max(32),
  bgColor: z.string().max(32),
  bgOpacity: z.number().min(0).max(1),
  borderOpacity: z.number().min(0).max(1),
  fontScale: z.number().min(0.4).max(4)
}).passthrough();
var LcdScreenSchema = z.object({
  id: z.string().min(1).max(120),
  name: z.string().min(1).max(120),
  enabled: z.boolean(),
  durationSec: z.number().min(1).max(3600),
  transition: z.enum(["cut", "fade", "slide"]),
  backgroundType: z.enum(["solid", "image"]),
  backgroundColor: z.string().max(32),
  backgroundImage: z.string().max(2048).optional(),
  backgroundDim: z.number().min(0).max(1),
  themeId: z.string().max(120).optional(),
  widgets: z.array(WidgetSchema).max(100)
}).passthrough();
var ConfigPatchSchema = z.object({
  screens: z.array(LcdScreenSchema).min(1).max(32).optional(),
  savedScreens: z.array(
    z.object({
      id: z.string().min(1).max(120),
      name: z.string().min(1).max(120),
      savedAt: z.string(),
      screen: LcdScreenSchema
    })
  ).max(64).optional(),
  activeScreenId: z.string().min(1).max(120).optional(),
  rotationEnabled: z.boolean().optional(),
  hardware: z.object({
    devicePath: z.string().max(260).optional(),
    baudRate: z.number().int().min(9600).max(4e6).optional(),
    brightness: z.number().min(1).max(100).optional(),
    rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
    autoPushEnabled: z.boolean().optional(),
    pushIntervalSec: z.number().min(1).max(3600).optional(),
    pollIntervalMs: z.number().min(500).max(6e4).optional(),
    sleepScheduleEnabled: z.boolean().optional(),
    sleepStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    sleepEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    sleepMode: z.enum(["off", "dim"]).optional(),
    sleepDimPercent: z.number().min(1).max(100).optional(),
    bootDisplayOff: z.boolean().optional(),
    powerOffOnEmergencyStop: z.boolean().optional(),
    serialWritesEnabled: z.boolean().optional()
  }).optional(),
  integrations: z.object({
    sourceMode: z.enum(["auto", "simulation", "local", "agent"]).optional(),
    agentEnabled: z.boolean().optional(),
    agentUrl: z.string().max(1024).optional(),
    agentToken: z.string().max(2048).optional(),
    clearAgentToken: z.boolean().optional(),
    haEnabled: z.boolean().optional(),
    haUrl: z.string().max(1024).optional(),
    haToken: z.string().max(2048).optional(),
    clearHaToken: z.boolean().optional(),
    customConnections: z.array(
      z.object({
        id: z.string().min(1).max(120),
        name: z.string().min(1).max(120),
        type: z.enum(["http_json", "prometheus_text", "unraid_agent"]),
        url: z.string().max(1024),
        token: z.string().max(2048).optional(),
        tokenSet: z.boolean().optional(),
        jsonPath: z.string().max(256).optional(),
        unit: z.string().max(32).optional(),
        enabled: z.boolean(),
        lastValue: z.string().optional(),
        lastError: z.string().optional()
      })
    ).max(32).optional()
  }).passthrough().optional(),
  entityOverrides: z.record(
    z.string().max(120),
    z.object({
      tag: z.string().max(120).optional(),
      unit: z.string().max(32).optional(),
      enabled: z.boolean().optional()
    })
  ).optional(),
  dockerIcons: z.record(z.string().max(120), z.string().max(2048)).optional(),
  customImages: z.array(
    z.object({
      id: z.string().min(1).max(120),
      name: z.string().max(120),
      url: z.string().max(1024),
      mediaType: z.enum(["image", "video"]).optional(),
      createdAt: z.string()
    })
  ).max(200).optional(),
  hardwareDeploy: z.object({
    deployed: z.boolean().optional(),
    deployedAt: z.string().nullable().optional(),
    activeIndex: z.number().int().min(0).optional(),
    currentScreenId: z.string().nullable().optional(),
    currentScreenName: z.string().nullable().optional(),
    isSleeping: z.boolean().optional(),
    effectiveBrightness: z.number().optional(),
    daemonState: z.string().optional(),
    lastError: z.string().nullable().optional(),
    screens: z.array(LcdScreenSchema).max(32).optional()
  }).passthrough().optional()
}).strict();
var UploadInitSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  mimeType: z.string().max(120).optional()
});
var UploadDataUrlSchema = z.object({
  name: z.string().max(200).optional(),
  dataUrl: z.string().min(16).max(36 * 1024 * 1024)
});
var TestAgentSchema = z.object({
  agentUrl: z.string().min(1).max(1024),
  agentToken: z.string().max(2048).optional()
});
var TestHaSchema = z.object({
  haUrl: z.string().min(1).max(1024),
  haToken: z.string().max(2048).optional()
});
var TestCustomSchema = z.object({
  url: z.string().min(1).max(1024),
  token: z.string().max(2048).optional(),
  jsonPath: z.string().max(256).optional()
});
var DeployRequestSchema = z.object({
  screens: z.array(LcdScreenSchema).min(1).max(32).optional(),
  rgbaBase64: z.string().max(4 * 1024 * 1024).optional(),
  activeScreenId: z.string().max(120).optional()
});
var PushFrameRequestSchema = z.object({
  rgbaBase64: z.string().max(4 * 1024 * 1024).optional(),
  screenId: z.string().max(120).optional(),
  screenName: z.string().max(120).optional()
});
var SafeTestRequestSchema = z.object({
  confirmed: z.literal(true),
  mode: z.enum(["display-on", "test-frame"]).default("test-frame"),
  rgbaBase64: z.string().max(4 * 1024 * 1024).optional()
});
var TaskTriggerSchema = z.object({
  taskId: z.string().min(1).max(120),
  action: z.enum(["start", "stop"])
});
var AuthSessionSchema = z.object({
  token: z.string().min(1).max(512)
});
var SerialWritesToggleSchema = z.object({
  enabled: z.boolean(),
  confirmed: z.boolean().optional()
});

// src/server/telemetry.ts
var execFileAsync2 = promisify2(execFile2);
var prevCpuSample = null;
var lastCpuSampleAt = 0;
var lastCpuPercent = 0;
var prevNetSample = null;
var prevRaplSample = null;
var prevIntelRc6Map = /* @__PURE__ */ new Map();
function parseProcStatLine() {
  try {
    const stat = fs5.readFileSync("/proc/stat", "utf8");
    const line = stat.split("\n")[0];
    const parts = line.trim().split(/\s+/).slice(1, 9).map((v) => Number.isFinite(Number(v)) ? Number(v) : 0);
    if (parts.length < 4) return null;
    const idle = (parts[3] || 0) + (parts[4] || 0);
    const total = parts.reduce((acc, v) => acc + v, 0);
    return { idle, total };
  } catch {
    return null;
  }
}
prevCpuSample = parseProcStatLine();
lastCpuSampleAt = prevCpuSample ? Date.now() : 0;
var historyBuffer = {
  timestamps: [],
  cpuSeries: [],
  ramSeries: [],
  netRxSeries: [],
  netTxSeries: []
};
var entityHistoryMap = /* @__PURE__ */ new Map();
function recordEntityHistory(id, val) {
  if (val === null || !Number.isFinite(val)) return;
  const arr = entityHistoryMap.get(id) ?? [];
  arr.push(Number(val.toFixed(2)));
  if (arr.length > 24) arr.shift();
  entityHistoryMap.set(id, arr);
}
function pushHistoryPoint(cpu, ram, rx, tx) {
  const label = (/* @__PURE__ */ new Date()).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
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
var taskOverrides = {};
function triggerTaskState(taskId, action) {
  if (action === "start") {
    taskOverrides[taskId] = {
      status: "running",
      progressPercent: 12,
      speedText: taskId === "task-parity" ? "218 MB/s" : taskId === "task-mover" ? "485 MB/s" : "310 MB/s",
      etaText: taskId === "task-parity" ? "14h 22m" : "6m 40s"
    };
  } else {
    taskOverrides[taskId] = {
      status: "idle",
      progressPercent: 100,
      speedText: "Completed",
      etaText: "-"
    };
  }
}
function readCpuPercentFromProc() {
  const now = Date.now();
  if (lastCpuSampleAt > 0 && now - lastCpuSampleAt < 450 && prevCpuSample) {
    return lastCpuPercent;
  }
  const cur = parseProcStatLine();
  if (!cur) return lastCpuPercent;
  if (!prevCpuSample) {
    prevCpuSample = cur;
    lastCpuSampleAt = now;
    const load1 = os2.loadavg()[0];
    lastCpuPercent = Math.min(100, Math.max(0, Math.round(load1 / Math.max(1, os2.cpus().length) * 100)));
    return lastCpuPercent;
  }
  const diffIdle = cur.idle - prevCpuSample.idle;
  const diffTotal = cur.total - prevCpuSample.total;
  if (diffTotal <= 0) {
    return lastCpuPercent;
  }
  prevCpuSample = cur;
  lastCpuSampleAt = now;
  lastCpuPercent = Math.min(100, Math.max(0, Math.round((diffTotal - diffIdle) / diffTotal * 100)));
  return lastCpuPercent;
}
function readProcMemInfo() {
  try {
    const raw = fs5.readFileSync("/proc/meminfo", "utf8");
    const map = {};
    for (const line of raw.split("\n")) {
      const m = line.match(/^(\w+):\s+(\d+)\s+kB/);
      if (m) map[m[1]] = Number(m[2]) * 1024;
    }
    const total = map.MemTotal || os2.totalmem();
    const cached = (map.Cached || 0) + (map.Buffers || 0) + (map.SReclaimable || 0);
    const available = map.MemAvailable !== void 0 ? map.MemAvailable : (map.MemFree || 0) + cached;
    const swapTotal = map.SwapTotal || 0;
    const swapFree = map.SwapFree || 0;
    return {
      total,
      used: Math.max(0, total - available),
      cached,
      swapTotal,
      swapUsed: Math.max(0, swapTotal - swapFree)
    };
  } catch {
    const total = os2.totalmem();
    const free = os2.freemem();
    return { total, used: total - free, cached: 0, swapTotal: 0, swapUsed: 0 };
  }
}
function readLocalNetworkStats() {
  const ifaces = [];
  let totalRxBytes = 0;
  let totalTxBytes = 0;
  try {
    const procNet = fs5.readFileSync("/proc/net/dev", "utf8");
    const lines = procNet.split("\n").slice(2);
    const osIfaces = os2.networkInterfaces();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("lo:")) continue;
      const [namePart, dataPart] = trimmed.split(":");
      if (!dataPart) continue;
      const name = namePart.trim();
      const cols = dataPart.trim().split(/\s+/).map(Number);
      const rxBytes = cols[0] || 0;
      const txBytes = cols[8] || 0;
      totalRxBytes += rxBytes;
      totalTxBytes += txBytes;
      const addrInfo = osIfaces[name]?.find((a) => a.family === "IPv4");
      ifaces.push({
        name,
        linkSpeedMbps: 1e3,
        ipAddress: addrInfo?.address || "0.0.0.0",
        rxMbps: 0,
        txMbps: 0,
        rxTotalGB: Number((rxBytes / 1024 ** 3).toFixed(2)),
        txTotalGB: Number((txBytes / 1024 ** 3).toFixed(2))
      });
    }
  } catch {
  }
  const now = Date.now();
  let rxMbps = 0;
  let txMbps = 0;
  if (prevNetSample && now > prevNetSample.timestamp) {
    const dtSec = (now - prevNetSample.timestamp) / 1e3;
    rxMbps = Math.max(0, (totalRxBytes - prevNetSample.rxBytes) * 8 / (dtSec * 1e6));
    txMbps = Math.max(0, (totalTxBytes - prevNetSample.txBytes) * 8 / (dtSec * 1e6));
  }
  prevNetSample = { rxBytes: totalRxBytes, txBytes: totalTxBytes, timestamp: now };
  if (ifaces.length > 0) {
    ifaces[0].rxMbps = Number(rxMbps.toFixed(2));
    ifaces[0].txMbps = Number(txMbps.toFixed(2));
  }
  return { rxMbps, txMbps, interfaces: ifaces };
}
function readLocalCpuDetails() {
  let model = os2.cpus()[0]?.model?.trim() || "x86_64 Processor";
  let cores = os2.cpus().length;
  let freqMhz = null;
  try {
    const cpuinfo = fs5.readFileSync("/proc/cpuinfo", "utf8");
    const freqs = [];
    let procCount = 0;
    for (const line of cpuinfo.split("\n")) {
      const mModel = line.match(/^model name\s*:\s*(.+)$/i);
      if (mModel && mModel[1].trim()) {
        model = mModel[1].trim().replace(/\s+/g, " ");
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
  }
  try {
    const cpufreqBase = "/sys/devices/system/cpu/cpufreq";
    if (fs5.existsSync(cpufreqBase)) {
      const policies = fs5.readdirSync(cpufreqBase).filter((d) => d.startsWith("policy"));
      const policyFreqs = [];
      for (const p of policies) {
        const pFile = `${cpufreqBase}/${p}/scaling_cur_freq`;
        if (fs5.existsSync(pFile)) {
          const khz = Number(fs5.readFileSync(pFile, "utf8").trim());
          if (Number.isFinite(khz) && khz > 0) policyFreqs.push(khz / 1e3);
        }
      }
      if (policyFreqs.length > 0) {
        freqMhz = Math.round(policyFreqs.reduce((a, b) => a + b, 0) / policyFreqs.length);
      }
    }
    if (freqMhz === null) {
      const cpu0Freq = "/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq";
      if (fs5.existsSync(cpu0Freq)) {
        const khz = Number(fs5.readFileSync(cpu0Freq, "utf8").trim());
        if (Number.isFinite(khz) && khz > 0) freqMhz = Math.round(khz / 1e3);
      }
    }
  } catch {
  }
  return { model, cores, freqMhz };
}
var hostCliCache = {
  updatedAt: 0,
  sensors: null,
  nvidiaGpus: [],
  nvidiaAvailable: false,
  intelGpuTop: null,
  intelGpuTopAvailable: false,
  radeonTop: null,
  radeonTopAvailable: false
};
var cliProbeInFlight = null;
var toolBinaryAvailable = /* @__PURE__ */ new Map();
function hasBinaryInPath(bin) {
  const cached = toolBinaryAvailable.get(bin);
  if (cached !== void 0) return cached;
  const searchDirs = (process.env.PATH || "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin").split(":");
  let found = false;
  for (const dir of searchDirs) {
    if (!dir) continue;
    try {
      const full = `${dir}/${bin}`;
      if (fs5.existsSync(full)) {
        found = true;
        break;
      }
    } catch {
    }
  }
  toolBinaryAvailable.set(bin, found);
  return found;
}
function detectDrmVendors() {
  let hasIntel = false;
  let hasAmd = false;
  try {
    const drmBase = "/sys/class/drm";
    if (!fs5.existsSync(drmBase)) return { hasIntel, hasAmd };
    for (const card of fs5.readdirSync(drmBase)) {
      if (!/^card\d+$/.test(card)) continue;
      const vendor = (readSysfsText(`${drmBase}/${card}/device/vendor`) || "").toLowerCase();
      if (vendor === "0x8086") hasIntel = true;
      if (vendor === "0x1002") hasAmd = true;
    }
  } catch {
  }
  return { hasIntel, hasAmd };
}
function slugSensorPart(raw) {
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
async function probeSensorsJson() {
  if (!hasBinaryInPath("sensors")) return null;
  try {
    const { stdout } = await execFileAsync2("sensors", ["-j"], { encoding: "utf8", timeout: 1400 });
    const parsed = JSON.parse(stdout);
    const temps = [];
    const fans = [];
    const rawSensors = [];
    let cpuPowerW = null;
    let amdGpuTempC = null;
    let amdGpuPowerW = null;
    for (const [chipFull, chipObj] of Object.entries(parsed)) {
      if (!chipObj || typeof chipObj !== "object") continue;
      const chipLower = chipFull.toLowerCase();
      const chipShort = chipFull.split("-")[0] || chipFull;
      for (const [featureName, featureVal] of Object.entries(chipObj)) {
        if (featureName === "Adapter" || !featureVal || typeof featureVal !== "object") continue;
        const sub = featureVal;
        let maxTempC = 85;
        for (const [subKey, rawNum] of Object.entries(sub)) {
          if (typeof rawNum !== "number" || !Number.isFinite(rawNum)) continue;
          if (/^temp\d+_max$/.test(subKey) || /^temp\d+_crit$/.test(subKey)) {
            if (rawNum > 20 && rawNum < 150) maxTempC = Number(rawNum.toFixed(1));
          }
        }
        for (const [subKey, rawNum] of Object.entries(sub)) {
          if (typeof rawNum !== "number" || !Number.isFinite(rawNum)) continue;
          if (/^temp\d+_input$/.test(subKey)) {
            if (rawNum <= -50 || rawNum >= 150) continue;
            const tempC = Number(rawNum.toFixed(1));
            const sid = `sensor.${slugSensorPart(chipShort)}.${slugSensorPart(featureName)}`;
            temps.push({
              id: sid,
              chipName: chipLower,
              label: featureName,
              tempC,
              highC: maxTempC
            });
            rawSensors.push({
              id: sid,
              chip: chipFull,
              label: `${chipShort} ${featureName}`,
              value: tempC,
              unit: "\xB0C"
            });
            if (chipLower.includes("amdgpu") && (amdGpuTempC === null || /edge|junction/i.test(featureName))) {
              amdGpuTempC = tempC;
            }
          } else if (/^fan\d+_input$/.test(subKey)) {
            const rpm = Math.round(rawNum);
            const sid = `sensor.${slugSensorPart(chipShort)}.${slugSensorPart(featureName)}`;
            fans.push({
              id: sid,
              label: `${chipShort} ${featureName}`,
              rpm,
              pwmPercent: Math.min(100, Math.round(rpm / 2400 * 100))
            });
            rawSensors.push({
              id: sid,
              chip: chipFull,
              label: `${chipShort} ${featureName}`,
              value: rpm,
              unit: "RPM"
            });
          } else if (/^power\d+_(average|input)$/.test(subKey)) {
            const watts = Number(rawNum.toFixed(1));
            const sid = `sensor.${slugSensorPart(chipShort)}.${slugSensorPart(featureName)}`;
            rawSensors.push({
              id: sid,
              chip: chipFull,
              label: `${chipShort} ${featureName}`,
              value: watts,
              unit: "W"
            });
            if (cpuPowerW === null && (chipLower.includes("energy") || chipLower.includes("zenergy") || chipLower.includes("zenpower") || chipLower.includes("k10temp") || chipLower.includes("coretemp"))) {
              cpuPowerW = watts;
            }
            if (chipLower.includes("amdgpu") && (amdGpuPowerW === null || /ppt/i.test(featureName))) {
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
      amdGpuPowerW
    };
  } catch {
    return null;
  }
}
async function probeNvidiaSmi() {
  if (!hasBinaryInPath("nvidia-smi")) return { available: false, gpus: [] };
  try {
    const { stdout } = await execFileAsync2(
      "nvidia-smi",
      [
        "--query-gpu=name,temperature.gpu,utilization.gpu,memory.used,memory.total,power.draw,clocks.current.graphics",
        "--format=csv,noheader,nounits"
      ],
      { encoding: "utf8", timeout: 1200 }
    );
    const gpus = [];
    const lines = stdout.trim().split("\n").filter(Boolean);
    lines.forEach((line, idx) => {
      const parts = line.split(",").map((s) => s.trim());
      if (parts.length < 5) return;
      const parseMaybe = (v) => {
        if (!v || v === "[N/A]" || v === "N/A") return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };
      gpus.push({
        id: `nvidia-${idx}`,
        name: parts[0] || `NVIDIA GPU ${idx}`,
        vendor: "nvidia",
        tempC: parseMaybe(parts[1]),
        utilPercent: parseMaybe(parts[2]),
        vramUsedMB: parseMaybe(parts[3]),
        vramTotalMB: parseMaybe(parts[4]),
        powerW: parseMaybe(parts[5]),
        freqMhz: parseMaybe(parts[6])
      });
    });
    return { available: true, gpus };
  } catch {
    return { available: false, gpus: [] };
  }
}
async function probeIntelGpuTop() {
  if (!hasBinaryInPath("intel_gpu_top")) return { available: false, data: null };
  return new Promise((resolve) => {
    let stdout = "";
    let settled = false;
    const child = spawn2("intel_gpu_top", ["-J", "-s", "250"], { stdio: ["ignore", "pipe", "ignore"] });
    const finish = (available, data) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill("SIGINT");
      } catch {
      }
      resolve({ available, data });
    };
    const timer = setTimeout(() => {
      const parsed = tryExtractIntelJson(stdout);
      finish(Boolean(parsed), parsed);
    }, 750);
    child.on("error", () => finish(false, null));
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      const parsed = tryExtractIntelJson(stdout);
      if (parsed) finish(true, parsed);
    });
    child.on("exit", () => {
      const parsed = tryExtractIntelJson(stdout);
      finish(Boolean(parsed), parsed);
    });
  });
}
function tryExtractIntelJson(raw) {
  const cleaned = raw.trim().replace(/^\[/, "").replace(/^,/, "");
  let depth = 0;
  let start = -1;
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        const slice = cleaned.slice(start, i + 1);
        try {
          const obj = JSON.parse(slice);
          const busyVals = Object.values(obj.engines || {}).map((e) => typeof e?.busy === "number" ? e.busy : 0).filter((n) => Number.isFinite(n));
          const maxBusy = busyVals.length > 0 ? Math.round(Math.max(...busyVals)) : null;
          const freqMhz = typeof obj.frequency?.actual === "number" ? Math.round(obj.frequency.actual) : null;
          const rawPower = obj.power?.GPU ?? obj.power?.Package;
          const powerW = typeof rawPower === "number" ? Number(rawPower.toFixed(1)) : null;
          return { utilPercent: maxBusy, freqMhz, powerW };
        } catch {
        }
      }
    }
  }
  return null;
}
async function probeRadeonTop() {
  if (!hasBinaryInPath("radeontop")) return { available: false, data: null };
  try {
    const { stdout } = await execFileAsync2("radeontop", ["-d", "-", "-l", "1"], {
      encoding: "utf8",
      timeout: 1200
    });
    const line = stdout.trim().split("\n").pop() || "";
    const gpuMatch = line.match(/gpu\s+([\d.]+)%/i);
    const vramMatch = line.match(/vram\s+[\d.]+%\s+([\d.]+)mb/i);
    const sclkMatch = line.match(/sclk\s+([\d.]+)(ghz|mhz)/i);
    let freqMhz = null;
    if (sclkMatch) {
      const val = Number(sclkMatch[1]);
      freqMhz = sclkMatch[2].toLowerCase() === "ghz" ? Math.round(val * 1e3) : Math.round(val);
    }
    return {
      available: true,
      data: {
        utilPercent: gpuMatch ? Math.round(Number(gpuMatch[1])) : null,
        vramUsedMB: vramMatch ? Math.round(Number(vramMatch[1])) : null,
        freqMhz
      }
    };
  } catch {
    return { available: false, data: null };
  }
}
async function refreshHostCliCacheIfNeeded() {
  const now = Date.now();
  if (now - hostCliCache.updatedAt < 2e3 && hostCliCache.updatedAt > 0) {
    return;
  }
  if (cliProbeInFlight) {
    await cliProbeInFlight;
    return;
  }
  cliProbeInFlight = (async () => {
    try {
      const { hasIntel, hasAmd } = detectDrmVendors();
      const [sensorsRes, nvidiaRes, intelRes, radeonRes] = await Promise.all([
        probeSensorsJson(),
        probeNvidiaSmi(),
        hasIntel ? probeIntelGpuTop() : Promise.resolve({ available: false, data: null }),
        hasAmd ? probeRadeonTop() : Promise.resolve({ available: false, data: null })
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
function readLocalHwmon() {
  const temps = [];
  const fans = [];
  const rawSensors = [];
  let hwmonCpuPowerW = null;
  const cliSensors = hostCliCache.sensors;
  if (cliSensors?.available) {
    temps.push(...cliSensors.temps);
    fans.push(...cliSensors.fans);
    rawSensors.push(...cliSensors.rawSensors);
    hwmonCpuPowerW = cliSensors.cpuPowerW;
  }
  try {
    const base = "/sys/class/hwmon";
    if (fs5.existsSync(base)) {
      for (const dir of fs5.readdirSync(base)) {
        const fullDir = `${base}/${dir}`;
        let chipName = dir;
        try {
          chipName = fs5.readFileSync(`${fullDir}/name`, "utf8").trim().toLowerCase();
        } catch {
        }
        const files = fs5.readdirSync(fullDir);
        for (const file of files) {
          if (/^temp\d+_input$/.test(file)) {
            const idx = file.match(/\d+/)?.[0] || "1";
            try {
              const milli = Number(fs5.readFileSync(`${fullDir}/${file}`, "utf8").trim());
              if (!Number.isFinite(milli) || milli <= -5e4 || milli >= 15e4) continue;
              let label = `${chipName} temp${idx}`;
              try {
                label = fs5.readFileSync(`${fullDir}/temp${idx}_label`, "utf8").trim();
              } catch {
              }
              const alreadyFromCli = temps.some(
                (t) => t.chipName.startsWith(chipName) && t.label.toLowerCase() === label.toLowerCase()
              );
              const tempC = Number((milli / 1e3).toFixed(1));
              if (!alreadyFromCli) {
                const sid = `sensor.${slugSensorPart(chipName)}.${slugSensorPart(label || `temp${idx}`)}`;
                temps.push({
                  id: sid,
                  chipName,
                  label,
                  tempC,
                  highC: 85
                });
                rawSensors.push({
                  id: sid,
                  chip: chipName,
                  label: `${chipName} ${label}`,
                  value: tempC,
                  unit: "\xB0C"
                });
              }
            } catch {
            }
          }
          if (/^fan\d+_input$/.test(file)) {
            const idx = file.match(/\d+/)?.[0] || "1";
            try {
              const rpm = Number(fs5.readFileSync(`${fullDir}/${file}`, "utf8").trim());
              if (Number.isFinite(rpm)) {
                const fanLabel = `${chipName} Fan ${idx}`;
                const alreadyFromCli = fans.some((f) => f.label.toLowerCase().includes(`${chipName} fan${idx}`));
                if (!alreadyFromCli && !cliSensors?.available) {
                  const sid = `sensor.${slugSensorPart(chipName)}.fan${idx}`;
                  fans.push({
                    id: sid,
                    label: fanLabel,
                    rpm,
                    pwmPercent: Math.min(100, Math.round(rpm / 2400 * 100))
                  });
                  rawSensors.push({
                    id: sid,
                    chip: chipName,
                    label: fanLabel,
                    value: rpm,
                    unit: "RPM"
                  });
                }
              }
            } catch {
            }
          }
          if (hwmonCpuPowerW === null && (chipName.includes("energy") || chipName.includes("zenergy") || chipName.includes("zenpower") || chipName.includes("k10temp") || chipName.includes("coretemp")) && /^power\d+_(average|input)$/.test(file)) {
            try {
              const uw = Number(fs5.readFileSync(`${fullDir}/${file}`, "utf8").trim());
              if (Number.isFinite(uw) && uw > 0) {
                hwmonCpuPowerW = Number((uw / 1e6).toFixed(1));
              }
            } catch {
            }
          }
        }
      }
    }
  } catch {
  }
  let thermalPkgTemp = null;
  let thermalAcpiTemp = null;
  try {
    const tzBase = "/sys/class/thermal";
    if (fs5.existsSync(tzBase)) {
      for (const dir of fs5.readdirSync(tzBase)) {
        if (!dir.startsWith("thermal_zone")) continue;
        const fullDir = `${tzBase}/${dir}`;
        try {
          const type = fs5.readFileSync(`${fullDir}/type`, "utf8").trim().toLowerCase();
          const milli = Number(fs5.readFileSync(`${fullDir}/temp`, "utf8").trim());
          if (Number.isFinite(milli) && milli > 0 && milli < 15e4) {
            const c = Number((milli / 1e3).toFixed(1));
            if (type.includes("pkg") || type.includes("cpu") || type.includes("tctl")) {
              thermalPkgTemp ??= c;
            } else if (type.includes("acpitz")) {
              thermalAcpiTemp ??= c;
            }
            if (!temps.some((t) => t.label.toLowerCase() === type)) {
              temps.push({ id: dir, chipName: type, label: type, tempC: c, highC: 90 });
            }
          }
        } catch {
        }
      }
    }
  } catch {
  }
  const pickTemp = (pred) => {
    const hit = temps.find(pred);
    return hit ? hit.tempC : null;
  };
  const cpuTempC = pickTemp(
    (t) => (t.chipName.includes("k10temp") || t.chipName.includes("zenpower") || t.chipName.includes("ryzen")) && /tctl|tdie|tccd/i.test(t.label)
  ) ?? pickTemp((t) => t.chipName.includes("k10temp") || t.chipName.includes("zenpower")) ?? pickTemp((t) => t.chipName.includes("coretemp") && /package|pkg|core\s*0/i.test(t.label)) ?? pickTemp((t) => t.chipName.includes("coretemp")) ?? pickTemp(
    (t) => (t.chipName.startsWith("nct") || t.chipName.startsWith("it8") || t.chipName.startsWith("f71")) && /cpu|peci|cputin/i.test(t.label)
  ) ?? thermalPkgTemp ?? thermalAcpiTemp ?? pickTemp((t) => !t.chipName.includes("nvme") && !t.chipName.includes("amdgpu") && !t.chipName.includes("nouveau")) ?? temps[0]?.tempC ?? null;
  return { temps, fans, rawSensors, cpuTempC, hwmonCpuPowerW };
}
function readRaplPowerWatts() {
  try {
    let raplDir = "/sys/class/powercap/intel-rapl:0";
    if (!fs5.existsSync(`${raplDir}/energy_uj`)) {
      const base = "/sys/class/powercap";
      if (fs5.existsSync(base)) {
        for (const d of fs5.readdirSync(base)) {
          const candidate = `${base}/${d}`;
          const energyFile = `${candidate}/energy_uj`;
          if (!fs5.existsSync(energyFile)) continue;
          const domainName = readSysfsText(`${candidate}/name`) || "";
          if (domainName.includes("package") || d.endsWith(":0")) {
            raplDir = candidate;
            break;
          }
        }
      }
    }
    const raplPath = `${raplDir}/energy_uj`;
    if (!fs5.existsSync(raplPath)) return null;
    const energyUj = Number(fs5.readFileSync(raplPath, "utf8").trim());
    const now = Date.now();
    if (!Number.isFinite(energyUj) || energyUj <= 0) return null;
    if (!prevRaplSample || now <= prevRaplSample.timestamp) {
      prevRaplSample = { energyUj, timestamp: now };
      return null;
    }
    let deltaUj = energyUj - prevRaplSample.energyUj;
    if (deltaUj < 0) {
      const maxPath = `${raplDir}/max_energy_range_uj`;
      const maxUj = fs5.existsSync(maxPath) ? Number(fs5.readFileSync(maxPath, "utf8").trim()) : 0;
      deltaUj = maxUj > 0 ? maxUj - prevRaplSample.energyUj + energyUj : 0;
    }
    const dtSec = (now - prevRaplSample.timestamp) / 1e3;
    prevRaplSample = { energyUj, timestamp: now };
    if (dtSec <= 0 || deltaUj <= 0) return null;
    const watts = deltaUj / 1e6 / dtSec;
    return watts > 0 && watts < 600 ? Number(watts.toFixed(1)) : null;
  } catch {
    return null;
  }
}
function readSysfsText(filePath) {
  try {
    if (!fs5.existsSync(filePath)) return null;
    return fs5.readFileSync(filePath, "utf8").trim();
  } catch {
    return null;
  }
}
function readSysfsNumber(filePath) {
  const txt = readSysfsText(filePath);
  if (!txt) return null;
  const n = Number(txt);
  return Number.isFinite(n) ? n : null;
}
function readLocalGpus() {
  const gpus = [...hostCliCache.nvidiaGpus];
  try {
    const drmBase = "/sys/class/drm";
    if (fs5.existsSync(drmBase)) {
      const cards = fs5.readdirSync(drmBase).filter((d) => /^card\d+$/.test(d)).sort();
      for (const card of cards) {
        const devDir = `${drmBase}/${card}/device`;
        if (!fs5.existsSync(devDir)) continue;
        const vendorHex = (readSysfsText(`${devDir}/vendor`) || "").toLowerCase();
        const deviceHex = (readSysfsText(`${devDir}/device`) || "").toLowerCase();
        const uevent = readSysfsText(`${devDir}/uevent`) || "";
        const driverMatch = uevent.match(/^DRIVER=(.+)$/m);
        const driver = driverMatch ? driverMatch[1].trim().toLowerCase() : "";
        const pciIdMatch = uevent.match(/^PCI_ID=([0-9A-Fa-f:]+)$/m);
        const pciId = pciIdMatch ? pciIdMatch[1].toUpperCase() : "";
        if (vendorHex === "0x10de" && gpus.some((g) => g.vendor === "nvidia")) {
          continue;
        }
        const vendor = vendorHex === "0x1002" ? "amd" : vendorHex === "0x8086" ? "intel" : vendorHex === "0x10de" ? "nvidia" : "unknown";
        let tempC = null;
        let powerW = null;
        let freqMhz = null;
        try {
          const hwmonDir = `${devDir}/hwmon`;
          if (fs5.existsSync(hwmonDir)) {
            for (const hw of fs5.readdirSync(hwmonDir)) {
              const p = `${hwmonDir}/${hw}`;
              const t1 = readSysfsNumber(`${p}/temp1_input`);
              if (t1 !== null && t1 > -5e4 && t1 < 15e4) {
                tempC = Number((t1 / 1e3).toFixed(1));
              }
              const pw = readSysfsNumber(`${p}/power1_average`) ?? readSysfsNumber(`${p}/power1_input`);
              if (pw !== null && pw > 0) {
                powerW = Number((pw / 1e6).toFixed(1));
              }
              const fq = readSysfsNumber(`${p}/freq1_input`);
              if (fq !== null && fq > 0) {
                freqMhz = Math.round(fq / 1e6);
              }
            }
          }
        } catch {
        }
        let utilPercent = readSysfsNumber(`${devDir}/gpu_busy_percent`);
        const vramUsedBytes = readSysfsNumber(`${devDir}/mem_info_vram_used`);
        const vramTotalBytes = readSysfsNumber(`${devDir}/mem_info_vram_total`);
        let vramUsedMB = vramUsedBytes !== null ? Math.round(vramUsedBytes / (1024 * 1024)) : null;
        const vramTotalMB = vramTotalBytes !== null ? Math.round(vramTotalBytes / (1024 * 1024)) : null;
        if (vendor === "amd") {
          if (freqMhz === null) {
            const dpm = readSysfsText(`${devDir}/pp_dpm_sclk`);
            const activeLine = dpm?.split("\n").find((l) => l.includes("*"));
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
        if (vendor === "intel") {
          freqMhz = hostCliCache.intelGpuTop?.freqMhz ?? freqMhz ?? readSysfsNumber(`${drmBase}/${card}/gt_cur_freq_mhz`) ?? readSysfsNumber(`${drmBase}/${card}/gt/gt0/rps_cur_freq_mhz`) ?? readSysfsNumber(`${drmBase}/${card}/tile0/gt0/freq0/cur_freq`);
          powerW = hostCliCache.intelGpuTop?.powerW ?? powerW;
          utilPercent = hostCliCache.intelGpuTop?.utilPercent ?? utilPercent;
          if (utilPercent === null) {
            const rc6Ms = readSysfsNumber(`${drmBase}/${card}/gt/gt0/rc6_residency_ms`) ?? readSysfsNumber(`${drmBase}/${card}/power/rc6_residency_ms`);
            if (rc6Ms !== null) {
              const now = Date.now();
              const prev = prevIntelRc6Map.get(card);
              if (prev && now > prev.timestamp && rc6Ms >= prev.rc6Ms) {
                const dt = now - prev.timestamp;
                const dRc6 = rc6Ms - prev.rc6Ms;
                utilPercent = Math.max(0, Math.min(100, Math.round(100 - dRc6 / dt * 100)));
              }
              prevIntelRc6Map.set(card, { rc6Ms, timestamp: now });
            }
          }
        }
        let name = readSysfsText(`${devDir}/product_name`) || readSysfsText(`${devDir}/label`);
        if (!name) {
          if (vendor === "amd") {
            name = pciId === "1002:15BF" || pciId === "1002:1900" || pciId === "1002:15C8" ? "AMD Radeon 780M Graphics" : `AMD Radeon GPU (${deviceHex || driver || "amdgpu"})`;
          } else if (vendor === "intel") {
            name = `Intel Graphics (${deviceHex || driver || "i915"})`;
          } else if (vendor === "nvidia") {
            name = `NVIDIA GPU (${deviceHex || "nouveau"})`;
          } else {
            name = `GPU ${card} (${driver || pciId || "drm"})`;
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
          vramTotalMB
        });
      }
    }
  } catch {
  }
  return gpus;
}
async function readLocalDockerSocket() {
  const sockPath = "/var/run/docker.sock";
  if (!fs5.existsSync(sockPath)) return [];
  return new Promise((resolve) => {
    const req = http.request(
      {
        socketPath: sockPath,
        path: "/containers/json?all=1",
        method: "GET",
        timeout: 1200
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          try {
            const list = JSON.parse(body);
            resolve(
              list.map((c) => ({
                id: c.Id.slice(0, 12),
                name: (c.Names?.[0] || c.Id.slice(0, 12)).replace(/^\//, ""),
                image: c.Image,
                state: c.State === "running" ? "running" : c.State === "paused" ? "paused" : "exited",
                statusText: c.Status,
                cpuPercent: 0,
                memUsedMB: 0,
                memLimitMB: 0,
                ports: c.Ports?.filter((p) => p.PublicPort).map((p) => String(p.PublicPort)).slice(0, 3).join(", ") || "-",
                updateAvailable: false
              }))
            );
          } catch {
            resolve([]);
          }
        });
      }
    );
    req.on("error", () => resolve([]));
    req.end();
  });
}
async function readLocalDisks() {
  const disks = [];
  let totalBytes = 0;
  let usedBytes = 0;
  let freeBytes = 0;
  try {
    let output = "";
    try {
      const res = await execFileAsync2("df", ["-kP", "-x", "tmpfs", "-x", "devtmpfs", "-x", "overlay"], {
        encoding: "utf8",
        timeout: 1500
      });
      output = res.stdout;
    } catch {
      const res = await execFileAsync2("df", ["-kP"], { encoding: "utf8", timeout: 1500 });
      output = res.stdout;
    }
    const lines = output.trim().split("\n").slice(1);
    const seen = /* @__PURE__ */ new Set();
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
      if (mount === "/" || mount.startsWith("/mnt")) {
        totalBytes += sizeK;
        usedBytes += usedK;
        freeBytes += availK;
      }
      disks.push({
        id: `local-${disks.length}`,
        name: mount === "/" ? "Root Filesystem" : mount,
        device: fsName,
        role: mount.includes("cache") ? "cache" : "data",
        model: "Linux Block Volume",
        sizeBytes: sizeK,
        usedBytes: usedK,
        tempC: 36,
        smartStatus: "PASSED",
        spinState: "active",
        readMBps: 0,
        writeMBps: 0,
        errors: 0
      });
    }
  } catch {
  }
  return { disks, totalBytes, usedBytes, freeBytes };
}
function readUnraidEmhttpVars() {
  const vars = {};
  try {
    const varPath = "/var/local/emhttp/var.ini";
    if (!fs5.existsSync(varPath)) return vars;
    const raw = fs5.readFileSync(varPath, "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^([^=]+)="?(.*?)"?$/);
      if (m) vars[m[1].trim()] = m[2].trim();
    }
  } catch {
  }
  return vars;
}
function readUnraidDisksIni() {
  const disks = [];
  try {
    const iniPath = "/var/local/emhttp/disks.ini";
    if (!fs5.existsSync(iniPath)) return disks;
    const raw = fs5.readFileSync(iniPath, "utf8");
    let currentSection = "";
    let current = {};
    const flush = () => {
      if (!currentSection || !current.device) return;
      const status = (current.status || "").toUpperCase();
      if (status === "DISK_NP" || status === "DISK_NP_DSBL") return;
      const name = current.name || currentSection;
      const role = name.startsWith("parity") ? "parity" : name.startsWith("cache") || (current.fsType || "").includes("zfs") ? name.startsWith("cache") ? "cache" : "zfs" : "data";
      const sizeBytes = (Number(current.size || 0) || 0) * 1024;
      const fsSizeBytes = (Number(current.fsSize || 0) || 0) * 1024;
      const fsFreeBytes = (Number(current.fsFree || 0) || 0) * 1024;
      const usedBytes = fsSizeBytes > 0 ? Math.max(0, fsSizeBytes - fsFreeBytes) : 0;
      const tempNum = Number(current.temp);
      const color = (current.color || "").toLowerCase();
      disks.push({
        id: name,
        name: name.charAt(0).toUpperCase() + name.slice(1),
        device: `/dev/${current.device}`,
        role,
        model: (current.id || current.model || "Unraid Drive").trim(),
        sizeBytes: fsSizeBytes || sizeBytes,
        usedBytes,
        tempC: Number.isFinite(tempNum) && tempNum > 0 ? tempNum : 0,
        smartStatus: Number(current.numErrors || 0) > 0 ? "WARNING" : "PASSED",
        spinState: color.includes("blink") ? "standby" : "active",
        readMBps: 0,
        writeMBps: 0,
        errors: Number(current.numErrors || 0) || 0
      });
    };
    for (const line of raw.split("\n")) {
      const sec = line.match(/^\[(?:"([^"]+)"|([^\]]+))\]/);
      if (sec) {
        flush();
        currentSection = (sec[1] || sec[2] || "").trim();
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
  }
  return disks;
}
async function readSmbSessions() {
  try {
    const { stdout } = await execFileAsync2("smbstatus", ["-b", "--json"], { encoding: "utf8", timeout: 1200 });
    const parsed = JSON.parse(stdout);
    if (!parsed.sessions) return [];
    return Object.entries(parsed.sessions).map(([id, s]) => ({
      id,
      username: s.username || "smbuser",
      protocol: "SMB3_11",
      clientIp: s.remote_machine || "LAN",
      shareOrPath: "/mnt/user",
      openFiles: 1,
      durationSec: 60,
      throughputMBps: 0
    }));
  } catch {
    return [];
  }
}
async function getLocalHostTelemetry(haConnected) {
  await refreshHostCliCacheIfNeeded();
  const cpuPercent = readCpuPercentFromProc();
  const cpuDetails = readLocalCpuDetails();
  const mem = readProcMemInfo();
  const net3 = readLocalNetworkStats();
  const hwmon = readLocalHwmon();
  const raplWatts = readRaplPowerWatts();
  const gpus = readLocalGpus();
  const emhttp = readUnraidEmhttpVars();
  const emhttpDisks = readUnraidDisksIni();
  const [containers, localDisks, sessions] = await Promise.all([
    readLocalDockerSocket(),
    readLocalDisks(),
    readSmbSessions()
  ]);
  const ramPct = mem.total > 0 ? Math.round(mem.used / mem.total * 100) : 0;
  pushHistoryPoint(cpuPercent, ramPct, net3.rxMbps, net3.txMbps);
  const isUnraidHost = Object.keys(emhttp).length > 0 || emhttpDisks.length > 0;
  const disks = emhttpDisks.length > 0 ? emhttpDisks : localDisks.disks;
  const arrayDataDisks = emhttpDisks.filter((d) => d.role === "data");
  const totalBytes = arrayDataDisks.length > 0 ? arrayDataDisks.reduce((a, d) => a + d.sizeBytes, 0) : localDisks.totalBytes;
  const usedBytes = arrayDataDisks.length > 0 ? arrayDataDisks.reduce((a, d) => a + d.usedBytes, 0) : localDisks.usedBytes;
  const freeBytes = Math.max(0, totalBytes - usedBytes);
  const cpuTempC = hwmon.cpuTempC ?? 0;
  const cpuPowerW = raplWatts ?? hwmon.hwmonCpuPowerW ?? Number((12 + cpuPercent * 0.4).toFixed(1));
  const collectorTools = ["procfs", "sysfs"];
  if (isUnraidHost) collectorTools.push("emhttp");
  if (hostCliCache.sensors?.available) collectorTools.push("lm-sensors");
  if (hostCliCache.nvidiaAvailable) collectorTools.push("nvidia-smi");
  if (hostCliCache.intelGpuTopAvailable) collectorTools.push("intel_gpu_top");
  if (hostCliCache.radeonTopAvailable) collectorTools.push("radeontop");
  const mdResync = Number(emhttp.mdResync || 0);
  const mdResyncPos = Number(emhttp.mdResyncPos || 0);
  const mdResyncSize = Number(emhttp.mdResyncSize || 0);
  const parityProgressPercent = mdResync > 0 && mdResyncSize > 0 ? Math.min(100, Math.max(0, Number((mdResyncPos / mdResyncSize * 100).toFixed(1)))) : 0;
  const moverRunning = fs5.existsSync("/var/run/mover.pid");
  const localTasks = [];
  if (mdResync > 0) {
    localTasks.push({
      id: "task-parity",
      name: "Unraid Parity Sync / Check",
      category: "parity",
      status: "running",
      progressPercent: parityProgressPercent,
      speedText: emhttp.mdResyncSpeed ? `${emhttp.mdResyncSpeed}` : "Running",
      etaText: "Active",
      schedule: "Array Maintenance",
      lastRun: "In progress"
    });
  }
  if (moverRunning) {
    localTasks.push({
      id: "task-mover",
      name: "Unraid Mover",
      category: "mover",
      status: "running",
      progressPercent: 50,
      speedText: "Moving",
      etaText: "Active",
      schedule: "Scheduled",
      lastRun: "In progress"
    });
  }
  return {
    timestamp: Date.now(),
    sourceMode: "local",
    sourceLabel: isUnraidHost ? `Local Unraid Host (${collectorTools.join(" + ")})` : `Local Linux Host (${collectorTools.join(" + ")})`,
    isRealUnraidHost: isUnraidHost || fs5.existsSync("/var/run/docker.sock"),
    agentConnected: false,
    haConnected,
    collectorTools,
    system: {
      hostname: emhttp.NAME || os2.hostname(),
      unraidVersion: emhttp.version ? `Unraid OS ${emhttp.version}` : `${os2.type()} ${os2.release()}`,
      kernel: os2.release(),
      uptimeSeconds: Math.floor(os2.uptime()),
      cpuModel: cpuDetails.model,
      cpuCores: cpuDetails.cores,
      cpuPercent,
      cpuFreqMhz: cpuDetails.freqMhz,
      cpuTempC,
      cpuPowerW,
      loadAvg: os2.loadavg().map((v) => Number(v.toFixed(2))),
      ramTotalBytes: mem.total,
      ramUsedBytes: mem.used,
      ramCachedBytes: mem.cached,
      swapTotalBytes: mem.swapTotal,
      swapUsedBytes: mem.swapUsed
    },
    array: {
      state: mdResync > 0 ? "PARITY_SYNC" : emhttp.mdState === "STOPPED" ? "STOPPED" : "STARTED",
      parityValid: emhttp.mdResync === "0" || !emhttp.mdResync,
      parityCheckRunning: mdResync > 0,
      parityProgressPercent,
      totalBytes,
      usedBytes,
      freeBytes,
      moverRunning
    },
    history: {
      timestamps: [...historyBuffer.timestamps],
      cpuSeries: [...historyBuffer.cpuSeries],
      ramSeries: [...historyBuffer.ramSeries],
      netRxSeries: [...historyBuffer.netRxSeries],
      netTxSeries: [...historyBuffer.netTxSeries]
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
      model: "No UPS detected on host",
      status: "ONLINE",
      loadPercent: 0,
      batteryPercent: 100,
      runtimeMinutes: 0,
      inputVoltage: 0,
      nominalPowerW: 0,
      currentPowerW: 0
    },
    fans: hwmon.fans,
    temps: hwmon.temps.map(({ id, label, tempC, highC }) => ({ id, label, tempC, highC })),
    network: net3.interfaces,
    gpus,
    sensors: hwmon.rawSensors
  };
}
async function fetchJsonWithTimeout(url, token) {
  try {
    const headers = { Accept: "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await safeOutboundFetch(url, {
      headers,
      timeoutMs: 2200,
      maxBytes: 2 * 1024 * 1024
    });
    if (!res.ok) return null;
    return JSON.parse(res.bodyBuffer.toString("utf8"));
  } catch {
    return null;
  }
}
async function fetchAgentTelemetry(agentUrl, agentToken, haConnected) {
  const base = agentUrl.replace(/\/+$/, "");
  const health = await fetchJsonWithTimeout(`${base}/api/v1/health`, agentToken);
  if (!health) return null;
  const [systemRaw, arrayRaw, dockerRaw, vmsRaw, upsRaw, netRaw, disksRaw, sharesRaw, zfsRaw] = await Promise.all([
    fetchJsonWithTimeout(`${base}/api/v1/system`, agentToken),
    fetchJsonWithTimeout(`${base}/api/v1/array`, agentToken),
    fetchJsonWithTimeout(`${base}/api/v1/docker`, agentToken),
    fetchJsonWithTimeout(`${base}/api/v1/vms`, agentToken),
    fetchJsonWithTimeout(`${base}/api/v1/ups`, agentToken),
    fetchJsonWithTimeout(`${base}/api/v1/network`, agentToken),
    fetchJsonWithTimeout(`${base}/api/v1/disks`, agentToken),
    fetchJsonWithTimeout(`${base}/api/v1/shares`, agentToken),
    fetchJsonWithTimeout(`${base}/api/v1/zfs`, agentToken)
  ]);
  const sys = systemRaw || {};
  const arr = arrayRaw || {};
  const ups = upsRaw || {};
  const cpuPercent = Number(sys.cpu_usage_percent ?? sys.cpu_percent ?? 18);
  const ramTotalBytes = Number(sys.ram_total_bytes ?? 64 * 1024 ** 3);
  const ramUsedBytes = Number(sys.ram_used_bytes ?? 24 * 1024 ** 3);
  const ramPct = ramTotalBytes > 0 ? Math.round(ramUsedBytes / ramTotalBytes * 100) : 0;
  const netList = Array.isArray(netRaw) ? netRaw.map((n) => ({
    name: String(n.name ?? "eth0"),
    linkSpeedMbps: Number(n.speed_mbps ?? 1e3),
    ipAddress: String(n.ip_address ?? "192.168.1.50"),
    rxMbps: Number(n.rx_mbps ?? 0),
    txMbps: Number(n.tx_mbps ?? 0),
    rxTotalGB: Number(n.rx_gb ?? 0),
    txTotalGB: Number(n.tx_gb ?? 0),
    sfpTempC: n.sfp_temp_c ? Number(n.sfp_temp_c) : void 0
  })) : [];
  const rxTotal = netList.reduce((acc, n) => acc + n.rxMbps, 0);
  const txTotal = netList.reduce((acc, n) => acc + n.txMbps, 0);
  pushHistoryPoint(cpuPercent, ramPct, rxTotal, txTotal);
  const disks = Array.isArray(disksRaw) ? disksRaw.map((d, i) => ({
    id: String(d.id ?? `disk-${i}`),
    name: String(d.name ?? `disk${i}`),
    device: String(d.device ?? `/dev/sd${String.fromCharCode(97 + i)}`),
    role: String(d.role ?? "data").toLowerCase(),
    model: String(d.model ?? "Unknown Drive"),
    sizeBytes: Number(d.size_bytes ?? 0),
    usedBytes: Number(d.used_bytes ?? 0),
    tempC: Number(d.temperature_c ?? d.temp ?? 35),
    smartStatus: String(d.smart_status ?? "PASSED"),
    spinState: d.spin_state === "standby" ? "standby" : "active",
    readMBps: Number(d.read_mbps ?? 0),
    writeMBps: Number(d.write_mbps ?? 0),
    errors: Number(d.errors ?? 0)
  })) : [];
  const containers = Array.isArray(dockerRaw) ? dockerRaw.map((c) => ({
    id: String(c.id ?? c.name ?? "container"),
    name: String(c.name ?? "container"),
    image: String(c.image ?? "unknown"),
    state: c.state === "running" ? "running" : "exited",
    statusText: String(c.status ?? c.state ?? "unknown"),
    cpuPercent: Number(c.cpu_percent ?? 0),
    memUsedMB: Number(c.memory_used_mb ?? 0),
    memLimitMB: Number(c.memory_limit_mb ?? 2048),
    ports: String(c.ports ?? "-"),
    updateAvailable: Boolean(c.update_available)
  })) : [];
  const vms = Array.isArray(vmsRaw) ? vmsRaw.map((v) => ({
    id: String(v.id ?? v.name ?? "vm"),
    name: String(v.name ?? "VM"),
    state: v.state === "running" ? "running" : "shutoff",
    vcpus: Number(v.vcpus ?? 2),
    memoryMB: Number(v.memory_mb ?? 4096),
    cpuPercent: Number(v.cpu_percent ?? 0)
  })) : [];
  const shares = Array.isArray(sharesRaw) ? sharesRaw.map((s) => ({
    name: String(s.name ?? "share"),
    usedBytes: Number(s.used_bytes ?? 0),
    freeBytes: Number(s.free_bytes ?? 0),
    cachePolicy: String(s.cache_policy ?? "Yes"),
    smbExported: Boolean(s.smb_exported ?? true)
  })) : [];
  const zfsPools = Array.isArray(zfsRaw) ? zfsRaw.map((z3) => ({
    name: String(z3.name ?? "tank"),
    health: String(z3.health ?? "ONLINE"),
    sizeBytes: Number(z3.size_bytes ?? 0),
    usedBytes: Number(z3.used_bytes ?? 0),
    arcHitRatio: Number(z3.arc_hit_ratio ?? 94.2),
    dedupRatio: Number(z3.dedup_ratio ?? 1)
  })) : [];
  return {
    timestamp: Date.now(),
    sourceMode: "agent",
    sourceLabel: `Unraid Management Agent (${base})`,
    isRealUnraidHost: true,
    agentConnected: true,
    haConnected,
    system: {
      hostname: String(sys.hostname ?? "Unraid-Server"),
      unraidVersion: String(sys.unraid_version ?? "Unraid OS 7.0.1"),
      kernel: String(sys.kernel ?? "6.6.68-Unraid"),
      uptimeSeconds: Number(sys.uptime_seconds ?? 86400),
      cpuModel: String(sys.cpu_model ?? "AMD Ryzen 7 PRO 8845HS"),
      cpuCores: Number(sys.cpu_cores ?? 16),
      cpuPercent,
      cpuTempC: Number(sys.cpu_temp_c ?? 46),
      cpuPowerW: Number(sys.cpu_power_w ?? 28.4),
      loadAvg: Array.isArray(sys.load_avg) ? sys.load_avg : [0.85, 0.72, 0.64],
      ramTotalBytes,
      ramUsedBytes,
      ramCachedBytes: Number(sys.ram_cached_bytes ?? 14 * 1024 ** 3),
      swapTotalBytes: Number(sys.swap_total_bytes ?? 0),
      swapUsedBytes: Number(sys.swap_used_bytes ?? 0)
    },
    array: {
      state: String(arr.state ?? "STARTED"),
      parityValid: Boolean(arr.parity_valid ?? true),
      parityCheckRunning: Boolean(arr.parity_check_running ?? false),
      parityProgressPercent: Number(arr.parity_progress_percent ?? 0),
      totalBytes: Number(arr.total_bytes ?? 72 * 1024 ** 4),
      usedBytes: Number(arr.used_bytes ?? 41 * 1024 ** 4),
      freeBytes: Number(arr.free_bytes ?? 31 * 1024 ** 4),
      moverRunning: Boolean(arr.mover_running ?? false)
    },
    history: {
      timestamps: [...historyBuffer.timestamps],
      cpuSeries: [...historyBuffer.cpuSeries],
      ramSeries: [...historyBuffer.ramSeries],
      netRxSeries: [...historyBuffer.netRxSeries],
      netTxSeries: [...historyBuffer.netTxSeries]
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
      model: String(ups.model ?? "UPS"),
      status: String(ups.status ?? "ONLINE"),
      loadPercent: Number(ups.load_percent ?? 0),
      batteryPercent: Number(ups.battery_percent ?? 100),
      runtimeMinutes: Number(ups.runtime_minutes ?? 0),
      inputVoltage: Number(ups.input_voltage ?? 230),
      nominalPowerW: Number(ups.nominal_power_w ?? 900),
      currentPowerW: Number(ups.current_power_w ?? 0)
    },
    fans: [],
    temps: [],
    network: netList,
    gpus: []
  };
}
function getSimulationTelemetry(haConnected) {
  const t = Date.now() / 1e3;
  const realCpu = readCpuPercentFromProc();
  const cpuPercent = Math.round(realCpu * 0.4 + 20 + Math.sin(t * 0.45) * 8);
  const ramTotalBytes = 64 * 1024 ** 3;
  const ramUsedBytes = Math.round((38.4 + Math.sin(t * 0.15) * 0.8) * 1024 ** 3);
  const ramCachedBytes = 18.6 * 1024 ** 3;
  const ramPct = Math.round(ramUsedBytes / ramTotalBytes * 100);
  const rxMbps = Number((142 + Math.sin(t * 0.6) * 48 + Math.cos(t * 1.3) * 18).toFixed(1));
  const txMbps = Number((38 + Math.cos(t * 0.5) * 14).toFixed(1));
  pushHistoryPoint(cpuPercent, ramPct, rxMbps, txMbps);
  for (const id of Object.keys(taskOverrides)) {
    if (taskOverrides[id].status === "running") {
      taskOverrides[id].progressPercent = taskOverrides[id].progressPercent >= 99 ? 4 : Number((taskOverrides[id].progressPercent + 0.4).toFixed(1));
    }
  }
  const disks = [
    {
      id: "parity1",
      name: "Parity",
      device: "/dev/sdb",
      role: "parity",
      model: "Seagate Exos X20 18TB",
      sizeBytes: 18 * 1024 ** 4,
      usedBytes: 0,
      tempC: 37,
      smartStatus: "PASSED",
      spinState: "active",
      readMBps: 18.4,
      writeMBps: 42.1,
      errors: 0
    },
    {
      id: "disk1",
      name: "Disk 1",
      device: "/dev/sdc",
      role: "data",
      model: "Seagate Exos X20 18TB",
      sizeBytes: 18 * 1024 ** 4,
      usedBytes: 14.2 * 1024 ** 4,
      tempC: 36,
      smartStatus: "PASSED",
      spinState: "active",
      readMBps: 64.2,
      writeMBps: 12,
      errors: 0
    },
    {
      id: "disk2",
      name: "Disk 2",
      device: "/dev/sdd",
      role: "data",
      model: "Seagate Exos X20 18TB",
      sizeBytes: 18 * 1024 ** 4,
      usedBytes: 13.8 * 1024 ** 4,
      tempC: 38,
      smartStatus: "PASSED",
      spinState: "active",
      readMBps: 22.8,
      writeMBps: 18.5,
      errors: 0
    },
    {
      id: "disk3",
      name: "Disk 3",
      device: "/dev/sde",
      role: "data",
      model: "WD Ultrastar HC550 18TB",
      sizeBytes: 18 * 1024 ** 4,
      usedBytes: 11.4 * 1024 ** 4,
      tempC: 35,
      smartStatus: "PASSED",
      spinState: "active",
      readMBps: 0.4,
      writeMBps: 0.2,
      errors: 0
    },
    {
      id: "disk4",
      name: "Disk 4",
      device: "/dev/sdf",
      role: "data",
      model: "WD Ultrastar HC550 18TB",
      sizeBytes: 18 * 1024 ** 4,
      usedBytes: 6.1 * 1024 ** 4,
      tempC: 29,
      smartStatus: "PASSED",
      spinState: "standby",
      readMBps: 0,
      writeMBps: 0,
      errors: 0
    },
    {
      id: "nvme0",
      name: "Cache NVMe 1",
      device: "/dev/nvme0n1",
      role: "cache",
      model: "WD Red SN700 2TB",
      sizeBytes: 2 * 1024 ** 4,
      usedBytes: 0.84 * 1024 ** 4,
      tempC: 44,
      smartStatus: "PASSED",
      spinState: "active",
      readMBps: 412,
      writeMBps: 188.5,
      errors: 0
    },
    {
      id: "nvme1",
      name: "ZFS Pool NVMe",
      device: "/dev/nvme1n1",
      role: "zfs",
      model: "Samsung 990 PRO 4TB",
      sizeBytes: 4 * 1024 ** 4,
      usedBytes: 2.15 * 1024 ** 4,
      tempC: 46,
      smartStatus: "PASSED",
      spinState: "active",
      readMBps: 290.1,
      writeMBps: 94.3,
      errors: 0
    }
  ];
  const containers = [
    {
      id: "c-plex",
      name: "plex",
      image: "lscr.io/linuxserver/plex:1.41.3",
      state: "running",
      statusText: "Up 14 days (healthy)",
      cpuPercent: Number((8.4 + Math.sin(t * 0.7) * 3.1).toFixed(1)),
      memUsedMB: 2140,
      memLimitMB: 8192,
      ports: "32400",
      updateAvailable: false
    },
    {
      id: "c-ha",
      name: "homeassistant",
      image: "ghcr.io/home-assistant/home-assistant:2026.11",
      state: "running",
      statusText: "Up 14 days (healthy)",
      cpuPercent: 3.2,
      memUsedMB: 1180,
      memLimitMB: 4096,
      ports: "8123",
      updateAvailable: false
    },
    {
      id: "c-immich",
      name: "immich-server",
      image: "ghcr.io/immich-app/immich-server:v1.124",
      state: "running",
      statusText: "Up 6 days (healthy)",
      cpuPercent: 5.1,
      memUsedMB: 1890,
      memLimitMB: 8192,
      ports: "2283",
      updateAvailable: true
    },
    {
      id: "c-frigate",
      name: "frigate",
      image: "ghcr.io/blakeblackshear/frigate:0.15.0",
      state: "running",
      statusText: "Up 14 days",
      cpuPercent: 6.8,
      memUsedMB: 1620,
      memLimitMB: 4096,
      ports: "5000, 8554",
      updateAvailable: false
    },
    {
      id: "c-traefik",
      name: "traefik",
      image: "traefik:v3.2",
      state: "running",
      statusText: "Up 14 days",
      cpuPercent: 0.4,
      memUsedMB: 142,
      memLimitMB: 1024,
      ports: "80, 443",
      updateAvailable: false
    }
  ];
  const sessions = [
    {
      id: "sess-1",
      username: "joshua",
      protocol: "SMB3_11",
      clientIp: "192.168.1.42",
      shareOrPath: "/mnt/user/media",
      openFiles: 3,
      durationSec: 4920,
      throughputMBps: 112.4
    },
    {
      id: "sess-2",
      username: "timemachine",
      protocol: "SMB3_11",
      clientIp: "192.168.1.88",
      shareOrPath: "/mnt/user/backups",
      openFiles: 1,
      durationSec: 1285,
      throughputMBps: 64.8
    }
  ];
  const tasks = [
    {
      id: "task-backup",
      name: "Appdata Backup (CA Backup v2)",
      category: "backup",
      status: taskOverrides["task-backup"]?.status ?? "running",
      progressPercent: taskOverrides["task-backup"]?.progressPercent ?? 64,
      speedText: taskOverrides["task-backup"]?.speedText ?? "312 MB/s",
      etaText: taskOverrides["task-backup"]?.etaText ?? "4m 18s",
      schedule: "Daily 03:00",
      lastRun: "In progress"
    },
    {
      id: "task-parity",
      name: "Monthly Parity Check (Non-Correcting)",
      category: "parity",
      status: taskOverrides["task-parity"]?.status ?? "scheduled",
      progressPercent: taskOverrides["task-parity"]?.progressPercent ?? 0,
      speedText: taskOverrides["task-parity"]?.speedText ?? "Avg 218 MB/s",
      etaText: taskOverrides["task-parity"]?.etaText ?? "Scheduled",
      schedule: "1st of Month 00:00",
      lastRun: "21 days ago (0 errors)"
    },
    {
      id: "task-mover",
      name: "Unraid Mover (Cache -> Array)",
      category: "mover",
      status: taskOverrides["task-mover"]?.status ?? "idle",
      progressPercent: taskOverrides["task-mover"]?.progressPercent ?? 100,
      speedText: taskOverrides["task-mover"]?.speedText ?? "485 MB/s",
      etaText: taskOverrides["task-mover"]?.etaText ?? "Idle",
      schedule: "Hourly (>70% cache)",
      lastRun: "42m ago (38.4 GB moved)"
    }
  ];
  const parityRunning = tasks.find((tk) => tk.id === "task-parity")?.status === "running";
  const moverRunning = tasks.find((tk) => tk.id === "task-mover")?.status === "running";
  return {
    timestamp: Date.now(),
    sourceMode: "auto",
    sourceLabel: "Local Server Stats (Host + Unraid Profile)",
    isRealUnraidHost: false,
    agentConnected: false,
    haConnected,
    system: {
      hostname: "WTR-MAX-UNRAID",
      unraidVersion: "Unraid OS 7.0.1",
      kernel: "6.6.68-Unraid",
      uptimeSeconds: 1219420,
      cpuModel: "AMD Ryzen 7 PRO 8845HS (16T)",
      cpuCores: 16,
      cpuPercent,
      cpuTempC: Math.round(48 + Math.sin(t * 0.3) * 3),
      cpuPowerW: Number((26.4 + cpuPercent * 0.42).toFixed(1)),
      loadAvg: [Number((cpuPercent / 20).toFixed(2)), 1.18, 0.96],
      ramTotalBytes,
      ramUsedBytes,
      ramCachedBytes,
      swapTotalBytes: 0,
      swapUsedBytes: 0
    },
    array: {
      state: parityRunning ? "PARITY_SYNC" : "STARTED",
      parityValid: true,
      parityCheckRunning: parityRunning,
      parityProgressPercent: tasks.find((tk) => tk.id === "task-parity")?.progressPercent ?? 0,
      totalBytes: 72 * 1024 ** 4,
      usedBytes: 45.5 * 1024 ** 4,
      freeBytes: 26.5 * 1024 ** 4,
      moverRunning
    },
    history: {
      timestamps: [...historyBuffer.timestamps],
      cpuSeries: [...historyBuffer.cpuSeries],
      ramSeries: [...historyBuffer.ramSeries],
      netRxSeries: [...historyBuffer.netRxSeries],
      netTxSeries: [...historyBuffer.netTxSeries]
    },
    disks,
    zfsPools: [
      {
        name: "nvme_fast",
        health: "ONLINE",
        sizeBytes: 4 * 1024 ** 4,
        usedBytes: 2.15 * 1024 ** 4,
        arcHitRatio: 96.4,
        dedupRatio: 1
      }
    ],
    shares: [
      { name: "media", usedBytes: 34.2 * 1024 ** 4, freeBytes: 26.5 * 1024 ** 4, cachePolicy: "Yes", smbExported: true },
      { name: "backups", usedBytes: 8.6 * 1024 ** 4, freeBytes: 26.5 * 1024 ** 4, cachePolicy: "Yes", smbExported: true }
    ],
    containers,
    vms: [],
    sessions,
    tasks,
    ups: {
      connected: true,
      model: "CyberPower CP1500PFCLCD",
      status: "ONLINE",
      loadPercent: 18,
      batteryPercent: 100,
      runtimeMinutes: 47,
      inputVoltage: 234.2,
      nominalPowerW: 900,
      currentPowerW: 162
    },
    fans: [
      { id: "fan-1", label: "Chassis Rear 120mm", rpm: 1180, pwmPercent: 48 },
      { id: "fan-2", label: "Drive Cage Fan", rpm: 1340, pwmPercent: 55 }
    ],
    temps: [
      { id: "t-cpu", label: "Ryzen Tctl", tempC: 48.2, highC: 90 },
      { id: "t-sfp", label: "10GbE SFP+", tempC: 51.8, highC: 75 }
    ],
    network: [
      {
        name: "eth0 (10GbE SFP+)",
        linkSpeedMbps: 1e4,
        ipAddress: "192.168.1.50",
        rxMbps,
        txMbps,
        rxTotalGB: 1428.4,
        txTotalGB: 412.9,
        sfpTempC: 51.8
      }
    ],
    gpus: [
      {
        id: "gpu-0",
        name: "AMD Radeon 780M Graphics",
        vendor: "amd",
        tempC: Math.round(44 + Math.sin(t * 0.25) * 2),
        utilPercent: Math.max(2, Math.round(14 + Math.sin(t * 0.4) * 9)),
        freqMhz: 1100,
        powerW: Number((8.5 + Math.sin(t * 0.35) * 2.1).toFixed(1)),
        vramUsedMB: 512,
        vramTotalMB: 4096
      }
    ]
  };
}
async function fetchHomeAssistantEntities(haEnabled, haUrl, haToken) {
  if (haEnabled && haUrl && haToken) {
    const base = haUrl.replace(/\/+$/, "");
    const data = await fetchJsonWithTimeout(`${base}/api/states`, haToken);
    if (Array.isArray(data)) {
      return {
        connected: true,
        entities: data
      };
    }
  }
  return {
    connected: false,
    entities: []
  };
}
function getByJsonPath(obj, dotPath) {
  if (!dotPath) {
    if (typeof obj === "string" || typeof obj === "number") return obj;
    return null;
  }
  const parts = dotPath.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in cur) {
      cur = cur[p];
    } else {
      return null;
    }
  }
  if (typeof cur === "string" || typeof cur === "number" || typeof cur === "boolean") {
    return typeof cur === "boolean" ? cur ? 1 : 0 : cur;
  }
  return null;
}
async function pollCustomConnections(connections) {
  return await Promise.all(
    connections.map(async (conn) => {
      if (!conn.enabled || !conn.url) return conn;
      try {
        const headers = { Accept: "application/json" };
        if (conn.token) headers.Authorization = `Bearer ${conn.token}`;
        const res = await safeOutboundFetch(conn.url, {
          headers,
          timeoutMs: 2200,
          maxBytes: 2 * 1024 * 1024
        });
        if (!res.ok) {
          return { ...conn, lastError: `HTTP ${res.status} from upstream` };
        }
        const data = JSON.parse(res.bodyBuffer.toString("utf8"));
        const extracted = getByJsonPath(data, conn.jsonPath);
        return {
          ...conn,
          lastValue: extracted !== null ? String(extracted) : JSON.stringify(data).slice(0, 48),
          lastError: void 0
        };
      } catch (err) {
        return {
          ...conn,
          lastError: err instanceof Error ? err.message : "Fetch error"
        };
      }
    })
  );
}
var cachedIntegrationPoll = {
  updatedAt: 0,
  haConnected: false,
  haEntities: [],
  customConnections: []
};
var integrationPollTimer = null;
var integrationPollInFlight = null;
async function refreshIntegrationsCache(cfg) {
  if (integrationPollInFlight) return await integrationPollInFlight;
  integrationPollInFlight = (async () => {
    try {
      const { haEnabled, haUrl, haToken, customConnections } = cfg.integrations;
      const [haRes, polledCustom] = await Promise.all([
        fetchHomeAssistantEntities(haEnabled, haUrl, haToken),
        pollCustomConnections(customConnections)
      ]);
      cachedIntegrationPoll = {
        updatedAt: Date.now(),
        haConnected: haRes.connected,
        haEntities: haRes.entities,
        customConnections: polledCustom
      };
      return cachedIntegrationPoll;
    } finally {
      integrationPollInFlight = null;
    }
  })();
  return await integrationPollInFlight;
}
async function getCachedOrRefreshIntegrations(cfg, maxAgeMs = 4500) {
  if (Date.now() - cachedIntegrationPoll.updatedAt < maxAgeMs && cachedIntegrationPoll.updatedAt > 0) {
    return cachedIntegrationPoll;
  }
  return await refreshIntegrationsCache(cfg);
}
function startIntegrationPoller(getConfig, intervalMs = 5e3) {
  stopIntegrationPoller();
  void refreshIntegrationsCache(getConfig()).catch(() => {
  });
  integrationPollTimer = setInterval(() => {
    void refreshIntegrationsCache(getConfig()).catch(() => {
    });
  }, Math.max(2e3, intervalMs));
  integrationPollTimer.unref?.();
}
function stopIntegrationPoller() {
  if (integrationPollTimer) {
    clearInterval(integrationPollTimer);
    integrationPollTimer = null;
  }
}
function hasRealHostHardwarePaths() {
  try {
    if (fs5.existsSync("/var/local/emhttp/var.ini") || fs5.existsSync("/var/local/emhttp/disks.ini")) {
      return true;
    }
    if (fs5.existsSync("/var/run/docker.sock")) {
      return true;
    }
    if (fs5.existsSync("/sys/class/hwmon") && fs5.readdirSync("/sys/class/hwmon").length > 0) {
      return true;
    }
    if (fs5.existsSync("/sys/class/drm") && fs5.readdirSync("/sys/class/drm").some((d) => /^card\d+$/.test(d))) {
      return true;
    }
  } catch {
  }
  return false;
}
async function resolveTelemetry(sourceMode, agentEnabled, agentUrl, agentToken, haConnected) {
  if (agentEnabled && agentUrl) {
    const agentData = await fetchAgentTelemetry(agentUrl, agentToken, haConnected);
    if (agentData) return agentData;
  }
  if (sourceMode === "simulation") {
    return getSimulationTelemetry(haConnected);
  }
  if (sourceMode === "local" || hasRealHostHardwarePaths()) {
    return await getLocalHostTelemetry(haConnected);
  }
  return getSimulationTelemetry(haConnected);
}
function buildExposedEntities(snapshot, haEntities, customConnections, overrides) {
  const list = [];
  const pushEntity = (id, source, defaultTag, rawValue, defaultUnit, explicitHistory) => {
    const ov = overrides[id] || {};
    const num = typeof rawValue === "number" ? rawValue : Number(rawValue);
    const numericValue = Number.isFinite(num) && String(rawValue).trim() !== "" ? num : null;
    recordEntityHistory(id, numericValue);
    list.push({
      id,
      source,
      tag: ov.tag?.trim() || defaultTag,
      rawValue,
      numericValue,
      unit: ov.unit !== void 0 ? ov.unit : defaultUnit,
      history: explicitHistory ?? [...entityHistoryMap.get(id) ?? (numericValue !== null ? [numericValue] : [])],
      enabled: ov.enabled !== void 0 ? ov.enabled : true
    });
  };
  const ramPct = Math.round(snapshot.system.ramUsedBytes / Math.max(1, snapshot.system.ramTotalBytes) * 100);
  const ramUsedGb = Number((snapshot.system.ramUsedBytes / 1024 ** 3).toFixed(1));
  const arrayPct = Math.round(snapshot.array.usedBytes / Math.max(1, snapshot.array.totalBytes) * 100);
  const arrayUsedTb = Number((snapshot.array.usedBytes / 1024 ** 4).toFixed(2));
  const rxTotal = Number(snapshot.network.reduce((a, n) => a + n.rxMbps, 0).toFixed(1));
  const txTotal = Number(snapshot.network.reduce((a, n) => a + n.txMbps, 0).toFixed(1));
  pushEntity("server.hostname", "server", "Server Hostname", snapshot.system.hostname, "");
  pushEntity("server.cpu_model", "server", "CPU Model", snapshot.system.cpuModel, "");
  pushEntity("server.cpu_percent", "server", "CPU Load", snapshot.system.cpuPercent, "%", snapshot.history.cpuSeries);
  if (snapshot.system.cpuFreqMhz !== void 0 && snapshot.system.cpuFreqMhz !== null) {
    pushEntity("server.cpu_freq_mhz", "server", "CPU Clock", snapshot.system.cpuFreqMhz, "MHz");
  }
  pushEntity("server.cpu_temp", "server", "CPU Temp", snapshot.system.cpuTempC, "\xB0C");
  pushEntity("server.cpu_power_w", "server", "CPU Power", snapshot.system.cpuPowerW, "W");
  pushEntity("server.load_1m", "server", "Load Avg (1m)", snapshot.system.loadAvg[0], "");
  pushEntity("server.ram_percent", "server", "Memory Usage", ramPct, "%", snapshot.history.ramSeries);
  pushEntity("server.ram_used_gb", "server", "Memory Used", ramUsedGb, "GB");
  const primaryGpu = snapshot.gpus?.[0];
  if (primaryGpu) {
    pushEntity("server.gpu_name", "server", "GPU Model", primaryGpu.name, "");
    if (primaryGpu.utilPercent !== null) {
      pushEntity("server.gpu_util_percent", "server", "GPU Load", primaryGpu.utilPercent, "%");
    }
    if (primaryGpu.tempC !== null) {
      pushEntity("server.gpu_temp", "server", "GPU Temp", primaryGpu.tempC, "\xB0C");
    }
    if (primaryGpu.powerW !== null) {
      pushEntity("server.gpu_power_w", "server", "GPU Power", primaryGpu.powerW, "W");
    }
    if (primaryGpu.freqMhz !== null) {
      pushEntity("server.gpu_freq_mhz", "server", "GPU Clock", primaryGpu.freqMhz, "MHz");
    }
    if (primaryGpu.vramUsedMB !== null) {
      pushEntity("server.gpu_vram_used_mb", "server", "GPU VRAM Used", primaryGpu.vramUsedMB, "MB");
    }
    if (primaryGpu.vramUsedMB !== null && primaryGpu.vramTotalMB && primaryGpu.vramTotalMB > 0) {
      pushEntity(
        "server.gpu_vram_percent",
        "server",
        "GPU VRAM %",
        Math.round(primaryGpu.vramUsedMB / primaryGpu.vramTotalMB * 100),
        "%"
      );
    }
  }
  pushEntity("server.array_used_pct", "server", "Array Used", arrayPct, "%");
  pushEntity("server.array_used_tb", "server", "Array Used TB", arrayUsedTb, "TB");
  pushEntity("server.array_state", "server", "Array State", snapshot.array.state, "");
  pushEntity("server.net_rx_mbps", "server", "Network Download", rxTotal, "Mbps", snapshot.history.netRxSeries);
  pushEntity("server.net_tx_mbps", "server", "Network Upload", txTotal, "Mbps", snapshot.history.netTxSeries);
  pushEntity(
    "server.docker_running_count",
    "server",
    "Running Dockers",
    snapshot.containers.filter((c) => c.state === "running").length,
    ""
  );
  pushEntity("server.active_users_count", "server", "Connected Users", snapshot.sessions.length, "");
  pushEntity(
    "server.running_tasks_count",
    "server",
    "Active Tasks",
    snapshot.tasks.filter((t) => t.status === "running").length,
    ""
  );
  pushEntity("server.ups_load_pct", "server", "UPS Load", snapshot.ups.loadPercent, "%");
  pushEntity("server.ups_power_w", "server", "UPS Draw", snapshot.ups.currentPowerW, "W");
  for (const disk of snapshot.disks) {
    pushEntity(`disk.${disk.id}.temp_c`, "server", `${disk.name} Temp`, disk.tempC, "\xB0C");
  }
  const seenSensorIds = new Set(list.map((item) => item.id));
  for (const s of snapshot.sensors ?? []) {
    let uniqueId = s.id;
    let suffix = 2;
    while (seenSensorIds.has(uniqueId)) {
      uniqueId = `${s.id}_${suffix++}`;
    }
    seenSensorIds.add(uniqueId);
    pushEntity(uniqueId, "server", s.label, s.value, s.unit);
  }
  for (const ha of haEntities) {
    pushEntity(
      `ha.${ha.entity_id}`,
      "home_assistant",
      ha.attributes.friendly_name || ha.entity_id,
      ha.state,
      ha.attributes.unit_of_measurement || ""
    );
  }
  for (const cc of customConnections) {
    if (cc.enabled) {
      pushEntity(
        `custom.${cc.id}`,
        "custom_http",
        cc.name,
        cc.lastValue ?? "pending",
        cc.unit || ""
      );
    }
  }
  return list;
}

// src/server/hardwareDaemon.ts
var timerHandle = null;
var lastRotationSwitchMs = Date.now();
var isTickRunning = false;
var sessionPushArmed = false;
var consecutiveErrors = 0;
var prevSleepBlank = false;
var prevArrayStopped = false;
var prevEffectiveBrightness = null;
var shuttingDown = false;
var BACKOFF_STEPS_MS = [1e3, 2e3, 4e3, 8e3, 15e3, 3e4];
function parseHhMm(hhmm) {
  const [h, m] = (hhmm || "00:00").split(":").map((n) => Number(n) || 0);
  return h * 60 + m;
}
function isWithinSleepWindow(enabled, start, end, now = /* @__PURE__ */ new Date()) {
  if (!enabled) return false;
  const mins = now.getHours() * 60 + now.getMinutes();
  const s = parseHhMm(start);
  const e = parseHhMm(end);
  if (s === e) return false;
  if (s < e) return mins >= s && mins < e;
  return mins >= s || mins < e;
}
var runtimeState = {
  running: false,
  sessionPushArmed: false,
  daemonState: "idle",
  lastError: null,
  consecutiveErrors: 0,
  lastTickAt: null,
  activeIndex: 0,
  currentScreenId: null,
  currentScreenName: null,
  isSleeping: false,
  effectiveBrightness: 85,
  deployedScreensCount: 0
};
function isSessionPushArmed() {
  return sessionPushArmed;
}
function armSessionPush(armed) {
  sessionPushArmed = armed;
  runtimeState.sessionPushArmed = armed;
  if (!armed && runtimeState.daemonState === "active") {
    runtimeState.daemonState = "idle";
  }
}
function resetDaemonBackoff() {
  consecutiveErrors = 0;
  runtimeState.consecutiveErrors = 0;
  runtimeState.lastError = null;
}
async function runHardwareDaemonTick(getConfig, onConfigPatch, overrideRgbaBase64, options) {
  if (!isSerialWritesActive()) {
    throw new Error(
      "Serial writes are disabled by safety policy. Validate packets via Dry Run first, then set AOOSTAR_ENABLE_SERIAL_WRITES=true or unlock serial writes in Settings."
    );
  }
  if (isEmergencyStopped()) {
    throw new Error("Emergency stop is active. Clear Emergency Stop on Diagnostics before pushing.");
  }
  const cfg = getConfig();
  const playlist = cfg.screens.filter((s) => s.enabled);
  if (playlist.length === 0) {
    runtimeState.deployedScreensCount = 0;
    runtimeState.currentScreenId = null;
    runtimeState.currentScreenName = null;
    onConfigPatch?.({
      activeIndex: 0,
      currentScreenId: null,
      currentScreenName: null
    });
    return null;
  }
  const nowMs = options?.now ? options.now.getTime() : Date.now();
  let idx = Math.max(0, Math.min(playlist.length - 1, runtimeState.activeIndex));
  const current = playlist[idx];
  let screenChanged = false;
  if (!overrideRgbaBase64 && cfg.rotationEnabled !== false && playlist.length > 1 && nowMs - lastRotationSwitchMs >= current.durationSec * 1e3) {
    idx = (idx + 1) % playlist.length;
    lastRotationSwitchMs = nowMs;
    screenChanged = true;
  }
  const activeScreen = playlist[idx];
  const sleeping = isWithinSleepWindow(
    cfg.hardware.sleepScheduleEnabled,
    cfg.hardware.sleepStart,
    cfg.hardware.sleepEnd,
    options?.now
  );
  const effectiveBrightness = sleeping ? cfg.hardware.sleepMode === "dim" ? cfg.hardware.sleepDimPercent ?? 5 : 0 : cfg.hardware.brightness;
  const blankSleep = sleeping && (cfg.hardware.sleepMode ?? "off") === "off";
  const integ = await getCachedOrRefreshIntegrations(cfg);
  const { sourceMode, agentEnabled, agentUrl, agentToken } = cfg.integrations;
  const snapshot = await resolveTelemetry(
    sourceMode,
    agentEnabled,
    agentUrl,
    agentToken,
    integ.haConnected
  );
  const exposedEntities = buildExposedEntities(
    snapshot,
    integ.haEntities,
    integ.customConnections,
    cfg.entityOverrides
  );
  if (!overrideRgbaBase64 && !options?.skipPowerSleepEdge) {
    if (blankSleep) {
      if (!prevSleepBlank) {
        const offMeta = await pushHardwareFrame({
          screenId: activeScreen.id,
          screenName: activeScreen.name,
          devicePath: cfg.hardware.devicePath,
          powerOff: true
        });
        prevSleepBlank = true;
        runtimeState.activeIndex = idx;
        runtimeState.lastTickAt = (/* @__PURE__ */ new Date()).toISOString();
        runtimeState.currentScreenId = activeScreen.id;
        runtimeState.currentScreenName = activeScreen.name;
        runtimeState.isSleeping = true;
        runtimeState.effectiveBrightness = effectiveBrightness;
        runtimeState.deployedScreensCount = playlist.length;
        runtimeState.daemonState = "sleeping";
        runtimeState.lastError = null;
        onConfigPatch?.({
          activeIndex: idx,
          currentScreenId: activeScreen.id,
          currentScreenName: activeScreen.name,
          isSleeping: true,
          effectiveBrightness,
          daemonState: "sleeping",
          lastError: null
        });
        return offMeta;
      }
      runtimeState.isSleeping = true;
      runtimeState.daemonState = "sleeping";
      return getLastFrameMeta();
    }
    if (prevSleepBlank) {
      prevSleepBlank = false;
      resetFrameDiffCache();
      options = { ...options, forceFullRefresh: true };
    }
    const arrayStopped = snapshot.array.state === "STOPPED";
    if (arrayStopped) {
      if (!prevArrayStopped) {
        const offMeta = await pushHardwareFrame({
          screenId: activeScreen.id,
          screenName: activeScreen.name,
          devicePath: cfg.hardware.devicePath,
          powerOff: true
        });
        prevArrayStopped = true;
        runtimeState.daemonState = "sleeping";
        runtimeState.lastTickAt = (/* @__PURE__ */ new Date()).toISOString();
        onConfigPatch?.({
          isSleeping: true,
          daemonState: "sleeping",
          lastError: null
        });
        return offMeta;
      }
      runtimeState.daemonState = "sleeping";
      return getLastFrameMeta();
    }
    if (prevArrayStopped) {
      prevArrayStopped = false;
      resetFrameDiffCache();
      options = { ...options, forceFullRefresh: true };
    }
  }
  const brightnessChanged = prevEffectiveBrightness !== null && prevEffectiveBrightness !== effectiveBrightness;
  if (brightnessChanged) {
    resetFrameDiffCache();
  }
  const rgbaBuffer = overrideRgbaBase64 ? Buffer.from(overrideRgbaBase64, "base64") : renderScreenToRgbaBuffer({
    screen: activeScreen,
    telemetry: snapshot,
    haEntities: integ.haEntities,
    exposedEntities,
    dockerIcons: cfg.dockerIcons,
    rotation: cfg.hardware.rotation,
    brightnessPercent: effectiveBrightness,
    blank: false,
    now: options?.now
  });
  const meta = await pushHardwareFrame({
    rgbaBuffer,
    screenId: activeScreen.id,
    screenName: activeScreen.name,
    devicePath: cfg.hardware.devicePath,
    brightnessPercent: overrideRgbaBase64 ? effectiveBrightness : 100,
    // already scaled when server-rendered
    brightnessKey: effectiveBrightness,
    forceFullRefresh: Boolean(options?.forceFullRefresh || screenChanged || brightnessChanged),
    powerOff: false
  });
  prevEffectiveBrightness = effectiveBrightness;
  const nextDaemonState = sessionPushArmed && cfg.hardware.autoPushEnabled !== false ? "active" : "idle";
  consecutiveErrors = 0;
  runtimeState.consecutiveErrors = 0;
  runtimeState.lastError = null;
  runtimeState.daemonState = nextDaemonState;
  runtimeState.activeIndex = idx;
  runtimeState.lastTickAt = (/* @__PURE__ */ new Date()).toISOString();
  runtimeState.currentScreenId = activeScreen.id;
  runtimeState.currentScreenName = activeScreen.name;
  runtimeState.isSleeping = sleeping;
  runtimeState.effectiveBrightness = effectiveBrightness;
  runtimeState.deployedScreensCount = playlist.length;
  onConfigPatch?.({
    activeIndex: idx,
    currentScreenId: activeScreen.id,
    currentScreenName: activeScreen.name,
    isSleeping: sleeping,
    effectiveBrightness,
    daemonState: nextDaemonState,
    lastError: null
  });
  return meta;
}
function startHardwareDaemon(getConfig, onConfigPatch) {
  if (timerHandle) {
    clearTimeout(timerHandle);
    timerHandle = null;
  }
  shuttingDown = false;
  runtimeState.running = true;
  lastRotationSwitchMs = Date.now();
  const initialCfg = getConfig();
  runtimeState.activeIndex = initialCfg.hardwareDeploy?.activeIndex ?? 0;
  if (initialCfg.hardware.bootDisplayOff && isSerialWritesActive() && !isEmergencyStopped()) {
    sessionPushArmed = false;
    runtimeState.sessionPushArmed = false;
    runtimeState.daemonState = "stopped";
    void sendDisplayOffOverSerialAsync(initialCfg.hardware.devicePath).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[aoostar-daemon] bootDisplayOff skipped or failed: ${msg}`);
    });
  } else if (initialCfg.hardwareDeploy?.deployed === true && initialCfg.hardware.autoPushEnabled === true && isSerialWritesActive() && !isEmergencyStopped()) {
    sessionPushArmed = true;
    runtimeState.sessionPushArmed = true;
    runtimeState.daemonState = "active";
    resetFrameDiffCache();
    console.log("[aoostar-daemon] Resuming previously deployed LCD playlist on startup");
  } else {
    sessionPushArmed = false;
    runtimeState.sessionPushArmed = false;
    runtimeState.daemonState = "idle";
  }
  const scheduleNext = () => {
    if (shuttingDown) return;
    const baseMs = Math.max(1e3, (getConfig().hardware.pushIntervalSec || 2) * 1e3);
    const delayMs = consecutiveErrors > 0 ? Math.max(
      baseMs,
      BACKOFF_STEPS_MS[Math.min(BACKOFF_STEPS_MS.length - 1, consecutiveErrors - 1)]
    ) : baseMs;
    timerHandle = setTimeout(async () => {
      if (shuttingDown) return;
      const cfg = getConfig();
      if (sessionPushArmed && isSerialWritesActive() && !isEmergencyStopped() && cfg.hardwareDeploy?.deployed === true && cfg.hardware.autoPushEnabled === true && !isTickRunning) {
        isTickRunning = true;
        try {
          await runHardwareDaemonTick(getConfig, onConfigPatch);
        } catch (err) {
          consecutiveErrors += 1;
          const msg = err instanceof Error ? err.message : String(err);
          runtimeState.consecutiveErrors = consecutiveErrors;
          runtimeState.lastError = msg;
          runtimeState.daemonState = "retrying";
          onConfigPatch?.({
            daemonState: "retrying",
            lastError: msg
          });
          console.error(
            `[aoostar-daemon] Serial push failed (attempt ${consecutiveErrors}, retrying with backoff): ${msg}`
          );
        } finally {
          isTickRunning = false;
        }
      }
      scheduleNext();
    }, delayMs);
    timerHandle.unref?.();
  };
  scheduleNext();
}
async function turnDisplayOnManual(getConfig, onConfigPatch) {
  const cfg = getConfig();
  await runSafeDisplayOnOverSerialAsync(cfg.hardware.devicePath);
  prevSleepBlank = false;
  prevArrayStopped = false;
  resetFrameDiffCache();
  resetDaemonBackoff();
  const meta = await runHardwareDaemonTick(getConfig, onConfigPatch, void 0, {
    forceFullRefresh: true,
    skipPowerSleepEdge: true
  });
  return meta ?? getLastFrameMeta();
}
async function turnDisplayOffManual(getConfig, onConfigPatch) {
  const cfg = getConfig();
  armSessionPush(false);
  const offRes = await sendDisplayOffOverSerialAsync(cfg.hardware.devicePath);
  runtimeState.daemonState = "stopped";
  runtimeState.lastTickAt = (/* @__PURE__ */ new Date()).toISOString();
  const prev = getLastFrameMeta();
  const meta = {
    ...prev,
    pushedAt: (/* @__PURE__ */ new Date()).toISOString(),
    devicePath: offRes.devicePath,
    deliveryMode: "usb-serial",
    chunksSent: 0,
    initAck: true,
    powerState: "off",
    lastError: null
  };
  setLastFrameMeta(meta);
  onConfigPatch?.({ daemonState: "stopped", lastError: null });
  return meta;
}
async function forceFullRefreshNow(getConfig, onConfigPatch) {
  resetFrameDiffCache();
  resetDaemonBackoff();
  return await runHardwareDaemonTick(getConfig, onConfigPatch, void 0, {
    forceFullRefresh: true,
    skipPowerSleepEdge: true
  });
}
async function emergencyStopDaemon(powerOffDisplay = false, devicePath) {
  sessionPushArmed = false;
  runtimeState.sessionPushArmed = false;
  runtimeState.daemonState = "stopped";
  if (powerOffDisplay && isSerialWritesActive() && !isEmergencyStopped()) {
    try {
      await sendDisplayOffOverSerialAsync(devicePath);
    } catch {
    }
  }
  activateEmergencyStop("Emergency stop pressed: stopped serial writes and asterctl process");
  await closeActiveSerialTransportAsync();
  await stopAsterctlProcess();
}
async function gracefulShutdownHardware(getConfig) {
  shuttingDown = true;
  if (timerHandle) {
    clearTimeout(timerHandle);
    timerHandle = null;
  }
  runtimeState.running = false;
  armSessionPush(false);
  const waitStart = Date.now();
  while (isTickRunning && Date.now() - waitStart < 1500) {
    await new Promise((r) => setTimeout(r, 50));
  }
  try {
    const cfg = getConfig();
    if (isSerialWritesActive() && !isEmergencyStopped() && getLastFrameMeta().powerState === "on") {
      await sendDisplayOffOverSerialAsync(cfg.hardware.devicePath);
    }
  } catch {
  }
  await closeActiveSerialTransportAsync();
  await stopAsterctlProcess();
}
function resetDaemonRotation(index = 0, nowMs = Date.now()) {
  runtimeState.activeIndex = index;
  lastRotationSwitchMs = nowMs;
}
function getDaemonStatus() {
  return { ...runtimeState };
}

// src/server/auth.ts
import crypto4 from "node:crypto";
import fs6 from "node:fs";
import net2 from "node:net";
import path5 from "node:path";
import { z as z2 } from "zod";
var DEFAULT_ADMIN_USERNAME = "admin";
var DEFAULT_ADMIN_PASSWORD = "admin";
var CREDENTIALS_FILENAME = "credentials.json";
var PUBLIC_DEFAULT_PW_ERROR = "Change the default password to allow access from outside your local network.";
var SCRYPT_KEYLEN = 64;
var SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
function hashSecretScrypt(secret, saltHex) {
  const salt = saltHex || crypto4.randomBytes(16).toString("hex");
  const derived = crypto4.scryptSync(secret, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS);
  return { salt, hash: derived.toString("hex") };
}
function verifySecretScrypt(provided, salt, expectedHashHex) {
  if (!provided || !salt || !expectedHashHex) return false;
  try {
    const expectedBuf = Buffer.from(expectedHashHex, "hex");
    if (expectedBuf.length !== SCRYPT_KEYLEN) return false;
    const derived = crypto4.scryptSync(provided, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS);
    if (derived.length !== expectedBuf.length) return false;
    return crypto4.timingSafeEqual(derived, expectedBuf);
  } catch {
    return false;
  }
}
function isTrustedProxyEnabled() {
  return process.env.AOOSTAR_TRUST_PROXY === "true";
}
function normalizeIp(rawIp) {
  if (!rawIp || typeof rawIp !== "string") return "";
  let ip = rawIp.trim();
  const zoneIdx = ip.indexOf("%");
  if (zoneIdx !== -1) ip = ip.slice(0, zoneIdx);
  if (ip.startsWith("::ffff:")) {
    ip = ip.slice(7);
  }
  return ip;
}
function resolveClientIp(req) {
  const socketIp = normalizeIp(req.socket?.remoteAddress);
  if (isTrustedProxyEnabled()) {
    const xff = req.headers["x-forwarded-for"];
    const rawList = typeof xff === "string" ? xff : Array.isArray(xff) ? xff[0] : "";
    if (rawList) {
      for (const part of rawList.split(",")) {
        const candidate = normalizeIp(part);
        if (candidate && net2.isIP(candidate) !== 0) {
          return candidate;
        }
      }
    }
  }
  return socketIp || "unknown";
}
function isLocalPrivateClientIp(rawIp) {
  const ip = normalizeIp(rawIp).toLowerCase();
  if (!ip) return false;
  if (net2.isIPv4(ip)) {
    const p = ip.split(".").map(Number);
    if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
    if (p[0] === 127) return true;
    if (p[0] === 10) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    return false;
  }
  if (net2.isIPv6(ip)) {
    if (ip === "::1" || ip === "0:0:0:0:0:0:0:1") return true;
    const firstHextet = ip.split(":")[0] || "";
    if (firstHextet.length >= 2) {
      const firstByte = Number.parseInt(firstHextet.padStart(4, "0").slice(0, 2), 16);
      if (Number.isFinite(firstByte) && (firstByte & 254) === 252) {
        return true;
      }
    }
    return false;
  }
  return false;
}
var RATE_WINDOW_MS = 5 * 60 * 1e3;
var MAX_FAILURES_IN_WINDOW = 5;
var ESCALATION_MS = [6e4, 5 * 6e4, 15 * 6e4, 30 * 6e4];
var AuthRateLimiter = class {
  constructor() {
    this.buckets = /* @__PURE__ */ new Map();
  }
  check(ip, nowMs = Date.now()) {
    const key = ip || "unknown";
    const b = this.buckets.get(key);
    if (!b) return { allowed: true, retryAfterSec: 0, failureCount: 0 };
    if (b.lockedUntilMs > nowMs) {
      const retryAfterSec = Math.max(1, Math.ceil((b.lockedUntilMs - nowMs) / 1e3));
      return { allowed: false, retryAfterSec, failureCount: b.failures.length };
    }
    b.failures = b.failures.filter((t) => nowMs - t <= RATE_WINDOW_MS);
    if (b.failures.length === 0 && b.lockedUntilMs <= nowMs) {
      this.buckets.delete(key);
      return { allowed: true, retryAfterSec: 0, failureCount: 0 };
    }
    return { allowed: true, retryAfterSec: 0, failureCount: b.failures.length };
  }
  recordFailure(ip, kind, nowMs = Date.now()) {
    const key = ip || "unknown";
    const existing = this.buckets.get(key) ?? { failures: [], lockedUntilMs: 0, lockoutLevel: 0 };
    existing.failures = existing.failures.filter((t) => nowMs - t <= RATE_WINDOW_MS);
    existing.failures.push(nowMs);
    let locked = false;
    let retryAfterSec = 0;
    if (existing.failures.length >= MAX_FAILURES_IN_WINDOW) {
      const durationMs = ESCALATION_MS[Math.min(ESCALATION_MS.length - 1, existing.lockoutLevel)];
      existing.lockedUntilMs = nowMs + durationMs;
      existing.lockoutLevel += 1;
      existing.failures = [];
      locked = true;
      retryAfterSec = Math.ceil(durationMs / 1e3);
    }
    this.buckets.set(key, existing);
    const label = kind === "login" ? "login" : "API token";
    if (locked) {
      console.warn(
        `[aoostar-auth] Locked out IP ${key} for ${retryAfterSec}s after repeated failed ${label} attempts`
      );
    } else {
      console.warn(
        `[aoostar-auth] Failed ${label} attempt from ${key} (${existing.failures.length}/${MAX_FAILURES_IN_WINDOW} in 5m window)`
      );
    }
    return { locked, retryAfterSec, attemptsInWindow: existing.failures.length };
  }
  recordSuccess(ip) {
    this.buckets.delete(ip || "unknown");
  }
  async applyFailureDelay(attemptsInWindow) {
    const delayMs = Math.min(400, Math.max(40, attemptsInWindow * 60));
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
};
function buildDefaultCredentialsRecord(existingSessionSecret) {
  const { salt, hash } = hashSecretScrypt(DEFAULT_ADMIN_PASSWORD);
  return {
    version: 1,
    username: DEFAULT_ADMIN_USERNAME,
    passwordSalt: salt,
    passwordHash: hash,
    usingDefaultPassword: true,
    sessionSecret: existingSessionSecret || crypto4.randomBytes(32).toString("hex"),
    apiTokenSalt: null,
    apiTokenHash: null,
    apiTokenPrefix: null,
    apiTokenCreatedAt: null,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function createCredentialStore(dataDir) {
  const credentialsPath = path5.join(dataDir, CREDENTIALS_FILENAME);
  const loaded = readJsonWithBackupFallback(credentialsPath);
  let record;
  if (loaded.data && loaded.data.version === 1 && typeof loaded.data.username === "string" && typeof loaded.data.passwordSalt === "string" && typeof loaded.data.passwordHash === "string" && typeof loaded.data.sessionSecret === "string") {
    record = loaded.data;
    try {
      fs6.chmodSync(credentialsPath, 384);
    } catch {
    }
    if (loaded.recoveredFromBackup) {
      writeFileAtomic0600(credentialsPath, JSON.stringify(record, null, 2), false);
    }
  } else {
    record = buildDefaultCredentialsRecord();
    writeFileAtomic0600(credentialsPath, JSON.stringify(record, null, 2), false);
    console.log(`[aoostar-auth] Initialized default credentials (mode 0600) at ${credentialsPath}`);
  }
  function saveRecord(next) {
    record = next;
    writeFileAtomic0600(credentialsPath, JSON.stringify(next, null, 2), true);
  }
  function getEnvOverride() {
    const envUser = (process.env.AOOSTAR_ADMIN_USER || "").trim();
    const envPass = process.env.AOOSTAR_ADMIN_PASSWORD ?? "";
    if (envPass !== "") {
      return {
        active: true,
        username: envUser || DEFAULT_ADMIN_USERNAME,
        password: envPass
      };
    }
    return { active: false, username: envUser || record.username, password: null };
  }
  const initialOverride = getEnvOverride();
  if (initialOverride.active) {
    console.log(
      `[aoostar-auth] Environment admin override active (user="${initialOverride.username}"); default password disabled.`
    );
  } else if (record.usingDefaultPassword) {
    console.warn(
      "[aoostar-auth] WARNING: Using default login credentials (admin/admin). Change the password in Settings > Security."
    );
  }
  return {
    credentialsPath,
    isEnvOverrideActive() {
      return getEnvOverride().active;
    },
    isUsingDefaultPassword() {
      if (getEnvOverride().active) return false;
      return Boolean(record.usingDefaultPassword);
    },
    getEffectiveUsername() {
      const ov = getEnvOverride();
      if (ov.active) return ov.username;
      return (process.env.AOOSTAR_ADMIN_USER || "").trim() || record.username;
    },
    getSessionSecret() {
      return record.sessionSecret;
    },
    hasStoredApiToken() {
      return Boolean(record.apiTokenSalt && record.apiTokenHash);
    },
    getApiTokenMeta() {
      return {
        configured: Boolean(record.apiTokenSalt && record.apiTokenHash),
        prefix: record.apiTokenPrefix ?? null,
        createdAt: record.apiTokenCreatedAt ?? null
      };
    },
    verifyLogin(username, password) {
      const cleanUser = (username || "").trim();
      const ov = getEnvOverride();
      if (ov.active && ov.password !== null) {
        const userOk2 = safeTokenEqual(ov.username, cleanUser);
        const passOk2 = safeTokenEqual(ov.password, password);
        return userOk2 && passOk2;
      }
      const expectedUser = this.getEffectiveUsername();
      const userOk = safeTokenEqual(expectedUser, cleanUser);
      const passOk = verifySecretScrypt(password, record.passwordSalt, record.passwordHash);
      return userOk && passOk;
    },
    verifyApiToken(providedToken) {
      const clean = (providedToken || "").trim();
      if (!clean) return false;
      const envApiToken = (process.env.AOOSTAR_API_TOKEN || "").trim();
      if (envApiToken && safeTokenEqual(envApiToken, clean)) {
        return true;
      }
      if (record.apiTokenSalt && record.apiTokenHash) {
        return verifySecretScrypt(clean, record.apiTokenSalt, record.apiTokenHash);
      }
      return false;
    },
    changeCredentials(params) {
      if (getEnvOverride().active) {
        throw new Error(
          "Credentials are overridden by AOOSTAR_ADMIN_USER / AOOSTAR_ADMIN_PASSWORD environment variables."
        );
      }
      if (!verifySecretScrypt(params.currentPassword, record.passwordSalt, record.passwordHash)) {
        throw new Error("Current password is incorrect.");
      }
      if (params.newPassword === params.currentPassword) {
        throw new Error("New password must be different from your current password.");
      }
      const nextUsername = (params.newUsername || "").trim() || record.username;
      const { salt, hash } = hashSecretScrypt(params.newPassword);
      const nextSecret = crypto4.randomBytes(32).toString("hex");
      saveRecord({
        ...record,
        username: nextUsername,
        passwordSalt: salt,
        passwordHash: hash,
        usingDefaultPassword: false,
        sessionSecret: nextSecret,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
      console.log(`[aoostar-auth] Credentials updated for "${nextUsername}"; existing sessions invalidated.`);
      return { username: nextUsername, sessionSecret: nextSecret };
    },
    resetToDefault() {
      if (getEnvOverride().active) {
        throw new Error(
          "Credentials are overridden by AOOSTAR_ADMIN_USER / AOOSTAR_ADMIN_PASSWORD environment variables."
        );
      }
      const nextSecret = crypto4.randomBytes(32).toString("hex");
      const next = {
        ...buildDefaultCredentialsRecord(nextSecret),
        apiTokenSalt: record.apiTokenSalt ?? null,
        apiTokenHash: record.apiTokenHash ?? null,
        apiTokenPrefix: record.apiTokenPrefix ?? null,
        apiTokenCreatedAt: record.apiTokenCreatedAt ?? null
      };
      saveRecord(next);
      console.warn(
        "[aoostar-auth] Credentials reset to default (admin/admin); existing sessions invalidated."
      );
      return { username: next.username, sessionSecret: next.sessionSecret };
    },
    rotateSessionSecret() {
      const nextSecret = crypto4.randomBytes(32).toString("hex");
      saveRecord({
        ...record,
        sessionSecret: nextSecret,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
      console.log("[aoostar-auth] Session secret rotated; all active sessions signed out.");
      return nextSecret;
    },
    rotateApiToken() {
      const rawToken = `aoo_${crypto4.randomBytes(28).toString("hex")}`;
      const prefix = `${rawToken.slice(0, 12)}...`;
      const createdAt = (/* @__PURE__ */ new Date()).toISOString();
      const { salt, hash } = hashSecretScrypt(rawToken);
      saveRecord({
        ...record,
        apiTokenSalt: salt,
        apiTokenHash: hash,
        apiTokenPrefix: prefix,
        apiTokenCreatedAt: createdAt,
        updatedAt: createdAt
      });
      console.log(`[aoostar-auth] Rotated script API token (${prefix}); stored salted hash only.`);
      return {
        token: rawToken,
        prefix,
        createdAt,
        sessionSecret: record.sessionSecret
      };
    },
    revokeApiToken() {
      saveRecord({
        ...record,
        apiTokenSalt: null,
        apiTokenHash: null,
        apiTokenPrefix: null,
        apiTokenCreatedAt: null,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
      console.log("[aoostar-auth] Revoked stored script API token.");
    }
  };
}
function isDefaultPasswordPublicBlocked(req, store) {
  if (!store.isUsingDefaultPassword()) return false;
  if (process.env.AOOSTAR_ALLOW_DEFAULT_PASSWORD_PUBLIC === "true") return false;
  const clientIp = resolveClientIp(req);
  return !isLocalPrivateClientIp(clientIp);
}
function buildSessionCookieHeader(req, cookieValue, maxAgeSec = 7 * 24 * 60 * 60) {
  const forwardedProtoHttps = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase() === "https";
  const originHeader = String(req.headers.origin || "").toLowerCase();
  const refererHeader = String(req.headers.referer || "").toLowerCase();
  const isIframeHttps = process.env.DISABLE_HMR === "true" && Boolean(
    req.secure || forwardedProtoHttps || originHeader.startsWith("https://") || refererHeader.startsWith("https://")
  );
  const trustProxyHttps = isTrustedProxyEnabled() && forwardedProtoHttps;
  const isSecure = Boolean(req.secure || trustProxyHttps || isIframeHttps);
  const parts = [
    `aoostar_session=${encodeURIComponent(cookieValue)}`,
    "Path=/",
    "HttpOnly",
    isIframeHttps ? "SameSite=None" : "SameSite=Strict",
    `Max-Age=${maxAgeSec}`
  ];
  if (isSecure) parts.push("Secure");
  if (isIframeHttps) parts.push("Partitioned");
  return parts.join("; ");
}
function buildClearSessionCookieHeader(req) {
  return buildSessionCookieHeader(req, "", 0);
}
function sendSessionCookie(res, req, cookieValue) {
  res.setHeader("Set-Cookie", buildSessionCookieHeader(req, cookieValue));
}
function clearSessionCookie(res, req) {
  res.setHeader("Set-Cookie", buildClearSessionCookieHeader(req));
}
var LoginRequestSchema = z2.object({
  username: z2.string().min(1).max(128),
  password: z2.string().min(1).max(256)
});
var ChangeCredentialsSchema = z2.object({
  currentPassword: z2.string().min(1, "Current password is required.").max(256),
  newUsername: z2.string().trim().min(1, "Username cannot be empty.").max(64).optional(),
  newPassword: z2.string().min(8, "New password must be at least 8 characters.").max(256),
  confirmPassword: z2.string().min(1, "Please confirm the new password.").max(256)
}).refine((d) => d.newPassword === d.confirmPassword, {
  message: "New password and confirmation do not match.",
  path: ["confirmPassword"]
});
var ResetDefaultSchema = z2.object({
  confirmed: z2.literal(true)
});

// src/server/unraidDeploy.ts
function generateUnraidCommunityAppsXml(port = 3e3) {
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
function generateDockerCompose() {
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

// server.ts
function readAppVersion() {
  try {
    const pkg = JSON.parse(fs7.readFileSync(path6.resolve(process.cwd(), "package.json"), "utf8"));
    if (pkg.version) return pkg.version;
  } catch {
  }
  return "1.0.5";
}
var APP_VERSION = readAppVersion();
function normalizeLoadedConfig(parsed) {
  if (!parsed) return structuredClone(DEFAULT_CONFIG);
  return {
    ...DEFAULT_CONFIG,
    ...parsed,
    hardware: { ...DEFAULT_CONFIG.hardware, ...parsed.hardware || {} },
    integrations: {
      ...DEFAULT_CONFIG.integrations,
      ...parsed.integrations || {},
      customConnections: Array.isArray(parsed.integrations?.customConnections) ? parsed.integrations.customConnections : []
    },
    entityOverrides: parsed.entityOverrides || {},
    dockerIcons: parsed.dockerIcons || {},
    screens: Array.isArray(parsed.screens) && parsed.screens.length > 0 ? parsed.screens : DEFAULT_CONFIG.screens,
    savedScreens: Array.isArray(parsed.savedScreens) ? parsed.savedScreens : DEFAULT_CONFIG.savedScreens,
    hardwareDeploy: {
      ...DEFAULT_CONFIG.hardwareDeploy,
      ...parsed.hardwareDeploy || {},
      screens: Array.isArray(parsed.hardwareDeploy?.screens) && parsed.hardwareDeploy.screens.length > 0 ? parsed.hardwareDeploy.screens : DEFAULT_CONFIG.screens
    },
    customImages: Array.isArray(parsed.customImages) ? parsed.customImages : []
  };
}
function createStudioApp(options) {
  const port = options?.port ?? Number(process.env.PORT || 3e3);
  const bindHost = options?.bindHost ?? (process.env.AOOSTAR_BIND || "127.0.0.1");
  const dataDir = options?.dataDir ? path6.resolve(options.dataDir) : path6.resolve(process.cwd(), "data");
  const uploadsDir = path6.join(dataDir, "uploads");
  const configPath = path6.join(dataDir, "studio-config.json");
  fs7.mkdirSync(dataDir, { recursive: true, mode: 448 });
  fs7.mkdirSync(uploadsDir, { recursive: true, mode: 493 });
  try {
    for (const file of fs7.readdirSync(uploadsDir)) {
      if (file.endsWith(".part")) {
        fs7.unlinkSync(path6.join(uploadsDir, file));
      }
    }
  } catch {
  }
  const credentialStore = createCredentialStore(dataDir);
  const authRateLimiter = new AuthRateLimiter();
  const loaded = readJsonWithBackupFallback(configPath);
  let currentConfig = normalizeLoadedConfig(loaded.data);
  if (loaded.recoveredFromBackup) {
    writeFileAtomic0600(configPath, JSON.stringify(currentConfig, null, 2), false);
  }
  setConfigSerialWritesEnabled(Boolean(currentConfig.hardware.serialWritesEnabled));
  function saveConfig(config) {
    writeFileAtomic0600(configPath, JSON.stringify(config, null, 2), true);
  }
  const app = express();
  app.disable("x-powered-by");
  if (process.env.AOOSTAR_TRUST_PROXY === "true" || process.env.DISABLE_HMR === "true") {
    app.set("trust proxy", 1);
  }
  const prodHtml = path6.resolve(process.cwd(), "dist", "index.html");
  const devHtml = path6.resolve(process.cwd(), "index.html");
  const htmlPath = process.env.NODE_ENV === "production" && fs7.existsSync(prodHtml) ? prodHtml : devHtml;
  const inlineScriptHashes = extractIndexHtmlInlineScriptHashes(htmlPath);
  app.use(createSecurityHeadersMiddleware(inlineScriptHashes));
  app.use(
    createHostAndAuthMiddleware({
      getSessionSecret: () => credentialStore.getSessionSecret(),
      verifyApiToken: (tok) => credentialStore.verifyApiToken(tok),
      rateLimiter: authRateLimiter,
      getClientIp: resolveClientIp,
      bindHost
    })
  );
  const largeJsonRoutes = /* @__PURE__ */ new Set([
    "/api/uploads",
    "/api/hardware/deploy",
    "/api/hardware/push-frame",
    "/api/hardware/dry-run",
    "/api/hardware/safe-test"
  ]);
  const defaultJson = express.json({ limit: "2mb" });
  const largeJson = express.json({ limit: "16mb" });
  app.use((req, res, next) => {
    if (req.path.startsWith("/api/uploads/chunk/")) {
      next();
      return;
    }
    if (largeJsonRoutes.has(req.path)) {
      largeJson(req, res, next);
      return;
    }
    defaultJson(req, res, next);
  });
  app.use(
    "/uploads",
    express.static(uploadsDir, {
      dotfiles: "deny",
      index: false
    })
  );
  app.get("/api/auth/status", (req, res) => {
    const bearer = extractBearerToken(req);
    const hasBearer = bearer !== null && credentialStore.verifyApiToken(bearer);
    const hasCookie = verifySessionCookieValue(credentialStore.getSessionSecret(), req.headers.cookie);
    const authenticated = hasBearer || hasCookie;
    const tokenMeta = credentialStore.getApiTokenMeta();
    res.json({
      authenticated,
      username: authenticated ? credentialStore.getEffectiveUsername() : null,
      usingDefaultPassword: credentialStore.isUsingDefaultPassword(),
      envOverrideActive: credentialStore.isEnvOverrideActive(),
      defaultPasswordPublicBlocked: isDefaultPasswordPublicBlocked(req, credentialStore),
      ...authenticated ? {
        apiTokenConfigured: tokenMeta.configured,
        apiTokenPrefix: tokenMeta.prefix,
        apiTokenCreatedAt: tokenMeta.createdAt,
        envApiTokenConfigured: Boolean((process.env.AOOSTAR_API_TOKEN || "").trim())
      } : {}
    });
  });
  app.post("/api/auth/login", async (req, res) => {
    const parsed = LoginRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Username and password are required." });
      return;
    }
    const clientIp = resolveClientIp(req);
    const rate = authRateLimiter.check(clientIp);
    if (!rate.allowed) {
      res.setHeader("Retry-After", String(rate.retryAfterSec));
      res.status(429).json({
        error: `Too many failed login attempts. Try again in ${rate.retryAfterSec}s.`,
        retryAfterSec: rate.retryAfterSec
      });
      return;
    }
    if (isDefaultPasswordPublicBlocked(req, credentialStore)) {
      res.status(403).json({
        error: PUBLIC_DEFAULT_PW_ERROR,
        publicBlocked: true
      });
      return;
    }
    const valid = credentialStore.verifyLogin(parsed.data.username, parsed.data.password);
    if (!valid) {
      const fail = authRateLimiter.recordFailure(clientIp, "login");
      await authRateLimiter.applyFailureDelay(fail.attemptsInWindow);
      if (fail.locked) {
        res.setHeader("Retry-After", String(fail.retryAfterSec));
        res.status(429).json({
          error: `Too many failed login attempts. Try again in ${fail.retryAfterSec}s.`,
          retryAfterSec: fail.retryAfterSec
        });
        return;
      }
      res.status(401).json({ error: "Invalid username or password." });
      return;
    }
    authRateLimiter.recordSuccess(clientIp);
    const usingDefault = credentialStore.isUsingDefaultPassword();
    if (usingDefault) {
      console.warn(
        `[aoostar-auth] WARNING: Default-credential login (admin/admin) from ${clientIp}. Change the password in Settings > Security.`
      );
    }
    const cookieVal = signSessionCookieValue(credentialStore.getSessionSecret());
    sendSessionCookie(res, req, cookieVal);
    res.json({
      ok: true,
      username: credentialStore.getEffectiveUsername(),
      usingDefaultPassword: usingDefault,
      envOverrideActive: credentialStore.isEnvOverrideActive()
    });
  });
  app.post("/api/auth/logout", (req, res) => {
    clearSessionCookie(res, req);
    res.json({ ok: true });
  });
  app.post("/api/auth/session", async (req, res) => {
    const parsed = AuthSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Token is required." });
      return;
    }
    const clientIp = resolveClientIp(req);
    const rate = authRateLimiter.check(clientIp);
    if (!rate.allowed) {
      res.setHeader("Retry-After", String(rate.retryAfterSec));
      res.status(429).json({
        error: `Too many failed API token attempts. Try again in ${rate.retryAfterSec}s.`,
        retryAfterSec: rate.retryAfterSec
      });
      return;
    }
    if (!credentialStore.verifyApiToken(parsed.data.token.trim())) {
      const fail = authRateLimiter.recordFailure(clientIp, "api-token");
      await authRateLimiter.applyFailureDelay(fail.attemptsInWindow);
      if (fail.locked) {
        res.setHeader("Retry-After", String(fail.retryAfterSec));
        res.status(429).json({
          error: `Too many failed API token attempts. Try again in ${fail.retryAfterSec}s.`,
          retryAfterSec: fail.retryAfterSec
        });
        return;
      }
      res.status(401).json({ error: "Invalid API token." });
      return;
    }
    authRateLimiter.recordSuccess(clientIp);
    const cookieVal = signSessionCookieValue(credentialStore.getSessionSecret());
    sendSessionCookie(res, req, cookieVal);
    res.json({ ok: true });
  });
  app.post("/api/auth/change-credentials", (req, res) => {
    const parsed = ChangeCredentialsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message || "Invalid credential change payload."
      });
      return;
    }
    try {
      const updated = credentialStore.changeCredentials({
        currentPassword: parsed.data.currentPassword,
        newUsername: parsed.data.newUsername,
        newPassword: parsed.data.newPassword
      });
      sendSessionCookie(res, req, signSessionCookieValue(updated.sessionSecret));
      res.json({
        ok: true,
        username: updated.username,
        usingDefaultPassword: false
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = msg.includes("incorrect") ? 401 : 400;
      res.status(status).json({ error: msg });
    }
  });
  app.post("/api/auth/reset-default", (req, res) => {
    const parsed = ResetDefaultSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Explicit confirmation is required to reset credentials." });
      return;
    }
    try {
      const resetRes = credentialStore.resetToDefault();
      sendSessionCookie(res, req, signSessionCookieValue(resetRes.sessionSecret));
      res.json({
        ok: true,
        username: resetRes.username,
        usingDefaultPassword: true
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
  app.post("/api/auth/logout-all", (req, res) => {
    credentialStore.rotateSessionSecret();
    clearSessionCookie(res, req);
    res.json({ ok: true });
  });
  app.post("/api/auth/api-token/rotate", (_req, res) => {
    const rotated = credentialStore.rotateApiToken();
    res.json({
      ok: true,
      token: rotated.token,
      prefix: rotated.prefix,
      createdAt: rotated.createdAt
    });
  });
  app.delete("/api/auth/api-token", (_req, res) => {
    credentialStore.revokeApiToken();
    res.json({ ok: true });
  });
  app.get("/api/info", (_req, res) => {
    res.json({ name: "Aoostar Display Studio", version: APP_VERSION });
  });
  app.get("/api/config", (_req, res) => {
    res.json(maskConfigForClient(currentConfig));
  });
  app.post("/api/config", (req, res) => {
    const parsed = ConfigPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid configuration payload.",
        issues: parsed.error.issues.slice(0, 6).map((i) => `${i.path.join(".")}: ${i.message}`)
      });
      return;
    }
    const body = parsed.data;
    const prevHw = currentConfig.hardware;
    const prevDeployedScreenId = currentConfig.hardwareDeploy.currentScreenId;
    currentConfig = mergeIncomingConfig(currentConfig, body);
    if (body.hardware && typeof body.hardware.serialWritesEnabled === "boolean") {
      if (isSerialWritesEnvLocked()) {
        currentConfig.hardware.serialWritesEnabled = false;
      }
      setConfigSerialWritesEnabled(Boolean(currentConfig.hardware.serialWritesEnabled));
    }
    const hwVisualChanged = Boolean(
      body.hardware && (currentConfig.hardware.brightness !== prevHw.brightness || currentConfig.hardware.rotation !== prevHw.rotation || currentConfig.hardware.devicePath !== prevHw.devicePath || currentConfig.hardware.sleepScheduleEnabled !== prevHw.sleepScheduleEnabled || currentConfig.hardware.sleepStart !== prevHw.sleepStart || currentConfig.hardware.sleepEnd !== prevHw.sleepEnd || currentConfig.hardware.sleepMode !== prevHw.sleepMode || currentConfig.hardware.sleepDimPercent !== prevHw.sleepDimPercent)
    );
    if (hwVisualChanged) {
      resetFrameDiffCache();
    }
    const enabledPlaylist = currentConfig.screens.filter((s) => s.enabled);
    if (Array.isArray(body.screens)) {
      const nextIndex = Math.max(
        0,
        Math.min(
          Math.max(0, enabledPlaylist.length - 1),
          currentConfig.hardwareDeploy.activeIndex ?? 0
        )
      );
      currentConfig.hardwareDeploy = {
        ...currentConfig.hardwareDeploy,
        activeIndex: nextIndex,
        currentScreenId: enabledPlaylist[nextIndex]?.id ?? null,
        currentScreenName: enabledPlaylist[nextIndex]?.name ?? null,
        screens: structuredClone(enabledPlaylist)
      };
    }
    let triggerDaemonTick = false;
    const autoPushTurnedOn = Boolean(body.hardware && typeof body.hardware.autoPushEnabled === "boolean") && currentConfig.hardware.autoPushEnabled && !prevHw.autoPushEnabled;
    const autoPushTurnedOff = Boolean(body.hardware && typeof body.hardware.autoPushEnabled === "boolean") && !currentConfig.hardware.autoPushEnabled && prevHw.autoPushEnabled;
    if (autoPushTurnedOn) {
      if (isSerialWritesActive() && !isEmergencyStopped()) {
        const targetScreens = enabledPlaylist.length > 0 ? enabledPlaylist : currentConfig.screens;
        const startIdx = Math.max(
          0,
          Math.min(
            Math.max(0, targetScreens.length - 1),
            currentConfig.hardwareDeploy.activeIndex ?? 0
          )
        );
        currentConfig.hardwareDeploy = {
          ...currentConfig.hardwareDeploy,
          deployed: true,
          deployedAt: currentConfig.hardwareDeploy.deployedAt || (/* @__PURE__ */ new Date()).toISOString(),
          activeIndex: startIdx,
          currentScreenId: targetScreens[startIdx]?.id ?? null,
          currentScreenName: targetScreens[startIdx]?.name ?? null,
          daemonState: "active",
          lastError: null,
          screens: structuredClone(targetScreens)
        };
        armSessionPush(true);
        resetDaemonRotation(startIdx);
        resetDaemonBackoff();
        resetFrameDiffCache();
        triggerDaemonTick = true;
      }
    } else if (autoPushTurnedOff) {
      armSessionPush(false);
      currentConfig.hardwareDeploy = {
        ...currentConfig.hardwareDeploy,
        daemonState: "idle"
      };
    } else if (Array.isArray(body.screens) && prevDeployedScreenId && !enabledPlaylist.some((s) => s.id === prevDeployedScreenId) && isSessionPushArmed() && isSerialWritesActive() && !isEmergencyStopped()) {
      resetDaemonRotation(0);
      triggerDaemonTick = true;
    } else if (hwVisualChanged && isSessionPushArmed() && isSerialWritesActive() && !isEmergencyStopped() && currentConfig.hardware.autoPushEnabled) {
      triggerDaemonTick = true;
    }
    if (body.integrations) {
      void refreshIntegrationsCache(currentConfig).catch(() => {
      });
    }
    saveConfig(currentConfig);
    if (triggerDaemonTick) {
      void runHardwareDaemonTick(
        () => currentConfig,
        (patch) => {
          currentConfig.hardwareDeploy = { ...currentConfig.hardwareDeploy, ...patch };
        },
        void 0,
        { forceFullRefresh: true }
      ).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        currentConfig.hardwareDeploy = {
          ...currentConfig.hardwareDeploy,
          daemonState: "error",
          lastError: msg
        };
        console.error("[aoostar-config-sync] Failed to sync screen change:", err);
      });
    }
    res.json(maskConfigForClient(currentConfig));
  });
  app.post("/api/hardware/serial-writes", (req, res) => {
    const parsed = SerialWritesToggleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid serial-writes toggle payload." });
      return;
    }
    if (isSerialWritesEnvLocked()) {
      res.status(403).json({
        error: "Serial writes are locked off by environment variable AOOSTAR_LOCK_SERIAL_WRITES=true."
      });
      return;
    }
    if (parsed.data.enabled && !parsed.data.confirmed) {
      res.status(400).json({
        error: "Explicit confirmation (confirmed: true) is required to unlock serial writes."
      });
      return;
    }
    currentConfig.hardware.serialWritesEnabled = parsed.data.enabled;
    setConfigSerialWritesEnabled(parsed.data.enabled);
    let triggerAfterUnlock = false;
    if (!parsed.data.enabled) {
      armSessionPush(false);
      currentConfig.hardwareDeploy.daemonState = "idle";
    } else if (isSerialWritesActive() && !isEmergencyStopped() && currentConfig.hardware.autoPushEnabled) {
      const enabledPlaylist = currentConfig.screens.filter((s) => s.enabled);
      const targetScreens = enabledPlaylist.length > 0 ? enabledPlaylist : currentConfig.screens;
      const startIdx = Math.max(
        0,
        Math.min(
          Math.max(0, targetScreens.length - 1),
          currentConfig.hardwareDeploy.activeIndex ?? 0
        )
      );
      currentConfig.hardwareDeploy = {
        ...currentConfig.hardwareDeploy,
        deployed: true,
        deployedAt: currentConfig.hardwareDeploy.deployedAt || (/* @__PURE__ */ new Date()).toISOString(),
        activeIndex: startIdx,
        currentScreenId: targetScreens[startIdx]?.id ?? null,
        currentScreenName: targetScreens[startIdx]?.name ?? null,
        daemonState: "active",
        lastError: null,
        screens: structuredClone(targetScreens)
      };
      armSessionPush(true);
      resetDaemonRotation(startIdx);
      resetDaemonBackoff();
      resetFrameDiffCache();
      triggerAfterUnlock = true;
    }
    saveConfig(currentConfig);
    if (triggerAfterUnlock) {
      void runHardwareDaemonTick(
        () => currentConfig,
        (patch) => {
          currentConfig.hardwareDeploy = { ...currentConfig.hardwareDeploy, ...patch };
        },
        void 0,
        { forceFullRefresh: true }
      ).catch((err) => {
        console.error("[aoostar-serial-unlock] Initial daemon push failed:", err);
      });
    }
    res.json({
      ok: true,
      serialWritesEnabled: isSerialWritesActive(),
      diagnostics: buildDiagnosticsSnapshot(
        isSessionPushArmed(),
        currentConfig.hardware.devicePath,
        getDaemonStatus().daemonState
      )
    });
  });
  const pendingUploads = /* @__PURE__ */ new Map();
  function sweepExpiredUploads() {
    const now = Date.now();
    for (const [id, session] of pendingUploads.entries()) {
      if (now - session.createdAtMs > PENDING_UPLOAD_TTL_MS) {
        pendingUploads.delete(id);
        try {
          if (fs7.existsSync(session.tmpPath)) fs7.unlinkSync(session.tmpPath);
        } catch {
        }
      }
    }
  }
  const sweepTimer = setInterval(sweepExpiredUploads, 6e4);
  sweepTimer.unref?.();
  app.post("/api/uploads/init", (req, res) => {
    sweepExpiredUploads();
    if (pendingUploads.size >= MAX_PENDING_UPLOADS) {
      res.status(429).json({ error: "Too many concurrent upload sessions. Wait or cancel active uploads." });
      return;
    }
    const parsed = UploadInitSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid upload initialization payload." });
      return;
    }
    const { name, mimeType } = parsed.data;
    const resolved = resolveRasterOrVideoType(mimeType || "", name || "");
    if (!resolved) {
      res.status(400).json({
        error: "Unsupported media format. SVG is blocked; use PNG, JPG, WebP, GIF, AVIF, MP4, or WebM."
      });
      return;
    }
    if (getDirectorySizeBytes(uploadsDir) >= MAX_UPLOADS_TOTAL_BYTES) {
      res.status(413).json({ error: "Uploads storage quota (250 MiB) exceeded. Delete unused media first." });
      return;
    }
    const id = `media-${Date.now()}-${crypto5.randomBytes(4).toString("hex")}`;
    const tmpPath = path6.join(uploadsDir, `${id}.part`);
    fs7.writeFileSync(tmpPath, Buffer.alloc(0));
    pendingUploads.set(id, {
      id,
      name: (name || "Imported Media").replace(/\.[^/.]+$/, "").slice(0, 48) || "Imported Media",
      kind: resolved.kind,
      ext: resolved.ext,
      tmpPath,
      bytes: 0,
      createdAtMs: Date.now()
    });
    res.json({ uploadId: id });
  });
  app.post(
    "/api/uploads/chunk/:uploadId",
    express.raw({ type: "application/octet-stream", limit: "8mb" }),
    (req, res) => {
      const session = pendingUploads.get(req.params.uploadId);
      if (!session) {
        res.status(404).json({ error: "Upload session not found." });
        return;
      }
      const chunk = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || "");
      if (session.bytes + chunk.length > MAX_UPLOAD_FILE_BYTES) {
        pendingUploads.delete(session.id);
        try {
          if (fs7.existsSync(session.tmpPath)) fs7.unlinkSync(session.tmpPath);
        } catch {
        }
        res.status(413).json({ error: "Upload exceeds 25 MiB per-file limit." });
        return;
      }
      if (getDirectorySizeBytes(uploadsDir) + chunk.length > MAX_UPLOADS_TOTAL_BYTES) {
        pendingUploads.delete(session.id);
        try {
          if (fs7.existsSync(session.tmpPath)) fs7.unlinkSync(session.tmpPath);
        } catch {
        }
        res.status(413).json({ error: "Uploads storage quota (250 MiB) exceeded." });
        return;
      }
      fs7.appendFileSync(session.tmpPath, chunk);
      session.bytes += chunk.length;
      res.json({ ok: true, bytesReceived: session.bytes });
    }
  );
  app.post("/api/uploads/finish/:uploadId", (req, res) => {
    const session = pendingUploads.get(req.params.uploadId);
    if (!session) {
      res.status(404).json({ error: "Upload session not found." });
      return;
    }
    pendingUploads.delete(req.params.uploadId);
    try {
      const fileBuf = fs7.readFileSync(session.tmpPath);
      const magic = validateMediaMagicBytes(fileBuf, session.ext);
      if (!magic.ok) {
        try {
          fs7.unlinkSync(session.tmpPath);
        } catch {
        }
        res.status(400).json({ error: magic.error || "Media file content failed magic-header verification." });
        return;
      }
      const filename = `${session.id}.${session.ext}`;
      fs7.renameSync(session.tmpPath, path6.join(uploadsDir, filename));
      const record = {
        id: session.id,
        name: session.name,
        url: `/uploads/${filename}`,
        mediaType: session.kind,
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      currentConfig.customImages = [record, ...currentConfig.customImages];
      saveConfig(currentConfig);
      res.json(record);
    } catch (err) {
      try {
        if (fs7.existsSync(session.tmpPath)) fs7.unlinkSync(session.tmpPath);
      } catch {
      }
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to finalize upload." });
    }
  });
  app.post("/api/uploads", (req, res) => {
    const parsed = UploadDataUrlSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Expected a valid image, GIF, or video data URL." });
      return;
    }
    const { name, dataUrl } = parsed.data;
    const match = dataUrl.match(/^data:([^;,]+)(?:;[^,]+)*;base64,([\s\S]+)$/i);
    if (!match) {
      res.status(400).json({ error: "Invalid base64 upload payload." });
      return;
    }
    const resolved = resolveRasterOrVideoType(match[1], name || "");
    if (!resolved) {
      res.status(400).json({
        error: "Unsupported media format. SVG is blocked; use PNG, JPG, WebP, GIF, AVIF, MP4, or WebM."
      });
      return;
    }
    const cleanBase64 = match[2].replace(/\s+/g, "");
    const buffer = Buffer.from(cleanBase64, "base64");
    if (buffer.length > MAX_UPLOAD_FILE_BYTES) {
      res.status(413).json({ error: "Upload exceeds 25 MiB per-file limit." });
      return;
    }
    if (getDirectorySizeBytes(uploadsDir) + buffer.length > MAX_UPLOADS_TOTAL_BYTES) {
      res.status(413).json({ error: "Uploads storage quota (250 MiB) exceeded." });
      return;
    }
    const magic = validateMediaMagicBytes(buffer, resolved.ext);
    if (!magic.ok) {
      res.status(400).json({ error: magic.error || "Uploaded data does not match declared file header." });
      return;
    }
    const id = `media-${Date.now()}-${crypto5.randomBytes(4).toString("hex")}`;
    const filename = `${id}.${resolved.ext}`;
    fs7.writeFileSync(path6.join(uploadsDir, filename), buffer);
    const record = {
      id,
      name: (name || "Imported Media").replace(/\.[^/.]+$/, "").slice(0, 48) || "Imported Media",
      url: `/uploads/${filename}`,
      mediaType: resolved.kind,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    currentConfig.customImages = [record, ...currentConfig.customImages];
    saveConfig(currentConfig);
    res.json(record);
  });
  app.delete("/api/uploads/:id", (req, res) => {
    const { id } = req.params;
    const existing = currentConfig.customImages.find((item) => item.id === id);
    if (existing?.url.startsWith("/uploads/")) {
      const filePath = path6.join(uploadsDir, path6.basename(existing.url));
      if (fs7.existsSync(filePath)) {
        try {
          fs7.unlinkSync(filePath);
        } catch {
        }
      }
    }
    currentConfig.customImages = currentConfig.customImages.filter((item) => item.id !== id);
    saveConfig(currentConfig);
    res.json({ ok: true });
  });
  app.get("/api/telemetry", async (_req, res) => {
    const { sourceMode, agentEnabled, agentUrl, agentToken } = currentConfig.integrations;
    const integ = await getCachedOrRefreshIntegrations(currentConfig);
    const snapshot = await resolveTelemetry(
      sourceMode,
      agentEnabled,
      agentUrl,
      agentToken,
      integ.haConnected
    );
    const exposedEntities = buildExposedEntities(
      snapshot,
      integ.haEntities,
      integ.customConnections,
      currentConfig.entityOverrides
    );
    const maskedCustom = integ.customConnections.map((cc) => ({
      ...cc,
      token: "",
      tokenSet: Boolean(cc.token)
    }));
    res.json({
      snapshot,
      haConnected: integ.haConnected,
      haEntities: integ.haEntities,
      exposedEntities,
      customConnections: maskedCustom
    });
  });
  app.post("/api/tasks/trigger", (req, res) => {
    const parsed = TaskTriggerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid task trigger payload." });
      return;
    }
    triggerTaskState(parsed.data.taskId, parsed.data.action);
    res.json({ ok: true });
  });
  app.post("/api/integrations/test-agent", async (req, res) => {
    const parsed = TestAgentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, message: "Valid Agent URL is required." });
      return;
    }
    const tokenToUse = parsed.data.agentToken?.trim() || currentConfig.integrations.agentToken;
    const targetUrl = `${parsed.data.agentUrl.replace(/\/+$/, "")}/api/v1/health`;
    try {
      const headers = { Accept: "application/json" };
      if (tokenToUse) headers.Authorization = `Bearer ${tokenToUse}`;
      const r = await safeOutboundFetch(targetUrl, {
        headers,
        timeoutMs: 2500,
        maxBytes: DEFAULT_UPSTREAM_MAX_BYTES
      });
      if (!r.ok) {
        res.json({ ok: false, status: r.status, message: `Upstream responded with HTTP ${r.status}` });
        return;
      }
      res.json({ ok: true, status: r.status, message: "Connected to Unraid Management Agent" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unable to reach Unraid Management Agent";
      const status = msg.includes("SSRF") || msg.includes("blocked") || msg.includes("scheme") ? 403 : 502;
      res.status(status).json({ ok: false, message: msg });
    }
  });
  app.post("/api/integrations/test-ha", async (req, res) => {
    const parsed = TestHaSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, message: "Home Assistant URL is required." });
      return;
    }
    const tokenToUse = parsed.data.haToken?.trim() || currentConfig.integrations.haToken;
    if (!tokenToUse) {
      res.status(400).json({ ok: false, message: "Home Assistant Long-Lived Token is required." });
      return;
    }
    const targetUrl = `${parsed.data.haUrl.replace(/\/+$/, "")}/api/`;
    try {
      const r = await safeOutboundFetch(targetUrl, {
        headers: { Authorization: `Bearer ${tokenToUse}`, Accept: "application/json" },
        timeoutMs: 2500,
        maxBytes: DEFAULT_UPSTREAM_MAX_BYTES
      });
      if (!r.ok) {
        res.json({ ok: false, status: r.status, message: `Home Assistant responded with HTTP ${r.status}` });
        return;
      }
      res.json({ ok: true, status: r.status, message: "Connected to Home Assistant API" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unable to reach Home Assistant";
      const status = msg.includes("SSRF") || msg.includes("blocked") || msg.includes("scheme") ? 403 : 502;
      res.status(status).json({ ok: false, message: msg });
    }
  });
  app.post("/api/integrations/test-custom", async (req, res) => {
    const parsed = TestCustomSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, message: "Valid HTTP/HTTPS endpoint URL is required." });
      return;
    }
    const { url, token, jsonPath } = parsed.data;
    try {
      const headers = { Accept: "application/json" };
      if (token?.trim()) headers.Authorization = `Bearer ${token.trim()}`;
      const r = await safeOutboundFetch(url.trim(), {
        headers,
        timeoutMs: 2500,
        maxBytes: DEFAULT_UPSTREAM_MAX_BYTES
      });
      if (!r.ok) {
        res.json({ ok: false, status: r.status, message: `Endpoint responded with HTTP ${r.status}` });
        return;
      }
      const rawText = r.bodyBuffer.toString("utf8");
      let parsedJson = null;
      let isJson = false;
      try {
        parsedJson = JSON.parse(rawText);
        isJson = true;
      } catch {
        isJson = false;
      }
      const suggestedPaths = [];
      if (isJson && parsedJson && typeof parsedJson === "object") {
        const collectPaths = (node, prefix, depth) => {
          if (suggestedPaths.length >= 24 || depth > 3 || !node || typeof node !== "object") return;
          if (Array.isArray(node)) {
            if (node.length > 0 && (typeof node[0] === "number" || typeof node[0] === "string")) {
              suggestedPaths.push({ path: `${prefix}.0`, value: String(node[0]) });
            }
            return;
          }
          for (const [k, v] of Object.entries(node)) {
            if (suggestedPaths.length >= 24) break;
            const nextPath = prefix ? `${prefix}.${k}` : k;
            if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
              suggestedPaths.push({ path: nextPath, value: String(v).slice(0, 48) });
            } else if (v && typeof v === "object") {
              collectPaths(v, nextPath, depth + 1);
            }
          }
        };
        collectPaths(parsedJson, "", 0);
      }
      const extracted = isJson ? getByJsonPath(parsedJson, jsonPath?.trim() || void 0) : rawText.trim().slice(0, 64);
      const previewValue = extracted !== null ? String(extracted) : isJson ? JSON.stringify(parsedJson).slice(0, 96) : rawText.trim().slice(0, 96);
      res.json({
        ok: true,
        status: r.status,
        message: extracted !== null ? `Reachable \xB7 Extracted value: ${String(extracted)}` : jsonPath?.trim() ? `Reachable (HTTP ${r.status}), but path "${jsonPath.trim()}" was not found. Pick a key below.` : `Reachable (HTTP ${r.status})`,
        extractedValue: extracted !== null ? String(extracted) : null,
        previewValue,
        suggestedPaths
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unable to reach custom endpoint";
      const status = msg.includes("SSRF") || msg.includes("blocked") || msg.includes("scheme") ? 403 : 502;
      res.status(status).json({ ok: false, message: msg });
    }
  });
  app.get("/api/ha/entities", async (_req, res) => {
    const { haEnabled, haUrl, haToken } = currentConfig.integrations;
    const result = await fetchHomeAssistantEntities(haEnabled, haUrl, haToken);
    res.json(result);
  });
  app.get("/api/hardware/devices", (_req, res) => {
    const devices = scanUsbSerialDevices();
    res.json({
      devices,
      lastFrame: getLastFrameMeta(),
      daemonStatus: getDaemonStatus(),
      hardwareDeploy: currentConfig.hardwareDeploy,
      diagnostics: buildDiagnosticsSnapshot(
        isSessionPushArmed(),
        currentConfig.hardware.devicePath,
        getDaemonStatus().daemonState
      )
    });
  });
  app.get("/api/hardware/status", (_req, res) => {
    res.json({
      devices: scanUsbSerialDevices(),
      lastFrame: getLastFrameMeta(),
      daemonStatus: getDaemonStatus(),
      hardwareDeploy: currentConfig.hardwareDeploy,
      diagnostics: buildDiagnosticsSnapshot(
        isSessionPushArmed(),
        currentConfig.hardware.devicePath,
        getDaemonStatus().daemonState
      )
    });
  });
  app.get("/api/diagnostics", (_req, res) => {
    res.json(
      buildDiagnosticsSnapshot(
        isSessionPushArmed(),
        currentConfig.hardware.devicePath,
        getDaemonStatus().daemonState
      )
    );
  });
  app.get("/api/hardware/preview.png", async (req, res) => {
    try {
      const requestedId = typeof req.query.screenId === "string" ? req.query.screenId : void 0;
      const scr = currentConfig.screens.find((s) => s.id === (requestedId || currentConfig.activeScreenId)) || currentConfig.screens[0];
      if (!scr) {
        res.status(404).json({ error: "No screen configured." });
        return;
      }
      const integ = await getCachedOrRefreshIntegrations(currentConfig);
      const { sourceMode, agentEnabled, agentUrl, agentToken } = currentConfig.integrations;
      const snapshot = await resolveTelemetry(
        sourceMode,
        agentEnabled,
        agentUrl,
        agentToken,
        integ.haConnected
      );
      const exposedEntities = buildExposedEntities(
        snapshot,
        integ.haEntities,
        integ.customConnections,
        currentConfig.entityOverrides
      );
      const png = renderScreenToPngBuffer({
        screen: scr,
        telemetry: snapshot,
        haEntities: integ.haEntities,
        exposedEntities,
        dockerIcons: currentConfig.dockerIcons,
        rotation: currentConfig.hardware.rotation,
        brightnessPercent: currentConfig.hardware.brightness,
        blank: false
      });
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "no-store");
      res.send(png);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Preview render failed" });
    }
  });
  app.post("/api/hardware/dry-run", async (req, res) => {
    const { screenId, rgbaBase64 } = req.body || {};
    try {
      const scr = currentConfig.screens.find((s) => s.id === (screenId || currentConfig.activeScreenId)) || currentConfig.screens[0];
      let rgbaBuffer;
      if (rgbaBase64) {
        rgbaBuffer = Buffer.from(rgbaBase64, "base64");
      } else {
        const integ = await getCachedOrRefreshIntegrations(currentConfig);
        const { sourceMode, agentEnabled, agentUrl, agentToken } = currentConfig.integrations;
        const snapshot = await resolveTelemetry(
          sourceMode,
          agentEnabled,
          agentUrl,
          agentToken,
          integ.haConnected
        );
        const exposedEntities = buildExposedEntities(
          snapshot,
          integ.haEntities,
          integ.customConnections,
          currentConfig.entityOverrides
        );
        rgbaBuffer = renderScreenToRgbaBuffer({
          screen: scr,
          telemetry: snapshot,
          haEntities: integ.haEntities,
          exposedEntities,
          dockerIcons: currentConfig.dockerIcons,
          rotation: currentConfig.hardware.rotation,
          brightnessPercent: currentConfig.hardware.brightness,
          blank: false
        });
      }
      const result = dryRunScreenFrame({
        rgbaBuffer,
        screenId: scr?.id || "dry-run",
        screenName: scr?.name || "Dry Run Screen"
      });
      res.json({
        ...result,
        diagnostics: buildDiagnosticsSnapshot(
          isSessionPushArmed(),
          currentConfig.hardware.devicePath,
          getDaemonStatus().daemonState
        )
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({
        error: msg,
        diagnostics: buildDiagnosticsSnapshot(
          isSessionPushArmed(),
          currentConfig.hardware.devicePath,
          getDaemonStatus().daemonState
        )
      });
    }
  });
  app.post("/api/hardware/test-asterctl", async (req, res) => {
    const { testRealDevice, action, confirmed } = req.body || {};
    try {
      const result = await testAsterctlIntegration({
        requestedDevicePath: currentConfig.hardware.devicePath,
        testRealDevice: Boolean(testRealDevice),
        action,
        confirmed: Boolean(confirmed)
      });
      res.json({
        ...result,
        diagnostics: buildDiagnosticsSnapshot(
          isSessionPushArmed(),
          currentConfig.hardware.devicePath,
          getDaemonStatus().daemonState
        )
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({
        ok: false,
        error: msg,
        diagnostics: buildDiagnosticsSnapshot(
          isSessionPushArmed(),
          currentConfig.hardware.devicePath,
          getDaemonStatus().daemonState
        )
      });
    }
  });
  app.post("/api/hardware/safe-test", async (req, res) => {
    const parsed = SafeTestRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Explicit confirmation (confirmed: true) is required before writing to the physical LCD."
      });
      return;
    }
    try {
      const result = await runSafeHardwareTest({
        confirmed: true,
        mode: parsed.data.mode,
        devicePath: currentConfig.hardware.devicePath,
        rgbaBuffer: parsed.data.rgbaBase64 ? Buffer.from(parsed.data.rgbaBase64, "base64") : void 0
      });
      res.json({
        ...result,
        diagnostics: buildDiagnosticsSnapshot(
          isSessionPushArmed(),
          currentConfig.hardware.devicePath,
          getDaemonStatus().daemonState
        )
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = msg.includes("Serial writes") || msg.includes("Emergency stop") ? 403 : 500;
      res.status(status).json({
        ok: false,
        error: msg,
        lastFrame: getLastFrameMeta(),
        diagnostics: buildDiagnosticsSnapshot(
          isSessionPushArmed(),
          currentConfig.hardware.devicePath,
          getDaemonStatus().daemonState
        )
      });
    }
  });
  app.post("/api/display/on", async (_req, res) => {
    try {
      const meta = await turnDisplayOnManual(
        () => currentConfig,
        (patch) => {
          currentConfig.hardwareDeploy = { ...currentConfig.hardwareDeploy, ...patch };
        }
      );
      res.json({
        ok: true,
        meta,
        daemonStatus: getDaemonStatus(),
        diagnostics: buildDiagnosticsSnapshot(
          isSessionPushArmed(),
          currentConfig.hardware.devicePath,
          getDaemonStatus().daemonState
        )
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = msg.includes("Serial writes") || msg.includes("Emergency stop") ? 403 : 500;
      res.status(status).json({
        ok: false,
        error: msg,
        diagnostics: buildDiagnosticsSnapshot(
          isSessionPushArmed(),
          currentConfig.hardware.devicePath,
          getDaemonStatus().daemonState
        )
      });
    }
  });
  app.post("/api/display/off", async (_req, res) => {
    try {
      const meta = await turnDisplayOffManual(
        () => currentConfig,
        (patch) => {
          currentConfig.hardwareDeploy = { ...currentConfig.hardwareDeploy, ...patch };
        }
      );
      res.json({
        ok: true,
        meta,
        daemonStatus: getDaemonStatus(),
        diagnostics: buildDiagnosticsSnapshot(
          isSessionPushArmed(),
          currentConfig.hardware.devicePath,
          getDaemonStatus().daemonState
        )
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = msg.includes("Serial writes") || msg.includes("Emergency stop") ? 403 : 500;
      res.status(status).json({
        ok: false,
        error: msg,
        diagnostics: buildDiagnosticsSnapshot(
          isSessionPushArmed(),
          currentConfig.hardware.devicePath,
          getDaemonStatus().daemonState
        )
      });
    }
  });
  app.post("/api/hardware/force-refresh", async (_req, res) => {
    try {
      const meta = await forceFullRefreshNow(
        () => currentConfig,
        (patch) => {
          currentConfig.hardwareDeploy = { ...currentConfig.hardwareDeploy, ...patch };
        }
      );
      res.json({
        ok: true,
        meta: meta ?? getLastFrameMeta(),
        daemonStatus: getDaemonStatus(),
        diagnostics: buildDiagnosticsSnapshot(
          isSessionPushArmed(),
          currentConfig.hardware.devicePath,
          getDaemonStatus().daemonState
        )
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = msg.includes("Serial writes") || msg.includes("Emergency stop") ? 403 : 500;
      res.status(status).json({
        ok: false,
        error: msg,
        diagnostics: buildDiagnosticsSnapshot(
          isSessionPushArmed(),
          currentConfig.hardware.devicePath,
          getDaemonStatus().daemonState
        )
      });
    }
  });
  app.post("/api/hardware/stop-serial", async (_req, res) => {
    await emergencyStopDaemon(
      Boolean(currentConfig.hardware.powerOffOnEmergencyStop),
      currentConfig.hardware.devicePath
    );
    currentConfig.hardware.autoPushEnabled = false;
    currentConfig.hardwareDeploy.deployed = false;
    currentConfig.hardwareDeploy.daemonState = "stopped";
    saveConfig(currentConfig);
    res.json({
      ok: true,
      message: "Emergency stop activated: closed serial port, stopped asterctl, and disabled auto-push.",
      diagnostics: buildDiagnosticsSnapshot(
        isSessionPushArmed(),
        currentConfig.hardware.devicePath,
        getDaemonStatus().daemonState
      )
    });
  });
  app.post("/api/hardware/clear-emergency-stop", (_req, res) => {
    clearEmergencyStop();
    resetDaemonBackoff();
    res.json({
      ok: true,
      diagnostics: buildDiagnosticsSnapshot(
        isSessionPushArmed(),
        currentConfig.hardware.devicePath,
        getDaemonStatus().daemonState
      )
    });
  });
  app.post("/api/hardware/deploy", async (req, res) => {
    const parsed = DeployRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid deploy payload." });
      return;
    }
    const { screens, activeScreenId } = parsed.data;
    if (Array.isArray(screens) && screens.length > 0) {
      const incomingById = new Map(screens.map((s) => [s.id, s]));
      const mergedScreens = currentConfig.screens.map((s) => incomingById.get(s.id) ?? s);
      for (const s of screens) {
        if (!mergedScreens.some((existing) => existing.id === s.id)) {
          mergedScreens.push(s);
        }
      }
      currentConfig.screens = mergedScreens;
    }
    const enabledPlaylist = currentConfig.screens.filter((s) => s.enabled);
    const targetScreens = enabledPlaylist.length > 0 ? enabledPlaylist : currentConfig.screens;
    const startIndex = activeScreenId ? Math.max(0, targetScreens.findIndex((s) => s.id === activeScreenId)) : 0;
    if (!isSerialWritesActive()) {
      res.status(403).json({
        error: "Serial writes are disabled. Validate packets via Diagnostics -> Dry run first, then set AOOSTAR_ENABLE_SERIAL_WRITES=true or unlock serial writes in Settings.",
        meta: getLastFrameMeta(),
        diagnostics: buildDiagnosticsSnapshot(
          isSessionPushArmed(),
          currentConfig.hardware.devicePath,
          getDaemonStatus().daemonState
        )
      });
      return;
    }
    currentConfig.hardware.autoPushEnabled = true;
    currentConfig.hardwareDeploy = {
      ...currentConfig.hardwareDeploy,
      deployed: true,
      deployedAt: (/* @__PURE__ */ new Date()).toISOString(),
      activeIndex: startIndex,
      currentScreenId: targetScreens[startIndex]?.id ?? null,
      currentScreenName: targetScreens[startIndex]?.name ?? null,
      daemonState: "active",
      lastError: null,
      screens: structuredClone(targetScreens)
    };
    saveConfig(currentConfig);
    armSessionPush(true);
    resetDaemonRotation(startIndex);
    resetDaemonBackoff();
    resetFrameDiffCache();
    try {
      const meta = await runHardwareDaemonTick(
        () => currentConfig,
        (patch) => {
          currentConfig.hardwareDeploy = { ...currentConfig.hardwareDeploy, ...patch };
        },
        void 0,
        { forceFullRefresh: true }
      );
      res.json({
        meta: meta ?? getLastFrameMeta(),
        daemonStatus: getDaemonStatus(),
        hardware: currentConfig.hardware,
        hardwareDeploy: currentConfig.hardwareDeploy
      });
    } catch (err) {
      armSessionPush(false);
      currentConfig.hardwareDeploy.deployed = false;
      currentConfig.hardwareDeploy.daemonState = "error";
      const msg = err instanceof Error ? err.message : String(err);
      currentConfig.hardwareDeploy.lastError = msg;
      saveConfig(currentConfig);
      const status = msg.includes("Emergency stop") || msg.includes("Serial writes") ? 403 : 500;
      res.status(status).json({
        error: msg,
        meta: getLastFrameMeta(),
        daemonStatus: getDaemonStatus(),
        hardwareDeploy: currentConfig.hardwareDeploy
      });
    }
  });
  app.post("/api/hardware/push-frame", async (req, res) => {
    const parsed = PushFrameRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid push-frame payload." });
      return;
    }
    const { screenId, screenName } = parsed.data;
    try {
      const scr = currentConfig.screens.find((s) => s.id === (screenId || currentConfig.activeScreenId)) || currentConfig.screens[0];
      const integ = await getCachedOrRefreshIntegrations(currentConfig);
      const { sourceMode, agentEnabled, agentUrl, agentToken } = currentConfig.integrations;
      const snapshot = await resolveTelemetry(
        sourceMode,
        agentEnabled,
        agentUrl,
        agentToken,
        integ.haConnected
      );
      const exposedEntities = buildExposedEntities(
        snapshot,
        integ.haEntities,
        integ.customConnections,
        currentConfig.entityOverrides
      );
      const brightness = currentConfig.hardware.brightness;
      const rgbaBuffer = renderScreenToRgbaBuffer({
        screen: scr,
        telemetry: snapshot,
        haEntities: integ.haEntities,
        exposedEntities,
        dockerIcons: currentConfig.dockerIcons,
        rotation: currentConfig.hardware.rotation,
        brightnessPercent: brightness,
        blank: false
      });
      const meta = await pushHardwareFrame({
        rgbaBuffer,
        screenId: scr?.id || currentConfig.activeScreenId,
        screenName: screenName || scr?.name || "Active Screen",
        devicePath: currentConfig.hardware.devicePath,
        brightnessPercent: 100,
        // already applied in unified server-side renderer
        brightnessKey: brightness
      });
      res.json(meta);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = msg.includes("Emergency stop") || msg.includes("Serial writes") ? 403 : 500;
      res.status(status).json({
        error: msg,
        meta: getLastFrameMeta()
      });
    }
  });
  app.get("/api/hardware/last-frame.rgb565", (_req, res) => {
    const buf = getLastFrameBuffer();
    if (!buf) {
      res.status(404).json({ error: "No frame pushed or dry-run built yet." });
      return;
    }
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", 'attachment; filename="aoostar-960x376.rgb565"');
    res.send(buf);
  });
  app.get("/api/export/unraid-xml", (_req, res) => {
    res.setHeader("Content-Type", "application/xml");
    res.send(generateUnraidCommunityAppsXml(port));
  });
  app.get("/api/export/docker-compose", (_req, res) => {
    res.setHeader("Content-Type", "text/yaml");
    res.send(generateDockerCompose());
  });
  return {
    app,
    dataDir,
    bindHost,
    port,
    getCredentialStore: () => credentialStore,
    getConfig: () => currentConfig,
    startBackgroundDaemons: () => {
      startIntegrationPoller(() => currentConfig, Math.max(2500, currentConfig.hardware.pollIntervalMs || 5e3));
      startHardwareDaemon(
        () => currentConfig,
        (patch) => {
          currentConfig.hardwareDeploy = { ...currentConfig.hardwareDeploy, ...patch };
        }
      );
    },
    shutdown: async () => {
      clearInterval(sweepTimer);
      stopIntegrationPoller();
      await gracefulShutdownHardware(() => currentConfig);
    }
  };
}
async function bootstrap() {
  const ctx = createStudioApp();
  const { app, bindHost, port } = ctx;
  if (process.env.NODE_ENV === "production") {
    const distDir = path6.resolve(process.cwd(), "dist");
    app.use(express.static(distDir));
    app.get("*", (_req, res) => {
      res.sendFile(path6.join(distDir, "index.html"));
    });
  } else {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  }
  const server = app.listen(port, bindHost, () => {
    console.log(`Aoostar Display Studio v${APP_VERSION} listening on http://${bindHost}:${port}`);
    const detected = scanUsbSerialDevices();
    const bin = detectAsterctlBinary();
    const aoostar = detected.find((d) => d.isAoostarMatch);
    console.log(
      `[aoostar-startup] bind=${bindHost} | serialWritesActive=${isSerialWritesActive()} | asterctl=${bin.available ? `${bin.binaryPath} (${bin.version})` : `unavailable (${bin.error})`} | usb=${aoostar ? `${aoostar.path} (${aoostar.vendorId}:${aoostar.productId}, rw=${aoostar.writable})` : "not detected (0416:90a1)"}`
    );
    ctx.startBackgroundDaemons();
  });
  let shutdownInProgress = false;
  const handleSignal = (sig) => {
    if (shutdownInProgress) return;
    shutdownInProgress = true;
    console.log(`[aoostar-shutdown] Received ${sig}, stopping daemon & closing serial transport...`);
    void ctx.shutdown().catch(() => {
    }).finally(() => {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 2500).unref?.();
    });
  };
  process.on("SIGINT", () => handleSignal("SIGINT"));
  process.on("SIGTERM", () => handleSignal("SIGTERM"));
}
if (process.env.AOOSTAR_NO_AUTOSTART !== "true") {
  void bootstrap();
}
export {
  APP_VERSION,
  createStudioApp
};
