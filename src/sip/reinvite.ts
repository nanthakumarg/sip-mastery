/**
 * Re-INVITE and UPDATE generator (Module 22): a call between Alice and Bob,
 * then one change to the session: hold, resume, a new codec, video, a new
 * address, or a session refresh. Either side sends it, with re-INVITE or
 * UPDATE, and the other side accepts it, rejects it, or sends its own at the
 * same moment (glare). Every combination passes lint-flow.ts and lint-diagram.ts.
 */
import type { FlowData } from './flow.ts';
import { ALICE, BOB, CALL_ID, Dialog, FlowWriter, nextMedia, sdp, type Msg, type Party, type SdpSpec } from './sipgen.ts';

export const CHANGES = {
  hold: 'Hold (sendonly)',
  inactive: 'Hold (inactive)',
  resume: 'Hold, then resume',
  codec: 'New codec (G.722)',
  video: 'Add video',
  address: 'New IP address',
  refresh: 'Session refresh',
} as const;
export type Change = keyof typeof CHANGES;
export const METHODS = { reinvite: 're-INVITE', update: 'UPDATE' } as const;
export const SENDERS = { alice: 'Alice', bob: 'Bob' } as const;
export const RESULTS = { accept: 'Accepted', reject: 'Rejected', glare: 'Both at once (491)' } as const;

export interface ReinviteOptions {
  change: Change;
  method: keyof typeof METHODS;
  /** Who sends the change. */
  by: keyof typeof SENDERS;
  result: keyof typeof RESULTS;
}

export const DEFAULT_REINVITE: ReinviteOptions = { change: 'hold', method: 'reinvite', by: 'alice', result: 'accept' };

/** The option that changed wins; the other moves (as in callflow.ts). */
export function applyReinvite(o: ReinviteOptions, change: Partial<ReinviteOptions>): { options: ReinviteOptions; notes: string[] } {
  const n = { ...o, ...change };
  const notes: string[] = [];
  if (n.result === 'reject' && n.change !== 'codec' && n.change !== 'video') {
    if ('result' in change) { n.change = 'codec'; notes.push('Change: new codec. The examples reject a codec or a video stream.'); }
    else { n.result = 'accept'; notes.push('Result: accepted. The examples reject only a codec or a video stream.'); }
  }
  if (n.result === 'glare' && n.change === 'resume') {
    if ('result' in change) { n.change = 'hold'; notes.push('Change: hold. The glare example has one change.'); }
    else { n.result = 'accept'; notes.push('Result: accepted. The glare example has one change.'); }
  }
  if (n.result === 'glare' && n.change === 'refresh' && n.method === 'update') {
    // An UPDATE with no SDP makes no offer, so two of them cannot conflict (RFC 3311 §5.2).
    if ('method' in change) { n.result = 'accept'; notes.push('Result: accepted. Two UPDATEs without SDP do not conflict.'); }
    else if ('result' in change) { n.method = 'reinvite'; notes.push('Method: re-INVITE. Two UPDATEs without SDP do not conflict.'); }
    else { n.change = 'hold'; notes.push('Change: hold. Two UPDATEs without SDP do not conflict.'); }
  }
  return { options: n, notes };
}

export const reinviteKey = (o: ReinviteOptions) => `${o.change}.${o.method}.${o.by}.${o.result}`;

export function allReinvites(): ReinviteOptions[] {
  const out: ReinviteOptions[] = [];
  for (const change of Object.keys(CHANGES) as Change[])
    for (const method of Object.keys(METHODS) as ReinviteOptions['method'][])
      for (const by of Object.keys(SENDERS) as ReinviteOptions['by'][])
        for (const result of Object.keys(RESULTS) as ReinviteOptions['result'][]) {
          const o = { change, method, by, result };
          if (!applyReinvite(o, {}).notes.length) out.push(o);
        }
  return out;
}

export const REINVITE_QUOTES = [
  'rfc3264-8.4-hold', 'rfc3264-8-version', 'rfc3264-8-same', 'rfc3264-6-reject', 'rfc3261-14.2-491', 'rfc3261-14.1-491-timer',
  'rfc3261-14.1-unchanged', 'rfc3264-8.3.1-address', 'rfc3311-5.1-update', 'rfc4028-7.2-half', 'rfc3261-12.2-target-refresh',
  'rfc3264-5.1-inactive', 'rfc3264-8.3.2-new-codec',
] as const;
type QuoteId = (typeof REINVITE_QUOTES)[number];

const SECOND_IP: Record<string, string> = { alice: '192.0.2.99', bob: '203.0.113.99' };
const VIDEO_PORT: Record<string, number> = { alice: 51372, bob: 31234 };

export function buildReinvite(options: ReinviteOptions): FlowData {
  const o = applyReinvite(options, {}).options;
  const w = new FlowWriter();
  const alice: Party = { node: ALICE, name: 'Alice', aor: 'sip:alice@atlanta.example', tag: ALICE.tag!, seq: 0, media: { user: 'alice', id: 2890844526, ip: ALICE.ip, port: 49170, pts: [0, 8] } };
  const bob: Party = { node: BOB, name: 'Bob', aor: 'sip:bob@biloxi.example', tag: BOB.tag!, seq: 0, media: { user: 'bob', id: 2808844564, ip: BOB.ip, port: 3456, pts: [0] } };
  const d = new Dialog(w, CALL_ID, alice, bob);
  const x = o.by === 'alice' ? alice : bob;
  const y = d.other(x);
  const M = o.method === 'update' ? 'UPDATE' : 'INVITE';
  const timer = o.change === 'refresh';

  // The call.
  const inv = d.request(alice, 'INVITE', { sdp: sdp(alice.media), extra: timer ? ['Supported: timer', 'Session-Expires: 1800'] : undefined });
  w.msg(ALICE, BOB, 'INVITE', timer ? 'Alice calls Bob. Session-Expires asks for a session timer of 1800 s.' : 'Alice calls Bob. The SDP offer lists PCMU and PCMA.', inv);
  const ok = w.response(d.hop(alice, inv), '200 OK', {
    tag: bob.tag, contact: BOB.contact, sdp: sdp(bob.media),
    extra: timer ? ['Require: timer', `Session-Expires: 1800;refresher=${o.by === 'alice' ? 'uac' : 'uas'}`] : undefined,
  });
  w.msg(BOB, ALICE, '200 OK', timer ? `Bob answers with PCMU and accepts the timer. ${x.name} must refresh the session within 1800 s.` : 'Bob answers. The SDP answer chooses PCMU.', ok);
  d.established = true;
  w.msg(ALICE, BOB, 'ACK', 'Alice confirms. The dialog is now confirmed.', d.ack(alice, 1));
  w.media(ALICE, BOB, 'RTP audio (PCMU)', 'Alice and Bob talk.');

  /** One offer/answer exchange in a re-INVITE or UPDATE, started by `p`. */
  interface Step { offer?: SdpSpec; label: string; caption: string; rfc?: QuoteId; extra?: string[] }
  const send = (p: Party, s: Step) => {
    const req = d.request(p, M, { sdp: s.offer && sdp(s.offer), extra: s.extra });
    w.msg(p.node, d.other(p).node, `${M} (${s.label})`, s.caption, req, s.rfc ? { rfc: s.rfc } : {});
    return req;
  };
  const answer = (p: Party, req: Msg, label: string, caption: string, ans: SdpSpec | undefined, more: { status?: string; extra?: string[]; rfc?: QuoteId } = {}) => {
    const q = d.other(p);
    const resp = w.response(d.hop(p, req), more.status ?? '200 OK', { contact: more.status ? undefined : q.node.contact, sdp: ans && sdp(ans), extra: more.extra });
    w.msg(q.node, p.node, label, caption, resp, more.rfc ? { rfc: more.rfc } : {});
    const seq = Number(req.cseq.split(' ')[0]);
    if (M === 'INVITE') {
      if (more.status) w.msg(p.node, q.node, 'ACK', `${p.name}'s phone confirms the ${more.status.slice(0, 3)} with the branch of its INVITE.`, w.ackNon2xx(d.hop(p, req), q.tag));
      else w.msg(p.node, q.node, 'ACK', `${p.name}'s phone confirms the 200 OK. The re-INVITE transaction ends.`, d.ack(p, seq));
    }
  };

  // The change, as an offer from x, and the answer y gives when it accepts it.
  const what = (): { offer: Step; accept: () => { sdp?: SdpSpec; label: string; caption: string; rfc?: QuoteId } } => {
    const usual = M === 'UPDATE' ? 'UPDATE works inside the dialog, with no ACK.' : 'The re-INVITE uses the same dialog: same Call-ID and tags.';
    switch (o.change) {
      case 'hold':
      case 'resume':
        return {
          offer: { offer: nextMedia(x, { dir: 'sendonly' }), label: 'hold', caption: `${x.name} puts ${y.name} on hold: a=sendonly and the next o= version. ${usual}`, rfc: 'rfc3264-8.4-hold' },
          accept: () => ({ sdp: nextMedia(y, { dir: 'recvonly', pts: [0] }), label: '200 OK (recvonly)', caption: `${y.name}'s phone answers a=recvonly: it will receive, but not send.` }),
        };
      case 'inactive':
        return {
          offer: { offer: nextMedia(x, { dir: 'inactive' }), label: 'hold', caption: `${x.name} puts ${y.name} on hold with a=inactive: no media in either direction. ${usual}`, rfc: 'rfc3264-5.1-inactive' },
          accept: () => ({ sdp: nextMedia(y, { dir: 'inactive', pts: [0] }), label: '200 OK (inactive)', caption: `${y.name}'s phone answers a=inactive. Neither side sends RTP now.` }),
        };
      case 'codec':
        return {
          offer: { offer: nextMedia(x, { pts: [9] }), label: 'G.722', caption: `${x.name}'s phone offers G.722 only, for wideband audio. The o= version goes up by one.`, rfc: 'rfc3264-8.3.2-new-codec' },
          accept: () => ({ sdp: nextMedia(y, { pts: [9] }), label: '200 OK (G.722)', caption: `${y.name}'s phone supports G.722 and answers with it.` }),
        };
      case 'video':
        return {
          offer: { offer: nextMedia(x, { pts: [0], video: VIDEO_PORT[x.node.id] }), label: 'add video', caption: `${x.name} turns on the camera. The offer keeps the audio m= line and adds an m=video line.`, rfc: 'rfc3264-8-version' },
          accept: () => ({ sdp: nextMedia(y, { pts: [0], video: VIDEO_PORT[y.node.id] }), label: '200 OK (video)', caption: `${y.name}'s phone accepts the video stream with its own port.` }),
        };
      case 'address':
        return {
          offer: { offer: nextMedia(x, { cIp: SECOND_IP[x.node.id] }), label: 'new address', caption: `${x.name}'s phone moves from Wi-Fi to another network. The new offer gives its new address in c=.`, rfc: 'rfc3264-8.3.1-address' },
          accept: () => ({ sdp: y.media, label: '200 OK (answer)', caption: `Nothing changes on ${y.name}'s side, so the answer keeps the same o= version.`, rfc: 'rfc3264-8-same' }),
        };
      case 'refresh': {
        const st = ['Supported: timer', 'Session-Expires: 1800;refresher=uac'];
        return M === 'UPDATE'
          ? {
              offer: { label: 'refresh', caption: `Half of the 1800 s has passed, so ${x.name}'s phone refreshes the session. An UPDATE with no SDP is enough.`, rfc: 'rfc4028-7.2-half', extra: st },
              accept: () => ({ label: '200 OK', caption: 'The 200 OK confirms the timer. Both phones start their 1800 s again.' }),
            }
          : {
              offer: { offer: x.media, label: 'refresh', caption: `Half of the 1800 s has passed, so ${x.name}'s phone refreshes the session. The SDP stays the same, with the same o= version.`, rfc: 'rfc4028-7.2-half', extra: st },
              accept: () => ({ sdp: y.media, label: '200 OK', caption: 'The 200 OK confirms the timer, with an unchanged SDP. Both phones start their 1800 s again.', rfc: 'rfc3264-8-same' }),
            };
      }
    }
  };
  const timerResp = timer ? ['Require: timer', 'Session-Expires: 1800;refresher=uac'] : undefined;

  // x's SDP before the change: what x answers with while its own offer is not yet accepted.
  const xBefore = { ...x.media };
  const c = what();
  if (o.result === 'glare') {
    // Both send an offer at the same moment; each answers the other with 491 (RFC 3261 §14.2).
    const mine = send(x, c.offer);
    const theirs = send(y, { offer: y.media, label: 'no change',
      caption: `At the same moment, ${y.name}'s phone sends its own ${M === 'INVITE' ? 're-INVITE' : 'UPDATE'}, with its unchanged SDP. The two requests cross.`,
      extra: timer ? ['Supported: timer', 'Session-Expires: 1800;refresher=uac'] : undefined });
    answer(x, mine, '491 Request Pending', `${y.name}'s phone is waiting for an answer to its own offer, so it rejects ${x.name}'s with 491.`, undefined, { status: '491 Request Pending', rfc: 'rfc3261-14.2-491' });
    answer(y, theirs, '491 Request Pending', `${x.name}'s phone does the same. Both offers fail, and the session stays as it was.`, undefined, { status: '491 Request Pending' });
    // Bob does not own the Call-ID, so he retries first (0–2 s); Alice waits 2.1–4 s (RFC 3261 §14.1).
    let changed = false;
    for (const p of [bob, alice]) {
      if (p === x) {
        changed = true;
        const r = send(x, { ...c.offer, caption: `${x.name}'s phone tries again after ${p === bob ? '0–2 s, because it does not own the Call-ID' : '2.1–4 s, because it owns the Call-ID'}. Same offer, new CSeq.`, rfc: 'rfc3261-14.1-491-timer' });
        const a = c.accept();
        answer(x, r, a.label, a.caption, a.sdp, { extra: timerResp, rfc: a.rfc });
      } else {
        const r = send(y, { offer: M === 'INVITE' || o.change !== 'refresh' ? y.media : undefined, label: 'no change', extra: timer ? ['Supported: timer', 'Session-Expires: 1800;refresher=uac'] : undefined,
          caption: `${y.name}'s phone tries again after ${p === bob ? '0–2 s, because it does not own the Call-ID' : '2.1–4 s, because it owns the Call-ID'}.`, rfc: p === bob ? 'rfc3261-14.1-491-timer' : undefined });
        answer(y, r, '200 OK', `${x.name}'s phone answers with its current SDP${changed ? ', which includes the change' : ''}.`, changed ? x.media : xBefore, { extra: timerResp });
      }
    }
  } else if (o.result === 'reject' && o.change === 'codec') {
    const before = { ...x.media, pts: o.by === 'alice' ? [0, 8] : [0], version: x.media.version };
    const r = send(x, c.offer);
    answer(x, r, '488 Not Acceptable Here', `${y.name}'s phone has no G.722, so it rejects the whole offer. A Warning header says why.`, undefined,
      { status: '488 Not Acceptable Here', extra: [`Warning: 305 ${y.node.ip} "Incompatible media format"`], rfc: 'rfc3261-14.1-unchanged' });
    x.media = before;
  } else if (o.result === 'reject' && o.change === 'video') {
    const r = send(x, c.offer);
    answer(x, r, '200 OK (video port 0)', `${y.name}'s phone has no camera. It accepts the offer, but answers m=video with port 0.`, nextMedia(y, { pts: [0], video: 0 }), { rfc: 'rfc3264-6-reject' });
  } else {
    const r = send(x, c.offer);
    const a = c.accept();
    answer(x, r, a.label, a.caption, a.sdp, { extra: timerResp, rfc: a.rfc });
  }

  // The media afterwards.
  const rejected = o.result === 'reject';
  switch (rejected ? 'unchanged' : o.change) {
    case 'hold':
      w.media(x.node, y.node, 'RTP music on hold', `${x.name}'s phone sends music on hold. ${y.name}'s phone sends nothing back.`, { oneway: true });
      break;
    case 'inactive':
      w.media(x.node, y.node, 'RTP stops', `No RTP in either direction. ${y.name} hears silence, unless the phone plays a tone of its own.`, { proto: 'down' });
      break;
    case 'resume': {
      w.media(x.node, y.node, 'RTP music on hold', `${x.name}'s phone sends music on hold. ${y.name}'s phone sends nothing back.`, { oneway: true });
      const r = send(x, { offer: nextMedia(x, { dir: 'sendrecv' }), label: 'resume', caption: `${x.name} takes ${y.name} off hold: a=sendrecv and the next o= version.`, rfc: 'rfc3264-8-version' });
      answer(x, r, '200 OK (sendrecv)', `${y.name}'s phone answers a=sendrecv, with its next version too.`, nextMedia(y, { dir: 'sendrecv' }));
      w.media(ALICE, BOB, 'RTP audio (PCMU)', 'Both phones send RTP again.');
      break;
    }
    case 'codec':
      w.media(ALICE, BOB, 'RTP audio (G.722)', 'The audio now uses G.722, on the same ports. Nothing else in the call changes.');
      break;
    case 'video':
      w.media(ALICE, BOB, 'RTP audio (PCMU)', 'The audio goes on as before, on its own port.');
      w.media(ALICE, BOB, 'RTP video (H.264)', 'The video uses its own RTP session, on the ports of the m=video lines.');
      break;
    case 'address':
      w.media(x.node, y.node, 'RTP audio (new address)', `${y.name}'s phone now sends to ${x.name}'s new address. The call goes on.`);
      break;
    case 'refresh':
      w.media(ALICE, BOB, 'RTP audio (PCMU)', 'Nothing changes in the media. The session timer protects against a call that stays up after one side has gone.');
      break;
    default:
      w.media(ALICE, BOB, o.change === 'video' ? 'RTP audio only' : 'RTP audio (PCMU)', o.change === 'video'
        ? 'The call goes on with audio only. The rejected stream changes nothing else.'
        : 'The session stays exactly as it was before the offer: PCMU, both ways.');
  }

  return {
    id: `reinvite-${reinviteKey(o)}`,
    title: `${CHANGES[o.change]}: ${x.name} sends ${METHODS[o.method]}${o.result === 'accept' ? '' : o.result === 'reject' ? ', rejected' : ', glare'}`,
    lanes: [ALICE, BOB].map(n => ({ id: n.id, label: n.label, kind: n.kind, sub: n.ip })),
    steps: w.steps,
  };
}
