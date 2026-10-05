/**
 * The NAT simulator of Module 20: Bob registers and Alice calls him, each
 * behind a NAT router of a chosen type, with rport, Contact rewriting, and
 * a media fix turned on or off. Every packet is traced through the NAT
 * routers of src/net/nat.ts. The diagram is src/diagrams/NatSimulator.tsx.
 */
import { mediaArrived, runIce, sendMedia, type IceAgent, type IceResult } from './ice.ts';
import { NAT_KINDS, Nat, World, fmt, reached, type Addr, type NatKind, type Trace } from './nat.ts';

export type MediaFix = 'none' | 'stun' | 'relay' | 'ice';

export const MEDIA_FIXES: Record<MediaFix, string> = {
  none: 'None',
  stun: 'STUN only',
  relay: 'Media relay (SBC)',
  ice: 'ICE (STUN + TURN)',
};

export interface CallInput {
  alice: NatKind;
  bob: NatKind;
  rport: boolean;
  contactRewrite: boolean;
  media: MediaFix;
}

export interface SimPacket {
  label: string;
  proto: 'sip' | 'rtp' | 'stun';
  from: string;
  to: string;
  trace: Trace;
  ok: boolean;
  note: string;
}

export interface CallResult {
  packets: SimPacket[];
  registered: boolean;
  invited: boolean;
  answered: boolean;
  aToB: boolean;
  bToA: boolean;
  ice?: IceResult;
  verdict: string;
}

/** The cast: Alice and Bob each with a private address and a NAT router; the SBC; a STUN and TURN server. */
export const SITES = {
  alice: { private: '192.168.1.20', public: '198.51.100.7', natPort: 40112, sip: 5060, rtp: 49170 },
  bob: { private: '10.0.0.30', public: '198.51.100.200', natPort: 52010, sip: 5060, rtp: 3456 },
  sbc: { ip: '203.0.113.5', sip: 5060, toAlice: 30000, toBob: 30002 },
  turn: { ip: '203.0.113.50', port: 3478 },
};

export function buildWorld(alice: NatKind, bob: NatKind): World {
  const w = new World();
  for (const [id, label, kind] of [['alice', 'Alice', alice], ['bob', 'Bob', bob]] as const) {
    const s = SITES[id];
    const b = NAT_KINDS[kind].behaviour;
    w.add(b ? { id, label, ip: s.private, nat: new Nat(b, s.public, s.natPort) } : { id, label, ip: s.public });
  }
  w.add({ id: 'sbc', label: 'SBC', ip: SITES.sbc.ip });
  w.add({ id: 'turn', label: 'STUN/TURN server', ip: SITES.turn.ip });
  return w;
}

export function simulateCall(i: CallInput): CallResult {
  const w = buildWorld(i.alice, i.bob);
  const packets: SimPacket[] = [];
  const sbc = { ip: SITES.sbc.ip, port: SITES.sbc.sip };
  const ip = (id: 'alice' | 'bob') => w.host(id).ip;
  const push = (p: Omit<SimPacket, 'ok'>, ok: boolean) => { packets.push({ ...p, ok }); return ok; };
  const reason = (t: Trace) => t.lost ?? 'It arrived on the wrong port';

  // 1. Bob registers. The SBC sees the source address after Bob's NAT router.
  const reg = w.send('bob', SITES.bob.sip, sbc);
  const bobSeen = reg.peer!;
  push({ label: 'REGISTER', proto: 'sip', from: 'Bob', to: 'SBC', trace: reg,
    note: `Via and Contact say ${ip('bob')}:5060${i.rport ? ';rport' : ''}. The SBC sees ${fmt(bobSeen)}.` }, true);

  // 2. The 200 OK follows the Via: received and rport (RFC 3581), or the port in sent-by.
  const regDst = i.rport ? bobSeen : { ip: bobSeen.ip, port: SITES.bob.sip };
  const regOk = w.send('sbc', sbc.port, regDst);
  const registered = push({ label: '200 OK (REGISTER)', proto: 'sip', from: 'SBC', to: 'Bob', trace: regOk,
    note: reached(regOk, 'bob', SITES.bob.sip)
      ? (i.rport ? 'rport: the response goes to the source port, through the open mapping.' : 'Bob has no NAT, so the Via port is right.')
      : `Without rport, the response goes to port 5060 of ${regDst.ip}. ${reason(regOk)}.` },
  reached(regOk, 'bob', SITES.bob.sip));

  // 3. Alice calls. Her INVITE reaches the SBC (a public address).
  const inv = w.send('alice', SITES.alice.sip, sbc);
  const aliceSeen = inv.peer!;
  push({ label: 'INVITE', proto: 'sip', from: 'Alice', to: 'SBC', trace: inv,
    note: `Alice's SDP offers ${i.media === 'relay' ? 'her private address; the SBC will replace it' : 'her media address'}. The SBC sees ${fmt(aliceSeen)}.` }, true);

  // 4. The SBC forwards the INVITE to Bob's Contact, or to the address his REGISTER came from.
  const target: Addr = i.contactRewrite ? bobSeen : { ip: ip('bob'), port: SITES.bob.sip };
  const fwd = w.send('sbc', sbc.port, target);
  const invited = push({ label: 'INVITE', proto: 'sip', from: 'SBC', to: 'Bob', trace: fwd,
    note: reached(fwd, 'bob', SITES.bob.sip)
      ? (i.contactRewrite ? `Contact rewriting: the SBC sends to ${fmt(bobSeen)}, where the REGISTER came from.` : 'Bob is on a public address: his Contact works.')
      : `The SBC sends to the Contact, ${fmt(target)}. ${reason(fwd)}.` },
  reached(fwd, 'bob', SITES.bob.sip));

  // 5. Bob answers; the 200 OK goes to the SBC, then to Alice like any response.
  let answered = false;
  if (invited) {
    const ok1 = w.send('bob', SITES.bob.sip, sbc);
    push({ label: '200 OK', proto: 'sip', from: 'Bob', to: 'SBC', trace: ok1, note: 'Bob answers, with his SDP.' }, true);
    const okDst = i.rport ? aliceSeen : { ip: aliceSeen.ip, port: SITES.alice.sip };
    const ok2 = w.send('sbc', sbc.port, okDst);
    answered = push({ label: '200 OK', proto: 'sip', from: 'SBC', to: 'Alice', trace: ok2,
      note: reached(ok2, 'alice', SITES.alice.sip) ? 'Alice gets the answer. The call is up.' : `Without rport, the 200 OK goes to port 5060 of ${okDst.ip}. ${reason(ok2)}.` },
    reached(ok2, 'alice', SITES.alice.sip));
  }

  let aToB = false, bToA = false, ice: IceResult | undefined;
  if (answered) {
    ({ aToB, bToA, ice } = media(w, i.media, push));
  }
  const registeredNote = registered ? '' : ' Bob\'s phone shows "Registration failed", though the SBC stored a binding.';
  const verdict = !invited ? `The INVITE never reaches Bob: no call.${registeredNote}`
    : !answered ? 'Bob\'s phone rings, but Alice never gets the 200 OK. The call fails.'
    : aToB && bToA ? 'The call works: audio in both directions.'
    : aToB || bToA ? `One-way audio: only ${aToB ? 'Alice → Bob' : 'Bob → Alice'} arrives.`
    : 'The call connects, but there is no audio in either direction.';
  return { packets, registered, invited, answered, aToB, bToA, ice, verdict };
}

type Push = (p: Omit<SimPacket, 'ok'>, ok: boolean) => boolean;

/** Two rounds of RTP in each direction: the first packets may open a mapping or a latch for the second. */
function media(w: World, fix: MediaFix, push: Push): { aToB: boolean; bToA: boolean; ice?: IceResult } {
  const A = SITES.alice.rtp, B = SITES.bob.rtp;
  const rtp = (round: number) => `RTP ${round === 0 ? 'first packet' : 'later packets'}`;
  const note = (t: Trace, ok: boolean, good: string) => (ok ? good : t.lost ?? 'It arrives on a port where the phone does not listen.');

  if (fix === 'relay') {
    // The SBC rewrites both SDPs to its own ports and latches to the source of the first packet (RFC 7362 §4).
    const relayA = { ip: SITES.sbc.ip, port: SITES.sbc.toAlice }, relayB = { ip: SITES.sbc.ip, port: SITES.sbc.toBob };
    let latchA: Addr | undefined, latchB: Addr | undefined;
    let aToB = false, bToA = false;
    for (let round = 0; round < 2; round++) {
      const a = w.send('alice', A, relayA);
      latchA ??= a.peer;
      const fa = latchB ? w.send('sbc', relayB.port, latchB) : undefined;
      aToB = !!fa && reached(fa, 'bob', B);
      push({ label: rtp(round), proto: 'rtp', from: 'Alice', to: 'Bob', trace: fa ?? a,
        note: fa ? note(fa, aToB, `The SBC relays it from ${fmt(relayB)} to Bob's latched address, ${fmt(latchB!)}.`) : 'The SBC has not latched to Bob yet: it waits for his first packet, and drops this one.' }, aToB);
      const b = w.send('bob', B, relayB);
      latchB ??= b.peer;
      const fb = w.send('sbc', relayA.port, latchA!);
      bToA = reached(fb, 'alice', A);
      push({ label: rtp(round), proto: 'rtp', from: 'Bob', to: 'Alice', trace: fb,
        note: note(fb, bToA, `The SBC latched to ${fmt(latchA!)}, where Alice's media comes from, and relays it there.`) }, bToA);
    }
    return { aToB, bToA };
  }

  if (fix === 'ice') {
    const server = { ip: SITES.turn.ip, port: SITES.turn.port };
    const L: IceAgent = { id: 'alice', label: 'Alice', port: A, stun: server, turn: server };
    const R: IceAgent = { id: 'bob', label: 'Bob', port: B, stun: server, turn: server };
    const res = runIce(w, L, R);
    const s = res.selected;
    if (!s) {
      push({ label: 'ICE checks', proto: 'stun', from: 'Alice', to: 'Bob', trace: { legs: [] }, note: 'No candidate pair works.' }, false);
      return { aToB: false, bToA: false, ice: res };
    }
    push({ label: 'ICE checks', proto: 'stun', from: 'Alice', to: 'Bob', trace: { legs: [] },
      note: `${res.events.length} checks. Selected: ${s.pair.local.type} → ${s.pair.remote.type} ${fmt(s.pair.remote.addr)}.` }, true);
    let aToB = false, bToA = false;
    for (let round = 0; round < 2; round++) {
      const a = sendMedia(w, s, L, R, true);
      aToB = mediaArrived(a, s, L, R, true);
      push({ label: rtp(round), proto: 'rtp', from: 'Alice', to: 'Bob', trace: a, note: note(a, aToB, 'On the pair that ICE checked: the path is already open.') }, aToB);
      const b = sendMedia(w, s, L, R, false);
      bToA = mediaArrived(b, s, L, R, false);
      push({ label: rtp(round), proto: 'rtp', from: 'Bob', to: 'Alice', trace: b, note: note(b, bToA, 'The same pair, in the other direction.') }, bToA);
    }
    return { aToB, bToA, ice: res };
  }

  // No fix: each phone writes its own address in c=. STUN only: each writes its server-reflexive address.
  let sdpA: Addr = { ip: w.host('alice').ip, port: A }, sdpB: Addr = { ip: w.host('bob').ip, port: B };
  if (fix === 'stun') {
    const server = { ip: SITES.turn.ip, port: SITES.turn.port };
    for (const [id, port] of [['alice', A], ['bob', B]] as const) {
      const t = w.send(id, port, server);
      const label = id === 'alice' ? 'Alice' : 'Bob';
      push({ label: 'STUN Binding', proto: 'stun', from: label, to: 'STUN server', trace: t,
        note: `The STUN server answers with XOR-MAPPED-ADDRESS ${fmt(t.peer!)}. ${label} puts it in c= and m=.` }, true);
      if (id === 'alice') sdpA = t.peer!; else sdpB = t.peer!;
    }
  }
  let aToB = false, bToA = false;
  for (let round = 0; round < 2; round++) {
    const a = w.send('alice', A, sdpB);
    aToB = reached(a, 'bob', B);
    push({ label: rtp(round), proto: 'rtp', from: 'Alice', to: 'Bob', trace: a, note: note(a, aToB, `To Bob's SDP address, ${fmt(sdpB)}.`) }, aToB);
    const b = w.send('bob', B, sdpA);
    bToA = reached(b, 'alice', A);
    push({ label: rtp(round), proto: 'rtp', from: 'Bob', to: 'Alice', trace: b, note: note(b, bToA, `To Alice's SDP address, ${fmt(sdpA)}.`) }, bToA);
  }
  return { aToB, bToA };
}
