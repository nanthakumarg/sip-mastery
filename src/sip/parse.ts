/**
 * SIP message parser.
 *
 * Pure TypeScript with no DOM or Node APIs, so the same code runs in the
 * browser (message inspector) and at build time (flow checks).
 */

export interface SipHeader {
  /** Header name as written on the wire, e.g. "v" or "Via". */
  raw: string;
  /** Canonical long-form name, e.g. "Via". */
  name: string;
  value: string;
  /** Zero-based line index inside the message (0 is the start line). */
  line: number;
}

export interface SipMessage {
  kind: 'request' | 'response';
  method?: string;
  requestUri?: string;
  status?: number;
  reason?: string;
  version: string;
  startLine: string;
  headers: SipHeader[];
  body: string;
  /** Every line of the message (without CRLF), in order. */
  lines: string[];
  /** Line index of the empty line between headers and body. */
  blankLine: number;
}

export class SipParseError extends Error {}

/** Compact forms: RFC 3261 §7.3.3, plus the extensions in the IANA SIP header registry. */
export const COMPACT: Record<string, string> = {
  i: 'Call-ID', m: 'Contact', e: 'Content-Encoding', l: 'Content-Length',
  c: 'Content-Type', f: 'From', s: 'Subject', k: 'Supported', t: 'To', v: 'Via',
  o: 'Event', r: 'Refer-To', b: 'Referred-By', u: 'Allow-Events', x: 'Session-Expires',
  a: 'Accept-Contact', j: 'Reject-Contact', d: 'Request-Disposition', y: 'Identity',
};

/** Canonical spelling for headers whose usual case is not simple Title-Case. */
const CANONICAL: Record<string, string> = {
  'call-id': 'Call-ID', cseq: 'CSeq', 'www-authenticate': 'WWW-Authenticate',
  'rack': 'RAck', 'rseq': 'RSeq', 'mime-version': 'MIME-Version',
  'p-asserted-identity': 'P-Asserted-Identity', 'p-preferred-identity': 'P-Preferred-Identity',
  'min-se': 'Min-SE', 'sip-etag': 'SIP-ETag', 'sip-if-match': 'SIP-If-Match',
};

export function canonicalHeaderName(raw: string): string {
  const lower = raw.trim().toLowerCase();
  if (COMPACT[lower]) return COMPACT[lower];
  if (CANONICAL[lower]) return CANONICAL[lower];
  return lower.replace(/(^|-)([a-z])/g, (_, d: string, ch: string) => d + ch.toUpperCase());
}

/** Splits a raw message into lines, accepting CRLF or LF. */
function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').split('\n');
}

export function parseMessage(text: string): SipMessage {
  const lines = splitLines(text);
  const startLine = lines[0] ?? '';
  const msg: SipMessage = {
    kind: 'request', version: '', startLine, headers: [], body: '', lines, blankLine: -1,
  };

  const resp = /^(SIP\/\d\.\d) (\d{3}) ?(.*)$/.exec(startLine);
  const req = /^([A-Z]+) (\S+) (SIP\/\d\.\d)$/.exec(startLine);
  if (resp) {
    msg.kind = 'response';
    msg.version = resp[1]!;
    msg.status = Number(resp[2]);
    msg.reason = resp[3] ?? '';
  } else if (req) {
    msg.kind = 'request';
    msg.method = req[1]!;
    msg.requestUri = req[2]!;
    msg.version = req[3]!;
  } else {
    throw new SipParseError(`Not a SIP start line: "${startLine}"`);
  }

  let i = 1;
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    if (line === '') break;
    if (/^[ \t]/.test(line)) {
      // Header folding (RFC 3261 §7.3.1): continue the previous header.
      const prev = msg.headers[msg.headers.length - 1];
      if (!prev) throw new SipParseError(`Line ${i + 1}: continuation line with no header`);
      prev.value += ' ' + line.trim();
      continue;
    }
    const colon = line.indexOf(':');
    if (colon <= 0) throw new SipParseError(`Line ${i + 1}: header has no ":" ("${line}")`);
    const raw = line.slice(0, colon).trim();
    msg.headers.push({ raw, name: canonicalHeaderName(raw), value: line.slice(colon + 1).trim(), line: i });
  }
  msg.blankLine = i < lines.length ? i : -1;
  msg.body = i < lines.length ? lines.slice(i + 1).join('\r\n') : '';
  return msg;
}

/* ------------------------------------------------------------------ */
/* Header access helpers                                               */
/* ------------------------------------------------------------------ */

export function getHeaders(msg: SipMessage, name: string): SipHeader[] {
  const want = canonicalHeaderName(name);
  return msg.headers.filter(h => h.name === want);
}

export function getHeader(msg: SipMessage, name: string): string | undefined {
  return getHeaders(msg, name)[0]?.value;
}

/** Reads a ";name=value" parameter from a header value (outside the <URI>). */
export function headerParam(value: string | undefined, param: string): string | undefined {
  if (!value) return undefined;
  const outside = value.replace(/<[^>]*>/g, '<>');
  const re = new RegExp(`;\\s*${param}\\s*=\\s*("([^"]*)"|[^;,\\s]+)`, 'i');
  const m = re.exec(outside);
  if (!m) return undefined;
  return m[2] ?? m[1];
}

export interface Via { transport: string; sentBy: string; branch?: string }

export function topVia(msg: SipMessage): Via | undefined {
  const v = getHeader(msg, 'Via');
  if (!v) return undefined;
  const first = v.split(',')[0]!.trim();
  const m = /^SIP\/2\.0\/(\S+)\s+([^;]+)/i.exec(first);
  if (!m) return undefined;
  return { transport: m[1]!.toUpperCase(), sentBy: m[2]!.trim(), branch: headerParam(first, 'branch') };
}

export interface CSeq { seq: number; method: string }

export function cseq(msg: SipMessage): CSeq | undefined {
  const v = getHeader(msg, 'CSeq');
  const m = v ? /^(\d+)\s+([A-Z]+)$/.exec(v) : null;
  return m ? { seq: Number(m[1]), method: m[2]! } : undefined;
}

export const tagOf = (msg: SipMessage, name: 'From' | 'To') => headerParam(getHeader(msg, name), 'tag');

/** Parses `Digest a=b, c="d"` into a map. Keys are lower case. */
export function parseAuthParams(value: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!value) return out;
  const body = value.replace(/^\s*\w+\s+/, '');
  const re = /([\w-]+)\s*=\s*("([^"]*)"|[^,\s]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) out[m[1]!.toLowerCase()] = m[3] ?? m[2]!;
  return out;
}

/** UTF-8 byte length (Content-Length counts octets, RFC 3261 §20.14). */
export function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

export function isRequest(msg: SipMessage, method?: string): boolean {
  return msg.kind === 'request' && (method === undefined || msg.method === method);
}

export function isResponse(msg: SipMessage, cls?: number): boolean {
  return msg.kind === 'response' && (cls === undefined || Math.floor(msg.status! / 100) === cls);
}
