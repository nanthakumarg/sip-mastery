/**
 * Serializable data that Astro passes to the diagram islands.
 * Islands parse `wire` themselves with src/sip/parse.ts, so the HTML stays small.
 */
import type { Lane, Protocol, StepKind } from '../sip/flow.ts';

export interface ClientStep {
  index: number;
  kind: StepKind;
  from: string;
  to: string;
  proto: Protocol;
  label: string;
  caption: string;
  warn?: string;
  lost?: boolean;
  rfc?: string;
  wire?: string;
}

export interface ClientFlow {
  id: string;
  title: string;
  summary?: string;
  broken?: boolean;
  lanes: Lane[];
  steps: ClientStep[];
}

export interface ClientQuote {
  id: string;
  rfc: number;
  section: string;
  title: string;
  text: string;
  url: string;
}

export interface ClientRefEntry {
  summary: string;
  url?: string;
  label?: string;
  who?: string;
}

export interface ClientRef {
  headers: Record<string, ClientRefEntry>;
  request: ClientRefEntry;
  response: ClientRefEntry;
  sdp: Record<string, ClientRefEntry>;
}

/** Everything one diagram island needs. */
export interface FlowBundle {
  flow: ClientFlow;
  quotes: Record<string, ClientQuote>;
  refData: ClientRef;
}

export const PROTO_LABEL: Record<Protocol, string> = {
  sip: 'SIP', sdp: 'SDP', rtp: 'RTP media', rtcp: 'RTCP', dns: 'DNS / STUN / ICE', err: 'Error', down: 'Lost',
};
