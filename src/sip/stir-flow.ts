/**
 * STIR/SHAKEN generator (Module 28): a call from the originating carrier,
 * which signs it, through a transit carrier, to the terminating carrier,
 * which fetches the certificate and verifies the PASSporT. Options: who
 * the caller is (attestation A, B, or C), what the transit carrier does to
 * the identity, the signer's clock, and the verifier's policy. The
 * Identity headers are real ES256 PASSporTs from stir-data.ts.
 * Every combination passes lint-flow.ts and lint-diagram.ts.
 */
import type { FlowData } from './flow.ts';
import { FlowWriter, type Msg, type Node } from './sipgen.ts';
import { BOB_TN, CALL_TIME, CALLERS, httpDate, identityHeader, parseIdentity, SKEW, verifyChecks, X5U, type Attest } from './stir.ts';
import { TOKENS } from './stir-data.ts';

export const STIR_CALLERS = { A: 'A: own customer, own number', B: 'B: customer, other number', C: 'C: from a PSTN gateway' } as const;
export const TRANSITS = { keeps: 'Passes it on', strips: 'Removes Identity', rewrites: 'Changes the caller\'s number' } as const;
export const CLOCKS = { ok: 'Correct', slow: 'Signer 5 min slow' } as const;
export const POLICIES = { mark: 'Mark the call', reject: 'Reject failures' } as const;

export interface StirOptions {
  caller: Attest;
  transit: keyof typeof TRANSITS;
  clock: keyof typeof CLOCKS;
  policy: keyof typeof POLICIES;
  /** Not in the builder: the carrier gives A to a number it did not assign (the broken flow of Common mistakes). */
  overAttest?: boolean;
}

export const DEFAULT_STIR: StirOptions = { caller: 'A', transit: 'keeps', clock: 'ok', policy: 'mark' };
export const applyStir = (o: StirOptions, change: Partial<StirOptions>) => ({ options: { ...o, ...change }, notes: [] as string[] });
export const stirInactive = (o: StirOptions): Partial<Record<'policy', string>> =>
  o.transit === 'keeps' && o.clock === 'ok' ? { policy: 'Verification passes, so the policy for failures does not apply.' } : {};
export const stirKey = (o: StirOptions) => [o.caller, o.transit, o.clock, stirInactive(o).policy ? '' : o.policy, o.overAttest ? 'over' : ''].filter(Boolean).join('.');
export function allStirs(): StirOptions[] {
  const out = new Map<string, StirOptions>();
  for (const caller of Object.keys(STIR_CALLERS) as Attest[]) for (const transit of Object.keys(TRANSITS) as StirOptions['transit'][])
    for (const clock of Object.keys(CLOCKS) as StirOptions['clock'][]) for (const policy of Object.keys(POLICIES) as StirOptions['policy'][]) {
      const o = { caller, transit, clock, policy };
      out.set(stirKey(o), o);
    }
  return [...out.values()];
}

export const STIR_QUOTES = [
  'rfc8588-3-levels', 'rfc8588-3-origid', 'rfc8224-6.2-info', 'rfc8226-3-tnauthlist', 'rfc8224-6.2-fresh', 'rfc8224-6.2-invalid',
  'rfc8224-6.2.2-438', 'rfc8224-6.2.2-stale', 'rfc8224-6.2.2-transit', 'rfc8225-5.1.1-iat',
] as const;

const ORIG: Node = { id: 'orig', label: 'Originating carrier', kind: 'proxy', ip: '198.51.100.10', uri: 'sip:sbc.carrier-a.example;lr', br: 'or' };
const TRANSIT: Node = { id: 'transit', label: 'Transit carrier', kind: 'proxy', ip: '192.0.2.200', uri: 'sip:ibcf.transit.example;lr', br: 'tr' };
const TERM: Node = { id: 'term', label: 'Terminating carrier', kind: 'proxy', ip: '203.0.113.10', uri: 'sip:sbc.carrier-b.example;lr', br: 'te' };
const CR = { id: 'cr', label: 'Certificate repository', kind: 'server' as const, ip: '198.51.100.90' };
const BOB: Node = { id: 'bob', label: 'Bob', kind: 'ua', ip: '203.0.113.20', contact: 'sip:+12285550222@203.0.113.20:5060', tag: '314159', br: 'b0' };
const CALLER_NODES: Record<Attest, Node> = {
  A: { id: 'caller', label: 'Alice', kind: 'ua', ip: '192.0.2.10', contact: 'sip:+14045550101@192.0.2.10:5060', br: '74b' },
  B: { id: 'caller', label: 'PBX', kind: 'b2bua', ip: '192.0.2.20', contact: 'sip:pbx@192.0.2.20:5060', br: 'px' },
  C: { id: 'caller', label: 'Carrier gateway', kind: 'server', ip: '198.51.100.80', contact: 'sip:gw@198.51.100.80:5060', br: 'gw' },
};

export function buildStir(o: StirOptions): FlowData {
  const w = new FlowWriter();
  w.recordRoute = true;
  const C = CALLER_NODES[o.caller];
  const tn = CALLERS[o.caller].tn;
  const attest = o.overAttest ? 'A' : o.caller;
  const slow = o.clock === 'slow';
  const signedAt = CALL_TIME - (slow ? SKEW : 0);
  const token = TOKENS[o.overAttest ? 'B.asA' : `${o.caller}.${slow ? 'skew' : 'ok'}`]!;
  const identity = identityHeader(token, X5U);
  const host = 'carrier-a.example';

  const inv: Msg = {
    line: `INVITE sip:+${BOB_TN}@${host};user=phone SIP/2.0`, via: [w.via(C)], maxForwards: 70,
    from: `<sip:+${tn}@${host};user=phone>;tag=c4ll3r`, to: `<sip:+${BOB_TN}@${host};user=phone>`, callId: 'stir-61d0a7c2@' + C.ip, cseq: '1 INVITE', contact: C.contact,
    extra: o.caller === 'C' ? [`P-Asserted-Identity: <tel:+${tn}>`] : [],
  };
  w.msg(C, ORIG, 'INVITE', o.caller === 'A' ? 'Alice, a customer of carrier A, calls Bob. The carrier authenticated her, and assigned her the number.'
    : o.caller === 'B' ? 'A company PBX on a SIP trunk calls Bob, from a toll-free number that another carrier assigned.'
    : 'A call from London arrives at carrier A\'s PSTN gateway. Only the ISUP calling number says who calls.', inv);
  w.msg(ORIG, C, '100 Trying', 'Carrier A takes the call.', w.response({ from: C, to: ORIG, msg: inv }, '100 Trying', {}));

  const fwd = w.forward(inv, ORIG, { initial: true, retarget: `sip:+${BOB_TN}@biloxi.example;user=phone` });
  const signed: Msg = { ...fwd, extra: [`P-Asserted-Identity: <tel:+${tn}>`, `Date: ${httpDate(signedAt)}`, identity] };
  w.msg(ORIG, TRANSIT, 'INVITE', o.overAttest
    ? 'The signing service gives A to the PBX\'s number anyway. The carrier did not assign that number, and cannot know it is genuine.'
    : `The signing service adds Date and an Identity header: a PASSporT with attest ${attest}. ${CALLERS[o.caller].why}`,
    signed, { rfc: slow ? 'rfc8225-5.1.1-iat' : 'rfc8588-3-levels', status: { orig: `Signed ${attest}` },
      ...(o.overAttest ? { warn: 'Full attestation for a number nobody checked: any spoofed number now looks verified.' } : slow ? { warn: 'The signer\'s clock is 5 minutes slow, so iat and Date are 5 minutes old already.' } : {}) });

  // The transit carrier.
  const t = w.forward(signed, TRANSIT, { initial: true });
  const atTerm: Msg = o.transit === 'strips' ? { ...t, extra: t.extra!.filter(h => !h.startsWith('Identity')) }
    : o.transit === 'rewrites' ? { ...t, from: t.from.replace(`+${tn}`, '+12285550100'), extra: t.extra!.map(h => h.replace(`+${tn}`, '+12285550100')) }
    : t;
  w.msg(TRANSIT, TERM, 'INVITE', o.transit === 'keeps' ? 'The transit carrier passes the call on, with the Identity header unchanged.'
    : o.transit === 'strips' ? 'An SBC in the transit network removes the headers it does not know, Identity among them.'
    : 'The transit carrier replaces the caller\'s number with its own trunk number, +1 228 555 0100. The PASSporT still says the old one.', atTerm,
    o.transit === 'keeps' ? {} : { warn: o.transit === 'strips' ? 'The signature is gone. The terminating carrier cannot verify anything.' : 'The number in the request no longer matches orig in the signed PASSporT.', rfc: 'rfc8224-6.2.2-transit' });

  // The verification service.
  const parsed = o.transit === 'strips' ? undefined : parseIdentity(identity);
  const result = verifyChecks({ parsed, signatureValid: true, now: CALL_TIME + 1, from: o.transit === 'rewrites' ? '+12285550100' : `+${tn}`, to: `+${BOB_TN}`, certTrusted: true });
  if (parsed) {
    w.steps.push({ from: 'term', to: 'cr', proto: 'net', label: 'HTTPS GET certificate', rfc: 'rfc8224-6.2-info',
      caption: 'The verification service fetches the certificate named in info and x5u. It keeps it in a cache for later calls.',
      detail: `GET ${X5U} HTTP/1.1\nHost: cr.carrier-a.example` });
    w.steps.push({ from: 'cr', to: 'term', proto: 'net', label: '200 OK (certificate)', rfc: 'rfc8226-3-tnauthlist',
      caption: 'The certificate names carrier A in its TN Authorization List, and chains to an STI-CA that the STI-PA approved.',
      detail: 'HTTP/1.1 200 OK\nContent-Type: application/pem-certificate-chain\n\nSubject: CN=SHAKEN 1234 (carrier A)\nIssuer: an STI-CA approved by the STI-PA\nTNAuthList: SPC 1234\nPublic key: EC P-256 (the key that signed the PASSporT)' });
  }
  const failed = result.verstat === 'TN-Validation-Failed';
  const missing = result.verstat === 'No-TN-Validation';
  const stale = !!parsed && !result.checks.find(c => c.what === 'Freshness')!.ok;
  const verdict = missing ? 'No Identity header: the verifier has nothing to check.'
    : stale ? `The PASSporT is ${CALL_TIME + 1 - (CALL_TIME - SKEW)} s old, and the limit is 60 s.`
    : failed ? 'The caller\'s number does not match orig in the PASSporT.'
    : 'Signature, certificate, time, and both numbers check out.';

  if (o.policy === 'reject' && !stirInactive(o).policy && (failed || missing)) {
    const status = missing ? '428 Use Identity Header' : stale ? '403 Stale Date' : '438 Invalid Identity Header';
    const r = w.response({ from: TRANSIT, to: TERM, msg: atTerm }, status, { tag: 'te0f41' });
    w.msg(TERM, TRANSIT, status, `${verdict} This carrier rejects such calls.`, r,
      { rfc: missing ? undefined : stale ? 'rfc8224-6.2.2-stale' : 'rfc8224-6.2.2-438', status: { term: 'Rejected' } });
    w.msg(TRANSIT, TERM, 'ACK', 'The transit carrier acknowledges.', w.ackNon2xx({ from: TRANSIT, to: TERM, msg: atTerm }, 'te0f41'));
    const r2 = { ...r, via: r.via.slice(1) };
    w.msg(TRANSIT, ORIG, status, 'The transit carrier passes the failure back.', r2);
    w.msg(ORIG, TRANSIT, 'ACK', 'Carrier A acknowledges.', w.ackNon2xx({ from: ORIG, to: TRANSIT, msg: signed }, 'te0f41'));
    w.msg(ORIG, C, status, 'The caller\'s call fails, though the caller did nothing wrong.', { ...r2, via: r2.via.slice(1) },
      { warn: stale ? 'One slow clock at the signer makes every call from carrier A fail.' : undefined });
    w.msg(C, ORIG, 'ACK', 'The caller acknowledges.', w.ackNon2xx({ from: C, to: ORIG, msg: inv }, 'te0f41'));
    return done(o, w, !!parsed);
  }

  const toBob = w.forward(atTerm, TERM, { initial: true, retarget: BOB.contact });
  const bobMsg: Msg = {
    ...toBob, from: `${toBob.from.replace('user=phone>', `user=phone;verstat=${result.verstat}>`)}`,
    extra: toBob.extra!.filter(h => !h.startsWith('Identity') && !h.startsWith('Date')).map(h => (h.startsWith('P-Asserted-Identity') ? h.replace('>', `;verstat=${result.verstat}>`) : h)),
  };
  w.msg(TERM, BOB, 'INVITE', `${verdict} The verifier tells Bob's phone: verstat=${result.verstat}.`, bobMsg,
    { rfc: stale ? 'rfc8224-6.2-fresh' : failed ? 'rfc8224-6.2-invalid' : undefined, status: { term: missing ? 'No check' : failed ? 'Failed' : 'Passed' } });
  const r180 = w.response({ from: TERM, to: BOB, msg: bobMsg }, '180 Ringing', { tag: BOB.tag, contact: BOB.contact, recordRoute: bobMsg.recordRoute });
  const bobScreen = missing ? 'No mark' : failed ? 'Spam risk' : attest === 'A' ? 'Verified ✓' : 'No mark';
  const screen = missing ? 'the number, with no mark' : failed ? 'the number, marked as spam risk' : attest === 'A' ? 'the number, with a verified mark' : 'the number, with no mark: the carrier vouched for the call, not the number';
  w.msg(BOB, TERM, '180 Ringing', `Bob's phone rings. It shows ${screen}.`, r180,
    { status: { bob: bobScreen }, ...(o.overAttest ? { warn: 'Bob sees a verified mark on a call that nobody verified.' } : {}) });
  let r = r180;
  for (const [from, to, caption] of [[TERM, TRANSIT, 'The 180 goes back the way the INVITE came.'], [TRANSIT, ORIG, 'Through the transit carrier.'], [ORIG, C, 'The caller hears ringing.']] as const) {
    r = { ...r, via: r.via.slice(1) };
    w.msg(from, to, '180 Ringing', caption, r);
  }
  return done(o, w, !!parsed);
}

function done(o: StirOptions, w: FlowWriter, fetched: boolean): FlowData {
  const C = CALLER_NODES[o.caller];
  return {
    id: `stir-${stirKey(o)}`,
    title: `STIR/SHAKEN: attest ${o.overAttest ? 'A (wrongly)' : o.caller}, ${o.transit === 'keeps' ? 'identity kept' : o.transit === 'strips' ? 'Identity removed in transit' : 'number changed in transit'}${o.clock === 'slow' ? ', slow signer clock' : ''}`,
    lanes: [C, ORIG, TRANSIT, TERM, ...(fetched ? [CR] : []), BOB].map(n => ({ id: n.id, label: n.label, kind: n.kind, sub: n.ip })),
    steps: w.steps,
  };
}
