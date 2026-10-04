/**
 * Registrar model (Module 12): the steps of RFC 3261 §10.3 for one REGISTER,
 * with Path (RFC 3327), Service-Route (RFC 3608), SIP Outbound (RFC 5626 §6),
 * and GRUU (RFC 5627 §5). The location service view (src/diagrams/RegistrarView.tsx)
 * runs it over the REGISTER requests of a flow, and tests/registrar.test.ts
 * checks that every registration flow agrees with it.
 */
import { cseq, getHeader, getHeaders, type SipMessage } from './parse.ts';
import { uriOf } from './dialog.ts';

/** Local policy of the registrar. */
export interface Policy {
  /** Shorter requests get 423 with Min-Expires (only when they are under one hour). */
  minExpires: number;
  /** Longer requests are shortened to this. */
  maxExpires: number;
  /** Used when the request has neither an expires parameter nor an Expires header. */
  defaultExpires: number;
  /** Returned in every 200 OK (RFC 3608). */
  serviceRoute?: string[];
  /** The registrar supports RFC 5626 and is the first hop, or the first Path has ;ob. */
  outbound?: boolean;
  /** The registrar hands out GRUUs (RFC 5627). */
  gruu?: boolean;
}

/** Every quote id that processRegister can give as its rule. */
export const REGISTRAR_RULES = [
  'rfc3261-10.2.1-complete-list', 'rfc3261-10.2.2-star', 'rfc3261-10.2.2-zero', 'rfc3261-10.2.3-fetch', 'rfc3261-10.2.4-refresh',
  'rfc3261-10.3-423', 'rfc3261-10.3-aor', 'rfc3261-10.3-order', 'rfc3261-10.3-shorter', 'rfc3261-10.3-star-400',
  'rfc3327-5.3-store', 'rfc5626-3.2-replace', 'rfc5626-6-one-flow', 'rfc5627-3.2-two-gruus',
];

export const DEFAULT_POLICY: Policy = { minExpires: 60, maxExpires: 3600, defaultExpires: 3600 };

/** One Contact header value: a URI and its header parameters, or "*". */
export interface ContactValue {
  star?: boolean;
  uri: string;
  params: Record<string, string>;
}

export interface Binding {
  aor: string;
  contact: string;
  q?: number;
  /** Absolute time, in seconds, when the binding ends. */
  expiresAt: number;
  callId: string;
  cseq: number;
  instance?: string;
  regId?: string;
  /** Path vector stored with the binding (RFC 3327 §5.3). */
  path: string[];
  pubGruu?: string;
  tempGruu?: string;
}

export interface RegisterRequest {
  at: number;
  requestUri: string;
  aor: string;
  callId: string;
  cseq: number;
  /** undefined: no Contact header (a query). */
  contacts?: ContactValue[];
  expires?: number;
  path: string[];
  supported: string[];
}

export type ActionKind = 'added' | 'refreshed' | 'replaced' | 'removed' | 'expired';

export interface Action {
  kind: ActionKind;
  contact: string;
  /** For "replaced": the Contact that was there before. */
  was?: string;
  /** Requested and granted seconds, for added / refreshed / replaced. */
  asked?: number;
  granted?: number;
}

export interface RegisterResult {
  status: number;
  reason: string;
  minExpires?: number;
  /** All bindings after the request (unchanged when it fails). */
  bindings: Binding[];
  actions: Action[];
  /** The Contact values of the 200 OK. */
  contacts: string[];
  path: string[];
  serviceRoute: string[];
  require: string[];
  /** Quote id of the rule that decided the result. */
  rule: string;
  note: string;
}

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

/** Splits a header value at commas that are outside quotes and <…>. */
export function splitTop(value: string, sep = ','): string[] {
  const out: string[] = [];
  let cur = '';
  let quote = false;
  let angle = false;
  for (const ch of value) {
    if (ch === '"') quote = !quote;
    else if (!quote && ch === '<') angle = true;
    else if (!quote && ch === '>') angle = false;
    if (ch === sep && !quote && !angle) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim()).filter(Boolean);
}

export function parseContact(raw: string): ContactValue {
  const v = raw.trim();
  if (v === '*') return { star: true, uri: '*', params: {} };
  let uri: string;
  let rest: string;
  const lt = v.indexOf('<');
  if (lt >= 0) {
    const gt = v.indexOf('>', lt);
    uri = v.slice(lt + 1, gt).trim();
    rest = v.slice(gt + 1);
  } else {
    const semi = v.indexOf(';');
    uri = (semi < 0 ? v : v.slice(0, semi)).trim();
    rest = semi < 0 ? '' : v.slice(semi);
  }
  const params: Record<string, string> = {};
  for (const p of splitTop(rest, ';')) {
    const eq = p.indexOf('=');
    const name = (eq < 0 ? p : p.slice(0, eq)).trim().toLowerCase();
    const val = eq < 0 ? '' : p.slice(eq + 1).trim().replace(/^"(.*)"$/, '$1');
    params[name] = val;
  }
  return { uri, params };
}

/** The values of one Contact header line. */
export const parseContactHeader = (value: string): ContactValue[] => splitTop(value).map(parseContact);

export function contactsOf(m: SipMessage): ContactValue[] {
  return getHeaders(m, 'Contact').flatMap(h => parseContactHeader(h.value));
}

/** RFC 3261 §10.3 step 5: the AOR without URI parameters. Host and scheme are case-insensitive. */
export function canonicalAor(uri: string): string {
  const bare = uri.split(';')[0]!.split('?')[0]!;
  const at = bare.lastIndexOf('@');
  const colon = bare.indexOf(':');
  const scheme = bare.slice(0, colon).toLowerCase();
  return at < 0 ? `${scheme}:${bare.slice(colon + 1).toLowerCase()}` : `${scheme}:${bare.slice(colon + 1, at)}@${bare.slice(at + 1).toLowerCase()}`;
}

/** URI comparison for Contacts, simplified from RFC 3261 §19.1.4: case-insensitive host, parameters in any order. */
export function sameUri(a: string, b: string): boolean {
  const norm = (u: string) => {
    const [base, ...params] = u.split(';');
    return [canonicalAor(base!), ...params.map(p => p.toLowerCase()).sort()].join(';');
  };
  return norm(a) === norm(b);
}

const hostOf = (uri: string) => uri.replace(/^sips?:/i, '').split(/[;?]/)[0]!.split('@').pop()!.split(':')[0]!.toLowerCase();

export function registerFromMessage(m: SipMessage, at: number): RegisterRequest {
  const hasContact = getHeaders(m, 'Contact').length > 0;
  const exp = getHeader(m, 'Expires');
  return {
    at,
    requestUri: m.requestUri ?? '',
    aor: canonicalAor(uriOf(getHeader(m, 'To'))),
    callId: getHeader(m, 'Call-ID') ?? '',
    cseq: cseq(m)?.seq ?? 0,
    contacts: hasContact ? contactsOf(m) : undefined,
    expires: exp === undefined ? undefined : Number(exp),
    path: getHeaders(m, 'Path').flatMap(h => splitTop(h.value)),
    supported: getHeaders(m, 'Supported').flatMap(h => h.value.split(',')).map(s => s.trim().toLowerCase()),
  };
}

/* ------------------------------------------------------------------ */
/* Processing                                                          */
/* ------------------------------------------------------------------ */

/** Removes the bindings whose time has run out (RFC 3261 §10.2.2: registrations are soft state). */
export function expireBindings(bindings: Binding[], now: number): { live: Binding[]; expired: Binding[] } {
  return { live: bindings.filter(b => b.expiresAt > now), expired: bindings.filter(b => b.expiresAt <= now) };
}

/** A qvalue as people write it: 1.0, 0.5, 0.75. */
export const formatQ = (q: number) => (Number.isInteger(q) ? q.toFixed(1) : String(q));

const remaining = (b: Binding, now: number) => Math.max(0, Math.round(b.expiresAt - now));

/** A stable, opaque temporary GRUU for one REGISTER (RFC 5627 §3.1.2: it hides the AOR). */
function tempGruu(b: { aor: string; instance?: string }, callId: string, seq: number): string {
  let h = 2166136261;
  for (const ch of `${b.aor}|${b.instance}|${callId}|${seq}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return `sip:tgruu.${h.toString(36)}@${hostOf(b.aor)};gr`;
}

/** The Contact value that a 200 OK lists for one binding (RFC 3261 §10.3 step 8, RFC 5627 §5.2). */
export function contactValue(b: Binding, now: number, gruu = false): string {
  let v = `<${b.contact}>`;
  if (b.q !== undefined) v += `;q=${formatQ(b.q)}`;
  if (b.instance) v += `;+sip.instance="${b.instance}"`;
  if (b.regId) v += `;reg-id=${b.regId}`;
  if (gruu && b.pubGruu) v += `;pub-gruu="${b.pubGruu}"`;
  if (gruu && b.tempGruu) v += `;temp-gruu="${b.tempGruu}"`;
  return `${v};expires=${remaining(b, now)}`;
}

function fail(status: number, reason: string, bindings: Binding[], actions: Action[], rule: string, note: string, extra: Partial<RegisterResult> = {}): RegisterResult {
  return { status, reason, bindings, actions, contacts: [], path: [], serviceRoute: [], require: [], rule, note, ...extra };
}

/**
 * Processes one REGISTER at time `req.at`. `bindings` may hold several AORs;
 * only those of the request's AOR change. Expired bindings are removed first.
 */
export function processRegister(bindings: Binding[], req: RegisterRequest, policy: Policy = DEFAULT_POLICY): RegisterResult {
  const now = req.at;
  const { live, expired } = expireBindings(bindings, now);
  const expiredActions: Action[] = expired.filter(b => b.aor === req.aor).map(b => ({ kind: 'expired', contact: b.contact }));
  const before = live;
  const mine = live.filter(b => b.aor === req.aor);
  const others = live.filter(b => b.aor !== req.aor);

  // Step 5: the AOR must belong to the domain of the Request-URI.
  if (hostOf(req.aor) !== hostOf(req.requestUri)) {
    return fail(404, 'Not Found', before, expiredActions, 'rfc3261-10.3-aor', `The AOR ${req.aor} is not in the domain of ${req.requestUri}.`);
  }

  const gruu = !!policy.gruu && req.supported.includes('gruu');
  const ok = (next: Binding[], actions: Action[], rule: string, note: string, outbound: boolean): RegisterResult => {
    const aorBindings = next.filter(b => b.aor === req.aor);
    return {
      status: 200, reason: 'OK', bindings: next, actions: [...expiredActions, ...actions],
      contacts: aorBindings.map(b => contactValue(b, now, gruu)),
      path: req.contacts && req.path.length ? req.path : [],
      serviceRoute: policy.serviceRoute ?? [],
      require: outbound ? ['outbound'] : [],
      rule, note,
    };
  };

  // Step 6, no Contact: a query. The bindings stay as they are.
  if (!req.contacts) {
    const n = mine.length;
    return ok(before, [], 'rfc3261-10.2.3-fetch', n
      ? `No Contact header: nothing changes. The 200 OK lists the ${n === 1 ? 'binding' : `${n} bindings`} with the time left.`
      : 'No Contact header: nothing changes. There are no bindings to list.', false);
  }

  // Step 6, "*": only with Expires: 0, and alone.
  if (req.contacts.some(c => c.star)) {
    if (req.contacts.length > 1 || req.expires !== 0) {
      return fail(400, 'Bad Request', before, expiredActions, 'rfc3261-10.3-star-400',
        req.expires === undefined ? 'Contact: * without Expires: 0. The registrar rejects the request and keeps every binding.'
          : req.contacts.length > 1 ? 'Contact: * with other Contact values. The registrar rejects the request.'
            : `Contact: * with Expires: ${req.expires}. Only Expires: 0 is allowed; every binding stays.`);
    }
    const stale = mine.find(b => b.callId === req.callId && req.cseq <= b.cseq);
    if (stale) return fail(500, 'Server Internal Error', before, expiredActions, 'rfc3261-10.3-order', `CSeq ${req.cseq} is not higher than ${stale.cseq}: an old request, so nothing changes.`);
    return ok(others, mine.map(b => ({ kind: 'removed', contact: b.contact })), 'rfc3261-10.2.2-star',
      `Contact: * with Expires: 0 removes all ${mine.length} binding${mine.length === 1 ? '' : 's'} of the AOR, from every device.`, false);
  }

  // RFC 5626 §6: one flow per registration.
  const withRegId = req.contacts.filter(c => c.params['reg-id'] && c.params['+sip.instance']);
  const outbound = !!policy.outbound && withRegId.length > 0 && req.supported.includes('outbound');
  const nonZero = (c: ContactValue) => (c.params.expires !== undefined ? Number(c.params.expires) : req.expires ?? policy.defaultExpires) !== 0;
  if (outbound && req.contacts.filter(nonZero).length > 1) {
    return fail(400, 'Bad Request', before, expiredActions, 'rfc5626-6-one-flow', 'With reg-id, a REGISTER may add only one Contact.');
  }

  // Step 7: the expiry of each Contact, then 423 or the change.
  const asked = req.contacts.map(c => (c.params.expires !== undefined ? Number(c.params.expires) : req.expires ?? policy.defaultExpires));
  const tooShort = asked.find(e => e > 0 && e < 3600 && e < policy.minExpires);
  if (tooShort !== undefined) {
    return fail(423, 'Interval Too Brief', before, expiredActions, 'rfc3261-10.3-423',
      `The request asks for ${tooShort} s, but the registrar keeps a binding for at least ${policy.minExpires} s. Nothing changes.`, { minExpires: policy.minExpires });
  }

  let next = [...mine];
  const actions: Action[] = [];
  let shortened = false;
  for (const [i, c] of req.contacts.entries()) {
    const want = asked[i]!;
    const granted = Math.min(want, policy.maxExpires);
    if (granted < want) shortened = true;
    const instance = c.params['+sip.instance'] || undefined;
    const regId = outbound && instance ? c.params['reg-id'] || undefined : undefined;
    const key = (b: Binding) => (regId ? b.instance === instance && b.regId === regId : sameUri(b.contact, c.uri));
    const old = next.find(key);
    if (old && old.callId === req.callId && req.cseq <= old.cseq) {
      return fail(500, 'Server Internal Error', before, expiredActions, 'rfc3261-10.3-order', `CSeq ${req.cseq} is not higher than ${old.cseq}: an old request, so nothing changes.`);
    }
    if (want === 0) {
      if (old) { next = next.filter(b => b !== old); actions.push({ kind: 'removed', contact: old.contact }); }
      continue;
    }
    const q = c.params.q !== undefined ? Number(c.params.q) : undefined;
    const b: Binding = {
      aor: req.aor, contact: c.uri, ...(q !== undefined ? { q } : {}), expiresAt: now + granted, callId: req.callId, cseq: req.cseq,
      ...(instance ? { instance } : {}), ...(regId ? { regId } : {}), path: req.path,
    };
    if (instance && policy.gruu) {
      b.pubGruu = `${req.aor};gr=${instance.replace(/^<|>$/g, '')}`;
      b.tempGruu = tempGruu(b, req.callId, req.cseq);
    }
    if (old) {
      next = next.map(x => (x === old ? b : x));
      actions.push(sameUri(old.contact, c.uri) ? { kind: 'refreshed', contact: c.uri, asked: want, granted } : { kind: 'replaced', contact: c.uri, was: old.contact, asked: want, granted });
    } else {
      next.push(b);
      actions.push({ kind: 'added', contact: c.uri, asked: want, granted });
    }
  }

  const all = [...others, ...next];
  const n = next.length;
  const list = n === 0 ? 'The 200 OK lists no bindings.' : n === 1 ? 'The 200 OK lists the binding with the time left.' : `The 200 OK lists all ${n} bindings, each with the time left.`;
  const a = actions[0];
  let rule = 'rfc3261-10.2.1-complete-list';
  let note: string;
  if (!a) note = `Expires 0 for a Contact that is not registered: nothing to remove. ${list}`;
  else if (a.kind === 'removed') { rule = 'rfc3261-10.2.2-zero'; note = `Expires 0: the registrar removes ${a.contact}. ${list}`; }
  else if (a.kind === 'replaced') { rule = 'rfc5626-3.2-replace'; note = `Same instance ID and reg-id: the new Contact replaces ${a.was}. ${list}`; }
  else if (shortened) { rule = 'rfc3261-10.3-shorter'; note = `The request asks for ${a.asked} s; the registrar allows at most ${a.granted} s. The UA must refresh before then.`; }
  else if (a.kind === 'refreshed') { rule = 'rfc3261-10.2.4-refresh'; note = `A refresh: same Contact, same Call-ID, higher CSeq. The binding runs for ${a.granted} s from now.`; }
  else if (req.path.length) { rule = 'rfc3327-5.3-store'; note = `The registrar stores the Path with the binding, and returns it in the 200 OK. ${list}`; }
  else if (b0Instance(req) && gruu) { rule = 'rfc5627-3.2-two-gruus'; note = `The Contact has an instance ID, so the 200 OK carries a public and a temporary GRUU. ${list}`; }
  else if (n > 1) { rule = 'rfc3261-10.2.1-complete-list'; note = `A new binding for another device. ${list}`; }
  else note = `A new binding for ${a.granted} s. ${list}`;
  return ok(all, actions, rule, note, outbound);
}

const b0Instance = (req: RegisterRequest) => !!req.contacts?.some(c => c.params['+sip.instance']);

/* ------------------------------------------------------------------ */
/* Lookup                                                              */
/* ------------------------------------------------------------------ */

export interface Target {
  contact: string;
  q: number;
  /** Route values from the stored Path (RFC 3327 §5.4). */
  route: string[];
}

/**
 * What a proxy finds for a Request-URI: the live Contacts of the AOR, highest
 * q first (RFC 3261 §16.6). A GRUU reaches only the Contacts of its instance (RFC 5627 §3.4).
 */
export function lookup(bindings: Binding[], requestUri: string, now: number): Target[] {
  const gr = /;gr(=([^;]*))?/i.exec(requestUri);
  const aor = canonicalAor(requestUri);
  return expireBindings(bindings, now).live
    .filter(b => b.aor === aor || (gr && b.tempGruu && sameUri(b.tempGruu, requestUri)))
    .filter(b => !gr || !gr[2] || b.instance?.replace(/^<|>$/g, '') === gr[2])
    .map(b => ({ contact: b.contact, q: b.q ?? 1, route: b.path }))
    .sort((x, y) => y.q - x.q);
}

/* ------------------------------------------------------------------ */
/* A whole flow                                                        */
/* ------------------------------------------------------------------ */

export interface FlowStepLike { from: string; to: string; at?: number; message?: SipMessage }

export interface RegistrarSnapshot {
  at: number;
  bindings: Binding[];
  /** The result, at the step where the registrar receives a REGISTER. */
  result?: RegisterResult;
  /** At the step where a proxy receives an initial request for a registered AOR. */
  lookup?: { uri: string; targets: Target[] };
  /** Bindings that ran out since the step before. */
  expired: Binding[];
}

/**
 * Runs the registrar over a flow. A REGISTER counts when it reaches the
 * registrar lane; an initial request (no To tag) that reaches a lane in
 * `lookupLanes` with a Request-URI of a known AOR or GRUU is looked up.
 * Steps without `at` keep the time of the step before.
 */
export function runRegistrar(steps: FlowStepLike[], registrar: string, policy: Policy = DEFAULT_POLICY, lookupLanes: string[] = []): RegistrarSnapshot[] {
  let bindings: Binding[] = [];
  let at = 0;
  const known = new Set<string>();
  return steps.map(s => {
    at = s.at ?? at;
    const { live, expired } = expireBindings(bindings, at);
    bindings = live;
    const m = s.message;
    if (m?.kind === 'request' && m.method === 'REGISTER' && s.to === registrar) {
      const req = registerFromMessage(m, at);
      known.add(req.aor);
      const result = processRegister(bindings, req, policy);
      bindings = result.bindings;
      return { at, bindings, result, expired };
    }
    const toTag = m && /;\s*tag=/i.test(getHeader(m, 'To') ?? '');
    if (m?.kind === 'request' && m.method !== 'ACK' && m.method !== 'REGISTER' && !toTag && lookupLanes.includes(s.to) && m.requestUri
      && (known.has(canonicalAor(m.requestUri)) || /;gr\b/i.test(m.requestUri))) {
      return { at, bindings, expired, lookup: { uri: m.requestUri, targets: lookup(bindings, m.requestUri, at) } };
    }
    return { at, bindings, expired };
  });
}
