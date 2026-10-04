/**
 * Network-map view of a flow: nodes where they sit in the network, the
 * current message moving along its link, RTP on its own direct path.
 * Same controlled diagram language as the ladder (COURSE_STRUCTURE §5.2):
 * colour = protocol, dashed = media, white outline = what the step is about.
 */
import { useEffect, useId, useState } from 'react';
import type { FlowMap } from '../sip/flow.ts';
import type { ClientFlow } from './types.ts';

const W = 150;
const H = 80;
/** Distance of a message label above its link: clear of the node boxes. */
const PILL_OFFSET = 54;

export type Overview = 'signaling' | 'media' | 'both';

interface Props {
  flow: ClientFlow & { map: FlowMap };
  /** Current step, or -1 for none (overview mode). */
  current: number;
  /** Highlight whole paths instead of one step. */
  overview?: Overview;
}

type Pt = [number, number];

/** Point where the line from a's centre toward b leaves a's box, plus a small gap. */
function edge(a: Pt, b: Pt, gap = 8): Pt {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const tx = dx ? (W / 2 + gap) / Math.abs(dx) : Infinity;
  const ty = dy ? (H / 2 + gap) / Math.abs(dy) : Infinity;
  const t = Math.min(tx, ty);
  return [a[0] + dx * t, a[1] + dy * t];
}

const key = (a: string, b: string) => [a, b].sort().join('|');

export default function CallMap({ flow, current, overview }: Props) {
  const uid = useId().replace(/:/g, '');
  const { map } = flow;
  const [motion, setMotion] = useState(false);
  useEffect(() => { setMotion(!window.matchMedia('(prefers-reduced-motion: reduce)').matches); }, []);

  const N = (id: string) => map.nodes[id]!;
  const step = current >= 0 ? flow.steps[current] : undefined;

  // Signaling links: every pair of nodes that exchanges a message.
  const links = new Map<string, [string, string]>();
  for (const s of flow.steps) if (s.kind !== 'media') links.set(key(s.from, s.to), [s.from, s.to]);

  // Media path, and the steps during which media flows (from the media step until the next BYE).
  const mediaIdx = flow.steps.findIndex(s => s.kind === 'media');
  const media = mediaIdx >= 0 ? flow.steps[mediaIdx]! : undefined;
  const byeIdx = flow.steps.findIndex((s, i) => i > mediaIdx && s.label.startsWith('BYE'));
  const mediaLive = media && current >= mediaIdx && (byeIdx < 0 || current < byeIdx);
  let mediaPath = '';
  if (media) {
    const a = N(media.from), b = N(media.to);
    const y0 = a[1] + H / 2 + 6, y1 = b[1] + H / 2 + 6, my = map.mediaY ?? a[1] + 160;
    mediaPath = `M${a[0]} ${y0} C${a[0]} ${my} ${b[0]} ${my} ${b[0]} ${y1}`;
  }
  const mediaMid: Pt | undefined = media ? [(N(media.from)[0] + N(media.to)[0]) / 2, 0.25 * (N(media.from)[1] + H / 2) + 0.75 * (map.mediaY ?? 0)] : undefined;

  // Status labels persist until changed.
  const status: Record<string, string> = {};
  if (current >= 0) for (const s of flow.steps.slice(0, current + 1)) Object.assign(status, s.status ?? {});

  const active = new Set(step ? [step.from, step.to] : []);
  const sigOn = overview === 'signaling' || overview === 'both';
  const medOn = overview === 'media' || overview === 'both' || (step?.kind === 'media');

  // Current message geometry
  let cur: { d: string; mid: Pt; normal: Pt } | undefined;
  if (step && step.kind !== 'media') {
    const a = N(step.from), b = N(step.to);
    const p1 = edge(a, b), p2 = edge(b, a);
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) || 1;
    let normal: Pt = [(p2[1] - p1[1]) / len, -(p2[0] - p1[0]) / len];
    if (normal[1] > 0) normal = [-normal[0], -normal[1]]; // label above the line
    cur = { d: `M${p1[0]} ${p1[1]} L${p2[0]} ${p2[1]}`, mid: [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2], normal };
  }

  return (
    <svg className="callmap" viewBox={`0 0 ${map.width} ${map.height}`} role="img"
      aria-label={step ? `Step ${current + 1}: ${step.label}, from ${step.from} to ${step.to}. ${step.caption}` : `Network map: ${flow.title}`}>
      <defs>
        {(['sip', 'rtp'] as const).map(p => (
          <marker key={p} id={`${uid}-mk-${p}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" style={{ fill: `var(--${p})` }} />
          </marker>
        ))}
        <filter id={`${uid}-glow`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>

      {(map.groups ?? []).map(g => (
        <g key={g.label} className="cm-group">
          <rect x={g.x} y={g.y} width={g.w} height={g.h} rx={10} />
          <text x={g.x + 14} y={g.y + 24}>{g.label}</text>
        </g>
      ))}

      {/* Signaling links */}
      {[...links.values()].map(([a, b]) => {
        const p1 = edge(N(a), N(b)), p2 = edge(N(b), N(a));
        return <path key={key(a, b)} className={`cm-link${sigOn ? ' is-on' : ''}`} d={`M${p1[0]} ${p1[1]} L${p2[0]} ${p2[1]}`} />;
      })}
      {overview && sigOn && (() => {
        // Label the longest link (the one between the two domains).
        const [a, b] = [...links.values()].sort(([a1, b1], [a2, b2]) =>
          Math.abs(N(b2)[0] - N(a2)[0]) - Math.abs(N(b1)[0] - N(a1)[0]))[0]!;
        return <text className="cm-path-label sip" x={(N(a)[0] + N(b)[0]) / 2} y={(N(a)[1] + N(b)[1]) / 2 - PILL_OFFSET} textAnchor="middle">SIP signaling: through the proxies</text>;
      })()}

      {/* Media path */}
      {media && (
        <g className={`cm-media${medOn ? ' is-on' : ''}${mediaLive ? ' is-live' : ''}`}>
          <path className="cm-media-path" d={mediaPath} markerEnd={medOn ? `url(#${uid}-mk-rtp)` : undefined} markerStart={medOn ? `url(#${uid}-mk-rtp)` : undefined} />
          {(medOn || mediaLive) && motion && [0, 1].map(dir => [0, 0.5].map(off => (
            <circle key={`${dir}${off}`} r={4} className="cm-media-dot">
              <animateMotion dur="2.4s" begin={`${off * 2.4}s`} repeatCount="indefinite" path={mediaPath}
                keyPoints={dir ? '1;0' : '0;1'} keyTimes="0;1" calcMode="linear" />
            </circle>
          )))}
          {mediaMid && (medOn || mediaLive) && (
            <text className="cm-path-label rtp" x={mediaMid[0]} y={mediaMid[1] + 24} textAnchor="middle">
              {overview ? 'RTP media: directly between the phones' : media.label}
            </text>
          )}
        </g>
      )}

      {/* Current message */}
      {cur && step && (
        <g className="cm-current" key={current}>
          <path className="cm-msg" d={cur.d} style={{ stroke: `var(--${step.proto})` }} markerEnd={`url(#${uid}-mk-sip)`} />
          {motion && (
            <circle r={7} className="cm-packet" style={{ fill: `var(--${step.proto})` }} filter={`url(#${uid}-glow)`}>
              <animateMotion dur="0.8s" fill="freeze" path={cur.d} calcMode="spline" keyTimes="0;1" keySplines="0.16 1 0.3 1" />
            </circle>
          )}
          <line className="cm-tick" x1={cur.mid[0]} y1={cur.mid[1]} x2={cur.mid[0] + cur.normal[0] * (PILL_OFFSET - 13)} y2={cur.mid[1] + cur.normal[1] * (PILL_OFFSET - 13)} style={{ stroke: `var(--${step.proto})` }} />
          <g className="cm-pill" transform={`translate(${cur.mid[0] + cur.normal[0] * PILL_OFFSET} ${cur.mid[1] + cur.normal[1] * PILL_OFFSET})`}>
            <rect x={-(step.label.length * 4.4 + 14)} y={-13} width={step.label.length * 8.8 + 28} height={26} rx={13} style={{ stroke: `var(--${step.proto})` }} />
            <text textAnchor="middle" y={4.5}>{step.label}</text>
          </g>
        </g>
      )}

      {/* Nodes */}
      {flow.lanes.map(l => {
        const [x, y] = N(l.id);
        return (
          <g key={l.id} className={`cm-node kind-${l.kind}${active.has(l.id) ? ' is-active' : ''}`}>
            <rect className="cm-box" x={x - W / 2} y={y - H / 2} width={W} height={H} rx={l.kind === 'ua' ? 16 : 4} />
            {(l.kind === 'b2bua' || l.kind === 'sbc') && <rect className="cm-box-inner" x={x - W / 2 + 4} y={y - H / 2 + 4} width={W - 8} height={H - 8} rx={2} />}
            <text className="cm-label" x={x} y={y - 12} textAnchor="middle">{l.label}</text>
            {l.sub && <text className="cm-sub" x={x} y={y + 6} textAnchor="middle">{l.sub}</text>}
            {status[l.id] && <text className="cm-status" x={x} y={y + 27} textAnchor="middle">● {status[l.id]}</text>}
          </g>
        );
      })}
    </svg>
  );
}
