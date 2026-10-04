/**
 * Transaction simulator (Module 8): one hop between Alice's client
 * transaction and Bob's server transaction, with the state machines and
 * timers of RFC 3261 §17, the 2xx handling of §13, and, as an option, the
 * "Accepted" state of RFC 6026.
 *
 * The simulation is deterministic and has no network delay: the same options
 * give the same rows, so losing one message changes only what comes after it.
 * Each row is one event: a message on the wire, or a timer that fires.
 */

export type TxKind = 'invite' | 'non-invite';
export type Side = 'client' | 'server';

export interface SimOptions {
  kind: TxKind;
  transport: 'udp' | 'tcp';
  /** The final response that Bob's TU sends: 200 or a 3xx–6xx code. */
  final: number;
  /** Use the "Accepted" state of RFC 6026 for a 2xx to INVITE. */
  rfc6026?: boolean;
  /**
   * Messages that the network loses. "INVITE#1" is the first INVITE, "ACK#2"
   * the second ACK; "ACK*" loses every ACK; "server*" loses everything sent
   * to the server (the server is down).
   */
  drop?: string[];
  /** Non-INVITE only: Bob's TU answers after 6 s instead of at once. */
  slow?: boolean;
  T1?: number;
  T2?: number;
  T4?: number;
}

export interface SimMessage {
  /** Stable id used to drop the message, e.g. "INVITE#2". */
  id: string;
  label: string;
  from: Side;
  lost: boolean;
  /** A copy of a message that was sent before. */
  retrans: boolean;
  /** Sent by the UA core, not by the transaction (2xx, its ACK, BYE). */
  core: boolean;
}

export interface SimTimer { side: Side; name: string; at: number }

export interface SimMove { side: Side; from: string; to: string; on: string }

export interface SimRow {
  t: number;
  msg?: SimMessage;
  /** A timer that fired to cause this row. */
  timer?: { side: Side; name: string };
  text: string;
  /** Transaction states after this row. "—" means no transaction yet. */
  client: string;
  server: string;
  /** State changes in this row. from === to means the state did not change. */
  moves: SimMove[];
  /** Running timers after this row. */
  timers: SimTimer[];
}

export const PHRASE: Record<number, string> = {
  100: 'Trying', 180: 'Ringing', 200: 'OK', 302: 'Moved Temporarily', 404: 'Not Found',
  480: 'Temporarily Unavailable', 486: 'Busy Here', 503: 'Service Unavailable', 603: 'Decline',
};

/** "0.5 s", "31.5 s", "32 s" */
export const secs = (ms: number) => `${Number((ms / 1000).toFixed(2))} s`;

const MAX_T = 120_000;

export function simulate(o: SimOptions): SimRow[] {
  const T1 = o.T1 ?? 500, T2 = o.T2 ?? 4000, T4 = o.T4 ?? 5000;
  const udp = o.transport === 'udp';
  const invite = o.kind === 'invite';
  const method = invite ? 'INVITE' : 'OPTIONS';
  const accepted = !!o.rfc6026;
  const drop = new Set(o.drop ?? []);

  const rows: SimRow[] = [];
  let t = 0;
  let seq = 0;
  let row: SimRow | undefined;
  const queue: { t: number; seq: number; run: () => void }[] = [];
  const later = (at: number, run: () => void) => queue.push({ t: at, seq: seq++, run });

  const state: Record<Side, string> = { client: '—', server: '—' };
  const timers = new Map<string, SimTimer & { token: number }>();
  /** The last interval of each timer, kept after it fires, so a retransmit timer can double it. */
  const intervals = new Map<string, number>();
  const counts: Record<string, number> = {};
  let lastProvisional: string | undefined;
  let finalSent: string | undefined;

  const start = (text: string, timer?: { side: Side; name: string }) => {
    row = { t, text, client: '', server: '', moves: [], timers: [], ...(timer ? { timer } : {}) };
    rows.push(row);
    return row;
  };
  const say = (text: string) => { row!.text += ` ${text}`; };
  const move = (side: Side, to: string, on: string) => {
    row!.moves.push({ side, from: state[side], to, on });
    state[side] = to;
    if (to === 'Terminated') for (const [k, v] of timers) if (v.side === side && !v.name.startsWith('2xx')) timers.delete(k);
  };
  const loop = (side: Side, on: string) => row!.moves.push({ side, from: state[side], to: state[side], on });

  const setTimer = (side: Side, name: string, ms: number, fire: () => void) => {
    const token = seq;
    timers.set(`${side}:${name}`, { side, name, at: t + ms, token });
    intervals.set(`${side}:${name}`, ms);
    later(t + ms, () => {
      const cur = timers.get(`${side}:${name}`);
      if (cur?.token !== token) return; // cancelled or reset
      timers.delete(`${side}:${name}`);
      fire();
    });
  };
  const stop = (side: Side, ...names: string[]) => { for (const n of names) timers.delete(`${side}:${n}`); };
  const every = (side: Side, name: string) => intervals.get(`${side}:${name}`) ?? 0;

  /** Puts a message on the wire. Returns false if the network loses it. */
  const send = (from: Side, label: string, opts: { retrans?: boolean; core?: boolean } = {}) => {
    const key = label.split(' ')[0]!;
    counts[key] = (counts[key] ?? 0) + 1;
    const id = `${key}#${counts[key]}`;
    const lost = drop.has(id) || drop.has(`${key}*`) || (from === 'client' && drop.has('server*'));
    row!.msg = { id, label, from, lost, retrans: !!opts.retrans, core: !!opts.core };
    if (lost) say('The network loses it.');
    return !lost;
  };

  const C = 'Alice', S = 'Bob';
  const resp = (code: number) => `${code} ${PHRASE[code] ?? ''}`.trim();

  // ---------- Client transaction ----------

  const clientTimeout = (name: string) => {
    start(`${name} fires: ${C} has no response after 64×T1 (${secs(64 * T1)}).`, { side: 'client', name });
    move('client', 'Terminated', name);
    say(`The transaction ends, and the TU reports a timeout (408).`);
  };

  const clientResend = (name: string) => {
    const next = invite ? every('client', name) * 2 : state.client === 'Proceeding' ? T2 : Math.min(every('client', name) * 2, T2);
    start(`${name} fires: ${C} sends the same ${method} again — same branch, same CSeq.`, { side: 'client', name });
    loop('client', `${name} · send again`);
    setTimer('client', name, next, () => clientResend(name));
    say(`${name} restarts with ${secs(next)}.`);
    if (send('client', method, { retrans: true })) serverGetsRequest();
  };

  const clientGetsResponse = (code: number, retrans: boolean) => {
    const s = state.client;
    if (code < 200) {
      if (s === 'Calling' || s === 'Trying') {
        move('client', 'Proceeding', '1xx');
        if (invite) { stop('client', 'Timer A', 'Timer B'); say(`${C} moves to Proceeding and stops sending the INVITE again.`); }
        else say(`${C} moves to Proceeding. Timer E now waits ${secs(T2)} (T2) between copies.`);
      } else if (s === 'Proceeding') { loop('client', '1xx · to TU'); say(`${C} passes it to the TU.`); }
      else say(`${C} ignores it.`);
      return;
    }
    if (invite && code < 300) {
      if (s === 'Calling' || s === 'Proceeding') {
        stop('client', 'Timer A', 'Timer B');
        if (accepted) {
          move('client', 'Accepted', '2xx');
          setTimer('client', 'Timer M', 64 * T1, () => {
            start(`Timer M fires: no more 2xx can arrive.`, { side: 'client', name: 'Timer M' });
            move('client', 'Terminated', 'Timer M');
            say(`${C}'s INVITE client transaction ends.`);
          });
          say(`${C} moves to Accepted (RFC 6026) and passes the 200 OK to the UA core. The core sends the ACK, not the transaction.`);
        } else {
          move('client', 'Terminated', '2xx');
          say(`${C}'s transaction passes the 200 OK to the UA core and ends at once. The core sends the ACK.`);
        }
      } else if (s === 'Accepted') { loop('client', '2xx · to TU'); say(`It matches the Accepted transaction, which passes it to the UA core.`); }
      else say(`No client transaction matches any more, so the 200 OK goes straight to the UA core.`);
      later(t, () => {
        start(`${C}'s UA core acknowledges the ${retrans ? 'copy of the ' : ''}200 OK. The ACK is a new transaction: it has a new branch.`);
        if (send('client', 'ACK', { core: true, retrans: retrans })) serverGetsAck2xx();
      });
      return;
    }
    if (invite) {
      if (s === 'Calling' || s === 'Proceeding') {
        stop('client', 'Timer A', 'Timer B');
        move('client', 'Completed', '300–699');
        setTimer('client', 'Timer D', udp ? 32_000 : 0, () => {
          start(`Timer D fires${udp ? '' : ' at once (0 s on TCP)'}.`, { side: 'client', name: 'Timer D' });
          move('client', 'Terminated', 'Timer D');
          say(`${C} stops waiting for copies of the ${resp(code)}.`);
        });
        say(`${C} moves to Completed, passes the ${code} to the TU, and starts Timer D (${udp ? '32 s' : '0 s'}).`);
      } else if (s === 'Completed') { loop('client', '300–699 · send ACK again'); say(`It is a copy, so ${C} sends the ACK again and does not tell the TU.`); }
      else { say(`No transaction matches. ${C} drops it.`); return; }
      later(t, () => {
        start(`${C}'s transaction sends the ACK for the ${code}. It is part of the INVITE transaction: same branch, CSeq method ACK.`);
        if (send('client', 'ACK', { retrans: counts.ACK! > 0 })) serverGetsAckNon2xx();
      });
      return;
    }
    // non-INVITE final response
    if (s === 'Trying' || s === 'Proceeding') {
      stop('client', 'Timer E', 'Timer F');
      move('client', 'Completed', '200–699');
      setTimer('client', 'Timer K', udp ? T4 : 0, () => {
        start(`Timer K fires${udp ? '' : ' at once (0 s on TCP)'}.`, { side: 'client', name: 'Timer K' });
        move('client', 'Terminated', 'Timer K');
        say(`${C}'s transaction ends.`);
      });
      say(`${C} moves to Completed and passes the ${code} to the TU. Timer K (${udp ? secs(T4) : '0 s'}) absorbs late copies.`);
    } else if (s === 'Completed') { loop('client', '200–699 · absorb'); say(`It is a copy. ${C} absorbs it.`); }
    else say(`No transaction matches. ${C} drops it.`);
  };

  // ---------- Server transaction ----------

  const respond = (code: number, opts: { retrans?: boolean; core?: boolean } = {}) => {
    if (send('server', resp(code), opts)) clientGetsResponse(code, !!opts.retrans);
  };

  const tuAnswers = () => {
    if (invite) {
      later(t, () => {
        start(`${S} sends 100 Trying at once. It stops ${C}'s INVITE copies.`);
        lastProvisional = resp(100);
        respond(100);
      });
      later(t + 1000, () => {
        if (state.server !== 'Proceeding') return;
        start(`${S}'s phone rings. The TU sends 180 Ringing.`);
        lastProvisional = resp(180);
        respond(180);
      });
      later(t + 4000, () => serverFinal());
    } else if (o.slow) {
      later(t + 3500, () => {
        if (state.server !== 'Trying') return;
        start(`${S} has no answer yet after ${secs(3500)}, so it sends 100 Trying (RFC 4320).`);
        move('server', 'Proceeding', '1xx from TU');
        lastProvisional = resp(100);
        respond(100);
      });
      later(t + 6000, () => serverFinal());
    } else {
      later(t, () => serverFinal());
    }
  };

  const serverFinal = () => {
    const code = o.final;
    finalSent = resp(code);
    if (invite && code < 300) {
      start(`${S} answers: the TU sends 200 OK.`);
      if (accepted) {
        move('server', 'Accepted', '2xx from TU');
        setTimer('server', 'Timer L', 64 * T1, () => {
          start(`Timer L fires.`, { side: 'server', name: 'Timer L' });
          move('server', 'Terminated', 'Timer L');
          say(`${S}'s INVITE server transaction ends.`);
        });
        say(`${S}'s transaction moves to Accepted (RFC 6026) and absorbs INVITE copies for 64×T1.`);
      } else {
        move('server', 'Terminated', '2xx from TU');
        say(`${S}'s transaction ends at once. From now on, the UA core sends the 200 OK again until the ACK arrives.`);
      }
      setTimer('server', '2xx resend', T1, resend2xx);
      setTimer('server', '2xx give-up', 64 * T1, giveUp);
      respond(code);
      return;
    }
    start(`${S}'s TU sends the final response ${resp(code)}.`);
    move('server', 'Completed', invite ? '300–699 from TU' : '200–699 from TU');
    if (invite) {
      if (udp) setTimer('server', 'Timer G', T1, () => resendFinal(code));
      setTimer('server', 'Timer H', 64 * T1, () => {
        start(`Timer H fires: no ACK came in 64×T1 (${secs(64 * T1)}).`, { side: 'server', name: 'Timer H' });
        move('server', 'Terminated', 'Timer H');
        say(`${S}'s transaction ends and tells the TU that it failed.`);
      });
      say(udp ? `Timer G (${secs(T1)}) and Timer H (${secs(64 * T1)}) start.` : `Timer H (${secs(64 * T1)}) starts. Over TCP, there is no Timer G.`);
    } else {
      setTimer('server', 'Timer J', udp ? 64 * T1 : 0, () => {
        start(`Timer J fires${udp ? '' : ' at once (0 s on TCP)'}.`, { side: 'server', name: 'Timer J' });
        move('server', 'Terminated', 'Timer J');
        say(`${S}'s transaction ends.`);
      });
      say(`Timer J (${udp ? secs(64 * T1) : '0 s'}) starts, to answer copies of the request.`);
    }
    respond(code);
  };

  const resendFinal = (code: number) => {
    const next = Math.min(every('server', 'Timer G') * 2, T2);
    start(`Timer G fires: no ACK yet. ${S} sends the ${resp(code)} again.`, { side: 'server', name: 'Timer G' });
    loop('server', 'Timer G · send again');
    setTimer('server', 'Timer G', next, () => resendFinal(code));
    say(`Timer G restarts with ${secs(next)}.`);
    respond(code, { retrans: true });
  };

  const resend2xx = () => {
    const next = Math.min(every('server', '2xx resend') * 2, T2);
    start(`No ACK yet. ${S}'s UA core sends the 200 OK again (${secs(next)} until the next copy).`, { side: 'server', name: '2xx resend' });
    setTimer('server', '2xx resend', next, resend2xx);
    respond(200, { retrans: true, core: true });
  };

  const giveUp = () => {
    start(`No ACK for 64×T1 (${secs(64 * T1)}). ${S}'s UA core gives up and ends the call with BYE.`, { side: 'server', name: '2xx give-up' });
    stop('server', '2xx resend');
    send('server', 'BYE', { core: true });
    say(`The call was up for only ${secs(64 * T1)}.`);
    queue.length = 0;
    for (const k of [...timers.keys()]) timers.delete(k);
  };

  const serverGetsRequest = () => {
    const s = state.server;
    if (s === '—') {
      move('server', invite ? 'Proceeding' : 'Trying', 'request');
      say(`${S} creates a server transaction (${state.server}) and passes the ${method} to the TU.`);
      tuAnswers();
      return;
    }
    if (s === 'Proceeding' && lastProvisional) {
      loop('server', 'request · send 1xx again');
      say(`${S} matches the branch: it is a copy. ${S} does not pass it to the TU.`);
      const p = lastProvisional;
      later(t, () => { start(`${S} sends the last provisional response again, because the request came again.`); respond(Number(p.split(' ')[0]), { retrans: true }); });
    } else if (s === 'Completed' && finalSent) {
      loop('server', 'request · send final again');
      say(`${S} matches the branch: it is a copy. ${S} sends the final response again.`);
      const code = Number(finalSent.split(' ')[0]);
      later(t, () => { start(`${S} sends the ${finalSent} again, because the request came again.`); respond(code, { retrans: true }); });
    } else if (s === 'Terminated' && invite && !accepted) {
      say(`No server transaction matches any more. Without RFC 6026, ${S} could treat it as a new INVITE.`);
    } else {
      loop('server', 'request · absorb');
      say(`${S} matches the branch: it is a copy. ${S} absorbs it.`);
    }
  };

  const serverGetsAckNon2xx = () => {
    if (state.server === 'Completed') {
      stop('server', 'Timer G', 'Timer H');
      move('server', 'Confirmed', 'ACK');
      setTimer('server', 'Timer I', udp ? T4 : 0, () => {
        start(`Timer I fires${udp ? '' : ' at once (0 s on TCP)'}.`, { side: 'server', name: 'Timer I' });
        move('server', 'Terminated', 'Timer I');
        say(`${S}'s transaction ends.`);
      });
      say(`${S} matches it to the INVITE transaction and moves to Confirmed. The copies of the response stop. Timer I (${udp ? secs(T4) : '0 s'}) absorbs late ACKs.`);
    } else if (state.server === 'Confirmed') {
      loop('server', 'ACK · absorb');
      say(`${S} absorbs the extra ACK.`);
    }
  };

  const serverGetsAck2xx = () => {
    if (state.server === 'Accepted') loop('server', 'ACK · to TU');
    say(state.server === 'Accepted'
      ? `${S}'s transaction is in Accepted and passes the ACK to the UA core.`
      : `No server transaction matches: the ACK goes to ${S}'s UA core.`);
    if (timers.has('server:2xx resend')) {
      stop('server', '2xx resend', '2xx give-up');
      say(`The core stops sending the 200 OK. The call is up.`);
    }
  };

  // ---------- Run ----------

  start(`${C}'s TU starts an ${method} client transaction (${invite ? 'Calling' : 'Trying'}).`);
  move('client', invite ? 'Calling' : 'Trying', `${method} from TU`);
  if (!udp && drop.has('server*')) {
    send('client', method);
    row!.msg!.lost = true;
    move('client', 'Terminated', 'transport error');
    row!.text = `${C} cannot open a TCP connection to ${S}. The transport reports an error, so the transaction ends at once and the TU reports 503.`;
  } else {
    const name = invite ? 'Timer A' : 'Timer E';
    const timeout = invite ? 'Timer B' : 'Timer F';
    if (udp) setTimer('client', name, T1, () => clientResend(name));
    setTimer('client', timeout, 64 * T1, () => clientTimeout(timeout));
    say(udp
      ? `${name} (${secs(T1)}) and ${timeout} (${secs(64 * T1)}) start.`
      : `Only ${timeout} (${secs(64 * T1)}) starts: TCP delivers the ${method}, so ${C} never sends it again.`);
    if (send('client', method)) serverGetsRequest();
  }
  snapshot(rows.length - 1);

  let done = rows.length;
  for (let guard = 0; queue.length && guard < 5000; guard++) {
    queue.sort((a, b) => a.t - b.t || a.seq - b.seq);
    const item = queue.shift()!;
    if (item.t > MAX_T) break;
    t = item.t;
    item.run();
    for (; done < rows.length; done++) snapshot(done);
  }
  return rows;

  function snapshot(i: number) {
    const r = rows[i]!;
    r.client = state.client;
    r.server = state.server;
    r.timers = [...timers.values()].map(({ side, name, at }) => ({ side, name, at })).sort((a, b) => a.at - b.at);
  }
}

/** Times at which a sender transmits a request or response over UDP, given the timer rule. */
export function retransmitTimes(rule: 'A' | 'E' | 'G', T1 = 500, T2 = 4000, until = 64 * T1): number[] {
  const out = [0];
  let at = 0, gap = T1;
  while (at + gap < until) {
    at += gap;
    out.push(at);
    gap = rule === 'A' ? gap * 2 : Math.min(gap * 2, T2);
  }
  return out;
}
