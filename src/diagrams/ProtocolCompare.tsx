/**
 * Signaling protocols side by side (Module 1.2). Each tab draws the control
 * model of one protocol and lists the facts that matter when you meet it.
 * Colour language: amber = SIP, dashed cyan = RTP media; other signaling
 * protocols are drawn in neutral white, because they have no colour of their own.
 */
import { useState } from 'react';

interface Node { id: string; label: string; x: number; y: number; kind: 'ua' | 'server' }
interface Edge { a: string; b: string; label: string; kind: 'sip' | 'rtp' | 'other' | 'tdm'; dy?: number }
interface Proto {
  id: string;
  name: string;
  nodes: Node[];
  edges: Edge[];
  facts: [string, string][];
  vsSip: string;
}

const P: Proto[] = [
  {
    id: 'sip', name: 'SIP',
    nodes: [
      { id: 'a', label: 'Phone', x: 70, y: 70, kind: 'ua' }, { id: 'p1', label: 'Proxy', x: 230, y: 70, kind: 'server' },
      { id: 'p2', label: 'Proxy', x: 390, y: 70, kind: 'server' }, { id: 'b', label: 'Phone', x: 550, y: 70, kind: 'ua' },
    ],
    edges: [
      { a: 'a', b: 'p1', label: 'SIP', kind: 'sip' }, { a: 'p1', b: 'p2', label: 'SIP', kind: 'sip' }, { a: 'p2', b: 'b', label: 'SIP', kind: 'sip' },
      { a: 'a', b: 'b', label: 'RTP', kind: 'rtp', dy: 80 },
    ],
    facts: [
      ['Defined by', 'IETF: RFC 2543 (1999), replaced by RFC 3261 (2002)'],
      ['Encoding', 'Text (UTF-8), like HTTP'],
      ['Control model', 'Peer to peer. Phones are full user agents; proxies route between them.'],
      ['Where you meet it', 'Almost everywhere: PBXs, SIP trunks, mobile networks (IMS), UC platforms'],
    ],
    vsSip: 'This course is about SIP. The other tabs show what came before it, and what still runs next to it.',
  },
  {
    id: 'h323', name: 'H.323',
    nodes: [
      { id: 'a', label: 'Terminal', x: 90, y: 110, kind: 'ua' }, { id: 'gk', label: 'Gatekeeper', x: 310, y: 40, kind: 'server' },
      { id: 'b', label: 'Terminal', x: 530, y: 110, kind: 'ua' },
    ],
    edges: [
      { a: 'a', b: 'gk', label: 'RAS', kind: 'other' }, { a: 'gk', b: 'b', label: 'RAS', kind: 'other' },
      { a: 'a', b: 'b', label: 'H.225.0 call · H.245 control', kind: 'other' },
      { a: 'a', b: 'b', label: 'RTP', kind: 'rtp', dy: 60 },
    ],
    facts: [
      ['Defined by', 'ITU-T, first in 1996. An umbrella of standards: H.225.0, H.245, and more.'],
      ['Encoding', 'Binary (ASN.1)'],
      ['Control model', 'Endpoints call each other. An optional gatekeeper handles registration and admission (RAS).'],
      ['Where you meet it', 'Older video conferencing rooms and some older carrier interconnects'],
    ],
    vsSip: 'H.323 came from the telephone world and splits call setup over several protocols. SIP does the same job with one text protocol. Both use RTP for media.',
  },
  {
    id: 'mgcp', name: 'MGCP and H.248',
    nodes: [
      { id: 'ca', label: 'Call agent', x: 310, y: 40, kind: 'server' },
      { id: 'g1', label: 'Gateway', x: 110, y: 130, kind: 'ua' }, { id: 'g2', label: 'Gateway', x: 510, y: 130, kind: 'ua' },
    ],
    edges: [
      { a: 'ca', b: 'g1', label: 'commands', kind: 'other' }, { a: 'ca', b: 'g2', label: 'commands', kind: 'other' },
      { a: 'g1', b: 'g2', label: 'RTP', kind: 'rtp', dy: 0 },
    ],
    facts: [
      ['Defined by', 'MGCP: IETF RFC 3435 (2003, Informational). H.248: ITU-T, also published as Megaco (RFC 3015, 2000; the later RFC 3525 is now Historic).'],
      ['Encoding', 'MGCP: text. H.248: text or binary.'],
      ['Control model', 'Master and slave. A central call agent tells simple gateways what to do: "ring this line", "connect these ports".'],
      ['Where you meet it', 'Cable telephony, and media gateways in mobile networks (H.248)'],
    ],
    vsSip: 'MGCP and H.248 do not replace SIP: they control gateways. A network often uses SIP between call controllers and H.248 from a controller to its gateways.',
  },
  {
    id: 'isup', name: 'ISUP (SS7)',
    nodes: [
      { id: 'e1', label: 'Exchange', x: 110, y: 110, kind: 'server' }, { id: 'stp', label: 'SS7 network', x: 310, y: 35, kind: 'server' },
      { id: 'e2', label: 'Exchange', x: 510, y: 110, kind: 'server' },
    ],
    edges: [
      { a: 'e1', b: 'stp', label: 'ISUP', kind: 'other' }, { a: 'stp', b: 'e2', label: 'ISUP', kind: 'other' },
      { a: 'e1', b: 'e2', label: 'voice circuit (TDM)', kind: 'tdm', dy: 30 },
    ],
    facts: [
      ['Defined by', 'ITU-T Q.761 to Q.764, part of Signalling System No. 7 (SS7)'],
      ['Encoding', 'Binary'],
      ['Control model', 'Between telephone exchanges, on a separate signaling network. The voice uses a reserved circuit.'],
      ['Where you meet it', 'The public telephone network. SIP-I and SIP-T carry ISUP inside SIP at gateways.'],
    ],
    vsSip: 'ISUP is the signaling of the old telephone network. At every SIP trunk, a gateway translates between ISUP and SIP. Module 24 covers the mapping of cause codes.',
  },
  {
    id: 'iax', name: 'IAX2',
    nodes: [{ id: 'a', label: 'Asterisk', x: 150, y: 80, kind: 'server' }, { id: 'b', label: 'Asterisk', x: 470, y: 80, kind: 'server' }],
    edges: [{ a: 'a', b: 'b', label: 'IAX2: signaling and media, UDP 4569', kind: 'other' }],
    facts: [
      ['Defined by', 'The Asterisk project. Documented in RFC 5456 (2010, Informational).'],
      ['Encoding', 'Binary'],
      ['Control model', 'Peer to peer, with signaling and media in one UDP flow on one port.'],
      ['Where you meet it', 'Links between Asterisk servers'],
    ],
    vsSip: 'One port for everything makes IAX2 easy to pass through NAT. SIP uses separate ports for signaling and media, which is why NAT causes so many SIP problems (Module 20).',
  },
];

const W = 120, H = 44;

export default function ProtocolCompare() {
  const [id, setId] = useState('sip');
  const p = P.find(x => x.id === id)!;
  const N = (nid: string) => p.nodes.find(n => n.id === nid)!;

  return (
    <figure className="stage protocmp">
      <header className="stage-head">
        <div>
          <p className="eyebrow">Signaling protocols</p>
          <p className="stage-title">Who controls the call?</p>
        </div>
        <div className="seg" role="tablist" aria-label="Protocol">
          {P.map(x => (
            <button key={x.id} type="button" role="tab" aria-selected={x.id === id} onClick={() => setId(x.id)}>{x.name}</button>
          ))}
        </div>
      </header>
      <div className="pc-body" role="tabpanel" aria-label={p.name}>
        <svg className="pc-diagram" viewBox="0 0 620 200" role="img" aria-label={`Control model of ${p.name}`}>
          <defs>
            <marker id="pc-mk" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" style={{ fill: 'var(--dim)' }} />
            </marker>
          </defs>
          {p.edges.map((e, i) => {
            const a = N(e.a), b = N(e.b);
            const dy = e.dy ?? 0;
            const curved = dy !== 0;
            const d = curved
              ? `M${a.x} ${a.y + H / 2} C${a.x} ${a.y + H / 2 + dy} ${b.x} ${b.y + H / 2 + dy} ${b.x} ${b.y + H / 2}`
              : `M${a.x} ${a.y} L${b.x} ${b.y}`;
            const mx = (a.x + b.x) / 2;
            const my = curved ? Math.max(a.y, b.y) + H / 2 + dy * 0.75 + 16 : (a.y + b.y) / 2 - 8;
            return (
              <g key={i} className={`pc-edge k-${e.kind}`}>
                <path d={d} />
                <text x={mx} y={my} textAnchor="middle">{e.label}</text>
              </g>
            );
          })}
          {p.nodes.map(n => (
            <g key={n.id} className="pc-node">
              <rect x={n.x - W / 2} y={n.y - H / 2} width={W} height={H} rx={n.kind === 'ua' ? 12 : 3} />
              <text x={n.x} y={n.y + 5} textAnchor="middle">{n.label}</text>
            </g>
          ))}
        </svg>
        <dl className="pc-facts">
          {p.facts.map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v}</dd></div>))}
        </dl>
      </div>
      <p className="stage-caption cap-text">{p.vsSip}</p>
    </figure>
  );
}
