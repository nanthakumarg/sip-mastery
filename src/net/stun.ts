/**
 * STUN messages (RFC 8489) for Module 20: the header, XOR-MAPPED-ADDRESS,
 * MESSAGE-INTEGRITY (HMAC-SHA1 with a short-term password), and FINGERPRINT.
 * The tests check the output byte for byte against RFC 5769.
 */
import type { Addr } from './nat.ts';

export const MAGIC_COOKIE = 0x2112a442;

export const ATTR = {
  MAPPED_ADDRESS: 0x0001,
  USERNAME: 0x0006,
  MESSAGE_INTEGRITY: 0x0008,
  XOR_MAPPED_ADDRESS: 0x0020,
  PRIORITY: 0x0024,
  USE_CANDIDATE: 0x0025,
  SOFTWARE: 0x8022,
  FINGERPRINT: 0x8028,
  ICE_CONTROLLED: 0x8029,
  ICE_CONTROLLING: 0x802a,
} as const;

export type StunClass = 'request' | 'indication' | 'success' | 'error';
const CLASS_BITS: Record<StunClass, number> = { request: 0, indication: 1, success: 2, error: 3 };

export const BINDING = 0x001;

/** RFC 8489 §5: the class bits C1 and C0 sit at bits 8 and 4 of the type, between the method bits. */
export function messageType(method: number, cls: StunClass): number {
  const c = CLASS_BITS[cls];
  return (method & 0x000f) | ((method & 0x0070) << 1) | ((method & 0x0f80) << 2) | ((c & 1) << 4) | ((c & 2) << 7);
}

export function classOf(type: number): StunClass {
  const c = ((type >> 4) & 1) | ((type >> 7) & 2);
  return (Object.keys(CLASS_BITS) as StunClass[]).find(k => CLASS_BITS[k] === c)!;
}

export interface StunAttr { type: number; value: Uint8Array }
export interface StunMessage { method: number; cls: StunClass; txId: Uint8Array; attrs: StunAttr[] }

const u16 = (n: number) => [(n >> 8) & 255, n & 255];
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const ipBytes = (ip: string) => ip.split('.').map(Number);

/** RFC 8489 §14.2: the port XOR the top 16 bits of the magic cookie, the IPv4 address XOR the cookie. */
export function xorAddress(a: Addr): Uint8Array {
  const c = u32(MAGIC_COOKIE);
  return new Uint8Array([0, 0x01, ...u16(a.port ^ (MAGIC_COOKIE >>> 16)), ...ipBytes(a.ip).map((b, i) => b ^ c[i]!)]);
}

export function readXorAddress(v: Uint8Array): Addr {
  const c = u32(MAGIC_COOKIE);
  const port = ((v[2]! << 8) | v[3]!) ^ (MAGIC_COOKIE >>> 16);
  return { ip: [0, 1, 2, 3].map(i => v[4 + i]! ^ c[i]!).join('.'), port };
}

export const textAttr = (type: number, s: string): StunAttr => ({ type, value: new TextEncoder().encode(s) });
export const u32Attr = (type: number, n: number): StunAttr => ({ type, value: new Uint8Array(u32(n)) });

/** CRC-32 (ISO HDLC, as in zlib), used by FINGERPRINT. */
export function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (const x of b) {
    c ^= x;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Encodes a STUN message. With `password`, adds MESSAGE-INTEGRITY: an
 * HMAC-SHA1 over the message so far, with the length field already counting
 * the attribute (§14.5). With `fingerprint`, adds FINGERPRINT: CRC-32 XOR
 * 0x5354554e (§14.7). `pad` is the padding byte (RFC 5769 uses spaces).
 */
export async function encodeStun(m: StunMessage, opts: { password?: string; fingerprint?: boolean; pad?: number } = {}): Promise<Uint8Array> {
  const body: number[] = [];
  for (const a of m.attrs) {
    body.push(...u16(a.type), ...u16(a.value.length), ...a.value);
    while (body.length % 4) body.push(opts.pad ?? 0);
  }
  const header = (len: number) => [...u16(messageType(m.method, m.cls)), ...u16(len), ...u32(MAGIC_COOKIE), ...m.txId];
  if (opts.password !== undefined) {
    const data = new Uint8Array([...header(body.length + 24), ...body]);
    const key = await globalThis.crypto.subtle.importKey('raw', new TextEncoder().encode(opts.password), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
    const mac = new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', key, data));
    body.push(...u16(ATTR.MESSAGE_INTEGRITY), ...u16(20), ...mac);
  }
  if (opts.fingerprint) {
    const crc = crc32(new Uint8Array([...header(body.length + 8), ...body])) ^ 0x5354554e;
    body.push(...u16(ATTR.FINGERPRINT), ...u16(4), ...u32(crc >>> 0));
  }
  return new Uint8Array([...header(body.length), ...body]);
}

export type Decoded = StunMessage | { error: string };

export function decodeStun(b: Uint8Array): Decoded {
  if (b.length < 20) return { error: 'Shorter than the 20-byte STUN header' };
  if (b[0]! & 0xc0) return { error: 'The first two bits are not zero: not STUN (RTP starts with 10)' };
  const type = (b[0]! << 8) | b[1]!;
  const len = (b[2]! << 8) | b[3]!;
  const cookie = ((b[4]! << 24) | (b[5]! << 16) | (b[6]! << 8) | b[7]!) >>> 0;
  if (cookie !== MAGIC_COOKIE) return { error: 'No magic cookie (0x2112A442)' };
  if (len + 20 !== b.length) return { error: `The length field says ${len} bytes after the header, but there are ${b.length - 20}` };
  const attrs: StunAttr[] = [];
  for (let i = 20; i + 4 <= b.length;) {
    const t = (b[i]! << 8) | b[i + 1]!;
    const l = (b[i + 2]! << 8) | b[i + 3]!;
    attrs.push({ type: t, value: b.slice(i + 4, i + 4 + l) });
    i += 4 + Math.ceil(l / 4) * 4;
  }
  const method = (type & 0x000f) | ((type >> 1) & 0x0070) | ((type >> 2) & 0x0f80);
  return { method, cls: classOf(type), txId: b.slice(8, 20), attrs };
}
