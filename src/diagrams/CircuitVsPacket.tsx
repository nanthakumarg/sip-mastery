/**
 * Circuit switching vs packet switching (Module 1.1).
 * Top: each call reserves a 64 kbit/s circuit for its whole length, even in silence.
 * Bottom: calls become RTP packets that share one link with other traffic;
 * a silent caller (with silence suppression) sends almost nothing.
 */
import { useEffect, useState } from 'react';

const SLOTS = 6;
const LINK = 'M222 336 H678';
const DUR = 2.4;

export default function CircuitVsPacket() {
  const [calls, setCalls] = useState(2);
  const [silent, setSilent] = useState(false);
  const [motion, setMotion] = useState(false);
  useEffect(() => { setMotion(!window.matchMedia('(prefers-reduced-motion: reduce)').matches); }, []);

  const talking = Array.from({ length: calls }, (_, i) => i + 1).filter(c => !(silent && c === 1));
  // Evenly spaced stream: every talking call sends packets in turn, plus some other traffic.
  const stream: { label: string; kind: 'rtp' | 'web' }[] = [];
  for (let k = 0; k < 3; k++) {
    for (const c of talking) stream.push({ label: String(c), kind: 'rtp' });
    if (k !== 1) stream.push({ label: 'web', kind: 'web' });
  }

  return (
    <figure className="stage cvp">
      <header className="stage-head">
        <div>
          <p className="eyebrow">Circuits and packets</p>
          <p className="stage-title">The same calls, two kinds of network</p>
        </div>
        <div className="cvp-controls">
          <div className="seg" role="radiogroup" aria-label="Number of calls">
            {[1, 2, 3, 4].map(n => (
              <button key={n} type="button" role="radio" aria-checked={calls === n} onClick={() => setCalls(n)}>{n} {n === 1 ? 'call' : 'calls'}</button>
            ))}
          </div>
          <label className="cvp-toggle">
            <input type="checkbox" checked={silent} onChange={e => setSilent(e.target.checked)} />
            <span>Caller 1 is silent</span>
          </label>
        </div>
      </header>

      <svg className="cvp-svg" viewBox="0 0 900 420" role="img"
        aria-label={`${calls} calls. Circuit switching reserves ${calls} of ${SLOTS} circuits. Packet switching carries packets from ${talking.length} talking calls, mixed with other traffic.`}>
        <text className="cvp-title" x={20} y={28}>Circuit switching: the telephone network</text>
        {[['Exchange', 60], ['Exchange', 720]].map(([l, x], i) => (
          <g key={i} className="cvp-node"><rect x={x as number} y={46} width={120} height={124} rx={4} /><text x={(x as number) + 60} y={113} textAnchor="middle">{l}</text></g>
        ))}
        {Array.from({ length: SLOTS }, (_, i) => {
          const used = i < calls;
          const quiet = used && silent && i === 0;
          const y = 50 + i * 20;
          return (
            <g key={i} className={`cvp-slot${used ? ' is-used' : ''}`}>
              <rect x={190} y={y} width={520} height={17} rx={2} />
              <text x={450} y={y + 12.5} textAnchor="middle">
                {used ? `Call ${i + 1} · 64 kbit/s${quiet ? ' · silent, still reserved' : ''}` : 'free circuit'}
              </text>
            </g>
          );
        })}

        <text className="cvp-title" x={20} y={262}>Packet switching: VoIP</text>
        {[['Router', 90], ['Router', 690]].map(([l, x], i) => (
          <g key={i} className="cvp-node"><rect x={x as number} y={298} width={120} height={76} rx={4} /><text x={(x as number) + 60} y={341} textAnchor="middle">{l}</text></g>
        ))}
        <path className="cvp-link" d={LINK} />
        {stream.map((p, i) => {
          const begin = (i / stream.length) * DUR;
          const w = p.kind === 'web' ? 34 : 22;
          const staticX = 222 + ((i + 0.5) / stream.length) * 456;
          return (
            <g key={`${calls}-${silent}-${i}`} className={`cvp-pkt ${p.kind}`} transform={motion ? undefined : `translate(${staticX} 336)`}>
              <rect x={-w / 2} y={-9} width={w} height={18} rx={3} />
              <text y={4} textAnchor="middle">{p.label}</text>
              {motion && <animateMotion dur={`${DUR}s`} begin={`${begin}s`} repeatCount="indefinite" path={LINK} />}
            </g>
          );
        })}
        <text className="cvp-note" x={450} y={404} textAnchor="middle">
          {talking.length} {talking.length === 1 ? 'call sends' : 'calls send'} RTP packets, about 50 per second each, on a link they share with other traffic
        </text>
      </svg>

      <div className="cvp-readout">
        <p><b>Circuits:</b> {calls} of {SLOTS} reserved for the whole call, {calls * 64} kbit/s in use{silent ? ', even while caller 1 is silent' : ''}. A real E1 link has 30 voice circuits; a T1 has 24.</p>
        <p><b>Packets:</b> {talking.length} {talking.length === 1 ? 'call is' : 'calls are'} sending. Each talking G.711 call needs about 80 kbit/s on the IP network{silent ? '. With silence suppression, the silent caller sends almost nothing' : ''}. Free capacity goes to any traffic.</p>
      </div>
    </figure>
  );
}
