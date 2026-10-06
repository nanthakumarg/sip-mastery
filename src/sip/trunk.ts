/**
 * SIP trunk generator (Module 24): a PBX calls a mobile phone in the PSTN
 * through a carrier's SBC (a B2BUA, so each side is its own dialog) and the
 * carrier's gateway, which speaks ISUP to the telephone exchange. Options:
 * how the trunk is set up, the number format, caller ID and privacy
 * (RFC 3325, RFC 3323), forwarding history (Diversion, History-Info), the
 * PSTN outcome with its Q.850 cause (RFC 3398, RFC 6432), and in-band early
 * media. Every combination passes lint-flow.ts and lint-diagram.ts.
 */
import type { FlowData } from './flow.ts';
import { FlowWriter, sdp, type Msg, type Node } from './sipgen.ts';

export const TRUNKS = { register: 'Registration', ip: 'IP address' } as const;
export const NUMBERS = { e164: 'E.164: +14045550199', national: 'National: 4045550199', local: 'Local: 5550199' } as const;
export const CALLER_IDS = { shown: 'Shown', withheld: 'Withheld (Privacy: id)', 'from-only': 'Anonymous From only' } as const;
export const REDIRECTS = { none: 'Not forwarded', diversion: 'With Diversion', 'history-info': 'With History-Info', lost: 'With no history' } as const;
export const PSTN_OUTCOMES = {
  answer: 'Answers', busy: 'Busy (17)', 'no-answer': 'No answer (19)', unallocated: 'Not in service (1)', congestion: 'No circuit (34)',
} as const;

export interface TrunkOptions {
  trunk: keyof typeof TRUNKS;
  number: keyof typeof NUMBERS;
  callerId: keyof typeof CALLER_IDS;
  /** The call is one that Alice forwards to the mobile: Carol called her. */
  redirect: keyof typeof REDIRECTS;
  outcome: keyof typeof PSTN_OUTCOMES;
  /** The exchange sends tones or an announcement in-band, so the gateway sends 183 with SDP. */
  earlyMedia: boolean;
}

export const DEFAULT_TRUNK: TrunkOptions = { trunk: 'register', number: 'e164', callerId: 'shown', redirect: 'none', outcome: 'answer', earlyMedia: true };

export function applyTrunk(o: TrunkOptions, change: Partial<TrunkOptions>): { options: TrunkOptions; notes: string[] } {
  return { options: { ...o, ...change }, notes: [] };
}

/** A local number never reaches the PSTN; busy and congestion end the call before any tones. */
export function trunkInactive(o: TrunkOptions): Partial<Record<'outcome' | 'earlyMedia', string>> {
  if (o.number === 'local') {
    const why = 'The gateway rejects the number. The PSTN never sees the call.';
    return { outcome: why, earlyMedia: why };
  }
  if (o.outcome === 'busy' || o.outcome === 'congestion') return { earlyMedia: 'The exchange releases the call at once, with no ACM and no tones.' };
  return {};
}

export const trunkKey = (o: TrunkOptions) => {
  const off = trunkInactive(o);
  return [o.trunk, o.number, o.callerId, o.redirect, off.outcome ? '' : o.outcome, o.earlyMedia && !off.earlyMedia ? 'early' : '']
    .filter(Boolean).join('.');
};

export function allTrunks(): TrunkOptions[] {
  const out = new Map<string, TrunkOptions>();
  for (const trunk of Object.keys(TRUNKS) as TrunkOptions['trunk'][])
    for (const number of Object.keys(NUMBERS) as TrunkOptions['number'][])
      for (const callerId of Object.keys(CALLER_IDS) as TrunkOptions['callerId'][])
        for (const redirect of Object.keys(REDIRECTS) as TrunkOptions['redirect'][])
          for (const outcome of Object.keys(PSTN_OUTCOMES) as TrunkOptions['outcome'][])
            for (const earlyMedia of [false, true]) {
              const o = { trunk, number, callerId, redirect, outcome, earlyMedia };
              out.set(trunkKey(o), o);
            }
  return [...out.values()];
}

export const TRUNK_QUOTES = [
  'rfc3261-22.2-challenge-401', 'rfc3261-22.3-challenge-407', 'rfc3261-11-options', 'rfc6140-1-blocks', 'rfc3966-5.1.4-global',
  'rfc3398-12.2-484', 'rfc3398-12.2-national', 'rfc3325-9.3-id', 'rfc3398-5.7-privacy', 'rfc5806-3-diversion',
  'rfc7044-1-history', 'rfc3398-7.2.6-180', 'rfc3398-7.2.6-183', 'rfc3398-7.2.7-anm', 'rfc3398-7.2.4.1-rel',
  'rfc6432-3-reason', 'rfc3326-2-reason', 'rfc3398-5.5-early-media',
] as const;
type QuoteId = (typeof TRUNK_QUOTES)[number];

// The network: Alice's company PBX in Atlanta, and the carrier's SBC and gateway.
const PBX: Node = { id: 'pbx', label: 'PBX', kind: 'b2bua', ip: '192.0.2.20', contact: 'sip:pbx@192.0.2.20:5060', br: 'px' };
const SBC: Node = { id: 'sbc', label: 'Carrier SBC', kind: 'sbc', ip: '198.51.100.50', contact: 'sip:sbc@198.51.100.50:5060', br: 'sb' };
const GW: Node = { id: 'gw', label: 'Carrier gateway', kind: 'server', ip: '198.51.100.80', contact: 'sip:gw@198.51.100.80:5060', br: 'gw' };
const PSTN = { id: 'pstn', label: 'PSTN', kind: 'server' as const };

const DOMAIN = 'sip.carrier.example';
const MAIN = '+14045550100', ALICE_DID = '+14045550101', CAROL_NUM = '+12025550123', MOBILE = '+14045550199';
const DIALLED: Record<TrunkOptions['number'], string> = { e164: MOBILE, national: '4045550199', local: '5550199' };
const tel = (n: string, host = DOMAIN) => `sip:${n}@${host};user=phone`;
const NONCE = '7c5e2a91b04d3f68';
const CREDENTIALS = { username: 'atl-trunk-01', password: 'trunk-secret-2026' };

const Q850: Record<number, string> = {
  1: 'Unallocated (unassigned) number', 16: 'Normal call clearing', 17: 'User busy', 19: 'No answer from user (user alerted)',
  28: 'Invalid number format (address incomplete)', 34: 'No circuit/channel available',
};
const reason = (cause: number) => `Reason: Q.850;cause=${cause};text="${Q850[cause]}"`;
/** National significant number: the gateway strips +1, which is local to it (RFC 3398 §12.2). */
const nsn = (n: string) => n.replace(/^\+1/, '');

/** One side of the call through the SBC: its own Call-ID, tags, and CSeq numbers. */
interface Leg {
  callId: string;
  uac: Node;
  uas: Node;
  ruri: string;
  from: string;
  to: string;
  uacTag: string;
  uasTag: string;
  extra: string[];
  seq: number;
}

export function buildTrunk(options: TrunkOptions): FlowData {
  const o = applyTrunk(options, {}).options;
  const off = trunkInactive(o);
  const early = o.earlyMedia && !off.earlyMedia;
  const w = new FlowWriter();
  const forwarded = o.redirect !== 'none';
  const caller = forwarded ? { name: 'Carol', num: CAROL_NUM } : { name: 'Alice', num: ALICE_DID };
  const anon = o.callerId !== 'shown';

  // Requests and responses on one leg.
  const invite = (l: Leg, sdpText: string, more: string[] = []): Msg => ({
    line: `INVITE ${l.ruri} SIP/2.0`, via: [w.via(l.uac)], maxForwards: 70, from: `${l.from};tag=${l.uacTag}`, to: l.to,
    callId: l.callId, cseq: `${++l.seq} INVITE`, contact: l.uac.contact, extra: [...l.extra, ...more], sdp: sdpText,
  });
  const resp = (req: Msg, status: string, l: Leg, more: Partial<Msg> = {}): Msg => ({
    line: `SIP/2.0 ${status}`, via: req.via, from: req.from, to: status.startsWith('100') ? req.to : `${req.to};tag=${l.uasTag}`,
    callId: req.callId, cseq: req.cseq, ...more,
  });
  const ackNon2xx = (req: Msg, l: Leg): Msg => ({
    line: `ACK ${l.ruri} SIP/2.0`, via: [req.via[0]!], maxForwards: 70, from: req.from, to: `${req.to};tag=${l.uasTag}`,
    callId: l.callId, cseq: `${req.cseq.split(' ')[0]} ACK`,
  });
  const ack2xx = (req: Msg, l: Leg): Msg => ({
    line: `ACK ${l.uas.contact} SIP/2.0`, via: [w.via(l.uac)], maxForwards: 70, from: req.from, to: `${req.to};tag=${l.uasTag}`,
    callId: l.callId, cseq: `${req.cseq.split(' ')[0]} ACK`,
  });
  /** A BYE from the UAS side of a leg, toward the side that sent the INVITE. */
  const byeBack = (l: Leg, more: string[]): Msg => ({
    line: `BYE ${l.uac.contact} SIP/2.0`, via: [w.via(l.uas)], maxForwards: 70, from: `${l.to};tag=${l.uasTag}`, to: `${l.from};tag=${l.uacTag}`,
    callId: l.callId, cseq: '1 BYE', extra: more,
  });
  const ok = (req: Msg): Msg => ({ line: 'SIP/2.0 200 OK', via: req.via, from: req.from, to: req.to, callId: req.callId, cseq: req.cseq });
  const isup = (from: string, to: string, label: string, caption: string, detail: string, more: { rfc?: QuoteId; warn?: string } = {}) =>
    w.steps.push({ from, to, proto: 'net', label, caption, detail, ...more });

  // 24.1: how the carrier knows the PBX.
  if (o.trunk === 'register') {
    const reg: Msg = {
      line: `REGISTER sip:${DOMAIN} SIP/2.0`, via: [w.via(PBX)], maxForwards: 70, from: `<${tel(MAIN)}>;tag=rg51a`, to: `<${tel(MAIN)}>`,
      callId: 'trunkreg-6f2a@192.0.2.20', cseq: '1 REGISTER', contact: `sip:${MAIN}@192.0.2.20:5060`, extra: ['Expires: 3600'],
    };
    w.msg(PBX, SBC, 'REGISTER', 'The PBX registers the trunk\'s main number, like a phone. The carrier then sends calls for the whole number block there.', reg, { rfc: 'rfc6140-1-blocks' });
    w.msg(SBC, PBX, '401 Unauthorized', 'The carrier asks for the trunk\'s username and password.',
      { ...ok(reg), line: 'SIP/2.0 401 Unauthorized', to: `${reg.to};tag=sb7e01`, extra: [`WWW-Authenticate: Digest realm="${DOMAIN}", nonce="${NONCE}", algorithm=MD5, qop="auth"`] },
      { rfc: 'rfc3261-22.2-challenge-401' });
    const reg2: Msg = {
      ...reg, via: [w.via(PBX)], cseq: '2 REGISTER',
      extra: [`Authorization: Digest username="${CREDENTIALS.username}", realm="${DOMAIN}", nonce="${NONCE}", uri="sip:${DOMAIN}", response="{digest}", algorithm=MD5, qop=auth, nc=00000001, cnonce="0a4f113b"`, 'Expires: 3600'],
    };
    w.msg(PBX, SBC, 'REGISTER (credentials)', 'The PBX sends the REGISTER again, with Authorization.', reg2);
    w.msg(SBC, PBX, '200 OK', 'The carrier stores the binding for an hour. The PBX refreshes it before then.',
      { ...ok(reg2), to: `${reg2.to};tag=sb7e02`, contact: undefined, extra: [`Contact: <sip:${MAIN}@192.0.2.20:5060>;expires=3600`] });
  } else {
    const opt: Msg = {
      line: 'OPTIONS sip:pbx@192.0.2.20:5060 SIP/2.0', via: [w.via(SBC)], maxForwards: 70, from: `<sip:ping@${DOMAIN}>;tag=op93c`, to: '<sip:pbx@192.0.2.20:5060>',
      callId: 'ping-41d7@198.51.100.50', cseq: '1 OPTIONS', extra: ['Accept: application/sdp'],
    };
    w.msg(SBC, PBX, 'OPTIONS', 'The carrier knows the PBX by its fixed address, 192.0.2.20: no REGISTER, no password. It checks the PBX with OPTIONS.', opt, { rfc: 'rfc3261-11-options' });
    w.msg(PBX, SBC, '200 OK', 'The PBX is up. The carrier sends calls only to a PBX that answers its OPTIONS.',
      { ...ok(opt), to: `${opt.to};tag=px20c`, extra: ['Allow: INVITE, ACK, CANCEL, BYE, OPTIONS'] });
  }

  // 24.2 and 24.3: the INVITE from the PBX.
  const pai = `P-Asserted-Identity: <${tel(caller.num)}>`;
  const history = o.redirect === 'diversion' ? [`Diversion: <${tel(ALICE_DID)}>;reason=unconditional;counter=1`]
    : o.redirect === 'history-info' ? [`History-Info: <${tel(ALICE_DID, 'pbx.atlanta.example')}?Reason=SIP%3Bcause%3D302>;index=1`, `History-Info: <${tel(MOBILE)}>;index=1.1;mp=1`]
    : [];
  const leg1: Leg = {
    callId: 'a84b4c76e66710@192.0.2.20', uac: PBX, uas: SBC, ruri: tel(DIALLED[o.number]),
    from: anon ? '"Anonymous" <sip:anonymous@anonymous.invalid>' : `"${caller.name}" <${tel(caller.num)}>`, to: `<${tel(DIALLED[o.number])}>`,
    uacTag: 'px8812a', uasTag: 'sb4410f', seq: 0,
    extra: [pai, ...(o.callerId === 'withheld' ? ['Privacy: id'] : []), ...history],
  };
  const offer1 = sdp({ user: 'pbx', id: 1001, ip: PBX.ip, port: 20000, pts: [0, 8] });
  const numberCaption = {
    e164: 'The PBX sends the number in E.164 format: + and the country code. Any carrier can route it.',
    national: 'The PBX sends the number as dialled in the USA, with no +1. This carrier must guess the country.',
    local: 'The PBX sends seven digits, as the user dialled them. Without an area code, the number is incomplete.',
  }[o.number];
  const idCaption = {
    shown: forwarded ? `From and P-Asserted-Identity give Carol's number: Alice forwards the call, so Carol is the caller.` : 'From and P-Asserted-Identity give Alice\'s own number, one of the trunk\'s numbers.',
    withheld: `${caller.name} withholds her number: an anonymous From, P-Asserted-Identity, and Privacy: id.`,
    'from-only': `${caller.name} withholds her number, but the PBX only makes From anonymous. It sends no Privacy header.`,
  }[o.callerId];
  let inv1 = invite(leg1, offer1);
  w.msg(PBX, SBC, 'INVITE', o.callerId === 'shown' && !forwarded ? numberCaption : idCaption, inv1,
    { rfc: o.callerId === 'withheld' ? 'rfc3325-9.3-id' : o.number === 'e164' ? 'rfc3966-5.1.4-global' : undefined,
      ...(o.callerId === 'from-only' ? { warn: 'Without Privacy: id, the network treats the identity in P-Asserted-Identity as public.' } : {}) });
  if (o.trunk === 'register') {
    w.msg(SBC, PBX, '407 Proxy Authentication Required', 'The carrier challenges every INVITE on a registered trunk. This stops anyone else from calling on its account.',
      { ...resp(inv1, '407 Proxy Authentication Required', leg1), extra: [`Proxy-Authenticate: Digest realm="${DOMAIN}", nonce="${NONCE}", algorithm=MD5, qop="auth"`] },
      { rfc: 'rfc3261-22.3-challenge-407' });
    w.msg(PBX, SBC, 'ACK', 'The PBX acknowledges the 407 on the same hop.', ackNon2xx(inv1, leg1));
    leg1.uasTag = 'sb4410g';
    inv1 = invite(leg1, offer1, [`Proxy-Authorization: Digest username="${CREDENTIALS.username}", realm="${DOMAIN}", nonce="${NONCE}", uri="${leg1.ruri}", response="{digest}", algorithm=MD5, qop=auth, nc=00000001, cnonce="9b1e77d2"`]);
    w.msg(PBX, SBC, 'INVITE (credentials)', 'The PBX sends the INVITE again, with Proxy-Authorization and the next CSeq.', inv1);
  }
  w.msg(SBC, PBX, '100 Trying', 'The SBC accepts the INVITE and starts its own call to the gateway.', resp(inv1, '100 Trying', leg1));

  // The carrier's side: the SBC is a B2BUA, so this is a new dialog.
  const sent = o.number === 'national' ? MOBILE : DIALLED[o.number];
  const trusted = !forwarded || o.redirect !== 'lost';
  const outNum = trusted ? caller.num : MAIN;
  const leg2: Leg = {
    callId: '7f3e91a2c5@198.51.100.50', uac: SBC, uas: GW, ruri: tel(sent, GW.ip),
    from: anon ? '"Anonymous" <sip:anonymous@anonymous.invalid>' : `"${caller.name}" <${tel(caller.num)}>`, to: `<${tel(sent)}>`,
    uacTag: 'sb93a7c', uasTag: 'gw51d02', seq: 0,
    extra: [`P-Asserted-Identity: <${tel(outNum)}>`, ...(o.callerId === 'withheld' ? ['Privacy: id'] : []), ...history],
  };
  const offer2 = sdp({ user: 'sbc', id: 2001, ip: SBC.ip, port: 30000, pts: [0, 8] });
  const inv2 = invite(leg2, offer2);
  const sbcCaption = o.number === 'national' ? 'The SBC adds +1, because the trunk is in the USA. It relays the media through its own address.'
    : o.number === 'local' ? 'The SBC cannot know which area code the PBX means. It passes the seven digits on.'
    : !trusted ? `Carol's number is not one of the trunk's numbers, and nothing shows a forwarded call. The SBC replaces it with the trunk's main number.`
    : forwarded ? `Carol's number is not one of the trunk's numbers. ${o.redirect === 'diversion' ? 'Diversion' : 'History-Info'} shows that Alice's number forwarded the call, so the SBC accepts it.`
    : 'The SBC checks that the caller\'s number belongs to this trunk. It relays the media through its own address.';
  w.msg(SBC, GW, 'INVITE', sbcCaption, inv2, {
    rfc: o.number === 'local' || !trusted ? undefined : o.redirect === 'diversion' ? 'rfc5806-3-diversion' : o.redirect === 'history-info' ? 'rfc7044-1-history' : undefined,
    ...(!trusted ? { warn: 'The PSTN now gets the company\'s main number, not Carol\'s. Bob cannot tell who is calling.' } : {}),
  });
  w.msg(GW, SBC, '100 Trying', 'The gateway takes the call.', resp(inv2, '100 Trying', leg2));

  /** A failure: a response on each leg, each acknowledged on its own hop. */
  const fail = (status: string, cause: number, gwCaption: string, sbcCaption2: string, rfc?: QuoteId) => {
    const r2 = resp(inv2, status, leg2, { extra: [reason(cause)] });
    w.msg(GW, SBC, status, gwCaption, r2, rfc ? { rfc } : {});
    w.msg(SBC, GW, 'ACK', 'The SBC acknowledges the failure on its hop.', ackNon2xx(inv2, leg2));
    w.msg(SBC, PBX, status, sbcCaption2, resp(inv1, status, leg1, { extra: [reason(cause)] }), { rfc: 'rfc6432-3-reason' });
    w.msg(PBX, SBC, 'ACK', 'The PBX acknowledges it, and shows the user the right message.', ackNon2xx(inv1, leg1));
  };

  if (o.number === 'local') {
    fail('484 Address Incomplete', 28, 'The number has no + and no area code, so the gateway cannot build an ISUP number from it.',
      'The SBC passes the 484 back, with the Reason. The PBX must send the number in a format that the carrier accepts.', 'rfc3398-12.2-484');
    return done(o, w);
  }

  // 24.5: the ISUP side. The called number is national, because +1 is local to the gateway.
  const presentation = o.callerId === 'withheld' ? 'presentation restricted' : 'presentation allowed';
  const iam = [
    'ISUP IAM (Initial Address Message)',
    `  Called party number:    ${nsn(MOBILE)}  (national number)`,
    `  Calling party number:   ${nsn(outNum)}  (national number, ${presentation})`,
    ...(forwarded && trusted ? [`  Original called number: ${nsn(ALICE_DID)}`, '  Redirection information: unconditional, counter 1'] : []),
  ].join('\n');
  const iamCaption = o.callerId === 'withheld' ? 'The gateway starts the PSTN call. Privacy: id becomes "presentation restricted", so the mobile shows no number.'
    : o.callerId === 'from-only' ? 'The gateway starts the PSTN call. With no Privacy header, the number goes out as "presentation allowed".'
    : forwarded && trusted ? 'The gateway starts the PSTN call. Alice\'s number goes in the original called number.'
    : 'The gateway starts the PSTN call. It removes +1, because the country code is local to it.';
  isup('gw', 'pstn', 'ISUP IAM', iamCaption, iam, {
    rfc: o.callerId === 'withheld' ? 'rfc3398-5.7-privacy' : o.callerId === 'from-only' ? 'rfc3325-9.3-id' : 'rfc3398-12.2-national',
    ...(o.callerId === 'from-only' ? { warn: `${caller.name} wanted her number withheld, but the PSTN now treats it as public.` } : {}),
  });

  const rel = (cause: number, caption: string) =>
    isup('pstn', 'gw', `ISUP REL (cause ${cause})`, caption, `ISUP REL (Release)\n  Cause: ${cause} (${Q850[cause]!.toLowerCase()})`, { rfc: 'rfc3398-7.2.4.1-rel' });

  if (o.outcome === 'busy' || o.outcome === 'congestion') {
    const busy = o.outcome === 'busy';
    rel(busy ? 17 : 34, busy ? 'Bob\'s mobile is on another call. The exchange releases the call with cause 17.' : 'The exchange has no free circuit toward the mobile network. It releases the call with cause 34.');
    fail(busy ? '486 Busy Here' : '503 Service Unavailable', busy ? 17 : 34,
      busy ? 'The gateway maps cause 17 to 486, and adds the cause in a Reason header.' : 'The gateway maps cause 34 to 503, and adds the cause in a Reason header.',
      busy ? 'The SBC passes the 486 and its Reason to the PBX.' : 'The SBC passes the 503 on. The PBX can try another trunk for this call.', 'rfc6432-3-reason');
    return done(o, w);
  }

  const notInService = o.outcome === 'unallocated';
  if (notInService && !early) {
    rel(1, 'No phone has this number. The exchange releases the call with cause 1.');
    fail('404 Not Found', 1, 'The gateway maps cause 1 to 404.', 'The SBC passes the 404 to the PBX. The PBX plays its own "number not in service" message.');
    return done(o, w);
  }

  // The exchange accepts the number: ACM, then 180 or 183.
  isup('pstn', 'gw', 'ISUP ACM', notInService ? 'The exchange has an announcement for this number. The ACM says to listen in-band.'
    : early ? 'Bob\'s mobile rings. The ACM says that the exchange plays the ringback tone in-band.' : 'Bob\'s mobile rings. The ACM says "subscriber free", with no in-band tones.',
    ['ISUP ACM (Address Complete Message)', `  Backward call indicators: ${notInService ? 'no indication' : 'subscriber free'}`,
      ...(early ? ['  Optional backward call indicators: in-band information available'] : [])].join('\n'));
  const answer2 = sdp({ user: 'gw', id: 3001, ip: GW.ip, port: 40000, pts: [0] });
  const answer1 = sdp({ user: 'sbc', id: 2002, ip: SBC.ip, port: 30002, pts: [0] });
  if (early) {
    w.msg(GW, SBC, '183 Session Progress', 'The gateway sends 183 with an SDP answer, and connects the in-band audio.', resp(inv2, '183 Session Progress', leg2, { contact: GW.contact, sdp: answer2 }), { rfc: 'rfc3398-7.2.6-183' });
    w.msg(SBC, PBX, '183 Session Progress', 'The SBC passes the 183 on, with its own SDP. The PBX must play the media, not a local tone.', resp(inv1, '183 Session Progress', leg1, { contact: SBC.contact, sdp: answer1 }));
    w.media(GW, PBX, notInService ? 'RTP (announcement)' : 'RTP (ringback tone)', notInService
      ? `${caller.name} hears the exchange's announcement: "The number you have called is not in service."`
      : `${caller.name} hears the ringback tone from the far exchange, through the gateway and the SBC.`, { oneway: true, rfc: 'rfc3398-5.5-early-media' });
  } else {
    w.msg(GW, SBC, '180 Ringing', 'The gateway maps the ACM to 180 Ringing.', resp(inv2, '180 Ringing', leg2, { contact: GW.contact }), { rfc: 'rfc3398-7.2.6-180' });
    w.msg(SBC, PBX, '180 Ringing', `The SBC passes the 180 on. With no SDP, the PBX plays its own ringback tone to ${caller.name}.`, resp(inv1, '180 Ringing', leg1, { contact: SBC.contact }));
  }

  if (notInService) {
    rel(1, 'After the announcement, the exchange releases the call with cause 1.');
    fail('404 Not Found', 1, 'The gateway maps cause 1 to 404, with the cause in a Reason header.', `The SBC passes the 404 on. ${caller.name} has already heard why the call failed.`);
    return done(o, w);
  }
  if (o.outcome === 'no-answer') {
    rel(19, 'Nobody answers the mobile. After a time, the exchange releases the call with cause 19.');
    fail('480 Temporarily Unavailable', 19, 'The gateway maps cause 19 to 480, with the cause in a Reason header.', 'The SBC passes the 480 and its Reason to the PBX.');
    return done(o, w);
  }

  // Answer.
  isup('pstn', 'gw', 'ISUP ANM', 'Bob answers. The ANM starts the charge for the call.', 'ISUP ANM (Answer Message)');
  w.msg(GW, SBC, '200 OK', 'The gateway maps the ANM to 200 OK.', resp(inv2, '200 OK', leg2, { contact: GW.contact, sdp: answer2 }), { rfc: 'rfc3398-7.2.7-anm' });
  w.msg(SBC, PBX, '200 OK', 'The SBC answers the PBX on its own dialog.', resp(inv1, '200 OK', leg1, { contact: SBC.contact, sdp: answer1 }));
  w.msg(PBX, SBC, 'ACK', 'The PBX acknowledges the 200 OK.', ack2xx(inv1, leg1));
  w.msg(SBC, GW, 'ACK', 'The SBC acknowledges the 200 OK on its own dialog.', ack2xx(inv2, leg2));
  w.media(PBX, GW, 'RTP', 'The call audio flows in both directions, through the SBC.');
  rel(16, 'Bob hangs up. The exchange releases the call with cause 16, normal call clearing.');
  const bye2 = byeBack(leg2, [reason(16)]);
  w.msg(GW, SBC, 'BYE', 'The gateway ends the SIP call. The Reason header carries the Q.850 cause.', bye2, { rfc: 'rfc3326-2-reason' });
  w.msg(SBC, GW, '200 OK', 'The SBC confirms the BYE.', ok(bye2));
  const bye1 = byeBack(leg1, [reason(16)]);
  w.msg(SBC, PBX, 'BYE', 'The SBC ends its dialog with the PBX, and copies the Reason.', bye1);
  w.msg(PBX, SBC, '200 OK', 'The PBX confirms. Its call record shows cause 16: Bob hung up.', ok(bye1));
  return done(o, w);
}

function done(o: TrunkOptions, w: FlowWriter): FlowData {
  const off = trunkInactive(o);
  const end = off.outcome ? 'the number is incomplete' : { answer: 'Bob answers', busy: 'Bob is busy', 'no-answer': 'nobody answers', unallocated: 'the number is not in service', congestion: 'no circuit is free' }[o.outcome];
  const reached = !off.outcome;
  return {
    id: `trunk-${trunkKey(o)}`,
    title: `A call to the PSTN on ${o.trunk === 'register' ? 'a registered' : 'an IP-based'} trunk: ${end}`,
    lanes: [PBX, SBC, GW].map(n => ({ id: n.id, label: n.label, kind: n.kind, sub: n.ip }))
      .concat(reached ? [{ id: PSTN.id, label: PSTN.label, kind: PSTN.kind, sub: "Bob's mobile" }] : []),
    steps: w.steps,
    ...(o.trunk === 'register' ? { credentials: CREDENTIALS } : {}),
  };
}
