import {BookOpen} from 'lucide-react';

interface InfoViewProps {
  onOpenGuide: () => void;
}

export function InfoView({onOpenGuide}: InfoViewProps) {
  return (
    <div className="max-w-[960px] mx-auto p-6 space-y-6">
      <section className="rounded-lg border border-[#1F2937] bg-[#0F131C] p-6 space-y-5">
        <div className="pb-4 border-b border-[#1F2937] flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-display font-bold text-slate-100">Aoostar Display Studio</h1>
            <p className="text-xs text-slate-400 mt-1">
              Local-first Unraid plugin &amp; 960×376 secondary LCD studio for Aoostar NAS hardware.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono text-amber-400">Version 1.0.0 (2026.11.22)</span>
            <button
              onClick={onOpenGuide}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-[#263042] bg-[#141A26] hover:border-amber-500/60 text-xs font-medium text-slate-100 transition-colors whitespace-nowrap shrink-0"
            >
              <BookOpen className="w-3.5 h-3.5 text-amber-400" />
              Quick How-To Guide
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div className="p-4 rounded bg-[#0B0E14] border border-[#1F2937]">
            <div className="text-slate-400">Created &amp; Maintained By</div>
            <div className="text-sm font-semibold text-slate-100 mt-1">JoshC1994</div>
            <div className="text-slate-400 mt-1">
              Designed for Unraid Community Applications &amp; native Unraid Plugin installations.
            </div>
          </div>

          <div className="p-4 rounded bg-[#0B0E14] border border-[#1F2937]">
            <div className="text-slate-400">Privacy &amp; Security Posture</div>
            <div className="text-sm font-semibold text-emerald-400 mt-1">100% Local Execution</div>
            <div className="text-slate-400 mt-1">
              Replaces proprietary OEM Windows software. Zero cloud connections, zero outbound telemetry.
            </div>
          </div>
        </div>

        <div className="space-y-3 pt-2 border-t border-[#1F2937]">
          <h2 className="text-sm font-semibold text-slate-200">Acknowledgements &amp; Thanks</h2>
          <ul className="space-y-2 text-xs text-slate-300 leading-relaxed">
            <li>
              <span className="font-semibold text-slate-100">zehnm/aoostar-rs</span> — Reverse-engineering the Aoostar WTR MAX &amp; GEM12+ PRO secondary USB-UART display protocol (`VID 0x0416`, `PID 0x90A1`, 960×376 RGB565 framing).
            </li>
            <li>
              <span className="font-semibold text-slate-100">ApexCharts</span> — Interactive charting engine powering real-time graphs, gauges, and custom user-coded screen visualizations.
            </li>
            <li>
              <span className="font-semibold text-slate-100">Unraid Community</span> — Feedback, plugin standards, and Community Applications ecosystem.
            </li>
          </ul>
        </div>

        <div className="space-y-2 pt-3 border-t border-[#1F2937]">
          <h2 className="text-sm font-semibold text-slate-200">Open Source Licensing</h2>
          <p className="text-xs text-slate-400 leading-relaxed">
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
