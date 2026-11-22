import {useEffect, useState} from 'react';
import {Check, ChevronDown, Copy, Download, RefreshCw, Terminal, Usb} from 'lucide-react';
import type {DetectedUsbDevice, LastFrameMeta, StudioConfig} from '../types.ts';

interface HardwareDeployViewProps {
  config: StudioConfig;
  lastFrame: LastFrameMeta | null;
  onUpdateConfig: (updater: (prev: StudioConfig) => StudioConfig) => void;
}

export function HardwareDeployView({config, lastFrame, onUpdateConfig}: HardwareDeployViewProps) {
  const [devices, setDevices] = useState<DetectedUsbDevice[]>([]);
  const [frameMeta, setFrameMeta] = useState<LastFrameMeta | null>(lastFrame);
  const [deployTab, setDeployTab] = useState<'plg' | 'xml' | 'compose'>('plg');
  const [exportCode, setExportCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [showTechDetails, setShowTechDetails] = useState(false);

  const scanHardware = async () => {
    try {
      const res = await fetch('/api/hardware/devices');
      const data = (await res.json()) as {devices: DetectedUsbDevice[]; lastFrame: LastFrameMeta};
      setDevices(data.devices);
      setFrameMeta(data.lastFrame);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    void scanHardware();
  }, []);

  useEffect(() => {
    if (lastFrame) setFrameMeta(lastFrame);
  }, [lastFrame]);

  useEffect(() => {
    const endpoint =
      deployTab === 'plg'
        ? '/api/export/unraid-plg'
        : deployTab === 'xml'
          ? '/api/export/unraid-xml'
          : '/api/export/docker-compose';
    fetch(endpoint)
      .then((r) => r.text())
      .then((txt) => setExportCode(txt))
      .catch(() => setExportCode(''));
  }, [deployTab]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(exportCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleDownload = () => {
    const filename =
      deployTab === 'plg'
        ? 'aoostar-display-studio.plg'
        : deployTab === 'xml'
          ? 'my-aoostar-display-studio.xml'
          : 'docker-compose.yml';
    const blob = new Blob([exportCode], {type: 'text/plain;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-[1280px] mx-auto p-6 space-y-6">
      {/* Native Unraid Plugin (.plg) & Testing Guide */}
      <section className="rounded-lg border border-[#1F2937] bg-[#0F131C] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#1F2937] flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-base font-display font-semibold text-slate-100 flex items-center gap-2">
              <Terminal className="w-4 h-4 text-amber-400" />
              Native Unraid Plugin (.plg) &amp; Testing Guide
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Download the `.plg` manifest to install directly via Unraid Plugins or submit to Community Applications.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center p-0.5 rounded bg-[#0B0E14] border border-[#1F2937]">
              {(
                [
                  ['plg', 'Unraid Plugin (.plg)'],
                  ['xml', 'Docker Template (.xml)'],
                  ['compose', 'Docker Compose'],
                ] as const
              ).map(([tab, label]) => (
                <button
                  key={tab}
                  onClick={() => setDeployTab(tab)}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                    deployTab === tab ? 'bg-amber-500 text-slate-950' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <button
              onClick={() => void handleCopy()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-[#263042] bg-[#141A26] text-xs text-slate-200 hover:bg-[#1E2638]"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              onClick={handleDownload}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-amber-500 text-slate-950 hover:bg-amber-400 text-xs font-semibold"
            >
              <Download className="w-3.5 h-3.5" />
              Download {deployTab === 'plg' ? '.plg' : deployTab === 'xml' ? '.xml' : '.yml'}
            </button>
          </div>
        </div>

        <pre className="p-5 bg-[#090C11] text-xs font-mono text-slate-300 overflow-x-auto max-h-[360px] leading-relaxed border-b border-[#1F2937]">
          {exportCode}
        </pre>

        {/* How to Test on Unraid */}
        <div className="p-5 bg-[#0D111A] space-y-3">
          <h2 className="text-sm font-semibold text-slate-100">How to Test the `.plg` Plugin on Your Unraid Server</h2>
          <ol className="space-y-2 text-xs text-slate-300 list-decimal list-inside leading-relaxed">
            <li>
              Click <span className="font-semibold text-slate-100">Download .plg</span> above and copy <code className="font-mono text-amber-300">aoostar-display-studio.plg</code> to your Unraid flash drive at <code className="font-mono text-slate-200">/boot/config/plugins/</code> (or host it in a GitHub repo and paste the raw URL into <span className="text-slate-100">Plugins -&gt; Install Plugin</span>).
            </li>
            <li>
              In the Unraid Web Terminal (or SSH), run the native installer test command:
              <code className="block mt-1 p-2 rounded bg-[#090C11] border border-[#1F2937] font-mono text-emerald-400">
                plugin install /boot/config/plugins/aoostar-display-studio.plg
              </code>
            </li>
            <li>
              Copy your built app bundle (<code className="font-mono text-slate-200">dist/</code>, <code className="font-mono text-slate-200">server.ts</code>, <code className="font-mono text-slate-200">src/</code>, <code className="font-mono text-slate-200">package.json</code>, <code className="font-mono text-slate-200">node_modules/</code>) into <code className="font-mono text-slate-200">/usr/local/emhttp/plugins/aoostar-display-studio/app/</code> and start the service:
              <code className="block mt-1 p-2 rounded bg-[#090C11] border border-[#1F2937] font-mono text-emerald-400">
                /boot/config/plugins/aoostar-display-studio/rc.aoostar-display-studio start
              </code>
            </li>
            <li>
              Verify the USB LCD udev symlink &amp; service logs:
              <code className="block mt-1 p-2 rounded bg-[#090C11] border border-[#1F2937] font-mono text-sky-300">
                ls -l /dev/aoostar_lcd /dev/ttyACM* &amp;&amp; tail -n 30 /var/log/aoostar-display-studio.log
              </code>
            </li>
            <li>
              Open <span className="font-semibold text-slate-100">Utilities -&gt; Aoostar Display Studio</span> in the Unraid WebGUI (or browse to <code className="font-mono text-slate-200">http://&lt;UNRAID-IP&gt;:3088</code>). To uninstall cleanly while testing, run <code className="font-mono text-slate-200">plugin remove aoostar-display-studio.plg</code>.
            </li>
          </ol>
        </div>
      </section>

      {/* Aoostar Screen Hardware Settings */}
      <section className="rounded-lg border border-[#1F2937] bg-[#0F131C] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-[#1F2937]">
          <div>
            <h2 className="text-base font-display font-semibold text-slate-100 flex items-center gap-2">
              <Usb className="w-4 h-4 text-amber-400" />
              Aoostar USB Display Settings
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Brightness, orientation, night sleep hours, and USB serial target.
            </p>
          </div>
          <button
            onClick={() => void scanHardware()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-[#263042] bg-[#141A26] text-xs text-slate-200 hover:bg-[#1C2436]"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Check USB Screen
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">
              Screen Brightness ({config.hardware.brightness}%)
            </label>
            <input
              type="range"
              min={5}
              max={100}
              value={config.hardware.brightness}
              onChange={(e) =>
                onUpdateConfig((prev) => ({
                  ...prev,
                  hardware: {...prev.hardware, brightness: Number(e.target.value)},
                }))
              }
              className="w-full accent-amber-500 mt-2"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">Orientation</label>
            <select
              value={config.hardware.rotation}
              onChange={(e) =>
                onUpdateConfig((prev) => ({
                  ...prev,
                  hardware: {...prev.hardware, rotation: Number(e.target.value) as 0 | 90 | 180 | 270},
                }))
              }
              className="w-full px-3 py-1.5 rounded bg-[#0B0E14] border border-[#263042] text-xs text-slate-100"
            >
              <option value={0}>Normal (960×376)</option>
              <option value={180}>Flipped 180°</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">Night Sleep Hours</label>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={config.hardware.sleepScheduleEnabled}
                onChange={(e) =>
                  onUpdateConfig((prev) => ({
                    ...prev,
                    hardware: {...prev.hardware, sleepScheduleEnabled: e.target.checked},
                  }))
                }
                className="accent-amber-500"
              />
              <input
                type="time"
                value={config.hardware.sleepStart}
                onChange={(e) =>
                  onUpdateConfig((prev) => ({
                    ...prev,
                    hardware: {...prev.hardware, sleepStart: e.target.value},
                  }))
                }
                className="px-2 py-1 rounded bg-[#0B0E14] border border-[#263042] text-xs font-mono text-slate-200"
              />
              <span className="text-xs text-slate-500">to</span>
              <input
                type="time"
                value={config.hardware.sleepEnd}
                onChange={(e) =>
                  onUpdateConfig((prev) => ({
                    ...prev,
                    hardware: {...prev.hardware, sleepEnd: e.target.value},
                  }))
                }
                className="px-2 py-1 rounded bg-[#0B0E14] border border-[#263042] text-xs font-mono text-slate-200"
              />
            </div>
          </div>
        </div>

        <div className="pt-2 border-t border-[#1F2937]">
          <button
            onClick={() => setShowTechDetails((v) => !v)}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300 hover:text-white"
          >
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showTechDetails ? 'rotate-180' : ''}`} />
            USB Serial &amp; RGB565 Buffer Details
          </button>

          {showTechDetails && (
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-[#1A2130]">
              <div className="space-y-2">
                <label className="block text-[11px] font-medium text-slate-400">Serial Port Path</label>
                <input
                  type="text"
                  value={config.hardware.devicePath}
                  onChange={(e) =>
                    onUpdateConfig((prev) => ({
                      ...prev,
                      hardware: {...prev.hardware, devicePath: e.target.value},
                    }))
                  }
                  className="w-full px-3 py-1.5 rounded bg-[#0B0E14] border border-[#263042] text-xs font-mono text-slate-100"
                />
                <div className="text-xs text-slate-400">
                  {devices.length > 0
                    ? `Detected: ${devices.map((d) => `${d.path} (${d.vendorId}:${d.productId})`).join(', ')}`
                    : 'No USB-UART display attached in this browser preview. On Unraid, /dev/aoostar_lcd or /dev/ttyACM0 will appear.'}
                </div>
              </div>

              <div className="p-3 rounded bg-[#0B0E14] border border-[#1F2937] text-xs space-y-1.5 font-mono">
                <div className="flex justify-between">
                  <span className="text-slate-400">Frame Size:</span>
                  <span className="text-slate-200">960×376 RGB565 (721,920 B)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Last Checksum:</span>
                  <span className="text-amber-300">{frameMeta?.crc16Hex ?? 'Not pushed yet'}</span>
                </div>
                {frameMeta?.pushedAt && (
                  <div className="pt-1">
                    <a
                      href="/api/hardware/last-frame.rgb565"
                      className="text-sky-400 hover:underline inline-flex items-center gap-1"
                    >
                      <Download className="w-3 h-3" />
                      Download raw .rgb565 frame
                    </a>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
