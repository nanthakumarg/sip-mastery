/**
 * Line-level comparison of two SIP messages for the inspector.
 * Headers are compared per header name, so a new Via at the top shows as
 * "added", not as every Via "changed".
 */
import { parseMessage, type SipMessage } from '../sip/parse.ts';

export type LineState = 'same' | 'added' | 'changed';

export interface InspectLine {
  /** Index into message.lines */
  line: number;
  text: string;
  zone: 'start' | 'header' | 'blank' | 'body';
  name?: string;
  state: LineState;
}

export interface Inspection {
  msg: SipMessage;
  lines: InspectLine[];
  removed: string[];
}

export function safeParse(wire: string | undefined): SipMessage | undefined {
  if (!wire) return undefined;
  try { return parseMessage(wire); } catch { return undefined; }
}

/** The closest earlier message of the same kind (same method, or same status). */
export function comparableIndex(wires: (string | undefined)[], i: number): number {
  const cur = safeParse(wires[i]);
  if (!cur) return -1;
  for (let j = i - 1; j >= 0; j--) {
    const p = safeParse(wires[j]);
    if (!p || p.kind !== cur.kind) continue;
    if (cur.kind === 'request' ? p.method === cur.method : p.status === cur.status) return j;
  }
  return -1;
}

function bodyLines(m: SipMessage): string[] {
  return m.body ? m.body.replace(/\r\n$/, '').split('\r\n') : [];
}

export function inspect(wire: string, prevWire?: string): Inspection | undefined {
  const msg = safeParse(wire);
  if (!msg) return undefined;
  const prev = safeParse(prevWire);
  const lines: InspectLine[] = [];
  const removed: string[] = [];

  lines.push({ line: 0, text: msg.startLine, zone: 'start', state: prev && prev.startLine !== msg.startLine ? 'changed' : 'same' });

  // Headers, grouped by name.
  const byName = new Map<string, { cur: number[]; prev: string[] }>();
  msg.headers.forEach((h, k) => {
    const e = byName.get(h.name) ?? { cur: [], prev: [] };
    e.cur.push(k);
    byName.set(h.name, e);
  });
  prev?.headers.forEach(h => {
    const e = byName.get(h.name) ?? { cur: [], prev: [] };
    e.prev.push(h.value);
    byName.set(h.name, e);
  });
  const headerState = new Map<number, LineState>();
  for (const [name, e] of byName) {
    const pool = [...e.prev];
    const unmatched: number[] = [];
    for (const k of e.cur) {
      const at = pool.indexOf(msg.headers[k]!.value);
      if (at >= 0) { pool.splice(at, 1); headerState.set(k, 'same'); } else unmatched.push(k);
    }
    unmatched.forEach((k, n) => headerState.set(k, !prev ? 'same' : n < pool.length ? 'changed' : 'added'));
    pool.slice(unmatched.length).forEach(v => removed.push(`${name}: ${v}`));
  }
  msg.headers.forEach((h, k) => {
    lines.push({ line: h.line, text: msg.lines[h.line]!, zone: 'header', name: h.name, state: headerState.get(k) ?? 'same' });
  });

  // Body, compared line by line as a multiset.
  const body = bodyLines(msg);
  if (body.length) lines.push({ line: msg.blankLine, text: '', zone: 'blank', state: 'same' });
  const prevBody = prev ? bodyLines(prev) : [];
  const pool = [...prevBody];
  body.forEach((text, k) => {
    const at = pool.indexOf(text);
    const state: LineState = !prev || at >= 0 ? 'same' : 'added';
    if (at >= 0) pool.splice(at, 1);
    lines.push({ line: msg.blankLine + 1 + k, text, zone: 'body', name: text.slice(0, 1), state });
  });
  if (prev) pool.forEach(t => removed.push(t));

  return { msg, lines, removed };
}
