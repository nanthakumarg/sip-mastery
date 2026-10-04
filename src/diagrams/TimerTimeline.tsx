/**
 * Timer timeline (Module 8.4): when each sender transmits, on a time axis.
 * T1 doubles (to T2, for most timers) until 64×T1 ends the attempt. Change
 * T1 or the transport and every row moves with it.
 */
import { useState } from 'react';
import { retransmitTimes, secs } from '../sip/transaction.ts';

interface Row {
  id: string;
  title: string;
  who: string;
  sends: number[];
  end: number;
  endLabel: string;
  rule: string;
}

const T2 = 4000, T4 = 5000;

function rows(T1: number, udp: boolean): Row[] {
  const B = 64 * T1;
  return [
    {
      id: 'a', title: 'INVITE request', who: 'Client transaction', end: B, endLabel: 'Timer B: timeout',
      sends: udp ? retransmitTimes('A', T1, T2) : [0],
      rule: udp ? 'Timer A starts at T1 and doubles each time, with no cap. A 1xx response stops it.' : 'No Timer A over TCP: the INVITE goes once. Timer B still runs.',
    },
    {
      id: 'e', title: 'Non-INVITE request', who: 'Client transaction', end: B, endLabel: 'Timer F: timeout',
      sends: udp ? retransmitTimes('E', T1, T2) : [0],
      rule: udp ? 'Timer E starts at T1 and doubles up to T2. After a 1xx, it stays at T2.' : 'No Timer E over TCP: the request goes once. Timer F still runs.',
    },
    {
      id: 'g', title: '300–699 to INVITE', who: 'Server transaction', end: B, endLabel: 'Timer H: no ACK',
      sends: udp ? retransmitTimes('G', T1, T2) : [0],
      rule: udp ? 'Timer G starts at T1 and doubles up to T2. The ACK stops it.' : 'No Timer G over TCP: the response goes once. Timer H still waits for the ACK.',
    },
    {
      id: '2xx', title: '2xx to INVITE', who: 'UA core of the UAS', end: B, endLabel: 'No ACK: send BYE',
      sends: retransmitTimes('G', T1, T2),
      rule: 'The UA core sends the 2xx again at T1, doubling up to T2, until the ACK arrives — over every transport, because a later hop may use UDP.',
    },
  ];
}

const WAITS = (T1: number, udp: boolean) => [
  { name: 'Timer D', ms: udp ? 32_000 : 0, who: 'INVITE client, Completed', why: 'absorbs copies of the 300–699' },
  { name: 'Timer I', ms: udp ? T4 : 0, who: 'INVITE server, Confirmed', why: 'absorbs copies of the ACK' },
  { name: 'Timer J', ms: udp ? 64 * T1 : 0, who: 'Non-INVITE server, Completed', why: 'answers copies of the request' },
  { name: 'Timer K', ms: udp ? T4 : 0, who: 'Non-INVITE client, Completed', why: 'absorbs copies of the response' },
];

const T1S = [250, 500, 1000, 2000];

export default function TimerTimeline() {
  const [T1, setT1] = useState(500);
  const [udp, setUdp] = useState(true);
  const [sel, setSel] = useState('a');
  const list = rows(T1, udp);
  const max = Math.max(64 * T1, 32_000) * 1.04;
  const step = max > 70_000 ? 16_000 : max > 36_000 ? 8000 : 4000;
  const ticks = Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step);
  const pct = (ms: number) => `${(ms / max) * 100}%`;
  const r = list.find(x => x.id === sel)!;

  return (
    <section className="ttl" aria-label="Timer timeline">
      <header className="stage-head">
        <div>
          <p className="eyebrow">Timer timeline</p>
          <p className="stage-title">T1 doubles; 64×T1 ({secs(64 * T1)}) ends the attempt</p>
        </div>
        <ul className="legend" aria-label="Legend">
          <li><span className="ttl-key is-first" />First send</li>
          <li><span className="ttl-key" />Retransmission</li>
          <li><span className="ttl-key is-end" />Timeout</li>
        </ul>
      </header>

      <div className="tp-controls">
        <div className="seg" role="group" aria-label="T1">
          {T1S.map(v => <button key={v} type="button" aria-pressed={T1 === v} onClick={() => setT1(v)}>T1 = {v < 1000 ? `${v} ms` : secs(v)}</button>)}
        </div>
        <div className="seg" role="group" aria-label="Transport">
          <button type="button" aria-pressed={udp} onClick={() => setUdp(true)}>UDP</button>
          <button type="button" aria-pressed={!udp} onClick={() => setUdp(false)}>TCP</button>
        </div>
      </div>

      <div className="ttl-chart">
        {list.map(x => (
          <button key={x.id} type="button" className={`ttl-row${x.id === sel ? ' is-sel' : ''}`} aria-pressed={x.id === sel} onClick={() => setSel(x.id)}>
            <span className="ttl-name"><b>{x.title}</b><span>{x.who} · {x.sends.length} {x.sends.length === 1 ? 'send' : 'sends'}</span></span>
            <span className="ttl-track">
              <span className="ttl-span" style={{ width: pct(x.end) }} />
              {x.sends.map((s, i) => <i key={s} className={`ttl-tick${i === 0 ? ' is-first' : ''}`} style={{ left: pct(s) }} title={`${i === 0 ? 'First send' : `Copy ${i}`} at ${secs(s)}`} />)}
              <i className="ttl-end" style={{ left: pct(x.end) }} title={`${x.endLabel} at ${secs(x.end)}`} />
              <em className="ttl-end-label" style={{ left: pct(x.end) }}>{x.endLabel}</em>
            </span>
          </button>
        ))}
        <div className="ttl-axis" aria-hidden="true">
          <span className="ttl-name" />
          <span className="ttl-track">
            {ticks.map(t => <span key={t} className="ttl-axis-tick" style={{ left: pct(t) }}>{t / 1000} s</span>)}
          </span>
        </div>
      </div>

      <div className="ttl-detail" aria-live="polite">
        <p className="ttl-rule">{r.rule}</p>
        <ol className="ttl-sends">
          {r.sends.map((s, i) => (
            <li key={s}><b>{secs(s)}</b>{i > 0 && <span>+{secs(s - r.sends[i - 1]!)}</span>}</li>
          ))}
          <li className="is-end"><b>{secs(r.end)}</b><span>{r.endLabel}</span></li>
        </ol>
      </div>

      <div className="ttl-waits">
        <p className="eyebrow">After the final response: the waiting timers</p>
        <table className="ttl-table">
          <thead><tr><th scope="col">Timer</th><th scope="col">Value ({udp ? 'UDP' : 'TCP'})</th><th scope="col">State</th><th scope="col">Why it waits</th></tr></thead>
          <tbody>
            {WAITS(T1, udp).map(w => (
              <tr key={w.name}><th scope="row">{w.name}</th><td>{secs(w.ms)}</td><td>{w.who}</td><td>{w.why}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
