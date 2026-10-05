/**
 * ICE candidate checker (Module 20): Alice and Bob gather host,
 * server-reflexive, and relayed candidates, pair them, and run the
 * connectivity checks through their NAT routers. The selected pair is shown.
 * The model is src/net/ice.ts, on the NAT routers of src/net/nat.ts.
 */
import { useMemo, useState } from 'react';
import { buildWorld, SITES } from '../net/nat-call.ts';
import { candidateLine, runIce, TYPE_NAME, type Candidate, type Pair } from '../net/ice.ts';
import { NAT_KINDS, fmt, type NatKind } from '../net/nat.ts';
import { xorAddress } from '../net/stun.ts';

const KINDS = Object.keys(NAT_KINDS) as NatKind[];
const STATE: Record<Pair['state'], string> = { succeeded: 'Works', failed: 'Fails', frozen: 'Not checked' };
const xorHex = (c: Candidate) => [...xorAddress(c.addr)].map(b => b.toString(16).padStart(2, '0')).join('').replace(/(.{4})/g, '$1 ').trim();

function Candidates({ who, list }: { who: string; list: Candidate[] }) {
  const srflx = list.find(c => c.type === 'srflx');
  return (
    <section className="ice-side">
      <p className="ice-who">{who}'s candidates</p>
      <ul className="ice-cands">
        {list.map(c => (
          <li key={c.type} className={`c-${c.type}`}>
            <span className="ice-type">{TYPE_NAME[c.type]}</span>
            <code>{fmt(c.addr)}</code>
            <span className="ice-prio">priority {c.priority}</span>
            <code className="ice-line">{candidateLine(c)}</code>
          </li>
        ))}
      </ul>
      {srflx && <p className="ice-xor">STUN returned it as XOR-MAPPED-ADDRESS <code>{xorHex(srflx)}</code>: the address XOR the magic cookie, so a router that rewrites addresses cannot find it.</p>}
    </section>
  );
}

export default function IceChecker() {
  const [alice, setAlice] = useState<NatKind>('port-restricted');
  const [bob, setBob] = useState<NatKind>('symmetric');
  const [stun, setStun] = useState(true);
  const [turn, setTurn] = useState(false);
  const r = useMemo(() => {
    const w = buildWorld(alice, bob);
    const server = { ip: SITES.turn.ip, port: SITES.turn.port };
    const opt = (port: number) => ({ port, ...(stun ? { stun: server } : {}), ...(turn ? { turn: server } : {}) });
    return runIce(w, { id: 'alice', label: 'Alice', ...opt(SITES.alice.rtp) }, { id: 'bob', label: 'Bob', ...opt(SITES.bob.rtp) });
  }, [alice, bob, stun, turn]);
  const sel = r.selected?.pair;
  const relayed = sel && (sel.local.type === 'relay' || sel.remote.type === 'relay');

  return (
    <figure className="stage ice" aria-label="ICE candidate checker">
      <header className="stage-head">
        <div>
          <p className="eyebrow">ICE candidate checker · Alice is the controlling agent</p>
          <p className="stage-title">Which candidate pair does ICE select?</p>
        </div>
      </header>

      <div className="natsim-picks">
        {([['Alice', alice, setAlice], ['Bob', bob, setBob]] as const).map(([who, v, set]) => (
          <div className="natsim-pick" key={who}>
            <p className="natsim-who">{who}'s NAT router</p>
            <div className="seg natsim-seg" role="group" aria-label={`${who}'s NAT router`}>
              {KINDS.map(k => <button key={k} type="button" aria-pressed={v === k} onClick={() => set(k)}>{NAT_KINDS[k].label}<span>{NAT_KINDS[k].short}</span></button>)}
            </div>
          </div>
        ))}
      </div>
      <div className="natsim-fixes">
        <button type="button" className="rl-toggle" aria-pressed={stun} onClick={() => setStun(!stun)}><span aria-hidden="true">{stun ? '●' : '○'}</span>STUN server</button>
        <button type="button" className="rl-toggle" aria-pressed={turn} onClick={() => setTurn(!turn)}><span aria-hidden="true">{turn ? '●' : '○'}</span>TURN server</button>
      </div>

      <div className={`natsim-verdict${sel ? ' is-ok' : ''}`} aria-live="polite">
        <p>{sel
          ? <>Selected: Alice's {TYPE_NAME[sel.local.type]} <code>{fmt(sel.local.addr)}</code> → Bob's {TYPE_NAME[sel.remote.type]} <code>{fmt(sel.remote.addr)}</code>. {relayed ? 'The media goes through the TURN server.' : 'The media goes directly, with no relay.'}</>
          : <>ICE failed: no pair works. {turn ? '' : 'Turn on the TURN server: a relay works behind any NAT.'}</>}</p>
      </div>

      <div className="ice-cols">
        <Candidates who="Alice" list={r.local} />
        <Candidates who="Bob" list={r.remote} />
      </div>

      <div className="ice-list">
        <p className="ice-who">Alice's checklist, highest priority first</p>
        <table>
          <thead><tr><th scope="col">Alice (local)</th><th scope="col">Bob (remote)</th><th scope="col">Pair priority</th><th scope="col">Result</th></tr></thead>
          <tbody>
            {r.pairs.map((p, i) => (
              <tr key={i} className={`s-${p.state}${p === sel ? ' is-sel' : ''}`}>
                <td><span className="ice-type">{TYPE_NAME[p.local.type]}</span> <code>{fmt(p.local.addr)}</code></td>
                <td><span className="ice-type">{TYPE_NAME[p.remote.type]}</span> <code>{fmt(p.remote.addr)}</code></td>
                <td><code className="ice-pp">{p.priority.toString()}</code></td>
                <td>{p === sel ? 'Selected' : STATE[p.state]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details className="stage-steps">
        <summary>The {r.events.length} checks, in order</summary>
        <ol className="ice-events">
          {r.events.map((e, i) => (
            <li key={i} className={e.ok ? 'is-ok' : 'is-bad'}>
              <b>{e.by}</b>{e.kind === 'triggered' && <span className="ice-trig">triggered</span>} from {TYPE_NAME[e.local.type]} to <code>{fmt(e.to)}</code>: {e.ok ? 'works' : e.reason}{e.learned ? ` · learns ${e.learned}` : ''}
            </li>
          ))}
        </ol>
      </details>
    </figure>
  );
}
