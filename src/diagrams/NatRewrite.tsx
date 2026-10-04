/**
 * What NAT does to a SIP packet (Module 2.4). A REGISTER leaves the home
 * network; the NAT router rewrites the IP source and UDP port, but not the
 * addresses inside the SIP message. The reply returns only if the registrar
 * uses rport (RFC 3581). Full treatment in Module 20.
 */
import { useEffect, useState } from 'react';
import { PlayerControls, usePlayer } from './player.tsx';

type Pt = [number, number];
const NODES: Record<string, { label: string; sub: string; at: Pt; kind: 'ua' | 'server' | 'nat' }> = {
  phone: { label: 'Alice', sub: '192.168.1.20', at: [110, 180], kind: 'ua' },
  nat: { label: 'NAT router', sub: 'inside 192.168.1.1 · outside 203.0.113.50', at: [420, 180], kind: 'nat' },
  reg: { label: 'Registrar', sub: 'atlanta.example', at: [800, 110], kind: 'server' },
  proxy: { label: 'Proxy A', sub: '198.51.100.10', at: [800, 260], kind: 'server' },
};
const W = 170, H = 58;

type Mark = 'nat' | 'private' | 'proxy' | undefined;
interface Row { k: string; v: string; mark?: Mark }
interface Step {
  from: string; to: string;
  /** Where the packet stops: 1 = arrives, 0.5 = dropped half way */
  reach?: number;
  dropped?: boolean;
  label: string;
  caption: string;
  rows: Row[];
  nat: boolean;
}

const VIA = 'SIP/2.0/UDP 192.168.1.20:5060;rport;branch=z9hG4bKnat01';
const CONTACT = '<sip:alice@192.168.1.20:5060>';

function steps(rport: boolean): Step[] {
  const reqInside: Row[] = [
    { k: 'IP source', v: '192.168.1.20' }, { k: 'UDP source port', v: '5060' },
    { k: 'IP destination', v: '198.51.100.10' }, { k: 'UDP destination port', v: '5060' },
    { k: 'Via', v: rport ? VIA : VIA.replace(';rport', '') }, { k: 'Contact', v: CONTACT },
  ];
  const reqOutside: Row[] = [
    { k: 'IP source', v: '203.0.113.50', mark: 'nat' }, { k: 'UDP source port', v: '40112', mark: 'nat' },
    { k: 'IP destination', v: '198.51.100.10' }, { k: 'UDP destination port', v: '5060' },
    { k: 'Via', v: rport ? VIA : VIA.replace(';rport', ''), mark: 'private' }, { k: 'Contact', v: CONTACT, mark: 'private' },
  ];
  const respVia = rport
    ? 'SIP/2.0/UDP 192.168.1.20:5060;received=203.0.113.50;rport=40112;branch=z9hG4bKnat01'
    : 'SIP/2.0/UDP 192.168.1.20:5060;received=203.0.113.50;branch=z9hG4bKnat01';
  const resp = (dst: string, port: string, natMark = false): Row[] => [
    { k: 'IP source', v: '198.51.100.10' }, { k: 'UDP source port', v: '5060' },
    { k: 'IP destination', v: dst, mark: natMark ? 'nat' : undefined }, { k: 'UDP destination port', v: port, mark: natMark ? 'nat' : undefined },
    { k: 'Via', v: respVia, mark: 'proxy' },
  ];
  return [
    { from: 'phone', to: 'nat', label: 'REGISTER', caption: "Alice's phone sends REGISTER. Inside the home network, every address is private.", rows: reqInside, nat: false },
    { from: 'nat', to: 'nat', label: 'REGISTER', caption: 'The NAT router replaces the private source address and port with its public ones. It does not touch the SIP text.', rows: reqOutside, nat: true },
    { from: 'nat', to: 'reg', label: 'REGISTER', caption: 'The Registrar sees the packet come from 203.0.113.50:40112. The Via and Contact headers still say 192.168.1.20.', rows: reqOutside, nat: true },
    rport
      ? { from: 'reg', to: 'nat', label: '401 Unauthorized', caption: 'With rport, the Registrar records the real source address and port in the Via, and replies to 203.0.113.50:40112.', rows: resp('203.0.113.50', '40112'), nat: true }
      : { from: 'reg', to: 'nat', label: '401 Unauthorized', caption: 'Without rport, RFC 3261 sends the reply to the received address and the Via port: 203.0.113.50:5060.', rows: resp('203.0.113.50', '5060'), nat: true },
    rport
      ? { from: 'nat', to: 'phone', label: '401 Unauthorized', caption: 'The router finds its mapping for port 40112 and passes the reply to 192.168.1.20:5060.', rows: resp('192.168.1.20', '5060', true), nat: true }
      : { from: 'nat', to: 'nat', dropped: true, label: '401 Unauthorized', caption: 'The router has no mapping for port 5060, so it drops the reply. The phone never registers.', rows: resp('203.0.113.50', '5060'), nat: true },
    { from: 'proxy', to: 'nat', reach: 0.45, dropped: true, label: 'INVITE', caption: 'Later, a call arrives for Alice. Proxy A sends it to the Contact, 192.168.1.20 — a private address it cannot reach.',
      rows: [{ k: 'IP destination', v: '192.168.1.20', mark: 'private' }, { k: 'UDP destination port', v: '5060' }, { k: 'Request-URI', v: 'sip:alice@192.168.1.20:5060', mark: 'private' }], nat: true },
  ];
}

/** Point where the line from a toward b leaves the box around a. */
function edge(a: Pt, b: Pt, gap = 6): Pt {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.min(dx ? (W / 2 + gap) / Math.abs(dx) : Infinity, dy ? (H / 2 + gap) / Math.abs(dy) : Infinity);
  return [a[0] + dx * t, a[1] + dy * t];
}

const MARK_TEXT: Record<Exclude<Mark, undefined>, string> = {
  nat: 'rewritten by NAT',
  private: 'still private',
  proxy: 'added by the Registrar',
};

export default function NatRewrite() {
  const [rport, setRport] = useState(true);
  const list = steps(rport);
  const p = usePlayer(list.length, 3000);
  const s = list[p.current]!;
  const [motion, setMotion] = useState(false);
  useEffect(() => { setMotion(!window.matchMedia('(prefers-reduced-motion: reduce)').matches); }, []);

  const a = NODES[s.from]!.at, b = NODES[s.to]!.at;
  const atRouter = s.from === s.to;
  const p1 = atRouter ? a : edge(a, b);
  const p2full = atRouter ? a : edge(b, a);
  const reach = s.reach ?? 1;
  const p2: Pt = [p1[0] + (p2full[0] - p1[0]) * reach, p1[1] + (p2full[1] - p1[1]) * reach];
  const path = `M${p1[0]} ${p1[1]} L${p2[0]} ${p2[1]}`;
  const mid: Pt = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];

  return (
    <figure className="stage natrw" tabIndex={0} onKeyDown={p.onKey}>
      <header className="stage-head">
        <div>
          <p className="eyebrow">NAT</p>
          <p className="stage-title">What a NAT router does to a SIP packet</p>
        </div>
        <label className="cvp-toggle">
          <input type="checkbox" checked={rport} onChange={e => { setRport(e.target.checked); }} />
          <span>Use rport (RFC 3581)</span>
        </label>
      </header>

      <div className="nr-main">
        <div className="nr-svg-wrap">
        <svg className="nr-svg" viewBox="0 0 960 340" role="img" aria-label={`Step ${p.current + 1}: ${s.caption}`}>
          <defs>
            <marker id="nr-mk" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" style={{ fill: 'var(--sip)' }} />
            </marker>
          </defs>
          <g className="cm-group"><rect x={20} y={40} width={515} height={280} rx={10} /><text x={34} y={64}>Home network (private addresses)</text></g>
          <g className="cm-group"><rect x={690} y={40} width={250} height={280} rx={10} /><text x={704} y={64}>atlanta.example</text></g>
          <text className="nr-internet" x={612} y={150} textAnchor="middle">Internet</text>
          {/* static links */}
          {[['phone', 'nat'], ['nat', 'reg'], ['nat', 'proxy']].map(([x, y]) => {
            const q1 = edge(NODES[x!]!.at, NODES[y!]!.at), q2 = edge(NODES[y!]!.at, NODES[x!]!.at);
            return <path key={`${x}${y}`} className="cm-link" d={`M${q1[0]} ${q1[1]} L${q2[0]} ${q2[1]}`} />;
          })}
          {/* current packet */}
          {!atRouter && (
            <g key={`${p.current}-${rport}`} className="cm-current">
              <path className="cm-msg" d={path} style={{ stroke: 'var(--sip)' }} markerEnd={s.dropped ? undefined : 'url(#nr-mk)'} />
              {motion && (
                <circle r={7} className="cm-packet" style={{ fill: 'var(--sip)' }}>
                  <animateMotion dur="0.8s" fill="freeze" path={path} />
                  {s.dropped && <animate attributeName="opacity" from="1" to="0" begin="0.7s" dur="0.15s" fill="freeze" />}
                </circle>
              )}
              {s.dropped && <text className="nr-drop" x={p2[0]} y={p2[1] + 7} textAnchor="middle">✕</text>}
              <g className="cm-pill" transform={`translate(${mid[0]} ${mid[1] - 26})`}>
                <rect x={-(s.label.length * 4.4 + 14)} y={-13} width={s.label.length * 8.8 + 28} height={26} rx={13} style={{ stroke: 'var(--sip)' }} />
                <text textAnchor="middle" y={4.5}>{s.label}</text>
              </g>
            </g>
          )}
          {atRouter && (
            <g key={`at-${p.current}-${rport}`} className="cm-current">
              {!s.dropped && <circle className="nr-pulse" cx={a[0]} cy={a[1]} r={H} />}
              <g className="cm-pill" transform={`translate(${a[0]} ${a[1] - H / 2 - 30})`}>
                <rect x={-(s.label.length * 4.4 + 14)} y={-13} width={s.label.length * 8.8 + 28} height={26} rx={13} style={{ stroke: 'var(--sip)' }} />
                <text textAnchor="middle" y={4.5}>{s.label}</text>
              </g>
              {s.dropped && <text className="nr-drop" x={a[0] + W / 2 + 18} y={a[1] - H / 2 + 4} textAnchor="middle">✕</text>}
            </g>
          )}
          {Object.entries(NODES).map(([id, n]) => {
            const active = id === s.from || id === s.to;
            return (
              <g key={id} className={`cm-node${active ? ' is-active' : ''}`}>
                <rect className="cm-box" x={n.at[0] - W / 2} y={n.at[1] - H / 2} width={W} height={H} rx={n.kind === 'ua' ? 16 : 4} />
                <text className="cm-label" x={n.at[0]} y={n.at[1] - 4} textAnchor="middle">{n.label}</text>
                <text className="cm-sub" x={n.at[0]} y={n.at[1] + 15} textAnchor="middle">{n.sub.length > 26 ? n.sub.split(' · ')[0] : n.sub}</text>
                {n.kind === 'nat' && <text className="cm-sub" x={n.at[0]} y={n.at[1] + H / 2 + 18} textAnchor="middle">{n.sub.split(' · ')[1]}</text>}
              </g>
            );
          })}
        </svg>
        </div>

        <div className="nr-side">
          <table className="nr-card" aria-label="Packet fields at this step">
            <tbody>
              {s.rows.map(r => (
                <tr key={r.k} className={r.mark ? `m-${r.mark}` : ''}>
                  <th scope="row">{r.k}</th>
                  <td><code>{r.v}</code>{r.mark && <span className="nr-mark">{MARK_TEXT[r.mark]}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className={`nr-table${s.nat ? '' : ' is-empty'}`}>
            <p className="eyebrow">NAT mapping table</p>
            {s.nat
              ? <p><code>192.168.1.20:5060</code> ⇄ <code>203.0.113.50:40112</code> · UDP</p>
              : <p>Empty. The router creates a mapping when the first packet goes out.</p>}
          </div>
        </div>
      </div>

      <div className="stage-caption" aria-live="polite">
        <span className="cap-num">{String(p.current + 1).padStart(2, '0')}<span>/{String(list.length).padStart(2, '0')}</span></span>
        <p className="cap-text">{s.caption}</p>
      </div>
      <div className="cp-bar"><PlayerControls p={p} /></div>
    </figure>
  );
}
