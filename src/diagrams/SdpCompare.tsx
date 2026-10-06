/**
 * SDP comparison (Module 26.2): the offer a browser makes for an audio and
 * video call, next to a classic SIP phone's offer for the same call. Pick a
 * difference to highlight its lines on both sides.
 */
import { useState } from 'react';
import { BROWSER_CANDIDATES, classicSdp, SDP_DIFFS, webrtcSdp } from '../sip/webrtc.ts';

const WEBRTC = webrtcSdp({ role: 'offer', pts: [111, 0, 8, 126], candidates: [BROWSER_CANDIDATES.host, BROWSER_CANDIDATES.srflx], video: true }).trimEnd().split('\n');
const CLASSIC = classicSdp([0, 8, 126], true, '192.0.2.10', 'alice', 2890844526).replace(/30000/, '49170').replace(/30002/, '51372').trimEnd().split('\n');
const bytes = (lines: string[]) => lines.join('\r\n').length + 2;

/** The difference that a line belongs to, if any. */
const groupOf = (line: string, side: 'webrtc' | 'classic') => SDP_DIFFS.find(d => (side === 'webrtc' ? d.webrtc : d.classic)?.test(line))?.id;

export default function SdpCompare() {
  const [sel, setSel] = useState(SDP_DIFFS[0]!.id);
  const d = SDP_DIFFS.find(x => x.id === sel)!;
  const pane = (title: string, lines: string[], side: 'webrtc' | 'classic') => (
    <div className="elcmp-pane">
      <p className="eyebrow">{title} · {lines.length} lines, {bytes(lines)} bytes</p>
      <div className="insp-msg sdpc-lines" role="list">
        {lines.map((l, k) => {
          const g = groupOf(l, side);
          return (
            <div key={k} role="listitem" className={`insp-line${g === sel ? ' is-hit' : g ? ' is-diff' : ''}`} onClick={() => g && setSel(g)}>
              <span className="insp-glyph">{g === sel ? '●' : ''}</span><span className="insp-text">{l}</span>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <figure className="stage sdpc">
      <header className="stage-head">
        <div>
          <p className="eyebrow">SDP comparison</p>
          <p className="stage-title">The same call, offered by a browser and by a SIP phone</p>
        </div>
      </header>
      <div className="sdpc-chips" role="group" aria-label="Differences">
        {SDP_DIFFS.map(x => <button key={x.id} type="button" aria-pressed={x.id === sel} onClick={() => setSel(x.id)}>{x.title}</button>)}
      </div>
      <div className="sdpc-explain" aria-live="polite">
        <p><b>{d.title}.</b> {d.text}</p>
        <p><b>The gateway:</b> {d.gateway}</p>
      </div>
      <div className="elcmp-panes">
        {pane('Browser (WebRTC)', WEBRTC, 'webrtc')}
        {pane('SIP phone (classic)', CLASSIC, 'classic')}
      </div>
    </figure>
  );
}
