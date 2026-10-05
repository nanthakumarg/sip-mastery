import { describe, expect, it } from 'vitest';
import { fragmentUdp, race, sizeRule, tcpSegments, UDP_SENDS } from '../src/net/transport.ts';
import { lintFlow } from '../src/sip/lint-flow.ts';
import { loadFlow } from '../src/lib/data.ts';

describe('UDP fragments and TCP segments', () => {
  it('fits a small message in one packet', () => {
    expect(fragmentUdp(800, 1500)).toEqual([{ index: 0, offset: 0, payload: 808, packet: 828 }]);
  });

  it('cuts a large datagram into fragments of multiples of 8 bytes', () => {
    const f = fragmentUdp(1410, 1400);
    expect(f.map(x => [x.offset, x.payload])).toEqual([[0, 1376], [1376, 42]]);
    expect(fragmentUdp(4000, 1500).map(x => x.payload)).toEqual([1480, 1480, 1048]);
    // IPv6 adds a 40-byte header and an 8-byte fragment header.
    expect(fragmentUdp(1500, 1280, true).map(x => x.payload)).toEqual([1232, 276]);
  });

  it('TCP sends the same message in segments of the MSS', () => {
    expect(tcpSegments(1410, 1400)).toBe(2);
    expect(tcpSegments(1000, 1500)).toBe(1);
    expect(tcpSegments(1440, 1500, false, true)).toBe(2); // TLS adds about 22 bytes
  });
});

describe('the 1300-byte rule (RFC 3261 §18.1.1)', () => {
  it('requires TCP above 1300 bytes when the path MTU is unknown, or within 200 bytes of it', () => {
    expect(sizeRule(1300).mustUseCongestionControlled).toBe(false);
    expect(sizeRule(1301).mustUseCongestionControlled).toBe(true);
    expect(sizeRule(1250, 1400).mustUseCongestionControlled).toBe(true);
    expect(sizeRule(1100, 1400).mustUseCongestionControlled).toBe(false);
  });

  it('udp-size: flags a request over 1300 bytes sent over UDP', async () => {
    expect(lintFlow(await loadFlow('udp-big-invite')).map(i => `${i.rule}@${i.step}`)).toEqual(['udp-size@2', 'udp-size@3']);
    expect(lintFlow(await loadFlow('tcp-big-invite'))).toEqual([]);
  });
});

describe('the transport race', () => {
  const base = { sipBytes: 1410, mtu: 1400, ipv6: false, loss: 0, dropFragments: false, delay: 40, seed: 3 };

  it('with no loss, both deliver at once', () => {
    const r = race(base);
    expect(r.udp.delivered).toBe(true);
    expect(r.udp.attempts).toHaveLength(1);
    expect(r.tcp.segments).toBe(2);
  });

  it('a firewall that drops fragments makes UDP fail after 7 sends, while TCP delivers', () => {
    const r = race({ ...base, dropFragments: true });
    expect(r.udp.delivered).toBe(false);
    expect(r.udp.attempts.map(a => a.at)).toEqual(UDP_SENDS);
    expect(r.tcp.delivered).toBe(true);
  });

  it('a message that fits in one packet is not hurt by the firewall', () => {
    expect(race({ ...base, sipBytes: 900, dropFragments: true }).udp.delivered).toBe(true);
  });
});
