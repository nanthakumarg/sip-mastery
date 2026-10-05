/**
 * Bandwidth calculator (Module 16): codec, packet time, and transport to
 * kbit/s, with the bytes that each layer adds to every packet.
 * The model is src/net/rtp.ts (bandwidth).
 */
import { useMemo, useState } from 'react';
import { bandwidth, CODECS, LINK_LABEL, type LinkLayer } from '../net/rtp.ts';

const PTIMES = [10, 20, 30, 40, 60];
const LINKS: LinkLayer[] = ['ip', 'ethernet', 'vlan', 'wire'];

export default function BandwidthCalc() {
  const [codecId, setCodecId] = useState('pcmu');
  const [ptime, setPtime] = useState(20);
  const [ipv6, setIpv6] = useState(false);
  const [srtp, setSrtp] = useState(false);
  const [link, setLink] = useState<LinkLayer>('ethernet');
  const [calls, setCalls] = useState(10);
  const codec = CODECS.find(c => c.id === codecId)!;
  const pt = ptime % codec.frame === 0 ? ptime : codec.frame;
  const r = useMemo(() => bandwidth({ codec, ptime: pt, ipv6, srtp, link }), [codec, pt, ipv6, srtp, link]);
  const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(2)} Mbit/s` : `${n.toFixed(1)} kbit/s`);

  return (
    <figure className="stage bwc" aria-label="Bandwidth calculator">
      <header className="stage-head">
        <div>
          <p className="eyebrow">Bandwidth calculator</p>
          <p className="stage-title">What does one call really use?</p>
        </div>
        <ul className="legend" aria-label="Legend">
          <li><i className="lg-rtp" />Voice</li>
          <li><i className="lg-net" />Headers</li>
        </ul>
      </header>

      <div className="bwc-controls">
        <div className="seg bwc-seg" role="group" aria-label="Codec">
          {CODECS.map(c => <button key={c.id} type="button" aria-pressed={c.id === codecId} onClick={() => setCodecId(c.id)}>{c.name}</button>)}
        </div>
        <div className="seg bwc-seg" role="group" aria-label="Packet time">
          {PTIMES.map(p => <button key={p} type="button" aria-pressed={p === pt} disabled={p % codec.frame !== 0} onClick={() => setPtime(p)}>{p} ms</button>)}
        </div>
        <div className="seg bwc-seg" role="group" aria-label="Link layer">
          {LINKS.map(l => <button key={l} type="button" aria-pressed={l === link} onClick={() => setLink(l)}>{LINK_LABEL[l]}</button>)}
        </div>
        <div className="bwc-row">
          <button type="button" className="rl-toggle" aria-pressed={ipv6} onClick={() => setIpv6(!ipv6)}><span aria-hidden="true">{ipv6 ? '●' : '○'}</span>IPv6</button>
          <button type="button" className="rl-toggle" aria-pressed={srtp} onClick={() => setSrtp(!srtp)}><span aria-hidden="true">{srtp ? '●' : '○'}</span>SRTP</button>
          <label className="bwc-calls">Calls <input type="number" min={1} max={10000} value={calls} onChange={e => setCalls(Math.max(1, Math.min(10000, Number(e.target.value) || 1)))} /></label>
        </div>
      </div>

      <p className="bwc-codec"><b>{codec.name}</b> · {codec.kbps} kbit/s · {codec.band} · {codec.note}</p>

      <div className="bwc-bar" role="img" aria-label={`${r.packetBytes} bytes per packet`}>
        {r.layers.map((l, i) => (
          <span key={l.name} className={`bwc-seg-${i === 0 ? 'voice' : 'hdr'}`} style={{ flexGrow: l.bytes, opacity: i === 0 ? 1 : 1 - i * 0.12 }} title={`${l.name}: ${l.bytes} bytes`}>
            {l.bytes >= 12 ? l.bytes : ''}
          </span>
        ))}
      </div>

      <table className="bwc-table">
        <thead><tr><th scope="col">Layer</th><th scope="col">Bytes per packet</th><th scope="col">kbit/s</th></tr></thead>
        <tbody>
          {r.layers.map(l => <tr key={l.name}><th scope="row">{l.name}</th><td>{l.bytes}</td><td>{l.kbps.toFixed(1)}</td></tr>)}
          <tr className="bwc-total"><th scope="row">One packet</th><td>{r.packetBytes}</td><td>{r.kbps.toFixed(1)}</td></tr>
        </tbody>
      </table>

      <div className="bwc-stats">
        <div className="stat"><b>{fmt(r.kbps)}</b><span>one direction, one call</span></div>
        <div className="stat"><b>{fmt(r.kbps * 2)}</b><span>both directions</span></div>
        <div className="stat"><b>{fmt(r.kbps * calls)}</b><span>{calls} call{calls === 1 ? '' : 's'}, each direction</span></div>
        <div className="stat"><b>{r.packetsPerSecond.toFixed(r.packetsPerSecond % 1 ? 1 : 0)}</b><span>packets per second</span></div>
        <div className="stat"><b>+{r.tsStep}</b><span>timestamp per packet</span></div>
        <div className="stat"><b>{Math.round(r.payloadShare * 100)}%</b><span>of each packet is voice</span></div>
      </div>
    </figure>
  );
}
