/**
 * Event subscription generator (Module 23, RFC 6665): Alice subscribes to an
 * event package, gets NOTIFYs when the state changes, and the subscription
 * ends. Packages: presence (with Bob's PUBLISH, RFC 3856 and RFC 3903),
 * dialog for busy lamps (RFC 4235), message-summary for voicemail (RFC 3842),
 * and reg (RFC 3680). Every combination passes lint-flow.ts and lint-diagram.ts.
 */
import type { FlowData } from './flow.ts';
import { ALICE, BOB, Dialog, FlowWriter, type Msg, type Node, type Party } from './sipgen.ts';

export const PACKAGES = { presence: 'Presence', dialog: 'Dialog (busy lamp)', 'message-summary': 'Message waiting', reg: 'Registration (reg)' } as const;
export type Package = keyof typeof PACKAGES;
export const ANSWERS = { active: 'Accepts', pending: 'Pending, then accepts', rejected: 'Rejects (403)' } as const;
export const ENDS = { unsubscribe: 'Alice unsubscribes', timeout: 'Alice never refreshes', notifier: 'The notifier ends it' } as const;

export interface EventOptions {
  package: Package;
  answer: keyof typeof ANSWERS;
  end: keyof typeof ENDS;
  /** Alice refreshes the subscription once. */
  refresh: boolean;
  /** The first NOTIFY arrives before the 200 OK to the SUBSCRIBE. */
  early: boolean;
  /** Not in the builder: Alice's phone rejects the early NOTIFY with 481 (the broken flow of Common mistakes). */
  reject481?: boolean;
}

export const DEFAULT_EVENTS: EventOptions = { package: 'presence', answer: 'active', end: 'unsubscribe', refresh: false, early: false };

export function applyEvents(o: EventOptions, change: Partial<EventOptions>): { options: EventOptions; notes: string[] } {
  const n = { ...o, ...change };
  const notes: string[] = [];
  if (n.answer === 'pending' && n.package !== 'presence') {
    if ('answer' in change) { n.package = 'presence'; notes.push('Package: presence. Pending is for a watcher that Bob has not yet allowed.'); }
    else { n.answer = 'active'; notes.push('Answer: accepts. Pending is for a presence watcher that Bob has not yet allowed.'); }
  }
  return { options: n, notes };
}

/** After a 403 there is no subscription, so no end, refresh, or early NOTIFY. */
export function eventsInactive(o: EventOptions): Partial<Record<'end' | 'refresh' | 'early', string>> {
  if (o.answer !== 'rejected') return o.answer === 'pending' ? { early: 'A pending subscription gets its first NOTIFY after the 200 OK here.' } : {};
  const why = 'The 403 means there is no subscription.';
  return { end: why, refresh: why, early: why };
}

export const eventsKey = (o: EventOptions) => {
  const off = eventsInactive(o);
  return [o.package, o.answer, off.end ? '' : o.end, o.refresh && !off.refresh ? 'refresh' : '', o.early && !off.early ? 'early' : '', o.reject481 ? '481' : '']
    .filter(Boolean).join('.');
};

export function allEvents(): EventOptions[] {
  const out = new Map<string, EventOptions>();
  for (const pkg of Object.keys(PACKAGES) as Package[])
    for (const answer of Object.keys(ANSWERS) as EventOptions['answer'][])
      for (const end of Object.keys(ENDS) as EventOptions['end'][])
        for (const refresh of [false, true]) for (const early of [false, true]) {
          const o = { package: pkg, answer, end, refresh, early };
          if (!applyEvents(o, {}).notes.length) out.set(eventsKey(o), o);
        }
  return [...out.values()];
}

export const EVENTS_QUOTES = [
  'rfc6665-3.1.1-expires', 'rfc6665-4.1.2.2-refresh', 'rfc6665-4.1.2.3-unsubscribe', 'rfc6665-4.1.2.4-early', 'rfc6665-4.1.3-pending',
  'rfc6665-4.1.3-timeout', 'rfc6665-4.2.1.2-notify', 'rfc6665-4.1.3-reasons', 'rfc3903-4.2-initial', 'rfc3903-4.4-modify',
  'rfc3856-6.5-pidf', 'rfc4235-3.7-dialog', 'rfc3842-3.5-summary', 'rfc3680-3.1-reauth', 'rfc6665-4.2.1.3-403',
] as const;
type QuoteId = (typeof EVENTS_QUOTES)[number];

const PRESENCE_SERVER: Node = { id: 'ps', label: 'Presence server', kind: 'server', ip: '203.0.113.15', contact: 'sip:pres@203.0.113.15:5060', tag: 'ps7f1a2', br: 'ps' };
const PBX: Node = { id: 'pbx', label: 'PBX', kind: 'server', ip: '203.0.113.5', contact: 'sip:blf@203.0.113.5:5060', tag: 'pbx4c2e1', br: 'px' };
const VOICEMAIL: Node = { id: 'vm', label: 'Voicemail server', kind: 'server', ip: '203.0.113.50', contact: 'sip:mwi@203.0.113.50:5060', tag: 'vm88e1c', br: 'vm' };
const REGISTRAR: Node = { id: 'registrar', label: 'Registrar', kind: 'registrar', ip: '192.0.2.5', contact: 'sip:reg@192.0.2.5:5060', tag: 'rg90b3f', br: 'rg' };

const ALICE_AOR = 'sip:alice@atlanta.example', BOB_AOR = 'sip:bob@biloxi.example';

interface Spec {
  notifier: Node;
  /** The resource Alice subscribes to. */
  resource: { name: string; aor: string };
  type: string;
  /** The state before and after the change. */
  body: (changed: boolean, version: number) => string;
  change: string;
  quote: QuoteId;
  notifierEnd: { reason: string; caption: string };
}

const SPECS: Record<Package, Spec> = {
  presence: {
    notifier: PRESENCE_SERVER, resource: { name: 'Bob', aor: BOB_AOR }, type: 'application/pidf+xml',
    body: changed => pidf(changed),
    change: 'Bob starts a call. The presence server has his new state from his PUBLISH.',
    quote: 'rfc3856-6.5-pidf',
    notifierEnd: { reason: 'rejected', caption: 'Bob removes Alice from his allowed watchers. The server ends the subscription with reason=rejected.' },
  },
  dialog: {
    notifier: PBX, resource: { name: 'Bob', aor: BOB_AOR }, type: 'application/dialog-info+xml',
    body: (changed, version) => dialogInfo(changed, version),
    change: 'Bob answers a call. The PBX reports a confirmed dialog, so Alice\'s busy lamp for Bob turns red.',
    quote: 'rfc4235-3.7-dialog',
    notifierEnd: { reason: 'deactivated', caption: 'The PBX moves its subscriptions to another server. reason=deactivated tells Alice to subscribe again at once.' },
  },
  'message-summary': {
    notifier: VOICEMAIL, resource: { name: 'Alice', aor: ALICE_AOR }, type: 'application/simple-message-summary',
    body: changed => `Messages-Waiting: ${changed ? 'yes' : 'no'}\nMessage-Account: sip:alice@vmail.atlanta.example\nVoice-Message: ${changed ? '1/4' : '0/4'} (0/0)\n`,
    change: 'Bob leaves Alice a voicemail. Messages-Waiting: yes turns on her message lamp.',
    quote: 'rfc3842-3.5-summary',
    notifierEnd: { reason: 'noresource', caption: 'The administrator deletes Alice\'s mailbox. reason=noresource: there is nothing left to watch.' },
  },
  reg: {
    notifier: REGISTRAR, resource: { name: 'Alice', aor: ALICE_AOR }, type: 'application/reginfo+xml',
    body: (changed, version) => reginfo(changed, version),
    change: 'The administrator shortens the registration, for example after a fraud alert. The registrar tells Alice\'s phone at once.',
    quote: 'rfc3680-3.1-reauth',
    notifierEnd: { reason: 'deactivated', caption: 'The registrar restarts. reason=deactivated tells Alice\'s phone to subscribe again at once.' },
  },
};

function pidf(onPhone: boolean): string {
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<presence xmlns="urn:ietf:params:xml:ns:pidf" entity="pres:bob@biloxi.example">',
    '  <tuple id="bob-desk">', '    <status><basic>open</basic></status>', '    <contact>sip:bob@biloxi.example</contact>',
    `    <note>${onPhone ? 'On the phone' : 'Available'}</note>`, '  </tuple>', '</presence>'].join('\n') + '\n';
}

function dialogInfo(confirmed: boolean, version: number): string {
  return ['<?xml version="1.0" encoding="UTF-8"?>',
    `<dialog-info xmlns="urn:ietf:params:xml:ns:dialog-info" version="${version}" state="full" entity="sip:bob@biloxi.example">`,
    ...(confirmed ? ['  <dialog id="d7c19e2" direction="recipient">', '    <state>confirmed</state>', '  </dialog>'] : []),
    '</dialog-info>'].join('\n') + '\n';
}

function reginfo(shortened: boolean, version: number): string {
  return ['<?xml version="1.0" encoding="UTF-8"?>',
    `<reginfo xmlns="urn:ietf:params:xml:ns:reginfo" version="${version}" state="full">`,
    '  <registration aor="sip:alice@atlanta.example" id="a7" state="active">',
    `    <contact id="76" state="active" event="${shortened ? 'shortened' : 'registered'}"${shortened ? ' expires="60"' : ''}>`,
    '      <uri>sip:alice@192.0.2.10:5060</uri>', '    </contact>', '  </registration>', '</reginfo>'].join('\n') + '\n';
}

export function buildEvents(options: EventOptions): FlowData {
  const o = applyEvents(options, {}).options;
  const off = eventsInactive(o);
  const early = o.early && !off.early;
  const refresh = o.refresh && !off.refresh;
  const s = SPECS[o.package];
  const N = s.notifier;
  const w = new FlowWriter();
  const ev = `Event: ${o.package}`;

  // Presence: Bob's phone publishes his state first (RFC 3903).
  let etag = 'dx200xyz';
  const publish = (onPhone: boolean, first: boolean) => {
    const m: Msg = {
      line: `PUBLISH ${BOB_AOR} SIP/2.0`, via: [w.via(BOB)], maxForwards: 70, from: `Bob <${BOB_AOR}>;tag=pb${first ? 1 : 2}e4`, to: `Bob <${BOB_AOR}>`,
      callId: `pub${first ? 1 : 2}-81c2@203.0.113.20`, cseq: '1 PUBLISH', extra: [ev, ...(first ? [] : [`SIP-If-Match: ${etag}`]), 'Expires: 3600'],
      body: { type: 'application/pidf+xml', text: pidf(onPhone) },
    };
    w.msg(BOB, N, 'PUBLISH', first
      ? 'Bob\'s phone publishes his presence to the presence server: a PIDF document, with no SIP-If-Match.'
      : `Bob's phone publishes the change. SIP-If-Match names the state it replaces.`, m, { rfc: first ? 'rfc3903-4.2-initial' : 'rfc3903-4.4-modify' });
    const old = etag;
    etag = first ? 'dx200xyz' : 'kwj449x';
    w.msg(N, BOB, '200 OK', first ? 'The server stores the state. SIP-ETag names it, for later changes.' : `The server replaces state ${old}. The new SIP-ETag is ${etag}.`,
      w.response({ from: BOB, to: N, msg: m }, '200 OK', { tag: 'ps0b1', extra: [`SIP-ETag: ${etag}`, 'Expires: 3600'] }));
  };
  if (o.package === 'presence') publish(false, true);
  if (o.package === 'reg') {
    const reg: Msg = {
      line: 'REGISTER sip:atlanta.example SIP/2.0', via: [w.via(ALICE)], maxForwards: 70, from: `Alice <${ALICE_AOR}>;tag=r81f2`, to: `Alice <${ALICE_AOR}>`,
      callId: 'reg-9a1f3@192.0.2.10', cseq: '1 REGISTER', contact: ALICE.contact, extra: ['Expires: 3600'],
    };
    w.msg(ALICE, N, 'REGISTER', 'Alice\'s phone registers, as in Module 12.', reg);
    w.msg(N, ALICE, '200 OK', 'The registrar stores the binding for an hour.', w.response({ from: ALICE, to: N, msg: reg }, '200 OK', { tag: 'rg11', extra: [`Contact: <${ALICE.contact}>;expires=3600`] }));
  }

  // The subscription dialog.
  const a: Party = { node: ALICE, name: 'Alice', aor: ALICE_AOR, tag: 'sb44e0a', seq: 0, media: { user: 'alice', id: 0, ip: ALICE.ip, port: 0, pts: [] } };
  const n: Party = { node: N, name: s.resource.name, aor: s.resource.aor, tag: N.tag!, seq: 0, media: a.media };
  const d = new Dialog(w, `sub-${o.package}-7d1e@192.0.2.10`, a, n);
  // SUBSCRIBE goes to the resource; From is Alice, To is the resource.
  const subscribe = (expires: number) => {
    return d.request(a, 'SUBSCRIBE', { extra: [ev, `Accept: ${s.type}`, `Expires: ${expires}`] });
  };
  let version = 0;
  let left = 3600;
  const notify = (state: string, body: boolean, changed: boolean, caption: string, rfc?: QuoteId, warn?: string) => {
    const m = d.request(n, 'NOTIFY', {
      extra: [ev, `Subscription-State: ${state}`], ...(body ? { body: { type: s.type, text: s.body(changed, version++) } } : {}),
    });
    w.msg(N, ALICE, `NOTIFY (${state.split(';')[0]})`, caption, m, { ...(rfc ? { rfc } : {}), ...(warn ? { warn } : {}) });
    return m;
  };
  const ok = (m: Msg, caption: string) => w.msg(ALICE, N, '200 OK (NOTIFY)', caption, w.response(d.hop(n, m), '200 OK', {}));

  const first = subscribe(3600);
  w.msg(ALICE, N, 'SUBSCRIBE', `Alice's phone subscribes to ${o.package === 'message-summary' ? 'her own mailbox' : o.package === 'reg' ? 'her own registration' : 'Bob\'s state'}. Event names the package; Expires asks for an hour.`,
    first, { rfc: 'rfc6665-3.1.1-expires' });
  if (o.answer === 'rejected') {
    w.msg(N, ALICE, '403 Forbidden', `${N.label === 'PBX' ? 'The PBX' : `The ${N.label.toLowerCase()}`} does not allow Alice to watch this resource. There is no subscription and no NOTIFY.`,
      w.response(d.hop(a, first), '403 Forbidden', { tag: n.tag }), { rfc: 'rfc6665-4.2.1.3-403' });
    return done(o, s, w);
  }
  d.established = true;
  const accept = () => w.msg(N, ALICE, '200 OK', 'The notifier accepts the subscription. The 200 OK must carry Expires: the duration that counts.',
    w.response(d.hop(a, first), '200 OK', { tag: n.tag, contact: N.contact, extra: ['Expires: 3600'] }));
  const firstCaption = 'The first NOTIFY follows at once, with the full current state.';
  if (early) {
    if (o.reject481) {
      const m = notify('active;expires=3600', true, false, 'The first NOTIFY overtakes the 200 OK, which a packet loss delays.', 'rfc6665-4.1.2.4-early');
      w.msg(ALICE, N, '481 Call/Transaction Does Not Exist', 'Alice\'s phone has no dialog yet, so it rejects the NOTIFY with 481.', w.response(d.hop(n, m), '481 Call/Transaction Does Not Exist', {}),
        { warn: 'A subscriber must accept a NOTIFY that arrives before the 200 OK. The 481 ends the subscription.' });
      accept();
      return done(o, s, w);
    }
    ok(notify('active;expires=3600', true, false, 'The first NOTIFY overtakes the 200 OK. RFC 6665 allows that: the subscription exists as soon as the notifier accepts it.', 'rfc6665-4.1.2.4-early'),
      'Alice\'s phone accepts the NOTIFY, though the 200 OK has not arrived yet.');
    accept();
  } else {
    accept();
    if (o.answer === 'pending') {
      ok(notify('pending;expires=3600', false, false, 'Bob has not yet said whether Alice may watch him. The NOTIFY says pending, with no state.', 'rfc6665-4.1.3-pending'), 'Alice\'s phone confirms the NOTIFY.');
      ok(notify('active;expires=3540', true, false, 'Bob allows Alice to watch him. The next NOTIFY says active, with his current state.'), 'Alice\'s phone confirms the NOTIFY.');
      left = 3540;
    } else {
      ok(notify('active;expires=3600', true, false, firstCaption, 'rfc6665-4.2.1.2-notify'), 'Alice\'s phone confirms the NOTIFY.');
    }
  }

  // The state changes.
  if (o.package === 'presence') publish(true, false);
  ok(notify(`active;expires=${left - 1200}`, true, true, s.change, s.quote), 'Alice\'s phone confirms, and shows the new state.');
  left -= 1200;

  if (refresh) {
    const r = subscribe(3600);
    w.msg(ALICE, N, 'SUBSCRIBE (refresh)', 'Before the hour ends, Alice\'s phone refreshes the subscription in the same dialog, with the next CSeq.', r, { rfc: 'rfc6665-4.1.2.2-refresh' });
    w.msg(N, ALICE, '200 OK', 'The notifier extends the subscription by another hour.', w.response(d.hop(a, r), '200 OK', { contact: N.contact, extra: ['Expires: 3600'] }));
    ok(notify('active;expires=3600', true, true, 'Each refresh also brings a NOTIFY with the full state.'), 'Alice\'s phone confirms the NOTIFY.');
  }

  switch (o.end) {
    case 'unsubscribe': {
      const u = subscribe(0);
      w.msg(ALICE, N, 'SUBSCRIBE (Expires: 0)', 'Alice\'s phone unsubscribes: a SUBSCRIBE in the same dialog with Expires: 0.', u, { rfc: 'rfc6665-4.1.2.3-unsubscribe' });
      w.msg(N, ALICE, '200 OK', 'The notifier accepts. The subscription now ends.', w.response(d.hop(a, u), '200 OK', { contact: N.contact, extra: ['Expires: 0'] }));
      ok(notify('terminated', true, true, 'A final NOTIFY says terminated, with the state one last time.'), 'Alice\'s phone confirms. The subscription is over.');
      break;
    }
    case 'timeout':
      ok(notify('terminated;reason=timeout', false, true, 'Alice\'s phone never refreshed, and the hour has passed. The notifier ends the subscription.', 'rfc6665-4.1.3-timeout',
        refresh ? undefined : 'From now on, Alice sees no changes. Her phone must subscribe again.'), 'Alice\'s phone confirms. It hears about no further changes.');
      break;
    case 'notifier':
      ok(notify(`terminated;reason=${s.notifierEnd.reason}`, false, true, s.notifierEnd.caption, 'rfc6665-4.1.3-reasons'), 'Alice\'s phone confirms the last NOTIFY.');
      break;
  }
  return done(o, s, w);
}

function done(o: EventOptions, s: Spec, w: FlowWriter): FlowData {
  const lanes = o.package === 'presence' ? [ALICE, s.notifier, BOB] : [ALICE, s.notifier];
  return {
    id: `events-${eventsKey(o)}`,
    title: `${PACKAGES[o.package]}: ${o.answer === 'rejected' ? 'the SUBSCRIBE is rejected' : { unsubscribe: 'Alice unsubscribes', timeout: 'the subscription times out', notifier: 'the notifier ends it' }[o.end]}`,
    lanes: lanes.map(n => ({ id: n.id, label: n.label, kind: n.kind, sub: n.ip })),
    steps: w.steps,
  };
}
