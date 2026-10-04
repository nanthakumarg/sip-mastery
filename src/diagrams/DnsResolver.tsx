/**
 * DNS resolver step-through (Module 11): Proxy A must reach biloxi.example.
 * Choose the Request-URI, the transports Proxy A supports, and whether the
 * zone has NAPTR records; then take servers down. Each DNS query and answer,
 * and each attempt to reach a server, is one step. The resolver logic is
 * src/sip/dns.ts (RFC 3263 §4, RFC 2782), tested in tests/dns.test.ts.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { PlayerControls, usePlayer } from './player.tsx';
import { attempts, BILOXI_ZONE, resolve, type Attempt, type Lookup, type ServerState, type Transport } from '../sip/dns.ts';
import { quoteSource } from '../lib/rfc-ref.ts';
import type { ClientQuote } from './types.ts';

interface Props { quotes: Record<string, ClientQuote> }

const URIS = [
  { uri: 'sip:bob@biloxi.example', note: 'Domain only' },
  { uri: 'sip:bob@biloxi.example;transport=udp', note: 'transport=udp' },
  { uri: 'sips:bob@biloxi.example', note: 'SIPS URI' },
  { uri: 'sip:bob@biloxi.example:5060', note: 'With a port' },
  { uri: 'sip:bob@203.0.113.11', note: 'IP address' },
];

const SERVERS = [
  { ip: '203.0.113.11', name: 'sip1' },
  { ip: '203.0.113.12', name: 'sip2' },
  { ip: '198.51.100.50', name: 'backup' },
];
const STATES: ServerState[] = ['up', '503', 'refused', 'silent'];
const STATE_LABEL: Record<ServerState, string> = { up: 'Up', '503': 'Sends 503', refused: 'Port closed', silent: 'No answer' };
const OUTCOME_LABEL: Record<Attempt['outcome'], string> = { answered: '100 Trying', '503': '503 Service Unavailable', refused: 'refused', timeout: 'no answer · Timer B' };

/** A small seeded random, so the server render and the browser render agree. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Step =
  | { kind: 'dns'; lookup: Lookup }
  | { kind: 'sip'; attempt: Attempt; n: number }
  | { kind: 'end'; ok: boolean; elapsed: number; to?: string };


export default function DnsResolver({ quotes }: Props) {
  const [uri, setUri] = useState(URIS[0]!.uri);
  const [supports, setSupports] = useState<Transport[]>(['UDP', 'TCP']);
  const [naptr, setNaptr] = useState(true);
  const [state, setState] = useState<Record<string, ServerState>>({});
  const [seed, setSeed] = useState(0);

  const zone = useMemo(() => (naptr ? BILOXI_ZONE : { ...BILOXI_ZONE, naptr: {} }), [naptr]);
  const res = useMemo(() => resolve(uri, zone, { supports, random: seeded(seed) }), [uri, zone, supports, seed]);
  const run = useMemo(() => attempts(res.candidates, ip => state[ip] ?? 'up'), [res, state]);

  const steps: Step[] = useMemo(() => [
    ...res.lookups.map(lookup => ({ kind: 'dns' as const, lookup })),
    ...run.attempts.map((attempt, n) => ({ kind: 'sip' as const, attempt, n })),
    { kind: 'end' as const, ok: !!run.reached, elapsed: run.elapsed, to: run.reached && `${run.reached.ip}:${run.reached.port}` },
  ], [res, run]);

  const p = usePlayer(steps.length, 2000);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    p.go(steps.length - 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps]);
  const cur = Math.min(p.current, steps.length - 1);
  const step = steps[cur]!;

  const rfcOf = (s: Step): string | undefined =>
    s.kind === 'dns' ? s.lookup.rfc
      : s.kind === 'sip' ? (s.attempt.outcome === 'answered' ? 'rfc3263-4-same-host' : s.n === 0 ? 'rfc3263-4.3-failure' : 'rfc3263-4.3-new-branch')
        : undefined;
  const quote = quotes[rfcOf(step) ?? res.transportRfc];
  const tried = new Map(run.attempts.map(a => [`${a.candidate.ip}:${a.candidate.port}`, a.outcome]));
  const shownUpTo = (i: number) => i <= cur;

  const toggleT = (t: Transport) => setSupports(s => (s.includes(t) ? s.filter(x => x !== t) : (['UDP', 'TCP', 'TLS'] as Transport[]).filter(x => x === t || s.includes(x))));
  const cycle = (ip: string) => setState(s => ({ ...s, [ip]: STATES[(STATES.indexOf(s[ip] ?? 'up') + 1) % STATES.length]! }));

  return (
    <figure className="stage dnsr" tabIndex={0} onKeyDown={p.onKey} aria-label="DNS resolver step-through">
      <header className="stage-head">
        <div>
          <p className="eyebrow">DNS resolver step-through</p>
          <p className="stage-title">Proxy A looks for the servers of biloxi.example</p>
        </div>
        <ul className="legend" aria-label="Legend">
          <li><i className="lg-dns" />DNS</li>
          <li><i className="lg-sip" />SIP</li>
          <li><i className="lg-err" />Failure</li>
        </ul>
      </header>

      <div className="dr-controls">
        <div className="dr-row">
          <span className="rl-glabel">Request-URI</span>
          <div className="seg dr-uris" role="group" aria-label="Request-URI">
            {URIS.map(u => <button key={u.uri} type="button" aria-pressed={uri === u.uri} onClick={() => setUri(u.uri)} title={u.uri}>{u.note}</button>)}
          </div>
        </div>
        <div className="dr-row">
          <span className="rl-glabel">Proxy A supports</span>
          {(['UDP', 'TCP', 'TLS'] as Transport[]).map(t => (
            <button key={t} type="button" className="rl-toggle" aria-pressed={supports.includes(t)} onClick={() => toggleT(t)}><span aria-hidden="true">{supports.includes(t) ? '●' : '○'}</span>{t}</button>
          ))}
          <span className="rl-glabel dr-gap">Zone</span>
          <button type="button" className="rl-toggle" aria-pressed={naptr} onClick={() => setNaptr(v => !v)}><span aria-hidden="true">{naptr ? '●' : '○'}</span>NAPTR records</button>
        </div>
        <div className="dr-row">
          <span className="rl-glabel">Servers (select to change)</span>
          {SERVERS.map(s => {
            const st = state[s.ip] ?? 'up';
            return (
              <button key={s.ip} type="button" className={`dr-server is-${st}`} onClick={() => cycle(s.ip)} aria-label={`${s.name}, ${s.ip}: ${STATE_LABEL[st]}. Select to change.`}>
                <b>{s.name}</b><span>{s.ip}</span><em>{STATE_LABEL[st]}</em>
              </button>
            );
          })}
        </div>
      </div>

      <p className="dr-uri"><code>{uri}</code><span>{res.transportRule}</span></p>

      <div className="dr-main">
        <div className="dr-left">
          <ol className="dr-steps">
            {steps.map((s, i) => (
              <li key={i} className={`dr-step k-${s.kind}${i === cur ? ' is-cur' : ''}${shownUpTo(i) ? '' : ' is-future'}${s.kind === 'sip' && s.attempt.outcome !== 'answered' ? ' is-fail' : ''}${s.kind === 'end' && !s.ok ? ' is-fail' : ''}`}>
                <button type="button" className="dr-stephead" onClick={() => p.go(i)} aria-current={i === cur ? 'step' : undefined}>
                  <span className="dr-num">{String(i + 1).padStart(2, '0')}</span>
                  {s.kind === 'dns' && <><span className="dr-kind">DNS {s.lookup.qtype}</span><code>{s.lookup.qname}</code><span className="dr-count">{s.lookup.answer.length ? `${s.lookup.answer.length} record${s.lookup.answer.length > 1 ? 's' : ''}` : 'no records'}</span></>}
                  {s.kind === 'sip' && <><span className="dr-kind">INVITE{s.n > 0 ? ' · new branch' : ''}</span><code>{s.attempt.candidate.transport} {s.attempt.candidate.ip}:{s.attempt.candidate.port}</code><span className="dr-count">{OUTCOME_LABEL[s.attempt.outcome]}</span></>}
                  {s.kind === 'end' && <><span className="dr-kind">{s.ok ? 'Reached' : 'Failed'}</span><span className="dr-count">t = {s.elapsed.toFixed(s.elapsed < 1 ? 2 : 0)} s</span></>}
                </button>
                {shownUpTo(i) && (
                  <div className="dr-body">
                    {s.kind === 'dns' && (s.lookup.answer.length
                      ? <pre className="dr-answer">{s.lookup.answer.join('\n')}</pre>
                      : <pre className="dr-answer is-empty">;; no records of this type</pre>)}
                    <p className="dr-note">{s.kind === 'dns' ? s.lookup.note : s.kind === 'sip' ? `${s.attempt.note} (t = ${s.attempt.endsAt.toFixed(s.attempt.endsAt < 1 ? 2 : 0)} s)`
                      : s.ok ? `The INVITE reached ${s.to}, ${s.elapsed < 1 ? 'at once' : `after ${s.elapsed.toFixed(0)} seconds of waiting`}.`
                        : res.candidates.length ? 'Every server failed. Proxy A gives up and sends an error response upstream.' : 'DNS gave no server that Proxy A can use. The request fails before any SIP is sent.'}</p>
                  </div>
                )}
              </li>
            ))}
          </ol>
          <PlayerControls p={p} />
        </div>

        <aside className="dr-side">
          <section className="dr-box">
            <p className="dr-btitle">Try order<span>{res.transport}</span></p>
            {res.candidates.length ? (
              <ol className="dr-order">
                {res.candidates.map(c => {
                  const o = tried.get(`${c.ip}:${c.port}`);
                  return (
                    <li key={`${c.ip}:${c.port}`} className={o ? `o-${o}` : 'o-untried'}>
                      <b>{c.host ?? c.ip}</b>
                      <code>{c.ip}:{c.port}</code>
                      {c.priority !== undefined && <span className="dr-pw">priority {c.priority} · weight {c.weight}</span>}
                      <span className="dr-o">{o ? OUTCOME_LABEL[o] : 'not tried'}</span>
                    </li>
                  );
                })}
              </ol>
            ) : <p className="dr-empty">No server to try.</p>}
          </section>

          {res.draws.length > 0 && (
            <section className="dr-box">
              <p className="dr-btitle">Weight draws<button type="button" className="dr-redraw" onClick={() => setSeed(s => s + 1)}>Draw again</button></p>
              <ul className="dr-draws">
                {res.draws.filter(d => d.pool.length > 1).map((d, i) => (
                  <li key={i}>
                    <span>Priority {d.priority}: random number <b>{d.r}</b> of 0–{d.pool.at(-1)!.sum}</span>
                    {d.pool.map(x => <span key={x.srv.target} className={x.srv === d.picked ? 'is-pick' : ''}>{x.srv.target.split('.')[0]} weight {x.srv.weight} · running sum {x.sum}{x.srv === d.picked ? ' ← first sum ≥ ' + d.r : ''}</span>)}
                  </li>
                ))}
                {res.draws.every(d => d.pool.length === 1) && <li><span>Each priority has one server: no draw.</span></li>}
              </ul>
            </section>
          )}

          {quote && (
            <section className="dr-box dr-quote">
              <p className="insp-q-src">{quoteSource(quote)}</p>
              <p>“{quote.text.replace(/\s+/g, ' ')}”</p>
              <a href={quote.url} target="_blank" rel="noopener">Read the section ↗</a>
            </section>
          )}
        </aside>
      </div>
    </figure>
  );
}
