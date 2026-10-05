/**
 * SRTP packet (Module 18): take the key from an a=crypto line and an RTP
 * packet, and follow RFC 3711 with real cryptography: session keys, the IV,
 * the encrypted payload, and the authentication tag. Then look at the
 * packet as an attacker would: without the key, with the key, or after
 * changing one bit. The model is src/net/srtp.ts.
 */
import { useEffect, useState } from 'react';
import { markKeywords } from './Inspector.tsx';
import { encodeRtp } from '../net/rtp.ts';
import { hex, parseCrypto, protectRtp, unprotectRtp, type Protected, type Unprotected } from '../net/srtp.ts';
import type { ClientQuote } from './types.ts';

interface Props { quotes: Record<string, ClientQuote> }

const CRYPTO = '1 AES_CM_128_HMAC_SHA1_80 inline:PS1uQCVeeCFCanVmcjkpPywjNWhcYD0mXXtxaVBR|2^20|1:32';
type View = 'none' | 'key' | 'flip';
const VIEWS: [View, string][] = [['none', 'Attacker without the key'], ['key', 'Attacker with the key'], ['flip', 'Attacker changes one bit']];

/** 20 ms of G.711 silence with a little noise, so the bytes look like audio. */
const AUDIO = Uint8Array.from({ length: 160 }, (_, i) => 0xff - ((i * 7) % 5));
const groups = (b: Uint8Array) => (hex(b).match(/.{1,2}/g) ?? []).join(' ');

export default function SrtpPacket({ quotes }: Props) {
  const [line, setLine] = useState(CRYPTO);
  const [seq, setSeq] = useState(26232);
  const [view, setView] = useState<View>('none');
  const [p, setP] = useState<Protected | undefined>();
  const [check, setCheck] = useState<Unprotected | undefined>();
  const c = parseCrypto(line);
  const rtp = encodeRtp({ version: 2, padding: 0, marker: false, pt: 0, seq, ts: 2412530560 + (seq - 26232) * 160, ssrc: 0x3a5f12c4, csrc: [] }, AUDIO);

  useEffect(() => {
    let live = true;
    if (!c.key || !c.salt || !c.suite) { setP(undefined); return; }
    void protectRtp(rtp, c.key, c.salt, c.suite).then(r => { if (live) setP(r); });
    return () => { live = false; };
  }, [line, seq]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let live = true;
    if (!p || !c.key || !c.salt || !c.suite || view === 'none') { setCheck(undefined); return; }
    const pkt = p.packet.slice();
    if (view === 'flip') pkt[20]! ^= 0x01; // one bit of the encrypted payload
    void unprotectRtp(pkt, c.key, c.salt, c.suite).then(r => { if (live) setCheck(r); });
    return () => { live = false; };
  }, [p, view]); // eslint-disable-line react-hooks/exhaustive-deps

  const q = (id: string) => quotes[id];
  const Quote = ({ id }: { id: string }) => { const x = q(id); return x ? <p className="ud-q">“{markKeywords(x.text.replace(/\s+/g, ' '))}” <a href={x.url} target="_blank" rel="noopener">RFC {x.rfc} §{x.section} ↗</a></p> : null; };

  return (
    <figure className="stage srtpx" aria-label="SRTP packet">
      <header className="stage-head">
        <div>
          <p className="eyebrow">SRTP · RFC 3711, real AES and HMAC</p>
          <p className="stage-title">From an RTP packet and an a=crypto key to SRTP</p>
        </div>
        <ul className="legend" aria-label="Legend">
          <li><i className="lg-rtp" />Readable</li>
          <li><i className="srtpx-lg-enc" />Encrypted</li>
          <li><i className="srtpx-lg-tag" />Auth tag</li>
        </ul>
      </header>

      <label className="ac-input srtpx-input">
        <span className="eyebrow">a=crypto (from the SDP)</span>
        <input value={line} onChange={e => setLine(e.target.value)} spellCheck={false} autoComplete="off" />
      </label>
      {c.issues.length > 0 && <ul className="rtph-issues">{c.issues.map(i => <li key={i}><span aria-hidden="true">⚠ </span>{i}</li>)}</ul>}
      <div className="srtpx-seq">
        <span>RTP sequence number <b>{seq}</b></span>
        <button type="button" className="rl-toggle" onClick={() => setSeq(s => s + 1)}>Next packet</button>
      </div>

      {c.key && c.salt && c.suite && (
        <ol className="srtpx-steps">
          <li>
            <p className="srtpx-h">1 · Master key and salt <span>base64 in the SDP, 30 bytes</span></p>
            <code>key  {groups(c.key)}</code><code>salt {groups(c.salt)}</code>
          </li>
          <li>
            <p className="srtpx-h">2 · Session keys <span>AES-CM with labels 0, 1, 2 (§4.3)</span></p>
            {p ? <><code>encryption {groups(p.keys.encKey)}</code><code>auth (HMAC) {groups(p.keys.authKey)}</code><code>salt {groups(p.keys.salt)}</code></> : <code>calculating…</code>}
          </li>
          <li>
            <p className="srtpx-h">3 · IV for this packet <span>salt ⊕ SSRC ⊕ index (§4.1.1)</span></p>
            {p ? <code>{groups(p.iv)} <span className="srtpx-dim">index {p.index} = ROC 0, seq {seq}</span></code> : <code>calculating…</code>}
            <Quote id="rfc3711-4.1.1-iv" />
          </li>
          <li>
            <p className="srtpx-h">4 · The SRTP packet <span>{p ? `${p.packet.length} bytes: ${p.headerLen} header + ${p.packet.length - p.headerLen - p.tag.length} payload + ${p.tag.length} tag` : ''}</span></p>
            {p ? (
              <p className="srtpx-bytes">
                <span className="b-hdr">{groups(p.packet.slice(0, p.headerLen))}</span>{' '}
                <span className="b-enc">{groups(p.packet.slice(p.headerLen, p.headerLen + 24))} … {groups(p.packet.slice(p.packet.length - p.tag.length - 8, p.packet.length - p.tag.length))}</span>{' '}
                <span className="b-tag">{groups(p.tag)}</span>
              </p>
            ) : <code>calculating…</code>}
            <p className="srtpx-note">The plain payload was <code>{groups(rtp.slice(12, 20))} …</code>: G.711 silence. Press <b>Next packet</b>: the same audio encrypts to different bytes, because the IV changes with the sequence number.</p>
          </li>
        </ol>
      )}

      <div className="seg srtpx-views" role="group" aria-label="Attacker view">
        {VIEWS.map(([v, label]) => <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>{label}</button>)}
      </div>
      <section className={`srtpx-attack${view === 'key' ? ' is-bad' : ''}`} aria-live="polite">
        {view === 'none' && (
          <>
            <p><b>Readable:</b> version, payload type 0, sequence number {seq}, timestamp, SSRC 0x3a5f12c4, and the packet size and timing. An eavesdropper knows that Alice talks to Bob, with G.711, and when.</p>
            <p><b>Not readable:</b> the 160 bytes of audio. Without the session key, they look like random bytes.</p>
            <Quote id="rfc3711-3.1-encrypted" />
          </>
        )}
        {view === 'key' && check && (
          <>
            <p><b>{check.ok ? 'Decrypted.' : 'Failed.'}</b> {check.ok ? `The tag matches and the payload decrypts to the original audio: ${groups(check.rtp!.slice(12, 20))} … An attacker who captured the a=crypto line, for example from SIP over UDP, can listen to the whole call.` : check.reason}</p>
            <Quote id="rfc4568-8.3-tls" />
          </>
        )}
        {view === 'flip' && check && (
          <>
            <p><b>{check.ok ? 'Accepted?' : 'Rejected.'}</b> {check.ok ? '' : `${check.reason} The receiver drops the packet; it never reaches the speaker. Without authentication, the changed bit would have become a click in the audio, and an attacker could change audio it cannot read.`}</p>
            <Quote id="rfc3711-4.2-tag" />
          </>
        )}
      </section>
    </figure>
  );
}
