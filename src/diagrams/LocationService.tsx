/**
 * Location service (Module 3.7): one AOR, several Contacts. Register or
 * unregister Bob's devices and see where Proxy B sends an INVITE for
 * sip:bob@biloxi.example — to one Contact, to several (forking), or nowhere (480).
 */
import { useState } from 'react';
import { markKeywords } from './Inspector.tsx';
import type { ClientQuote } from './types.ts';

interface Props { quotes: Record<string, ClientQuote> }

interface Device { id: string; name: string; ip: string; port: number; expires: number; transport: string }

const DEVICES: Device[] = [
  { id: 'desk', name: 'Desk phone', ip: '203.0.113.20', port: 5060, expires: 3600, transport: 'udp' },
  { id: 'soft', name: 'Softphone', ip: '203.0.113.21', port: 5062, expires: 3600, transport: 'udp' },
  { id: 'mobile', name: 'Mobile app', ip: '198.51.100.77', port: 41270, expires: 600, transport: 'tcp' },
];

const AOR = 'sip:bob@biloxi.example';
const contactOf = (d: Device) => `sip:bob@${d.ip}:${d.port}${d.transport === 'udp' ? '' : `;transport=${d.transport}`}`;

/** Lets a long URI wrap before each parameter, never inside a word. */
const breakable = (uri: string) => uri.split(';').flatMap((p, i) => (i ? [<wbr key={i} />, `;${p}`] : [p]));

const W = 980, H = 390, BW = 150, BH = 64;
const ALICE = { x: 110, y: 195 };
const PROXY = { x: 460, y: 195 };
const DEV_X = 840;
const DEV_Y = [75, 195, 315];

export default function LocationService({ quotes }: Props) {
  const [on, setOn] = useState<Record<string, boolean>>({ desk: true, soft: true, mobile: false });
  const bound = DEVICES.filter(d => on[d.id]);
  const n = bound.length;
  const quote = quotes[n === 0 ? 'rfc3261-16.5-empty-480' : n === 1 ? 'rfc3261-10.1-bindings' : 'rfc3261-16.1-fork-stateful'];

  return (
    <figure className="stage locsvc">
      <header className="stage-head">
        <div>
          <p className="eyebrow">Location service</p>
          <p className="stage-title">One AOR, several Contacts</p>
        </div>
        <ul className="legend" aria-label="Legend">
          <li><i className="lg-sip" />SIP</li>
          <li><i className="lg-err" />Error</li>
        </ul>
      </header>

      <div className="ls-toggles" role="group" aria-label="Bob's devices">
        <span className="eyebrow">Bob's devices</span>
        {DEVICES.map(d => (
          <label key={d.id} className={`ls-toggle${on[d.id] ? ' is-on' : ''}`}>
            <input type="checkbox" checked={!!on[d.id]} onChange={e => setOn(o => ({ ...o, [d.id]: e.target.checked }))} />
            <span>{d.name}</span>
            <small>{on[d.id] ? 'registered' : 'not registered'}</small>
          </label>
        ))}
      </div>

      <div className="ls-main">
        <div className="ls-map">
          <svg viewBox={`0 0 ${W} ${H}`} role="img"
            aria-label={n === 0
              ? 'Proxy B finds no Contact for Bob and answers Alice with 480 Temporarily Unavailable.'
              : `Proxy B forwards the INVITE to ${n} Contact${n > 1 ? 's' : ''}: ${bound.map(d => d.name).join(', ')}.`}>
            <defs>
              {['sip', 'err'].map(p => (
                <marker key={p} id={`ls-mk-${p}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0 0 L10 5 L0 10 z" style={{ fill: `var(--${p})` }} />
                </marker>
              ))}
            </defs>

            {/* Alice → Proxy B */}
            <path className="ls-wire" d={`M${ALICE.x + BW / 2 + 3} ${ALICE.y - 12} H${PROXY.x - BW / 2 - 5}`} markerEnd="url(#ls-mk-sip)" />
            <text className="ls-label" x={(ALICE.x + PROXY.x) / 2} y={ALICE.y - 24} textAnchor="middle">INVITE</text>
            <text className="ls-uri" x={(ALICE.x + PROXY.x) / 2} y={ALICE.y - 44} textAnchor="middle">{AOR}</text>

            {n === 0 && (
              <g>
                <path className="ls-wire is-err" d={`M${PROXY.x - BW / 2 - 3} ${ALICE.y + 14} H${ALICE.x + BW / 2 + 5}`} markerEnd="url(#ls-mk-err)" />
                <text className="ls-label is-err" x={(ALICE.x + PROXY.x) / 2} y={ALICE.y + BH / 2 + 24} textAnchor="middle">480 Temporarily Unavailable</text>
              </g>
            )}

            {/* Proxy B → each registered Contact */}
            {DEVICES.map((d, i) => {
              if (!on[d.id]) return null;
              const y = DEV_Y[i]!;
              const x1 = PROXY.x + BW / 2 + 3, y1 = PROXY.y + (y - PROXY.y) * 0.25;
              const x2 = DEV_X - BW / 2 - 6;
              const midX = (x1 + x2) / 2, midY = (y1 + y) / 2;
              return (
                <g key={d.id}>
                  <path className="ls-wire" d={`M${x1} ${y1} L${x2} ${y}`} markerEnd="url(#ls-mk-sip)" />
                  <text className="ls-label" x={midX} y={midY - 10} textAnchor="middle">INVITE</text>
                </g>
              );
            })}

            {/* Nodes */}
            <Node x={ALICE.x} y={ALICE.y} label="Alice" sub={['192.0.2.10']} rx={14} />
            <Node x={PROXY.x} y={PROXY.y} label="Proxy B" sub={['biloxi.example']} rx={3} active />
            {DEVICES.map((d, i) => (
              <Node key={d.id} x={DEV_X} y={DEV_Y[i]!} label="Bob" sub={[d.name, on[d.id] ? d.ip : 'Not registered']} rx={14} dim={!on[d.id]} />
            ))}
          </svg>
        </div>

        <div className="ls-side">
          <div>
            <table className="ls-table">
              <caption>Proxy B's location service</caption>
              <thead>
                <tr><th colSpan={2}>AOR <code>{AOR}</code></th></tr>
                <tr><th>Contact</th><th>Expires</th></tr>
              </thead>
              <tbody>
                {n === 0 && <tr><td colSpan={2} className="ls-none">No bindings</td></tr>}
                {bound.map(d => (
                  <tr key={d.id}>
                    <td><code>{breakable(contactOf(d))}</code></td>
                    <td>{d.expires} s</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <p className="eyebrow ls-sends">What Proxy B sends</p>
            <ul className="ls-out">
              {n === 0
                ? <li className="is-err"><code>SIP/2.0 480 Temporarily Unavailable</code> <span>to Alice</span></li>
                : bound.map(d => <li key={d.id}><code>INVITE {breakable(contactOf(d))} SIP/2.0</code> <span>to the {d.name.toLowerCase()}</span></li>)}
            </ul>
            <p className="ls-explain">
              {n === 0 && 'No device of Bob is registered, so the AOR has no Contact. Proxy B cannot forward the INVITE.'}
              {n === 1 && 'One binding: Proxy B replaces the AOR in the Request-URI with the Contact address and forwards the INVITE.'}
              {n > 1 && `${n} bindings: Proxy B forks the INVITE. All ${n} devices ring; the first to answer gets the call, and Proxy B cancels the others.`}
            </p>
            {quote && (
              <blockquote className="insp-quote">
                <p className="insp-q-src">RFC {quote.rfc} §{quote.section} · {quote.title}</p>
                <p>“{markKeywords(quote.text)}”</p>
                <a href={quote.url} target="_blank" rel="noopener">Read the section ↗</a>
              </blockquote>
            )}
          </div>
        </div>
      </div>
    </figure>
  );
}

function Node({ x, y, label, sub, rx, active, dim }: { x: number; y: number; label: string; sub: string[]; rx: number; active?: boolean; dim?: boolean }) {
  return (
    <g className={`ls-node${active ? ' is-active' : ''}${dim ? ' is-dim' : ''}`}>
      <rect className="ls-box" x={x - BW / 2} y={y - BH / 2} width={BW} height={BH} rx={rx} />
      <text className="ls-node-label" x={x} y={y - (sub.length > 1 ? 9 : 3)} textAnchor="middle">{label}</text>
      {sub.map((s, i) => <text key={i} className="ls-node-sub" x={x} y={y + (sub.length > 1 ? 9 : 15) + i * 14} textAnchor="middle">{s}</text>)}
    </g>
  );
}
