/**
 * WebRTC ↔ SIP gateway view (Module 26.5): a browser on the left, a SIP
 * phone on the right, and what the gateway converts at each layer. Select a
 * layer to see what the gateway does, and what breaks without it.
 */
import { useState } from 'react';
import { LAYERS } from '../sip/webrtc.ts';

export default function WebrtcGateway() {
  const [sel, setSel] = useState(0);
  return (
    <figure className="stage wgw">
      <header className="stage-head">
        <div>
          <p className="eyebrow">WebRTC ↔ SIP gateway</p>
          <p className="stage-title">What the gateway converts, layer by layer</p>
        </div>
      </header>
      <div className="wgw-grid" role="list">
        <div className="wgw-head" aria-hidden="true"><span>Browser</span><span>WebRTC gateway</span><span>SIP phone</span></div>
        {LAYERS.map((l, k) => (
          <div key={l.name} role="listitem">
            <button type="button" className={`wgw-row${k === sel ? ' is-sel' : ''}`} aria-expanded={k === sel} onClick={() => setSel(k)}>
              <span className="wgw-browser">{l.browser}</span>
              <span className="wgw-mid"><span className="wgw-name">{l.name}</span><span className="wgw-arrow" aria-hidden="true">⇄</span></span>
              <span className="wgw-sip">{l.sip}</span>
            </button>
            {k === sel && (
              <div className="wgw-detail" aria-live="polite">
                <p><b>The gateway:</b> {l.action}</p>
                <p className="wgw-without"><b>Without it:</b> {l.without}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </figure>
  );
}
