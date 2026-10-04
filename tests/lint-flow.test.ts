import { describe, expect, it } from 'vitest';
import { prepareFlow, toWire, type FlowData } from '../src/sip/flow.ts';
import { lintFlow } from '../src/sip/lint-flow.ts';
import { lintDiagram } from '../src/sip/lint-diagram.ts';
import { parseMessage } from '../src/sip/parse.ts';

const lanes = [
  { id: 'a', label: 'Alice', kind: 'ua' as const },
  { id: 'p', label: 'Proxy A', kind: 'proxy' as const },
];

const msg = (start: string, extra: string[], branch: string, cseq: string, toTag = '') => [
  start,
  `Via: SIP/2.0/UDP 192.0.2.10:5060;branch=${branch}`,
  'Max-Forwards: 70',
  'From: <sip:alice@atlanta.example>;tag=f1',
  `To: <sip:bob@biloxi.example>${toTag}`,
  'Call-ID: c1@192.0.2.10',
  `CSeq: ${cseq}`,
  ...extra,
  'Content-Length: {auto}',
].join('\n');

const invite = (branch: string, seq: number, extra: string[] = []) =>
  msg('INVITE sip:bob@biloxi.example SIP/2.0', ['Contact: <sip:alice@192.0.2.10>', ...extra], branch, `${seq} INVITE`);
const resp = (code: string, branch: string, seq: number, extra: string[] = []) =>
  msg(`SIP/2.0 ${code}`, extra, branch, `${seq} INVITE`, ';tag=t1').replace('Max-Forwards: 70\n', '');
const ack = (branch: string, seq: number) => msg('ACK sip:bob@biloxi.example SIP/2.0', [], branch, `${seq} ACK`, ';tag=t1');

const flow = (steps: [string, string, string][]): FlowData => ({
  id: 't', title: 't', lanes,
  steps: steps.map(([from, to, message]) => ({ from, to, label: message.split(' ')[0]!, caption: 'Test step.', message })),
});

const rules = async (f: FlowData) => lintFlow(await prepareFlow(f)).filter(i => i.severity === 'error').map(i => i.rule);

const CHALLENGE = ['Proxy-Authenticate: Digest realm="atlanta.example", nonce="n1", qop="auth"'];
const CREDS = ['Proxy-Authorization: Digest username="alice", realm="atlanta.example", nonce="n1", uri="sip:bob@biloxi.example", response="x", qop=auth, nc=00000001, cnonce="c"'];

describe('toWire', () => {
  it('uses CRLF and fills Content-Length with the body size in bytes', () => {
    const w = toWire('MESSAGE sip:b@x SIP/2.0\nContent-Length: {auto}\n\nhé');
    expect(w).toBe('MESSAGE sip:b@x SIP/2.0\r\nContent-Length: 5\r\n\r\nhé\r\n');
    expect(parseMessage(w).body).toBe('hé\r\n');
  });
});

describe('lintFlow', () => {
  it('accepts a correct 407 challenge with ACK and retry', async () => {
    expect(await rules(flow([
      ['a', 'p', invite('z9hG4bK1', 1)],
      ['p', 'a', resp('407 Proxy Authentication Required', 'z9hG4bK1', 1, CHALLENGE)],
      ['a', 'p', ack('z9hG4bK1', 1)],
      ['a', 'p', invite('z9hG4bK2', 2, CREDS)],
    ]))).toEqual([]);
  });

  it('finds a 407 that is never ACKed', async () => {
    expect(await rules(flow([
      ['a', 'p', invite('z9hG4bK1', 1)],
      ['p', 'a', resp('407 Proxy Authentication Required', 'z9hG4bK1', 1, CHALLENGE)],
      ['a', 'p', invite('z9hG4bK2', 2, CREDS)],
    ]))).toEqual(['invite-final-ack']);
  });

  it('finds an ACK for a non-2xx with a new branch', async () => {
    expect(await rules(flow([
      ['a', 'p', invite('z9hG4bK1', 1)],
      ['p', 'a', resp('486 Busy Here', 'z9hG4bK1', 1)],
      ['a', 'p', ack('z9hG4bK9', 1)],
    ]))).toEqual(['ack-non2xx-branch']);
  });

  it('finds an ACK for a 2xx that reuses the INVITE branch', async () => {
    expect(await rules(flow([
      ['a', 'p', invite('z9hG4bK1', 1)],
      ['p', 'a', resp('200 OK', 'z9hG4bK1', 1)],
      ['a', 'p', ack('z9hG4bK1', 1)],
    ]))).toEqual(['ack-2xx-branch']);
  });

  it('finds a retry that keeps the CSeq and has no credentials', async () => {
    const r = await rules(flow([
      ['a', 'p', invite('z9hG4bK1', 1)],
      ['p', 'a', resp('407 Proxy Authentication Required', 'z9hG4bK1', 1, CHALLENGE)],
      ['a', 'p', ack('z9hG4bK1', 1)],
      ['a', 'p', invite('z9hG4bK2', 1)],
    ]));
    expect(r.filter(x => x === 'auth-retry')).toHaveLength(2);
  });

  it('finds a missing magic cookie, a wrong CSeq method, and a wrong Content-Length', async () => {
    const bad = invite('abc', 1).replace('1 INVITE', '1 BYE').replace('{auto}', '99');
    expect((await rules(flow([['a', 'p', bad]]))).sort()).toEqual(['branch-cookie', 'content-length', 'cseq-method']);
  });
});

describe('lintDiagram', () => {
  it('enforces label length, caption length, and glossary lanes', async () => {
    const f = await prepareFlow({
      id: 't', title: 't',
      lanes: [...lanes, { id: 'x', label: 'Mystery box', kind: 'server' }],
      steps: [{
        from: 'a', to: 'x', label: 'Hello there this is far too long', message: undefined,
        caption: 'This caption sentence is much too long because it keeps going and going on and on for many more words than the limit of twenty.',
      }],
    });
    const r = lintDiagram(f, ['Alice', 'Proxy A']).map(i => i.rule).sort();
    expect(r).toEqual(['caption-words', 'label-start', 'label-words', 'lane-glossary']);
  });
});
