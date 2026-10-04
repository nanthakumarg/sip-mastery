/**
 * TLS server certificate check for SIP (Module 14), as RFC 5922 §7 defines it:
 * which SIP domain identities a certificate holds (§7.1), how they are compared
 * (§7.2), and whether a client accepts the server for the domain of the URI it
 * resolved (§7.3). The diagram is src/diagrams/CertCheck.tsx.
 */

export interface Certificate {
  /** Signed by a CA that the client trusts, and not expired or revoked (RFC 5280). */
  valid: boolean;
  /** subjectAltName values, written as "URI:sip:biloxi.example" or "DNS:biloxi.example". */
  san: string[];
  /** Common Name in the Subject field. */
  cn?: string;
}

export type ValueVerdict = 'identity' | 'not-sip' | 'user-part' | 'dns-ignored' | 'cn-ignored';

export interface CheckedValue {
  value: string;
  verdict: ValueVerdict;
  /** The DNS name this value gives, when it is an identity. */
  identity?: string;
  /** Quote id of the rule. */
  rule: string;
}

export interface CertResult {
  /** The client authenticates the server for the domain. */
  ok: boolean;
  domain: string;
  values: CheckedValue[];
  identities: string[];
  /** Why the check failed or passed, in one sentence. */
  reason: string;
  rule: string;
  /** The identity that matched. */
  matched?: string;
}

const lower = (s: string) => s.trim().toLowerCase();

/** RFC 5922 §7.1: the SIP domain identities in a certificate. */
export function sipIdentities(cert: Certificate): { values: CheckedValue[]; identities: string[] } {
  const values: CheckedValue[] = [];
  const uriIds: string[] = [];
  const dns: { value: string; name: string }[] = [];
  for (const raw of cert.san) {
    const m = /^(URI|DNS):(.*)$/i.exec(raw.trim());
    if (!m) continue;
    const [, type, v] = m;
    if (type!.toUpperCase() === 'DNS') { dns.push({ value: raw, name: lower(v!) }); continue; }
    const u = /^([a-z][a-z0-9+.-]*):(.*)$/i.exec(v!.trim());
    if (!u || lower(u[1]!) !== 'sip') { values.push({ value: raw, verdict: 'not-sip', rule: 'rfc5922-7.1-uri' }); continue; }
    if (u[2]!.includes('@')) { values.push({ value: raw, verdict: 'user-part', rule: 'rfc5922-7.1-userpart' }); continue; }
    const host = lower(u[2]!.split(/[;:?]/)[0]!);
    uriIds.push(host);
    values.push({ value: raw, verdict: 'identity', identity: host, rule: 'rfc5922-7.1-uri' });
  }
  // DNS names count only when no sip URI identity is present.
  for (const d of dns) {
    values.push(uriIds.length
      ? { value: d.value, verdict: 'dns-ignored', rule: 'rfc5922-7.1-dns' }
      : { value: d.value, verdict: 'identity', identity: d.name, rule: 'rfc5922-7.1-dns' });
  }
  const sanIds = values.filter(v => v.identity).map(v => v.identity!);
  // The CN only when there is no subjectAltName at all.
  if (cert.cn !== undefined) {
    values.push(cert.san.length
      ? { value: `CN=${cert.cn}`, verdict: 'cn-ignored', rule: 'rfc5922-7.1-cn' }
      : { value: `CN=${cert.cn}`, verdict: 'identity', identity: lower(cert.cn), rule: 'rfc5922-7.1-cn' });
  }
  const identities = cert.san.length ? sanIds : cert.cn !== undefined ? [lower(cert.cn)] : [];
  return { values, identities };
}

/** RFC 5922 §7.2: whole DNS names, case-insensitive, no suffixes, no wildcards. */
export const sameDomain = (a: string, b: string) => lower(a) === lower(b);

/**
 * RFC 5922 §7.3: the client compares the domain of the URI it resolved (the AUS),
 * not the host name from SRV, with the identities in the certificate.
 */
export function checkServer(uri: string, cert: Certificate): CertResult {
  const domain = lower(uri.replace(/^sips?:/i, '').split(/[;?]/)[0]!.split('@').pop()!.split(':')[0]!);
  const { values, identities } = sipIdentities(cert);
  if (!cert.valid) {
    return { ok: false, domain, values, identities, reason: 'The certificate does not validate: the client does not trust its CA, or it has expired. The client closes the connection.', rule: 'rfc5922-7.1-validity' };
  }
  if (!identities.length) {
    return { ok: false, domain, values, identities, reason: 'The certificate holds no SIP domain identity, so the server is not authenticated.', rule: 'rfc5922-7.3-client' };
  }
  const matched = identities.find(i => sameDomain(i, domain));
  if (matched) return { ok: true, domain, values, identities, matched, reason: `The certificate names ${domain}, the domain of the URI. The server is authenticated for ${domain}.`, rule: 'rfc5922-7.3-client' };
  const wild = identities.find(i => i.startsWith('*.') || i.startsWith('.'));
  const suffix = identities.find(i => i.endsWith(`.${domain}`) || domain.endsWith(`.${i}`));
  return {
    ok: false, domain, values, identities,
    reason: wild ? `${wild} is a wildcard. SIP does not match wildcards, so it does not cover ${domain}.`
      : suffix ? `${suffix} is not ${domain}. SIP compares whole names: a host in the domain is not the domain.`
        : `None of ${identities.join(', ')} is ${domain}. The client closes the connection.`,
    rule: 'rfc5922-7.2-whole',
  };
}

/** Example certificates for the diagram, for a client that resolved sips:bob@biloxi.example. */
export const CERT_EXAMPLES: { id: string; label: string; cert: Certificate; note: string }[] = [
  { id: 'good', label: 'SIP URI of the domain', cert: { valid: true, san: ['URI:sip:biloxi.example', 'DNS:sip1.biloxi.example'], cn: 'sip1.biloxi.example' }, note: 'What RFC 5922 asks for: the SIP domain as a sip URI in subjectAltName.' },
  { id: 'dns', label: 'DNS name of the domain', cert: { valid: true, san: ['DNS:biloxi.example', 'DNS:sip1.biloxi.example'] }, note: 'A web-style certificate. With no sip URI in it, DNS names count.' },
  { id: 'host', label: 'Only the host name', cert: { valid: true, san: ['DNS:sip1.biloxi.example'] }, note: 'The client found sip1 through SRV, but it checks the domain of the URI.' },
  { id: 'wild', label: 'Wildcard', cert: { valid: true, san: ['DNS:*.biloxi.example'] }, note: 'Accepted by browsers for HTTPS; not by SIP.' },
  { id: 'user', label: 'A user, not a domain', cert: { valid: true, san: ['URI:sip:bob@biloxi.example'] }, note: 'A sip URI with a user part names a person.' },
  { id: 'cn', label: 'Only a Common Name', cert: { valid: true, san: [], cn: 'biloxi.example' }, note: 'An old certificate with no subjectAltName.' },
  { id: 'self', label: 'Self-signed', cert: { valid: false, san: ['URI:sip:biloxi.example'] }, note: 'The right name, but no CA that the client trusts signed it.' },
];
