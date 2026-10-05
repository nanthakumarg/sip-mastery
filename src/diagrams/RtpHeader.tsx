/**
 * RTP header bit map (Module 16): an RTP packet laid out 32 bits to a row,
 * as RFC 3550 draws it. Select a field to see its bits, value, and meaning;
 * paste hex from a capture to decode it. The model is src/net/rtp.ts.
 */
import { useMemo, useState } from 'react';
import BitMap from './BitMap.tsx';
import { markKeywords } from './Inspector.tsx';
import { decodeRtp, encodeEvent, encodeRtp, parseHex, toHex, type RtpField } from '../net/rtp.ts';
import type { ClientQuote } from './types.ts';

interface Props { quotes: Record<string, ClientQuote> }

const voice = (n: number, v: number) => new Uint8Array(n).fill(v);
const pkt = (h: Partial<Parameters<typeof encodeRtp>[0]>, payload: Uint8Array) =>
  toHex(encodeRtp({ version: 2, padding: 0, marker: false, pt: 0, seq: 26232, ts: 2412530560, ssrc: 0x3a5f12c4, csrc: [], ...h }, payload));

const PRESETS: [string, string][] = [
  ['PCMU voice', pkt({}, voice(160, 0xff))],
  ['Start of a talkspurt', pkt({ marker: true, seq: 26240, ts: 2412534400 }, voice(160, 0xfe))],
  ['Comfort noise', pkt({ pt: 13, seq: 26239, ts: 2412533120 }, new Uint8Array([0x3c]))],
  ['DTMF 5, first packet', pkt({ pt: 101, marker: true, seq: 26300, ts: 2412544000 }, encodeEvent({ event: 5, end: false, volume: 10, duration: 160 }))],
  ['DTMF 5, end', pkt({ pt: 101, seq: 26306, ts: 2412544000 }, encodeEvent({ event: 5, end: true, volume: 10, duration: 1120 }))],
  ['Conference mixer', pkt({ pt: 8, ssrc: 0x77e1c0de, csrc: [0x3a5f12c4, 0x9b0c2d11] }, voice(160, 0xd5))],
  ['Header extension', pkt({ pt: 111, ext: { profile: 0xbede, words: [0x10a70000] } }, voice(60, 0x78))],
  ['Not RTP', '80 c8 00 06 3a 5f 12 c4 e9 4b 2a 31 0c 4f 5a 30 8f cc 4b 80 00 00 01 2c 00 00 bb 80'],
];

const PART_NAME: Record<RtpField['part'], string> = { header: 'Fixed header', csrc: 'CSRC list', ext: 'Header extension', payload: 'Payload', padding: 'Padding' };

export default function RtpHeader({ quotes }: Props) {
  const [hex, setHex] = useState(PRESETS[0]![1]);
  const parsed = useMemo(() => parseHex(hex), [hex]);
  const d = useMemo(() => (typeof parsed === 'string' ? undefined : decodeRtp(parsed)), [parsed]);
  const [selKey, setSelKey] = useState('PT');
  const sel = d?.fields.find(f => f.key === selKey) ?? d?.fields[0];
  const quote = sel ? quotes[sel.rule] : undefined;
  const bits = sel && sel.bits <= 32 ? sel.value.toString(2).padStart(sel.bits, '0') : undefined;

  return (
    <figure className="stage rtph" aria-label="RTP header bit map">
      <header className="stage-head">
        <div>
          <p className="eyebrow">RTP header · RFC 3550 §5.1</p>
          <p className="stage-title">Twelve bytes in front of every 20 ms of voice</p>
        </div>
        <ul className="legend" aria-label="Legend">
          <li><i className="lg-rtp" />RTP</li>
          <li><span className="lg-warn">⚠</span>Problem</li>
        </ul>
      </header>

      <div className="ac-presets" aria-label="Examples">
        {PRESETS.map(([label, v]) => <button key={label} type="button" aria-pressed={hex === v} onClick={() => setHex(v)}>{label}</button>)}
      </div>

      <label className="rtph-input">
        <span className="eyebrow">Packet bytes in hex · paste from Wireshark (UDP payload)</span>
        <textarea value={hex} onChange={e => setHex(e.target.value)} spellCheck={false} autoComplete="off" rows={3} />
      </label>

      {typeof parsed === 'string' && <p className="rtph-err">{parsed}</p>}
      {d && d.issues.length > 0 && <ul className="rtph-issues">{d.issues.map(i => <li key={i}><span aria-hidden="true">⚠ </span>{i}</li>)}</ul>}

      {d && d.fields.length > 0 && (
        <div className="rtph-main">
          <div className="rtph-map-wrap">
            <BitMap fields={d.fields} sel={sel?.key} onSelect={setSelKey} label="Fields" />
            <p className="rtph-size">{d.payloadOffset} bytes of header, {d.payloadLength} byte{d.payloadLength === 1 ? '' : 's'} of payload{d.event ? ` · telephone-event: key ${d.event.event > 9 ? ['*', '#', 'A', 'B', 'C', 'D', 'flash'][d.event.event - 10] : d.event.event}${d.event.end ? ', end' : ''}` : ''}</p>
          </div>

          {sel && (
            <section className="rtph-detail" aria-live="polite">
              <p className="pe-name">{sel.name}<span> · {PART_NAME[sel.part]} · {sel.bits} bit{sel.bits === 1 ? '' : 's'}</span></p>
              <p className="pe-val">{sel.shown}</p>
              {bits && <p className="rtph-bits">{bits.split('').map((b, i) => <span key={i} className={b === '1' ? 'is-1' : ''}>{b}</span>)}</p>}
              <p className="rtph-explain">{sel.explain}</p>
              {quote && <p className="ud-q">“{markKeywords(quote.text.replace(/\s+/g, ' '))}” <a href={quote.url} target="_blank" rel="noopener">RFC {quote.rfc} §{quote.section} ↗</a></p>}
            </section>
          )}
        </div>
      )}
    </figure>
  );
}
