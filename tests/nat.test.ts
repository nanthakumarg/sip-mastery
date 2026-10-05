import { describe, expect, it } from 'vitest';
import { Nat, NAT_KINDS, World, type NatKind } from '../src/net/nat.ts';
import { simulateCall, buildWorld, SITES, type MediaFix } from '../src/net/nat-call.ts';
import { candidateLine, candidatePriority, checklist, pairPriority, runIce, type Candidate } from '../src/net/ice.ts';
import { ATTR, BINDING, decodeStun, encodeStun, messageType, readXorAddress, textAttr, u32Attr, xorAddress } from '../src/net/stun.ts';
import { hex } from '../src/net/srtp.ts';

const bytes = (s: string) => new Uint8Array(s.replace(/\s+/g, '').match(/../g)!.map(x => parseInt(x, 16)));
const ALICE = { ip: '192.168.1.20', port: 5060 };
const S1 = { ip: '203.0.113.5', port: 5060 };
const S2 = { ip: '203.0.113.50', port: 3478 };

describe('NAT behaviour (RFC 4787)', () => {
  it('endpoint-independent mapping reuses one public port for every destination', () => {
    const n = new Nat(NAT_KINDS['port-restricted'].behaviour!, '198.51.100.7');
    expect(n.out(ALICE, S1)).toEqual({ ip: '198.51.100.7', port: 40112 });
    expect(n.out(ALICE, S2)).toEqual({ ip: '198.51.100.7', port: 40112 });
  });

  it('address- and port-dependent mapping ("symmetric") makes a new mapping for each destination', () => {
    const n = new Nat(NAT_KINDS.symmetric.behaviour!, '198.51.100.7');
    expect(n.out(ALICE, S1).port).toBe(40112);
    expect(n.out(ALICE, S2).port).toBe(40114);
    expect(n.out(ALICE, S1).port).toBe(40112);
  });

  it('filters by what the inside has sent to', () => {
    const third = { ip: '203.0.113.5', port: 30000 };
    const outsider = { ip: '192.0.2.99', port: 5060 };
    const run = (kind: NatKind) => {
      const n = new Nat(NAT_KINDS[kind].behaviour!, '198.51.100.7');
      const pub = n.out(ALICE, S1);
      return [S1, third, outsider].map(from => !!n.in(from, pub).to);
    };
    // From the server it sent to; another port on that server; another host.
    expect(run('full-cone')).toEqual([true, true, true]);
    expect(run('restricted')).toEqual([true, true, false]);
    expect(run('port-restricted')).toEqual([true, false, false]);
    expect(run('symmetric')).toEqual([true, false, false]);
  });

  it('drops a packet with no mapping, and a packet to a private address', () => {
    const n = new Nat(NAT_KINDS['full-cone'].behaviour!, '198.51.100.7');
    expect(n.in(S1, { ip: '198.51.100.7', port: 5060 }).reason).toMatch(/No mapping/);
    const w = new World().add({ id: 's', label: 'Server', ip: S1.ip });
    expect(w.send('s', 5060, ALICE).lost).toMatch(/private address/);
  });
});

describe('the NAT simulator', () => {
  const call = (alice: NatKind, bob: NatKind, media: MediaFix, rport = true, contactRewrite = true) =>
    simulateCall({ alice, bob, rport, contactRewrite, media });

  it('without rport, responses go to port 5060 and the NAT router drops them', () => {
    const r = call('port-restricted', 'port-restricted', 'relay', false);
    expect(r.registered).toBe(false);
    expect(r.answered).toBe(false);
  });

  it('without Contact rewriting, the INVITE goes to a private address', () => {
    const r = call('port-restricted', 'port-restricted', 'relay', true, false);
    expect(r.invited).toBe(false);
    expect(r.packets.find(p => p.label === 'INVITE' && p.to === 'Bob')!.note).toMatch(/10\.0\.0\.30 is a private address/);
  });

  it('signaling fixed, media not: no audio from the private c= address', () => {
    const r = call('none', 'port-restricted', 'none');
    expect([r.aToB, r.bToA]).toEqual([false, true]);
    expect(r.verdict).toMatch(/One-way audio/);
  });

  it('STUN alone works with endpoint-independent mapping, not with a symmetric NAT', () => {
    expect([call('port-restricted', 'port-restricted', 'stun').aToB, call('port-restricted', 'port-restricted', 'stun').bToA]).toEqual([true, true]);
    // Bob behind a symmetric NAT: his STUN address is only good for the STUN server.
    const r = call('full-cone', 'symmetric', 'stun');
    expect([r.aToB, r.bToA]).toEqual([false, true]);
    const r2 = call('port-restricted', 'symmetric', 'stun');
    expect([r2.aToB, r2.bToA]).toEqual([false, false]);
  });

  it('a media relay that latches works behind every NAT type', () => {
    const kinds = Object.keys(NAT_KINDS) as NatKind[];
    for (const a of kinds) for (const b of kinds) {
      const r = call(a, b, 'relay');
      expect([a, b, r.aToB, r.bToA]).toEqual([a, b, true, true]);
    }
  });

  it('ICE with TURN finds a path behind every NAT type, and a direct one when it can', () => {
    const kinds = Object.keys(NAT_KINDS) as NatKind[];
    for (const a of kinds) for (const b of kinds) {
      const r = call(a, b, 'ice');
      expect([a, b, r.aToB, r.bToA]).toEqual([a, b, true, true]);
    }
    expect(call('port-restricted', 'port-restricted', 'ice').ice!.selected!.pair.remote.type).toBe('srflx');
    const sym = call('symmetric', 'symmetric', 'ice').ice!.selected!;
    expect([sym.pair.local.type, sym.pair.remote.type]).toContain('relay');
  });
});

describe('ICE (RFC 8445)', () => {
  it('computes candidate priorities as in the RFC 8839 example', () => {
    expect(candidatePriority('host')).toBe(2130706431);
    expect(candidatePriority('srflx')).toBe(1694498815);
    expect(candidatePriority('relay')).toBe(16777215);
    // The PRIORITY attribute in the RFC 5769 request: peer-reflexive, local preference 1.
    expect(candidatePriority('prflx', 1)).toBe(0x6e0001ff);
  });

  it('writes a=candidate lines in RFC 8839 syntax', () => {
    const c: Candidate = { foundation: '2', type: 'srflx', addr: { ip: '192.0.2.3', port: 45664 }, base: { ip: '203.0.113.141', port: 8998 },
      priority: 1694498815, related: { ip: '203.0.113.141', port: 8998 } };
    expect(candidateLine(c)).toBe('a=candidate:2 1 UDP 1694498815 192.0.2.3 45664 typ srflx raddr 203.0.113.141 rport 8998');
  });

  it('pair priority: 2^32·MIN(G,D) + 2·MAX(G,D) + (G>D?1:0)', () => {
    expect(pairPriority(2130706431, 1694498815)).toBe((1n << 32n) * 1694498815n + 2n * 2130706431n + 1n);
    expect(pairPriority(1694498815, 2130706431)).toBe((1n << 32n) * 1694498815n + 2n * 2130706431n);
  });

  it('prunes local server-reflexive candidates and sorts the checklist', () => {
    const w = buildWorld('port-restricted', 'port-restricted');
    const s = { ip: SITES.turn.ip, port: SITES.turn.port };
    const r = runIce(w, { id: 'alice', label: 'Alice', port: 49170, stun: s, turn: s }, { id: 'bob', label: 'Bob', port: 3456, stun: s, turn: s });
    expect(r.local.map(c => c.type)).toEqual(['host', 'srflx', 'relay']);
    const pairs = checklist(r.local, r.remote, true);
    expect(pairs.length).toBe(6);
    expect(pairs.map(p => `${p.local.type}-${p.remote.type}`).slice(0, 3)).toEqual(['host-host', 'host-srflx', 'host-relay']);
  });

  it('fails without TURN when both NATs are symmetric', () => {
    const w = buildWorld('symmetric', 'symmetric');
    const s = { ip: SITES.turn.ip, port: SITES.turn.port };
    const r = runIce(w, { id: 'alice', label: 'Alice', port: 49170, stun: s }, { id: 'bob', label: 'Bob', port: 3456, stun: s });
    expect(r.selected).toBeUndefined();
  });

  it('learns a peer-reflexive candidate behind a symmetric NAT', () => {
    const w = buildWorld('symmetric', 'full-cone');
    const s = { ip: SITES.turn.ip, port: SITES.turn.port };
    const r = runIce(w, { id: 'alice', label: 'Alice', port: 49170, stun: s }, { id: 'bob', label: 'Bob', port: 3456, stun: s });
    expect(r.events.some(e => e.learned?.startsWith('peer-reflexive'))).toBe(true);
  });
});

describe('STUN (RFC 8489), checked against RFC 5769', () => {
  const tx = bytes('b7e7a701 bc34d686 fa87dfae');
  const password = 'VOkJxbRl1RmTxUk/WvJxBt';

  it('encodes the message type with the class bits between the method bits', () => {
    expect(messageType(BINDING, 'request')).toBe(0x0001);
    expect(messageType(BINDING, 'success')).toBe(0x0101);
    expect(messageType(BINDING, 'error')).toBe(0x0111);
    expect(messageType(BINDING, 'indication')).toBe(0x0011);
  });

  it('§2.1: the sample request, byte for byte', async () => {
    const m = await encodeStun({ method: BINDING, cls: 'request', txId: tx, attrs: [
      textAttr(ATTR.SOFTWARE, 'STUN test client'),
      u32Attr(ATTR.PRIORITY, 0x6e0001ff),
      { type: ATTR.ICE_CONTROLLED, value: bytes('932ff9b1 51263b36') },
      textAttr(ATTR.USERNAME, 'evtj:h6vY'),
    ] }, { password, fingerprint: true, pad: 0x20 });
    expect(hex(m)).toBe(hex(bytes(`0001 0058 2112a442 b7e7a701 bc34d686 fa87dfae
      8022 0010 5354554e 20746573 7420636c 69656e74
      0024 0004 6e0001ff  8029 0008 932ff9b1 51263b36
      0006 0009 6576746a 3a683676 59202020
      0008 0014 9aeaa70c bfd8cb56 781ef2b5 b2d3f249 c1b571a2
      8028 0004 e57a3bcf`)));
  });

  it('§2.2: the sample IPv4 response, with XOR-MAPPED-ADDRESS 192.0.2.1:32853', async () => {
    const addr = { ip: '192.0.2.1', port: 32853 };
    expect(hex(xorAddress(addr))).toBe('0001a147e112a643');
    const m = await encodeStun({ method: BINDING, cls: 'success', txId: tx, attrs: [
      textAttr(ATTR.SOFTWARE, 'test vector'),
      { type: ATTR.XOR_MAPPED_ADDRESS, value: xorAddress(addr) },
    ] }, { password, fingerprint: true, pad: 0x20 });
    expect(hex(m)).toBe(hex(bytes(`0101 003c 2112a442 b7e7a701 bc34d686 fa87dfae
      8022 000b 74657374 20766563 746f7220
      0020 0008 0001a147 e112a643
      0008 0014 2b91f599 fd9e90c3 8c7489f9 2af9ba53 f06be7d7
      8028 0004 c07d4c96`)));
    const d = decodeStun(m);
    if ('error' in d) throw new Error(d.error);
    expect(d.cls).toBe('success');
    expect(readXorAddress(d.attrs.find(a => a.type === ATTR.XOR_MAPPED_ADDRESS)!.value)).toEqual(addr);
  });

  it('tells STUN from RTP by the first two bits', () => {
    expect(decodeStun(bytes('80000001 00000000 00000000 00000000 00000000'))).toEqual({ error: expect.stringMatching(/not STUN/) });
  });
});

describe('the sip-alg rule', async () => {
  const { lintFlow } = await import('../src/sip/lint-flow.ts');
  const { loadFlow } = await import('../src/lib/data.ts');
  const rules = async (id: string) => lintFlow(await loadFlow(id)).map(i => i.rule);

  it('flags a NAT router that rewrites SIP', async () => {
    expect(await rules('sip-alg-rewrite')).toContain('sip-alg');
    expect(await rules('sip-alg-off')).toEqual([]);
  });
});
