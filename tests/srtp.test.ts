import { describe, expect, it } from 'vitest';
import {
  aesCm, base64Encode, deriveKeys, fromHex, hex, parseCrypto, protectRtp, srtpIv, SUITES, unprotectRtp,
} from '../src/net/srtp.ts';
import { encodeRtp } from '../src/net/rtp.ts';

const S80 = SUITES.AES_CM_128_HMAC_SHA1_80!;

describe('SRTP cryptography (RFC 3711 Appendix B)', () => {
  it('B.2: AES-CM keystream', async () => {
    const iv = srtpIv(fromHex('F0F1F2F3F4F5F6F7F8F9FAFBFCFD'), 0, 0);
    expect(hex(iv).toUpperCase()).toBe('F0F1F2F3F4F5F6F7F8F9FAFBFCFD0000');
    const ks = await aesCm(fromHex('2B7E151628AED2A6ABF7158809CF4F3C'), iv, 48);
    expect(hex(ks).toUpperCase()).toBe('E03EAD0935C95E80E166B16DD92B4EB4D23513162B02D0F72A43A2FE4A5F97AB41E95B3BB0A2E8DD477901E4FCA894C0');
  });

  it('B.3: key derivation', async () => {
    const k = await deriveKeys(fromHex('E1F97A0D3E018BE0D64FA32C06DE4139'), fromHex('0EC675AD498AFEEBB6960B3AABE6'));
    expect(hex(k.encKey).toUpperCase()).toBe('C61E7A93744F39EE10734AFE3FF7A087');
    expect(hex(k.salt).toUpperCase()).toBe('30CBBC08863D8C85D49DB34A9AE1');
    expect(hex(k.authKey).toUpperCase()).toBe('CEBE321F6FF7716B6FD4AB49AF256A156D38BAA4');
  });

  it('protects and unprotects an RTP packet; the header stays readable', async () => {
    const key = fromHex('E1F97A0D3E018BE0D64FA32C06DE4139'), salt = fromHex('0EC675AD498AFEEBB6960B3AABE6');
    const rtp = encodeRtp({ version: 2, padding: 0, marker: false, pt: 0, seq: 26232, ts: 2412530560, ssrc: 0x3a5f12c4, csrc: [] }, new Uint8Array(160).fill(0xff));
    const p = await protectRtp(rtp, key, salt, S80);
    expect(p.packet.length).toBe(172 + 10);
    expect(hex(p.packet.slice(0, 12))).toBe(hex(rtp.slice(0, 12)));
    expect(hex(p.packet.slice(12, 172))).not.toBe(hex(rtp.slice(12)));
    const back = await unprotectRtp(p.packet, key, salt, S80);
    expect(back.ok).toBe(true);
    expect(hex(back.rtp!)).toBe(hex(rtp));
  });

  it('rejects a changed packet, and a wrong key', async () => {
    const key = fromHex('E1F97A0D3E018BE0D64FA32C06DE4139'), salt = fromHex('0EC675AD498AFEEBB6960B3AABE6');
    const rtp = encodeRtp({ version: 2, padding: 0, marker: false, pt: 0, seq: 1, ts: 160, ssrc: 1, csrc: [] }, new Uint8Array(160));
    const p = await protectRtp(rtp, key, salt, S80);
    const tampered = p.packet.slice(); tampered[3] ^= 1; // the sequence number: header, not encrypted, but authenticated
    expect((await unprotectRtp(tampered, key, salt, S80)).reason).toMatch(/AUTHENTICATION FAILURE/);
    expect((await unprotectRtp(p.packet, fromHex('00'.repeat(16)), salt, S80)).ok).toBe(false);
  });

  it('the same packet with a different sequence number gets a different keystream', async () => {
    const k = fromHex('2B7E151628AED2A6ABF7158809CF4F3C');
    const a = await aesCm(k, srtpIv(new Uint8Array(14), 7, 1), 16);
    const b = await aesCm(k, srtpIv(new Uint8Array(14), 7, 2), 16);
    expect(hex(a)).not.toBe(hex(b));
  });
});

describe('a=crypto (RFC 4568)', () => {
  it('reads the RFC 4568 example', () => {
    const c = parseCrypto('1 AES_CM_128_HMAC_SHA1_80 inline:PS1uQCVeeCFCanVmcjkpPywjNWhcYD0mXXtxaVBR|2^20|1:32');
    expect(c.issues).toEqual([]);
    expect(c.suite?.tagLen).toBe(10);
    expect(c.key?.length).toBe(16);
    expect(c.salt?.length).toBe(14);
    expect([c.lifetime, c.mki]).toEqual(['2^20', '1:32']);
    expect(base64Encode(new Uint8Array([...c.key!, ...c.salt!]))).toBe('PS1uQCVeeCFCanVmcjkpPywjNWhcYD0mXXtxaVBR');
  });

  it('flags an unknown suite and a key of the wrong length', () => {
    expect(parseCrypto('1 AES_256_FOO inline:PS1uQCVeeCFCanVmcjkpPywjNWhcYD0mXXtxaVBR').issues[0]).toMatch(/not a crypto-suite/);
    expect(parseCrypto('1 AES_CM_128_HMAC_SHA1_32 inline:PS1uQCVeeCFC').issues[0]).toMatch(/9 bytes/);
  });
});

describe('media security lint rules', async () => {
  const { lintFlow } = await import('../src/sip/lint-flow.ts');
  const { loadFlow } = await import('../src/lib/data.ts');
  const { checkDtlsAnswer, checkDtlsOffer, parseSdp } = await import('../src/sip/sdp.ts');
  const rules = async (id: string) => lintFlow(await loadFlow(id)).map(i => `${i.rule}@${i.step}`);

  it('sdes-over-tls: a=crypto keys only over TLS (RFC 4568 §8.3)', async () => {
    expect(await rules('srtp-sdes-udp')).toEqual(['sdes-over-tls@0', 'sdes-over-tls@1']);
    expect(await rules('srtp-sdes-tls')).toEqual([]);
    expect(await rules('srtp-best-effort')).toEqual([]);
  });

  it('dtls-setup: the offer says actpass; the answer picks the other role', async () => {
    expect(await rules('srtp-dtls-both-active')).toEqual(['dtls-setup@0', 'dtls-setup@1']);
    expect(await rules('srtp-dtls')).toEqual([]);
    const sdp = (role: string) => parseSdp(`v=0\no=- 1 1 IN IP4 192.0.2.1\ns=-\nc=IN IP4 192.0.2.1\nt=0 0\nm=audio 4000 UDP/TLS/RTP/SAVP 0\na=setup:${role}\na=fingerprint:sha-256 AA:BB`);
    expect(checkDtlsOffer(sdp('actpass'))).toEqual([]);
    expect(checkDtlsAnswer(sdp('actpass'), sdp('passive'))).toEqual([]);
    expect(checkDtlsAnswer(sdp('actpass'), sdp('actpass'))[0]!.message).toMatch(/must choose active or passive/);
    expect(checkDtlsAnswer(sdp('passive'), sdp('passive'))[0]!.message).toMatch(/both sides wait/);
  });
});
