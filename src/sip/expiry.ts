/**
 * Expiry clock model (Module 12): one hour of a phone behind a NAT router.
 * The binding lives as long as the registrar allows (RFC 3261 §10.3); the NAT
 * mapping lives until no packet has gone out for the NAT timeout (RFC 4787 §4.3,
 * REQ-6: only outgoing packets refresh it). A call reaches the phone only when
 * the binding is valid, a mapping is open, and the registrar knows its port.
 * The diagram is src/diagrams/ExpiryClock.tsx; tests are in tests/registrar.test.ts.
 */

export interface ClockOptions {
  /** Expires that the phone asks for. */
  asked: number;
  /** Longest expiry the registrar allows. */
  maxExpires: number;
  /** The phone refreshes at half of the expiry in the 200 OK, or (a bug) half of what it asked for. */
  refresh: 'granted' | 'asked';
  /** NAT UDP mapping timeout. */
  natTimeout: number;
  /** Seconds between keepalives; 0 = none. */
  keepalive: number;
  /** Length of the timeline in seconds. */
  horizon: number;
}

export const DEFAULT_CLOCK: ClockOptions = { asked: 3600, maxExpires: 3600, refresh: 'granted', natTimeout: 60, keepalive: 0, horizon: 3600 };

export type Reach = 'ok' | 'expired' | 'nat-closed' | 'new-port';

export interface Span { from: number; to: number }
export interface Mapping extends Span { port: number }
export interface Segment extends Span { state: Reach }

export interface Clock {
  granted: number;
  registers: number[];
  keepalives: number[];
  binding: Span[];
  mappings: Mapping[];
  segments: Segment[];
  /** Share of the timeline when a call reaches the phone, 0 to 1. */
  reachable: number;
  firstFailure?: Segment;
}

/** The public port of the NAT router's n-th mapping: a different one each time. */
export const portOf = (n: number) => 40112 + ((n * 7919) % 25000);

function union(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const s of [...spans].sort((a, b) => a.from - b.from)) {
    const last = out.at(-1);
    if (last && s.from <= last.to) last.to = Math.max(last.to, s.to);
    else out.push({ ...s });
  }
  return out;
}

export function expiryClock(o: ClockOptions): Clock {
  const granted = Math.min(o.asked, o.maxExpires);
  const every = (o.refresh === 'granted' ? granted : o.asked) / 2;
  const registers: number[] = [];
  for (let t = 0; t < o.horizon; t += every) registers.push(t);
  const keepalives: number[] = [];
  if (o.keepalive > 0) for (let t = o.keepalive; t < o.horizon; t += o.keepalive) if (!registers.includes(t)) keepalives.push(t);

  const binding = union(registers.map(t => ({ from: t, to: Math.min(t + granted, o.horizon) })));

  // Every outgoing packet refreshes the mapping; after a gap, the router opens a new one on a new port.
  const mappings: Mapping[] = [];
  for (const p of [...registers, ...keepalives].sort((a, b) => a - b)) {
    const cur = mappings.at(-1);
    if (cur && p < cur.to) cur.to = Math.min(p + o.natTimeout, o.horizon);
    else mappings.push({ from: p, to: Math.min(p + o.natTimeout, o.horizon), port: portOf(mappings.length) });
  }

  const cuts = [...new Set([0, o.horizon, ...binding.flatMap(s => [s.from, s.to]), ...mappings.flatMap(m => [m.from, m.to]), ...registers])]
    .filter(t => t >= 0 && t <= o.horizon).sort((a, b) => a - b);
  const segments: Segment[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const from = cuts[i]!, to = cuts[i + 1]!;
    const state = stateAt({ binding, mappings, registers }, (from + to) / 2);
    const last = segments.at(-1);
    if (last && last.state === state) last.to = to;
    else segments.push({ from, to, state });
  }
  const ok = segments.filter(s => s.state === 'ok').reduce((n, s) => n + s.to - s.from, 0);
  return { granted, registers, keepalives, binding, mappings, segments, reachable: ok / o.horizon, firstFailure: segments.find(s => s.state !== 'ok') };
}

/** Where an INVITE for the phone ends at time t. */
export function stateAt(c: Pick<Clock, 'binding' | 'mappings' | 'registers'>, t: number): Reach {
  if (!c.binding.some(s => s.from <= t && t < s.to)) return 'expired';
  const open = c.mappings.find(m => m.from <= t && t < m.to);
  if (!open) return 'nat-closed';
  // The registrar knows the port of the mapping that carried the last REGISTER.
  const lastReg = c.registers.filter(r => r <= t).at(-1) ?? 0;
  const known = c.mappings.find(m => m.from <= lastReg && lastReg < m.to);
  return known === open ? 'ok' : 'new-port';
}

/** The public port in the binding at time t, and the port of the open mapping (if any). */
export function portsAt(c: Clock, t: number): { known?: number; open?: number } {
  const lastReg = c.registers.filter(r => r <= t).at(-1) ?? 0;
  return {
    known: c.mappings.find(m => m.from <= lastReg && lastReg < m.to)?.port,
    open: c.mappings.find(m => m.from <= t && t < m.to)?.port,
  };
}
