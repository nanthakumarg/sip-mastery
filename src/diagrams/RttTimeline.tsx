/**
 * Round-trip time from RTCP (Module 17): Alice sends an SR; Bob holds it for
 * DLSR, then sends an RR with LSR and DLSR; Alice subtracts. Step through it,
 * and change the delays. The arithmetic is RFC 3550 §6.4.1 Figure 2.
 * The model is src/net/rtcp.ts (ntpMiddle, roundTrip).
 */
import { useState } from 'react';
import { fixed16, ntpMiddle, roundTrip, toFixed16 } from '../net/rtcp.ts';

const W = 820, H = 230, X0 = 90, X1 = W - 30, YA = 60, YB = 170;
/** Alice's SR leaves at the NTP time of RFC 3550 Figure 2. */
const T0_SEC = 0xb44db705, T0_FRAC = 0x20000000;

const STEPS = [
  'Alice sends an SR. It carries her NTP time; its middle 32 bits are the LSR.',
  'The SR reaches Bob. He notes when it arrived.',
  'Bob sends an RR after DLSR, the time he held the SR. It carries LSR and DLSR.',
  'The RR reaches Alice at time A. A − LSR − DLSR is the round trip: the network time only.',
];

function Slider({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="jb-slider">
      <span>{label}<b>{value} ms</b></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} />
    </label>
  );
}

export default function RttTimeline() {
  const [ab, setAb] = useState(40);
  const [ba, setBa] = useState(60);
  const [hold, setHold] = useState(2500);
  const [step, setStep] = useState(3);

  const lsr = ntpMiddle(T0_SEC, T0_FRAC);
  const dlsr = toFixed16(hold / 1000);
  const a = (lsr + toFixed16((ab + hold + ba) / 1000)) >>> 0;
  const rtt = roundTrip(a, lsr, dlsr);
  const total = ab + hold + ba;
  // Rounded, so the server and the browser print the same SVG.
  const x = (ms: number) => Math.round((X0 + (ms / total) * (X1 - X0)) * 10) / 10;
  const tSr = 0, tBob = ab, tRr = ab + hold, tA = total;

  return (
    <figure className="stage rtt" aria-label="Round-trip time from RTCP">
      <header className="stage-head">
        <div>
          <p className="eyebrow">Round-trip time · RFC 3550 §6.4.1</p>
          <p className="stage-title">How Alice measures the network from an SR and an RR</p>
        </div>
        <ul className="legend" aria-label="Legend"><li><i className="lg-rtcp" />RTCP</li></ul>
      </header>

      <div className="jb-controls">
        <Slider label="Network, Alice → Bob" value={ab} min={5} max={300} step={5} onChange={setAb} />
        <Slider label="Network, Bob → Alice" value={ba} min={5} max={300} step={5} onChange={setBa} />
        <Slider label="Bob holds the SR (DLSR)" value={hold} min={100} max={5000} step={100} onChange={setHold} />
      </div>

      <div className="rtt-steps seg" role="group" aria-label="Step">
        {STEPS.map((_, i) => <button key={i} type="button" aria-pressed={step === i} onClick={() => setStep(i)}>{i + 1}</button>)}
      </div>
      <p className="rtt-caption">{STEPS[step]}</p>

      <div className="rtt-chart">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Round trip ${(rtt * 1000).toFixed(0)} ms`}>
          <text className="rtt-who" x={14} y={YA + 4}>Alice</text>
          <text className="rtt-who" x={14} y={YB + 4}>Bob</text>
          <line className="rtt-axis" x1={X0} x2={X1} y1={YA} y2={YA} />
          <line className="rtt-axis" x1={X0} x2={X1} y1={YB} y2={YB} />
          <g className={`rtt-msg${step >= 0 ? ' is-on' : ''}`}>
            <line x1={x(tSr)} y1={YA} x2={x(tBob)} y2={YB} />
            <text x={x(tSr)} y={YA - 12} textAnchor="start">SR · LSR {fixed16(lsr).split(' ')[0]}</text>
          </g>
          {step >= 2 && (
            <g className="rtt-hold">
              <line x1={x(tBob)} x2={x(tRr)} y1={YB + 18} y2={YB + 18} />
              <text x={(x(tBob) + x(tRr)) / 2} y={YB + 36} textAnchor="middle">DLSR {hold} ms</text>
            </g>
          )}
          {step >= 2 && (
            <g className="rtt-msg is-on">
              <line x1={x(tRr)} y1={YB} x2={x(tA)} y2={YA} />
              <text x={x(tRr)} y={YB - 10} textAnchor="end">RR</text>
            </g>
          )}
          {step >= 1 && <circle className="rtt-dot" cx={x(tBob)} cy={YB} r={5} />}
          {step >= 3 && (
            <g className="rtt-a">
              <circle className="rtt-dot" cx={x(tA)} cy={YA} r={5} />
              <text x={x(tA)} y={YA - 12} textAnchor="end">A</text>
            </g>
          )}
        </svg>
      </div>

      <div className={`rtt-calc${step === 3 ? ' is-done' : ''}`}>
        <pre>{`A     ${fixed16(a)}
DLSR −${fixed16(dlsr)}
LSR  −${fixed16(lsr)}
──────────────────────────────────
RTT   ${fixed16(toFixed16(rtt))}  = ${(rtt * 1000).toFixed(0)} ms`}</pre>
        <p>{step === 3
          ? <>The round trip is {ab} + {ba} = <b>{ab + ba} ms</b>: Bob's {hold} ms of waiting is removed. The clocks of Alice and Bob never need to agree, because Alice compares only her own times.</>
          : 'Step through to see the subtraction.'}</p>
      </div>
    </figure>
  );
}
