/**
 * Jitter buffer simulation (Module 16): 150 packets cross a network with a
 * random queueing delay. A fixed buffer plays each one at a set time; a packet
 * that arrives after that time is late and is thrown away, as if lost.
 * The model is src/net/rtp.ts (simulateJitter).
 */
import { useMemo, useState } from 'react';
import { simulateJitter } from '../net/rtp.ts';

const W = 900, H = 300, L = 46, R = 12, T = 16, B = 34;

function Slider({ label, value, min, max, step, unit, onChange }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void }) {
  return (
    <label className="jb-slider">
      <span>{label}<b>{value}{unit}</b></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} />
    </label>
  );
}

export default function JitterBuffer() {
  const [jitter, setJitter] = useState(15);
  const [loss, setLoss] = useState(1);
  const [buffer, setBuffer] = useState(40);
  const [seed, setSeed] = useState(11);
  const ptime = 20, base = 40, N = 150;
  const r = useMemo(() => simulateJitter({ packets: N, ptime, baseDelay: base, jitter, loss, buffer, seed }), [jitter, loss, buffer, seed]);

  const maxY = Math.max(160, Math.ceil((Math.max(r.maxDelay, r.delay) + 20) / 40) * 40);
  // Rounded, so the server and the browser print the same SVG.
  const round = (n: number) => Math.round(n * 10) / 10;
  const x = (i: number) => round(L + (i / (N - 1)) * (W - L - R));
  const y = (ms: number) => round(T + (1 - ms / maxY) * (H - T - B));
  const pct = (n: number) => `${((n / N) * 100).toFixed(1)}%`;
  const bad = r.late + r.lost;

  return (
    <figure className="stage jb" aria-label="Jitter buffer simulation">
      <header className="stage-head">
        <div>
          <p className="eyebrow">Jitter buffer · 150 packets, 20 ms each</p>
          <p className="stage-title">How deep should the buffer be?</p>
        </div>
        <ul className="legend" aria-label="Legend">
          <li><i className="jb-lg-ok" />Played</li>
          <li><i className="lg-err" />Late</li>
          <li><i className="lg-down" />Lost</li>
        </ul>
      </header>

      <div className="jb-controls">
        <Slider label="Network jitter" value={jitter} min={0} max={60} step={1} unit=" ms" onChange={setJitter} />
        <Slider label="Network loss" value={loss} min={0} max={10} step={0.5} unit="%" onChange={setLoss} />
        <Slider label="Buffer depth" value={buffer} min={0} max={200} step={10} unit=" ms" onChange={setBuffer} />
        <button type="button" className="rl-toggle" onClick={() => setSeed(s => s + 1)}>New random network</button>
      </div>

      <div className="jb-chart">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${r.played} played, ${r.late} late, ${r.lost} lost`}>
          {Array.from({ length: maxY / 40 + 1 }, (_, k) => k * 40).map(ms => (
            <g key={ms} className="jb-grid">
              <line x1={L} x2={W - R} y1={y(ms)} y2={y(ms)} />
              <text x={L - 6} y={y(ms) + 4} textAnchor="end">{ms}</text>
            </g>
          ))}
          <text className="jb-axis" x={12} y={T + (H - T - B) / 2} transform={`rotate(-90 12 ${T + (H - T - B) / 2})`} textAnchor="middle">network delay, ms</text>
          <text className="jb-axis" x={(L + W - R) / 2} y={H - 6} textAnchor="middle">packet (sequence number) →</text>
          <rect className="jb-buffer" x={L} width={W - L - R} y={y(r.delay)} height={Math.max(0, y(r.delay - buffer) - y(r.delay))} />
          <line className="jb-deadline" x1={L} x2={W - R} y1={y(r.delay)} y2={y(r.delay)} />
          <text className="jb-deadline-t" x={W - R - 4} y={y(r.delay) - 6} textAnchor="end">playout deadline: {Math.round(r.delay)} ms</text>
          {r.packets.map(p => p.arrival === undefined
            ? <text key={p.seq} className="jb-lost" x={x(p.seq)} y={T + 10} textAnchor="middle">✕</text>
            : <circle key={p.seq} className={`jb-pkt is-${p.fate}`} cx={x(p.seq)} cy={y(p.arrival - p.sent)} r={3.2} />)}
        </svg>
      </div>

      <div className="jb-stats">
        <div className="stat"><b>{pct(r.played)}</b><span>played</span></div>
        <div className={`stat${r.late ? ' is-bad' : ''}`}><b>{pct(r.late)}</b><span>late: thrown away</span></div>
        <div className={`stat${r.lost ? ' is-bad' : ''}`}><b>{pct(r.lost)}</b><span>lost in the network</span></div>
        <div className="stat"><b>{Math.round(r.delay)} ms</b><span>network + buffer delay</span></div>
        <div className="stat"><b>{r.jitterEstimate.toFixed(1)} ms</b><span>jitter (RFC 3550)</span></div>
      </div>
      <p className="jb-verdict">
        {bad / N > 0.05 ? 'More than 5% of the audio is missing: words break up. ' : bad / N > 0.01 ? 'Some gaps: the codec hides a few, but people hear clicks. ' : 'The audio is complete. '}
        {r.delay > 150 ? 'The delay is above 150 ms: people start to talk over each other.' : buffer > 2 * Math.max(10, r.jitterEstimate * 3) && r.late === 0 ? 'The buffer is deeper than it needs to be: it only adds delay.' : 'A deeper buffer saves late packets, but every millisecond of buffer is a millisecond of delay.'}
      </p>
    </figure>
  );
}
