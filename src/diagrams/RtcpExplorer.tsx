/**
 * RTCP report explorer (Module 17): compound RTCP packets — SR, RR, SDES,
 * BYE — laid out 32 bits to a row. Select a field to see what it means, or
 * paste the UDP payload of an RTCP packet. The model is src/net/rtcp.ts.
 */
import { useMemo, useState } from 'react';
import BitMap from './BitMap.tsx';
import { markKeywords } from './Inspector.tsx';
import { decodeRtcp, encodeRtcp, type ReportBlock } from '../net/rtcp.ts';
import { parseHex, toHex } from '../net/rtp.ts';
import type { ClientQuote } from './types.ts';

interface Props { quotes: Record<string, ClientQuote> }

const ALICE = 0x3a5f12c4, BOB = 0x9b0c2d11;
/** Bob's stream, as Alice receives it: about 2% lost, 8 ms of jitter. */
const ABOUT_BOB: ReportBlock = { ssrc: BOB, fractionLost: 5, cumulativeLost: 31, extHighestSeq: 0x0001a3f2, jitter: 64, lsr: 0xb7052000, dlsr: 0x00010000 };
const ABOUT_ALICE: ReportBlock = { ssrc: ALICE, fractionLost: 0, cumulativeLost: 0, extHighestSeq: 0x00006c41, jitter: 24, lsr: 0xb70a8000, dlsr: 0x00008000 };

const PRESETS: [string, string][] = [
  ["Alice's SR + SDES", toHex(encodeRtcp([
    { type: 'SR', ssrc: ALICE, sender: { ntpSec: 0xb44db70a, ntpFrac: 0x80000000, rtpTs: 2412572560, packets: 1500, octets: 240000 }, blocks: [ABOUT_BOB] },
    { type: 'SDES', ssrc: ALICE, cname: 'alice@192.0.2.10' },
  ]))],
  ["Bob's RR + SDES (on hold)", toHex(encodeRtcp([
    { type: 'RR', ssrc: BOB, blocks: [ABOUT_ALICE] },
    { type: 'SDES', ssrc: BOB, cname: 'bob@203.0.113.20' },
  ]))],
  ['End of the stream: BYE', toHex(encodeRtcp([
    { type: 'RR', ssrc: ALICE, blocks: [] },
    { type: 'SDES', ssrc: ALICE, cname: 'alice@192.0.2.10' },
    { type: 'BYE', ssrcs: [ALICE], reason: 'call ended' },
  ]))],
  ['Wrong: SDES first', toHex(encodeRtcp([
    { type: 'SDES', ssrc: ALICE, cname: 'alice@192.0.2.10' },
    { type: 'RR', ssrc: ALICE, blocks: [ABOUT_BOB] },
  ]))],
];

export default function RtcpExplorer({ quotes }: Props) {
  const [hex, setHex] = useState(PRESETS[0]![1]);
  const parsed = useMemo(() => parseHex(hex), [hex]);
  const d = useMemo(() => (typeof parsed === 'string' ? undefined : decodeRtcp(parsed)), [parsed]);
  const [selKey, setSelKey] = useState('0.0fl');
  const sel = d?.fields.find(f => f.key === selKey) ?? d?.fields.find(f => f.name === 'Packet type');
  const quote = sel ? quotes[sel.rule] : undefined;
  const bits = sel && sel.bits <= 32 ? (sel.value >>> 0).toString(2).padStart(sel.bits, '0').slice(-sel.bits) : undefined;

  return (
    <figure className="stage rtph rtcpx" aria-label="RTCP report explorer">
      <header className="stage-head">
        <div>
          <p className="eyebrow">RTCP report explorer · RFC 3550 §6</p>
          <p className="stage-title">What does the other side say about your audio?</p>
        </div>
        <ul className="legend" aria-label="Legend">
          <li><i className="lg-rtcp" />RTCP</li>
          <li><span className="lg-warn">⚠</span>Problem</li>
        </ul>
      </header>

      <div className="ac-presets" aria-label="Examples">
        {PRESETS.map(([label, v]) => <button key={label} type="button" aria-pressed={hex === v} onClick={() => setHex(v)}>{label}</button>)}
      </div>

      <label className="rtph-input">
        <span className="eyebrow">Compound packet in hex · paste the UDP payload</span>
        <textarea value={hex} onChange={e => setHex(e.target.value)} spellCheck={false} autoComplete="off" rows={3} />
      </label>

      {typeof parsed === 'string' && <p className="rtph-err">{parsed}</p>}
      {d && d.issues.length > 0 && <ul className="rtph-issues">{d.issues.map(i => <li key={i}><span aria-hidden="true">⚠ </span>{i}</li>)}</ul>}
      {d && d.packets.length > 0 && (
        <ol className="rtcpx-packets" aria-label="Packets in the compound packet">
          {d.packets.map((p, i) => <li key={i} className={`p-rtcp${i % 2}`}><b>{p.type}</b> {p.length} bytes</li>)}
        </ol>
      )}

      {d && d.fields.length > 0 && (
        <div className="rtph-main">
          <div className="rtph-map-wrap">
            <BitMap fields={d.fields} sel={sel?.key} onSelect={setSelKey} label="Fields" />
          </div>
          {sel && (
            <section className="rtph-detail rtcpx-detail" aria-live="polite">
              <p className="pe-name">{sel.name}<span> · {sel.bits} bit{sel.bits === 1 ? '' : 's'}</span></p>
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
