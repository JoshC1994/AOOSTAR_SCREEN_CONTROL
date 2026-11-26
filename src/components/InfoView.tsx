import {BookOpen, Coffee, Monitor, Moon, Rocket, ShieldCheck, Sun} from 'lucide-react';
import type {UiThemePreference} from '../types.ts';

interface InfoViewProps {
  onOpenGuide: () => void;
  uiTheme: UiThemePreference;
  onChangeUiTheme: (theme: UiThemePreference) => void;
}

const THEME_OPTIONS: Array<{value: UiThemePreference; label: string; Icon: typeof Moon}> = [
  {value: 'dark', label: 'Dark', Icon: Moon},
  {value: 'light', label: 'Light', Icon: Sun},
  {value: 'system', label: 'System', Icon: Monitor},
];

export function InfoView({onOpenGuide, uiTheme, onChangeUiTheme}: InfoViewProps) {
  return (
    <div className="max-w-[960px] mx-auto p-6 space-y-6">
      <section className="rounded-lg border border-slate-200 dark:border-[#1F2937] bg-white dark:bg-[#0F131C] p-6 space-y-5 shadow-xs dark:shadow-none">
        <div className="pb-4 border-b border-slate-200 dark:border-[#1F2937] flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-display font-bold text-slate-900 dark:text-slate-100">
              Aoostar Display Studio
            </h1>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
              Open-source, local-first Docker display studio for Aoostar 960×376 USB-UART secondary NAS screens.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-mono text-amber-600 dark:text-amber-400 tabular-nums">
              Version {typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.0.5'}
            </span>
            <button
              onClick={onOpenGuide}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-300 dark:border-[#263042] bg-slate-100 dark:bg-[#141A26] hover:border-amber-500/60 text-xs font-medium text-slate-900 dark:text-slate-100 transition-colors whitespace-nowrap shrink-0"
            >
              <BookOpen className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
              Quick How-To Guide
            </button>
          </div>
        </div>

        {/* WebUI Appearance Selector */}
        <div className="p-4 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-200 dark:border-[#1F2937] flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              Studio Interface Theme
            </div>
            <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
              Choose Dark, Light, or follow your OS preference. LCD screen canvas colors remain unchanged.
            </div>
          </div>

          <div
            role="group"
            aria-label="Studio Interface Theme"
            className="inline-flex items-center p-1 rounded-md border border-slate-300 dark:border-[#263042] bg-white dark:bg-[#0F131C]"
          >
            {THEME_OPTIONS.map(({value, label, Icon}) => {
              const active = uiTheme === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => onChangeUiTheme(value)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-amber-500 text-slate-950'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div className="p-4 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-200 dark:border-[#1F2937] space-y-2">
            <div className="text-slate-500 dark:text-slate-400">Created &amp; Maintained By</div>
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              <a
                href="https://github.com/JoshC1994/AOOSTAR_SCREEN_CONTROL"
                target="_blank"
                rel="noreferrer"
                className="hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
              >
                JoshC1994 · AOOSTAR_SCREEN_CONTROL
              </a>
            </div>
            <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
              Designed for Unraid and standard Linux Docker hosts with automatic permission setup and non-root runtime isolation.
            </p>
            <div className="pt-1">
              <a
                href="https://buymeacoffee.com/M50wCmpncp"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-amber-500 text-slate-950 hover:bg-amber-400 text-xs font-semibold transition-colors"
              >
                <Coffee className="w-3.5 h-3.5" />
                Buy Me a Coffee
              </a>
            </div>
          </div>

          <div className="p-4 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-200 dark:border-[#1F2937] space-y-1.5">
            <div className="text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
              Security &amp; Open-Source Posture
            </div>
            <div className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
              100% Local · Auditable Source
            </div>
            <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
              Built to replace closed-source OEM Windows display software that raises privacy and security concerns. Runs completely locally in Docker with salted credential hashing, strict CSRF/Host guards, and zero outbound cloud telemetry.
            </p>
          </div>
        </div>

        {/* Platform & Next Stage Roadmap */}
        <div className="p-4 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-200 dark:border-[#1F2937] space-y-2 text-xs">
          <div className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Rocket className="w-3.5 h-3.5 text-sky-500" />
            Platform Compatibility &amp; Next Stage
          </div>
          <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
            Runs natively on <strong className="text-slate-800 dark:text-slate-200">Unraid</strong> and standard <strong className="text-slate-800 dark:text-slate-200">Linux Docker / Compose</strong> hosts with USB passthrough (<code className="font-mono">/dev/ttyACM0</code>). Because it is packaged as a standard non-root OCI container, <strong className="text-slate-800 dark:text-slate-200">TrueNAS SCALE</strong> and wider NAS container platforms can run the same image—dedicated TrueNAS SCALE custom app templates, ZFS pool collectors, and expanded multi-NAS presets are planned for the next stage.
          </p>
        </div>

        <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-[#1F2937]">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
            Acknowledgements &amp; Thanks
          </h2>
          <ul className="space-y-2 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            <li>
              <a
                href="https://github.com/zehnm/aoostar-rs"
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-amber-600 dark:text-amber-400 hover:underline"
              >
                zehnm / aoostar-rs
              </a>{' '}
              — Huge shoutout to <span className="font-semibold text-slate-900 dark:text-slate-100">zehnm</span> for reverse-engineering and documenting the Aoostar WTR MAX &amp; GEM12+ PRO secondary USB-UART display protocol (<code className="font-mono">VID 0x0416</code>, <code className="font-mono">PID 0x90A1</code>, 960×376 RGB565 LE framing).
            </li>
            <li>
              <span className="font-semibold text-slate-900 dark:text-slate-100">ApexCharts</span> — Interactive charting engine powering real-time graphs, gauges, and custom screen visualizations.
            </li>
            <li>
              <span className="font-semibold text-slate-900 dark:text-slate-100">Self-Hosted &amp; Unraid Community</span> — Hardware testing, feedback, and Community Applications support.
            </li>
          </ul>
        </div>

        <div className="space-y-2 pt-3 border-t border-slate-200 dark:border-[#1F2937]">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Open Source Licensing</h2>
          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            Copyright (c) 2026 JoshC1994. Released under the MIT / Apache-2.0 Open Source License. Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files, to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, subject to the standard warranty disclaimer.
          </p>
          <p className="text-[11px] font-mono text-slate-500 pt-1">
            Third-party libraries: React (MIT), Express (MIT), Tailwind CSS (MIT), ApexCharts (MIT), Lucide Icons (ISC).
          </p>
        </div>
      </section>
    </div>
  );
}
