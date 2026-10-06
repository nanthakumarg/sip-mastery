/**
 * DSCP explorer (Module 29.2): pick a kind of traffic and see its DSCP in
 * the first 32 bits of the IPv4 header, the old ToS byte, and the Ethernet
 * and Wi-Fi priorities it usually maps to. Then check a phone's setting:
 * is the number a DSCP or a ToS value?
 */
import { useState } from 'react';
import BitMap, { type BitField } from './BitMap.tsx';
import { dscpFromTos, TRAFFIC_CLASSES, tosByte } from '../net/quality.ts';

const bin = (n: number, w: number) => n.toString(2).padStart(w, '0');
const FIELD_NOTES: Record<string, string> = {
  Version: 'IPv4. In IPv6, the same eight bits are the Traffic Class byte, with the same DSCP and ECN inside.',
  IHL: 'Header length in 32-bit words: 5 means 20 bytes, no options.',
  DSCP: 'Differentiated Services Code Point: six bits that pick the treatment (the per-hop behaviour) at every router.',
  ECN: 'Explicit Congestion Notification: a router can mark a packet instead of dropping it. Usually 00 for RTP over UDP.',
  'Total Length': 'Length of the whole packet: 20 bytes IP + 8 UDP + 12 RTP + 160 G.711 = 200.',
};

export default function DscpExplorer() {
  const [id, setId] = useState('rtp');
  const [field, setField] = useState('DSCP');
  const [mode, setMode] = useState<'dscp' | 'tos'>('tos');
  const [value, setValue] = useState('46');
  const c = TRAFFIC_CLASSES.find(t => t.id === id)!;
  const fields: BitField[] = [
    { key: 'Version', label: 'Ver', name: 'Version', bit: 0, bits: 4, shown: '4', part: 'header' },
    { key: 'IHL', name: 'Header length', bit: 4, bits: 4, shown: '5', part: 'header' },
    { key: 'DSCP', name: 'DSCP', bit: 8, bits: 6, shown: `${bin(c.dscp, 6)} = ${c.dscp}`, part: 'ds' },
    { key: 'ECN', name: 'ECN', bit: 14, bits: 2, shown: '00', part: 'ecn' },
    { key: 'Total Length', name: 'Total length', bit: 16, bits: 16, shown: '200', part: 'header' },
  ];
  const n = Number(value);
  const valid = value !== '' && Number.isInteger(n) && n >= 0 && n <= 255;
  const dscp = !valid ? NaN : mode === 'dscp' ? n : dscpFromTos(n);
  const known = TRAFFIC_CLASSES.find(t => t.dscp === dscp);

  return (
    <figure className="stage dscp" aria-label="DSCP explorer">
      <header className="stage-head">
        <div>
          <p className="eyebrow">DSCP · RFC 2474, RFC 4594</p>
          <p className="stage-title">Six bits that decide which packet waits</p>
        </div>
        <div className="seg" role="group" aria-label="Traffic">
          {TRAFFIC_CLASSES.map(t => <button key={t.id} type="button" aria-pressed={t.id === id} onClick={() => setId(t.id)}>{t.name}</button>)}
        </div>
      </header>
      <div className="dscp-main">
        <div>
          <BitMap fields={fields} sel={field} onSelect={setField} label="The first 32 bits of the IPv4 header" />
          <p className="dscp-note">{FIELD_NOTES[field]}</p>
          <dl className="dscp-facts">
            <dt>DSCP</dt><dd><code>{c.dscpName}</code> = <code>{c.dscp}</code> = <code>{bin(c.dscp, 6)}</code></dd>
            <dt>ToS byte</dt><dd><code>{tosByte(c.dscp)}</code> = <code>0x{tosByte(c.dscp).toString(16).toUpperCase().padStart(2, '0')}</code> (DSCP × 4, with ECN 00)</dd>
            <dt>Ethernet</dt><dd>802.1p priority (CoS) {c.cos}</dd>
            <dt>Wi-Fi</dt><dd>{c.wifi}</dd>
            <dt>Queue</dt><dd>{c.queue}</dd>
            <dt>Why</dt><dd>{c.note}</dd>
          </dl>
        </div>
        <div className="dscp-check">
          <p className="eyebrow">Check a phone's QoS setting</p>
          <p>Phones and switches ask for "DSCP" or for "ToS" (or "IP precedence"). The same number means different things.</p>
          <label>
            <span className="seg" role="group" aria-label="The field is">
              <button type="button" aria-pressed={mode === 'dscp'} onClick={() => setMode('dscp')}>DSCP field</button>
              <button type="button" aria-pressed={mode === 'tos'} onClick={() => setMode('tos')}>ToS field</button>
            </span>
            <input value={value} onChange={e => setValue(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" aria-label="Value" />
          </label>
          {!valid || (mode === 'dscp' && n > 63) ? (
            <p className="is-bad">A DSCP has six bits: 0 to 63. {mode === 'dscp' && n > 63 && n <= 255 ? `${n} looks like a ToS value: it means DSCP ${dscpFromTos(n)}.` : ''}</p>
          ) : (
            <>
              <p>The packets leave with <b>DSCP {dscp}</b> ({bin(dscp, 6)}){known ? `: ${known.dscpName}, ${known.name.toLowerCase()}.` : ': no standard class.'}</p>
              <p className={dscp === 46 ? 'is-ok' : 'is-bad'}>
                {dscp === 46 ? 'Voice gets EF, the priority queue.' : mode === 'tos' && n === 46 ? 'Wrong: 46 is the DSCP for EF. In a ToS field, EF is 184.' : `For voice you want DSCP 46, which is ToS ${tosByte(46)}.`}
              </p>
            </>
          )}
        </div>
      </div>
    </figure>
  );
}
