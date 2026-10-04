/**
 * Capability negotiation (Module 5.4): set what Alice's phone supports or
 * requires, and what Bob's phone knows or requires, and see the result:
 * a normal call, 420 Bad Extension, 421 Extension Required, or reliable
 * provisional responses with PRACK (RFC 3261 §8.2.2.3, §21.4.15–16, RFC 3262).
 */
import { useMemo, useState } from 'react';
import Ladder from './Ladder.tsx';
import { markKeywords } from './Inspector.tsx';
import type { ClientFlow, ClientQuote } from './types.ts';
import { quoteSource } from '../lib/rfc-ref.ts';

interface Props { quotes: Record<string, ClientQuote> }

type Uac = 'none' | 'supported' | 'required';
type Uas = 'unknown' | 'supported' | 'required';

const TAGS: { tag: string; rfc: number; text: string }[] = [
  { tag: '100rel', rfc: 3262, text: 'Reliable provisional responses, confirmed with PRACK' },
  { tag: 'timer', rfc: 4028, text: 'Session timers: refresh the call, or end it if the other side is gone' },
  { tag: 'replaces', rfc: 3891, text: 'The Replaces header, used in attended transfer' },
  { tag: 'precondition', rfc: 3312, text: 'Do not ring until network resources are reserved' },
  { tag: 'norefersub', rfc: 4488, text: 'REFER without the implicit subscription' },
];

const PRESETS: { label: string; uac: Record<string, Uac>; uas: Record<string, Uas> }[] = [
  { label: 'Plain call', uac: { '100rel': 'supported', timer: 'supported', replaces: 'supported' }, uas: { timer: 'supported', replaces: 'supported' } },
  { label: 'Reliable 180', uac: { '100rel': 'supported', timer: 'supported' }, uas: { '100rel': 'required', timer: 'supported' } },
  { label: 'Alice requires too much', uac: { '100rel': 'supported', precondition: 'required' }, uas: { '100rel': 'supported' } },
  { label: 'Bob requires too much', uac: { timer: 'supported' }, uas: { '100rel': 'required', timer: 'supported' } },
];

const fill = <T extends string>(rec: Record<string, T>, def: T) => Object.fromEntries(TAGS.map(t => [t.tag, rec[t.tag] ?? def])) as Record<string, T>;

export default function CapabilityLab({ quotes }: Props) {
  const [uac, setUac] = useState(() => fill<Uac>(PRESETS[0]!.uac, 'none'));
  const [uas, setUas] = useState(() => fill<Uas>(PRESETS[0]!.uas, 'unknown'));

  const r = useMemo(() => {
    const supported = TAGS.filter(t => uac[t.tag] === 'supported').map(t => t.tag);
    const required = TAGS.filter(t => uac[t.tag] === 'required').map(t => t.tag);
    const unknownToBob = required.filter(t => uas[t] === 'unknown');
    const bobNeeds = TAGS.filter(t => uas[t.tag] === 'required' && uac[t.tag] === 'none').map(t => t.tag);
    const bobSupported = TAGS.filter(t => uas[t.tag] !== 'unknown').map(t => t.tag);
    const both = TAGS.filter(t => uac[t.tag] !== 'none' && uas[t.tag] !== 'unknown').map(t => t.tag);
    const reliable = uac['100rel'] === 'required' || (uas['100rel'] === 'required' && uac['100rel'] !== 'none');

    let outcome: '420' | '421' | 'ok';
    let steps: [string, string, string, string, ('sip' | 'err')?][];
    let response: string[];
    if (unknownToBob.length) {
      outcome = '420';
      steps = [
        ['alice', 'bob', 'INVITE', 'Alice\'s phone requires an extension in the INVITE.'],
        ['bob', 'alice', '420 Bad Extension', 'Bob\'s phone does not know it, and lists it in Unsupported.', 'err'],
        ['alice', 'bob', 'ACK', 'Alice\'s phone confirms the 420. It may retry without that extension.'],
      ];
      response = ['SIP/2.0 420 Bad Extension', `Unsupported: ${unknownToBob.join(', ')}`];
    } else if (bobNeeds.length) {
      outcome = '421';
      steps = [
        ['alice', 'bob', 'INVITE', 'Alice\'s phone does not list the extension Bob\'s phone needs.'],
        ['bob', 'alice', '421 Extension Required', 'Bob\'s phone refuses the call and lists the extension in Require.', 'err'],
        ['alice', 'bob', 'ACK', 'Alice\'s phone confirms the 421. The call fails.'],
      ];
      response = ['SIP/2.0 421 Extension Required', `Require: ${bobNeeds.join(', ')}`];
    } else {
      outcome = 'ok';
      steps = reliable
        ? [
          ['alice', 'bob', 'INVITE', 'Alice\'s phone lists its extensions in Supported and Require.'],
          ['bob', 'alice', '180 Ringing (reliable)', 'Bob\'s phone sends the 180 reliably, with Require: 100rel and RSeq.'],
          ['alice', 'bob', 'PRACK', 'Alice\'s phone confirms the 180.'],
          ['bob', 'alice', '200 OK (PRACK)', 'Bob\'s phone stops retransmitting the 180.'],
          ['bob', 'alice', '200 OK', 'Bob answers. Supported lists what Bob\'s phone understands.'],
          ['alice', 'bob', 'ACK', 'Alice\'s phone confirms the 200 OK.'],
        ]
        : [
          ['alice', 'bob', 'INVITE', 'Alice\'s phone lists its extensions in Supported and Require.'],
          ['bob', 'alice', '180 Ringing', 'Bob\'s phone rings. This 180 is not reliable.'],
          ['bob', 'alice', '200 OK', 'Bob answers. Supported lists what Bob\'s phone understands.'],
          ['alice', 'bob', 'ACK', 'Alice\'s phone confirms the 200 OK.'],
        ];
      response = reliable
        ? ['SIP/2.0 180 Ringing', 'Require: 100rel', 'RSeq: 1', '…', 'SIP/2.0 200 OK', `Supported: ${bobSupported.join(', ') || '(none)'}`]
        : ['SIP/2.0 200 OK', `Supported: ${bobSupported.join(', ') || '(none)'}`];
    }
    const flow: ClientFlow = {
      id: 'capability', title: 'Capability negotiation', summary: '',
      lanes: [
        { id: 'alice', label: 'Alice', kind: 'ua', sub: 'UAC' },
        { id: 'bob', label: 'Bob', kind: 'ua', sub: 'UAS' },
      ],
      steps: steps.map(([from, to, label, caption, proto], index) => ({ index, kind: 'msg', from, to, label, caption, proto: proto ?? 'sip' })),
    };
    const request = ['INVITE sip:bob@biloxi.example SIP/2.0', `Supported: ${supported.join(', ') || '(none)'}`, ...(required.length ? [`Require: ${required.join(', ')}`] : [])];
    return { outcome, flow, request, response, both, reliable, unknownToBob, bobNeeds };
  }, [uac, uas]);

  const decisive = r.outcome === 'ok' ? r.flow.steps.length - 2 : 1;
  const quote = quotes[r.outcome === '420' ? 'rfc3261-8.2.2.3-420' : r.outcome === '421' ? 'rfc3261-21.4.16-421' : r.reliable ? 'rfc3262-1-prack' : 'rfc3261-20.37-supported'];

  return (
    <figure className="stage caplab">
      <header className="stage-head">
        <div>
          <p className="eyebrow">Capability negotiation</p>
          <p className="stage-title">Supported, Require — and who says no</p>
        </div>
        <ul className="legend" aria-label="Legend">
          <li><i className="lg-sip" />SIP</li>
          <li><i className="lg-err" />Error response</li>
        </ul>
      </header>

      <div className="ac-presets cl-presets" aria-label="Examples">
        {PRESETS.map(p => (
          <button key={p.label} type="button" onClick={() => { setUac(fill(p.uac, 'none')); setUas(fill(p.uas, 'unknown')); }}>{p.label}</button>
        ))}
      </div>

      <div className="cl-table-wrap">
        <table className="cl-table">
          <thead>
            <tr><th>Option tag</th><th>Alice's phone (UAC) puts it in…</th><th>Bob's phone (UAS)…</th></tr>
          </thead>
          <tbody>
            {TAGS.map(t => (
              <tr key={t.tag}>
                <th scope="row"><code>{t.tag}</code><span>{t.text} · RFC {t.rfc}</span></th>
                <td>
                  <div className="seg" role="group" aria-label={`Alice's phone and ${t.tag}`}>
                    {(['none', 'supported', 'required'] as Uac[]).map(v => (
                      <button key={v} type="button" aria-pressed={uac[t.tag] === v} onClick={() => setUac(u => ({ ...u, [t.tag]: v }))}>
                        {v === 'none' ? '—' : v === 'supported' ? 'Supported' : 'Require'}
                      </button>
                    ))}
                  </div>
                </td>
                <td>
                  <div className="seg" role="group" aria-label={`Bob's phone and ${t.tag}`}>
                    {(['unknown', 'supported', 'required'] as Uas[]).map(v => (
                      <button key={v} type="button" aria-pressed={uas[t.tag] === v} onClick={() => setUas(u => ({ ...u, [t.tag]: v }))}>
                        {v === 'unknown' ? 'Does not know' : v === 'supported' ? 'Supports' : 'Needs it'}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="cl-result">
        <div className="cl-left">
          <p className={`fx-summary${r.outcome === 'ok' ? ' is-ok' : ' is-bad'}`} aria-live="polite">
            {r.outcome === '420' && `⚠ 420 Bad Extension: Bob's phone does not know ${r.unknownToBob.join(', ')}.`}
            {r.outcome === '421' && `⚠ 421 Extension Required: Bob's phone needs ${r.bobNeeds.join(', ')}, and Alice's phone does not offer it.`}
            {r.outcome === 'ok' && `The call works.${r.both.length ? ` Both phones understand: ${r.both.join(', ')}.` : ' No extensions in common: plain RFC 3261.'}${r.reliable ? ' The 180 is sent reliably.' : ''}`}
          </p>
          <div className="cl-msgs">
            <div>
              <p className="eyebrow">Alice's INVITE</p>
              <pre>{r.request.join('\n')}</pre>
            </div>
            <div>
              <p className="eyebrow">Bob's answer</p>
              <pre className={r.outcome === 'ok' ? '' : 'is-err'}>{r.response.join('\n')}</pre>
            </div>
          </div>
          {quote && (
            <blockquote className="insp-quote">
              <p className="insp-q-src">{quoteSource(quote)}</p>
              <p>“{markKeywords(quote.text)}”</p>
              <a href={quote.url} target="_blank" rel="noopener">Read the section ↗</a>
            </blockquote>
          )}
        </div>
        <div className="cl-ladder">
          <Ladder flow={r.flow} current={decisive} compact />
          <ol className="cl-captions">
            {r.flow.steps.map(s => <li key={s.index} className={s.index === decisive ? 'is-cur' : ''}><b>{s.label}.</b> {s.caption}</li>)}
          </ol>
        </div>
      </div>
    </figure>
  );
}
