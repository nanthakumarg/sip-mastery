/**
 * SIP, SIPS, and tel URI dissector (Module 3.6).
 *
 * Splits a URI — or a header value with a display name and angle brackets —
 * into labelled parts with their character offsets, and lists notes about
 * what the URI means and what is wrong with it. Pure TypeScript, no DOM.
 *
 * RFC 3261 §19.1.1 (SIP and SIPS URI components), §19.1.4 (comparison),
 * §20.10 (angle brackets), RFC 3966 (tel URI), RFC 5630 (SIPS).
 */
import { classify } from '../net/address.ts';

export type UriPartKind =
  | 'display' | 'scheme' | 'user' | 'password' | 'host' | 'port'
  | 'uri-param' | 'uri-header' | 'header-param' | 'number' | 'tel-param' | 'sep';

export interface UriPart {
  kind: UriPartKind;
  text: string;
  /** Offset of the first character in the input. */
  start: number;
  /** Parameter or header name, for parameters and URI headers. */
  name?: string;
  value?: string;
}

export interface UriNote {
  level: 'info' | 'warn' | 'error';
  text: string;
  /** Id of an RFC quote in rfc-quotes.yaml that backs the note. */
  quote?: string;
}

export interface Dissection {
  input: string;
  scheme?: 'sip' | 'sips' | 'tel';
  /** name-addr: display name and/or angle brackets, as in a To, From, or Contact header. */
  nameAddr: boolean;
  parts: UriPart[];
  notes: UriNote[];
  /** A guess at the role of the URI: an AOR, a Contact, a proxy in a route set, or a phone number. */
  role?: 'aor' | 'contact' | 'route' | 'phone' | 'server';
}

export const PART_LABEL: Record<UriPartKind, string> = {
  display: 'display name',
  scheme: 'scheme',
  user: 'user',
  password: 'password',
  host: 'host',
  port: 'port',
  'uri-param': 'URI parameter',
  'uri-header': 'URI header',
  'header-param': 'header parameter',
  number: 'phone number',
  'tel-param': 'tel parameter',
  sep: '',
};

/** True for the parts that RFC 3261 §19.1.4 compares case-sensitively. */
export const caseSensitive = (k: UriPartKind) => k === 'user' || k === 'password' || k === 'number';

/** Meaning of well-known parameters. */
export const PARAM_TEXT: Record<string, string> = {
  transport: 'The transport to use for this hop: udp, tcp, tls, sctp, or ws/wss.',
  user: 'user=phone says that the user part is a telephone number.',
  lr: 'Loose routing. A proxy puts this URI in Record-Route; it marks an RFC 3261 router (Module 10).',
  maddr: 'Overrides the host with another server address. Its use for routing is discouraged; use Route instead.',
  ttl: 'Time to live for UDP multicast. Only valid together with a multicast maddr.',
  method: 'The method of the request to build from this URI, for example on a web page.',
  ob: 'SIP Outbound (RFC 5626): the flow from this user agent must be kept open.',
  gr: 'GRUU (RFC 5627): this URI reaches one specific device, not every device of the user.',
  tag: 'The tag of one side of a dialog (Module 9). It belongs to the header, not to the URI.',
  expires: 'How long, in seconds, this registration or Contact is valid (Module 12).',
  q: 'Preference among several Contacts, from 0 to 1. Higher values are tried first.',
  'phone-context': 'The scope where a local number is valid: a domain or a global number prefix.',
  ext: 'A phone extension behind the number.',
  isub: 'An ISDN subaddress.',
  '+sip.instance': 'A unique and permanent id of the device (RFC 5626).',
  'reg-id': 'Which of several registration flows of the same device this is (RFC 5626).',
};

const isIp = (h: string) => /^\[[0-9a-fA-F:.]+\]$/.test(h) || /^\d{1,3}(\.\d{1,3}){3}$/.test(h);
const looksLikePhone = (u: string) => /^\+?[\d\-.()]{5,}$/.test(u) && /\d{5,}/.test(u.replace(/[^\d]/g, ''));

export function dissect(raw: string): Dissection {
  const input = raw.trim();
  const parts: UriPart[] = [];
  const notes: UriNote[] = [];
  const d: Dissection = { input, nameAddr: false, parts, notes };
  if (!input) {
    notes.push({ level: 'error', text: 'Type a URI, for example sip:alice@atlanta.example.' });
    return d;
  }
  const push = (kind: UriPartKind, text: string, start: number, extra: Partial<UriPart> = {}) => {
    if (text) parts.push({ kind, text, start, ...extra });
  };

  // name-addr: [display-name] "<" URI ">" *( ";" header-param )
  let uri = input;
  let base = 0;
  let after = '';
  let afterAt = 0;
  const lt = input.indexOf('<');
  if (lt >= 0) {
    const gt = input.indexOf('>', lt);
    if (gt < 0) {
      notes.push({ level: 'error', text: 'There is a "<" but no ">". The angle brackets must enclose the whole URI.' });
      return d;
    }
    d.nameAddr = true;
    const display = input.slice(0, lt);
    if (display.trim()) push('display', display.trimEnd(), 0);
    push('sep', '<', lt);
    uri = input.slice(lt + 1, gt);
    base = lt + 1;
    after = input.slice(gt + 1);
    afterAt = gt + 1;
  }

  const colon = uri.indexOf(':');
  const scheme = colon > 0 ? uri.slice(0, colon).toLowerCase() : '';
  if (scheme !== 'sip' && scheme !== 'sips' && scheme !== 'tel') {
    notes.push({
      level: 'error',
      text: colon > 0
        ? `"${uri.slice(0, colon)}" is not a scheme this tool reads. SIP uses sip:, sips:, and tel: (and sometimes others, such as urn:).`
        : 'A URI starts with a scheme, such as sip:, sips:, or tel:.',
    });
    return d;
  }
  d.scheme = scheme;
  push('scheme', uri.slice(0, colon), base);
  push('sep', ':', base + colon);

  if (scheme === 'tel') dissectTel(uri.slice(colon + 1), base + colon + 1, d, push);
  else dissectSip(uri.slice(colon + 1), base + colon + 1, d, push);

  if (d.nameAddr) {
    push('sep', '>', afterAt - 1);
    let at = afterAt;
    for (const seg of after.split(';').slice(1)) {
      at = input.indexOf(';', at);
      push('sep', ';', at);
      const [name, value] = splitParam(seg);
      push('header-param', seg, at + 1, { name, value });
      at += seg.length + 1;
      if (name === 'tag') notes.push({ level: 'info', text: 'tag is a header parameter: it sits outside the angle brackets, so it belongs to the To or From header, not to the URI.' });
    }
  } else if (parts.some(p => p.kind === 'uri-param')) {
    notes.push({
      level: 'info',
      text: 'There are no angle brackets. In a To, From, or Contact header, every ";parameter" here would belong to the header, not to the URI (Module 4).',
    });
  }

  if (scheme !== 'tel' && !notes.some(n => n.level === 'error')) d.role = guessRole(d);
  return d;
}

type Push = (kind: UriPartKind, text: string, start: number, extra?: Partial<UriPart>) => void;

function splitParam(seg: string): [string, string | undefined] {
  const eq = seg.indexOf('=');
  return eq < 0 ? [seg.toLowerCase(), undefined] : [seg.slice(0, eq).toLowerCase(), seg.slice(eq + 1)];
}

function dissectSip(rest: string, at: number, d: Dissection, push: Push) {
  const { notes } = d;
  const q = rest.indexOf('?');
  const main = q >= 0 ? rest.slice(0, q) : rest;
  const headers = q >= 0 ? rest.slice(q + 1) : '';

  // userinfo "@"
  const atSign = main.lastIndexOf('@');
  let hostPart = main;
  let hostAt = at;
  if (atSign >= 0) {
    const userinfo = main.slice(0, atSign);
    const pc = userinfo.indexOf(':');
    const user = pc >= 0 ? userinfo.slice(0, pc) : userinfo;
    if (!user) notes.push({ level: 'error', text: 'There is an @ sign, so the user part must not be empty.' });
    push('user', user, at);
    if (pc >= 0) {
      push('sep', ':', at + pc);
      push('password', userinfo.slice(pc + 1), at + pc + 1);
      notes.push({ level: 'warn', text: 'This URI contains a password. Anyone who sees the message can read it.', quote: 'rfc3261-19.1.1-password' });
    }
    push('sep', '@', at + atSign);
    hostPart = main.slice(atSign + 1);
    hostAt = at + atSign + 1;
    if (looksLikePhone(user) && !/;user=phone/i.test(main)) {
      notes.push({ level: 'info', text: 'The user part looks like a phone number. Add ;user=phone to say that it is one.', quote: 'rfc3261-19.1.1-user-phone' });
    }
  } else {
    notes.push({ level: 'info', text: 'No user part: this URI names a server or a domain, not a user.' });
  }

  // host [":" port] *( ";" uri-param )
  const semi = hostPart.indexOf(';');
  const hostport = semi >= 0 ? hostPart.slice(0, semi) : hostPart;
  let host = hostport;
  let port = '';
  if (hostport.startsWith('[')) {
    const close = hostport.indexOf(']');
    host = close >= 0 ? hostport.slice(0, close + 1) : hostport;
    port = close >= 0 && hostport[close + 1] === ':' ? hostport.slice(close + 2) : '';
    if (close < 0) notes.push({ level: 'error', text: 'An IPv6 address must be closed with "]".' });
  } else {
    const pc = hostport.lastIndexOf(':');
    if (pc >= 0) { host = hostport.slice(0, pc); port = hostport.slice(pc + 1); }
  }
  if (!host) notes.push({ level: 'error', text: 'The host is missing. Every SIP URI needs a host: a domain name or an IP address.' });
  push('host', host, hostAt);
  if (hostport.length > host.length) {
    push('sep', ':', hostAt + host.length);
    push('port', port, hostAt + host.length + 1);
    if (!/^\d+$/.test(port) || Number(port) > 65535) notes.push({ level: 'error', text: `"${port}" is not a valid port. A port is a number from 1 to 65535.` });
  }

  if (host && isIp(host)) {
    const c = classify(host.replace(/^\[|\]$/g, ''));
    notes.push({ level: 'info', text: 'The host is an IP address. A Contact usually has one; an AOR uses a domain name.' });
    if (['private', 'cgnat', 'loopback', 'link-local', 'ula'].includes(c.kind)) {
      notes.push({ level: 'warn', text: `${host} is a ${c.label.toLowerCase()}. Outside its own network, nobody can reach it (Module 2).` });
    }
  } else if (host && !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.?$/i.test(host)) {
    notes.push({ level: 'error', text: `"${host}" is not a valid host name.` });
  }
  if (!port && host) {
    notes.push({ level: 'info', text: `No port. The sender finds it with DNS (Module 11), or uses ${d.scheme === 'sips' ? '5061' : '5060'}.` });
  }

  // URI parameters
  const seen = new Set<string>();
  let pAt = hostAt + hostport.length;
  if (semi >= 0) {
    for (const seg of hostPart.slice(semi + 1).split(';')) {
      push('sep', ';', pAt);
      const [name, value] = splitParam(seg);
      push('uri-param', seg, pAt + 1, { name, value });
      pAt += seg.length + 1;
      if (seen.has(name)) notes.push({ level: 'error', text: `The parameter "${name}" appears twice. Each URI parameter may appear only once.` });
      seen.add(name);
      const v = value?.toLowerCase();
      if (name === 'transport' && d.scheme === 'sips' && v === 'udp') {
        notes.push({ level: 'error', text: 'A SIPS URI needs a reliable transport (TLS over TCP). transport=udp is not allowed.' });
      }
      if (name === 'transport' && v === 'tls') {
        notes.push({ level: 'warn', text: 'transport=tls is deprecated. Use a sips: URI, or a Via with TLS, instead (RFC 5630).' });
      }
      if (name === 'maddr') notes.push({ level: 'warn', text: 'maddr overrides the host. Using it for routing is discouraged; use a Route header instead.' });
      if (name === 'lr') notes.push({ level: 'info', text: 'lr marks a loose router. This URI is probably a proxy from a Record-Route or Route header (Module 10).' });
      if (!PARAM_TEXT[name]) notes.push({ level: 'info', text: `"${name}" is not a parameter this tool knows. Elements that do not understand it ignore it.`, quote: 'rfc3261-19.1.1-ignore-params' });
    }
  }

  // URI headers
  if (q >= 0) {
    push('sep', '?', at + q);
    let hAt = at + q + 1;
    headers.split('&').forEach((h, i) => {
      if (i > 0) { push('sep', '&', hAt); hAt++; }
      const [name, value] = splitParam(h);
      push('uri-header', h, hAt, { name, value });
      hAt += h.length;
    });
    notes.push({ level: 'info', text: 'Text after "?" becomes header fields of the request built from this URI. It is not allowed in a Request-URI.' });
  }

  if (d.scheme === 'sips') {
    notes.push({ level: 'info', text: 'sips: requires TLS on every hop up to the domain of the URI, not only on the first hop.', quote: 'rfc3261-26.2.2-sips-hops' });
  }
}

function dissectTel(rest: string, at: number, d: Dissection, push: Push) {
  const { notes } = d;
  const semi = rest.indexOf(';');
  const number = semi >= 0 ? rest.slice(0, semi) : rest;
  push('number', number, at);
  d.role = 'phone';
  if (!number) {
    notes.push({ level: 'error', text: 'The phone number is missing.' });
    return;
  }
  const global = number.startsWith('+');
  if (global) {
    if (!/^\+[\d\-.()]+$/.test(number)) notes.push({ level: 'error', text: 'A global number has only digits after the "+", with optional - . ( ) separators.' });
    else notes.push({ level: 'info', text: 'A global number: it starts with "+" and the country code, so it means the same everywhere.', quote: 'rfc3966-5.1.4-global' });
  } else if (!/^[\dA-Fa-f*#\-.()]+$/.test(number)) {
    notes.push({ level: 'error', text: 'A local number has only digits, *, #, the letters A to F, and - . ( ) separators.' });
  }
  if (/[-.()]/.test(number)) {
    notes.push({ level: 'info', text: 'The - . ( ) characters are only visual separators. Elements ignore them when they compare numbers.' });
  }
  let pAt = at + number.length;
  const names = new Set<string>();
  if (semi >= 0) {
    for (const seg of rest.slice(semi + 1).split(';')) {
      push('sep', ';', pAt);
      const [name, value] = splitParam(seg);
      push('tel-param', seg, pAt + 1, { name, value });
      names.add(name);
      pAt += seg.length + 1;
    }
  }
  if (!global && !names.has('phone-context')) {
    notes.push({ level: 'error', text: 'A local number (no "+") must have a phone-context parameter.', quote: 'rfc3966-5.1.5-phone-context' });
  } else if (!global) {
    notes.push({ level: 'info', text: 'A local number. It is valid only inside its phone-context.' });
  }
}

function guessRole(d: Dissection): Dissection['role'] {
  const get = (k: UriPartKind) => d.parts.find(p => p.kind === k);
  const params = d.parts.filter(p => p.kind === 'uri-param').map(p => p.name);
  const host = get('host')?.text ?? '';
  if (params.includes('lr')) return 'route';
  if (!get('user')) return 'server';
  if (params.includes('user') && d.parts.some(p => p.name === 'user' && p.value === 'phone')) return 'phone';
  if (isIp(host) || get('port') || params.some(p => p === 'transport' || p === 'ob' || p === 'gr')) return 'contact';
  return 'aor';
}

export const ROLE_TEXT: Record<NonNullable<Dissection['role']>, string> = {
  aor: 'Looks like an AOR: a user at a domain name, with no port. This is the address people call.',
  contact: 'Looks like a Contact: a specific device, with an IP address or a port. It changes when the device moves.',
  route: 'Looks like a proxy URI from a Record-Route or Route header.',
  phone: 'A telephone number.',
  server: 'Names a server or a domain, not a user.',
};
