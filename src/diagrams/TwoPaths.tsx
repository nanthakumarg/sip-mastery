/**
 * Signaling path vs media path on the network map (Module 0.2).
 */
import { useState } from 'react';
import type { FlowMap } from '../sip/flow.ts';
import CallMap, { type Overview } from './CallMap.tsx';
import type { ClientFlow } from './types.ts';

const TEXT: Record<Overview, string> = {
  signaling: 'SIP messages hop from server to server. Each proxy decides where the message goes next.',
  media: 'RTP audio goes straight from phone to phone. The proxies never see it.',
  both: 'Two separate paths. SIP sets up the call; RTP carries the voice.',
};

export default function TwoPaths({ flow }: { flow: ClientFlow & { map: FlowMap } }) {
  const [mode, setMode] = useState<Overview>('both');
  return (
    <figure className="stage twopaths">
      <header className="stage-head">
        <div>
          <p className="eyebrow">Two paths</p>
          <p className="stage-title">Signaling and media take different routes</p>
        </div>
        <div className="seg" role="radiogroup" aria-label="Show path">
          {(['signaling', 'media', 'both'] as const).map(m => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)}>
              {m === 'signaling' ? 'Signaling' : m === 'media' ? 'Media' : 'Both'}
            </button>
          ))}
        </div>
      </header>
      <div className="cp-map">
        <CallMap flow={flow} current={-1} overview={mode} />
      </div>
      <p className="stage-caption cap-text" aria-live="polite">{TEXT[mode]}</p>
    </figure>
  );
}
