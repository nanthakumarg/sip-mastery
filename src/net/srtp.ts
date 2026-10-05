/**
 * SRTP for Module 18, with real cryptography (WebCrypto, so it runs in the
 * browser and in tests):
 *  - key derivation with the AES-CM PRF (RFC 3711 §4.3);
 *  - AES-CM encryption of the payload (§4.1.1) and the HMAC-SHA1 tag (§4.2.1);
 *  - the a=crypto line of SDES (RFC 4568), and a=setup / a=fingerprint of DTLS-SRTP.
 * The diagrams are src/diagrams/SrtpPacket.tsx and KeyExchange.tsx.
 */

export interface Suite { name: string; keyLen: number; saltLen: number; tagLen: number }

/** The crypto-suites of RFC 4568 §6.2 that SIP still uses. */
export const SUITES: Record<string, Suite> = {
  AES_CM_128_HMAC_SHA1_80: { name: 'AES_CM_128_HMAC_SHA1_80', keyLen: 16, saltLen: 14, tagLen: 10 },
  AES_CM_128_HMAC_SHA1_32: { name: 'AES_CM_128_HMAC_SHA1_32', keyLen: 16, saltLen: 14, tagLen: 4 },
};

export const fromHex = (h: string) => new Uint8Array((h.replace(/[^0-9a-f]/gi, '').match(/../g) ?? []).map(x => parseInt(x, 16)));
export const hex = (b: Uint8Array) => [...b].map(x => x.toString(16).padStart(2, '0')).join('');

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function base64Decode(s: string): Uint8Array | undefined {
  const clean = s.replace(/=+$/, '');
  if (/[^A-Za-z0-9+/]/.test(clean) || clean.length % 4 === 1) return undefined;
  const out: number[] = [];
  let bits = 0, acc = 0;
  for (const ch of clean) {
    acc = (acc << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) { bits -= 8; out.push((acc >> bits) & 255); }
  }
  return new Uint8Array(out);
}
export function base64Encode(b: Uint8Array): string {
  let out = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i]! << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + (i + 1 < b.length ? B64[(n >> 6) & 63]! : '=') + (i + 2 < b.length ? B64[n & 63]! : '=');
  }
  return out;
}

const subtle = () => globalThis.crypto.subtle;

/** AES in counter mode from a 128-bit initial counter: the keystream for `len` bytes. */
export async function aesCm(key: Uint8Array, iv: Uint8Array, len: number): Promise<Uint8Array> {
  const k = await subtle().importKey('raw', key as BufferSource, { name: 'AES-CTR' }, false, ['encrypt']);
  const out = await subtle().encrypt({ name: 'AES-CTR', counter: iv as BufferSource, length: 128 }, k, new Uint8Array(len));
  return new Uint8Array(out);
}

export interface SessionKeys { encKey: Uint8Array; authKey: Uint8Array; salt: Uint8Array }

/**
 * RFC 3711 §4.3: session keys from the master key and salt, for packet
 * index 0 and a key derivation rate of 0. x = label XOR master salt; the
 * PRF is AES-CM with IV = x × 2^16.
 */
export async function deriveKeys(masterKey: Uint8Array, masterSalt: Uint8Array, rtcp = false): Promise<SessionKeys> {
  const prf = async (label: number, len: number) => {
    const iv = new Uint8Array(16);
    iv.set(masterSalt, 0); // 14 bytes, then two zero bytes (× 2^16)
    iv[7] ^= label; // the label sits in front of the 48-bit index: byte 7 of the 14-byte salt
    return aesCm(masterKey, iv, len);
  };
  const base = rtcp ? 3 : 0;
  return { encKey: await prf(base, 16), authKey: await prf(base + 1, 20), salt: await prf(base + 2, 14) };
}

/** RFC 3711 §4.1.1: IV = (k_s × 2^16) XOR (SSRC × 2^64) XOR (i × 2^16). */
export function srtpIv(salt: Uint8Array, ssrc: number, index: number): Uint8Array {
  const iv = new Uint8Array(16);
  iv.set(salt, 0);
  for (let k = 0; k < 4; k++) iv[4 + k] ^= (ssrc >>> (24 - 8 * k)) & 255;
  // The 48-bit packet index (ROC || SEQ) goes into bytes 8–13.
  const hi = Math.floor(index / 2 ** 32), lo = index >>> 0;
  iv[8] ^= (hi >>> 8) & 255; iv[9] ^= hi & 255;
  for (let k = 0; k < 4; k++) iv[10 + k] ^= (lo >>> (24 - 8 * k)) & 255;
  return iv;
}

export interface Protected {
  keys: SessionKeys;
  iv: Uint8Array;
  index: number;
  headerLen: number;
  /** The SRTP packet: header, encrypted payload, authentication tag. */
  packet: Uint8Array;
  tag: Uint8Array;
}

/** RFC 3711 §3.3: turn an RTP packet into an SRTP packet. */
export async function protectRtp(rtp: Uint8Array, masterKey: Uint8Array, masterSalt: Uint8Array, suite: Suite, roc = 0): Promise<Protected> {
  const keys = await deriveKeys(masterKey, masterSalt);
  const cc = rtp[0]! & 0x0f, x = (rtp[0]! >> 4) & 1;
  let headerLen = 12 + cc * 4;
  if (x) headerLen += 4 + ((rtp[headerLen + 2]! << 8) | rtp[headerLen + 3]!) * 4;
  const seq = (rtp[2]! << 8) | rtp[3]!;
  const ssrc = ((rtp[8]! << 24) | (rtp[9]! << 16) | (rtp[10]! << 8) | rtp[11]!) >>> 0;
  const index = roc * 65536 + seq;
  const iv = srtpIv(keys.salt, ssrc, index);
  const payload = rtp.slice(headerLen);
  const ks = await aesCm(keys.encKey, iv, payload.length);
  const enc = payload.map((b, i) => b ^ ks[i]!);
  const body = new Uint8Array(headerLen + enc.length);
  body.set(rtp.slice(0, headerLen)); body.set(enc, headerLen);
  const tag = await authTag(keys.authKey, body, roc, suite.tagLen);
  const packet = new Uint8Array(body.length + tag.length);
  packet.set(body); packet.set(tag, body.length);
  return { keys, iv, index, headerLen, packet, tag };
}

/** RFC 3711 §4.2: HMAC-SHA1 over the authenticated portion and the ROC, cut to the tag length. */
export async function authTag(authKey: Uint8Array, authenticated: Uint8Array, roc: number, tagLen: number): Promise<Uint8Array> {
  const k = await subtle().importKey('raw', authKey as BufferSource, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const m = new Uint8Array(authenticated.length + 4);
  m.set(authenticated);
  new DataView(m.buffer).setUint32(authenticated.length, roc >>> 0);
  return new Uint8Array(await subtle().sign('HMAC', k, m)).slice(0, tagLen);
}

export interface Unprotected { ok: boolean; rtp?: Uint8Array; reason?: string }

/** The receiver side: check the tag, then decrypt. */
export async function unprotectRtp(srtp: Uint8Array, masterKey: Uint8Array, masterSalt: Uint8Array, suite: Suite, roc = 0): Promise<Unprotected> {
  if (srtp.length < 12 + suite.tagLen) return { ok: false, reason: 'Too short for an SRTP packet.' };
  const keys = await deriveKeys(masterKey, masterSalt);
  const body = srtp.slice(0, srtp.length - suite.tagLen);
  const tag = srtp.slice(srtp.length - suite.tagLen);
  const want = await authTag(keys.authKey, body, roc, suite.tagLen);
  if (hex(want) !== hex(tag)) return { ok: false, reason: 'AUTHENTICATION FAILURE: the tag does not match. The packet was changed, or the key is wrong.' };
  const cc = body[0]! & 0x0f, x = (body[0]! >> 4) & 1;
  let headerLen = 12 + cc * 4;
  if (x) headerLen += 4 + ((body[headerLen + 2]! << 8) | body[headerLen + 3]!) * 4;
  const seq = (body[2]! << 8) | body[3]!;
  const ssrc = ((body[8]! << 24) | (body[9]! << 16) | (body[10]! << 8) | body[11]!) >>> 0;
  const ks = await aesCm(keys.encKey, srtpIv(keys.salt, ssrc, roc * 65536 + seq), body.length - headerLen);
  const rtp = body.slice();
  for (let i = headerLen; i < rtp.length; i++) rtp[i]! ^= ks[i - headerLen]!;
  return { ok: true, rtp };
}

// ---------------------------------------------------------------------------
// SDP attributes

export interface CryptoLine {
  tag: number;
  suite?: Suite;
  suiteName: string;
  key?: Uint8Array;
  salt?: Uint8Array;
  lifetime?: string;
  mki?: string;
  issues: string[];
}

/** RFC 4568 §4, §6.1: a=crypto:<tag> <suite> inline:<key||salt>[|lifetime][|MKI:len] */
export function parseCrypto(value: string): CryptoLine {
  const issues: string[] = [];
  const v = value.replace(/^a=crypto:/, '').trim();
  const [tagS = '', suiteName = '', keyParams = ''] = v.split(/\s+/);
  const tag = Number(tagS);
  if (!/^\d{1,9}$/.test(tagS)) issues.push(`The tag "${tagS}" must be a number.`);
  const suite = SUITES[suiteName.toUpperCase()];
  if (!suite) issues.push(`"${suiteName}" is not a crypto-suite that SIP phones use. Try AES_CM_128_HMAC_SHA1_80.`);
  const out: CryptoLine = { tag, suite, suiteName, issues };
  const m = /^inline:([^|]+)(?:\|([^|:]+))?(?:\|(\d+:\d+))?$/.exec(keyParams);
  if (!m) { issues.push('The key must be "inline:" followed by the base64 master key and salt.'); return out; }
  const raw = base64Decode(m[1]!);
  if (!raw) issues.push('The key is not valid base64.');
  else if (suite && raw.length !== suite.keyLen + suite.saltLen) issues.push(`The key and salt are ${raw.length} bytes; ${suite.name} needs ${suite.keyLen + suite.saltLen} (a 16-byte key and a 14-byte salt).`);
  else if (raw) { out.key = raw.slice(0, 16); out.salt = raw.slice(16, 30); }
  out.lifetime = m[2];
  out.mki = m[3];
  return out;
}

export type SetupRole = 'actpass' | 'active' | 'passive' | 'holdconn';

/** RFC 4145 §4.1: the answers allowed for each offered setup role. */
export const SETUP_ANSWERS: Record<SetupRole, SetupRole[]> = {
  actpass: ['active', 'passive', 'holdconn'],
  active: ['passive', 'holdconn'],
  passive: ['active', 'holdconn'],
  holdconn: ['holdconn'],
};
