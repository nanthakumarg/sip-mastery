/**
 * Transport race (Module 19): one SIP message of a chosen size, sent over UDP
 * and over TCP on the same lossy path. Over UDP it may become IP fragments,
 * and one lost fragment loses the whole message; SIP then resends all of it.
 * Over TCP, only the lost segment is sent again. The model is src/net/transport.ts.
 */
import { useMemo, useState } from 'react';
import { race } from '../net/transport.ts';

const MTUS: [number, string][] = [[1500, '1500 Ethernet'], [1492, '1492 PPPoE'], [1400, '1400 VPN tunnel'], [1280, '1280 IPv6 minimum']];

function Slider({ label, value, min, max, step, unit, onChange }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void }) {
  return (
    <label className="jb-slider">
      <span>{label}<b>{value}{unit}</b></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} />
    </label>
  );
}

const sec = (s: number) => (s < 1 ? `${Math.round(s * 1000)} ms` : `${s.toFixed(1)} s`);

export default function TransportRace() {
  const [size, setSize] = useState(1410);
  const [mtu, setMtu] = useState(1400);
  const [loss, setLoss] = useState(2);
  const [drop, setDrop] = useState(true);
  const [seed, setSeed] = useState(5);
  const r = useMemo(() => race({ sipBytes: size, mtu, ipv6: false, loss, dropFragments: drop, delay: 40, seed }), [size, mtu, loss, drop, seed]);
  const n = r.fragments.length;

  return (
    <figure className="stage trace" aria-label="Transport race">
      <header className="stage-head">
        <div>
          <p className="eyebrow">Transport race · the same message over UDP and TCP</p>
          <p className="stage-title">Does a {size}-byte INVITE get through?</p>
        </div>
        <ul className="legend" aria-label="Legend">
          <li><i className="trace-lg-ok" />Arrived</li>
          <li><i className="lg-down" />Lost</li>
        </ul>
      </header>

      <div className="jb-controls">
        <Slider label="SIP message size" value={size} min={400} max={4000} step={10} unit=" bytes" onChange={setSize} />
        <Slider label="Packet loss" value={loss} min={0} max={20} step={0.5} unit="%" onChange={setLoss} />
      </div>
      <div className="trace-row">
        <div className="seg trace-mtu" role="group" aria-label="Path MTU">
          {MTUS.map(([v, l]) => <button key={v} type="button" aria-pressed={mtu === v} onClick={() => setMtu(v)}>{l}</button>)}
        </div>
        <button type="button" className="rl-toggle" aria-pressed={drop} onClick={() => setDrop(!drop)}><span aria-hidden="true">{drop ? '●' : '○'}</span>A firewall drops IP fragments</button>
        <button type="button" className="rl-toggle" onClick={() => setSeed(s => s + 1)}>Send again</button>
      </div>

      <p className={`trace-rule${r.rule.mustUseCongestionControlled ? ' is-bad' : ''}`}><b>RFC 3261 §18.1.1:</b> {r.rule.reason}</p>

      <div className="trace-lanes">
        <section className={`trace-lane${r.udp.delivered ? '' : ' is-bad'}`}>
          <p className="trace-name">UDP <span>{n === 1 ? 'one packet' : `${n} IP fragments per send`}</span></p>
          <ol className="trace-sends">
            {r.udp.attempts.map((a, i) => (
              <li key={i}>
                <span className="trace-t">{i === 0 ? 'send' : 'resend'} {sec(a.at)}</span>
                <span className="trace-frags">
                  {a.fragments.map((ok, k) => <i key={k} className={ok ? 'is-ok' : 'is-lost'} title={`fragment ${k + 1}: ${ok ? 'arrived' : 'lost'}`}>{ok ? '' : '✕'}</i>)}
                </span>
                <span className="trace-v">{a.ok ? 'delivered' : 'message lost'}</span>
              </li>
            ))}
          </ol>
          <p className="trace-result">{r.udp.delivered
            ? `Delivered after ${sec(r.udp.at!)}${r.udp.attempts.length > 1 ? `, on send ${r.udp.attempts.length}` : ''}.`
            : 'Never delivered: Timer B ends the transaction after 32 s, and the caller gets 408.'}</p>
        </section>

        <section className="trace-lane">
          <p className="trace-name">TCP <span>{r.tcp.segments} segment{r.tcp.segments === 1 ? '' : 's'}, after a handshake</span></p>
          <ol className="trace-sends trace-tcp">
            {r.tcp.events.map((e, i) => (
              <li key={i} className={e.ok ? '' : 'is-lost'}>
                <span className="trace-t">{sec(e.at)}</span>
                <span className="trace-frags"><i className={e.ok ? 'is-ok' : 'is-lost'}>{e.ok ? '' : '✕'}</i></span>
                <span className="trace-v">{e.what}{e.ok ? '' : ' lost: TCP resends it'}</span>
              </li>
            ))}
          </ol>
          <p className="trace-result">Delivered after {sec(r.tcp.at)}. TCP resends only what was lost, and it never fragments: each segment fits the path.</p>
        </section>
      </div>
    </figure>
  );
}
