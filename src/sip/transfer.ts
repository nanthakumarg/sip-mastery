/**
 * Call transfer generator (Module 22, RFC 3515, RFC 3891, RFC 5589). Alice
 * calls Bob, then transfers him to Carol: blind (a REFER to Carol's AOR) or
 * attended (Alice talks to Carol first, then a REFER with Replaces). Bob
 * reports the result to Alice in NOTIFYs with message/sipfrag bodies.
 * Every combination passes lint-flow.ts and lint-diagram.ts.
 */
import type { FlowData } from './flow.ts';
import { ALICE, BOB, CALL_ID, CAROL, Dialog, FlowWriter, nextMedia, sdp, type Msg, type Party } from './sipgen.ts';

export const TYPES = { blind: 'Blind', attended: 'Attended' } as const;
export const TARGETS = { answers: 'Carol answers', busy: 'Carol is busy (486)', 'no-answer': 'No answer (480)' } as const;
export const HANGUPS = { 'after-notify': 'After the final NOTIFY', 'after-202': 'Right after the 202' } as const;

export interface TransferOptions {
  type: keyof typeof TYPES;
  target: keyof typeof TARGETS;
  /** When Alice hangs up her call with Bob. */
  hangup: keyof typeof HANGUPS;
  /** Alice puts Bob on hold before the transfer. */
  hold: boolean;
  /** Not in the builder: the Replaces header has its tags swapped (the broken flow of Common mistakes). */
  swapTags?: boolean;
}

export const DEFAULT_TRANSFER: TransferOptions = { type: 'blind', target: 'answers', hangup: 'after-notify', hold: true };

export function applyTransfer(o: TransferOptions, change: Partial<TransferOptions>): { options: TransferOptions; notes: string[] } {
  const n = { ...o, ...change };
  const notes: string[] = [];
  if (n.type === 'attended' && !n.hold) {
    if ('hold' in change) { n.type = 'blind'; notes.push('Transfer: blind. In an attended transfer, Bob waits on hold while Alice talks to Carol.'); }
    else { n.hold = true; notes.push('Hold: on. In an attended transfer, Bob waits on hold while Alice talks to Carol.'); }
  }
  return { options: n, notes };
}

/** In an attended transfer to a Carol who does not answer, there is no REFER, so no hang-up choice. */
export function transferInactive(o: TransferOptions): Partial<Record<'hangup', string>> {
  return o.type === 'attended' && o.target !== 'answers' ? { hangup: 'Carol never answers Alice, so there is no REFER.' } : {};
}

export const transferKey = (o: TransferOptions) =>
  [o.type, o.target, transferInactive(o).hangup ? '' : o.hangup, o.hold ? 'hold' : ''].filter(Boolean).join('.');

export function allTransfers(): TransferOptions[] {
  const out = new Map<string, TransferOptions>();
  for (const type of Object.keys(TYPES) as TransferOptions['type'][])
    for (const target of Object.keys(TARGETS) as TransferOptions['target'][])
      for (const hangup of Object.keys(HANGUPS) as TransferOptions['hangup'][])
        for (const hold of [true, false]) {
          const o = { type, target, hangup, hold };
          if (!applyTransfer(o, {}).notes.length) out.set(transferKey(o), o);
        }
  return [...out.values()];
}

export const TRANSFER_QUOTES = [
  'rfc3264-8.4-hold', 'rfc3515-2.4.2-202', 'rfc3515-2.4.4-notify', 'rfc3515-2.4.5-sipfrag', 'rfc5589-5-bye', 'rfc3892-1-referred-by',
  'rfc3891-3-match', 'rfc3891-3-bye', 'rfc6665-4.2.2-481',
] as const;
type QuoteId = (typeof TRANSFER_QUOTES)[number];

const STATUS: Record<TransferOptions['target'], string> = { answers: '200 OK', busy: '486 Busy Here', 'no-answer': '480 Temporarily Unavailable' };

export function buildTransfer(options: TransferOptions): FlowData {
  const o = applyTransfer(options, {}).options;
  const w = new FlowWriter();
  const party = (node: typeof ALICE, name: string, aor: string, tag: string, user: string, id: number, port: number, pts: number[]): Party =>
    ({ node, name, aor, tag, seq: 0, media: { user, id, ip: node.ip, port, pts } });
  const ALICE_AOR = 'sip:alice@atlanta.example', BOB_AOR = 'sip:bob@biloxi.example', CAROL_AOR = 'sip:carol@chicago.example';
  const step = (from: typeof ALICE, to: typeof ALICE, label: string, caption: string, m: Msg, rfc?: QuoteId, warn?: string) =>
    w.msg(from, to, label, caption, m, { ...(rfc ? { rfc } : {}), ...(warn ? { warn } : {}) });

  // Alice and Bob talk (dialog 1).
  const a1 = party(ALICE, 'Alice', ALICE_AOR, ALICE.tag!, 'alice', 2890844526, 49170, [0, 8]);
  const b1 = party(BOB, 'Bob', BOB_AOR, BOB.tag!, 'bob', 2808844564, 3456, [0]);
  const ab = new Dialog(w, CALL_ID, a1, b1);
  const inv = ab.request(a1, 'INVITE', { sdp: sdp(a1.media) });
  step(ALICE, BOB, 'INVITE', 'Alice calls Bob.', inv);
  step(BOB, ALICE, '200 OK', 'Bob answers.', w.response(ab.hop(a1, inv), '200 OK', { tag: b1.tag, contact: BOB.contact, sdp: sdp(b1.media) }));
  ab.established = true;
  step(ALICE, BOB, 'ACK', 'Alice\'s phone confirms the 200 OK.', ab.ack(a1, 1));
  w.media(ALICE, BOB, 'RTP audio (PCMU)', 'Bob asks for someone in sales. Alice decides to transfer him to Carol.');

  /** A re-INVITE in dialog 1 that changes the direction of the media. */
  const reinvite = (dir: 'sendonly' | 'sendrecv', label: string, caption: string, rfc?: QuoteId) => {
    const r = ab.request(a1, 'INVITE', { sdp: sdp(nextMedia(a1, { dir })) });
    step(ALICE, BOB, `INVITE (${label})`, caption, r, rfc);
    step(BOB, ALICE, `200 OK (${dir === 'sendonly' ? 'recvonly' : 'sendrecv'})`, `Bob's phone answers a=${dir === 'sendonly' ? 'recvonly' : 'sendrecv'}.`,
      w.response(ab.hop(a1, r), '200 OK', { contact: BOB.contact, sdp: sdp(nextMedia(b1, { dir: dir === 'sendonly' ? 'recvonly' : 'sendrecv' })) }));
    step(ALICE, BOB, 'ACK', 'Alice\'s phone confirms the 200 OK.', ab.ack(a1, Number(r.cseq.split(' ')[0])));
  };
  if (o.hold) {
    reinvite('sendonly', 'hold', 'Alice puts Bob on hold first, so he hears music, not the transfer.', 'rfc3264-8.4-hold');
    w.media(ALICE, BOB, 'RTP music on hold', 'Bob hears music on hold.', { oneway: true });
  }
  const takeBack = (why: string) => {
    if (o.hold) {
      reinvite('sendrecv', 'resume', `${why} Alice takes Bob off hold.`);
      w.media(ALICE, BOB, 'RTP audio (PCMU)', 'Alice and Bob talk again. The transfer failed, but the call did not.');
    } else {
      w.media(ALICE, BOB, 'RTP audio (PCMU)', `${why} Alice is still in the call with Bob.`);
    }
  };

  // Attended: Alice calls Carol first (dialog 2).
  let referTo = `<${CAROL_AOR}>`;
  let replaces: string | undefined;
  let a2: Party | undefined, c2: Party | undefined, ac: Dialog | undefined;
  if (o.type === 'attended') {
    a2 = party(ALICE, 'Alice', ALICE_AOR, 'b81ac3e2', 'alice', 2890844530, 49172, [0, 8]);
    c2 = party(CAROL, 'Carol', CAROL_AOR, CAROL.tag!, 'carol', 3302218841, 5004, [0]);
    ac = new Dialog(w, 'c7d2e19a5b@192.0.2.10', a2, c2);
    const ci = ac.request(a2, 'INVITE', { sdp: sdp(a2.media) });
    step(ALICE, CAROL, 'INVITE', 'Alice calls Carol, on a second line. This is a new dialog, with a new Call-ID.', ci);
    if (o.target === 'busy') {
      step(CAROL, ALICE, '486 Busy Here', 'Carol is on another call.', w.response(ac.hop(a2, ci), '486 Busy Here', { tag: c2.tag }));
      step(ALICE, CAROL, 'ACK', 'Alice\'s phone confirms the 486.', w.ackNon2xx(ac.hop(a2, ci), c2.tag));
      takeBack('Carol cannot take the call, so there is nothing to transfer.');
      return done(o, w);
    }
    step(CAROL, ALICE, '180 Ringing', 'Carol\'s phone rings.', w.response(ac.hop(a2, ci), '180 Ringing', { tag: c2.tag, contact: CAROL.contact }));
    if (o.target === 'no-answer') {
      step(CAROL, ALICE, '480 Temporarily Unavailable', 'Nobody answers, so Carol\'s phone gives up.', w.response(ac.hop(a2, ci), '480 Temporarily Unavailable', { tag: c2.tag }));
      step(ALICE, CAROL, 'ACK', 'Alice\'s phone confirms the 480.', w.ackNon2xx(ac.hop(a2, ci), c2.tag));
      takeBack('Carol does not answer, so there is nothing to transfer.');
      return done(o, w);
    }
    step(CAROL, ALICE, '200 OK', 'Carol answers.', w.response(ac.hop(a2, ci), '200 OK', { tag: c2.tag, contact: CAROL.contact, sdp: sdp(c2.media) }));
    ac.established = true;
    step(ALICE, CAROL, 'ACK', 'Alice\'s phone confirms the 200 OK.', ac.ack(a2, 1));
    w.media(ALICE, CAROL, 'RTP audio (consultation)', 'Alice tells Carol about Bob. Bob still hears music on hold.');
    // Replaces names dialog 2 as Carol sees it: to-tag is her own tag (RFC 3891 §3).
    const [toTag, fromTag] = o.swapTags ? [a2.tag, c2.tag] : [c2.tag, a2.tag];
    replaces = `${ac.callId};to-tag=${toTag};from-tag=${fromTag}`;
    referTo = `<${CAROL.contact}?Replaces=${encodeURIComponent(ac.callId)}%3Bto-tag%3D${toTag}%3Bfrom-tag%3D${fromTag}>`;
  }

  // The REFER, in dialog 1 (RFC 5589 §5).
  const refer = ab.request(a1, 'REFER', { extra: [`Refer-To: ${referTo}`, `Referred-By: <${ALICE_AOR}>`] });
  step(ALICE, BOB, 'REFER', o.type === 'blind'
    ? 'Alice transfers Bob. The REFER asks Bob\'s phone to call the address in Refer-To.'
    : 'Alice transfers Bob. Refer-To carries Carol\'s Contact and a Replaces header for Alice\'s call with Carol.', refer, 'rfc3892-1-referred-by');
  step(BOB, ALICE, '202 Accepted', 'Bob\'s phone accepts the REFER. It will call Carol, and report back in NOTIFYs.',
    w.response(ab.hop(a1, refer), '202 Accepted', { contact: BOB.contact }), 'rfc3515-2.4.2-202');

  let alive = true;
  if (o.hangup === 'after-202') {
    const bye = ab.request(a1, 'BYE');
    step(ALICE, BOB, 'BYE', 'Alice hangs up at once. Her phone forgets the whole dialog, including the subscription.', bye,
      'rfc5589-5-bye', 'The BYE ends the call, not the subscription. Alice will not learn whether the transfer works.');
    step(BOB, ALICE, '200 OK (BYE)', 'Bob\'s phone confirms the BYE. Bob still hears nothing.', w.response(ab.hop(a1, bye), '200 OK', {}));
  }
  /** A NOTIFY from Bob with the status of his call to Carol (RFC 3515 §2.4.4, §2.4.5). */
  const notify = (status: string, final: boolean, caption: string, rfc?: QuoteId) => {
    if (!alive) return;
    const n = ab.request(b1, 'NOTIFY', {
      extra: ['Event: refer', `Subscription-State: ${final ? 'terminated;reason=noresource' : 'active;expires=60'}`],
      body: { type: 'message/sipfrag;version=2.0', text: `SIP/2.0 ${status}\n` },
    });
    step(BOB, ALICE, `NOTIFY (${status.slice(0, 3)})`, caption, n, rfc);
    if (o.hangup === 'after-202') {
      step(ALICE, BOB, '481 Call/Transaction Does Not Exist', 'Alice\'s phone has no dialog left, so it answers 481. That ends the subscription.',
        w.response(ab.hop(b1, n), '481 Call/Transaction Does Not Exist', {}), 'rfc6665-4.2.2-481');
      alive = false;
    } else {
      step(ALICE, BOB, '200 OK (NOTIFY)', final ? 'Alice\'s phone confirms the last NOTIFY. The subscription has ended.' : 'Alice\'s phone confirms the NOTIFY.',
        w.response(ab.hop(b1, n), '200 OK', { contact: ALICE.contact }));
    }
  };
  notify('100 Trying', false, 'The first NOTIFY says that Bob\'s phone is trying. Its body is a message/sipfrag.', 'rfc3515-2.4.4-notify');

  // Bob calls Carol (dialog 3), on behalf of Alice.
  const b3 = party(BOB, 'Bob', BOB_AOR, 'c4f2a91d', 'bob', 2808844570, 3458, [0, 8]);
  const c3 = party(CAROL, 'Carol', CAROL_AOR, 'e8d0b6', 'carol', 3302218850, 5006, [0]);
  const bc = new Dialog(w, 'a84b4c76e66710@203.0.113.20', b3, c3);
  const bi = bc.request(b3, 'INVITE', {
    ...(replaces ? { line: `INVITE ${CAROL.contact} SIP/2.0` } : {}),
    extra: [...(replaces ? [`Replaces: ${replaces}`] : []), `Referred-By: <${ALICE_AOR}>`], sdp: sdp(b3.media),
  });
  step(BOB, CAROL, replaces ? 'INVITE (Replaces)' : 'INVITE', replaces
    ? 'Bob\'s phone calls Carol\'s Contact, with the Replaces header from Refer-To. It is a new dialog, with a new Call-ID.'
    : 'Bob\'s phone calls Carol, as the REFER asked. It is a new dialog, with a new Call-ID and Referred-By.', bi);
  const final = o.swapTags ? '481 Call/Transaction Does Not Exist' : STATUS[o.type === 'attended' ? 'answers' : o.target];
  if (o.type === 'blind' && o.target !== 'busy') {
    step(CAROL, BOB, '180 Ringing', 'Carol\'s phone rings.', w.response(bc.hop(b3, bi), '180 Ringing', { tag: c3.tag, contact: CAROL.contact }));
  }
  if (final === '200 OK') {
    step(CAROL, BOB, '200 OK', replaces
      ? 'Carol\'s phone matches Replaces to her call with Alice, so it answers at once, with no ringing.'
      : 'Carol answers.', w.response(bc.hop(b3, bi), '200 OK', { tag: c3.tag, contact: CAROL.contact, sdp: sdp(c3.media) }), replaces ? 'rfc3891-3-match' : undefined);
    bc.established = true;
    step(BOB, CAROL, 'ACK', 'Bob\'s phone confirms. Bob and Carol now have a call.', bc.ack(b3, 1));
    if (ac && a2 && c2) {
      const cb = ac.request(c2, 'BYE');
      step(CAROL, ALICE, 'BYE', 'Carol\'s phone ends the replaced call with Alice.', cb, 'rfc3891-3-bye');
      step(ALICE, CAROL, '200 OK (BYE)', 'Alice\'s phone confirms. Alice is no longer talking to Carol.', w.response(ac.hop(c2, cb), '200 OK', {}));
    }
  } else {
    step(CAROL, BOB, final.split(' ').slice(0, 5).join(' '), o.swapTags
      ? 'Carol\'s phone compares to-tag with its own tag and finds no such dialog. It answers 481.'
      : o.target === 'busy' ? 'Carol is on another call.' : 'Nobody answers, so Carol\'s phone gives up.',
      w.response(bc.hop(b3, bi), final, { tag: c3.tag }));
    step(BOB, CAROL, 'ACK', `Bob's phone confirms the ${final.slice(0, 3)}.`, w.ackNon2xx(bc.hop(b3, bi), c3.tag),
      undefined, alive ? undefined : 'Bob\'s call to Carol failed, and Alice has gone. Bob has nobody to talk to.');
  }
  notify(final, true, final === '200 OK'
    ? 'The last NOTIFY carries the final response from Carol: 200 OK. The transfer worked.'
    : `The last NOTIFY carries Carol's final response: ${final.slice(0, 3)}. Alice now knows that the transfer failed.`, 'rfc3515-2.4.5-sipfrag');

  if (final === '200 OK') {
    if (o.hangup === 'after-notify') {
      const bye = ab.request(a1, 'BYE');
      step(ALICE, BOB, 'BYE', 'Now Alice hangs up her call with Bob. The REFER did not end it.', bye, 'rfc5589-5-bye');
      step(BOB, ALICE, '200 OK (BYE)', 'Bob\'s phone confirms. Alice is out of both calls.', w.response(ab.hop(a1, bye), '200 OK', {}));
    }
    w.media(BOB, CAROL, 'RTP audio (PCMU)', 'Bob and Carol talk. The transfer is complete.');
  } else if (o.hangup === 'after-notify') {
    takeBack(o.swapTags ? 'The transfer failed.' : 'Carol did not answer.');
  }
  return done(o, w);
}

function done(o: TransferOptions, w: FlowWriter): FlowData {
  return {
    id: `transfer-${transferKey(o)}`,
    title: `${TYPES[o.type]} transfer: ${TARGETS[o.target].replace(/ \(.*\)$/, '').replace(/^No answer$/, 'Carol does not answer')}`,
    lanes: [ALICE, BOB, CAROL].map(n => ({ id: n.id, label: n.label, kind: n.kind, sub: n.ip })),
    steps: w.steps,
  };
}
