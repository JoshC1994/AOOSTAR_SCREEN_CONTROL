import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {ChevronLeft, ChevronRight, X} from 'lucide-react';

export type GuideTab = 'screens' | 'saved' | 'entities' | 'settings' | 'info';

interface QuickGuideModalProps {
  open: boolean;
  onClose: () => void;
  onNavigateTab: (tab: GuideTab) => void;
}

interface GuideStep {
  id: string;
  tab: GuideTab;
  targetSelector: string;
  preferredSide: 'bottom' | 'top' | 'left' | 'right';
  areaLabel: string;
  title: string;
  summary: string;
  bullets: string[];
}

const GUIDE_STEPS: GuideStep[] = [
  {
    id: 'add-screen',
    tab: 'screens',
    targetSelector: '[data-guide="add-screen-btn"]',
    preferredSide: 'bottom',
    areaLabel: 'Screens · Add or Preview',
    title: 'Clean Preview, Test Rotate & Screen Creation',
    summary:
      'Screens opens in a clean display preview. Switch screens above, preview cycling with Test Rotate, or click + Add Screen.',
    bullets: [
      'Blank starts an empty 960×376 canvas; Saved reuses any layout from your library.',
      'Templates loads ready-made telemetry, Docker, thermal, or Home Assistant screens.',
      'Test Rotate previews cycling in-browser without changing hardware Auto-Rotate settings.',
    ],
  },
  {
    id: 'edit-layout',
    tab: 'screens',
    targetSelector: '[data-guide="edit-layout-btn"]',
    preferredSide: 'bottom',
    areaLabel: 'Screens · Edit Toggle',
    title: 'Reveal Blocks, Themes & Block Inspector',
    summary:
      'Editing tools stay tucked away until needed. Click Edit to open the left Blocks/Themes/Media drawer and right Inspector.',
    bullets: [
      'Drag blocks onto the canvas or click any block to bind entities, colors, fonts, or graphs.',
      'Upload custom PNG, JPG, GIF, or MP4/WebM loops inside Media Library.',
      'Click Done Editing when finished to return to the uncluttered display preview.',
    ],
  },
  {
    id: 'saved-screens',
    tab: 'saved',
    targetSelector: '[data-guide="saved-list"]',
    preferredSide: 'bottom',
    areaLabel: 'Saved Screens Tab',
    title: 'Pause, Resume, Edit or Delete Screens',
    summary:
      'All active rotation and library screens live here. Pausing a screen removes it from rotation without deleting it.',
    bullets: [
      'Toggle Active / Paused to pick which screens cycle on your LCD.',
      'Click Edit to open that screen directly in Edit mode.',
    ],
  },
  {
    id: 'entities',
    tab: 'entities',
    targetSelector: '[data-guide="add-connection-btn"]',
    preferredSide: 'bottom',
    areaLabel: 'Entities & Connections Tab',
    title: 'Connect Sources & Build Graphs Effortlessly',
    summary:
      'Add Home Assistant or custom HTTP/JSON endpoints with the guided wizard, then place numbers, gauges, or multi-entity graphs in one click.',
    bullets: [
      'Click + Add Connection to connect Home Assistant or inspect any JSON URL interactively.',
      'Rename entity tags or units inline and pick which Screen to place them on.',
      'Check multiple numeric entities and click Build Area Graph or Build Bar Chart.',
    ],
  },
  {
    id: 'settings',
    tab: 'settings',
    targetSelector: '[data-guide="settings-tab-screens"]',
    preferredSide: 'bottom',
    areaLabel: 'Settings & Diagnostics Tab',
    title: 'Rotation, Connections, Hardware, Security & Diagnostics',
    summary:
      'Settings is organized into clean sections so everyday controls stay simple while full hardware diagnostics remain one click away.',
    bullets: [
      'Screens & Rotation controls real hardware Auto-Rotate, dwell seconds, and transitions.',
      'Entities & Connections lets you add, test, or remove integrations anytime.',
      'Display & Hardware, Security, and Diagnostics cover brightness, credentials, Dry Run, and TX/RX logs.',
    ],
  },
  {
    id: 'push-screen',
    tab: 'screens',
    targetSelector: '[data-guide="push-screen-btn"]',
    preferredSide: 'bottom',
    areaLabel: 'Top Header · Push to Screen',
    title: 'Deploy to the Physical Display',
    summary:
      'Click Push to Screen to send your active screens to the 960×376 Aoostar USB-UART LCD and keep live updates running automatically.',
    bullets: [
      'Runs 100% locally in Docker—live updates and rotation continue even after closing the browser.',
      'Switch Dark / Light / System UI themes or view credits anytime in the Info tab.',
    ],
  },
];

interface RectBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function QuickGuideModal({open, onClose, onNavigateTab}: QuickGuideModalProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<RectBox | null>(null);
  const [popoverPos, setPopoverPos] = useState<{left: number; top: number; side: 'bottom' | 'top' | 'left' | 'right' | 'center'}>({
    left: 24,
    top: 80,
    side: 'center',
  });
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const step = GUIDE_STEPS[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === GUIDE_STEPS.length - 1;

  const handleClose = useCallback(() => {
    setStepIndex(0);
    onClose();
  }, [onClose]);

  const measureAndPosition = useCallback(() => {
    if (!open) return;
    const el = document.querySelector(step.targetSelector) as HTMLElement | null;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const popW = Math.min(370, vw - 24);
    const popH = popoverRef.current?.offsetHeight || 260;

    if (!el) {
      setTargetRect(null);
      setPopoverPos({
        left: Math.max(12, Math.round((vw - popW) / 2)),
        top: Math.max(12, Math.round((vh - popH) / 2)),
        side: 'center',
      });
      return;
    }

    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) {
      setTargetRect(null);
      setPopoverPos({
        left: Math.max(12, Math.round((vw - popW) / 2)),
        top: Math.max(12, Math.round((vh - popH) / 2)),
        side: 'center',
      });
      return;
    }

    const pad = 4;
    const box: RectBox = {
      left: Math.max(4, r.left - pad),
      top: Math.max(4, r.top - pad),
      width: Math.min(vw - 8, r.width + pad * 2),
      height: Math.min(vh - 8, r.height + pad * 2),
    };
    setTargetRect(box);

    const gap = 14;
    const spaceBelow = vh - (r.bottom + gap);
    const spaceAbove = r.top - gap;
    const spaceRight = vw - (r.right + gap);
    const spaceLeft = r.left - gap;

    let side: 'bottom' | 'top' | 'left' | 'right' = step.preferredSide;
    if (side === 'bottom' && spaceBelow < popH && spaceAbove >= popH) side = 'top';
    if (side === 'top' && spaceAbove < popH && spaceBelow >= popH) side = 'bottom';
    if (side === 'right' && spaceRight < popW && spaceLeft >= popW) side = 'left';
    if (side === 'left' && spaceLeft < popW && spaceRight >= popW) side = 'right';
    if ((side === 'right' || side === 'left') && Math.max(spaceRight, spaceLeft) < popW) {
      side = spaceBelow >= spaceAbove ? 'bottom' : 'top';
    }

    let left = 12;
    let top = 12;
    if (side === 'bottom') {
      left = r.left + r.width / 2 - popW / 2;
      top = r.bottom + gap;
    } else if (side === 'top') {
      left = r.left + r.width / 2 - popW / 2;
      top = r.top - popH - gap;
    } else if (side === 'right') {
      left = r.right + gap;
      top = r.top + Math.min(40, r.height / 3);
    } else {
      left = r.left - popW - gap;
      top = r.top + Math.min(40, r.height / 3);
    }

    left = Math.max(12, Math.min(vw - popW - 12, Math.round(left)));
    top = Math.max(12, Math.min(vh - popH - 12, Math.round(top)));

    setPopoverPos({left, top, side});
  }, [open, step.preferredSide, step.targetSelector]);

  useEffect(() => {
    if (!open) return;
    onNavigateTab(step.tab);
    const t1 = window.setTimeout(() => {
      const el = document.querySelector(step.targetSelector) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({block: 'nearest', inline: 'nearest', behavior: 'instant' as ScrollBehavior});
      }
      requestAnimationFrame(measureAndPosition);
    }, 65);
    const t2 = window.setTimeout(measureAndPosition, 200);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [open, stepIndex, step.tab, step.targetSelector, onNavigateTab, measureAndPosition]);

  useLayoutEffect(() => {
    if (!open) return;
    measureAndPosition();
  }, [open, stepIndex, measureAndPosition]);

  useEffect(() => {
    if (!open) return;
    const onResizeOrScroll = () => measureAndPosition();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
      if (e.key === 'ArrowRight' && !isLast) setStepIndex((i) => i + 1);
      if (e.key === 'ArrowLeft' && !isFirst) setStepIndex((i) => i - 1);
    };
    window.addEventListener('resize', onResizeOrScroll);
    window.addEventListener('scroll', onResizeOrScroll, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('resize', onResizeOrScroll);
      window.removeEventListener('scroll', onResizeOrScroll, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, measureAndPosition, handleClose, isFirst, isLast]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* Clickable backdrop when target rect is absent */}
      {!targetRect && (
        <div onClick={handleClose} className="fixed inset-0 bg-slate-950/65" />
      )}

      {/* Spotlight Cutout Ring around Target Button/Panel */}
      {targetRect && (
        <>
          <div
            onClick={handleClose}
            className="fixed inset-0 bg-transparent"
            aria-hidden="true"
          />
          <div
            style={{
              left: targetRect.left,
              top: targetRect.top,
              width: targetRect.width,
              height: targetRect.height,
              boxShadow: '0 0 0 9999px rgba(2, 6, 23, 0.62)',
            }}
            className="fixed pointer-events-none rounded-lg border-2 border-amber-400 transition-all duration-150"
          />
        </>
      )}

      {/* Anchored Popover Card */}
      <div
        ref={popoverRef}
        onClick={(e) => e.stopPropagation()}
        style={{
          left: popoverPos.left,
          top: popoverPos.top,
          width: 'min(370px, calc(100vw - 24px))',
        }}
        className="fixed rounded-xl border border-slate-200 dark:border-[#2B374C] bg-white dark:bg-[#0F131C] p-5 shadow-2xl space-y-3.5 transition-all duration-150"
      >
        <div className="flex items-start justify-between gap-3 pb-2.5 border-b border-slate-200 dark:border-[#1F2937]">
          <div className="min-w-0">
            <div className="text-[11px] font-mono text-amber-600 dark:text-amber-400">
              Step {stepIndex + 1} of {GUIDE_STEPS.length} · {step.areaLabel}
            </div>
            <h2 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
              {step.title}
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="p-1 rounded text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white shrink-0"
            title="Close guide"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-slate-700 dark:text-slate-200 leading-relaxed">{step.summary}</p>

        <ul className="space-y-1.5 text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed list-disc pl-4">
          {step.bullets.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>

        {/* Step dot strip */}
        <div className="flex items-center gap-1 pt-0.5">
          {GUIDE_STEPS.map((item, idx) => (
            <button
              key={item.id}
              onClick={() => setStepIndex(idx)}
              title={item.title}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                idx === stepIndex
                  ? 'bg-amber-500'
                  : idx < stepIndex
                    ? 'bg-amber-500/40'
                    : 'bg-slate-200 dark:bg-[#1F2937]'
              }`}
            />
          ))}
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          <button
            onClick={handleClose}
            className="text-xs text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 transition-colors"
          >
            Skip Guide
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
              disabled={isFirst}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-slate-300 dark:border-[#263042] bg-slate-100 dark:bg-[#141A26] text-xs text-slate-800 dark:text-slate-200 hover:border-slate-400 dark:hover:border-slate-500 disabled:opacity-35 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Back
            </button>

            {!isLast ? (
              <button
                onClick={() => setStepIndex((i) => Math.min(GUIDE_STEPS.length - 1, i + 1))}
                className="inline-flex items-center gap-1 px-3.5 py-1.5 rounded bg-amber-500 text-slate-950 hover:bg-amber-400 text-xs font-semibold"
              >
                Next
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                onClick={handleClose}
                className="px-3.5 py-1.5 rounded bg-amber-500 text-slate-950 hover:bg-amber-400 text-xs font-semibold"
              >
                Done
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
