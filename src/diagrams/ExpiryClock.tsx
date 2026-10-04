/**
 * Expiry clock (Module 12): one hour of Bob's phone behind a NAT router, on one
 * timeline. Rows: the REGISTER refreshes, the binding at the registrar, the
 * keepalives, the NAT mappings, and whether a call reaches Bob. Select a point on
 * the timeline to send Alice's INVITE at that time. The model is src/sip/expiry.ts.
 */
import { useMemo, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { DEFAULT_CLOCK, expiryClock, portsAt, stateAt, type ClockOptions, type Reach } from '../sip/expiry.ts';
import { quoteSource } from '../lib/rfc-ref.ts';
import type { ClientQuote } from './types.ts';

interface Props {
  quotes: Record<string, ClientQuote>;
  /** Starting settings, e.g. the broken case for a Common mistakes box. */
  initial?: Partial<ClockOptions> & { probe?: number };
  title?: string;
}

const ASKED = [60, 300, 600, 1800, 3600];
const MAX = [600, 3600];
const NAT = [30, 60, 120, 300];
const KEEP = [0, 25, 90];

const pct = (t: number, h: number) => `${(t / h) * 100}%`;

function clockTime(s: number): string {
  const m = Math.floor(s / 60), r = Math.round(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

const REACH_TEXT: Record<Reach, (p: { known?: number; open?: number }) => string> = {
  ok: p => `The INVITE reaches Bob. The registrar's Contact uses public port ${p.known}, and the NAT router still has that mapping.`,
  expired: () => 'Proxy B finds no binding: Bob\'s registration ran out. Alice gets 480 Temporarily Unavailable.',
  'nat-closed': p => `Proxy B sends the INVITE to port ${p.known}, but the NAT router closed that mapping and drops the packet. After Timer B (32 s), Proxy B answers Alice with 408 Request Timeout.`,
  'new-port': p => `A keepalive opened a new mapping on port ${p.open}, but the registrar still has port ${p.known}. The NAT router drops the INVITE, and Alice gets 408 after Timer B.`,
};
const REACH_RULE: Record<Reach, string> = {
  ok: 'rfc3261-10.2.4-refresh',
  expired: 'rfc3261-10.2.4-compare',
  'nat-closed': 'rfc4787-4.3-mapping-timer',
  'new-port': 'rfc4787-4.3-outbound-refresh',
};
const FIRST_TEXT: Record<Reach, string> = { ok: '', expired: 'the binding ran out', 'nat-closed': 'the NAT mapping closed', 'new-port': 'a new NAT port that the registrar does not know' };
const REACH_LABEL: Record<Reach, string> = { ok: 'Reaches Bob', expired: '480: no binding', 'nat-closed': 'Dropped at NAT', 'new-port': 'Dropped: old port' };

export default function ExpiryClock({ quotes, initial, title }: Props) {
  const [o, setO] = useState<ClockOptions>({ ...DEFAULT_CLOCK, ...initial });
  const [probe, setProbe] = useState(initial?.probe ?? 900);
  const c = useMemo(() => expiryClock(o), [o]);
  const h = o.horizon;
  const set = <K extends keyof ClockOptions>(k: K, v: ClockOptions[K]) => setO(x => ({ ...x, [k]: v }));

  const state = stateAt(c, probe);
  const ports = portsAt(c, probe);
  const quote = quotes[o.keepalive && state === 'ok' ? 'rfc5626-4.4.2-interval' : REACH_RULE[state]];

  const pick = (e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setProbe(Math.max(0, Math.min(h - 1, Math.round(((e.clientX - r.left) / r.width) * h))));
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const d = e.key === 'ArrowRight' ? 30 : e.key === 'ArrowLeft' ? -30 : 0;
    if (!d) return;
    e.preventDefault();
    setProbe(t => Math.max(0, Math.min(h - 1, t + (e.shiftKey ? d * 10 : d))));
  };

  const segRow = <T extends string | number>(label: string, values: T[], cur: T, onPick: (v: T) => void, fmt: (v: T) => string) => (
    <div className="ec-ctl">
      <span className="rl-glabel">{label}</span>
      <div className="seg" role="group" aria-label={label}>
        {values.map(v => <button key={String(v)} type="button" aria-pressed={cur === v} onClick={() => onPick(v)}>{fmt(v)}</button>)}
      </div>
    </div>
  );

  const mark = (first = false) => <i className={`ec-probe r-${state}${first ? ' is-first' : ''}`} style={{ left: pct(probe, h) }} aria-hidden="true" />;
  const ticks = [0, 600, 1200, 1800, 2400, 3000, 3600].filter(t => t <= h);
  const failShare = 1 - c.reachable;

  return (
    <figure className="stage eclock" aria-label="Expiry clock">
      <header className="stage-head">
        <div>
          <p className="eyebrow">Expiry clock</p>
          <p className="stage-title">{title ?? 'One hour of Bob\'s phone behind a NAT router'}</p>
        </div>
        <ul className="legend" aria-label="Legend">
          <li><i className="lg-sip" />REGISTER and binding</li>
          <li><i className="lg-rtcp" />Keepalive</li>
          <li><i className="ec-lg-nat" />NAT mapping</li>
          <li><i className="lg-err" />Call fails</li>
        </ul>
      </header>

      <div className="ec-controls">
        {segRow('Bob asks for', ASKED, o.asked, v => set('asked', v), v => `${v} s`)}
        {segRow('Registrar allows at most', MAX, o.maxExpires, v => set('maxExpires', v), v => `${v} s`)}
        {segRow('Bob refreshes at half of', ['granted', 'asked'] as ClockOptions['refresh'][], o.refresh, v => set('refresh', v), v => (v === 'granted' ? 'expires in the 200 OK' : 'what it asked for'))}
        {segRow('NAT mapping timeout', NAT, o.natTimeout, v => set('natTimeout', v), v => `${v} s`)}
        {segRow('Keepalives', KEEP, o.keepalive, v => set('keepalive', v), v => (v ? `every ${v} s` : 'none'))}
      </div>

      <div className="ec-summary">
        <p><b>{c.granted} s</b><span>binding granted{c.granted < o.asked ? ` (asked ${o.asked} s)` : ''}</span></p>
        <p><b>{c.registers.length}</b><span>REGISTER{c.registers.length > 1 ? 's' : ''} per hour</span></p>
        <p><b>{c.keepalives.length}</b><span>keepalives per hour</span></p>
        <p className={failShare > 0 ? 'is-bad' : ''}><b>{Math.round(c.reachable * 100)}%</b><span>of the hour, a call reaches Bob</span></p>
      </div>

      <div className="ec-chart" onClick={pick} onKeyDown={key} tabIndex={0} role="slider" aria-label="Time of Alice's call" aria-valuemin={0} aria-valuemax={h} aria-valuenow={probe} aria-valuetext={`${clockTime(probe)}: ${REACH_LABEL[state]}`}>
        <div className="ec-row">
          <span className="ec-label">REGISTER</span>
          <div className="ec-track">{c.registers.map(t => <i key={t} className="ec-tick k-sip" style={{ left: pct(t, h) }} />)}{mark(true)}</div>
        </div>
        <div className="ec-row">
          <span className="ec-label">Binding</span>
          <div className="ec-track is-gap">{c.binding.map(s => <i key={s.from} className="ec-bar k-sip" style={{ left: pct(s.from, h), width: pct(s.to - s.from, h) }} />)}{mark()}</div>
        </div>
        <div className="ec-row">
          <span className="ec-label">Keepalives</span>
          <div className="ec-track">{c.keepalives.length ? c.keepalives.map(t => <i key={t} className="ec-tick k-rtcp" style={{ left: pct(t, h) }} />) : <em>none</em>}{mark()}</div>
        </div>
        <div className="ec-row">
          <span className="ec-label">NAT mapping</span>
          <div className="ec-track is-gap">{c.mappings.map(m => (
            <i key={m.from} className="ec-bar k-nat" style={{ left: pct(m.from, h), width: pct(m.to - m.from, h) }} title={`port ${m.port}`}>
              {(m.to - m.from) / h > 0.09 && <span>port {m.port}</span>}
            </i>
          ))}{mark()}</div>
        </div>
        <div className="ec-row">
          <span className="ec-label">Call to Bob</span>
          <div className="ec-track">{c.segments.map(s => <i key={s.from} className={`ec-bar r-${s.state}`} style={{ left: pct(s.from, h), width: pct(s.to - s.from, h) }} />)}{mark()}</div>
        </div>
        <div className="ec-row ec-axis">
          <span className="ec-label" />
          <div className="ec-track">{ticks.map(t => <span key={t} style={{ left: pct(t, h) }}>{t === h ? `${t / 60} min` : t / 60}</span>)}</div>
        </div>
      </div>
      <p className="ec-hint">Select a point on the timeline, or use the arrow keys, to choose when Alice calls.</p>

      <div className="ec-result">
        <div className={`ec-call r-${state}`}>
          <p className="vs-nlabel">Alice calls at {clockTime(probe)} (t = {probe} s)</p>
          <p className="ec-verdict">{REACH_LABEL[state]}</p>
          <p className="ec-why">{REACH_TEXT[state](ports)}</p>
          {c.firstFailure && <p className="ec-first">First failure at {clockTime(c.firstFailure.from)}: {FIRST_TEXT[c.firstFailure.state]}.</p>}
        </div>
        {quote && (
          <div className="rv-quote">
            <p className="insp-q-src">{quoteSource(quote)}</p>
            <p>“{quote.text.replace(/\s+/g, ' ')}”</p>
            <a href={quote.url} target="_blank" rel="noopener">Read the section ↗</a>
          </div>
        )}
      </div>
    </figure>
  );
}
