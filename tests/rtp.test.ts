import { describe, expect, it } from 'vitest';
import { bandwidth, CODECS, decodeRtp, encodeEvent, encodeRtp, parseHex, simulateJitter, toHex } from '../src/net/rtp.ts';

const codec = (id: string) => CODECS.find(c => c.id === id)!;
const field = (d: ReturnType<typeof decodeRtp>, key: string) => d.fields.find(f => f.key === key)!;

describe('RTP header (RFC 3550 §5.1)', () => {
  it('encodes and decodes the fixed header', () => {
    const b = encodeRtp({ version: 2, padding: 0, marker: true, pt: 0, seq: 26232, ts: 2412530560, ssrc: 0x3a5f12c4, csrc: [] }, new Uint8Array(160));
    expect(b.length).toBe(172);
    expect(toHex(b.slice(0, 12))).toBe('80 80 66 78 8f cc 4b 80 3a 5f 12 c4');
    const d = decodeRtp(b);
    expect(d.ok).toBe(true);
    expect(d.header).toMatchObject({ version: 2, marker: true, pt: 0, seq: 26232, ts: 2412530560, ssrc: 0x3a5f12c4 });
    expect(field(d, 'PT').shown).toBe('0 (PCMU)');
    expect(field(d, 'payload').explain).toMatch(/20 ms/);
    expect(d.fields.map(f => [f.key, f.bit, f.bits]).slice(0, 9)).toEqual([
      ['V', 0, 2], ['P', 2, 1], ['X', 3, 1], ['CC', 4, 4], ['M', 8, 1], ['PT', 9, 7], ['seq', 16, 16], ['ts', 32, 32], ['SSRC', 64, 32],
    ]);
  });

  it('reads CSRCs, a header extension, and padding', () => {
    const b = encodeRtp({ version: 2, padding: 4, marker: false, pt: 8, seq: 1, ts: 160, ssrc: 1, csrc: [0xaaaa, 0xbbbb], ext: { profile: 0xbede, words: [0x10ff0000] } }, new Uint8Array(160));
    const d = decodeRtp(b);
    expect(d.ok).toBe(true);
    expect(d.fields.filter(f => f.part === 'csrc')).toHaveLength(2);
    expect(field(d, 'extprof').explain).toMatch(/one-byte/);
    expect(d.payloadLength).toBe(160);
    expect(field(d, 'pad').value).toBe(4);
  });

  it('decodes a telephone-event payload (RFC 4733)', () => {
    const b = encodeRtp({ version: 2, padding: 0, marker: false, pt: 101, seq: 9, ts: 4000, ssrc: 7, csrc: [] }, encodeEvent({ event: 5, end: true, volume: 10, duration: 1280 }));
    const d = decodeRtp(b);
    expect(d.event).toEqual({ event: 5, end: true, volume: 10, duration: 1280 });
    expect(field(d, 'dur').shown).toBe('1280 (160 ms at 8000 Hz)');
  });

  it('flags a wrong version, a short packet, and RTCP-like payload types', () => {
    expect(decodeRtp(new Uint8Array(8)).issues[0]).toMatch(/at least 12/);
    expect(decodeRtp(parseHex('40 00 00 01 00 00 00 00 00 00 00 01') as Uint8Array).issues[0]).toMatch(/Version is 1/);
    expect(decodeRtp(parseHex('80 c8 00 06 00 00 00 00 00 00 00 01') as Uint8Array).issues.join()).toMatch(/RTCP/);
  });

  it('reads hex in several forms', () => {
    expect(toHex(parseHex('0x80, 0x00:1a-2b') as Uint8Array)).toBe('80 00 1a 2b');
    expect(toHex(parseHex('0000  80 08 00 01 00 00 00 a0  ........\n0008  00 00 00 01') as Uint8Array)).toBe('80 08 00 01 00 00 00 a0 00 00 00 01');
    expect(parseHex('80 0')).toMatch(/odd/);
    expect(parseHex('zz')).toMatch(/hex/);
  });
});

describe('bandwidth', () => {
  const bw = (id: string, ptime: number, link: 'ip' | 'ethernet' | 'vlan' | 'wire' = 'ethernet', ipv6 = false, srtp = false) =>
    bandwidth({ codec: codec(id), ptime, link, ipv6, srtp });

  it('G.711 at 20 ms: 80 kbit/s at IP, 87.2 on Ethernet, 95.2 on the wire', () => {
    expect(bw('pcmu', 20, 'ip').kbps).toBe(80);
    expect(bw('pcmu', 20).kbps).toBeCloseTo(87.2);
    expect(bw('pcmu', 20, 'wire').kbps).toBeCloseTo(95.2);
    expect(bw('pcmu', 20).tsStep).toBe(160);
  });

  it('G.729 at 20 ms is 24 kbit/s at IP: the headers are twice the payload', () => {
    const r = bw('g729', 20, 'ip');
    expect(r.kbps).toBe(24);
    expect(r.payloadShare).toBeCloseTo(1 / 3);
    expect(bw('g729', 40, 'ip').kbps).toBe(16);
  });

  it('IPv6 and SRTP add their headers', () => {
    expect(bw('pcmu', 20, 'ip', true).kbps).toBe(88);
    expect(bw('pcmu', 20, 'ip', false, true).kbps).toBe(84);
    expect(bw('opus', 20).tsStep).toBe(960);
  });
});

describe('jitter buffer', () => {
  const base = { packets: 200, ptime: 20, baseDelay: 40, jitter: 0, loss: 0, buffer: 40, seed: 7 };

  it('plays every packet when there is no jitter or loss', () => {
    const r = simulateJitter(base);
    expect([r.played, r.late, r.lost]).toEqual([200, 0, 0]);
    expect(r.jitterEstimate).toBe(0);
    expect(r.delay).toBe(80);
  });

  it('a deeper buffer turns late packets into played ones, at the cost of delay', () => {
    const small = simulateJitter({ ...base, jitter: 20, buffer: 20 });
    const big = simulateJitter({ ...base, jitter: 20, buffer: 120 });
    expect(small.late).toBeGreaterThan(big.late);
    expect(big.delay).toBeGreaterThan(small.delay);
    expect(small.jitterEstimate).toBeGreaterThan(5);
  });

  it('counts network loss separately from late packets, and is the same for the same seed', () => {
    const r = simulateJitter({ ...base, loss: 5 });
    expect(r.lost).toBeGreaterThan(0);
    expect(r.late).toBe(0);
    expect(simulateJitter({ ...base, loss: 5 })).toEqual(r);
  });
});
