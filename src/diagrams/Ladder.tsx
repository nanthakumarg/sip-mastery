/**
 * Call-flow ladder (sequence diagram), ported from the ladder() renderer in
 * presentations/. Time runs down; lanes keep the course order (caller left).
 * Controlled diagram language: colour = protocol, dashed = media,
 * white outline = what the current step is about (COURSE_STRUCTURE §5.2).
 */
import { useId } from 'react';
import type { Protocol } from '../sip/flow.ts';
import type { ClientFlow } from './types.ts';

export interface LadderGeometry {
  laneGap: number;
  rowH: number;
  top: number;
}

export function geometry(lanes: number, compact = false): LadderGeometry {
  const laneGap = lanes <= 2 ? 250 : lanes === 3 ? 240 : lanes === 4 ? 176 : 150;
  return { laneGap, rowH: compact ? 36 : 46, top: compact ? 84 : 96 };
}

const HEAD_W = 136;
const NUM_W = 40;

/** Natural width of a ladder in SVG units (= CSS px at scale 1). */
export function ladderWidth(lanes: number, compact = false): number {
  const g = geometry(lanes, compact);
  return NUM_W + HEAD_W + (lanes - 1) * g.laneGap + 8;
}
const PROTOS: Protocol[] = ['sip', 'sdp', 'rtp', 'rtcp', 'dns', 'net', 'err', 'down'];

interface Props {
  flow: ClientFlow;
  current: number;
  onSelect?: (index: number) => void;
  compact?: boolean;
  /** Steps after `current` are dimmed (default) or hidden. */
  future?: 'dim' | 'hide';
}

export default function Ladder({ flow, current, onSelect, compact = false, future = 'dim' }: Props) {
  const uid = useId().replace(/:/g, '');
  const g = geometry(flow.lanes.length, compact);
  const x0 = NUM_W + HEAD_W / 2;
  const X: Record<string, number> = {};
  flow.lanes.forEach((l, i) => { X[l.id] = x0 + i * g.laneGap; });
  const width = ladderWidth(flow.lanes.length, compact);
  const height = g.top + flow.steps.length * g.rowH + 8;
  const cur = flow.steps[current];
  const activeLanes = new Set(cur ? [cur.from, cur.to] : []);

  return (
    <svg
      className={`ladder lanes-${flow.lanes.length}${compact ? ' is-compact' : ''}`}
      viewBox={`0 0 ${width} ${height}`}
      style={{ ['--min-w' as string]: `${Math.round(width * 0.75)}px`, ['--lw' as string]: `${width}px` }}
      role="img"
      aria-label={`Call flow: ${flow.title}. Step ${current + 1} of ${flow.steps.length}.`}
    >
      <defs>
        {PROTOS.map(p => (
          <marker key={p} id={`${uid}-mk-${p}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" style={{ fill: `var(--${p})` }} />
          </marker>
        ))}
        <pattern id={`${uid}-brick`} width="16" height="8" patternUnits="userSpaceOnUse">
          <path d="M0 0H16M0 4H16M8 0V4M0 4V8" style={{ stroke: 'var(--line)', strokeWidth: 1 }} />
        </pattern>
      </defs>

      {/* Lanes: header box + lifeline */}
      {flow.lanes.map(l => {
        const x = X[l.id]!;
        const active = activeLanes.has(l.id);
        const boxH = l.sub ? 50 : 38;
        return (
          <g key={l.id} className={`lane kind-${l.kind}${active ? ' is-active' : ''}`}>
            <line className="lifeline" x1={x} y1={boxH + 4} x2={x} y2={height - 4} />
            <rect className="lane-box" x={x - HEAD_W / 2} y={2} width={HEAD_W} height={boxH}
              rx={l.kind === 'ua' ? 14 : 3} style={l.kind === 'nat' ? { fill: `url(#${uid}-brick)` } : undefined} />
            {(l.kind === 'b2bua' || l.kind === 'sbc') && (
              <rect className="lane-box-inner" x={x - HEAD_W / 2 + 4} y={6} width={HEAD_W - 8} height={boxH - 8} rx={2} />
            )}
            <text className="lane-label" x={x} y={l.sub ? 24 : 26} textAnchor="middle">{l.label}</text>
            {l.sub && <text className="lane-sub" x={x} y={41} textAnchor="middle">{l.sub}</text>}
          </g>
        );
      })}

      {/* Steps */}
      {flow.steps.map(s => {
        const y = g.top + s.index * g.rowH;
        const state = s.index === current ? 'current' : s.index < current ? 'past' : 'future';
        if (state === 'future' && future === 'hide') return null;
        const x1 = X[s.from]!, x2 = X[s.to]!;
        const dir = x2 >= x1 ? 1 : -1;
        const media = s.kind === 'media';
        const startX = x1 + dir * (media ? 8 : 3);
        let endX = x2 - dir * 8;
        const lostX = x1 + (x2 - x1) * 0.62;
        if (s.lost) endX = lostX;
        const len = Math.abs(endX - startX);
        const mid = (x1 + x2) / 2;
        return (
          <g key={s.index} className={`step is-${state}${s.warn ? ' has-warn' : ''}`}
            onClick={onSelect ? () => onSelect(s.index) : undefined}
            data-step={s.index}>
            <rect className="step-hit" x={0} y={y - g.rowH / 2} width={width} height={g.rowH} />
            {state === 'current' && <rect className="step-band" x={NUM_W - 6} y={y - g.rowH / 2 + 3} width={width - NUM_W + 4} height={g.rowH - 6} rx={4} />}
            <text className="step-num" x={4} y={y + 4}>{String(s.index + 1).padStart(2, '0')}</text>
            <path
              key={state === 'current' ? `c${current}` : 'p'}
              className={`wire${media ? ' is-media' : ''}`}
              d={`M${startX} ${y} H${endX}`}
              style={{ stroke: `var(--${s.proto})`, ['--len' as string]: len }}
              markerEnd={s.lost ? undefined : `url(#${uid}-mk-${s.proto})`}
              markerStart={media && !s.oneway ? `url(#${uid}-mk-${s.proto})` : undefined}
            />
            {s.lost && <text className="lost" x={lostX} y={y + 6} textAnchor="middle">✕</text>}
            <text className="step-label" x={mid} y={y - 9} textAnchor="middle">
              {s.label}
              {s.warn && <tspan className="warn-mark" dx={8}>⚠</tspan>}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Protocols used by a flow, for the legend. */
export function usedProtocols(flow: ClientFlow): Protocol[] {
  return PROTOS.filter(p => flow.steps.some(s => s.proto === p));
}
