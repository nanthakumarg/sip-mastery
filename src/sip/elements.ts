/**
 * Proxy vs B2BUA (Module 25.1): the same call, Alice to Bob, through a
 * record-routing stateful proxy and through a B2BUA that relays the media.
 * Both flows pass lint-flow.ts. `PAIRS` names, for each message, the step
 * that reaches the element and the step that leaves it, so a diagram can
 * compare the two sides.
 */
import type { FlowData } from './flow.ts';
import { ALICE, BOB, CALL_ID, FlowWriter, sdp, withTag, type Msg, type Node } from './sipgen.ts';

const PROXY: Node = { id: 'mid', label: 'Proxy', kind: 'proxy', ip: '198.51.100.10', uri: 'sip:198.51.100.10;lr', br: 'pr' };
const B2BUA: Node = { id: 'mid', label: 'B2BUA', kind: 'b2bua', ip: '198.51.100.10', contact: 'sip:b2bua@198.51.100.10:5060', br: 'bb' };

const ALICE_AOR = 'sip:alice@atlanta.example', BOB_AOR = 'sip:bob@biloxi.example';
const FROM = `Alice <${ALICE_AOR}>;tag=${ALICE.tag}`, TO = `Bob <${BOB_AOR}>`;
const ALICE_SDP = sdp({ user: 'alice', id: 2890844526, ip: ALICE.ip, port: 49170, pts: [0, 8] });
const BOB_SDP = sdp({ user: 'bob', id: 2890844527, ip: BOB.ip, port: 3456, pts: [0] });

export type PairKey = 'invite' | '180' | '200' | 'ack' | 'bye' | '200-bye';
export const PAIR_LABELS: Record<PairKey, string> = {
  invite: 'INVITE', 180: '180 Ringing', 200: '200 OK', ack: 'ACK', bye: 'BYE', '200-bye': '200 OK (BYE)',
};
/** Step indexes (0-based): the message as it reaches the element, and as it leaves. */
export const PAIRS: Record<PairKey, [number, number]> = {
  invite: [0, 2], 180: [3, 4], 200: [5, 6], ack: [7, 8], bye: [9, 10], '200-bye': [11, 12],
};

/** What each element did to each message, and why. */
export const WHY: Record<PairKey, { proxy: string; b2bua: string }> = {
  invite: {
    proxy: 'The proxy changes only what routing needs: the Request-URI (from the location service), a new Via on top, Max-Forwards minus one, and its Record-Route. Call-ID, tags, CSeq, Contact, and the SDP pass unchanged.',
    b2bua: 'The B2BUA answers Alice\'s INVITE as a UAS and sends a new one as a UAC. Call-ID, From tag, CSeq, Via, Contact, and the SDP are all its own; only the names in From and To survive.',
  },
  180: {
    proxy: 'The proxy removes its own Via and forwards the rest. Bob\'s To tag and Contact reach Alice unchanged.',
    b2bua: 'The B2BUA sends its own 180 on Alice\'s side: its own To tag and Contact, Alice\'s Call-ID and Via.',
  },
  200: {
    proxy: 'Again only the top Via goes. Alice now holds Bob\'s tag, Bob\'s Contact, the Record-Route, and Bob\'s SDP: one dialog, end to end.',
    b2bua: 'The 200 OK on Alice\'s side carries the B2BUA\'s SDP, so the media flows through the B2BUA. Alice never sees Bob\'s address.',
  },
  ack: {
    proxy: 'Alice sends the ACK to Bob\'s Contact, with a Route for the proxy. The proxy removes that Route and adds a Via.',
    b2bua: 'The ACK on Bob\'s side is a separate request in a separate dialog. Many B2BUAs send it as soon as Bob\'s 200 OK arrives.',
  },
  bye: {
    proxy: 'Bob\'s BYE follows the route set back. Bob is the caller now, but the tags keep their places: From has Bob\'s tag.',
    b2bua: 'The B2BUA ends Alice\'s dialog with its own BYE: Alice\'s Call-ID and tags, the B2BUA\'s next CSeq.',
  },
  '200-bye': {
    proxy: 'The proxy removes its Via. The response ends the same transaction on both sides.',
    b2bua: 'Two separate transactions end. A B2BUA must keep both dialogs in step: a missed BYE on one side leaves a hung call.',
  },
};

export function proxyCall(): FlowData {
  const w = new FlowWriter();
  w.recordRoute = true;
  const P = PROXY;
  const inv: Msg = { line: `INVITE ${BOB_AOR} SIP/2.0`, via: [w.via(ALICE)], maxForwards: 70, from: FROM, to: TO, cseq: '314159 INVITE', contact: ALICE.contact, sdp: ALICE_SDP };
  w.msg(ALICE, P, 'INVITE', 'Alice calls Bob\'s AOR through the proxy.', inv);
  w.msg(P, ALICE, '100 Trying', 'The proxy stops Alice\'s retransmissions.', w.response({ from: ALICE, to: P, msg: inv }, '100 Trying', {}));
  const inv2 = w.forward(inv, P, { initial: true, retarget: BOB.contact });
  w.msg(P, BOB, 'INVITE', 'The proxy finds Bob\'s Contact, adds its Via and Record-Route, and forwards the INVITE.', inv2, { rfc: 'rfc3261-16.6-copy' });
  const resp = (status: string, more: Partial<Msg>) => {
    const r = w.response({ from: P, to: BOB, msg: inv2 }, status, { tag: BOB.tag, contact: BOB.contact, recordRoute: inv2.recordRoute, ...more });
    return [r, { ...r, via: r.via.slice(1) }] as const;
  };
  const [r180, f180] = resp('180 Ringing', {});
  w.msg(BOB, P, '180 Ringing', 'Bob\'s phone rings.', r180);
  w.msg(P, ALICE, '180 Ringing', 'The proxy removes its Via and forwards the 180.', f180, { rfc: 'rfc3261-16.7-via-remove' });
  const [r200, f200] = resp('200 OK', { sdp: BOB_SDP });
  w.msg(BOB, P, '200 OK', 'Bob answers.', r200);
  w.msg(P, ALICE, '200 OK', 'The proxy forwards the 200 OK.', f200);
  const ack: Msg = { line: `ACK ${BOB.contact} SIP/2.0`, via: [w.via(ALICE)], maxForwards: 70, route: [P.uri!], from: FROM, to: withTag(TO, BOB.tag!), cseq: '314159 ACK' };
  w.msg(ALICE, P, 'ACK', 'Alice sends the ACK along the route set.', ack);
  w.msg(P, BOB, 'ACK', 'The proxy removes its Route entry and forwards the ACK.', w.forward(ack, P, { initial: false }));
  w.media(ALICE, BOB, 'RTP', 'The media flows directly between Alice and Bob.');
  const bye: Msg = { line: `BYE ${ALICE.contact} SIP/2.0`, via: [w.via(BOB)], maxForwards: 70, route: [P.uri!], from: withTag(TO, BOB.tag!), to: FROM, cseq: '231 BYE' };
  w.msg(BOB, P, 'BYE', 'Bob hangs up.', bye);
  const bye2 = w.forward(bye, P, { initial: false });
  w.msg(P, ALICE, 'BYE', 'The proxy forwards the BYE to Alice.', bye2);
  const ok = w.response({ from: P, to: ALICE, msg: bye2 }, '200 OK', {});
  w.msg(ALICE, P, '200 OK', 'Alice confirms.', ok);
  w.msg(P, BOB, '200 OK', 'The proxy forwards the 200 OK to Bob.', { ...ok, via: ok.via.slice(1) });
  // The RTP step sits between the pairs; move it after the last pair so PAIRS stay simple.
  const [rtp] = w.steps.splice(9, 1);
  w.steps.push(rtp!);
  return { id: 'element-proxy', title: 'A call through a proxy', lanes: lanes(PROXY), steps: w.steps };
}

export function b2buaCall(): FlowData {
  const w = new FlowWriter();
  const B = B2BUA;
  const CID2 = '7c4d2e91f0@198.51.100.10', TAG2 = 'bb51a0', TAG1 = 'bb77c2';
  const inv: Msg = { line: `INVITE ${BOB_AOR} SIP/2.0`, via: [w.via(ALICE)], maxForwards: 70, from: FROM, to: TO, cseq: '314159 INVITE', contact: ALICE.contact, sdp: ALICE_SDP };
  w.msg(ALICE, B, 'INVITE', 'Alice calls Bob\'s AOR through the B2BUA.', inv);
  w.msg(B, ALICE, '100 Trying', 'The B2BUA, as a UAS, stops Alice\'s retransmissions.', w.response({ from: ALICE, to: B, msg: inv }, '100 Trying', {}));
  const inv2: Msg = {
    line: `INVITE ${BOB.contact} SIP/2.0`, via: [w.via(B)], maxForwards: 70, from: `Alice <${ALICE_AOR}>;tag=${TAG2}`, to: TO, callId: CID2, cseq: '1 INVITE', contact: B.contact,
    sdp: sdp({ user: 'b2bua', id: 4001, ip: B.ip, port: 30000, pts: [0, 8] }),
  };
  w.msg(B, BOB, 'INVITE', 'The B2BUA, as a UAC, starts a new call to Bob, with its own SDP.', inv2, { rfc: 'rfc7092-3.1.2-signaling-only' });
  const leg2 = (status: string, more: Partial<Msg>) => w.response({ from: B, to: BOB, msg: inv2 }, status, { tag: BOB.tag, contact: BOB.contact, ...more });
  const leg1 = (status: string, more: Partial<Msg>) => w.response({ from: ALICE, to: B, msg: inv }, status, { tag: TAG1, contact: B.contact, ...more });
  w.msg(BOB, B, '180 Ringing', 'Bob\'s phone rings.', leg2('180 Ringing', {}));
  w.msg(B, ALICE, '180 Ringing', 'The B2BUA sends its own 180 to Alice.', leg1('180 Ringing', {}));
  w.msg(BOB, B, '200 OK', 'Bob answers.', leg2('200 OK', { sdp: BOB_SDP }));
  w.msg(B, ALICE, '200 OK', 'The B2BUA answers Alice, with its own SDP.', leg1('200 OK', { sdp: sdp({ user: 'b2bua', id: 4002, ip: B.ip, port: 30002, pts: [0] }) }));
  w.msg(ALICE, B, 'ACK', 'Alice acknowledges the B2BUA\'s 200 OK.', { line: `ACK ${B.contact} SIP/2.0`, via: [w.via(ALICE)], maxForwards: 70, from: FROM, to: withTag(TO, TAG1), cseq: '314159 ACK' });
  w.msg(B, BOB, 'ACK', 'The B2BUA acknowledges Bob\'s 200 OK, in the other dialog.', { line: `ACK ${BOB.contact} SIP/2.0`, via: [w.via(B)], maxForwards: 70, from: inv2.from, to: withTag(TO, BOB.tag!), callId: CID2, cseq: '1 ACK' });
  const bye: Msg = { line: `BYE ${B.contact} SIP/2.0`, via: [w.via(BOB)], maxForwards: 70, from: withTag(TO, BOB.tag!), to: inv2.from, callId: CID2, cseq: '231 BYE' };
  w.msg(BOB, B, 'BYE', 'Bob hangs up.', bye);
  const bye2: Msg = { line: `BYE ${ALICE.contact} SIP/2.0`, via: [w.via(B)], maxForwards: 70, from: withTag(TO, TAG1), to: FROM, callId: CALL_ID, cseq: '1 BYE' };
  w.msg(B, ALICE, 'BYE', 'The B2BUA ends its dialog with Alice.', bye2);
  w.msg(ALICE, B, '200 OK', 'Alice confirms.', w.response({ from: B, to: ALICE, msg: bye2 }, '200 OK', {}));
  w.msg(B, BOB, '200 OK', 'The B2BUA confirms Bob\'s BYE.', w.response({ from: BOB, to: B, msg: bye }, '200 OK', {}));
  w.media(ALICE, B, 'RTP', 'Alice\'s media goes to the B2BUA, which relays it to Bob.');
  return { id: 'element-b2bua', title: 'A call through a B2BUA', lanes: lanes(B2BUA), steps: w.steps };
}

const lanes = (mid: Node) => [ALICE, mid, BOB].map(n => ({ id: n.id, label: n.label, kind: n.kind, sub: n.ip }));
