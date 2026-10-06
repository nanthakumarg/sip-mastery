/**
 * STIR/SHAKEN (Module 28): PASSporT tokens (RFC 8225, RFC 8588, RFC 8946)
 * in the SIP Identity header (RFC 8224). Deterministic JSON, base64url,
 * the Identity header, a parser, and ES256 signing and verification with
 * Web Crypto, which works the same in the browser and in Node.
 */

export interface PassportHeader { alg: 'ES256'; ppt?: string; typ: 'passport'; x5u: string }
export interface PassportPayload {
  attest?: 'A' | 'B' | 'C';
  dest: { tn: string[] };
  div?: { tn: string };
  iat: number;
  orig: { tn: string };
  origid?: string;
}

/** RFC 8225 §9: no whitespace, keys in lexicographic order, recursively. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as object).sort().filter(k => (v as Record<string, unknown>)[k] !== undefined)
      .map(k => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

const te = new TextEncoder();
const td = new TextDecoder();

export function b64uEncode(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? te.encode(data) : data;
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64uDecode(s: string): Uint8Array<ArrayBuffer> {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(b, c => c.charCodeAt(0));
}

export const b64uJson = (v: unknown) => b64uEncode(canonicalJson(v));

/** The signing input of a JWS: BASE64URL(header) || '.' || BASE64URL(payload). */
export const signingInput = (h: PassportHeader, p: PassportPayload) => `${b64uJson(h)}.${b64uJson(p)}`;

export function identityHeader(jws: string, x5u: string, ppt = 'shaken'): string {
  return `Identity: ${jws};info=<${x5u}>;alg=ES256;ppt=${ppt}`;
}

export interface ParsedIdentity {
  jws: string;
  /** The three parts of the JWS, as sent. */
  parts: [string, string, string];
  header?: PassportHeader;
  payload?: PassportPayload;
  signature: Uint8Array;
  info?: string;
  alg?: string;
  ppt?: string;
  error?: string;
}

/** Splits an Identity header value into the PASSporT and its parameters. */
export function parseIdentity(value: string): ParsedIdentity {
  const v = value.replace(/^Identity:\s*/i, '').trim();
  const [jws = '', ...params] = v.split(';');
  const param = (name: string) => params.map(p => p.trim()).find(p => p.toLowerCase().startsWith(`${name}=`))?.slice(name.length + 1);
  const parts = jws.split('.') as [string, string, string];
  const out: ParsedIdentity = { jws, parts, signature: new Uint8Array(), info: param('info')?.replace(/^<|>$/g, ''), alg: param('alg'), ppt: param('ppt') };
  if (parts.length !== 3) return { ...out, error: 'A PASSporT has three parts, separated by dots.' };
  try {
    out.header = parts[0] ? JSON.parse(td.decode(b64uDecode(parts[0]))) : undefined;
    out.payload = parts[1] ? JSON.parse(td.decode(b64uDecode(parts[1]))) : undefined;
    out.signature = b64uDecode(parts[2]);
  } catch {
    return { ...out, error: 'A part of the PASSporT is not valid base64url JSON.' };
  }
  if (!parts[0] && !parts[1]) out.error = 'This is the compact form: the verifier must rebuild the header and payload from the SIP request. SHAKEN uses the full form.';
  return out;
}

const ALG = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGN = { name: 'ECDSA', hash: 'SHA-256' } as const;

/** ES256 over the signing input; returns the full-form JWS. */
export async function signPassport(h: PassportHeader, p: PassportPayload, privateJwk: JsonWebKey): Promise<string> {
  const key = await crypto.subtle.importKey('jwk', privateJwk, ALG, false, ['sign']);
  const input = signingInput(h, p);
  const sig = new Uint8Array(await crypto.subtle.sign(SIGN, key, te.encode(input)));
  return `${input}.${b64uEncode(sig)}`;
}

/** Checks the ES256 signature of a full-form JWS against the parts as sent. */
export async function verifyJws(jws: string, publicJwk: JsonWebKey): Promise<boolean> {
  const [h, p, s] = jws.split('.');
  if (!h || !p || !s) return false;
  try {
    const key = await crypto.subtle.importKey('jwk', publicJwk, ALG, false, ['verify']);
    return await crypto.subtle.verify(SIGN, key, b64uDecode(s), te.encode(`${h}.${p}`));
  } catch {
    return false;
  }
}

/** RFC 8224 §8.3, simplified: keep the digits of a telephone number. */
export function canonicalTn(s: string): string {
  const m = /\+?(\d[\d\-.() ]{3,})/.exec(s.replace(/^[^<]*</, ''));
  return (m?.[1] ?? '').replace(/\D/g, '');
}

/** What a SHAKEN verification service concludes, and what the called phone shows. */
export type Verstat = 'TN-Validation-Passed' | 'TN-Validation-Failed' | 'No-TN-Validation';

export interface VerifyInput {
  parsed?: ParsedIdentity;
  signatureValid: boolean;
  /** The verifier's clock, in seconds. */
  now: number;
  /** The number in P-Asserted-Identity or From, and in the Request-URI or To. */
  from: string;
  to: string;
  /** The certificate at x5u chains to a trusted STI-CA. */
  certTrusted: boolean;
}

export interface Check { what: string; ok: boolean; text: string }

export const FRESHNESS = 60;

export function verifyChecks(v: VerifyInput): { checks: Check[]; verstat: Verstat } {
  if (!v.parsed) return { checks: [{ what: 'Identity header', ok: false, text: 'There is no Identity header. Nothing to verify.' }], verstat: 'No-TN-Validation' };
  const p = v.parsed.payload, h = v.parsed.header;
  const age = p ? v.now - p.iat : NaN;
  const checks: Check[] = [
    { what: 'ppt', ok: !!v.parsed.ppt && ['shaken', 'div'].includes(v.parsed.ppt) && h?.ppt === v.parsed.ppt,
      text: v.parsed.ppt && ['shaken', 'div'].includes(v.parsed.ppt) ? `ppt=${v.parsed.ppt}: a PASSporT type this verifier supports.` : `ppt=${v.parsed.ppt ?? '(none)'}: a type this verifier does not support.` },
    { what: 'Certificate', ok: v.certTrusted, text: v.certTrusted ? 'The certificate at x5u chains to an STI-CA that the STI-PA approved.' : 'The certificate does not chain to a trusted STI-CA.' },
    { what: 'Freshness', ok: Number.isFinite(age) && age >= -FRESHNESS && age <= FRESHNESS,
      text: Number.isFinite(age) ? `iat is ${age} s old. The limit is ${FRESHNESS} s.` : 'No iat claim.' },
    { what: 'Signature', ok: v.signatureValid, text: v.signatureValid ? 'The ES256 signature matches the header and payload, with the key in the certificate.' : 'The signature does not match: someone changed the header or payload, or signed with another key.' },
    { what: 'orig', ok: !!p && canonicalTn(v.from) === p.orig?.tn, text: p ? `orig.tn is ${p.orig?.tn}; the request says ${canonicalTn(v.from)}.` : 'No payload.' },
    { what: 'dest', ok: !!p && !!p.dest?.tn?.includes(canonicalTn(v.to)), text: p ? `dest.tn is ${p.dest?.tn?.join(', ')}; the call is for ${canonicalTn(v.to)}.` : 'No payload.' },
  ];
  return { checks, verstat: checks.every(c => c.ok) ? 'TN-Validation-Passed' : 'TN-Validation-Failed' };
}

/** What a phone in the USA typically shows, by verstat and attestation. */
export function display(verstat: Verstat, attest?: string): string {
  if (verstat === 'TN-Validation-Failed') return 'The number, marked "Spam risk" or "Unverified", or the call is blocked.';
  if (verstat === 'No-TN-Validation') return 'The number, with no mark. The network could not check it.';
  return attest === 'A' ? 'The number, with a ✓ "Verified caller" mark.' : 'The number, with no mark: the carrier vouched only for the call, not for the number.';
}

// ---------------------------------------------------------------------------
// The calls of Module 28: the numbers, the time, and the PASSporTs signed for them

/** Who makes the call, and so which attestation the originating carrier gives. */
export const CALLERS = {
  A: { tn: '14045550101', label: 'Alice', why: 'Alice is the carrier\'s own customer, authenticated, and the number is hers.' },
  B: { tn: '18885550199', label: 'PBX', why: 'The PBX is an authenticated customer, but the carrier did not assign +1 888 555 0199 to it.' },
  C: { tn: '442071234567', label: 'Carrier gateway', why: 'The call came in from the PSTN, through a gateway: the carrier knows nothing about the caller.' },
} as const;
export type Attest = keyof typeof CALLERS;

export const BOB_TN = '12285550222';
export const CAROL_TN = '12285550333';
export const X5U = 'https://cr.carrier-a.example/sti/2026/passport.pem';
export const X5U_B = 'https://cr.carrier-b.example/sti/2026/passport.pem';
/** The time of the call: Tue, 06 Oct 2026 14:00:00 GMT. */
export const CALL_TIME = Date.UTC(2026, 9, 6, 14, 0, 0) / 1000;
/** A signer whose clock is five minutes slow. */
export const SKEW = 300;
export const ORIGID: Record<Attest, string> = {
  A: '4437c7eb-8f7a-4f0f-a892-ae6a5b2a2a55', B: 'd8c7a6e1-0b2a-4e1d-9c3b-1f7e2a6d8c40', C: '7b1e9f02-5c3d-4a8e-b6f1-0e2d3c4b5a69',
};

export const shakenHeader = (x5u = X5U): PassportHeader => ({ alg: 'ES256', ppt: 'shaken', typ: 'passport', x5u });
export const shakenPayload = (attest: Attest, iat: number): PassportPayload => ({
  attest, dest: { tn: [BOB_TN] }, iat, orig: { tn: CALLERS[attest].tn }, origid: ORIGID[attest],
});
/** Bob forwards the call to Carol; his carrier signs a div PASSporT (RFC 8946). */
export const divHeader = (): PassportHeader => ({ alg: 'ES256', ppt: 'div', typ: 'passport', x5u: X5U_B });
export const divPayload = (iat: number): PassportPayload => ({ dest: { tn: [CAROL_TN] }, div: { tn: BOB_TN }, iat, orig: { tn: CALLERS.A.tn } });

export const httpDate = (t: number) => new Date(t * 1000).toUTCString();
