import { describe, expect, it } from 'vitest';
import { prepareFlow, type FlowData } from '../src/sip/flow.ts';
import { lintFlow } from '../src/sip/lint-flow.ts';
import { lintDiagram } from '../src/sip/lint-diagram.ts';
import { glossaryTerms, loadQuotes } from '../src/lib/data.ts';
import { parseSdp } from '../src/sip/sdp.ts';
import { allWebrtc, BROWSER_CANDIDATES, buildWebrtc, DEFAULT_WEBRTC, SDP_DIFFS, WEBRTC_QUOTES, webrtcKey, webrtcSdp, type WebrtcOptions } from '../src/sip/webrtc.ts';

const terms = glossaryTerms();
const quoteIds = new Set(loadQuotes().map(q => q.id));
const build = (o: Partial<WebrtcOptions>) => buildWebrtc({ ...DEFAULT_WEBRTC, ...o });
const labels = (f: FlowData) => f.steps.map(s => `${s.from}>${s.to} ${s.label}`);

describe('the WebRTC generator', () => {
  it('every combination passes the protocol and diagram checks', async () => {
    const out: string[] = [];
    for (const o of allWebrtc()) {
      const p = await prepareFlow(buildWebrtc(o));
      for (const i of [...lintFlow(p), ...lintDiagram(p, terms)]) if (i.severity === 'error' || i.rule === 'caption-passive') out.push(`${webrtcKey(o)} step ${i.step + 1}: [${i.rule}] ${i.message}`);
      for (const s of p.steps) if (s.rfc && !(WEBRTC_QUOTES as readonly string[]).includes(s.rfc)) out.push(`${webrtcKey(o)}: ${s.rfc} not in the quote list`);
    }
    for (const id of WEBRTC_QUOTES) if (!quoteIds.has(id)) out.push(`unknown quote ${id}`);
    expect(out).toEqual([]);
  });

  it('the gateway turns the WebRTC offer into classic SDP on the SIP side', () => {
    const f = build({});
    const toBob = f.steps.find(s => s.to === 'bob' && s.label === 'INVITE')!.message!;
    expect(toBob).toMatch(/m=audio 30000 RTP\/AVP 0 8 101/);
    expect(toBob).not.toMatch(/ice-ufrag|fingerprint|BUNDLE/);
    const answer = f.steps.find(s => s.to === 'browser' && s.label === '200 OK')!.message!;
    expect(answer).toMatch(/a=ice-lite[\s\S]*UDP\/TLS\/RTP\/SAVPF 0 126[\s\S]*a=setup:passive/);
  });

  it('without conversion, or without a common codec, Bob answers 488', () => {
    expect(labels(build({ convert: false }))).toContain('bob>gw 488 Not Acceptable Here');
    expect(build({ convert: false }).steps.find(s => s.to === 'bob')!.message).toMatch(/^INVITE [^\n]+\nVia: SIP\/2\.0\/TCP/);
    expect(labels(build({ codec: 'opus-none' }))).toContain('gw>browser 488 Not Acceptable Here');
  });

  it('UDP blocked: ICE fails without TURN, and works through TURN over TLS', () => {
    const fail = build({ network: 'restrictive' });
    expect(fail.steps.filter(s => s.label === 'STUN Binding request').every(s => s.lost)).toBe(true);
    expect(labels(fail)).toContain('browser>gw BYE');
    const ok = build({ network: 'restrictive', turn: true });
    expect(ok.lanes.map(l => l.id)).toEqual(['browser', 'turn', 'gw', 'bob']);
    expect(labels(ok)).toEqual(expect.arrayContaining(['browser>turn TURN Allocate', 'turn>gw STUN Binding request', 'browser>turn SRTP (TLS 443)']));
  });

  it('trickle ICE: an offer with no candidates, a reliable 183, PRACK, then INFO', () => {
    const f = build({ trickle: true });
    expect(f.steps[0]!.message).toMatch(/c=IN IP4 0\.0\.0\.0/);
    expect(f.steps[0]!.message).not.toMatch(/a=candidate/);
    expect(labels(f).slice(2, 7)).toEqual(['gw>browser 183 Session Progress', 'browser>gw PRACK', 'gw>browser 200 OK (PRACK)', 'browser>gw INFO', 'gw>browser 200 OK (INFO)']);
    expect(f.steps[5]!.message).toMatch(/Content-Type: application\/trickle-ice-sdpfrag[\s\S]*typ srflx[\s\S]*a=end-of-candidates/);
  });
});

describe('the SDP comparison', () => {
  const offer = webrtcSdp({ role: 'offer', pts: [111, 0, 8, 126], candidates: [BROWSER_CANDIDATES.host, BROWSER_CANDIDATES.srflx], video: true });
  it('the WebRTC offer parses with no errors', () => {
    expect(parseSdp(offer).issues.filter(i => i.severity === 'error')).toEqual([]);
  });
  it('every difference matches at least one line of the WebRTC offer', () => {
    for (const d of SDP_DIFFS) expect(offer.split('\n').some(l => d.webrtc.test(l)), d.id).toBe(true);
  });
});
