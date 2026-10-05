/**
 * SDP linter (Module 15): paste an SDP body and see each line explained and
 * each problem flagged, with the RFC rule behind it. The parser is
 * src/sip/sdp.ts (parseSdp).
 */
import { useMemo, useState } from 'react';
import { markKeywords } from './Inspector.tsx';
import { parseSdp, type SdpIssue } from '../sip/sdp.ts';
import type { ClientQuote } from './types.ts';

interface Props { quotes: Record<string, ClientQuote> }

const BASE = `v=0
o=alice 2890844526 2890844526 IN IP4 192.0.2.10
s=-
c=IN IP4 192.0.2.10
t=0 0
m=audio 49170 RTP/AVP 0 8 101
a=rtpmap:0 PCMU/8000
a=rtpmap:8 PCMA/8000
a=rtpmap:101 telephone-event/8000
a=fmtp:101 0-16
a=ptime:20
a=sendrecv`;

const PRESETS: [string, string][] = [
  ['A good offer', BASE],
  ['Private address', BASE.replace(/192\.0\.2\.10/g, '192.168.1.20')],
  ['Lines out of order', BASE.replace('s=-\nc=IN IP4 192.0.2.10\nt=0 0', 'c=IN IP4 192.0.2.10\ns=-\nt=0 0')],
  ['Missing rtpmap', BASE.replace('0 8 101', '96 0 8 101')],
  ['Two directions', BASE.replace('a=sendrecv', 'a=sendonly\na=sendrecv')],
  ['Old-style hold', BASE.replace('c=IN IP4 192.0.2.10', 'c=IN IP4 0.0.0.0').replace('2890844526 IN', '2890844527 IN')],
  ['No telephone-event', BASE.replace(' 101', '').replace('a=rtpmap:101 telephone-event/8000\na=fmtp:101 0-16\n', '')],
  ['Audio and video, BUNDLE', `v=0
o=- 4611731400430051336 2 IN IP4 203.0.113.50
s=-
c=IN IP4 203.0.113.50
t=0 0
a=group:BUNDLE 0 1
m=audio 9000 RTP/SAVPF 111 101
a=rtpmap:111 opus/48000/2
a=fmtp:111 minptime=10;useinbandfec=1
a=rtpmap:101 telephone-event/8000
a=mid:0
a=rtcp-mux
a=sendrecv
m=video 9000 RTP/SAVPF 96
a=rtpmap:96 VP8/90000
a=mid:1
a=rtcp-mux
a=sendrecv`],
];

const SEV_LABEL = { error: 'Error', warn: 'Risk', info: 'Note' } as const;
const RANK = { error: 0, warn: 1, info: 2 } as const;

export default function SdpLinter({ quotes }: Props) {
  const [text, setText] = useState(BASE);
  const sdp = useMemo(() => parseSdp(text), [text]);
  const [sel, setSel] = useState<number | null>(null);
  const byLine = new Map<number, SdpIssue[]>();
  for (const i of sdp.issues) if (i.line !== undefined) byLine.set(i.line, [...(byLine.get(i.line) ?? []), i]);
  const general = sdp.issues.filter(i => i.line === undefined);
  const count = (sev: SdpIssue['severity']) => sdp.issues.filter(i => i.severity === sev).length;
  const errors = count('error'), risks = count('warn'), notes = count('info');
  const line = sel !== null ? sdp.lines[sel] : undefined;
  const lineIssues = sel !== null ? (byLine.get(sel) ?? []).sort((a, b) => RANK[a.severity] - RANK[b.severity]) : [];
  const ruleId = lineIssues[0]?.rule ?? line?.rule;
  const quote = ruleId ? quotes[ruleId] : undefined;

  return (
    <figure className="stage sdpl" aria-label="SDP linter">
      <header className="stage-head">
        <div>
          <p className="eyebrow">SDP linter · RFC 8866, RFC 3264</p>
          <p className="stage-title">What does each line say, and what is wrong?</p>
        </div>
        <ul className="legend" aria-label="Legend">
          <li><i className="lg-sdp" />SDP</li>
          <li><span className="lg-warn">⚠</span>Problem</li>
        </ul>
      </header>

      <div className="ac-presets" aria-label="Examples">
        {PRESETS.map(([label, v]) => <button key={label} type="button" aria-pressed={text === v} onClick={() => { setText(v); setSel(null); }}>{label}</button>)}
      </div>

      <div className="sdpl-main">
        <label className="sdpl-edit">
          <span className="eyebrow">SDP body · edit or paste</span>
          <textarea value={text} onChange={e => { setText(e.target.value); setSel(null); }} spellCheck={false} autoComplete="off" rows={Math.max(12, text.split('\n').length + 1)} />
        </label>

        <div className="sdpl-out">
          <p className={`sdpl-sum${errors ? ' is-bad' : ''}`}>
            {errors ? <><b>{errors}</b> error{errors === 1 ? '' : 's'}</> : 'Valid SDP'}
            {risks > 0 && <> · <b>{risks}</b> risk{risks === 1 ? '' : 's'}</>}
            {notes > 0 && <> · {notes} note{notes === 1 ? '' : 's'}</>}
            <span>{sdp.media.length} stream{sdp.media.length === 1 ? '' : 's'}</span>
          </p>
          {general.length > 0 && (
            <ul className="sdpl-general">
              {general.map((g, i) => <li key={i} className={`is-${g.severity}`}><b>{SEV_LABEL[g.severity]}:</b> {g.message}</li>)}
            </ul>
          )}
          <ol className="sdpl-lines" aria-label="Lines">
            {sdp.lines.map(l => {
              const iss = byLine.get(l.n) ?? [];
              const worst = iss.sort((a, b) => RANK[a.severity] - RANK[b.severity])[0]?.severity;
              return (
                <li key={l.n}>
                  <button type="button" className={`sdpl-line${worst ? ` is-${worst}` : ''}${sel === l.n ? ' is-sel' : ''}${l.media >= 0 ? ' in-media' : ''}`}
                    onClick={() => setSel(sel === l.n ? null : l.n)} aria-pressed={sel === l.n}>
                    <code className={`t-${l.type}`}>{l.raw || ' '}</code>
                    <span className="sdpl-explain">{worst && worst !== 'info' && <span className="sdpl-mark" aria-hidden="true">⚠ </span>}{l.explain}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      </div>

      {line && (
        <section className="sdpl-detail" aria-live="polite">
          <p className="pe-name">Line {line.n + 1}<span> · {line.media < 0 ? 'session level' : `media section ${line.media + 1}`}</span></p>
          <p className="pe-val">{line.raw}</p>
          <p className="sdpl-dtext">{line.explain}</p>
          {lineIssues.map((i, k) => <p key={k} className={`sdpl-issue is-${i.severity}`}><b>{SEV_LABEL[i.severity]}:</b> {i.message}</p>)}
          {quote && <p className="ud-q">“{markKeywords(quote.text.replace(/\s+/g, ' '))}” <a href={quote.url} target="_blank" rel="noopener">RFC {quote.rfc} §{quote.section} ↗</a></p>}
        </section>
      )}
      {!line && <p className="insp-hint sdpl-hint">Select a line to see the rule behind it.</p>}
    </figure>
  );
}
