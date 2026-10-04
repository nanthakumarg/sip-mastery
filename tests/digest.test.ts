import { describe, expect, it } from 'vitest';
import { computeDigest } from '../src/sip/digest.ts';

describe('computeDigest', () => {
  it('matches the RFC 2617 §3.5 example (MD5, qop=auth)', async () => {
    const r = await computeDigest({
      algorithm: 'MD5', username: 'Mufasa', realm: 'testrealm@host.com', password: 'Circle Of Life',
      method: 'GET', uri: '/dir/index.html', nonce: 'dcd98b7102dd2f0e8b11d0f600bfb0c093',
      qop: 'auth', nc: '00000001', cnonce: '0a4f113b',
    });
    expect(r.response).toBe('6629fae49393a05397450978507c4ef1');
  });

  const rfc7616 = {
    username: 'Mufasa', realm: 'http-auth@example.org', password: 'Circle of Life',
    method: 'GET', uri: '/dir/index.html', nonce: '7ypf/xlj9XXwfDPEoM4URrv/xwf94BcCAzFZH4GiTo0v',
    qop: 'auth' as const, nc: '00000001', cnonce: 'f2/wE4q74E6zIJEtWaHKaf5wv/H5QzzpXusqGemxURZJ',
  };

  it('matches the RFC 7616 §3.9.1 example (MD5)', async () => {
    const r = await computeDigest({ ...rfc7616, algorithm: 'MD5' });
    expect(r.response).toBe('8ca523f5e9506fed4657c9700eebdbec');
  });

  it('matches the RFC 7616 §3.9.1 example (SHA-256)', async () => {
    const r = await computeDigest({ ...rfc7616, algorithm: 'SHA-256' });
    expect(r.response).toBe('753927fa0e85d155564e2e272a28d1802ca10daf4496794697cf8db5856cb6c1');
  });

  it('uses H(HA1:nonce:HA2) without qop', async () => {
    const r = await computeDigest({ ...rfc7616, algorithm: 'MD5', qop: '' });
    expect(r.responseInput).toBe(`${r.ha1}:${rfc7616.nonce}:${r.ha2}`);
  });
});
