/**
 * Quality budget (Module 29): change the codec, the network delay, the
 * distance, the jitter, the jitter buffer, the loss, and transcoding, and
 * see the one-way delay built up part by part, the late packets, and the
 * R-factor and MOS. The model is src/net/quality.ts.
 */
import { useMemo, useState } from 'react';
import { budget, G114, QUALITY_PRESETS, type QualityInput } from '../net/quality.ts';

function Slider({ label, value, min, max, step, unit, onChange }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void }) {
  return (
    <label className="jb-slider">
      <span>{label}<b>{value.toLocaleString('en')}{unit}</b></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} />
    </label>
  );
}

const BANDS: [number, number, string][] = [[90, 100, 'Very satisfied'], [80, 90, 'Satisfied'], [70, 80, 'Some dissatisfied'], [60, 70, 'Many dissatisfied'], [50, 60, 'Nearly all dissatisfied'], [0, 50, 'Not recommended']];
const SCALE = 500;

export default function QualityBudget() {
  const [q, setQ] = useState<QualityInput>(QUALITY_PRESETS[0]!.input);
  const set = (c: Partial<QualityInput>) => setQ({ ...q, ...c });
  const b = useMemo(() => budget(q), [q]);
  const pos = (r: number) => `${Math.max(0, Math.min(100, ((r - 40) / 60) * 100)).toFixed(2)}%`;
  const pct = (ms: number) => `${(Math.min(ms, SCALE) / SCALE) * 100}%`;
  const fixed = q.buffer !== 'adaptive';

  return (
    <figure className="stage qb" aria-label="Voice quality budget">
      <header className="stage-head">
        <div>
          <p className="eyebrow">Quality budget · delay, jitter, loss → MOS</p>
          <p className="stage-title">Where the milliseconds and the points go</p>
        </div>
      </header>
      <div className="ac-presets" aria-label="Examples">
        {QUALITY_PRESETS.map(p => <button key={p.label} type="button" aria-pressed={JSON.stringify(p.input) === JSON.stringify(q)} onClick={() => setQ(p.input)}>{p.label}</button>)}
      </div>

      <div className="qb-controls">
        <div className="qb-choices">
          <div className="seg" role="group" aria-label="Codec">
            <button type="button" aria-pressed={q.codec === 'g711plc'} onClick={() => set({ codec: 'g711plc' })}>G.711</button>
            <button type="button" aria-pressed={q.codec === 'g729a'} onClick={() => set({ codec: 'g729a' })}>G.729A</button>
          </div>
          <div className="seg" role="group" aria-label="Packet time">
            <button type="button" aria-pressed={q.ptime === 20} onClick={() => set({ ptime: 20 })}>20 ms packets</button>
            <button type="button" aria-pressed={q.ptime === 40} onClick={() => set({ ptime: 40 })}>40 ms</button>
          </div>
          <div className="seg" role="group" aria-label="Jitter buffer">
            <button type="button" aria-pressed={!fixed} onClick={() => set({ buffer: 'adaptive' })}>Adaptive buffer</button>
            <button type="button" aria-pressed={fixed} onClick={() => set({ buffer: fixed ? q.buffer : 40 })}>Fixed</button>
          </div>
          <div className="seg" role="group" aria-label="Transcoding">
            {([0, 1, 2] as const).map(n => <button key={n} type="button" aria-pressed={q.transcodes === n} onClick={() => set({ transcodes: n })}>{n === 0 ? 'No transcoding' : `${n} G.729A stage${n > 1 ? 's' : ''}`}</button>)}
          </div>
          <button type="button" className="rl-toggle" aria-pressed={q.bursty} onClick={() => set({ bursty: !q.bursty })}><span aria-hidden="true">{q.bursty ? '●' : '○'}</span>Losses come in bursts</button>
        </div>
        <div className="qb-sliders">
          <Slider label="Network delay: access, queues, routers" value={q.network} min={0} max={200} step={5} unit=" ms" onChange={v => set({ network: v })} />
          <Slider label="Distance" value={q.distance} min={0} max={20000} step={100} unit=" km" onChange={v => set({ distance: v })} />
          <Slider label="Jitter" value={q.jitter} min={0} max={60} step={1} unit=" ms" onChange={v => set({ jitter: v })} />
          {fixed && <Slider label="Fixed jitter buffer" value={q.buffer as number} min={20} max={200} step={10} unit=" ms" onChange={v => set({ buffer: v })} />}
          <Slider label="Packet loss in the network" value={q.loss} min={0} max={10} step={0.5} unit=" %" onChange={v => set({ loss: v })} />
        </div>
      </div>

      <div className="qb-delay">
        <p className="eyebrow">One-way delay, mouth to ear: <b>{b.delay} ms</b></p>
        <div className="qb-bar" role="img" aria-label={`${b.delay} ms: ${b.parts.map(p => `${p.name} ${p.ms} ms`).join(', ')}`}>
          {b.parts.filter(p => p.ms > 0).map(p => <span key={p.key} className={`qb-seg k-${p.key}`} style={{ width: pct(p.ms) }} title={`${p.name}: ${p.ms} ms`} />)}
          <i className="qb-mark" style={{ left: pct(G114.good) }}><span>{G114.good} ms</span></i>
          <i className="qb-mark is-limit" style={{ left: pct(G114.limit) }}><span>{G114.limit} ms</span></i>
        </div>
        <ul className="qb-legend">
          {b.parts.map(p => <li key={p.key}><i className={`k-${p.key}`} />{p.name} <b>{p.ms} ms</b></li>)}
        </ul>
      </div>

      <div className="mos-scale" role="img" aria-label={`R ${b.r.toFixed(0)}: ${b.band}`}>
        {BANDS.map(([lo, hi, label]) => (
          <span key={label} className={`mos-band${b.r >= lo && (b.r < hi || hi === 100) ? ' is-on' : ''}`} style={{ left: pos(Math.max(lo, 40)), width: `calc(${pos(hi)} - ${pos(Math.max(lo, 40))})` }}>{label}</span>
        ))}
        <i className="mos-marker" style={{ left: pos(b.r) }} />
      </div>
      <div className="jb-stats">
        <div className="stat"><b>{b.r.toFixed(1)}</b><span>R-factor</span></div>
        <div className="stat"><b>{b.mos.toFixed(2)}</b><span>MOS</span></div>
        <div className="stat"><b>{b.bufferMs} ms</b><span>Jitter buffer{fixed ? '' : ' (adaptive)'}</span></div>
        <div className="stat"><b>{b.discards.toFixed(1)} %</b><span>Late, discarded</span></div>
        <div className="stat"><b>{b.totalLoss.toFixed(1)} %</b><span>Loss heard</span></div>
        <div className="stat"><b>{b.ie}</b><span>Ie: codec stages</span></div>
      </div>
      <ul className="qb-advice" aria-live="polite">{b.advice.map(a => <li key={a}>{a}</li>)}</ul>
    </figure>
  );
}
