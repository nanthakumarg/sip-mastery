/**
 * FlowStage: ladder + inspector + caption + player.
 * Controls are the same in every diagram (COURSE_STRUCTURE §5.5):
 * ⏮ first · ◀ back · ▶ play / ❚❚ pause · ▶| next · ↺ reset; ←/→ and Space on the stage.
 */
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import Inspector from './Inspector.tsx';
import Ladder, { ladderWidth, usedProtocols } from './Ladder.tsx';
import { comparableIndex } from './diff.ts';
import { ExpandButton, PlayerControls, useExpand, usePlayer } from './player.tsx';
import { PROTO_LABEL, type FlowBundle } from './types.ts';

interface Props extends FlowBundle {
  /** Label above the title, e.g. "Call flow" or "Broken". */
  eyebrow?: string;
  /** Milliseconds per step while playing. */
  speed?: number;
  /** Controls shown between the header and the ladder (the call flow builder's options). */
  toolbar?: ReactNode;
}

export default function FlowStage({ flow, quotes, refData, eyebrow = 'Call flow', speed = 2400, toolbar }: Props) {
  const p = usePlayer(flow.steps.length, speed);
  const { go } = p;
  // A new flow (the call flow builder) starts again at step 1.
  const current = Math.min(p.current, flow.steps.length - 1);
  const shown = useRef(flow.id);
  useEffect(() => {
    if (shown.current !== flow.id) { shown.current = flow.id; go(0); }
  }, [flow.id]);
  const figureRef = useRef<HTMLElement>(null);
  const x = useExpand(figureRef);
  const ladderBox = useRef<HTMLDivElement>(null);
  const step = flow.steps[current]!;

  const wires = useMemo(() => flow.steps.map(s => s.wire), [flow]);
  const prevIndex = useMemo(() => comparableIndex(wires, current), [wires, current]);
  const laneLabel = (id: string) => flow.lanes.find(l => l.id === id)?.label ?? id;

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

  const quote = step.rfc ? quotes[step.rfc] : undefined;

  return (
    <figure
      ref={figureRef}
      className={`stage${flow.broken ? ' is-broken' : ''}${x.expanded ? ' is-expanded' : ''}`}
      style={{ ['--lw' as string]: `${ladderWidth(flow.lanes.length)}px` }}
      tabIndex={0}
      onKeyDown={p.onKey}
      role={x.expanded ? 'dialog' : undefined}
      aria-modal={x.expanded ? true : undefined}
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
        <ExpandButton x={x} />
      </header>
      {toolbar}

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
          <PlayerControls p={p} />
        </div>
        <aside className="stage-inspector">
          <Inspector
            key={`${flow.id}:${current}`}
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
