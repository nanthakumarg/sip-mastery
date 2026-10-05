/**
 * Protocol checks for call flows (TECH_DESIGN §6.1).
 * Each rule follows RFC 3261. A flow marked `broken: true` must break exactly
 * the rules it lists in `breaks`; every other flow must break none.
 */
import { liveDialogFor, trackDialogs, uriList, uriOf } from './dialog.ts';
import type { PreparedFlow, PreparedStep } from './flow.ts';
import { inDialogTarget, isLoose, viaList } from './routing.ts';
import { contactsOf, DEFAULT_POLICY, parseContactHeader, runRegistrar, sameUri } from './registrar.ts';
import { checkAnswer, checkDtlsAnswer, checkDtlsOffer, checkNewVersion, hasSdesKey, isPrivateAddress, sdpBody, sdpOf, type Sdp } from './sdp.ts';
import { classify } from '../net/address.ts';
import {
  byteLength, cseq, getHeader, getHeaders, headerParam, isRequest, isResponse, tagOf, topVia,
  type SipMessage,
} from './parse.ts';

export interface LintIssue {
  rule: string;
  severity: 'error' | 'warn';
  step: number;
  message: string;
}

const REQ_HEADERS = ['Via', 'From', 'To', 'Call-ID', 'CSeq', 'Max-Forwards'];
const RESP_HEADERS = ['Via', 'From', 'To', 'Call-ID', 'CSeq'];

type MsgStep = PreparedStep & { parsed: SipMessage };

export function lintFlow(flow: PreparedFlow): LintIssue[] {
  const issues: LintIssue[] = [];
  const add = (rule: string, step: number, message: string, severity: LintIssue['severity'] = 'error') =>
    issues.push({ rule, severity, step, message });

  for (const s of flow.steps) {
    if (s.message && s.parseError) add('parse', s.index, s.parseError);
  }
  const msgs = flow.steps.filter((s): s is MsgStep => !!s.parsed);

  for (const s of msgs) {
    const m = s.parsed;
    // mandatory-headers (RFC 3261 §8.1.1, §8.1.1.8)
    const need = m.kind === 'request' ? [...REQ_HEADERS, ...(m.method === 'INVITE' ? ['Contact'] : [])] : RESP_HEADERS;
    for (const h of need) {
      if (!getHeader(m, h)) add('mandatory-headers', s.index, `${describe(m)} has no ${h} header`);
    }
    // cseq-method (RFC 3261 §8.1.1.5)
    const cs = cseq(m);
    if (m.kind === 'request' && cs && cs.method !== m.method) {
      add('cseq-method', s.index, `CSeq method is ${cs.method}, but the request method is ${m.method}`);
    }
    // branch-cookie (RFC 3261 §8.1.1.7)
    for (const via of getHeaders(m, 'Via').flatMap(h => h.value.split(','))) {
      const b = headerParam(via, 'branch');
      if (!b || !b.startsWith('z9hG4bK')) add('branch-cookie', s.index, `Via branch "${b ?? ''}" does not start with z9hG4bK`);
    }
    // content-length (RFC 3261 §20.14)
    const cl = getHeader(m, 'Content-Length');
    const len = byteLength(m.body);
    if (cl !== undefined && Number(cl) !== len) {
      add('content-length', s.index, `Content-Length is ${cl}, but the body is ${len} bytes`);
    } else if (cl === undefined && len > 0) {
      add('content-length', s.index, 'The message has a body but no Content-Length', 'warn');
    }
  }

  checkAcks(msgs, add);
  checkAuthRetries(msgs, add);
  // Proxies and NAT routers forward a 2xx and its ACK; every other element is an end of the dialog.
  const ends = new Set(flow.lanes.filter(l => l.kind !== 'proxy' && l.kind !== 'nat').map(l => l.id));
  checkInviteAcked(msgs, ends, add);
  checkDialogTags(msgs, add);
  checkCancels(msgs, add);
  checkDialogTargets(flow, add);
  checkRecordRouteLr(msgs, add);
  checkResponseVias(msgs, add);
  const proxies = new Set(flow.lanes.filter(l => l.kind === 'proxy').map(l => l.id));
  checkMaxForwards(msgs, proxies, add);
  checkRegisters(flow, msgs, add);
  if (flow.registrar) checkRegistrarModel(flow, add);
  if (flow.trust) checkPaiTrust(flow, msgs, add);
  checkUserEnumeration(msgs, add);
  checkSdp(flow, msgs, add);
  checkUdpSize(msgs, add);
  return issues;
}

type Add = (rule: string, step: number, message: string, severity?: LintIssue['severity']) => void;

const sameHop = (a: PreparedStep, b: PreparedStep) => a.from === b.from && a.to === b.to;
const reverseHop = (a: PreparedStep, b: PreparedStep) => a.from === b.to && a.to === b.from;
const callId = (m: SipMessage) => getHeader(m, 'Call-ID');

function describe(m: SipMessage): string {
  return m.kind === 'request' ? m.method! : `${m.status} response`;
}

/** Finds the INVITE request on this hop that a response or ACK belongs to. */
function findInvite(msgs: MsgStep[], before: number, hop: (s: PreparedStep) => boolean, cid: string | undefined, seq: number) {
  for (let i = before - 1; i >= 0; i--) {
    const s = msgs[i]!;
    if (hop(s) && isRequest(s.parsed, 'INVITE') && callId(s.parsed) === cid && cseq(s.parsed)?.seq === seq) return s;
  }
  return undefined;
}

/** ack-non2xx-branch, ack-2xx-branch (RFC 3261 §17.1.1.3, §13.2.2.4) */
function checkAcks(msgs: MsgStep[], add: Add) {
  msgs.forEach((s, i) => {
    if (!isRequest(s.parsed, 'ACK')) return;
    const ack = s.parsed;
    const seq = cseq(ack)?.seq;
    const cid = callId(ack);
    // The final response this ACK answers: latest final INVITE response on the reverse hop.
    let resp: MsgStep | undefined;
    for (let j = i - 1; j >= 0; j--) {
      const r = msgs[j]!;
      const rc = cseq(r.parsed);
      if (reverseHop(r, s) && isResponse(r.parsed) && r.parsed.status! >= 200 && rc?.method === 'INVITE' && callId(r.parsed) === cid) {
        resp = r;
        break;
      }
    }
    if (!resp) return;
    const invite = findInvite(msgs, msgs.indexOf(resp), x => sameHop(x, s), cid, cseq(resp.parsed)!.seq);
    const inviteBranch = invite ? topVia(invite.parsed)?.branch : topVia(resp.parsed)?.branch;
    const ackBranch = topVia(ack)?.branch;
    if (resp.parsed.status! >= 300) {
      if (ackBranch !== inviteBranch) {
        add('ack-non2xx-branch', s.index, `ACK for ${resp.parsed.status} must reuse the INVITE branch (${inviteBranch}), but has ${ackBranch}`);
      }
      if (seq !== cseq(resp.parsed)?.seq) {
        add('ack-non2xx-branch', s.index, `ACK for ${resp.parsed.status} must reuse the INVITE CSeq number`);
      }
    } else if (ackBranch === inviteBranch) {
      add('ack-2xx-branch', s.index, `ACK for a 2xx is a new transaction and needs a new branch, but reuses ${ackBranch}`);
    }
  });
}

/** auth-retry (RFC 3261 §8.1.3.5, §22.2, §22.3) */
function checkAuthRetries(msgs: MsgStep[], add: Add) {
  msgs.forEach((ch, i) => {
    if (!isResponse(ch.parsed) || (ch.parsed.status !== 401 && ch.parsed.status !== 407)) return;
    const method = cseq(ch.parsed)?.method;
    // The challenged request on the same hop.
    let orig: MsgStep | undefined;
    for (let j = i - 1; j >= 0; j--) {
      const r = msgs[j]!;
      if (reverseHop(r, ch) && isRequest(r.parsed, method) && topVia(r.parsed)?.branch === topVia(ch.parsed)?.branch) { orig = r; break; }
    }
    if (!orig) return;
    // The retry: next request with the same method, to the same To URI, on the same hop.
    // (A request for another user, as in a scan, is not a retry.)
    const toUri = (m: SipMessage) => uriOf(getHeader(m, 'To'));
    const retry = msgs.slice(i + 1).find(r => sameHop(r, orig) && isRequest(r.parsed, method) && toUri(r.parsed) === toUri(orig.parsed));
    if (!retry) return;
    const o = orig.parsed;
    const r = retry.parsed;
    const credHeader = ch.parsed.status === 401 ? 'Authorization' : 'Proxy-Authorization';
    if (!getHeader(r, credHeader)) add('auth-retry', retry.index, `Retry after ${ch.parsed.status} has no ${credHeader} header`);
    if (cseq(r)?.seq !== (cseq(o)?.seq ?? 0) + 1) add('auth-retry', retry.index, `Retry after ${ch.parsed.status} must use CSeq ${(cseq(o)?.seq ?? 0) + 1}, but uses ${cseq(r)?.seq}`);
    if (callId(r) !== callId(o)) add('auth-retry', retry.index, 'Retry must keep the same Call-ID');
    if (tagOf(r, 'From') !== tagOf(o, 'From')) add('auth-retry', retry.index, 'Retry must keep the same From tag');
    if (topVia(r)?.branch === topVia(o)?.branch) add('auth-retry', retry.index, 'Retry is a new transaction and needs a new branch');
  });
}

/**
 * invite-final-ack (RFC 3261 §17.1.1.3, §13.2.2.4): every final INVITE response is ACKed.
 * A 300–699 is ACKed on its own hop. A 2xx is ACKed end to end: the UA that receives it
 * must send an ACK, and an ACK must reach the UA that sent it (directly, or through the
 * proxies of the route set). Where the ACK goes is checked by dialog-target.
 */
function checkInviteAcked(msgs: MsgStep[], ends: Set<string>, add: Add) {
  msgs.forEach((r, i) => {
    const rc = cseq(r.parsed);
    if (!isResponse(r.parsed) || r.parsed.status! < 200 || rc?.method !== 'INVITE') return;
    const acks = msgs.slice(i + 1).filter(a => isRequest(a.parsed, 'ACK') && callId(a.parsed) === callId(r.parsed) && cseq(a.parsed)?.seq === rc.seq);
    if (r.parsed.status! >= 300) {
      if (!acks.some(a => reverseHop(a, r))) add('invite-final-ack', r.index, `${r.parsed.status} to INVITE is never ACKed on this hop`);
    } else {
      if (ends.has(r.to) && !acks.some(a => a.from === r.to)) add('invite-final-ack', r.index, `${r.parsed.status} to INVITE: the receiver never sends an ACK`);
      if (ends.has(r.from) && !acks.some(a => a.to === r.from && !a.lost)) add('invite-final-ack', r.index, `${r.parsed.status} to INVITE: no ACK ever reaches the sender`);
    }
  });
}

/** dialog-tags (RFC 3261 §12.2.1.1): in-dialog requests use the tags of the dialog. */
function checkDialogTags(msgs: MsgStep[], add: Add) {
  const dialogs: { cid: string; a: string; b: string }[] = [];
  for (const s of msgs) {
    const m = s.parsed;
    const cid = callId(m) ?? '';
    const from = tagOf(m, 'From');
    const to = tagOf(m, 'To');
    if (isResponse(m, 2) && cseq(m)?.method === 'INVITE' && from && to) {
      if (!dialogs.some(d => d.cid === cid && d.a === from && d.b === to)) dialogs.push({ cid, a: from, b: to });
    } else if (m.kind === 'request' && to && m.method !== 'ACK' && m.method !== 'CANCEL') {
      const known = dialogs.filter(d => d.cid === cid);
      const ok = known.length === 0 || known.some(d => (d.a === from && d.b === to) || (d.a === to && d.b === from));
      if (!ok) add('dialog-tags', s.index, `${m.method} uses tags ${from}/${to}, which match no dialog on this Call-ID`);
    } else if (m.kind === 'request' && m.method === 'ACK' && to && isAckFor2xx(msgs, s)) {
      const known = dialogs.filter(d => d.cid === cid);
      const ok = known.length === 0 || known.some(d => d.a === from && d.b === to);
      if (!ok) add('dialog-tags', s.index, `ACK uses tags ${from}/${to}, which match no dialog on this Call-ID`);
    }
  }
}

function isAckFor2xx(msgs: MsgStep[], ack: MsgStep): boolean {
  const i = msgs.indexOf(ack);
  for (let j = i - 1; j >= 0; j--) {
    const r = msgs[j]!;
    if (reverseHop(r, ack) && isResponse(r.parsed) && r.parsed.status! >= 200 && cseq(r.parsed)?.method === 'INVITE') {
      return r.parsed.status! < 300;
    }
  }
  return false;
}

/** cancel-after-final (RFC 3261 §9.1): a CANCEL is useless once the INVITE has a final response. */
function checkCancels(msgs: MsgStep[], add: Add) {
  msgs.forEach((c, i) => {
    if (!isRequest(c.parsed, 'CANCEL')) return;
    const cid = callId(c.parsed);
    const branch = topVia(c.parsed)?.branch;
    const invite = msgs.slice(0, i).reverse().find(x =>
      sameHop(x, c) && isRequest(x.parsed, 'INVITE') && callId(x.parsed) === cid && topVia(x.parsed)?.branch === branch);
    if (!invite) return;
    const seq = cseq(invite.parsed)?.seq;
    const final = msgs.slice(msgs.indexOf(invite) + 1, i).find(r =>
      reverseHop(r, c) && isResponse(r.parsed) && r.parsed.status! >= 200 && cseq(r.parsed)?.method === 'INVITE' && cseq(r.parsed)?.seq === seq && callId(r.parsed) === cid);
    if (final) add('cancel-after-final', c.index, `CANCEL sent after the INVITE already received ${final.parsed.status}. It has no effect; end the call with BYE`);
  });
}

/** dialog-target (RFC 3261 §12.2.1.1): a UA sends in-dialog requests to the remote target, through the route set. */
function checkDialogTargets(flow: PreparedFlow, add: Add) {
  const steps = flow.steps.map(s => ({ from: s.from, to: s.to, msg: s.parsed }));
  for (const ua of flow.lanes.filter(l => l.kind === 'ua').map(l => l.id)) {
    const snaps = trackDialogs(steps, ua);
    flow.steps.forEach((s, i) => {
      const m = s.parsed;
      if (!m || s.from !== ua || m.kind !== 'request' || m.method === 'CANCEL' || i === 0) return;
      const d = liveDialogFor(snaps[i - 1], m);
      if (!d || (m.method === 'ACK' && d.state !== 'confirmed')) return;
      const want = inDialogTarget(d.routeSet, d.remoteTarget);
      const how = want.strict ? ' (the first route is a strict router)' : '';
      if (m.requestUri !== want.requestUri) {
        add('dialog-target', s.index, `${m.method} goes to ${m.requestUri}, but the dialog state gives ${want.requestUri}${how}`);
      }
      const routes = uriList(m, 'Route');
      if (routes.join(',') !== want.route.join(',')) {
        add('dialog-target', s.index, `${m.method} has Route [${routes.join(', ')}], but the dialog state gives [${want.route.join(', ')}]${how}`);
      }
    });
  }
}

/** record-route-lr (RFC 3261 §16.6 item 4): every Record-Route URI that a proxy adds has the lr parameter. */
function checkRecordRouteLr(msgs: MsgStep[], add: Add) {
  for (const s of msgs) {
    if (s.parsed.kind !== 'request') continue;
    for (const u of uriList(s.parsed, 'Record-Route')) {
      if (!isLoose(u)) add('record-route-lr', s.index, `Record-Route <${u}> has no lr parameter, so in-dialog requests use strict routing`);
    }
  }
}

/**
 * response-via (RFC 3261 §8.2.6.2, §16.7 item 3): a response carries the Via
 * headers of its request on the same hop, in the same order. Only sent-by and
 * branch are compared: the receiver adds received and rport.
 */
function checkResponseVias(msgs: MsgStep[], add: Add) {
  const key = (m: SipMessage) => viaList(m).map(v => `${v.host}:${v.port ?? ''};${v.branch ?? ''}`);
  msgs.forEach((r, i) => {
    if (!isResponse(r.parsed)) return;
    const c = cseq(r.parsed);
    const req = msgs.slice(0, i).reverse().find(q => reverseHop(q, r) && isRequest(q.parsed, c?.method)
      && callId(q.parsed) === callId(r.parsed) && cseq(q.parsed)?.seq === c?.seq);
    if (!req) return;
    const want = key(req.parsed), got = key(r.parsed);
    if (want.join(',') !== got.join(',')) {
      add('response-via', r.index, `${r.parsed.status} has Via [${got.join(', ')}], but its request on this hop had [${want.join(', ')}]`);
    }
  });
}

/** max-forwards (RFC 3261 §16.6 item 3): a proxy forwards a request with Max-Forwards one lower. */
function checkMaxForwards(msgs: MsgStep[], proxies: Set<string>, add: Add) {
  msgs.forEach((s, i) => {
    const m = s.parsed;
    if (m.kind !== 'request' || !proxies.has(s.from)) return;
    const below = viaList(m)[1]?.branch;
    if (!below) return; // the proxy created this request itself (CANCEL, ACK for a non-2xx)
    const inbound = msgs.slice(0, i).reverse().find(q => q.to === s.from && isRequest(q.parsed, m.method)
      && callId(q.parsed) === callId(m) && topVia(q.parsed)?.branch === below);
    const was = inbound ? Number(getHeader(inbound.parsed, 'Max-Forwards')) : NaN;
    const now = Number(getHeader(m, 'Max-Forwards'));
    if (Number.isFinite(was) && now !== was - 1) {
      add('max-forwards', s.index, `${m.method} arrived with Max-Forwards ${was} and leaves with ${now}; a proxy decrements it by one`);
    }
  });
}

/**
 * register-uri (RFC 3261 §10.2): the Request-URI of a REGISTER names a domain, with no user part.
 * register-star (§10.2.2): Contact "*" only with Expires: 0, and alone.
 * min-expires (§10.3 step 7): a 423 carries Min-Expires.
 * register-refresh (§10.2.4): a UA refreshes a binding before the expiry the registrar returned.
 */
function checkRegisters(flow: PreparedFlow, msgs: MsgStep[], add: Add) {
  const timeOf = (index: number) => {
    let t = 0;
    for (const s of flow.steps.slice(0, index + 1)) t = s.at ?? t;
    return t;
  };
  const timed = flow.steps.some(s => s.at !== undefined);
  // Contact → [time it runs out], per UA lane and Call-ID, from the last 2xx.
  const granted = new Map<string, { until: number; step: number }>();
  for (const s of msgs) {
    const m = s.parsed;
    if (isRequest(m, 'REGISTER')) {
      if (/^sips?:[^@;]*@/i.test(m.requestUri ?? '')) add('register-uri', s.index, `REGISTER ${m.requestUri} has a user part; the Request-URI names only the domain`);
      const cs = contactsOf(m);
      if (cs.some(c => c.star)) {
        const exp = getHeader(m, 'Expires');
        if (cs.length > 1) add('register-star', s.index, 'Contact: * must be the only Contact value');
        if (exp === undefined) add('register-star', s.index, 'Contact: * without an Expires header; it needs Expires: 0');
        else if (Number(exp) !== 0) add('register-star', s.index, `Contact: * with Expires: ${exp}; it needs Expires: 0`);
      }
      if (timed && s.from !== undefined) {
        const now = timeOf(s.index);
        for (const c of cs) {
          if (c.star || c.params.expires === '0') continue;
          const key = [...granted.keys()].find(k => k.startsWith(`${s.from}|${callId(m)}|`) && sameUri(k.split('|')[2]!, c.uri));
          const g = key ? granted.get(key) : undefined;
          if (g && now > g.until) add('register-refresh', s.index, `The refresh at t = ${now} s comes after the binding ran out at t = ${g.until} s (the 2xx of step ${g.step + 1} granted less)`);
        }
      }
    }
    if (isResponse(m, 2) && cseq(m)?.method === 'REGISTER') {
      const now = timeOf(s.index);
      for (const c of contactsOf(m)) {
        if (c.params.expires !== undefined) granted.set(`${s.to}|${callId(m)}|${c.uri}`, { until: now + Number(c.params.expires), step: s.index });
      }
    }
    if (isResponse(m) && m.status === 423 && !getHeader(m, 'Min-Expires')) add('min-expires', s.index, '423 Interval Too Brief has no Min-Expires header');
  }
}

/**
 * registrar-model (RFC 3261 §10.3, RFC 3327 §5.3–5.4, RFC 5626 §6, RFC 5627 §5):
 * the registrar answers each REGISTER as the model does, and a proxy that
 * looks up the location service forwards to the Contacts it finds.
 */
function checkRegistrarModel(flow: PreparedFlow, add: Add) {
  const cfg = flow.registrar!;
  const policy = { ...DEFAULT_POLICY, ...cfg };
  const snaps = runRegistrar(flow.steps.map(s => ({ from: s.from, to: s.to, at: s.at, message: s.parsed })), cfg.lane, policy, cfg.lookup ?? []);
  const later = (i: number, pred: (s: PreparedStep) => boolean) => flow.steps.slice(i + 1).find(pred);
  snaps.forEach((snap, i) => {
    const req = flow.steps[i]!.parsed;
    if (!req) return;
    if (snap.result) {
      const r = snap.result;
      const resp = later(i, s => s.from === cfg.lane && !!s.parsed && isResponse(s.parsed) && callId(s.parsed) === callId(req) && cseq(s.parsed)?.seq === cseq(req)?.seq);
      if (!resp?.parsed) return;
      const got = resp.parsed;
      if (got.status !== r.status) {
        add('registrar-model', resp.index, `The registrar answers ${got.status}, but RFC 3261 §10.3 gives ${r.status} ${r.reason}: ${r.note}`);
        return;
      }
      if (r.status === 423 && Number(getHeader(got, 'Min-Expires')) !== r.minExpires) add('registrar-model', resp.index, `Min-Expires should be ${r.minExpires}`);
      if (r.status !== 200) return;
      const fmt = (c: { uri: string; params: Record<string, string> }) => `${c.uri} expires=${c.params.expires ?? '?'}${c.params.q ? ` q=${Number(c.params.q)}` : ''}${c.params['pub-gruu'] ? ` pub-gruu=${c.params['pub-gruu']}` : ''}${c.params['temp-gruu'] ? ` temp-gruu=${c.params['temp-gruu']}` : ''}`;
      const want = r.contacts.flatMap(parseContactHeader).map(fmt).sort();
      const have = contactsOf(got).map(fmt).sort();
      if (want.join(' | ') !== have.join(' | ')) add('registrar-model', resp.index, `The 200 OK lists [${have.join(' | ')}], but the bindings are [${want.join(' | ')}]`);
      const path = getHeaders(got, 'Path').map(h => h.value).join(', ');
      if (path !== r.path.join(', ')) add('registrar-model', resp.index, `The 200 OK has Path [${path}], but the REGISTER had [${r.path.join(', ')}]`);
      const sr = getHeaders(got, 'Service-Route').map(h => h.value).join(', ');
      if (sr !== r.serviceRoute.join(', ')) add('registrar-model', resp.index, `The 200 OK has Service-Route [${sr}], but the registrar policy gives [${r.serviceRoute.join(', ')}]`);
    }
    if (snap.lookup) {
      const lane = flow.steps[i]!.to;
      const out = later(i, s => s.from === lane && !!s.parsed && callId(s.parsed) === callId(req) && (isResponse(s.parsed) ? s.parsed.status! >= 300 : s.parsed.method === req.method));
      if (!out?.parsed) return;
      const { targets } = snap.lookup;
      if (!targets.length) {
        if (out.parsed.kind === 'request') add('registrar-model', out.index, `${lane} forwards the ${req.method}, but the AOR has no binding at t = ${snap.at} s`);
        return;
      }
      if (out.parsed.kind !== 'request') { add('registrar-model', out.index, `${lane} answers ${out.parsed.status}, but the AOR has ${targets.length} binding(s)`); return; }
      const t = targets.find(x => sameUri(x.contact, out.parsed!.requestUri ?? ''));
      if (!t) { add('registrar-model', out.index, `${req.method} goes to ${out.parsed.requestUri}, which is not a registered Contact`); return; }
      const routes = uriList(out.parsed, 'Route');
      const path = t.route.map(v => v.replace(/^.*<([^>]*)>.*$/, '$1'));
      if (routes.slice(0, path.length).join(',') !== path.join(',')) add('registrar-model', out.index, `Route [${routes.join(', ')}] does not start with the stored Path [${path.join(', ')}]`);
    }
  });
}

/**
 * pai-trust (RFC 3325 §5): a proxy in the trust domain does not pass on a
 * P-Asserted-Identity that it received from a node outside the trust domain.
 */
function checkPaiTrust(flow: PreparedFlow, msgs: MsgStep[], add: Add) {
  const trusted = new Set(flow.trust);
  const pai = (m: SipMessage) => getHeaders(m, 'P-Asserted-Identity').map(h => h.value).join(', ');
  msgs.forEach((s, i) => {
    const m = s.parsed;
    if (m.kind !== 'request' || !trusted.has(s.from) || !pai(m)) return;
    const below = viaList(m)[1]?.branch;
    const inbound = msgs.slice(0, i).reverse().find(q => q.to === s.from && isRequest(q.parsed, m.method)
      && callId(q.parsed) === callId(m) && (!below || topVia(q.parsed)?.branch === below));
    if (inbound && !trusted.has(inbound.from) && pai(inbound.parsed) === pai(m)) {
      add('pai-trust', s.index, `${s.from} forwards P-Asserted-Identity ${pai(m)}, which came from ${inbound.from}, outside the trust domain`);
    }
  });
}

/**
 * user-enumeration (security practice, Module 14; not an RFC rule): a server
 * answers a request without credentials the same way for users that exist and
 * users that do not — not 401/407 for some and 404 for others.
 */
function checkUserEnumeration(msgs: MsgStep[], add: Add) {
  const answers = new Map<string, { status: number; step: number; user: string }[]>();
  for (const s of msgs) {
    const m = s.parsed;
    if (!isResponse(m) || ![401, 404, 407].includes(m.status!)) continue;
    const c = cseq(m);
    const req = msgs.find(q => q.to === s.from && isRequest(q.parsed, c?.method) && callId(q.parsed) === callId(m) && cseq(q.parsed)?.seq === c?.seq);
    if (!req || getHeader(req.parsed, 'Authorization') || getHeader(req.parsed, 'Proxy-Authorization')) continue;
    const user = /sips?:([^@;>]+)@/i.exec(getHeader(m, 'To') ?? '')?.[1] ?? '';
    const key = `${s.from}|${c?.method}`;
    answers.set(key, [...(answers.get(key) ?? []), { status: m.status!, step: s.index, user }]);
  }
  for (const list of answers.values()) {
    const challenged = list.filter(a => a.status !== 404);
    if (!challenged.length) continue;
    for (const a of list.filter(x => x.status === 404)) {
      add('user-enumeration', a.step, `404 for ${a.user}, but ${challenged[0]!.status} for ${challenged[0]!.user}: a scanner can tell which users exist`);
    }
  }
}

/**
 * SDP and offer/answer (RFC 8866; RFC 3264; RFC 3261 §13.2.1; RFC 3262 §5).
 *  - sdp-syntax: every SDP body is valid (no error from parseSdp).
 *  - sdp-version (RFC 3264 §8): a changed SDP from the same side has the next o= version.
 *  - sdp-mlines (RFC 3264 §6, §8): the answer has the m= lines of the offer, in order; m= lines never go away.
 *  - answer-codec, answer-direction (RFC 3264 §6.1): an accepted stream shares a codec, and its direction fits the offer.
 *  - sdp-private-address (RFC 6314 §3): a private media address does not reach a user agent on the public Internet.
 *  - sdes-over-tls (RFC 4568 §8.3): an SDP with an SDES key (a=crypto inline) travels only over TLS.
 *  - dtls-setup (RFC 8842 §5.2, RFC 4145 §4.1): a DTLS-SRTP offer says actpass; the answer says active or passive.
 * Offers and answers are tracked on each hop, so a proxy that forwards the SDP
 * unchanged sees the same exchange as the user agents.
 */
function checkSdp(flow: PreparedFlow, msgs: MsgStep[], add: Add) {
  interface Offer { by: string; seq: number; method: string; inResponse: boolean; sdp: Sdp; answered: Set<string>; revert?: () => void }
  // Offers waiting for an answer on each hop. Two at once is glare (RFC 3264 §4); the 491 sorts it out.
  const hops = new Map<string, { offers: Offer[]; last: Map<string, Sdp> }>();
  const lanes = new Map(flow.lanes.map(l => [l.id, l]));
  const publicUa = (id: string) => {
    const l = lanes.get(id);
    const ip = l?.sub?.split(/[\s:]/)[0] ?? '';
    return l?.kind === 'ua' && classify(ip).kind !== 'invalid' && !isPrivateAddress(ip);
  };

  for (const s of msgs) {
    const m = s.parsed;
    const c = cseq(m);
    if (!c) continue;
    const hop = `${[s.from, s.to].sort().join('|')}|${callId(m)}`;
    const st = hops.get(hop) ?? { offers: [], last: new Map<string, Sdp>() };
    hops.set(hop, st);
    const drop = (o: Offer) => { st.offers = st.offers.filter(x => x !== o); };
    // The offer that this response answers or rejects: one sent the other way, in the same transaction.
    const mine = isResponse(m) ? st.offers.find(o => o.by !== s.from && !o.inResponse && o.seq === c.seq && o.method === c.method) : undefined;
    // A failure response rejects the offer. The session goes back to the state before
    // the offer (RFC 3264 §4), so the next SDP is compared with the one before it.
    if (mine && m.status! >= 300) { mine.revert?.(); drop(mine); }

    const sdp = sdpOf(getHeader(m, 'Content-Type'), m.body);
    // A 2xx ends the transaction, with or without SDP (the answer may have come in a reliable 1xx).
    if (!sdp) { if (mine && m.status! >= 200) drop(mine); continue; }
    for (const e of sdp.issues.filter(x => x.severity === 'error')) {
      add('sdp-syntax', s.index, `SDP${e.line !== undefined ? ` line ${e.line + 1}` : ''}: ${e.message}`);
    }
    if (hasSdesKey(sdp)) {
      const t = viaList(m)[0]?.transport.toUpperCase();
      if (t !== 'TLS' && t !== 'WSS') add('sdes-over-tls', s.index, `The SDP carries an SRTP key in a=crypto, but this hop is ${t ?? 'unknown'}, not TLS: anyone on the path can read the key and decrypt the media`);
    }
    if (publicUa(s.to)) {
      const priv = [...new Set([sdp.c, ...sdp.media.map(x => x.c)].filter(x => x && x.address !== '0.0.0.0' && isPrivateAddress(x.address)).map(x => x!.address))];
      for (const a of priv) add('sdp-private-address', s.index, `The SDP gives ${a}, a private address, to ${lanes.get(s.to)?.label ?? s.to} on the public Internet. Media sent there never arrives`);
    }

    // Versions: compare with the last SDP of the same origin that this side sent on this hop.
    let effective = sdp;
    let revert: (() => void) | undefined;
    if (sdp.origin) {
      const key = `${s.from}|${sdp.origin.username} ${sdp.origin.sessId} ${sdp.origin.address}`;
      const prev = st.last.get(key);
      revert = () => { if (prev) st.last.set(key, prev); else st.last.delete(key); };
      if (prev) {
        for (const e of checkNewVersion(prev, sdp)) add(e.rule, s.index, e.message);
        // An unchanged version means the old SDP (RFC 3264 §8): the receiver reads it so.
        if (prev.origin?.version === sdp.origin.version && sdpBody(prev) !== sdpBody(sdp)) effective = prev;
      }
      if (effective === sdp) st.last.set(key, sdp);
    }

    const answer = (offer: Offer) => {
      for (const e of [...checkAnswer(offer.sdp, effective), ...checkDtlsAnswer(offer.sdp, effective)]) add(e.rule, s.index, e.message);
    };
    const offer = (inResponse: boolean) => {
      for (const e of checkDtlsOffer(effective)) add(e.rule, s.index, e.message);
      st.offers.push({ by: s.from, seq: c.seq, method: c.method, inResponse, sdp: effective, answered: new Set(), revert });
    };
    if (m.kind === 'request') {
      // An offer in a 2xx or reliable 1xx is answered in the ACK or PRACK (RFC 3261 §13.2.1, RFC 3262 §5).
      const late = m.method === 'ACK' || m.method === 'PRACK' ? st.offers.find(o => o.by !== s.from && o.inResponse) : undefined;
      if (late) { answer(late); drop(late); }
      else if (m.method !== 'ACK') offer(false);
    } else if (mine) {
      // The first SDP in a response to the offer is the answer; one for each early dialog (RFC 3261 §13.2.1).
      const toTag = tagOf(m, 'To') ?? '';
      if (!mine.answered.has(toTag)) { answer(mine); mine.answered.add(toTag); }
      if (m.status! >= 200) drop(mine);
    } else if (c.method === 'INVITE' && m.status! < 300 && !st.offers.some(o => o.by === s.from && o.inResponse)) {
      // An INVITE without an offer: the 2xx or reliable 1xx carries the offer.
      offer(true);
    }
  }
}

/**
 * udp-size (RFC 3261 §18.1.1): a request larger than 1300 bytes (path MTU
 * unknown) is not sent over UDP; it would be fragmented.
 */
function checkUdpSize(msgs: MsgStep[], add: Add) {
  for (const s of msgs) {
    if (s.parsed.kind !== 'request' || !s.wire) continue;
    const t = viaList(s.parsed)[0]?.transport.toUpperCase();
    const size = byteLength(s.wire);
    if (t === 'UDP' && size > 1300) {
      add('udp-size', s.index, `${s.parsed.method} is ${size} bytes over UDP. Above 1300 bytes, a request must go over TCP (or another congestion-controlled transport)`);
    }
  }
}
