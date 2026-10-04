/**
 * FlowStage: ladder + inspector + caption + player.
 * Controls are the same in every diagram (COURSE_STRUCTURE §5.5):
 * ⏮ first · ◀ back · ▶ play / ❚❚ pause · ▶| next · ↺ reset; ←/→ and Space on the stage.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Inspector from './Inspector.tsx';
import Ladder, { ladderWidth, usedProtocols } from './Ladder.tsx';
import { comparableIndex } from './diff.ts';
import { PROTO_LABEL, type FlowBundle } from './types.ts';

/** Player icons (14×14), drawn so they look the same on every platform. */
const ICON = {
  first: 'M2 2h2v10H2zM12 2v10L5 7z',
  prev: 'M11 2v10L4 7z',
  play: 'M4 2v10l8-5z',
  pause: 'M3 2h3v10H3zM8 2h3v10H8z',
  next: 'M3 2v10l7-5zM10 2h2v10h-2z',
};
const ResetIcon = () => (
  <svg viewBox="0 0 14 14" aria-hidden="true">
    <path d="M11.6 7.4A4.6 4.6 0 1 1 7 2.4h1.6" style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 }} />
    <path d="M8 .2l3 2.2-3 2.2z" />
  </svg>
);
const Icon = ({ d }: { d: string }) => <svg viewBox="0 0 14 14" aria-hidden="true"><path d={d} /></svg>;

interface Props extends FlowBundle {
  /** Label above the title, e.g. "Call flow" or "Broken". */
  eyebrow?: string;
  /** Milliseconds per step while playing. */
  speed?: number;
}

export default function FlowStage({ flow, quotes, refData, eyebrow = 'Call flow', speed = 2400 }: Props) {
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const figureRef = useRef<HTMLElement>(null);
  const expandBtn = useRef<HTMLButtonElement>(null);
  const ladderBox = useRef<HTMLDivElement>(null);
  const last = flow.steps.length - 1;
  const step = flow.steps[current]!;

  const wires = useMemo(() => flow.steps.map(s => s.wire), [flow]);
  const prevIndex = useMemo(() => comparableIndex(wires, current), [wires, current]);
  const laneLabel = (id: string) => flow.lanes.find(l => l.id === id)?.label ?? id;

  // Autoplay: one step per `speed` ms, stop at the end.
  useEffect(() => {
    if (!playing) return;
    if (current >= last) { setPlaying(false); return; }
    const t = setTimeout(() => setCurrent(c => Math.min(c + 1, last)), speed);
    return () => clearTimeout(t);
  }, [playing, current, last, speed]);

  // Keep the current row visible inside the ladder box (without moving the page).
  useEffect(() => {
    const box = ladderBox.current;
    const row = box?.querySelector<SVGGElement>(`[data-step="${current}"]`);
    if (!box || !row) return;
    const b = box.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    if (r.top < b.top + 60 || r.bottom > b.bottom - 20) {
      box.scrollTo({ top: box.scrollTop + (r.top - b.top) - b.height / 2, behavior: 'smooth' });
    }
  }, [current]);

  // Expanded view: full screen, page scroll locked, Esc closes, focus returns to the button.
  useEffect(() => {
    if (!expanded) return;
    const root = document.documentElement;
    root.classList.add('stage-open');
    figureRef.current?.focus();
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false); };
    window.addEventListener('keydown', onEsc);
    return () => {
      root.classList.remove('stage-open');
      window.removeEventListener('keydown', onEsc);
      expandBtn.current?.focus();
    };
  }, [expanded]);

  const go = (i: number) => { setPlaying(false); setCurrent(Math.max(0, Math.min(last, i))); };

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('.insp-msg, input, button')) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); go(current + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(current - 1); }
    else if (e.key === ' ') { e.preventDefault(); setPlaying(p => !p); }
    else if (e.key === 'Home') { e.preventDefault(); go(0); }
    else if (e.key === 'End') { e.preventDefault(); go(last); }
  };

  const quote = step.rfc ? quotes[step.rfc] : undefined;

  return (
    <figure
      ref={figureRef}
      className={`stage${flow.broken ? ' is-broken' : ''}${expanded ? ' is-expanded' : ''}`}
      style={{ ['--lw' as string]: `${ladderWidth(flow.lanes.length)}px` }}
      tabIndex={0}
      onKeyDown={onKey}
      role={expanded ? 'dialog' : undefined}
      aria-modal={expanded ? true : undefined}
      aria-label={`Interactive call flow: ${flow.title}`}
    >
      <header className="stage-head">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <p className="stage-title">{flow.title}</p>
        </div>
        <ul className="legend" aria-label="Legend">
          {usedProtocols(flow).map(p => (
            <li key={p}><i className={`lg-${p}`} />{PROTO_LABEL[p]}</li>
          ))}
          {flow.steps.some(s => s.warn) && <li><span className="lg-warn">⚠</span>Problem</li>}
        </ul>
        <button type="button" ref={expandBtn} className="stage-expand" onClick={() => setExpanded(x => !x)}
          aria-pressed={expanded} title={expanded ? 'Close full screen (Esc)' : 'Open full screen'}>
          <svg viewBox="0 0 14 14" aria-hidden="true"><path d={expanded ? 'M5 1v4H1M9 1v4h4M5 13V9H1M9 13V9h4' : 'M1 5V1h4M13 5V1H9M1 9v4h4M13 9v4H9'} /></svg>
          {expanded ? 'Close' : 'Expand'}
        </button>
      </header>

      <div className="stage-main">
        <div className="stage-left">
          <div className="stage-ladder" ref={ladderBox}>
            <Ladder flow={flow} current={current} onSelect={go} />
          </div>
          <div className="stage-caption" aria-live="polite">
            <span className="cap-num">{String(current + 1).padStart(2, '0')}<span>/{String(flow.steps.length).padStart(2, '0')}</span></span>
            <div>
              <p className="cap-text">{step.caption}</p>
              {step.warn && <p className="cap-warn"><span aria-hidden="true">⚠</span> {step.warn}</p>}
            </div>
          </div>
          <div className="stage-controls" role="group" aria-label="Player">
            <button type="button" onClick={() => go(0)} disabled={current === 0} aria-label="First step" title="First step (Home)"><Icon d={ICON.first} /></button>
            <button type="button" onClick={() => go(current - 1)} disabled={current === 0} aria-label="Previous step" title="Previous step (←)"><Icon d={ICON.prev} /></button>
            <button type="button" className="play" onClick={() => (current >= last ? (setCurrent(0), setPlaying(true)) : setPlaying(p => !p))}
              aria-label={playing ? 'Pause' : 'Play'} title="Play / pause (Space)"><Icon d={playing ? ICON.pause : ICON.play} /></button>
            <button type="button" onClick={() => go(current + 1)} disabled={current === last} aria-label="Next step" title="Next step (→)"><Icon d={ICON.next} /></button>
            <button type="button" onClick={() => go(0)} aria-label="Reset" title="Reset"><ResetIcon /></button>
            <input type="range" min={0} max={last} value={current} onChange={e => go(Number(e.target.value))} aria-label="Step" />
          </div>
        </div>
        <aside className="stage-inspector">
          <Inspector
            key={current}
            step={step}
            prev={prevIndex >= 0 ? flow.steps[prevIndex] : undefined}
            laneLabel={laneLabel}
            quote={quote}
            refData={refData}
          />
        </aside>
      </div>

      <details className="stage-steps">
        <summary>All steps as text</summary>
        <ol>
          {flow.steps.map(s => (
            <li key={s.index}><b>{laneLabel(s.from)} → {laneLabel(s.to)}: {s.label}.</b> {s.caption}{s.warn ? ` Problem: ${s.warn}` : ''}</li>
          ))}
        </ol>
      </details>
    </figure>
  );
}
