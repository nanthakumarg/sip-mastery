/**
 * Digest response calculation (RFC 3261 §22.4, RFC 7616 §3.4.1, RFC 8760).
 * Returns every intermediate value so the calculator can show each step.
 */
import SparkMD5 from 'spark-md5';

export type DigestAlgorithm = 'MD5' | 'SHA-256';

export interface DigestInput {
  algorithm: DigestAlgorithm;
  username: string;
  realm: string;
  password: string;
  method: string;
  uri: string;
  nonce: string;
  /** Empty string means no qop (the RFC 2069 compatible form). */
  qop: '' | 'auth';
  nc: string;
  cnonce: string;
}

export interface DigestSteps {
  ha1Input: string;
  ha1: string;
  ha2Input: string;
  ha2: string;
  responseInput: string;
  response: string;
}

async function hash(algorithm: DigestAlgorithm, text: string): Promise<string> {
  if (algorithm === 'MD5') return SparkMD5.hash(text);
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function computeDigest(d: DigestInput): Promise<DigestSteps> {
  const ha1Input = `${d.username}:${d.realm}:${d.password}`;
  const ha1 = await hash(d.algorithm, ha1Input);
  const ha2Input = `${d.method}:${d.uri}`;
  const ha2 = await hash(d.algorithm, ha2Input);
  const responseInput = d.qop
    ? `${ha1}:${d.nonce}:${d.nc}:${d.cnonce}:${d.qop}:${ha2}`
    : `${ha1}:${d.nonce}:${ha2}`;
  const response = await hash(d.algorithm, responseInput);
  return { ha1Input, ha1, ha2Input, ha2, responseInput, response };
}
