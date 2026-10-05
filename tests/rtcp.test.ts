import { describe, expect, it } from 'vitest';
import { decodeRtcp, emodel, EMODEL_CODECS, encodeRtcp, fractionLost, mosFromR, ntpMiddle, roundTrip, type RtcpPacket } from '../src/net/rtcp.ts';

const block = { ssrc: 0x9b0c2d11, fractionLost: 5, cumulativeLost: 12, extHighestSeq: 0x0001a3f2, jitter: 64, lsr: 0xb7052000, dlsr: 0x00054000 };
const COMPOUND: RtcpPacket[] = [
  { type: 'SR', ssrc: 0x3a5f12c4, sender: { ntpSec: 0xb44db705, ntpFrac: 0x20000000, rtpTs: 2412530560, packets: 1500, octets: 240000 }, blocks: [block] },
  { type: 'SDES', ssrc: 0x3a5f12c4, cname: 'alice@192.0.2.10' },
];
const g711 = EMODEL_CODECS.find(c => c.id === 'g711plc')!;

describe('RTCP packets (RFC 3550 §6)', () => {
  it('encodes and decodes a compound SR + SDES', () => {
    const b = encodeRtcp(COMPOUND);
    expect(b.length % 4).toBe(0);
    const d = decodeRtcp(b);
    expect(d.ok).toBe(true);
    expect(d.packets.map(p => [p.type, p.length])).toEqual([['SR', 52], ['SDES', 28]]);
    expect(d.parsed).toEqual(COMPOUND);
    const f = (name: string) => d.fields.find(x => x.name === name)!;
    expect(f('Length').shown).toBe('12 (52 bytes)');
    expect(f('Fraction lost').shown).toBe('5/256 (2.0%)');
    expect(f('Delay since last SR').shown).toBe('0x0005:4000 (5.250 s) (5250 ms)');
    expect(f('CNAME').shown).toBe('"alice@192.0.2.10"');
  });

  it('reads a negative cumulative loss (duplicates) and a BYE with a reason', () => {
    const b = encodeRtcp([{ type: 'RR', ssrc: 1, blocks: [{ ...block, cumulativeLost: -2 }] }, { type: 'SDES', ssrc: 1, cname: 'x' }, { type: 'BYE', ssrcs: [1], reason: 'call ended' }]);
    const d = decodeRtcp(b);
    expect(d.ok).toBe(true);
    expect((d.parsed[0] as { blocks: { cumulativeLost: number }[] }).blocks[0]!.cumulativeLost).toBe(-2);
    expect(d.parsed[2]).toEqual({ type: 'BYE', ssrcs: [1], reason: 'call ended' });
  });

  it('flags a compound packet that does not start with a report, or has no CNAME', () => {
    expect(decodeRtcp(encodeRtcp([COMPOUND[1]!, COMPOUND[0]!])).issues[0]).toMatch(/must start with an SR or RR/);
    expect(decodeRtcp(encodeRtcp([COMPOUND[0]!])).issues.join(' ')).toMatch(/CNAME.*compound packet of at least two/);
  });
});

describe('round-trip time and loss', () => {
  it('reproduces RFC 3550 Figure 2: A − LSR − DLSR = 6.125 s', () => {
    expect(ntpMiddle(0xb44db705, 0x20000000)).toBe(0xb7052000);
    expect(roundTrip(0xb7108000, 0xb7052000, 0x00054000)).toBe(6.125);
  });

  it('fraction lost is in 1/256, and zero when duplicates outnumber losses', () => {
    expect(fractionLost(250, 245)).toBe(5);
    expect(fractionLost(100, 102)).toBe(0);
    expect(fractionLost(0, 0)).toBe(0);
  });
});

describe('E-model (ITU-T G.107, simplified)', () => {
  it('G.711 with no delay and no loss gives R = 93.2, MOS about 4.4', () => {
    const e = emodel({ codec: g711, delay: 0, loss: 0, burstR: 1 });
    expect(e.r).toBeCloseTo(93.2);
    expect(e.mos).toBeCloseTo(4.41, 2);
    expect(e.band).toBe('Very satisfied');
  });

  it('delay costs little up to 177 ms, then much more', () => {
    expect(emodel({ codec: g711, delay: 150, loss: 0, burstR: 1 }).id).toBeCloseTo(3.6);
    expect(emodel({ codec: g711, delay: 300, loss: 0, burstR: 1 }).id).toBeCloseTo(7.2 + 0.11 * 122.7);
  });

  it('loss hurts more without PLC, with a low-rate codec, and when it comes in bursts', () => {
    const r = (id: string, loss: number, burstR = 1) => emodel({ codec: EMODEL_CODECS.find(c => c.id === id)!, delay: 100, loss, burstR }).r;
    expect(r('g711plc', 2)).toBeCloseTo(93.2 - 2.4 - 95 * 2 / 27.1, 5);
    expect(r('g711', 2)).toBeLessThan(r('g711plc', 2));
    expect(r('g729a', 0)).toBeLessThan(r('g711plc', 0));
    expect(r('g711plc', 5, 2)).toBeLessThan(r('g711plc', 5, 1));
    expect(mosFromR(0)).toBe(1);
    expect(mosFromR(100)).toBe(4.5);
  });
});
