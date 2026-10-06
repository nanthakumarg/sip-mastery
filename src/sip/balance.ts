/**
 * Load balancer generator (Module 25.4): Alice calls Bob through a load
 * balancer in front of two PBXs that share Bob's registration. Options:
 * OPTIONS health checks, and what goes wrong with PBX A: nothing, it is
 * down, it is overloaded (503 with Retry-After), or Bob declines (603).
 * The load balancer is a stateful proxy that does not Record-Route, so it
 * leaves the dialog after the INVITE. Every combination passes the linters.
 */
import type { FlowData } from './flow.ts';
import { ALICE, FlowWriter, sdp, withTag, type Msg, type Node } from './sipgen.ts';

export const FAILURES = { none: 'Answers', down: 'Is down', overload: 'Overloaded (503)', decline: 'Bob declines (603)' } as const;

export interface BalanceOptions {
  /** The load balancer sends OPTIONS to each PBX before the call. */
  probe: boolean;
  /** What happens at PBX A, the next PBX in the round robin. */
  failure: keyof typeof FAILURES;
  /** Not in the builder: the load balancer tries the next PBX after any failure (the broken flow of Common mistakes). */
  failoverAll?: boolean;
}

export const DEFAULT_BALANCE: BalanceOptions = { probe: true, failure: 'down' };

export function applyBalance(o: BalanceOptions, change: Partial<BalanceOptions>): { options: BalanceOptions; notes: string[] } {
  return { options: { ...o, ...change }, notes: [] };
}
export const balanceInactive = (_: BalanceOptions) => ({});
export const balanceKey = (o: BalanceOptions) => [o.probe ? 'probe' : 'noprobe', o.failure, o.failoverAll ? 'all' : ''].filter(Boolean).join('.');
export function allBalances(): BalanceOptions[] {
  const out: BalanceOptions[] = [];
  for (const probe of [true, false]) for (const failure of Object.keys(FAILURES) as BalanceOptions['failure'][]) out.push({ probe, failure });
  return out;
}

export const BALANCE_QUOTES = [
  'rfc3261-11-options', 'rfc3263-4.3-failure', 'rfc3263-4.3-new-branch', 'rfc3261-17.1.1.2-timer-b', 'rfc3261-20.33-retry-after',
  'rfc3261-16.7-503', 'rfc3261-16.7-6xx',
] as const;

const LB: Node = { id: 'lb', label: 'Load balancer', kind: 'proxy', ip: '198.51.100.20', uri: 'sip:198.51.100.20;lr', br: 'lb' };
const PBX_A: Node = { id: 'pbxA', label: 'PBX A', kind: 'server', ip: '203.0.113.31', contact: 'sip:bob@203.0.113.31:5060', tag: 'pa71c', br: 'pa' };
const PBX_B: Node = { id: 'pbxB', label: 'PBX B', kind: 'server', ip: '203.0.113.32', contact: 'sip:bob@203.0.113.32:5060', tag: 'pb93e', br: 'pb' };
const BOB_AOR = 'sip:bob@biloxi.example';

export function buildBalance(o: BalanceOptions): FlowData {
  const w = new FlowWriter();
  let at = 0;
  const step = <T>(f: () => T, t?: number) => { if (t !== undefined) at = t; const r = f(); w.steps[w.steps.length - 1]!.at = at; return r; };

  const probe = (p: Node, down: boolean) => {
    const m: Msg = {
      line: `OPTIONS sip:${p.ip}:5060 SIP/2.0`, via: [w.via(LB)], maxForwards: 70, from: `<sip:lb@198.51.100.20>;tag=lb${p.br}1`, to: `<sip:${p.ip}:5060>`,
      callId: `probe-${p.br}-41c2@198.51.100.20`, cseq: '1 OPTIONS',
    };
    if (down) {
      step(() => w.msg(LB, p, 'OPTIONS', `${p.label} does not answer. After a few probes, the load balancer marks it down and sends it no calls.`, m, { lost: true, rfc: 'rfc3261-11-options' }));
      return;
    }
    step(() => w.msg(LB, p, 'OPTIONS', `The load balancer checks ${p.label} every few seconds, with OPTIONS.`, m, { rfc: 'rfc3261-11-options' }));
    step(() => w.msg(p, LB, '200 OK', `${p.label} is up.`, { ...w.response({ from: LB, to: p, msg: m }, '200 OK', { tag: `${p.br}0k` }) }));
  };
  if (o.probe) {
    probe(PBX_A, o.failure === 'down');
    probe(PBX_B, false);
  }

  const inv: Msg = {
    line: `INVITE ${BOB_AOR} SIP/2.0`, via: [w.via(ALICE)], maxForwards: 70, from: `Alice <sip:alice@atlanta.example>;tag=${ALICE.tag}`, to: `Bob <${BOB_AOR}>`,
    cseq: '314159 INVITE', contact: ALICE.contact, sdp: sdp({ user: 'alice', id: 2890844526, ip: ALICE.ip, port: 49170, pts: [0, 8] }),
  };
  step(() => w.msg(ALICE, LB, 'INVITE', 'Alice calls Bob. The load balancer in front of the PBXs receives the INVITE.', inv), o.probe ? 5 : 0);
  step(() => w.msg(LB, ALICE, '100 Trying', 'The load balancer stops Alice\'s retransmissions.', w.response({ from: ALICE, to: LB, msg: inv }, '100 Trying', {})));

  const send = (p: Node, caption: string, rfc?: string) => {
    const m = w.forward(inv, LB, { initial: true, retarget: p.contact });
    step(() => w.msg(LB, p, 'INVITE', caption, m, rfc ? { rfc } : {}));
    return m;
  };
  const fail = (p: Node, m: Msg, status: string, caption: string, more: { extra?: string[]; rfc?: string }) => {
    step(() => w.msg(p, LB, status, caption, w.response({ from: LB, to: p, msg: m }, status, { tag: p.tag, extra: more.extra }), more.rfc ? { rfc: more.rfc } : {}));
    step(() => w.msg(LB, p, 'ACK', 'The load balancer acknowledges the failure on this hop.', w.ackNon2xx({ from: LB, to: p, msg: m }, p.tag!)));
  };
  const answer = (p: Node, m: Msg) => {
    const r = (status: string, more: Partial<Msg>) => w.response({ from: LB, to: p, msg: m }, status, { tag: p.tag, contact: p.contact, ...more });
    const r180 = r('180 Ringing', {});
    step(() => w.msg(p, LB, '180 Ringing', `${p.label} rings Bob's phone.`, r180));
    step(() => w.msg(LB, ALICE, '180 Ringing', 'The load balancer removes its Via and forwards the 180.', { ...r180, via: r180.via.slice(1) }));
    const r200 = r('200 OK', { sdp: sdp({ user: 'bob', id: 2890844527, ip: p.ip, port: 30000, pts: [0] }) });
    step(() => w.msg(p, LB, '200 OK', `Bob answers. ${p.label} relays his media.`, r200), at + 4);
    step(() => w.msg(LB, ALICE, '200 OK', 'The load balancer forwards the 200 OK. It did not Record-Route, so it leaves the dialog now.', { ...r200, via: r200.via.slice(1) }));
    step(() => w.msg(ALICE, p, 'ACK', `Alice sends the ACK straight to ${p.label}, the Contact in the 200 OK.`,
      { line: `ACK ${p.contact} SIP/2.0`, via: [w.via(ALICE)], maxForwards: 70, from: inv.from, to: withTag(inv.to, p.tag!), cseq: '314159 ACK' }));
  };
  const reject = (m: Msg, p: Node, status: string, caption: string) => {
    const r = w.response({ from: LB, to: p, msg: m }, status, { tag: p.tag });
    step(() => w.msg(LB, ALICE, status, caption, { ...r, via: r.via.slice(1) }));
    step(() => w.msg(ALICE, LB, 'ACK', 'Alice acknowledges it.', w.ackNon2xx({ from: ALICE, to: LB, msg: inv }, p.tag!)));
  };

  if (o.probe && o.failure === 'down') {
    answer(PBX_B, send(PBX_B, 'The load balancer knows that PBX A is down, so it sends the INVITE to PBX B at once.'));
  } else if (o.failure === 'down') {
    const m = send(PBX_A, 'PBX A is next in the round robin. The load balancer does not know that PBX A is down.');
    w.steps[w.steps.length - 1]!.lost = true;
    step(() => w.msg(LB, PBX_A, 'INVITE (retransmission)', 'No 100 Trying comes back. The load balancer sends the INVITE again, and again, with longer gaps.', m, { lost: true }), at + 0.5);
    step(() => w.msg(LB, PBX_A, 'INVITE (retransmission)', 'Still no answer. Alice hears nothing at all.', m, { lost: true, rfc: 'rfc3261-17.1.1.2-timer-b' }), at + 1);
    at = 32;
    const m2 = send(PBX_B, 'Timer B fires after 32 seconds. Only now does the load balancer try PBX B, with a new branch.', 'rfc3263-4.3-new-branch');
    w.steps[w.steps.length - 1]!.warn = 'Alice waited 32 seconds in silence. Most callers hang up before this.';
    answer(PBX_B, m2);
  } else if (o.failure === 'overload') {
    const m = send(PBX_A, 'PBX A is next in the round robin.');
    fail(PBX_A, m, '503 Service Unavailable', 'PBX A has too many calls. It answers at once: 503, try again in 30 seconds.', { extra: ['Retry-After: 30'], rfc: 'rfc3261-20.33-retry-after' });
    answer(PBX_B, send(PBX_B, 'A 503 is a failure of PBX A, not of the call. The load balancer tries PBX B, and sends PBX A nothing for 30 seconds.', 'rfc3263-4.3-failure'));
  } else if (o.failure === 'decline') {
    const m = send(PBX_A, 'PBX A is next in the round robin.');
    const r180 = w.response({ from: LB, to: PBX_A, msg: m }, '180 Ringing', { tag: PBX_A.tag, contact: PBX_A.contact });
    step(() => w.msg(PBX_A, LB, '180 Ringing', 'PBX A rings Bob\'s phone.', r180));
    step(() => w.msg(LB, ALICE, '180 Ringing', 'The load balancer forwards the 180.', { ...r180, via: r180.via.slice(1) }));
    fail(PBX_A, m, '603 Decline', 'Bob sees who is calling, and presses Decline.', o.failoverAll ? {} : { rfc: 'rfc3261-16.7-6xx' });
    if (o.failoverAll) {
      const m2 = send(PBX_B, 'This load balancer tries the next PBX after any failure. PBX B rings Bob\'s phone again.');
      w.steps[w.steps.length - 1]!.warn = 'Bob declined the call, and his phone rings again. A 6xx means: try nowhere else.';
      step(() => w.msg(PBX_B, LB, '180 Ringing', 'Bob\'s phone rings a second time.', w.response({ from: LB, to: PBX_B, msg: m2 }, '180 Ringing', { tag: PBX_B.tag, contact: PBX_B.contact })));
      fail(PBX_B, m2, '603 Decline', 'Bob declines again.', {});
      reject(m2, PBX_B, '603 Decline', 'Only now does Alice learn that Bob declined.');
    } else {
      reject(m, PBX_A, '603 Decline', 'A 6xx is the final answer of the user. The load balancer passes it on and tries no other PBX.');
    }
  } else {
    answer(PBX_A, send(PBX_A, 'PBX A is next in the round robin.'));
  }

  const sentA = w.steps.some(s => s.to === 'pbxA' || s.from === 'pbxA');
  const sentB = w.steps.some(s => s.to === 'pbxB' || s.from === 'pbxB');
  return {
    id: `balance-${balanceKey(o)}`,
    title: `Load balancing${o.probe ? ', with health checks' : ', no health checks'}: PBX A ${FAILURES[o.failure].toLowerCase()}`,
    lanes: [ALICE, LB, ...(sentA ? [PBX_A] : []), ...(sentB ? [PBX_B] : [])].map(n => ({ id: n.id, label: n.label, kind: n.kind, sub: n.ip })),
    steps: w.steps,
  };
}
