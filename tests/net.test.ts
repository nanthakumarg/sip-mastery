import { describe, expect, it } from 'vitest';
import { classify } from '../src/net/address.ts';
import { buildFrame, checksum } from '../src/net/packet.ts';

describe('classify', () => {
  it.each([
    ['10.1.2.3', 'private', '10.0.0.0/8'],
    ['172.16.0.1', 'private', '172.16.0.0/12'],
    ['172.31.255.255', 'private', '172.16.0.0/12'],
    ['172.32.0.1', 'public', undefined],
    ['192.168.1.20', 'private', '192.168.0.0/16'],
    ['100.64.0.1', 'cgnat', '100.64.0.0/10'],
    ['100.127.255.255', 'cgnat', '100.64.0.0/10'],
    ['100.128.0.1', 'public', undefined],
    ['127.0.0.1', 'loopback', '127.0.0.0/8'],
    ['169.254.10.1', 'link-local', '169.254.0.0/16'],
    ['203.0.113.20', 'documentation', '203.0.113.0/24'],
    ['8.8.8.8', 'public', undefined],
    ['2001:db8::10', 'documentation', '2001:db8::/32'],
    ['fe80::1', 'link-local', 'fe80::/10'],
    ['fd12:3456::1', 'ula', 'fc00::/7'],
    ['::1', 'loopback', '::1/128'],
    ['2a00:1450::1', 'public', undefined],
    ['256.1.1.1', 'invalid', undefined],
    ['hello', 'invalid', undefined],
  ])('%s is %s', (ip, kind, range) => {
    const c = classify(ip);
    expect(c.kind).toBe(kind);
    expect(c.range).toBe(range);
  });
});

describe('buildFrame', () => {
  const sip = 'OPTIONS sip:proxy.atlanta.example SIP/2.0\r\nContent-Length: 0\r\n\r\n';
  const f = buildFrame({ srcMac: '00:00:5e:00:53:01', dstMac: '00:00:5e:00:53:02', srcIp: '192.0.2.10', dstIp: '198.51.100.10', srcPort: 5060, dstPort: 5060, payload: sip });

  it('has the right lengths', () => {
    expect(f.bytes.length).toBe(14 + 20 + 8 + sip.length);
    expect((f.bytes[16]! << 8) + f.bytes[17]!).toBe(20 + 8 + sip.length);
  });

  it('has a valid IPv4 header checksum', () => {
    expect(checksum(f.bytes.subarray(14, 34))).toBe(0);
  });

  it('has a valid UDP checksum', () => {
    const udpLen = 8 + sip.length;
    const pseudo = new Uint8Array(12 + udpLen);
    pseudo.set(f.bytes.subarray(26, 34), 0);
    pseudo[9] = 17;
    pseudo[10] = udpLen >> 8; pseudo[11] = udpLen & 0xff;
    pseudo.set(f.bytes.subarray(34, 34 + udpLen), 12);
    expect(checksum(pseudo)).toBe(0);
  });

  it('describes every byte exactly once', () => {
    const covered = new Uint8Array(f.bytes.length);
    for (const fl of f.fields) for (let i = fl.offset; i < fl.offset + fl.length; i++) covered[i]!++;
    expect([...covered].every(c => c === 1)).toBe(true);
  });
});
