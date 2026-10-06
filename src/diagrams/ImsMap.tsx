/**
 * IMS core map (Module 27.2): click a function to see its job, the headers
 * it adds or acts on, and its interfaces. Pick a path to see which
 * functions a REGISTER or a call goes through.
 */
import { useState } from 'react';
import { IMS_LINKS, IMS_NODES, IMS_PATHS } from '../sip/ims.ts';

const W = 116, H = 40;
const byId = Object.fromEntries(IMS_NODES.map(n => [n.id, n]));

export default function ImsMap() {
  const [sel, setSel] = useState('pcscf');
  const [path, setPath] = useState<keyof typeof IMS_PATHS | ''>('register');
  const p = path ? IMS_PATHS[path] : undefined;
  const pairs = new Set((p?.hops ?? []).slice(1).map((h, k) => [p!.hops[k]!, h].sort().join('|')));
  const onPath = new Set(p?.hops ?? []);
  const n = byId[sel]!;

  return (
    <figure className="stage imsmap">
      <header className="stage-head">
        <div>
          <p className="eyebrow">IMS core map</p>
          <p className="stage-title">Who does what in the IMS</p>
        </div>
        <div className="seg" role="group" aria-label="Show a path">
          {(Object.keys(IMS_PATHS) as (keyof typeof IMS_PATHS)[]).map(k => (
            <button key={k} type="button" aria-pressed={path === k} onClick={() => setPath(path === k ? '' : k)}>{IMS_PATHS[k].label}</button>
          ))}
        </div>
      </header>
      {p && <p className="imsmap-path" aria-live="polite">{p.text}</p>}
      <div className="sbcx-mapwrap">
        <svg className="imsmap-svg" viewBox="0 0 900 350" role="group" aria-label="IMS functions and their links">
          <rect x="140" y="12" width="740" height="326" rx="10" className="zone" />
          <text x="156" y="32" className="zone-label">Home network</text>
          {IMS_LINKS.map(([a, b]) => {
            const A = byId[a]!, B = byId[b]!;
            const hot = pairs.has([a, b].sort().join('|'));
            return <line key={`${a}-${b}`} x1={A.x} y1={A.y} x2={B.x} y2={B.y} className={`ln${b === 'hss' || a === 'hss' ? ' is-diameter' : ''}${hot ? ' is-hot' : ''}`} />;
          })}
          <line x1={byId.mgcf!.x} y1={byId.mgcf!.y + H / 2} x2={byId.mgcf!.x} y2={262} className="ln" />
          <text x={byId.mgcf!.x} y={280} className="ext">PSTN</text>
          <line x1={byId.ibcf!.x + W / 2} y1={byId.ibcf!.y} x2={776} y2={300} className="ln" />
          <text x={782} y={304} className="ext" style={{ textAnchor: 'start' }}>Other operator</text>
          {IMS_NODES.map(x => (
            <g key={x.id} className={`node${x.id === sel ? ' is-sel' : ''}${onPath.has(x.id) ? ' is-on' : ''}`} transform={`translate(${x.x - W / 2} ${x.y - H / 2})`}>
              <rect width={W} height={H} rx={x.id === 'ue' ? 14 : 4} />
              <text x={W / 2} y={H / 2 + 5}>{x.name}</text>
              <rect width={W} height={H} rx={4} className="hit" role="button" tabIndex={0} aria-pressed={x.id === sel} aria-label={`${x.name}: ${x.full}`}
                onClick={() => setSel(x.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSel(x.id); } }} />
            </g>
          ))}
          <text x={450} y={330} className="legend-t">— SIP   ┄ Diameter</text>
        </svg>
      </div>
      <div className="imsmap-detail" aria-live="polite">
        <p className="imsmap-name">{n.name} <span>{n.full}</span></p>
        <p>{n.job}</p>
        <p className="imsmap-sub">Headers</p>
        <ul>{n.headers.map(h => <li key={h}>{h}</li>)}</ul>
        <p className="imsmap-sub">Interfaces</p>
        <p>{n.interfaces}</p>
      </div>
    </figure>
  );
}
