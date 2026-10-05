import { describe, expect, it } from 'vitest';
import {
  answerDirection, buildSdp, checkAnswer, checkNewVersion, HOLD_START, holdStep, mediaFlow, negotiate, parseSdp,
  type AnswerPolicy,
} from '../src/sip/sdp.ts';
import { lintFlow } from '../src/sip/lint-flow.ts';
import { prepareFlow } from '../src/sip/flow.ts';
import { loadFlow, loadFlowData } from '../src/lib/data.ts';

const OFFER = `v=0
o=alice 2890844526 2890844526 IN IP4 192.0.2.10
s=-
c=IN IP4 192.0.2.10
t=0 0
m=audio 49170 RTP/AVP 0 8 111 101
a=rtpmap:0 PCMU/8000
a=rtpmap:8 PCMA/8000
a=rtpmap:111 opus/48000/2
a=fmtp:111 minptime=10;useinbandfec=1
a=rtpmap:101 telephone-event/8000
a=fmtp:101 0-16
a=ptime:20
m=video 51372 RTP/AVP 96
a=rtpmap:96 H264/90000`;

const rules = (text: string) => parseSdp(text).issues.filter(i => i.severity === 'error').map(i => i.rule);

describe('parsing SDP (RFC 8866 §5)', () => {
  it('reads the origin, streams, codecs, and the default direction', () => {
    const s = parseSdp(OFFER);
    expect(s.issues.filter(i => i.severity !== 'info')).toEqual([]);
    expect(s.origin).toMatchObject({ username: 'alice', version: 2890844526, address: '192.0.2.10' });
    expect(s.media.map(m => [m.media, m.port, m.direction])).toEqual([['audio', 49170, 'sendrecv'], ['video', 51372, 'sendrecv']]);
    expect(s.media[0]!.codecs.map(c => `${c.pt} ${c.name}/${c.rate}`)).toEqual(['0 PCMU/8000', '8 PCMA/8000', '111 opus/48000', '101 telephone-event/8000']);
    expect(s.media[0]!.codecs[2]!.fmtp).toBe('minptime=10;useinbandfec=1');
    expect(s.media[1]!.c?.address).toBe('192.0.2.10'); // from the session level
  });

  it('maps static payload types without rtpmap, and flags dynamic ones without it', () => {
    const s = parseSdp('v=0\no=- 1 1 IN IP4 192.0.2.1\ns=-\nc=IN IP4 192.0.2.1\nt=0 0\nm=audio 4000 RTP/AVP 0 18 98');
    expect(s.media[0]!.codecs.map(c => c.name)).toEqual(['PCMU', 'G729']);
    expect(s.issues.find(i => i.rule === 'rfc3551-3-mapping')?.message).toMatch(/98 has no a=rtpmap/);
  });

  it('flags lines out of order, spaces around =, unknown types, and missing lines', () => {
    expect(rules('v=0\ns=-\no=- 1 1 IN IP4 192.0.2.1\nc=IN IP4 192.0.2.1\nt=0 0')).toContain('rfc8866-5-order');
    expect(rules('v=0\no=- 1 1 IN IP4 192.0.2.1\ns=-\nc = IN IP4 192.0.2.1\nt=0 0')).toContain('rfc8866-5-type');
    expect(rules('v=0\no=- 1 1 IN IP4 192.0.2.1\ns=-\nx=1\nt=0 0')).toContain('rfc8866-5-unknown');
    expect(rules('v=0\no=- 1 1 IN IP4 192.0.2.1\ns=-\nt=0 0\nm=audio 4000 RTP/AVP 0')).toContain('rfc8866-5.7-c');
    expect(rules('v=0\no=- 1 1 IN IP4 192.0.2.1\ns=\nc=IN IP4 192.0.2.1\nt=0 0')).toContain('rfc8866-5.3-s');
    // a=rtcp belongs to a stream.
    expect(rules('v=0\no=- 1 1 IN IP4 192.0.2.1\ns=-\nc=IN IP4 192.0.2.1\nt=0 0\na=rtcp:5001')).toContain('rfc3605-2.1-rtcp');
  });

  it('allows one direction per level; the media level overrides the session level', () => {
    const s = parseSdp('v=0\no=- 1 1 IN IP4 192.0.2.1\ns=-\nc=IN IP4 192.0.2.1\nt=0 0\na=inactive\nm=audio 4000 RTP/AVP 0\na=sendrecv\nm=audio 4002 RTP/AVP 0');
    expect(s.media.map(m => m.direction)).toEqual(['sendrecv', 'inactive']);
    expect(rules('v=0\no=- 1 1 IN IP4 192.0.2.1\ns=-\nc=IN IP4 192.0.2.1\nt=0 0\nm=audio 4000 RTP/AVP 0\na=sendonly\na=recvonly')).toContain('rfc8866-6.7-one');
  });

  it('warns about private and 0.0.0.0 addresses, and notes a stream without telephone-event', () => {
    const s = parseSdp('v=0\no=- 1 1 IN IP4 192.168.1.20\ns=-\nc=IN IP4 192.168.1.20\nt=0 0\nm=audio 4000 RTP/AVP 0');
    expect(s.issues.map(i => `${i.severity} ${i.rule}`)).toEqual(['warn rfc6314-3-private', 'info rfc4733-2.5.1.1-negotiate']);
    expect(parseSdp('v=0\no=- 1 1 IN IP4 192.0.2.1\ns=-\nc=IN IP4 0.0.0.0\nt=0 0').issues[0]!.rule).toBe('rfc3264-8.4-zero');
  });

  it('explains every line', () => {
    const s = parseSdp(OFFER);
    expect(s.lines.every(l => l.explain.length > 0)).toBe(true);
    expect(s.lines.find(l => l.raw.startsWith('a=fmtp:101'))!.explain).toMatch(/0–9 are the digits/);
  });

  it('builds SDP that parses cleanly', () => {
    const text = buildSdp({ user: 'bob', sessId: '1', version: 1, address: '203.0.113.20', streams: [
      { media: 'audio', port: 3456, codecs: [{ pt: 0, name: 'PCMU', rate: 8000 }], direction: 'recvonly', ptime: 20 },
      { media: 'video', port: 0, codecs: [{ pt: 96, name: 'H264', rate: 90000 }] },
    ] });
    expect(text.split('\n').slice(-2)).toEqual(['a=recvonly', 'm=video 0 RTP/AVP 96']);
    expect(rules(text)).toEqual([]);
  });
});

const BOB: AnswerPolicy = {
  codecs: ['pcma/8000', 'pcmu/8000', 'g729/8000'], media: ['audio'], want: 'sendrecv', order: 'offer',
  telephoneEvent: true, rtcpMux: false, user: 'bob', sessId: '2808844564', version: 2808844564, address: '203.0.113.20',
  ports: { audio: 3456, video: 3458 },
};

describe('negotiating an answer (RFC 3264 §6)', () => {
  it('keeps every m= line, rejects video with port 0, and keeps the offer order', () => {
    const r = negotiate(parseSdp(OFFER), BOB);
    expect(r.answer.media.map(m => [m.media, m.port])).toEqual([['audio', 3456], ['video', 0]]);
    expect(r.answer.media[0]!.fmts).toEqual(['0', '8', '101']);
    expect(r.streams[0]).toMatchObject({ accepted: true, dtmf: true });
    expect(r.streams[0]!.offererSends?.name).toBe('PCMU');
    expect(r.streams[0]!.answererSends?.name).toBe('PCMU');
    expect(r.streams[1]).toMatchObject({ accepted: false, rule: 'rfc3264-6-reject' });
    expect(checkAnswer(parseSdp(OFFER), r.answer)).toEqual([]);
  });

  it('with its own order, each side may send a different codec', () => {
    const r = negotiate(parseSdp(OFFER), { ...BOB, order: 'answerer' });
    expect(r.answer.media[0]!.fmts).toEqual(['8', '0', '101']);
    expect(r.streams[0]!.offererSends?.name).toBe('PCMA'); // first in the answer
    expect(r.streams[0]!.answererSends?.name).toBe('PCMU'); // most preferred in the offer
  });

  it('rejects a stream with no codec in common, and drops telephone-event when not supported', () => {
    expect(negotiate(parseSdp(OFFER), { ...BOB, codecs: ['g729/8000'] }).streams[0]).toMatchObject({ accepted: false, rule: 'rfc3264-6.1-no-common' });
    const r = negotiate(parseSdp(OFFER), { ...BOB, telephoneEvent: false });
    expect(r.answer.media[0]!.fmts).toEqual(['0', '8']);
    expect(r.streams[0]!.dtmf).toBe(false);
  });

  it('may use its own payload type numbers; each side sends with the numbers the other chose', () => {
    const r = negotiate(parseSdp(OFFER), { ...BOB, codecs: ['opus/48000'], ownPts: { 'opus/48000': 96, 'telephone-event/8000': 100 } });
    expect(r.answer.media[0]!.fmts).toEqual(['96', '100']);
    expect(r.streams[0]!.offererSends).toMatchObject({ name: 'opus', pt: 96 });
    expect(r.streams[0]!.answererSends).toMatchObject({ name: 'opus', pt: 111 });
    expect(checkAnswer(parseSdp(OFFER), r.answer)).toEqual([]);
  });

  it('answers a direction that the offered direction allows', () => {
    expect(answerDirection('sendonly', 'sendrecv')).toBe('recvonly');
    expect(answerDirection('sendonly', 'sendonly')).toBe('inactive');
    expect(answerDirection('recvonly', 'sendrecv')).toBe('sendonly');
    expect(answerDirection('inactive', 'sendrecv')).toBe('inactive');
    expect(answerDirection('sendrecv', 'sendonly')).toBe('sendonly');
    expect(mediaFlow('sendonly', 'recvonly')).toEqual({ offererSends: true, answererSends: false });
  });

  it('flags a removed m= line, a codec not in the offer, and a wrong direction', () => {
    const offer = parseSdp(OFFER);
    const audioOnly = parseSdp('v=0\no=bob 1 1 IN IP4 203.0.113.20\ns=-\nc=IN IP4 203.0.113.20\nt=0 0\nm=audio 3456 RTP/AVP 18\na=rtpmap:18 G729/8000');
    expect(checkAnswer(offer, audioOnly).map(i => i.rule)).toEqual(['sdp-mlines', 'answer-codec']);
    const held = parseSdp(OFFER.replace('a=ptime:20', 'a=ptime:20\na=sendonly'));
    const wrong = negotiate(parseSdp(OFFER), BOB).text.replace('m=audio 3456 RTP/AVP 0 8 101', 'm=audio 3456 RTP/AVP 0 8 101\na=sendonly');
    expect(checkAnswer(held, parseSdp(wrong)).map(i => i.rule)).toEqual(['answer-direction']);
  });
});

describe('new offers and hold (RFC 3264 §8)', () => {
  it('a changed SDP needs the next version', () => {
    const v1 = parseSdp(OFFER);
    const held = (ver: number) => parseSdp(OFFER.replace('2890844526 2890844526', `2890844526 ${ver}`).replace('a=ptime:20', 'a=ptime:20\na=sendonly'));
    expect(checkNewVersion(v1, held(2890844527))).toEqual([]);
    expect(checkNewVersion(v1, held(2890844526)).map(i => i.rule)).toEqual(['sdp-version']);
    expect(checkNewVersion(v1, held(2890844530)).map(i => i.rule)).toEqual(['sdp-version']);
    expect(checkNewVersion(v1, parseSdp(OFFER))).toEqual([]); // the same SDP again
  });

  it('hold, hold back, and resume, as RFC 6337 §5.3 describes', () => {
    let s = HOLD_START;
    const step = (by: 'alice' | 'bob', want: 'sendrecv' | 'sendonly') => { const r = holdStep(s, by, want); s = r.state; return r.exchange; };
    expect(step('alice', 'sendonly')).toMatchObject({ offerDir: 'sendonly', answerDir: 'recvonly' });
    expect([s.aliceSends, s.bobSends]).toEqual([true, false]);
    expect(step('bob', 'sendonly')).toMatchObject({ offerDir: 'sendonly', answerDir: 'inactive' });
    expect([s.aliceSends, s.bobSends]).toEqual([false, false]);
    expect(step('alice', 'sendrecv')).toMatchObject({ answerDir: 'sendonly' }); // Bob is still holding
    expect([s.aliceSends, s.bobSends]).toEqual([false, true]);
    expect(step('bob', 'sendrecv')).toMatchObject({ answerDir: 'sendrecv' });
    expect([s.aliceSends, s.bobSends]).toEqual([true, true]);
    expect(s.version.alice).toBe(HOLD_START.version.alice + 3); // sendonly, inactive, sendrecv
  });

  it('an offer with the old version changes nothing', () => {
    const r = holdStep(HOLD_START, 'alice', 'sendonly', false);
    expect(r.exchange).toMatchObject({ ignored: true, answerDir: 'sendrecv', offerVersion: HOLD_START.version.alice });
    expect([r.state.aliceSends, r.state.bobSends]).toEqual([true, true]);
  });
});

describe('SDP lint rules on flows', () => {
  const broken = async (id: string) => lintFlow(await loadFlow(id)).map(i => i.rule);

  it('each broken flow breaks only its own rule, and its fixed flow is clean', async () => {
    expect(await broken('hold-same-version')).toEqual(['sdp-version']);
    expect(await broken('hold-version-incremented')).toEqual([]);
    expect(await broken('answer-mline-removed')).toEqual(['sdp-mlines']);
    expect(await broken('answer-port-zero')).toEqual([]);
    expect(await broken('sdp-private-address')).toEqual(['sdp-private-address']);
    expect(await broken('sdp-public-address')).toEqual([]);
  });

  it('accepts early offer, late offer, 183 with PRACK and UPDATE, and hold and resume', async () => {
    for (const id of ['sdp-early-offer', 'sdp-late-offer', 'sdp-183-prack-update', 'hold-resume']) {
      expect(await broken(id)).toEqual([]);
    }
  });

  it('checks the answer in the ACK against the offer in the 200 OK', async () => {
    const data = structuredClone(loadFlowData('sdp-late-offer'));
    data.steps[3]!.message = data.steps[3]!.message!
      .replace('m=audio 49170 RTP/AVP 0 101', 'm=audio 49170 RTP/AVP 18 101').replace('a=rtpmap:0 PCMU/8000', 'a=rtpmap:18 G729/8000');
    expect(lintFlow(await prepareFlow(data)).map(i => i.rule)).toEqual(['answer-codec']);
  });

  it('after a 491, the next SDP is compared with the one before the rejected offer', async () => {
    expect(await broken('glare-491')).toEqual([]);
  });
});
