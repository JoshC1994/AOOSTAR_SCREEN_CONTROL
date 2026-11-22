import {useState} from 'react';
import {ChevronLeft, ChevronRight, X} from 'lucide-react';

interface QuickGuideModalProps {
  open: boolean;
  onClose: () => void;
}

interface GuideStep {
  title: string;
  tabHint: string;
  summary: string;
  bullets: string[];
}

const GUIDE_STEPS: GuideStep[] = [
  {
    title: '1. Connect Sources & Review Entities',
    tabHint: 'Connections & Entities Tabs',
    summary:
      'Local Unraid/Linux host telemetry runs automatically. Add Home Assistant or custom JSON endpoints whenever you want extra sensors.',
    bullets: [
      'Local server stats (CPU, RAM, disk thermals, Docker containers, SMB users, and running tasks) are always active.',
      'Open Connections to link Home Assistant (URL + Long-Lived Token) or custom local HTTP/JSON APIs.',
      'Open Entities to rename tags, adjust units, or place any metric directly onto the screen with one click.',
    ],
  },
  {
    title: '2. Build & Customize Display Screens',
    tabHint: 'Screens Tab',
    summary:
      'Design layouts on the live 960×376 canvas using generic blocks, media, themes, or custom code.',
    bullets: [
      'Click + Add Screen to choose Blank, Saved, or one of the ready-made Templates.',
      'Drag or click blocks (Number, Line/Area Graph, Radial Gauge, Bars, Image/GIF/Video, Custom HTML, ApexCharts) onto the canvas.',
      'Click any block to keep its inspector open on the right—adjust entities, colors (swatches or color wheel), fonts, sizes, or block background images.',
    ],
  },
  {
    title: '3. Import Media & Apply Themes',
    tabHint: 'Left Drawer -> Themes & Media Library',
    summary:
      'Upload PNG, JPG, GIF, SVG, or MP4/WebM loops into your Media Library and switch screen palettes in one click.',
    bullets: [
      'Use Media Library to import custom GIFs, images, or videos, rename them inline, or remove unused files.',
      'Every imported image or GIF automatically appears inside Image/GIF/Video blocks and Block Background Image selectors.',
      'Use Themes to apply Dark Obsidian, Minimal Light, Hawaiian Sunset, Tech Circuit, Rack Terminal, or Alert Ops across a screen.',
    ],
  },
  {
    title: '4. Manage Rotation, Brightness & Sleep',
    tabHint: 'Saved Screens & Settings Tabs',
    summary:
      'Control which screens appear in rotation and configure hardware panel behavior.',
    bullets: [
      'Use Saved Screens to toggle any screen Active or Paused (paused screens are removed from rotation), edit layouts, or delete screens.',
      'Open Settings to set individual screen display times, panel brightness, 0°/90°/180°/270° orientation, overnight sleep schedules, and Docker container icons.',
    ],
  },
  {
    title: '5. Push to Screen Once & Let It Run',
    tabHint: 'Top Header -> Push to Screen',
    summary:
      'One button deploys your active screens to the Aoostar USB-UART hardware daemon.',
    bullets: [
      'Click Push to Screen in the top-right header to push your active screens to the 960×376 LCD.',
      'The background daemon continues refreshing live telemetry and rotating screens automatically—even with no browser open or after an Unraid reboot.',
      'You can reopen this guide anytime from the Info tab.',
    ],
  },
];

export function QuickGuideModal({open, onClose}: QuickGuideModalProps) {
  const [stepIndex, setStepIndex] = useState(0);

  if (!open) return null;

  const step = GUIDE_STEPS[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === GUIDE_STEPS.length - 1;

  const handleClose = () => {
    setStepIndex(0);
    onClose();
  };

  return (
    <div
      onClick={handleClose}
      className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl rounded-xl border border-[#263042] bg-[#0F131C] p-6 space-y-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 pb-3 border-b border-[#1F2937]">
          <div>
            <div className="text-[11px] font-mono text-amber-400">
              Quick How-To Guide · Step {stepIndex + 1} of {GUIDE_STEPS.length}
            </div>
            <h2 className="text-lg font-display font-semibold text-slate-100 mt-0.5">
              {step.title}
            </h2>
            <div className="text-xs text-slate-400 mt-0.5">{step.tabHint}</div>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded text-slate-400 hover:text-white"
            title="Close guide"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Step selector strip */}
        <div className="grid grid-cols-5 gap-1.5">
          {GUIDE_STEPS.map((item, idx) => (
            <button
              key={item.title}
              onClick={() => setStepIndex(idx)}
              className={`py-1.5 px-2 rounded border text-[11px] font-mono transition-colors ${
                idx === stepIndex
                  ? 'border-amber-500/70 bg-amber-500/15 text-amber-300 font-semibold'
                  : 'border-[#1F2937] bg-[#0B0E14] text-slate-400 hover:text-slate-200 hover:border-slate-600'
              }`}
            >
              Step {idx + 1}
            </button>
          ))}
        </div>

        <div className="rounded-lg border border-[#1F2937] bg-[#0B0E14] p-4 space-y-3">
          <p className="text-xs text-slate-200 leading-relaxed">{step.summary}</p>
          <ul className="space-y-2 text-xs text-slate-300 leading-relaxed list-disc pl-4">
            {step.bullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
        </div>

        <div className="flex items-center justify-between gap-3 pt-1">
          <button
            onClick={handleClose}
            className="text-xs text-slate-400 hover:text-slate-200 transition-colors"
          >
            Skip Guide
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
              disabled={isFirst}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded border border-[#263042] bg-[#141A26] text-xs text-slate-200 hover:border-slate-500 disabled:opacity-35 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Back
            </button>

            {!isLast ? (
              <button
                onClick={() => setStepIndex((i) => Math.min(GUIDE_STEPS.length - 1, i + 1))}
                className="inline-flex items-center gap-1 px-4 py-1.5 rounded bg-amber-500 text-slate-950 hover:bg-amber-400 text-xs font-semibold"
              >
                Next
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                onClick={handleClose}
                className="px-4 py-1.5 rounded bg-amber-500 text-slate-950 hover:bg-amber-400 text-xs font-semibold"
              >
                Get Started
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
