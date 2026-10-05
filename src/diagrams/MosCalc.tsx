/**
 * MOS and R-factor (Module 17): codec, one-way delay, loss, and burstiness
 * into a simplified E-model (ITU-T G.107). The model is src/net/rtcp.ts (emodel).
 */
import { useMemo, useState } from 'react';
import { emodel, EMODEL_CODECS } from '../net/rtcp.ts';

function Slider({ label, value, min, max, step, unit, onChange }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void }) {
  return (
    <label className="jb-slider">
      <span>{label}<b>{value}{unit}</b></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} />
    </label>
  );
}

const BANDS: [number, number, string][] = [[90, 100, 'Very satisfied'], [80, 90, 'Satisfied'], [70, 80, 'Some dissatisfied'], [60, 70, 'Many dissatisfied'], [50, 60, 'Nearly all dissatisfied'], [0, 50, 'Not recommended']];

export default function MosCalc() {
  const [codecId, setCodecId] = useState('g711plc');
  const [delay, setDelay] = useState(80);
  const [loss, setLoss] = useState(1);
  const [bursty, setBursty] = useState(false);
  const codec = EMODEL_CODECS.find(c => c.id === codecId)!;
  const e = useMemo(() => emodel({ codec, delay, loss, burstR: bursty ? 2 : 1 }), [codec, delay, loss, bursty]);
  const pos = (r: number) => `${Math.max(0, Math.min(100, ((r - 40) / 60) * 100)).toFixed(2)}%`;

  return (
    <figure className="stage mos" aria-label="MOS and R-factor calculator">
      <header className="stage-head">
        <div>
          <p className="eyebrow">R-factor and MOS · ITU-T G.107, simplified</p>
          <p className="stage-title">How good will this call sound?</p>
        </div>
      </header>

      <div className="seg bwc-seg mos-codec" role="group" aria-label="Codec">
        {EMODEL_CODECS.map(c => <button key={c.id} type="button" aria-pressed={c.id === codecId} onClick={() => setCodecId(c.id)}>{c.name}</button>)}
      </div>
      <div className="jb-controls">
        <Slider label="One-way delay, mouth to ear" value={delay} min={0} max={500} step={10} unit=" ms" onChange={setDelay} />
        <Slider label="Packet loss (and late discards)" value={loss} min={0} max={20} step={0.5} unit="%" onChange={setLoss} />
        <button type="button" className="rl-toggle" aria-pressed={bursty} onClick={() => setBursty(!bursty)}><span aria-hidden="true">{bursty ? '●' : '○'}</span>Losses come in bursts</button>
      </div>

      <div className="mos-scale" role="img" aria-label={`R ${e.r.toFixed(0)}: ${e.band}`}>
        {BANDS.map(([lo, hi, label]) => (
          <span key={label} className={`mos-band${e.r >= lo && (e.r < hi || hi === 100) ? ' is-on' : ''}`} style={{ left: pos(Math.max(lo, 40)), width: `calc(${pos(hi)} - ${pos(Math.max(lo, 40))})` }}>{label}</span>
        ))}
        <i className="mos-marker" style={{ left: pos(e.r) }} />
      </div>

      <div className="jb-stats">
        <div className="stat"><b>{e.r.toFixed(1)}</b><span>R-factor (0–100)</span></div>
        <div className="stat"><b>{e.mos.toFixed(2)}</b><span>MOS (1–4.5)</span></div>
        <div className="stat"><b>−{e.id.toFixed(1)}</b><span>Id: delay</span></div>
        <div className="stat"><b>−{e.ieEff.toFixed(1)}</b><span>Ie,eff: codec and loss</span></div>
      </div>
      <p className="mos-formula">R = 93.2 − Id − Ie,eff = 93.2 − {e.id.toFixed(1)} − {e.ieEff.toFixed(1)} = <b>{e.r.toFixed(1)}</b> · {e.band}</p>
    </figure>
  );
}
