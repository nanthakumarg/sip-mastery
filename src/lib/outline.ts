/**
 * Course map (COURSE_STRUCTURE §3). Drives the home page and the sidebar.
 * A module is "live" when an MDX file with its number exists.
 */
export type Level = 'basic' | 'intermediate' | 'advanced';

export interface OutlineModule {
  n: number;
  title: string;
  levels: Level[];
}

export interface OutlinePart {
  n: number;
  title: string;
  modules: OutlineModule[];
}

const B: Level = 'basic', I: Level = 'intermediate', A: Level = 'advanced';

export const OUTLINE: OutlinePart[] = [
  { n: 0, title: 'Orientation', modules: [{ n: 0, title: 'Anatomy of one phone call', levels: [B] }] },
  { n: 1, title: 'Foundations', modules: [
    { n: 1, title: 'VoIP and where SIP fits', levels: [B] },
    { n: 2, title: 'Networking for SIP', levels: [B] },
  ] },
  { n: 2, title: 'The SIP language', modules: [
    { n: 3, title: 'SIP elements and addresses', levels: [B] },
    { n: 4, title: 'Anatomy of a SIP message', levels: [B] },
    { n: 5, title: 'SIP methods', levels: [B, I] },
    { n: 6, title: 'Response codes', levels: [B, I] },
    { n: 7, title: 'Headers and parameters', levels: [I] },
  ] },
  { n: 3, title: 'SIP mechanics', modules: [
    { n: 8, title: 'Transactions', levels: [I, A] },
    { n: 9, title: 'Dialogs', levels: [I, A] },
    { n: 10, title: 'Routing: Via, Record-Route, Route', levels: [A] },
    { n: 11, title: 'Finding SIP servers with DNS', levels: [A] },
  ] },
  { n: 4, title: 'Registration, authentication, security', modules: [
    { n: 12, title: 'Registration', levels: [B, I] },
    { n: 13, title: 'Digest authentication', levels: [I, A] },
    { n: 14, title: 'SIP security', levels: [A] },
  ] },
  { n: 5, title: 'Media', modules: [
    { n: 15, title: 'SDP and offer/answer', levels: [I, A] },
    { n: 16, title: 'RTP', levels: [I] },
    { n: 17, title: 'RTCP', levels: [I, A] },
    { n: 18, title: 'SRTP and media security', levels: [A] },
  ] },
  { n: 6, title: 'Transports', modules: [{ n: 19, title: 'SIP over UDP, TCP, TLS, and WebSocket', levels: [I, A] }] },
  { n: 7, title: 'NAT traversal', modules: [{ n: 20, title: 'NAT and SIP', levels: [A] }] },
  { n: 8, title: 'Call flow library', modules: [
    { n: 21, title: 'Basic call flows', levels: [B, I] },
    { n: 22, title: 'Mid-call features', levels: [I, A] },
    { n: 23, title: 'Events, presence, and messaging', levels: [I] },
    { n: 24, title: 'PSTN interworking and SIP trunks', levels: [A] },
  ] },
  { n: 9, title: 'SIP in the real world', modules: [
    { n: 25, title: 'Proxies, B2BUAs, and SBCs', levels: [A] },
    { n: 26, title: 'WebRTC and SIP', levels: [A] },
    { n: 27, title: 'IMS and VoLTE', levels: [A] },
    { n: 28, title: 'Caller identity: STIR/SHAKEN', levels: [A] },
    { n: 29, title: 'Voice quality', levels: [A] },
  ] },
  { n: 10, title: 'Troubleshooting', modules: [
    { n: 30, title: 'Reading traces', levels: [I, A] },
    { n: 31, title: 'Troubleshooting playbook', levels: [A] },
  ] },
  { n: 11, title: 'Case files', modules: [{ n: 32, title: 'Case files', levels: [A] }] },
];

export const LEVEL_LABEL: Record<Level, string> = { basic: 'Basic', intermediate: 'Intermediate', advanced: 'Advanced' };

export const pad2 = (n: number) => String(n).padStart(2, '0');
