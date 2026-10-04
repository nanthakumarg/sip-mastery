import { describe, expect, it } from 'vitest';
import { attempts, BILOXI_ZONE, parseTarget, resolve, srvOrder, TIMER_B, type Srv, type Zone } from '../src/sip/dns.ts';

/** A random() that returns these values in turn. */
const seq = (...v: number[]) => { let i = 0; return () => v[i++ % v.length]!; };

describe('SRV ordering (RFC 2782)', () => {
  const recs: Srv[] = [
    { priority: 20, weight: 0, port: 5060, target: 'backup' },
    { priority: 10, weight: 60, port: 5060, target: 'sip1' },
    { priority: 10, weight: 40, port: 5060, target: 'sip2' },
  ];

  it('tries every lower priority first, whatever the weights', () => {
    for (const r of [0, 0.3, 0.6, 0.99]) {
      expect(srvOrder(recs, seq(r)).order.at(-1)!.target).toBe('backup');
    }
  });

  it('picks the first record whose running sum reaches the draw', () => {
    // Sum 100: a draw of 0..60 picks sip1 (running sum 60), 61..100 picks sip2 (running sum 100).
    expect(srvOrder(recs, seq(0.5)).order.map(r => r.target)).toEqual(['sip1', 'sip2', 'backup']);
    expect(srvOrder(recs, seq(0.7)).order.map(r => r.target)).toEqual(['sip2', 'sip1', 'backup']);
    expect(srvOrder(recs, seq(0.7)).draws[0]).toMatchObject({ priority: 10, r: 70 });
  });

  it('shares the load in proportion to the weights', () => {
    let first = 0;
    const rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
    for (let i = 0; i < 20000; i++) if (srvOrder(recs, rnd).order[0]!.target === 'sip1') first++;
    expect(first / 20000).toBeGreaterThan(0.57);
    expect(first / 20000).toBeLessThan(0.63);
  });

  it('gives a weight-0 record a chance only when the draw is 0', () => {
    const z = [{ priority: 1, weight: 0, port: 1, target: 'zero' }, { priority: 1, weight: 10, port: 1, target: 'ten' }];
    expect(srvOrder(z, seq(0)).order[0]!.target).toBe('zero');
    expect(srvOrder(z, seq(0.2)).order[0]!.target).toBe('ten');
  });
});

describe('transport, port, and address (RFC 3263 §4.1, §4.2)', () => {
  const both = { supports: ['UDP', 'TCP'] as const, random: seq(0.5) };
  const opts = (s: ('UDP' | 'TCP' | 'TLS')[]) => ({ supports: s, random: seq(0.5) });

  it('reads the parts of the URI that matter', () => {
    expect(parseTarget('sips:bob@biloxi.example;transport=tcp')).toMatchObject({ secure: true, host: 'biloxi.example', transport: 'TLS', numeric: false });
    expect(parseTarget('sip:bob@203.0.113.11:5070')).toMatchObject({ host: '203.0.113.11', port: 5070, numeric: true });
    expect(parseTarget('sip:bob@biloxi.example;maddr=192.0.2.4')).toMatchObject({ host: '192.0.2.4', numeric: true });
  });

  it('follows NAPTR to the most preferred transport the client supports, as in the RFC 3263 example', () => {
    const r = resolve('sip:bob@biloxi.example', BILOXI_ZONE, { ...both, supports: ['UDP', 'TCP'] });
    expect(r.transport).toBe('TCP');
    expect(r.lookups.map(l => `${l.qtype} ${l.qname}`)).toEqual([
      'NAPTR biloxi.example', 'SRV _sip._tcp.biloxi.example',
      'A sip1.biloxi.example', 'A sip2.biloxi.example', 'A backup.biloxi.example',
    ]);
    expect(r.candidates.map(c => `${c.ip}:${c.port}/${c.transport}`)).toEqual(['203.0.113.11:5060/TCP', '203.0.113.12:5060/TCP', '198.51.100.50:5060/TCP']);
  });

  it('uses TLS on port 5061 for a SIP URI when the client supports TLS, and only SIPS services for a SIPS URI', () => {
    expect(resolve('sip:bob@biloxi.example', BILOXI_ZONE, opts(['UDP', 'TCP', 'TLS'])).candidates[0]).toMatchObject({ transport: 'TLS', port: 5061 });
    expect(resolve('sips:bob@biloxi.example', BILOXI_ZONE, opts(['UDP', 'TCP', 'TLS'])).transport).toBe('TLS');
    expect(resolve('sips:bob@biloxi.example', BILOXI_ZONE, opts(['UDP', 'TCP'])).candidates).toEqual([]);
  });

  it('skips NAPTR when the URI names the transport', () => {
    const r = resolve('sip:bob@biloxi.example;transport=udp', BILOXI_ZONE, opts(['UDP', 'TCP']));
    expect(r.transport).toBe('UDP');
    expect(r.lookups[0]).toMatchObject({ qtype: 'SRV', qname: '_sip._udp.biloxi.example' });
  });

  it('with an explicit port, looks up only A records: no SRV, no backup', () => {
    const r = resolve('sip:bob@biloxi.example:5060', BILOXI_ZONE, opts(['UDP', 'TCP']));
    expect(r.lookups.map(l => l.qtype)).toEqual(['A']);
    expect(r.candidates).toEqual([{ ip: '203.0.113.11', port: 5060, transport: 'UDP' }]);
  });

  it('with an IP address, makes no lookup at all', () => {
    const r = resolve('sip:bob@203.0.113.11', BILOXI_ZONE, opts(['UDP', 'TCP']));
    expect(r.lookups).toEqual([]);
    expect(r.candidates).toEqual([{ ip: '203.0.113.11', port: 5060, transport: 'UDP' }]);
  });

  it('without NAPTR, queries SRV for each supported transport; without SRV, falls back to A and the default port', () => {
    const noNaptr: Zone = { ...BILOXI_ZONE, naptr: {} };
    const r = resolve('sip:bob@biloxi.example', noNaptr, opts(['UDP', 'TCP']));
    expect(r.transport).toBe('UDP');
    expect(r.lookups.slice(0, 2).map(l => `${l.qtype} ${l.qname}`)).toEqual(['NAPTR biloxi.example', 'SRV _sip._udp.biloxi.example']);
    const bare: Zone = { naptr: {}, srv: {}, a: { 'biloxi.example': ['203.0.113.11'] } };
    const b = resolve('sip:bob@biloxi.example', bare, opts(['UDP', 'TCP']));
    expect(b.transportRfc).toBe('rfc3263-4.1-no-srv');
    expect(b.candidates).toEqual([{ ip: '203.0.113.11', port: 5060, transport: 'UDP' }]);
  });
});

describe('failover (RFC 3263 §4.3)', () => {
  const r = resolve('sip:bob@biloxi.example;transport=udp', BILOXI_ZONE, { supports: ['UDP'], random: seq(0.5) });

  it('moves on at once after a 503 or a refused port, and after Timer B when nothing answers', () => {
    const fast = attempts(r.candidates, ip => (ip === '203.0.113.11' ? '503' : ip === '203.0.113.12' ? 'refused' : 'up'));
    expect(fast.attempts.map(a => a.outcome)).toEqual(['503', 'refused', 'answered']);
    expect(fast.elapsed).toBeLessThan(1);
    const slow = attempts(r.candidates, ip => (ip === '203.0.113.11' ? 'silent' : 'up'));
    expect(slow.reached?.ip).toBe('203.0.113.12');
    expect(slow.elapsed).toBeGreaterThanOrEqual(TIMER_B);
  });

  it('fails when every server fails', () => {
    const all = attempts(r.candidates, () => 'silent');
    expect(all.reached).toBeUndefined();
    expect(all.elapsed).toBe(3 * TIMER_B);
  });
});
