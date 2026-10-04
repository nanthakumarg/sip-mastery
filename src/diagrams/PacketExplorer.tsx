/**
 * Packet layer explorer (Module 2.5): one captured SIP packet, shown the way
 * Wireshark shows it — a layer tree, and the raw bytes. Select a layer or a
 * field to see its bytes; point at bytes to find their field.
 */
import { useMemo, useState } from 'react';
import { buildFrame, type Field, type FrameInput, type Layer } from '../net/packet.ts';

interface Props { input: FrameInput }

const LAYER_CLASS: Record<Layer, string> = { eth: 'net', ip: 'net', udp: 'net', sip: 'sip' };

export default function PacketExplorer({ input }: Props) {
  const frame = useMemo(() => buildFrame(input), [input]);
  const [open, setOpen] = useState<Record<Layer, boolean>>({ eth: false, ip: true, udp: true, sip: false });
  const [sel, setSel] = useState<{ layer: Layer; field?: Field }>({ layer: 'ip', field: frame.fields.find(f => f.name === 'Source address') });

  const range = sel.field
    ? [sel.field.offset, sel.field.offset + sel.field.length]
    : (() => { const l = frame.layers.find(x => x.layer === sel.layer)!; return [l.offset, l.offset + l.length]; })();
  const fieldAt = (i: number) => frame.fields.find(f => i >= f.offset && i < f.offset + f.length);

  const rows = [];
  for (let r = 0; r < frame.bytes.length; r += 16) rows.push(r);

  return (
    <figure className="stage pktx">
      <header className="stage-head">
        <div>
          <p className="eyebrow">Packet capture</p>
          <p className="stage-title">One SIP {input.payload.split(' ')[0]}, layer by layer</p>
        </div>
        <ul className="legend" aria-label="Legend">
          <li><i className="lg-net" />Ethernet, IP, UDP</li>
          <li><i className="lg-sip" />SIP</li>
        </ul>
      </header>

      <p className="pktx-summary">
        Frame: {frame.bytes.length} bytes · {input.srcIp}:{input.srcPort} → {input.dstIp}:{input.dstPort} · UDP · SIP {input.payload.split(' ')[0]}
      </p>

      <div className="pktx-main">
        <div className="pktx-tree" role="tree" aria-label="Protocol layers">
          {frame.layers.map(l => (
            <div key={l.layer} role="treeitem" aria-expanded={open[l.layer]} className={`pktx-layer p-${LAYER_CLASS[l.layer]}${sel.layer === l.layer && !sel.field ? ' is-sel' : ''}`}>
              <button type="button" className="pktx-lhead" onClick={() => { setOpen(o => ({ ...o, [l.layer]: !o[l.layer] })); setSel({ layer: l.layer }); }}>
                <span className="pktx-caret" aria-hidden="true">{open[l.layer] ? '▾' : '▸'}</span>
                {l.title}
                <span className="pktx-len">{l.length} bytes</span>
              </button>
              {open[l.layer] && (
                <ul role="group">
                  {frame.fields.filter(f => f.layer === l.layer).map(f => (
                    <li key={f.offset}>
                      <button type="button" className={`pktx-field${sel.field === f ? ' is-sel' : ''}`} onClick={() => setSel({ layer: l.layer, field: f })}>
                        <span className="pf-name">{f.name}</span>
                        <span className="pf-val">{f.value}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>

        <div className="pktx-right">
          <div className="pktx-explain" aria-live="polite">
            {sel.field ? (
              <>
                <p className="pe-name">{sel.field.name} <span>· bytes {sel.field.offset}–{sel.field.offset + sel.field.length - 1}</span></p>
                <p className="pe-val">{sel.field.value}</p>
                <p>{sel.field.explain}</p>
              </>
            ) : (
              <>
                <p className="pe-name">{frame.layers.find(l => l.layer === sel.layer)!.title}</p>
                <p>{LAYER_TEXT[sel.layer]}</p>
              </>
            )}
          </div>
          <div className="pktx-hex" role="img" aria-label="Raw bytes of the frame, in hexadecimal and ASCII">
            {rows.map(r => (
              <div key={r} className="hx-row">
                <span className="hx-off">{r.toString(16).padStart(4, '0')}</span>
                <span className="hx-bytes">
                  {Array.from(frame.bytes.subarray(r, r + 16)).map((b, i) => {
                    const at = r + i;
                    const f = fieldAt(at);
                    const on = at >= range[0]! && at < range[1]!;
                    return (
                      <span key={i} className={`hx-b l-${f ? LAYER_CLASS[f.layer] : 'net'}${on ? ' is-on' : ''}`}
                        onMouseEnter={() => f && setSel({ layer: f.layer, field: f })}>{b.toString(16).padStart(2, '0')}</span>
                    );
                  })}
                </span>
                <span className="hx-ascii">
                  {Array.from(frame.bytes.subarray(r, r + 16)).map((b, i) => {
                    const at = r + i;
                    const on = at >= range[0]! && at < range[1]!;
                    return <span key={i} className={on ? 'is-on' : ''}>{b >= 32 && b < 127 ? String.fromCharCode(b) : '·'}</span>;
                  })}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </figure>
  );
}

const LAYER_TEXT: Record<Layer, string> = {
  eth: 'The link layer: it moves the frame to the next device on the same network. A capture on another link shows other MAC addresses.',
  ip: 'The network layer: it carries the packet from the source address to the destination address, across routers.',
  udp: 'The transport layer: the ports select the application. UDP adds no connection and no retransmission — SIP handles that itself.',
  sip: 'The application layer: the SIP message itself, as plain text. Wireshark shows it in readable form because SIP is text.',
};
