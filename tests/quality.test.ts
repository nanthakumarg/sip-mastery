import { describe, expect, it } from 'vitest';
import { adaptiveDepth, budget, dscpFromTos, lateFraction, QUALITY_PRESETS, tosByte, TRAFFIC_CLASSES, type QualityInput } from '../src/net/quality.ts';
import { mosFromR } from '../src/net/rtcp.ts';

const base: QualityInput = QUALITY_PRESETS[0]!.input;

describe('the quality budget', () => {
  it('adds up the delay parts', () => {
    const b = budget({ ...base, network: 30, distance: 10000, jitter: 4 });
    expect(b.parts.map(p => p.key)).toEqual(['pkt', 'codec', 'net', 'dist', 'jb']);
    expect(b.delay).toBe(20 + 1 + 30 + 50 + 20);
    expect(b.parts.find(p => p.key === 'dist')!.ms).toBe(50);
  });

  it('an adaptive buffer holds 5 × jitter and discards under 1 %; a small fixed one discards many', () => {
    expect(adaptiveDepth(10)).toBe(50);
    expect(adaptiveDepth(1)).toBe(20);
    expect(lateFraction(adaptiveDepth(10), 10)).toBeLessThan(1);
    const fixed = budget({ ...base, jitter: 12, buffer: 20 });
    expect(fixed.discards).toBeGreaterThan(15);
    expect(fixed.totalLoss).toBeGreaterThan(fixed.discards - 0.01);
    expect(budget({ ...base, jitter: 12 }).r).toBeGreaterThan(fixed.r + 20);
  });

  it('each transcoding stage adds Ie 11 and one packet time plus codec delay', () => {
    const one = budget({ ...base, transcodes: 1 }), none = budget(base);
    expect(one.ie - none.ie).toBe(11);
    expect(one.delay - none.delay).toBe(35);
    expect(one.r).toBeLessThan(none.r - 10);
  });

  it('advice names the biggest delay part when the delay passes 150 ms', () => {
    const b = budget({ ...base, distance: 20000, network: 40 });
    expect(b.delay).toBeGreaterThan(150);
    expect(b.advice[0]).toMatch(/distance/);
  });

  it('MOS never goes below 1', () => {
    for (const r of [0, 1, 3, 6]) expect(mosFromR(r)).toBeGreaterThanOrEqual(1);
  });
});

describe('DSCP', () => {
  it('EF is DSCP 46, ToS 184; a ToS of 46 is DSCP 11', () => {
    expect(TRAFFIC_CLASSES.find(c => c.id === 'rtp')!.dscp).toBe(46);
    expect(tosByte(46)).toBe(184);
    expect(dscpFromTos(184)).toBe(46);
    expect(dscpFromTos(46)).toBe(11);
  });
  it('the classes have the RFC 4594 values', () => {
    expect(Object.fromEntries(TRAFFIC_CLASSES.map(c => [c.dscpName, c.dscp]))).toMatchObject({ EF: 46, AF41: 34, CS5: 40, CS3: 24, CS6: 48 });
  });
});
