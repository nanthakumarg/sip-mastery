/**
 * Message inspector: the raw message, a meaning for every line, an RFC link,
 * and the changes since the previous message of the same kind.
 */
import { useMemo, useState } from 'react';
import { inspect, type InspectLine } from './diff.ts';
import type { ClientQuote, ClientRef, ClientRefEntry, ClientStep } from './types.ts';

interface Props {
  step: ClientStep;
  laneLabel: (id: string) => string;
  prev?: ClientStep;
  quote?: ClientQuote;
  refData: ClientRef;
}

const GLYPH = { same: '', added: '+', changed: '~' } as const;

function explain(l: InspectLine, refData: ClientRef, isRequest: boolean): ClientRefEntry | undefined {
  if (l.zone === 'start') return isRequest ? refData.request : refData.response;
  if (l.zone === 'header') return refData.headers[l.name!];
  if (l.zone === 'body') return refData.sdp[l.name!];
  return undefined;
}

export default function Inspector({ step, laneLabel, prev, quote, refData }: Props) {
  const [showDiff, setShowDiff] = useState(true);
  const [pinned, setPinned] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const view = useMemo(() => (step.wire ? inspect(step.wire, showDiff ? prev?.wire : undefined) : undefined), [step, prev, showDiff]);

  const route = `${laneLabel(step.from)} → ${laneLabel(step.to)}`;
  const head = (
    <header className="insp-head">
      <span className="insp-num">F{step.index + 1}</span>
      <span className="insp-title">{step.label}</span>
      <span className="insp-route">{route}</span>
    </header>
  );

  if (!view) {
    return (
      <div className="inspector">
        {head}
        {step.detail
          ? <pre className="insp-detail">{step.detail}</pre>
          : <p className="insp-empty">{step.kind === 'media' ? 'Media packets, not a SIP message. RTP carries the audio between the addresses in the SDP.' : 'No SIP message for this step.'}</p>}
        {quote && (
          <blockquote className="insp-quote">
            <p className="insp-q-src">RFC {quote.rfc} §{quote.section} · {quote.title}</p>
            <p>“{markKeywords(quote.text)}”</p>
            <a href={quote.url} target="_blank" rel="noopener">Read the section ↗</a>
          </blockquote>
        )}
      </div>
    );
  }

  const isRequest = view.msg.kind === 'request';
  const focus = hover ?? pinned;
  const focused = focus !== null ? view.lines.find(l => l.line === focus) : undefined;
  const info = focused ? explain(focused, refData, isRequest) : undefined;
  const changes = view.lines.filter(l => l.state !== 'same').length + view.removed.length;

  return (
    <div className="inspector">
      {head}
      {prev?.wire && (
        <div className="insp-diffbar">
          <label className="insp-toggle">
            <input type="checkbox" checked={showDiff} onChange={e => setShowDiff(e.target.checked)} />
            <span>Changes since F{prev.index + 1}</span>
          </label>
          {showDiff && <span className="insp-count">{changes === 0 ? 'identical' : `${changes} change${changes > 1 ? 's' : ''}`}</span>}
        </div>
      )}
      <div className="insp-msg" role="list" aria-label="Message lines" onMouseLeave={() => setHover(null)}>
        {view.lines.map(l => (
          <div
            key={l.line}
            role="listitem"
            tabIndex={l.zone === 'blank' ? -1 : 0}
            className={`insp-line zone-${l.zone} st-${l.state}${focus === l.line ? ' is-focus' : ''}${pinned === l.line ? ' is-pinned' : ''}`}
            onMouseEnter={() => l.zone !== 'blank' && setHover(l.line)}
            onFocus={() => setHover(l.line)}
            onBlur={() => setHover(null)}
            onClick={() => setPinned(p => (p === l.line ? null : l.line))}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPinned(p => (p === l.line ? null : l.line)); } }}
          >
            <span className="insp-glyph" aria-label={l.state === 'same' ? undefined : l.state}>{GLYPH[l.state]}</span>
            <span className="insp-text">{renderLine(l)}</span>
          </div>
        ))}
        {showDiff && view.removed.map((t, k) => (
          <div key={`rm${k}`} role="listitem" className="insp-line st-removed">
            <span className="insp-glyph" aria-label="removed">−</span>
            <span className="insp-text">{t}</span>
          </div>
        ))}
      </div>

      <div className="insp-explain" aria-live="polite">
        {info ? (
          <>
            <p className="insp-ex-name">{focused!.zone === 'start' ? (isRequest ? 'Request line' : 'Status line') : focused!.zone === 'body' ? `SDP ${focused!.name}= line` : focused!.name}</p>
            <p>{info.summary}</p>
            {info.who && <p className="insp-who"><b>Who:</b> {info.who}</p>}
            {info.url && <a href={info.url} target="_blank" rel="noopener">{info.label} ↗</a>}
          </>
        ) : (
          <p className="insp-hint">Point at a line, or select it, to see what it means.</p>
        )}
      </div>

      {quote && (
        <blockquote className="insp-quote">
          <p className="insp-q-src">RFC {quote.rfc} §{quote.section} · {quote.title}</p>
          <p>“{markKeywords(quote.text)}”</p>
          <a href={quote.url} target="_blank" rel="noopener">Read the section ↗</a>
        </blockquote>
      )}
    </div>
  );
}

function renderLine(l: InspectLine) {
  if (l.zone === 'header') {
    const at = l.text.indexOf(':');
    return (<><span className="h-name">{l.text.slice(0, at)}</span>:<span className="h-val">{l.text.slice(at + 1)}</span></>);
  }
  if (l.zone === 'body') {
    return (<><span className="s-key">{l.text.slice(0, 2)}</span>{l.text.slice(2)}</>);
  }
  if (l.zone === 'blank') return <span className="blank-mark">(empty line)</span>;
  return l.text;
}

/** Highlights RFC 2119 keywords (MUST, SHOULD, MAY …). */
export function markKeywords(text: string) {
  const parts = text.replace(/\s+/g, ' ').split(/\b(MUST NOT|MUST|SHALL NOT|SHALL|SHOULD NOT|SHOULD|RECOMMENDED|NOT RECOMMENDED|MAY|REQUIRED|OPTIONAL)\b/);
  return parts.map((p, i) => (i % 2 ? <strong key={i} className="kw">{p}</strong> : p));
}
