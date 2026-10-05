/**
 * Offer/answer negotiator (Module 15): build Alice's offer, set what Bob's
 * phone can do, and see the answer that RFC 3264 §6 gives, the codec each side
 * sends, and the payload type numbers in its RTP packets.
 * The model is src/sip/sdp.ts (negotiate).
 */
import { useMemo, useState } from 'react';
import { markKeywords } from './Inspector.tsx';
import { buildSdp, canRecv, canSend, codecKey, negotiate, parseSdp, type CodecSpec, type Direction, type StreamOutcome } from '../sip/sdp.ts';
import type { ClientQuote } from './types.ts';

interface Props { quotes: Record<string, ClientQuote> }

interface CatalogCodec extends CodecSpec { key: string; label: string }
const CATALOG: CatalogCodec[] = [
  { key: 'opus/48000', label: 'Opus', pt: 111, name: 'opus', rate: 48000, channels: 2, fmtp: 'minptime=10;useinbandfec=1' },
  { key: 'g722/8000', label: 'G.722', pt: 9, name: 'G722', rate: 8000 },
  { key: 'pcmu/8000', label: 'PCMU', pt: 0, name: 'PCMU', rate: 8000 },
  { key: 'pcma/8000', label: 'PCMA', pt: 8, name: 'PCMA', rate: 8000 },
  { key: 'g729/8000', label: 'G.729', pt: 18, name: 'G729', rate: 8000, fmtp: 'annexb=no' },
];
const DTMF: CodecSpec = { pt: 101, name: 'telephone-event', rate: 8000, fmtp: '0-16' };
const VIDEO: CodecSpec = { pt: 96, name: 'H264', rate: 90000, fmtp: 'profile-level-id=42e01f;packetization-mode=1' };
/** Bob's own preference, most preferred first. */
const BOB_ORDER = ['g729/8000', 'pcma/8000', 'pcmu/8000', 'g722/8000', 'opus/48000'];
/** The numbers Bob's phone uses in its own offers. */
const BOB_PTS: Record<string, number> = { 'opus/48000': 96, 'telephone-event/8000': 100, 'h264/90000': 97 };
const LABEL: Record<string, string> = Object.fromEntries([...CATALOG.map(c => [c.key, c.label]), ['telephone-event/8000', 'telephone-event'], ['h264/90000', 'H.264']]);

interface State {
  aOrder: string[];
  aOn: string[];
  aDtmf: boolean;
  aVideo: boolean;
  aDir: Direction;
  bOn: string[];
  bDtmf: boolean;
  bVideo: boolean;
  bWant: Direction;
  bOrder: 'offer' | 'answerer';
  bOwnPts: boolean;
}

const START: State = {
  aOrder: ['opus/48000', 'g722/8000', 'pcmu/8000', 'pcma/8000', 'g729/8000'],
  aOn: ['opus/48000', 'g722/8000', 'pcmu/8000', 'pcma/8000'],
  aDtmf: true, aVideo: false, aDir: 'sendrecv',
  bOn: ['pcmu/8000', 'pcma/8000', 'g729/8000'],
  bDtmf: true, bVideo: false, bWant: 'sendrecv', bOrder: 'offer', bOwnPts: false,
};

const PRESETS: { label: string; set: Partial<State> }[] = [
  { label: 'A typical call', set: {} },
  { label: 'Video to an audio phone', set: { aVideo: true } },
  { label: 'No codec in common', set: { aOn: ['opus/48000', 'g722/8000'] } },
  { label: 'A different codec each way', set: { bOrder: 'answerer' } },
  { label: 'Different payload numbers', set: { bOn: ['opus/48000', 'pcmu/8000'], bOwnPts: true } },
  { label: 'Hold (sendonly offer)', set: { aDir: 'sendonly' } },
  { label: 'No DTMF', set: { bDtmf: false } },
];

const DIRS: Direction[] = ['sendrecv', 'sendonly', 'recvonly', 'inactive'];

function SdpBlock({ title, text, highlight }: { title: string; text: string; highlight: (line: string) => boolean }) {
  return (
    <section className="oa-sdp" aria-label={title}>
      <p className="eyebrow">{title}</p>
      <pre>{text.split('\n').map((l, i) => <span key={i} className={`oa-line t-${l[0]}${highlight(l) ? ' is-key' : ''}`}>{l}{'\n'}</span>)}</pre>
    </section>
  );
}

function Arrow({ from, to, codec, on, why }: { from: string; to: string; codec?: string; on: boolean; why: string }) {
  return (
    <div className={`oa-dir${on ? ' is-on' : ''}`}>
      <span className="oa-who">{from}</span>
      <svg className="oa-arrow" viewBox="0 0 120 12" preserveAspectRatio="none" aria-hidden="true">
        <line x1="2" y1="6" x2="110" y2="6" />
        {on && <path d="M108 1 L118 6 L108 11 z" />}
      </svg>
      <span className="oa-who">{to}</span>
      <span className="oa-what">{on ? codec : why}</span>
    </div>
  );
}

export default function OfferAnswer({ quotes }: Props) {
  const [s, setS] = useState<State>(START);
  const set = (p: Partial<State>) => setS(x => ({ ...x, ...p }));
  const toggle = (list: string[], key: string) => (list.includes(key) ? list.filter(k => k !== key) : [...list, key]);

  const offerText = useMemo(() => buildSdp({
    user: 'alice', sessId: '2890844526', version: 2890844526, address: '192.0.2.10',
    streams: [
      { media: 'audio', port: 49170, codecs: [...s.aOrder.filter(k => s.aOn.includes(k)).map(k => CATALOG.find(c => c.key === k)!), ...(s.aDtmf ? [DTMF] : [])],
        ptime: 20, direction: s.aDir === 'sendrecv' ? undefined : s.aDir },
      ...(s.aVideo ? [{ media: 'video', port: 51372, codecs: [VIDEO], direction: s.aDir === 'sendrecv' ? undefined : s.aDir }] : []),
    ],
  }), [s]);
  const offer = useMemo(() => parseSdp(offerText), [offerText]);
  const result = useMemo(() => negotiate(offer, {
    codecs: [...BOB_ORDER.filter(k => s.bOn.includes(k)), ...(s.bVideo ? ['h264/90000'] : [])],
    media: s.bVideo ? ['audio', 'video'] : ['audio'],
    want: s.bWant, order: s.bOrder, ownPts: s.bOwnPts ? BOB_PTS : undefined,
    telephoneEvent: s.bDtmf, rtcpMux: false,
    user: 'bob', sessId: '2808844564', version: 2808844564, address: '203.0.113.20', ports: { audio: 3456, video: 3458 }, ptime: 20,
  }), [offer, s]);

  const notes = noteList(result.streams, s);

  const moveUp = (k: string) => set({ aOrder: (() => { const o = [...s.aOrder]; const i = o.indexOf(k); if (i > 0) [o[i - 1], o[i]] = [o[i]!, o[i - 1]!]; return o; })() });
  const preset = PRESETS.find(p => JSON.stringify({ ...START, ...p.set }) === JSON.stringify(s));

  return (
    <figure className="stage oa" aria-label="Offer/answer negotiator">
      <header className="stage-head">
        <div>
          <p className="eyebrow">Offer/answer negotiator · RFC 3264</p>
          <p className="stage-title">What do Alice and Bob agree on?</p>
        </div>
        <ul className="legend" aria-label="Legend">
          <li><i className="lg-sdp" />SDP</li>
          <li><i className="lg-rtp" />RTP</li>
          <li><i className="lg-err" />Rejected</li>
        </ul>
      </header>

      <div className="ac-presets" aria-label="Examples">
        {PRESETS.map(p => <button key={p.label} type="button" aria-pressed={preset === p} onClick={() => setS({ ...START, ...p.set })}>{p.label}</button>)}
      </div>

      <div className="oa-sides">
        <section className="oa-side" aria-label="Alice's offer">
          <p className="oa-side-title">Alice's offer <span>most preferred first</span></p>
          <ol className="oa-codecs">
            {s.aOrder.map((k, i) => {
              const on = s.aOn.includes(k);
              return (
                <li key={k}>
                  <button type="button" className="rl-toggle" aria-pressed={on} disabled={on && s.aOn.length === 1}
                    onClick={() => set({ aOn: toggle(s.aOn, k) })}><span aria-hidden="true">{on ? '●' : '○'}</span>{LABEL[k]}</button>
                  <button type="button" className="oa-up" onClick={() => moveUp(k)} disabled={i === 0} aria-label={`Prefer ${LABEL[k]}`}>↑</button>
                </li>
              );
            })}
          </ol>
          <div className="oa-row">
            <button type="button" className="rl-toggle" aria-pressed={s.aDtmf} onClick={() => set({ aDtmf: !s.aDtmf })}><span aria-hidden="true">{s.aDtmf ? '●' : '○'}</span>telephone-event</button>
            <button type="button" className="rl-toggle" aria-pressed={s.aVideo} onClick={() => set({ aVideo: !s.aVideo })}><span aria-hidden="true">{s.aVideo ? '●' : '○'}</span>Video</button>
          </div>
          <div className="seg oa-seg" role="group" aria-label="Alice's direction">
            {DIRS.map(d => <button key={d} type="button" aria-pressed={s.aDir === d} onClick={() => set({ aDir: d })}>{d}</button>)}
          </div>
        </section>

        <section className="oa-side" aria-label="Bob's phone">
          <p className="oa-side-title">Bob's phone <span>what it can do</span></p>
          <ol className="oa-codecs">
            {BOB_ORDER.map(k => {
              const on = s.bOn.includes(k);
              return (
                <li key={k}>
                  <button type="button" className="rl-toggle" aria-pressed={on} onClick={() => set({ bOn: toggle(s.bOn, k) })}><span aria-hidden="true">{on ? '●' : '○'}</span>{LABEL[k]}</button>
                </li>
              );
            })}
          </ol>
          <div className="oa-row">
            <button type="button" className="rl-toggle" aria-pressed={s.bDtmf} onClick={() => set({ bDtmf: !s.bDtmf })}><span aria-hidden="true">{s.bDtmf ? '●' : '○'}</span>telephone-event</button>
            <button type="button" className="rl-toggle" aria-pressed={s.bVideo} onClick={() => set({ bVideo: !s.bVideo })}><span aria-hidden="true">{s.bVideo ? '●' : '○'}</span>Camera</button>
            <button type="button" className="rl-toggle" aria-pressed={s.bOwnPts} onClick={() => set({ bOwnPts: !s.bOwnPts })} title="Opus 96, telephone-event 100"><span aria-hidden="true">{s.bOwnPts ? '●' : '○'}</span>Own payload numbers</button>
          </div>
          <div className="seg oa-seg" role="group" aria-label="Order of the answer">
            <button type="button" aria-pressed={s.bOrder === 'offer'} onClick={() => set({ bOrder: 'offer' })}>Offer's order</button>
            <button type="button" aria-pressed={s.bOrder === 'answerer'} onClick={() => set({ bOrder: 'answerer' })}>Bob's order</button>
          </div>
          <div className="seg oa-seg" role="group" aria-label="What Bob wants">
            {DIRS.map(d => <button key={d} type="button" aria-pressed={s.bWant === d} onClick={() => set({ bWant: d })}>{d}</button>)}
          </div>
        </section>
      </div>

      <div className="oa-sdps">
        <SdpBlock title="Offer · INVITE from Alice" text={offerText} highlight={l => l.startsWith('m=') || /^a=(sendonly|recvonly|inactive|sendrecv)$/.test(l)} />
        {result.streams.some(x => x.accepted)
          ? <SdpBlock title="Answer · 200 OK from Bob" text={result.text} highlight={l => l.startsWith('m=') || /^a=(sendonly|recvonly|inactive|sendrecv)$/.test(l)} />
          : <SdpBlock title="No answer · 488 Not Acceptable Here" text={'No stream can be accepted, so there is no answer.\nBob\'s phone rejects the INVITE.'} highlight={() => false} />}
      </div>

      <div className="oa-result" aria-live="polite">
        {result.streams.map(st => (
          <section key={st.index} className={`oa-stream${st.accepted ? '' : ' is-rejected'}`}>
            <p className="oa-stream-title">{st.media === 'audio' ? 'Audio' : 'Video'}<span>{st.accepted ? `accepted · ${st.offerDir} → ${st.answerDir}` : 'rejected · port 0'}</span></p>
            {st.accepted ? (
              <>
                <Arrow from="Alice" to="Bob" on={canSend(st.offerDir) && canRecv(st.answerDir)}
                  codec={st.offererSends && `${LABEL[codecKey(st.offererSends)] ?? st.offererSends.name}, payload type ${st.offererSends.pt}`}
                  why={!canSend(st.offerDir) ? `no media: Alice's offer is ${st.offerDir}` : `no media: Bob's answer is ${st.answerDir}`} />
                <Arrow from="Bob" to="Alice" on={canSend(st.answerDir) && canRecv(st.offerDir)}
                  codec={st.answererSends && `${LABEL[codecKey(st.answererSends)] ?? st.answererSends.name}, payload type ${st.answererSends.pt}`}
                  why={!canSend(st.answerDir) ? `no media: Bob's answer is ${st.answerDir}` : `no media: Alice's offer is ${st.offerDir}`} />
                {st.media === 'audio' && <p className="oa-dtmf">{st.dtmf ? 'Keypad digits: telephone-event (RFC 4733).' : 'Keypad digits: no telephone-event. DTMF must go in the audio or in SIP INFO.'}</p>}
              </>
            ) : <p className="oa-why">{st.reason}</p>}
          </section>
        ))}
        {!result.streams.some(x => x.accepted) && (
          <p className="oa-fail">No codec in common on any stream: the whole offer is rejected. In SIP, Bob's phone answers 488 Not Acceptable Here.</p>
        )}
      </div>

      <ul className="ud-notes oa-notes" aria-label="Rules">
        {notes.map(n => {
          const q = quotes[n.rule];
          return (
            <li key={n.rule + n.text} className={`ud-note${n.bad ? ' is-warn' : ''}`}>
              <p>{n.bad ? <span className="ud-warn" aria-hidden="true">⚠</span> : <span className="ud-dot" aria-hidden="true">•</span>}{n.text}</p>
              {q && <p className="ud-q">“{markKeywords(q.text.replace(/\s+/g, ' '))}” <a href={q.url} target="_blank" rel="noopener">RFC {q.rfc} §{q.section} ↗</a></p>}
            </li>
          );
        })}
      </ul>
    </figure>
  );
}

function noteList(streams: StreamOutcome[], s: State): { text: string; rule: string; bad?: boolean }[] {
  const out: { text: string; rule: string; bad?: boolean }[] = [];
  const a = streams[0]!;
  if (a.accepted) {
    out.push({ text: `${a.reason} Alice sends the first one in the answer.`, rule: 'rfc3264-7-first' });
  } else {
    out.push({ text: a.reason, rule: a.rule, bad: true });
  }
  const v = streams[1];
  if (v && !v.accepted) out.push({ text: v.reason, rule: v.rule });
  if (a.accepted && a.offererSends && a.answererSends && codecKey(a.offererSends) !== codecKey(a.answererSends)) {
    out.push({ text: `Bob listed the codecs in his own order, so Alice sends ${a.offererSends.name} and Bob sends ${a.answererSends.name}. Both are allowed, but a codec each way confuses people and some gateways.`, rule: 'rfc3264-6.1-order', bad: true });
  } else if (a.accepted && a.answererSends) {
    out.push({ text: `Bob sends the most preferred codec of the offer that is also in his answer: ${a.answererSends.name}.`, rule: 'rfc3264-6.1-answerer-send' });
  }
  if (a.accepted && a.offererSends && a.answererSends && a.offererSends.pt !== a.answererSends.pt && codecKey(a.offererSends) === codecKey(a.answererSends)) {
    out.push({ text: `The same codec has two numbers: ${a.answererSends.pt} in the offer and ${a.offererSends.pt} in the answer. Each side sends with the number the other side chose.`, rule: 'rfc3264-5.1-pt-send', bad: true });
  }
  if (a.accepted && a.offerDir !== 'sendrecv') {
    out.push({ text: `The offer is ${a.offerDir}, so Bob can answer only ${a.offerDir === 'sendonly' ? 'recvonly or inactive' : a.offerDir === 'recvonly' ? 'sendonly or inactive' : 'inactive'}.`, rule: 'rfc3264-6.1-direction' });
  }
  if (a.accepted && !a.dtmf && s.aDtmf !== s.bDtmf) {
    out.push({ text: 'No telephone-event in the answer. Digits pressed during the call may not reach an IVR or voicemail.', rule: 'rfc4733-1.2-why', bad: true });
  }
  return out;
}
