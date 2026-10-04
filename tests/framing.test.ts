import { describe, expect, it } from 'vitest';
import { bodyLength, frameDatagram, frameStream, withContentLength } from '../src/sip/framing.ts';

const crlf = (s: string) => s.replace(/\n/g, '\r\n');
const INVITE = crlf('INVITE sip:bob@biloxi.example SIP/2.0\nVia: SIP/2.0/TCP 198.51.100.10;branch=z9hG4bKa\nContent-Type: application/sdp\nContent-Length: 17\n\nv=0\ns=-\nt=0 0\n');
const BYE = crlf('BYE sip:carol@chicago.example SIP/2.0\nVia: SIP/2.0/TCP 198.51.100.10;branch=z9hG4bKb\nContent-Length: 0\n\n');
const kinds = (r: { segments: { kind: string }[] }) => r.segments.map(s => s.kind);

describe('frameStream (TCP)', () => {
  it('finds two messages when Content-Length is right', () => {
    expect(bodyLength(INVITE)).toBe(17);
    const r = frameStream(INVITE + BYE);
    expect(kinds(r)).toEqual(['head', 'body', 'head']);
    expect(r.verdicts.every(v => v.ok)).toBe(true);
  });

  it('ignores CRLF keepalives before a start line', () => {
    expect(kinds(frameStream('\r\n\r\n' + BYE))).toEqual(['skipped', 'head']);
  });

  it('loses the framing when Content-Length is too small', () => {
    const r = frameStream(withContentLength(INVITE, 5) + BYE);
    expect(kinds(r)).toEqual(['head', 'body', 'garbage']);
    expect(r.verdicts.at(-1)!.ok).toBe(false);
  });

  it('eats the next message when Content-Length is too large', () => {
    const r = frameStream(withContentLength(INVITE, 30) + BYE);
    expect(kinds(r)).toEqual(['head', 'body', 'garbage']);
  });

  it('treats a missing Content-Length as an empty body', () => {
    const r = frameStream(withContentLength(INVITE, null) + BYE);
    expect(r.verdicts[0]!.ok).toBe(false);
    expect(kinds(r)).toEqual(['head', 'garbage']);
  });

  it('never finds the end of the headers with LF line endings', () => {
    const r = frameStream((INVITE + BYE).replace(/\r\n/g, '\n'));
    expect(kinds(r)).toEqual(['waiting']);
  });
});

describe('frameDatagram (UDP)', () => {
  it('discards bytes after the body', () => {
    const r = frameDatagram(withContentLength(INVITE, 5));
    expect(kinds(r)).toEqual(['head', 'body', 'discarded']);
  });

  it('rejects a request whose body is shorter than Content-Length', () => {
    const r = frameDatagram(withContentLength(INVITE, 30));
    expect(r.verdicts[0]!.text).toMatch(/400 Bad Request/);
  });

  it('allows a missing Content-Length', () => {
    expect(frameDatagram(withContentLength(INVITE, null)).verdicts[0]!.ok).toBe(true);
  });
});
