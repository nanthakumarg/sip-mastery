/**
 * How a receiver finds the messages in the bytes it receives (Module 4.5).
 *
 * Models a strict RFC 3261 parser: the headers end at the first CRLF CRLF,
 * and the body is Content-Length bytes long (RFC 3261 §7.5, §18.3, §20.14).
 * Over UDP, each datagram is one message. Over TCP, messages follow each
 * other in one byte stream. Pure TypeScript; strings are ASCII, so one
 * character is one byte.
 */

export type SegmentKind =
  | 'head'       // start line and headers, up to and including the empty line
  | 'body'       // the body, as the receiver counts it
  | 'skipped'    // CRLF before a start line, ignored on a stream
  | 'discarded'  // bytes after the body in a datagram (MUST be discarded)
  | 'garbage'    // bytes the receiver reads as a message, but they are not one
  | 'waiting';   // bytes the receiver holds while it waits for more

export interface Segment {
  kind: SegmentKind;
  start: number;
  end: number;
  /** Which message the receiver thinks this belongs to (1-based). */
  msg?: number;
}

export interface Verdict {
  msg: number;
  ok: boolean;
  text: string;
}

export interface FramingResult {
  segments: Segment[];
  verdicts: Verdict[];
}

const START_LINE = /^(?:[A-Z][A-Z-]* \S+ SIP\/2\.0|SIP\/2\.0 \d{3} .*)$/;

function contentLength(head: string): number | undefined {
  for (const line of head.split('\r\n').slice(1)) {
    const m = /^(content-length|l)\s*:\s*(\d+)\s*$/i.exec(line);
    if (m) return Number(m[2]);
  }
  return undefined;
}

const firstLine = (s: string, at: number) => {
  const cr = s.indexOf('\r\n', at);
  const lf = s.indexOf('\n', at);
  const end = cr >= 0 ? cr : lf >= 0 ? lf : s.length;
  return s.slice(at, end);
};

const kindOf = (start: string) => (start.startsWith('SIP/2.0') ? 'response' : 'request');

/** Frames the messages in one TCP byte stream. */
export function frameStream(stream: string): FramingResult {
  const segments: Segment[] = [];
  const verdicts: Verdict[] = [];
  let pos = 0;
  let n = 0;
  while (pos < stream.length) {
    // RFC 3261 §7.5: ignore CRLF before a start line.
    let s = pos;
    while (stream.startsWith('\r\n', s)) s += 2;
    if (s > pos) segments.push({ kind: 'skipped', start: pos, end: s });
    if (s >= stream.length) break;
    n++;
    const start = firstLine(stream, s);
    if (!START_LINE.test(start)) {
      segments.push({ kind: 'garbage', start: s, end: stream.length, msg: n });
      verdicts.push({ msg: n, ok: false, text: `“${start.slice(0, 32)}${start.length > 32 ? '…' : ''}” is not a start line. The receiver has lost the framing; usually it closes the connection, and every message after this point is lost.` });
      break;
    }
    const hdrEnd = stream.indexOf('\r\n\r\n', s);
    if (hdrEnd < 0) {
      segments.push({ kind: 'waiting', start: s, end: stream.length, msg: n });
      verdicts.push({ msg: n, ok: false, text: 'The receiver never finds the empty line (CR LF CR LF). It waits for more bytes until it gives up and closes the connection.' });
      break;
    }
    const bodyStart = hdrEnd + 4;
    segments.push({ kind: 'head', start: s, end: bodyStart, msg: n });
    const cl = contentLength(stream.slice(s, hdrEnd));
    const len = cl ?? 0;
    const end = Math.min(bodyStart + len, stream.length);
    if (len > 0) segments.push({ kind: bodyStart + len > stream.length ? 'waiting' : 'body', start: bodyStart, end, msg: n });
    if (bodyStart + len > stream.length) {
      verdicts.push({ msg: n, ok: false, text: `Content-Length says ${len} bytes, but the stream ends first. The receiver waits for ${bodyStart + len - stream.length} more bytes that never come.` });
      break;
    }
    verdicts.push({
      msg: n,
      ok: cl !== undefined,
      text: cl === undefined
        ? `${start.split(' ')[0]}: no Content-Length on a stream. The receiver assumes an empty body, so any body bytes become the start of the “next message”.`
        : `${kindOf(start) === 'request' ? start.split(' ')[0] : start.split(' ').slice(1).join(' ')}: ${len} body bytes, as Content-Length says.`,
    });
    pos = end;
  }
  return { segments, verdicts };
}

/** Frames one UDP datagram. */
export function frameDatagram(dgram: string, n = 1): FramingResult {
  const segments: Segment[] = [];
  const verdicts: Verdict[] = [];
  const start = firstLine(dgram, 0);
  const hdrEnd = dgram.indexOf('\r\n\r\n');
  if (hdrEnd < 0) {
    segments.push({ kind: 'garbage', start: 0, end: dgram.length, msg: n });
    verdicts.push({ msg: n, ok: false, text: 'No empty line (CR LF CR LF) in the datagram. A strict receiver rejects it: 400 Bad Request for a request, silence for a response.' });
    return { segments, verdicts };
  }
  const bodyStart = hdrEnd + 4;
  segments.push({ kind: 'head', start: 0, end: bodyStart, msg: n });
  const cl = contentLength(dgram.slice(0, hdrEnd));
  const actual = dgram.length - bodyStart;
  const isReq = kindOf(start) === 'request';
  const name = isReq ? start.split(' ')[0] : start.split(' ').slice(1).join(' ');
  if (cl === undefined) {
    if (actual) segments.push({ kind: 'body', start: bodyStart, end: dgram.length, msg: n });
    verdicts.push({ msg: n, ok: true, text: `${name}: no Content-Length, so the body ends at the end of the datagram. Allowed over UDP — but not over TCP.` });
  } else if (cl <= actual) {
    if (cl) segments.push({ kind: 'body', start: bodyStart, end: bodyStart + cl, msg: n });
    if (cl < actual) {
      segments.push({ kind: 'discarded', start: bodyStart + cl, end: dgram.length, msg: n });
      verdicts.push({ msg: n, ok: false, text: `${name}: Content-Length is ${cl}, but the body has ${actual} bytes. The receiver discards the last ${actual - cl} bytes — part of the SDP is silently lost.` });
    } else {
      verdicts.push({ msg: n, ok: true, text: `${name}: ${cl} body bytes, as Content-Length says.` });
    }
  } else {
    segments.push({ kind: 'garbage', start: bodyStart, end: dgram.length, msg: n });
    verdicts.push({
      msg: n, ok: false,
      text: `${name}: Content-Length is ${cl}, but the datagram ends after ${actual} body bytes. ${isReq ? 'The receiver SHOULD answer 400 Bad Request.' : 'The receiver MUST discard the response.'}`,
    });
  }
  return { segments, verdicts };
}

/** Sets the Content-Length of a message to a value (or removes the header with `null`). */
export function withContentLength(msg: string, value: number | null): string {
  const lines = msg.split('\r\n');
  const i = lines.findIndex(l => /^(content-length|l)\s*:/i.test(l));
  if (i < 0) return msg;
  if (value === null) lines.splice(i, 1);
  else lines[i] = `Content-Length: ${value}`;
  return lines.join('\r\n');
}

/** Real body length of a message in bytes. */
export function bodyLength(msg: string): number {
  const i = msg.indexOf('\r\n\r\n');
  return i < 0 ? 0 : msg.length - i - 4;
}
