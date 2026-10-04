/**
 * Call-flow model shared by the diagrams and the build-time checks.
 * A flow file (src/content/flows/*.yaml) is the single source for a ladder,
 * its inspector messages, its step captions, and its protocol checks.
 */
import { computeDigest, type DigestAlgorithm } from './digest.ts';
import { byteLength, parseAuthParams, parseMessage, SipParseError, type SipMessage } from './parse.ts';

/** Protocol colour keys. Each key is one colour in the design tokens. */
export const PROTOCOLS = ['sip', 'sdp', 'rtp', 'rtcp', 'dns', 'err', 'down'] as const;
export type Protocol = (typeof PROTOCOLS)[number];

export const LANE_KINDS = ['ua', 'proxy', 'registrar', 'server', 'b2bua', 'sbc', 'nat'] as const;
export type LaneKind = (typeof LANE_KINDS)[number];

export interface Lane {
  id: string;
  label: string;
  kind: LaneKind;
  /** Optional second line under the label, e.g. an IP address. */
  sub?: string;
}

export type StepKind = 'msg' | 'media' | 'note';

export interface FlowStep {
  kind?: StepKind;
  from: string;
  to: string;
  proto?: Protocol;
  label: string;
  caption: string;
  /** Raw message as written in the YAML file. */
  message?: string;
  /** Quote id from rfc-quotes.yaml, shown in the inspector. */
  rfc?: string;
  /** The packet is lost on the way (drawn with a red ✕). */
  lost?: boolean;
  /** A coral "⚠" warning shown with this step. */
  warn?: string;
}

export interface FlowData {
  id: string;
  title: string;
  summary?: string;
  lanes: Lane[];
  steps: FlowStep[];
  /** A deliberately wrong flow, used on the "Broken" side of a Broken/Fixed toggle. */
  broken?: boolean;
  /** Rule IDs that a broken flow must break (and no others). */
  breaks?: string[];
  /** Example credentials used to fill `response="{digest}"` placeholders. */
  credentials?: { username: string; password: string };
}

export interface PreparedStep extends FlowStep {
  index: number;
  kind: StepKind;
  proto: Protocol;
  /** The message exactly as sent: CRLF line endings, Content-Length filled in. */
  wire?: string;
  parsed?: SipMessage;
  parseError?: string;
}

export interface PreparedFlow extends Omit<FlowData, 'steps'> {
  steps: PreparedStep[];
}

const CRLF = '\r\n';

/**
 * Converts an authored message into wire format:
 *  - line endings become CRLF
 *  - an empty line ends the headers (added when there is no body)
 *  - `Content-Length: {auto}` becomes the real body length in bytes
 */
export function toWire(authored: string): string {
  const lines = authored.replace(/\r\n/g, '\n').replace(/\s+$/, '').split('\n');
  const blank = lines.indexOf('');
  const head = blank === -1 ? lines : lines.slice(0, blank);
  const bodyLines = blank === -1 ? [] : lines.slice(blank + 1);
  const body = bodyLines.length ? bodyLines.join(CRLF) + CRLF : '';
  const headers = head.map(l =>
    /^(Content-Length|l)\s*:\s*\{auto\}\s*$/i.test(l) ? l.replace('{auto}', String(byteLength(body))) : l,
  );
  return headers.join(CRLF) + CRLF + CRLF + body;
}

/**
 * Fills `response="{digest}"` in Authorization / Proxy-Authorization headers
 * with the real digest response, calculated from the header's own parameters
 * and the flow's example password. `{digest:INVITE}` uses another method
 * (an ACK copies the INVITE credentials, RFC 3261 §22.1).
 */
async function fillDigest(wire: string, password: string | undefined): Promise<string> {
  const lines = wire.split(CRLF);
  const method = /^([A-Z]+) /.exec(lines[0] ?? '')?.[1] ?? '';
  for (let i = 0; i < lines.length; i++) {
    const m = /\{digest(?::([A-Z]+))?\}/.exec(lines[i]!);
    if (!m) continue;
    if (password === undefined) throw new Error('The flow uses {digest} but has no credentials');
    const p = parseAuthParams(lines[i]!.slice(lines[i]!.indexOf(':') + 1));
    const { response } = await computeDigest({
      algorithm: (p.algorithm?.toUpperCase() ?? 'MD5') as DigestAlgorithm,
      username: p.username ?? '', realm: p.realm ?? '', password,
      method: m[1] ?? method, uri: p.uri ?? '', nonce: p.nonce ?? '',
      qop: p.qop === 'auth' ? 'auth' : '', nc: p.nc ?? '', cnonce: p.cnonce ?? '',
    });
    lines[i] = lines[i]!.replace(m[0], response);
  }
  return lines.join(CRLF);
}

export async function prepareFlow(flow: FlowData): Promise<PreparedFlow> {
  const steps = await Promise.all(flow.steps.map(async (s, index) => {
    const kind: StepKind = s.kind ?? (s.message ? 'msg' : 'note');
    const step: PreparedStep = {
      ...s,
      index,
      kind,
      proto: s.proto ?? (kind === 'media' ? 'rtp' : 'sip'),
    };
    if (s.message) {
      step.wire = await fillDigest(toWire(s.message), flow.credentials?.password);
      try {
        step.parsed = parseMessage(step.wire);
      } catch (e) {
        step.parseError = e instanceof SipParseError ? e.message : String(e);
      }
    }
    return step;
  }));
  return { ...flow, steps };
}
