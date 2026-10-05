/**
 * Serializable data that Astro passes to the diagram islands.
 * Islands parse `wire` themselves with src/sip/parse.ts, so the HTML stays small.
 */
import type { FlowMap, FlowPhase, Lane, Protocol, RegistrarConfig, StepKind } from '../sip/flow.ts';

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
  oneway?: boolean;
  rfc?: string;
  wire?: string;
  status?: Record<string, string>;
  detail?: string;
  at?: number;
}

export interface ClientFlow {
  id: string;
  title: string;
  summary?: string;
  broken?: boolean;
  lanes: Lane[];
  steps: ClientStep[];
  phases?: FlowPhase[];
  map?: FlowMap;
  registrar?: RegistrarConfig;
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
  sip: 'SIP', sdp: 'SDP', rtp: 'RTP media', rtcp: 'RTCP', dns: 'DNS / STUN / ICE', net: 'TCP / IP', err: 'Error', down: 'Lost',
};
