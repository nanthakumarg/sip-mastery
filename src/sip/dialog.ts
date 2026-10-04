/**
 * Dialog state (Module 9), as one user agent sees it, step by step through
 * a flow (RFC 3261 §12, §13.2.2.4, §14). Used by the live dialog table, the
 * forking tree, and the dialog-target check in lint-flow.ts.
 */
import { cseq, getHeader, getHeaders, isRequest, tagOf, type SipMessage } from './parse.ts';

export type DialogPhase = 'early' | 'confirmed' | 'terminated';

export interface DialogState {
  callId: string;
  localTag: string;
  remoteTag: string;
  state: DialogPhase;
  /** Role of this UA in the transaction that created the dialog. */
  role: 'UAC' | 'UAS';
  localSeq?: number;
  remoteSeq?: number;
  localUri: string;
  remoteUri: string;
  remoteTarget: string;
  routeSet: string[];
  /** Short remark, e.g. why an early dialog will end. */
  note?: string;
}

export const DIALOG_FIELDS = ['state', 'localSeq', 'remoteSeq', 'localUri', 'remoteUri', 'remoteTarget', 'routeSet', 'note'] as const;
export type DialogField = (typeof DIALOG_FIELDS)[number];

export interface DialogSnapshot {
  dialogs: DialogState[];
  /** Dialog key → fields that changed at this step ("new" for a new dialog). */
  changed: Record<string, (DialogField | 'new')[]>;
}

export interface TrackStep { from: string; to: string; msg?: SipMessage }

export const dialogKey = (d: Pick<DialogState, 'callId' | 'localTag' | 'remoteTag'>) => `${d.callId};${d.localTag};${d.remoteTag}`;

/** The URI inside a name-addr ("Bob <sip:bob@b.example>;tag=1" → "sip:bob@b.example"). */
export function uriOf(value: string | undefined): string {
  if (!value) return '';
  const m = /<([^>]*)>/.exec(value);
  return (m ? m[1]! : value.split(';')[0]!).trim();
}

/** All URIs of a header that may repeat or hold a comma-separated list (Route, Record-Route). */
export function uriList(msg: SipMessage, name: string): string[] {
  return getHeaders(msg, name).flatMap(h => h.value.split(',')).map(uriOf).filter(Boolean);
}

/** Target refresh requests for INVITE dialogs: re-INVITE (RFC 3261) and UPDATE (RFC 3311). */
const REFRESH = new Set(['INVITE', 'UPDATE']);

export function trackDialogs(steps: TrackStep[], ua: string): DialogSnapshot[] {
  const dialogs = new Map<string, DialogState>();
  /** Requests this UA sent or received, to pair them with responses. */
  const sent: SipMessage[] = [];
  const received: SipMessage[] = [];
  const out: DialogSnapshot[] = [];

  const find = (list: SipMessage[], r: SipMessage) => {
    const c = cseq(r);
    for (let i = list.length - 1; i >= 0; i--) {
      const q = list[i]!;
      const qc = cseq(q);
      if (getHeader(q, 'Call-ID') === getHeader(r, 'Call-ID') && qc?.seq === c?.seq && qc?.method === c?.method) return q;
    }
    return undefined;
  };

  for (const s of steps) {
    const before = new Map([...dialogs].map(([k, d]) => [k, { ...d, routeSet: [...d.routeSet] }]));
    const m = s.msg;
    const isSent = s.from === ua, isRecv = s.to === ua;
    if (m && (isSent || isRecv)) {
      const cid = getHeader(m, 'Call-ID') ?? '';
      const c = cseq(m);
      if (m.kind === 'request') {
        (isSent ? sent : received).push(m);
        const toTag = tagOf(m, 'To');
        if (toTag && m.method !== 'ACK' && m.method !== 'CANCEL') {
          const key = isSent ? `${cid};${tagOf(m, 'From') ?? ''};${toTag}` : `${cid};${toTag};${tagOf(m, 'From') ?? ''}`;
          const d = dialogs.get(key);
          if (d && d.state !== 'terminated' && c) {
            if (isSent) d.localSeq = c.seq;
            else {
              if (d.remoteSeq === undefined || c.seq > d.remoteSeq) d.remoteSeq = c.seq;
              const contact = getHeader(m, 'Contact');
              if (REFRESH.has(m.method!) && contact) d.remoteTarget = uriOf(contact);
            }
          }
        }
      } else if (c) {
        const req = find(isSent ? received : sent, m);
        const status = m.status!;
        const toTag = tagOf(m, 'To');
        const fromTag = tagOf(m, 'From') ?? '';
        const creating = req && c.method === 'INVITE' && !tagOf(req, 'To');
        if (creating && toTag && ((status > 100 && status < 200) || (status >= 200 && status < 300))) {
          const key = isSent ? `${cid};${toTag};${fromTag}` : `${cid};${fromTag};${toTag}`;
          const phase: DialogPhase = status < 200 ? 'early' : 'confirmed';
          const d = dialogs.get(key);
          if (!d) {
            dialogs.set(key, isSent ? {
              callId: cid, localTag: toTag, remoteTag: fromTag, state: phase, role: 'UAS',
              remoteSeq: c.seq, localUri: uriOf(getHeader(req, 'To')), remoteUri: uriOf(getHeader(req, 'From')),
              remoteTarget: uriOf(getHeader(req, 'Contact')), routeSet: uriList(req, 'Record-Route'),
            } : {
              callId: cid, localTag: fromTag, remoteTag: toTag, state: phase, role: 'UAC',
              localSeq: c.seq, localUri: uriOf(getHeader(req, 'From')), remoteUri: uriOf(getHeader(req, 'To')),
              remoteTarget: uriOf(getHeader(m, 'Contact')), routeSet: uriList(m, 'Record-Route').reverse(),
            });
          } else if (phase === 'confirmed' && d.state === 'early') {
            d.state = 'confirmed';
            delete d.note;
            // RFC 3261 §13.2.2.4: the UAC recomputes the route set from the 2xx.
            if (!isSent) d.routeSet = uriList(m, 'Record-Route').reverse();
          }
          if (phase === 'confirmed' && !isSent) {
            for (const o of dialogs.values()) {
              if (o.callId === cid && o.localTag === fromTag && o.remoteTag !== toTag && o.state === 'early') o.note = 'Ends 64×T1 after the first 2xx';
            }
          }
        } else if (creating && status >= 300) {
          // RFC 3261 §12.3: a non-2xx final response ends the early dialogs of the request.
          for (const o of dialogs.values()) {
            const mine = isSent ? o.localTag === toTag && o.remoteTag === fromTag : o.localTag === fromTag;
            if (o.callId === cid && o.state === 'early' && mine) {
              o.state = 'terminated';
              o.note = `Ended by ${status}`;
            }
          }
        } else if (!creating && toTag) {
          const key = isSent ? `${cid};${toTag};${fromTag}` : `${cid};${fromTag};${toTag}`;
          const d = dialogs.get(key);
          if (d && d.state !== 'terminated') {
            if (!isSent && status >= 200 && status < 300 && REFRESH.has(c.method) && getHeader(m, 'Contact')) d.remoteTarget = uriOf(getHeader(m, 'Contact'));
            if (c.method === 'BYE' && status >= 200) { d.state = 'terminated'; d.note = 'Ended by BYE'; }
            else if (!isSent && (status === 481 || status === 408)) { d.state = 'terminated'; d.note = `Ended by ${status}`; }
          }
        }
      }
    }
    const changed: DialogSnapshot['changed'] = {};
    for (const [k, d] of dialogs) {
      const b = before.get(k);
      if (!b) { changed[k] = ['new']; continue; }
      const f = DIALOG_FIELDS.filter(x => JSON.stringify(b[x]) !== JSON.stringify(d[x]));
      if (f.length) changed[k] = f;
    }
    out.push({ dialogs: [...dialogs.values()].map(d => ({ ...d, routeSet: [...d.routeSet] })), changed });
  }
  return out;
}

/** True if the message is a request that this UA sends inside one of its live dialogs. */
export function liveDialogFor(snapshot: DialogSnapshot | undefined, m: SipMessage): DialogState | undefined {
  if (!isRequest(m) || !snapshot) return undefined;
  const key = `${getHeader(m, 'Call-ID')};${tagOf(m, 'From') ?? ''};${tagOf(m, 'To') ?? ''}`;
  const d = snapshot.dialogs.find(x => dialogKey(x) === key);
  return d && d.state !== 'terminated' ? d : undefined;
}
