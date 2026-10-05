/**
 * NAT simulator (Module 20): Alice and Bob behind NAT routers of any type.
 * Bob registers, Alice calls him, and they talk. Turn rport, Contact
 * rewriting, and a media fix on or off, and follow every packet through the
 * NAT routers, with its addresses before and after. The model is src/net/nat-call.ts.
 */
import { useMemo, useState } from 'react';
import { MEDIA_FIXES, simulateCall, type MediaFix, type SimPacket } from '../net/nat-call.ts';
import { NAT_KINDS, fmt, type Leg, type NatKind } from '../net/nat.ts';

const KINDS = Object.keys(NAT_KINDS) as NatKind[];
const FIXES = Object.keys(MEDIA_FIXES) as MediaFix[];

function NatPicker({ who, value, onChange }: { who: string; value: NatKind; onChange: (k: NatKind) => void }) {
  return (
    <div className="natsim-pick">
      <p className="natsim-who">{who}'s NAT router</p>
      <div className="seg natsim-seg" role="group" aria-label={`${who}'s NAT router`}>
        {KINDS.map(k => (
          <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)}>
            {NAT_KINDS[k].label}<span>{NAT_KINDS[k].short}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function LegView({ leg }: { leg: Leg }) {
  const natOut = leg.src.ip !== leg.out.ip || leg.src.port !== leg.out.port;
  const natIn = leg.arrive && (leg.arrive.ip !== leg.dst.ip || leg.arrive.port !== leg.dst.port);
  return (
    <span className="natsim-leg">
      <code>{fmt(leg.src)}</code>
      {natOut && <><i className="natsim-nat">NAT</i><code className="is-nat">{fmt(leg.out)}</code></>}
      <i aria-hidden="true">→</i><span className="sr-only">to</span>
      <code>{fmt(leg.dst)}</code>
      {natIn && <><i className="natsim-nat">NAT</i><code className="is-nat">{fmt(leg.arrive!)}</code></>}
      {leg.lost && <b className="natsim-x" aria-label="lost">✕</b>}
    </span>
  );
}

function PacketRow({ p, n }: { p: SimPacket; n: number }) {
  return (
    <li className={`natsim-p p-${p.proto}${p.ok ? '' : ' is-lost'}`}>
      <span className="natsim-n">{n}</span>
      <div className="natsim-body">
        <p className="natsim-what"><b>{p.label}</b> <span>{p.from} → {p.to}</span></p>
        {p.trace.legs.length > 0 && <p className="natsim-legs">{p.trace.legs.map((l, i) => <LegView key={i} leg={l} />)}</p>}
        <p className="natsim-note">{p.note}</p>
      </div>
    </li>
  );
}

function Result({ label, ok, na }: { label: string; ok: boolean; na?: boolean }) {
  return <li className={na ? 'is-na' : ok ? 'is-ok' : 'is-bad'}><span aria-hidden="true">{na ? '–' : ok ? '✓' : '✕'}</span>{label}</li>;
}

export default function NatSimulator() {
  const [alice, setAlice] = useState<NatKind>('port-restricted');
  const [bob, setBob] = useState<NatKind>('port-restricted');
  const [rport, setRport] = useState(true);
  const [contact, setContact] = useState(true);
  const [media, setMedia] = useState<MediaFix>('none');
  const r = useMemo(() => simulateCall({ alice, bob, rport, contactRewrite: contact, media }), [alice, bob, rport, contact, media]);
  const good = r.aToB && r.bToA;

  return (
    <figure className="stage natsim" aria-label="NAT simulator">
      <header className="stage-head">
        <div>
          <p className="eyebrow">NAT simulator · Bob registers, Alice calls him</p>
          <p className="stage-title">Which packets get through?</p>
        </div>
        <ul className="legend" aria-label="Legend">
          <li><i className="lg-sip" />SIP</li>
          <li><i className="lg-rtp" />RTP</li>
          <li><i className="lg-dns" />STUN / ICE</li>
          <li><i className="natsim-lg-nat" />Rewritten by NAT</li>
        </ul>
      </header>

      <div className="natsim-picks">
        <NatPicker who="Alice" value={alice} onChange={setAlice} />
        <NatPicker who="Bob" value={bob} onChange={setBob} />
      </div>
      <div className="natsim-fixes">
        <button type="button" className="rl-toggle" aria-pressed={rport} onClick={() => setRport(!rport)}><span aria-hidden="true">{rport ? '●' : '○'}</span>rport</button>
        <button type="button" className="rl-toggle" aria-pressed={contact} onClick={() => setContact(!contact)}><span aria-hidden="true">{contact ? '●' : '○'}</span>Contact rewriting</button>
        <div className="seg natsim-media" role="group" aria-label="Media fix">
          <span className="natsim-who">Media</span>
          {FIXES.map(f => <button key={f} type="button" aria-pressed={media === f} onClick={() => setMedia(f)}>{MEDIA_FIXES[f]}</button>)}
        </div>
      </div>

      <div className={`natsim-verdict${good ? ' is-ok' : ''}`} aria-live="polite">
        <p>{r.verdict}</p>
        <ul>
          <Result label="200 OK reaches Bob" ok={r.registered} />
          <Result label="INVITE reaches Bob" ok={r.invited} />
          <Result label="Audio Alice → Bob" ok={r.aToB} na={!r.answered} />
          <Result label="Audio Bob → Alice" ok={r.bToA} na={!r.answered} />
        </ul>
      </div>

      <ol className="natsim-packets">
        {r.packets.map((p, i) => <PacketRow key={i} p={p} n={i + 1} />)}
      </ol>
      <p className="natsim-foot">Alice 192.168.1.20 behind 198.51.100.7 · Bob 10.0.0.30 behind 198.51.100.200 · SBC 203.0.113.5 · STUN/TURN 203.0.113.50. Each phone sends RTP from the port where it receives (symmetric RTP).</p>
    </figure>
  );
}
