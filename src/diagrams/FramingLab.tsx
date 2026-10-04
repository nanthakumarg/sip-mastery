/**
 * Framing lab (Module 4.5): how a receiver cuts bytes into SIP messages.
 * Break the Content-Length of the INVITE, or send LF line endings, and see
 * where a strict receiver thinks each message starts and ends — over TCP,
 * where messages share one byte stream, and over UDP, one per datagram.
 */
import { Fragment, useMemo, useState } from 'react';
import { bodyLength, frameDatagram, frameStream, withContentLength, type FramingResult, type Segment } from '../sip/framing.ts';
import { markKeywords } from './Inspector.tsx';
import type { ClientQuote } from './types.ts';
import { quoteSource } from '../lib/rfc-ref.ts';

interface Props {
  first: string;
  second: string;
  quotes: Record<string, ClientQuote>;
}

type Transport = 'tcp' | 'udp';
type Length = 'correct' | 'small' | 'large' | 'missing';
type Endings = 'crlf' | 'lf';

const DELTA = 24;

const TAG: Record<Segment['kind'], string> = {
  head: 'start line + headers',
  body: 'body',
  skipped: 'ignored CR LF',
  discarded: 'discarded',
  garbage: '⚠ not a SIP message',
  waiting: '⚠ waiting for more bytes',
};

/** Shows CR and LF as visible glyphs, and breaks the line after each LF. */
function Bytes({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\r|\n)/).map((p, i) =>
        p === '\r' ? <span key={i} className="fx-cr">␍</span>
          : p === '\n' ? <Fragment key={i}><span className="fx-lf">␊</span><br /></Fragment>
          : p)}
    </>
  );
}

function View({ text, result, label }: { text: string; result: FramingResult; label?: string }) {
  return (
    <div className="fx-bytes">
      {label && <p className="fx-dgram">{label} · {text.length} bytes</p>}
      <div className="fx-text">
        {result.segments.map((s, i) => (
          <span key={i} className={`fx-seg k-${s.kind}`}>
            <span className="fx-tag">{s.msg ? `Message ${s.msg} · ` : ''}{TAG[s.kind]}{s.kind === 'body' ? ` · ${s.end - s.start} bytes` : ''}</span>
            <Bytes text={text.slice(s.start, s.end)} />
          </span>
        ))}
      </div>
    </div>
  );
}

export default function FramingLab({ first, second, quotes }: Props) {
  const [transport, setTransport] = useState<Transport>('tcp');
  const [length, setLength] = useState<Length>('correct');
  const [endings, setEndings] = useState<Endings>('crlf');

  const real = bodyLength(first);
  const value = length === 'correct' ? real : length === 'small' ? real - DELTA : length === 'large' ? real + DELTA : null;

  const { msgs, results } = useMemo(() => {
    const lf = (s: string) => (endings === 'lf' ? s.replace(/\r\n/g, '\n') : s);
    // With LF endings the body is shorter; a "correct" Content-Length follows it.
    const firstLf = lf(first);
    const cl = value === null ? null : length === 'correct' && endings === 'lf' ? firstLf.length - firstLf.indexOf('\n\n') - 2 : value;
    const a = lf(withContentLength(first, cl));
    const b = lf(second);
    return transport === 'tcp'
      ? { msgs: [a + b], results: [frameStream(a + b)] }
      : { msgs: [a, b], results: [frameDatagram(a, 1), frameDatagram(b, 2)] };
  }, [first, second, transport, length, endings, value]);

  // The receiver cannot see that a "correct-looking" INVITE was framed wrongly; say so.
  const verdicts = results.flatMap(r => r.verdicts).map(v => {
    if (v.msg !== 1 || !v.ok || transport !== 'tcp' || endings !== 'crlf') return v;
    if (length === 'small') return { ...v, ok: false, text: `${v.text} But the real body is ${DELTA} bytes longer: the end of the SDP is cut off, and the receiver cannot tell.` };
    if (length === 'large') return { ...v, ok: false, text: `${v.text} But the last ${DELTA} of those bytes are really the start of the BYE.` };
    return v;
  });
  const allOk = verdicts.length === 2 && verdicts.every(v => v.ok);
  const quote = quotes[endings === 'lf' ? 'rfc3261-7-crlf' : transport === 'tcp' ? 'rfc3261-7.5-stream' : 'rfc3261-18.3-udp'];

  return (
    <figure className="stage framing">
      <header className="stage-head">
        <div>
          <p className="eyebrow">Framing lab</p>
          <p className="stage-title">Where does each message end?</p>
        </div>
        <ul className="legend" aria-label="Legend">
          <li><i className="lg-sip" />Start line and headers</li>
          <li><i className="lg-sdp" />Body (SDP)</li>
          <li><span className="lg-warn">⚠</span>Framing error</li>
        </ul>
      </header>

      <div className="fx-controls">
        <div>
          <p className="eyebrow">Transport</p>
          <div className="seg" role="group" aria-label="Transport">
            <button type="button" aria-pressed={transport === 'tcp'} onClick={() => setTransport('tcp')}>TCP: one stream</button>
            <button type="button" aria-pressed={transport === 'udp'} onClick={() => setTransport('udp')}>UDP: one datagram each</button>
          </div>
        </div>
        <div>
          <p className="eyebrow">Content-Length of the INVITE</p>
          <div className="seg" role="group" aria-label="Content-Length of the INVITE">
            <button type="button" aria-pressed={length === 'correct'} onClick={() => setLength('correct')}>Correct ({real})</button>
            <button type="button" aria-pressed={length === 'small'} onClick={() => setLength('small')}>Too small ({real - DELTA})</button>
            <button type="button" aria-pressed={length === 'large'} onClick={() => setLength('large')}>Too large ({real + DELTA})</button>
            <button type="button" aria-pressed={length === 'missing'} onClick={() => setLength('missing')}>Missing</button>
          </div>
        </div>
        <div>
          <p className="eyebrow">Line endings</p>
          <div className="seg" role="group" aria-label="Line endings">
            <button type="button" aria-pressed={endings === 'crlf'} onClick={() => setEndings('crlf')}>CR LF</button>
            <button type="button" aria-pressed={endings === 'lf'} onClick={() => setEndings('lf')}>LF only</button>
          </div>
        </div>
      </div>

      <div className="fx-main">
        <div className={`fx-stream t-${transport}`}>
          {msgs.map((t, i) => (
            <View key={i} text={t} result={results[i]!} label={transport === 'udp' ? `Datagram ${i + 1}` : `TCP stream from Proxy A to Proxy B`} />
          ))}
        </div>

        <aside className="fx-side">
          <p className={`fx-summary${allOk ? ' is-ok' : ' is-bad'}`} aria-live="polite">
            {allOk ? 'The receiver finds both messages: the INVITE and the BYE.' : '⚠ The receiver does not see the two messages that Proxy A sent.'}
          </p>
          <ul className="fx-verdicts">
            {verdicts.map((v, i) => (
              <li key={i} className={v.ok ? 'is-ok' : 'is-bad'}>
                <span className="fx-mark" aria-hidden="true">{v.ok ? '✓' : '⚠'}</span>
                <span><b>Message {v.msg}.</b> {v.text}</span>
              </li>
            ))}
          </ul>
          {quote && (
            <blockquote className="insp-quote">
              <p className="insp-q-src">{quoteSource(quote)}</p>
              <p>“{markKeywords(quote.text)}”</p>
              <a href={quote.url} target="_blank" rel="noopener">Read the section ↗</a>
            </blockquote>
          )}
        </aside>
      </div>
    </figure>
  );
}
