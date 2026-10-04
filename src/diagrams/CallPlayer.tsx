/**
 * Module 0 call player: the whole call on a network map, in chapters.
 * Each chapter links to the modules that explain it (the course mini-map).
 * "Show the message" opens the same inspector as the ladder stages.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FlowMap } from '../sip/flow.ts';
import CallMap from './CallMap.tsx';
import Inspector from './Inspector.tsx';
import { comparableIndex } from './diff.ts';
import { ExpandButton, PlayerControls, useExpand, usePlayer } from './player.tsx';
import type { ClientFlow, FlowBundle } from './types.ts';

export interface ModuleLink { n: number; title: string; url?: string }

interface Props extends FlowBundle {
  /** Title and URL (when live) for every module named in the phases. */
  modules: Record<number, ModuleLink>;
  eyebrow?: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

export default function CallPlayer({ flow, quotes, refData, modules, eyebrow = 'The whole call' }: Props) {
  const p = usePlayer(flow.steps.length, 2600);
  const { current, go } = p;
  const figureRef = useRef<HTMLElement>(null);
  const x = useExpand(figureRef);
  const [showMsg, setShowMsg] = useState(false);
  const mapBox = useRef<HTMLDivElement>(null);
  const phaseBar = useRef<HTMLOListElement>(null);
  const step = flow.steps[current]!;
  const phases = flow.phases ?? [];
  const phaseIdx = phases.reduce((acc, ph, i) => (current + 1 >= ph.from ? i : acc), 0);
  const phase = phases[phaseIdx];

  const wires = useMemo(() => flow.steps.map(s => s.wire), [flow]);
  const prevIndex = useMemo(() => comparableIndex(wires, current), [wires, current]);
  const laneLabel = (id: string) => flow.lanes.find(l => l.id === id)?.label ?? id;

  // Keep the current chapter visible when the chapter bar scrolls sideways.
  useEffect(() => {
    const bar = phaseBar.current;
    const li = bar?.children[phaseIdx] as HTMLElement | undefined;
    if (!bar || !li || bar.scrollWidth <= bar.clientWidth) return;
    bar.scrollTo({ left: li.offsetLeft - bar.clientWidth / 2 + li.offsetWidth / 2, behavior: 'smooth' });
  }, [phaseIdx]);

  // On narrow screens the map scrolls sideways: keep the current step in view.
  useEffect(() => {
    const box = mapBox.current;
    if (!box || box.scrollWidth <= box.clientWidth) return;
    const nodes = [...box.querySelectorAll<SVGGElement>('.cm-node.is-active')].map(n => n.getBoundingClientRect());
    if (!nodes.length) return;
    const b = box.getBoundingClientRect();
    const mid = (Math.min(...nodes.map(r => r.left)) + Math.max(...nodes.map(r => r.right))) / 2 - b.left + box.scrollLeft;
    box.scrollTo({ left: mid - box.clientWidth / 2, behavior: 'smooth' });
  }, [current]);

  return (
    <figure
      ref={figureRef}
      className={`stage callplayer${x.expanded ? ' is-expanded' : ''}${showMsg ? ' show-msg' : ''}`}
      tabIndex={0}
      onKeyDown={p.onKey}
      role={x.expanded ? 'dialog' : undefined}
      aria-modal={x.expanded ? true : undefined}
      aria-label={`Interactive call: ${flow.title}`}
    >
      <header className="stage-head">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <p className="stage-title">{flow.title}</p>
        </div>
        <ul className="legend" aria-label="Legend">
          <li><i className="lg-sip" />SIP signaling</li>
          <li><i className="lg-rtp" />RTP media</li>
        </ul>
        <ExpandButton x={x} />
      </header>

      {phases.length > 0 && (
        <ol className="phases" aria-label="Chapters of the call" ref={phaseBar}>
          {phases.map((ph, i) => (
            <li key={ph.label} className={i === phaseIdx ? 'is-current' : i < phaseIdx ? 'is-past' : ''}>
              <button type="button" onClick={() => go(ph.from - 1)} aria-current={i === phaseIdx ? 'step' : undefined}>
                <span className="ph-num">{i + 1}</span>{ph.label}
              </button>
            </li>
          ))}
        </ol>
      )}

      <div className="cp-body">
        <div className="cp-map" ref={mapBox}>
          <CallMap flow={flow as ClientFlow & { map: FlowMap }} current={current} />
        </div>
        <div className="stage-caption" aria-live="polite">
          <span className="cap-num">{pad(current + 1)}<span>/{pad(flow.steps.length)}</span></span>
          <div>
            <p className="cap-route">{step.label} · {laneLabel(step.from)} → {laneLabel(step.to)}</p>
            <p className="cap-text">{step.caption}</p>
          </div>
        </div>

        <div className="cp-bar">
          <PlayerControls p={p} withSpeed />
          <button type="button" className="cp-msg-toggle" aria-pressed={showMsg} onClick={() => setShowMsg(s => !s)} disabled={!step.wire && !showMsg}>
            {showMsg ? 'Hide the message' : 'Show the message'}
          </button>
        </div>

        {phase?.modules && phase.modules.length > 0 && (
          <div className="cp-learn">
            <span className="eyebrow">Learn this part in</span>
            <ul>
              {phase.modules.map(n => {
                const m = modules[n];
                const text = <><b>{pad(n)}</b> {m?.title ?? `Module ${n}`}</>;
                return (
                  <li key={n}>
                    {m?.url ? <a href={m.url}>{text} →</a> : <span title="Coming soon">{text} <em>soon</em></span>}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {showMsg && (
          <aside className="cp-inspector">
            <Inspector
              key={current}
              step={step}
              prev={prevIndex >= 0 ? flow.steps[prevIndex] : undefined}
              laneLabel={laneLabel}
              quote={step.rfc ? quotes[step.rfc] : undefined}
              refData={refData}
            />
          </aside>
        )}
      </div>

      <details className="stage-steps">
        <summary>All steps as text</summary>
        <ol>
          {flow.steps.map(s => (
            <li key={s.index}><b>{laneLabel(s.from)} → {laneLabel(s.to)}: {s.label}.</b> {s.caption}</li>
          ))}
        </ol>
      </details>
    </figure>
  );
}
