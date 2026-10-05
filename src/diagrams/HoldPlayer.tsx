/**
 * Hold player (Module 15): press Hold and Resume on either phone. Each press
 * is a re-INVITE whose SDP changes the direction attribute, and the two media
 * arrows turn on and off. The model is src/sip/sdp.ts (holdStep), which follows
 * RFC 3264 §6.1 and §8.4 and RFC 6337 §5.3.
 */
import { useEffect, useState } from 'react';
import { markKeywords } from './Inspector.tsx';
import { HOLD_START, holdStep, type Direction, type HoldExchange, type HoldState, type Party } from '../sip/sdp.ts';
import type { ClientQuote } from './types.ts';

interface Props { quotes: Record<string, ClientQuote> }

const NAME: Record<Party, string> = { alice: 'Alice', bob: 'Bob' };
const SESS: Record<Party, string> = { alice: 'alice 2890844526', bob: 'bob 2808844564' };
const IP: Record<Party, string> = { alice: '192.0.2.10', bob: '203.0.113.20' };
const other = (p: Party): Party => (p === 'alice' ? 'bob' : 'alice');

interface Entry { state: HoldState; ex?: HoldExchange }

function explain(e: HoldExchange, before: HoldState): { text: string; rule: string; bad?: boolean } {
  const a = NAME[e.by], b = NAME[other(e.by)];
  if (e.ignored) return { text: `${a}'s SDP changed, but its o= version did not. ${b}'s phone treats it as the SDP it already has, so nothing changes.`, rule: 'rfc3264-8-same', bad: true };
  if (e.offerDir === 'sendonly') {
    return e.answerDir === 'inactive'
      ? { text: `${b} is holding too, so ${b} does not want to receive: the answer is inactive. No media flows either way.`, rule: 'rfc3264-6.1-direction' }
      : { text: `${a} offers sendonly: ${a} may still send (music on hold) but wants nothing back. ${b} must answer recvonly or inactive.`, rule: 'rfc3264-8.4-hold' };
  }
  if (e.offerDir === 'inactive') return { text: `${a} offers inactive: no media either way, not even music on hold. ${b} must answer inactive.`, rule: 'rfc6337-5.3-inactive' };
  if (e.answerDir !== 'sendrecv') return { text: `${a} resumes, but ${b} is still holding, so ${b} answers ${e.answerDir}. Each side leaves hold by itself.`, rule: 'rfc6337-5.3-stuck' };
  return before.aliceSends && before.bobSends
    ? { text: `Nothing changes: the call was not on hold.`, rule: 'rfc3264-8-same' }
    : { text: `Both sides want media again: sendrecv in the offer and the answer. Each new SDP has the next o= version.`, rule: 'rfc3264-8-version' };
}

interface Geo { w: number; h: number; node: Record<Party, [number, number]>; nw: number; nh: number; lines: Record<Party, [number, number, number, number]>; label: Record<Party, [number, number, 'start' | 'middle' | 'end']> }
/** Side by side on wide screens; Alice above Bob on phones, so the text stays readable. */
const WIDE: Geo = {
  w: 640, h: 200, nw: 180, nh: 120, node: { alice: [20, 40], bob: [440, 40] },
  lines: { alice: [200, 78, 440, 78], bob: [440, 130, 200, 130] },
  label: { alice: [320, 68, 'middle'], bob: [320, 120, 'middle'] },
};
const NARROW: Geo = {
  w: 340, h: 420, nw: 180, nh: 120, node: { alice: [80, 10], bob: [80, 290] },
  lines: { alice: [135, 130, 135, 290], bob: [205, 290, 205, 130] },
  label: { alice: [125, 214, 'end'], bob: [215, 214, 'start'] },
};

function Line({ g, on, from, label }: { g: Geo; on: boolean; from: Party; label: string }) {
  const [x1, y1, x2, y2] = g.lines[from];
  const len = Math.hypot(x2 - x1, y2 - y1);
  const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
  const [tx, ty, anchor] = g.label[from];
  const tip = (d: number, side: number) => `${x2 - ux * d - uy * side} ${y2 - uy * d + ux * side}`;
  return (
    <g className={`hp-media${on ? ' is-on' : ''}`}>
      <line x1={x1} y1={y1} x2={x2 - ux * 10} y2={y2 - uy * 10} />
      {on && <path d={`M${tip(12, 6)} L${x2} ${y2} L${tip(12, -6)} z`} />}
      <text x={tx} y={ty} textAnchor={anchor}>{label}</text>
    </g>
  );
}

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 560px)');
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
}

export default function HoldPlayer({ quotes }: Props) {
  const [hist, setHist] = useState<Entry[]>([{ state: HOLD_START }]);
  const [style, setStyle] = useState<Direction>('sendonly');
  const [forget, setForget] = useState(false);
  const cur = hist[hist.length - 1]!;
  const s = cur.state;
  const press = (by: Party, want: Direction) => {
    const r = holdStep(s, by, want, !forget);
    setHist(h => [...h, { state: r.state, ex: r.exchange }]);
  };
  const last = cur.ex;
  const prev = hist[hist.length - 2]?.state;
  const why = last && prev ? explain(last, prev) : undefined;
  const quote = why ? quotes[why.rule] : undefined;
  const holding = (p: Party) => s.want[p] !== 'sendrecv';
  const voice = (p: Party) => (holding(p) ? 'music on hold' : `${NAME[p]}'s voice`);
  const g = useNarrow() ? NARROW : WIDE;

  return (
    <figure className="stage hp" aria-label="Hold player">
      <header className="stage-head">
        <div>
          <p className="eyebrow">Hold player · RFC 3264 §8.4</p>
          <p className="stage-title">Press Hold on either phone</p>
        </div>
        <ul className="legend" aria-label="Legend">
          <li><i className="lg-sip" />re-INVITE</li>
          <li><i className="lg-sdp" />SDP</li>
          <li><i className="lg-rtp" />RTP</li>
        </ul>
      </header>

      <div className="hp-controls">
        {(['alice', 'bob'] as Party[]).map(p => (
          <div key={p} className="hp-ctl" role="group" aria-label={`${NAME[p]}'s phone`}>
            <span className="hp-ctl-name">{NAME[p]}</span>
            <button type="button" className="rl-toggle" disabled={holding(p)} onClick={() => press(p, style)}>Hold</button>
            <button type="button" className="rl-toggle" disabled={!holding(p)} onClick={() => press(p, 'sendrecv')}>Resume</button>
          </div>
        ))}
        <div className="seg" role="group" aria-label="Hold with">
          <button type="button" aria-pressed={style === 'sendonly'} onClick={() => setStyle('sendonly')}>Hold with sendonly</button>
          <button type="button" aria-pressed={style === 'inactive'} onClick={() => setStyle('inactive')}>with inactive</button>
        </div>
        <button type="button" className={`rl-toggle hp-forget${forget ? ' is-bad' : ''}`} aria-pressed={forget} onClick={() => setForget(!forget)}>
          <span aria-hidden="true">{forget ? '●' : '○'}</span>Forget to increment o= version
        </button>
        <button type="button" className="rl-toggle" onClick={() => setHist([{ state: HOLD_START }])} disabled={hist.length === 1}>Reset</button>
      </div>

      <div className="hp-map">
        <svg viewBox={`0 0 ${g.w} ${g.h}`} className={g === NARROW ? 'is-narrow' : ''} role="img" aria-label={`Alice to Bob: ${s.aliceSends ? 'media' : 'no media'}. Bob to Alice: ${s.bobSends ? 'media' : 'no media'}.`}>
          {(['alice', 'bob'] as Party[]).map(p => {
            const [x, y] = g.node[p];
            return (
              <g key={p} className={`hp-node${holding(p) ? ' is-holding' : ''}`} transform={`translate(${x},${y})`}>
                <rect width="180" height="120" rx="14" />
                <text x="90" y="30" textAnchor="middle" className="hp-name">{NAME[p]}</text>
                <text x="90" y="58" textAnchor="middle" className="hp-dir">a={s.sent[p]}</text>
                <text x="90" y="80" textAnchor="middle" className="hp-ver">version …{String(s.version[p]).slice(-3)}</text>
                <text x="90" y="104" textAnchor="middle" className="hp-state">{holding(p) ? `holding (${s.want[p]})` : 'not holding'}</text>
              </g>
            );
          })}
          <Line g={g} on={s.aliceSends} from="alice" label={s.aliceSends ? voice('alice') : 'no media'} />
          <Line g={g} on={s.bobSends} from="bob" label={s.bobSends ? voice('bob') : 'no media'} />
        </svg>
      </div>

      <div className="hp-bottom">
        <section className={`hp-last${why?.bad ? ' is-bad' : ''}`} aria-live="polite">
          {last ? (
            <>
              <p className="hp-msg"><span className="hp-sip">re-INVITE</span> from {NAME[last.by]}</p>
              <pre className="hp-sdp">{`o=${SESS[last.by]} ${last.offerVersion} IN IP4 ${IP[last.by]}\na=${last.offerDir}`}</pre>
              <p className="hp-msg"><span className="hp-sip">200 OK</span> from {NAME[other(last.by)]}</p>
              <pre className="hp-sdp">{`o=${SESS[other(last.by)]} ${last.answerVersion} IN IP4 ${IP[other(last.by)]}\na=${last.answerDir}`}</pre>
              <p className="hp-why">{why!.bad && <span className="ud-warn" aria-hidden="true">⚠</span>}{why!.text}</p>
              {quote && <p className="ud-q">“{markKeywords(quote.text.replace(/\s+/g, ' '))}” <a href={quote.url} target="_blank" rel="noopener">RFC {quote.rfc} §{quote.section} ↗</a></p>}
            </>
          ) : <p className="insp-hint">The call is up: sendrecv both ways. Press Hold on Alice's phone.</p>}
        </section>
        <ol className="hp-hist" aria-label="Re-INVITEs so far">
          {hist.slice(1).map((h, i) => (
            <li key={i} className={h.ex!.ignored ? 'is-bad' : ''}>
              <span>{NAME[h.ex!.by]}</span> {h.ex!.offerDir} → {h.ex!.answerDir}{h.ex!.ignored ? ' (ignored)' : ''}
            </li>
          ))}
        </ol>
      </div>
    </figure>
  );
}
