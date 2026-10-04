/**
 * Transaction matcher (Module 8.2): pick a message that arrives, and see how
 * the receiver compares it with its open transactions — the top Via branch,
 * the sent-by, and the method (RFC 3261 §17.1.3, §17.2.3).
 */
import { useState } from 'react';

interface Tx { id: string; method: string; branch: string; sentBy: string; state: string }
interface Msg { id: string; label: string; via: string; cseq: string; result: string }

const B = 'z9hG4bK74bf9';
const ALICE = '192.0.2.10:5060';

/** Bob's server transactions. */
const SERVER_TX: Tx[] = [
  { id: 's1', method: 'INVITE', branch: B, sentBy: ALICE, state: 'Proceeding (ringing)' },
  { id: 's2', method: 'OPTIONS', branch: 'z9hG4bK1c33', sentBy: '198.51.100.10:5060', state: 'Completed' },
];
const SERVER_MSGS: Msg[] = [
  { id: 'inv', label: 'INVITE again', via: `SIP/2.0/UDP ${ALICE};branch=${B}`, cseq: '1 INVITE',
    result: 'A retransmission. Bob sends the last provisional response (180) again. The TU does not see the copy.' },
  { id: 'cancel', label: 'CANCEL', via: `SIP/2.0/UDP ${ALICE};branch=${B}`, cseq: '1 CANCEL',
    result: 'The method differs, so the CANCEL starts its own server transaction and gets its own 200 OK. Bob then finds the INVITE with the same branch (§9.2), stops ringing, and answers it 487.' },
  { id: 'ack', label: 'ACK for the 487', via: `SIP/2.0/UDP ${ALICE};branch=${B}`, cseq: '1 ACK',
    result: 'For an ACK, the method to match is INVITE. This ACK belongs to the INVITE transaction: it moves to Confirmed and Timer G stops.' },
  { id: 'ack2xx', label: 'ACK for a 200 OK', via: `SIP/2.0/UDP ${ALICE};branch=z9hG4bK5a1e0`, cseq: '1 ACK',
    result: 'A new branch: no transaction matches. The ACK for a 2xx is its own transaction. It goes to the UA core, which matches it to the dialog.' },
  { id: 'reinv', label: 're-INVITE', via: `SIP/2.0/UDP ${ALICE};branch=z9hG4bK8d2c7`, cseq: '2 INVITE',
    result: 'A new branch and a new CSeq: a new request. Bob creates a new INVITE server transaction.' },
  { id: 'other', label: 'Same branch, other sender', via: `SIP/2.0/UDP 203.0.113.99:5060;branch=${B}`, cseq: '1 INVITE',
    result: 'The branch is equal, but the sent-by is not. Another client chose the same value, by accident or on purpose. Bob creates a new transaction.' },
  { id: 'old', label: 'No magic cookie', via: `SIP/2.0/UDP ${ALICE};branch=74bf9`, cseq: '1 INVITE',
    result: 'The branch does not start with z9hG4bK, so it may not be unique. Bob falls back to the RFC 2543 rules: it compares the Request-URI, the tags, Call-ID, CSeq, and the whole top Via.' },
];

/** Alice's client transactions. */
const CLIENT_TX: Tx[] = [
  { id: 'c1', method: 'INVITE', branch: B, sentBy: '', state: 'Proceeding' },
  { id: 'c2', method: 'CANCEL', branch: B, sentBy: '', state: 'Trying' },
];
const CLIENT_MSGS: Msg[] = [
  { id: '180', label: '180 Ringing', via: `SIP/2.0/UDP ${ALICE};branch=${B}`, cseq: '1 INVITE',
    result: 'Branch and CSeq method match the INVITE transaction. Alice passes the 180 to the TU.' },
  { id: '200c', label: '200 OK to the CANCEL', via: `SIP/2.0/UDP ${ALICE};branch=${B}`, cseq: '1 CANCEL',
    result: 'The branch matches both transactions. The CSeq method picks the CANCEL transaction — this is why the method is part of the match.' },
  { id: '487', label: '487 Request Terminated', via: `SIP/2.0/UDP ${ALICE};branch=${B}`, cseq: '1 INVITE',
    result: 'Matches the INVITE transaction. It moves to Completed and sends the ACK with the same branch.' },
  { id: 'stray', label: '200 OK, unknown branch', via: `SIP/2.0/UDP ${ALICE};branch=z9hG4bK0000`, cseq: '1 INVITE',
    result: 'No transaction matches: a stray response. RFC 3261 passed a stray 2xx up to the UA core. RFC 6026 drops it: real copies of a 2xx still match the INVITE transaction in its Accepted state.' },
];

const branchOf = (via: string) => /branch=([^;]+)/.exec(via)?.[1] ?? '';
const sentByOf = (via: string) => via.split(' ')[1]!.split(';')[0]!;

export default function TransactionMatcher() {
  const [side, setSide] = useState<'server' | 'client'>('server');
  const msgs = side === 'server' ? SERVER_MSGS : CLIENT_MSGS;
  const txs = side === 'server' ? SERVER_TX : CLIENT_TX;
  const [sel, setSel] = useState<Record<string, string>>({ server: 'inv', client: '200c' });
  const m = msgs.find(x => x.id === sel[side])!;
  const method = m.cseq.split(' ')[1]!;
  const cookie = branchOf(m.via).startsWith('z9hG4bK');

  const checks = (tx: Tx) => {
    const c: { name: string; ok: boolean; note?: string }[] = [{ name: 'Branch', ok: branchOf(m.via) === tx.branch }];
    if (side === 'server') {
      c.push({ name: 'Sent-by', ok: sentByOf(m.via) === tx.sentBy });
      const ok = method === tx.method || (method === 'ACK' && tx.method === 'INVITE');
      c.push({ name: 'Method', ok, note: method === 'ACK' && tx.method === 'INVITE' ? 'ACK → INVITE' : undefined });
    } else {
      c.push({ name: 'CSeq method', ok: method === tx.method });
    }
    return c;
  };
  const matched = cookie ? txs.find(tx => checks(tx).every(c => c.ok)) : undefined;

  return (
    <section className="tmatch" aria-label="Transaction matcher">
      <header className="stage-head">
        <div>
          <p className="eyebrow">Transaction matcher</p>
          <p className="stage-title">Which transaction does this message belong to?</p>
        </div>
        <div className="seg" role="group" aria-label="Receiver">
          <button type="button" aria-pressed={side === 'server'} onClick={() => setSide('server')}>Bob gets a request</button>
          <button type="button" aria-pressed={side === 'client'} onClick={() => setSide('client')}>Alice gets a response</button>
        </div>
      </header>

      <div className="tm-body">
        <div className="tm-msgs" role="group" aria-label="Arriving message">
          <p className="eyebrow">Arriving message</p>
          {msgs.map(x => (
            <button key={x.id} type="button" className={`tm-msg${x.id === m.id ? ' is-sel' : ''}`} aria-pressed={x.id === m.id}
              onClick={() => setSel(s => ({ ...s, [side]: x.id }))}>{x.label}</button>
          ))}
        </div>

        <div className="tm-work">
          <pre className="tm-head"><span className="h-name">Via:</span> {m.via.replace(/branch=[^;]+/, '')}<b className={cookie ? 'is-cookie' : 'is-old'}>branch={branchOf(m.via)}</b>{'\n'}<span className="h-name">CSeq:</span> {m.cseq}</pre>

          <table className="tm-table">
            <caption>{side === 'server' ? 'Bob’s open server transactions' : 'Alice’s open client transactions'}</caption>
            <thead>
              <tr>
                <th scope="col">Transaction</th>
                {checks(txs[0]!).map(c => <th key={c.name} scope="col">{c.name}</th>)}
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {txs.map(tx => {
                const cs = checks(tx);
                const hit = matched?.id === tx.id;
                return (
                  <tr key={tx.id} className={hit ? 'is-hit' : ''}>
                    <th scope="row"><b>{tx.method}</b><span>{tx.branch}{tx.sentBy && ` · ${tx.sentBy}`}</span><span>{tx.state}</span></th>
                    {cs.map(c => <td key={c.name} className={c.ok ? 'is-ok' : 'is-no'}>{c.ok ? '✓' : '✗'}{c.note && <small>{c.note}</small>}</td>)}
                    <td className="tm-res">{!cookie ? 'old rules' : hit ? 'match' : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className={`tm-verdict${matched ? ' is-hit' : ''}`} aria-live="polite">
            <p className="tm-verdict-title">{!cookie ? 'No magic cookie: RFC 2543 matching' : matched ? `Matches the ${matched.method} transaction` : 'No transaction matches'}</p>
            <p>{m.result}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
