/**
 * SBC function explorer (Module 25.3): turn the functions of an enterprise
 * SBC on and off, and see the INVITE on both sides, the media path, and what
 * happens to attacks from the Internet.
 */
import { useState } from 'react';
import { toWire } from '../sip/flow.ts';
import { applySbc, CALL_LIMIT, DEFAULT_SBC, FUNCTIONS, runSbc, type SbcFunction, type SbcOptions } from '../sip/sbc.ts';
import { inspect } from './diff.ts';

const GLYPH = { same: '', added: '+', changed: '~' } as const;

export default function SbcExplorer() {
  const [o, setO] = useState<SbcOptions>(DEFAULT_SBC);
  const [notes, setNotes] = useState<string[]>([]);
  const r = runSbc(o);
  const change = (c: Partial<SbcOptions>) => { const n = applySbc(o, c); setO(n.options); setNotes(n.notes); };
  const out = r.outside ?? r.reject!;
  const view = inspect(toWire(out), r.outside ? toWire(r.inside) : undefined)!;
  const before = inspect(toWire(r.inside))!;
  const anchored = r.mediaPath === 'anchored';
  const blocked = o.security;
  const all = Object.keys(FUNCTIONS) as SbcFunction[];

  return (
    <figure className="stage sbcx">
      <header className="stage-head">
        <div>
          <p className="eyebrow">SBC function explorer</p>
          <p className="stage-title">What each function of an SBC changes</p>
        </div>
        <div className="seg" role="group" aria-label="Presets">
          <button type="button" aria-pressed={all.every(k => !o[k])} onClick={() => { setO({ ...DEFAULT_SBC, busy: o.busy }); setNotes([]); }}>All off</button>
          <button type="button" aria-pressed={all.every(k => o[k])} onClick={() => { setO({ ...o, ...Object.fromEntries(all.map(k => [k, true])) }); setNotes([]); }}>All on</button>
        </div>
      </header>

      <div className="sbcx-controls">
        <div className="sbcx-toggles" role="group" aria-label="SBC functions">
          {all.map(k => (
            <button key={k} type="button" className="sbcx-toggle" aria-pressed={o[k]} onClick={() => change({ [k]: !o[k] })}>
              <span className="sbcx-dot" aria-hidden="true">{o[k] ? '●' : '○'}</span>{FUNCTIONS[k]}
            </button>
          ))}
        </div>
        <div className="sbcx-busy">
          <span className="eyebrow">Calls already up</span>
          <div className="seg" role="group" aria-label="Calls already up">
            <button type="button" aria-pressed={!o.busy} onClick={() => change({ busy: false })}>12 of {CALL_LIMIT}</button>
            <button type="button" aria-pressed={o.busy} onClick={() => change({ busy: true })}>{CALL_LIMIT} of {CALL_LIMIT}</button>
          </div>
        </div>
      </div>
      {notes.length > 0 && <p className="sbcx-note" aria-live="polite">{notes.join(' ')}</p>}

      <div className="sbcx-mapwrap">
      <svg className="sbcx-map" viewBox="0 0 760 210" role="img" aria-label={`PBX, SBC, and carrier. Media ${anchored ? 'flows through the SBC' : 'goes directly from the PBX address'}; attacks are ${blocked ? 'blocked at the SBC' : 'passed to the PBX'}.`}>
        <rect x="8" y="8" width="210" height="194" rx="8" className="zone" />
        <text x="20" y="28" className="zone-label">Inside · 10.1.1.0/24</text>
        <rect x="540" y="8" width="212" height="194" rx="8" className="zone" />
        <text x="552" y="28" className="zone-label">Internet</text>
        <g className="node"><rect x="40" y="44" width="140" height="44" rx="4" /><text x="110" y="64">PBX</text><text x="110" y="80" className="sub">10.1.1.20</text></g>
        <g className="node is-sbc"><rect x="275" y="44" width="210" height="44" rx="4" /><text x="380" y="64">SBC</text><text x="380" y="80" className="sub">10.1.1.1 | 203.0.113.1</text></g>
        <g className="node"><rect x="580" y="44" width="150" height="44" rx="4" /><text x="655" y="64">Carrier</text><text x="655" y="80" className="sub">198.51.100.50</text></g>
        <g className="node is-attacker"><rect x="580" y="150" width="150" height="40" rx="4" /><text x="655" y="175">Attackers</text></g>
        <line x1="180" y1="58" x2="275" y2="58" className="sig" /><text x="228" y="52" className="lbl">SIP · UDP</text>
        <line x1="485" y1="58" x2="580" y2="58" className="sig" /><text x="532" y="52" className="lbl">SIP · {o.security ? 'TLS 🔒' : 'UDP'}</text>
        {anchored ? (
          <>
            <line x1="180" y1="78" x2="275" y2="78" className="rtp" /><text x="228" y="98" className="lbl">RTP</text>
            <line x1="485" y1="78" x2="580" y2="78" className="rtp" /><text x="532" y="98" className="lbl">{o.security ? 'SRTP 🔒' : 'RTP'}{o.transcode ? ' · G.711' : ''}</text>
            {o.transcode && <text x="228" y="110" className="lbl">G.722</text>}
          </>
        ) : (
          <>
            <path d="M 580 82 C 470 130, 290 130, 180 82" className="rtp is-broken" />
            <text x="380" y="132" className="lbl is-err">RTP to 10.1.1.20 ✕ never arrives</text>
          </>
        )}
        <path d={blocked ? 'M 580 170 L 495 170' : 'M 580 170 L 200 170 L 160 92'} className={`atk${blocked ? ' is-blocked' : ''}`} />
        <text x={blocked ? 488 : 380} y={blocked ? 174 : 162} className={`lbl ${blocked ? 'is-ok' : 'is-err'}`} textAnchor={blocked ? 'end' : 'middle'}>{blocked ? '✕ dropped at the SBC' : 'scans and fraud reach the PBX'}</text>
      </svg>
      </div>

      <div className="elcmp-panes">
        <div className="elcmp-pane">
          <p className="eyebrow">From the PBX, inside</p>
          <div className="insp-msg" role="list">
            {before.lines.map(l => <div key={l.line} role="listitem" className={`insp-line zone-${l.zone} st-same`}><span className="insp-glyph" /><span className="insp-text">{l.text}</span></div>)}
          </div>
        </div>
        <div className="elcmp-pane">
          <p className="eyebrow">{r.outside ? 'To the carrier, outside' : 'The SBC answers the PBX'}</p>
          <div className="insp-msg" role="list">
            {view.lines.map(l => (
              <div key={l.line} role="listitem" className={`insp-line zone-${l.zone} st-${l.state}`}>
                <span className="insp-glyph" aria-label={l.state === 'same' ? undefined : l.state}>{GLYPH[l.state]}</span><span className="insp-text">{l.text}</span>
              </div>
            ))}
            {view.removed.map((t, k) => (
              <div key={`rm${k}`} role="listitem" className="insp-line st-removed"><span className="insp-glyph" aria-label="removed">−</span><span className="insp-text">{t}</span></div>
            ))}
          </div>
        </div>
      </div>

      <p className="sbcx-carrier" aria-live="polite"><b>Result:</b> {r.carrier}</p>
      <ul className="sbcx-checks">
        {r.checks.map(c => <li key={c.what} className={c.ok ? 'is-ok' : 'is-bad'}><b>{c.ok ? '✓' : '⚠'} {c.what}.</b> {c.text}</li>)}
      </ul>
      <ul className="sbcx-attacks" aria-label="Requests from the Internet">
        {r.attacks.map(a => <li key={a.what} className={a.blocked ? 'is-ok' : 'is-bad'}>{a.what}: <b>{a.blocked ? 'dropped by the access list or the rate limit' : 'passed to the PBX'}</b></li>)}
      </ul>
    </figure>
  );
}
