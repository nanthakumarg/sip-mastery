/**
 * IMS and VoLTE (Module 27): the IMS core map, an IMS registration generator
 * (P-CSCF, I-CSCF, S-CSCF, HSS; AKA digest, RFC 3310; security agreement
 * and IPsec, RFC 3329; Path and Service-Route), and a VoLTE call generator
 * with segmented QoS preconditions (RFC 3312). Lane `status` shows the
 * registration state and the precondition state after each step.
 * Every combination passes lint-flow.ts and lint-diagram.ts.
 */
import type { FlowData, FlowStep } from './flow.ts';
import { FlowWriter, withTag, type Msg, type Node } from './sipgen.ts';

const D = 'ims.mnc001.mcc001.3gppnetwork.org';
const IMPU = `sip:+14045550111@${D}`;
const IMPI = `001010000000111@${D}`;

// ---------------------------------------------------------------------------
// The IMS core map (27.2)

export interface ImsNode {
  id: string;
  name: string;
  full: string;
  x: number;
  y: number;
  job: string;
  /** Headers it adds, removes, or acts on. */
  headers: string[];
  interfaces: string;
}

export const IMS_NODES: ImsNode[] = [
  { id: 'ue', name: 'UE', full: 'User equipment', x: 60, y: 190, job: 'The phone, with its ISIM on the SIM card. It registers, authenticates with AKA, sets up IPsec with the P-CSCF, and makes and answers calls.',
    headers: ['Security-Client, Security-Verify', 'P-Access-Network-Info', 'P-Preferred-Identity', 'Contact with +sip.instance and +g.3gpp.icsi-ref'], interfaces: 'Gm (to the P-CSCF)' },
  { id: 'pcscf', name: 'P-CSCF', full: 'Proxy CSCF', x: 210, y: 190, job: 'The first SIP hop, found when the phone connects to the IMS APN. It holds the IPsec associations, asserts the phone\'s identity, and asks the PCRF for the voice bearer.',
    headers: ['Path (in REGISTER)', 'P-Asserted-Identity (replaces P-Preferred-Identity)', 'P-Charging-Vector', 'P-Visited-Network-ID', 'Security-Server'], interfaces: 'Gm, Mw (to the CSCFs), Rx (to the PCRF)' },
  { id: 'icscf', name: 'I-CSCF', full: 'Interrogating CSCF', x: 370, y: 90, job: 'The entry point of the home network for REGISTER and for calls to its users. It asks the HSS which S-CSCF serves the user, and forwards there.',
    headers: ['None of its own: it queries and forwards'], interfaces: 'Mw, Cx (to the HSS)' },
  { id: 'scscf', name: 'S-CSCF', full: 'Serving CSCF', x: 520, y: 190, job: 'The registrar and the main proxy for the user. It challenges with AKA, downloads the user profile, and runs the initial filter criteria that send calls to application servers.',
    headers: ['WWW-Authenticate (AKAv1-MD5)', 'Service-Route', 'P-Associated-URI', 'P-Charging-Function-Addresses'], interfaces: 'Mw, Cx (to the HSS), ISC (to the AS)' },
  { id: 'hss', name: 'HSS', full: 'Home Subscriber Server', x: 520, y: 50, job: 'The user database: identities, AKA keys (through the AuC), the user profile, and which S-CSCF serves the user. It speaks Diameter, not SIP.',
    headers: ['None: Diameter UAR, MAR, SAR, LIR on the Cx interface'], interfaces: 'Cx (Diameter)' },
  { id: 'as', name: 'MMTel AS', full: 'Multimedia telephony application server', x: 690, y: 90, job: 'Supplementary services: forwarding, call waiting, hold, conference, barring. The S-CSCF sends it the calls that the user profile says it must see.',
    headers: ['History-Info (forwarding)', 'Any header of a B2BUA'], interfaces: 'ISC (to the S-CSCF), Sh (to the HSS)' },
  { id: 'bgcf', name: 'BGCF', full: 'Breakout gateway control function', x: 690, y: 190, job: 'Chooses where a call to the PSTN leaves the IMS: an MGCF in this network, or another network.',
    headers: ['None of its own: it routes'], interfaces: 'Mi, Mj' },
  { id: 'mgcf', name: 'MGCF', full: 'Media gateway control function', x: 820, y: 190, job: 'The gateway to the PSTN: SIP to ISUP, with a media gateway (MGW) that converts AMR-WB over RTP to circuit-switched G.711 (Module 24).',
    headers: ['Reason: Q.850 (from ISUP causes)'], interfaces: 'Mg, Mn (to the MGW)' },
  { id: 'ibcf', name: 'IBCF', full: 'Interconnection border control function', x: 690, y: 300, job: 'The SBC between two operators\' IMS networks: topology hiding, screening of headers, and transcoding through its TrGW (Module 25).',
    headers: ['Removes P-headers that the peer may not see', 'Hides Via, Record-Route, and addresses'], interfaces: 'Mx, Ici (to the other network)' },
];

export const IMS_LINKS: [string, string][] = [['ue', 'pcscf'], ['pcscf', 'icscf'], ['pcscf', 'scscf'], ['icscf', 'scscf'], ['icscf', 'hss'], ['scscf', 'hss'], ['scscf', 'as'], ['scscf', 'bgcf'], ['bgcf', 'mgcf'], ['scscf', 'ibcf']];

export const IMS_PATHS: Record<string, { label: string; hops: string[]; text: string }> = {
  register: { label: 'Registration', hops: ['ue', 'pcscf', 'icscf', 'hss', 'icscf', 'scscf', 'hss'],
    text: 'REGISTER goes UE → P-CSCF → I-CSCF. The I-CSCF asks the HSS which S-CSCF to use; the S-CSCF gets the AKA vectors and the user profile from the HSS.' },
  call: { label: 'Call to another network', hops: ['ue', 'pcscf', 'scscf', 'as', 'scscf', 'ibcf'],
    text: 'An INVITE follows the Service-Route: UE → P-CSCF → S-CSCF, which sends it to the MMTel AS and back, then out through the IBCF. The I-CSCF is not on the originating path.' },
  pstn: { label: 'Call to the PSTN', hops: ['ue', 'pcscf', 'scscf', 'as', 'scscf', 'bgcf', 'mgcf'],
    text: 'A call to a number with no IMS user goes from the S-CSCF to the BGCF, which picks an MGCF to break out to the PSTN.' },
};

// ---------------------------------------------------------------------------
// IMS registration (27.3, 27.4)

export const AUTHS = { aka: 'AKA', resync: 'AKA, SQN out of sync', md5: 'Client answers with MD5' } as const;
export interface ImsRegOptions {
  auth: keyof typeof AUTHS;
  regEvent: boolean;
  /** Not in the builder: the UE's SUBSCRIBE leaves out the Service-Route (the broken flow of Common mistakes). */
  ignoreServiceRoute?: boolean;
}
export const DEFAULT_IMSREG: ImsRegOptions = { auth: 'aka', regEvent: false };
export const applyImsReg = (o: ImsRegOptions, change: Partial<ImsRegOptions>) => ({ options: { ...o, ...change }, notes: [] as string[] });
export const imsRegInactive = (o: ImsRegOptions): Partial<Record<'regEvent', string>> =>
  o.auth === 'md5' ? { regEvent: 'The registration fails, so there is nothing to subscribe to.' } : {};
export const imsRegKey = (o: ImsRegOptions) => [o.auth, o.regEvent && !imsRegInactive(o).regEvent ? 'reg' : '', o.ignoreServiceRoute ? 'nosr' : ''].filter(Boolean).join('.');
export function allImsRegs(): ImsRegOptions[] {
  const out = new Map<string, ImsRegOptions>();
  for (const auth of Object.keys(AUTHS) as ImsRegOptions['auth'][]) for (const regEvent of [false, true]) { const o = { auth, regEvent }; out.set(imsRegKey(o), o); }
  return [...out.values()];
}

export const IMSREG_QUOTES = [
  'rfc3329-2.1-client-list', 'rfc3329-2.1-verify', 'rfc3310-3.1-algorithm', 'rfc3310-3.2-nonce', 'rfc3310-3.3-res', 'rfc3310-3.4-auts', 'rfc3310-2-xres',
  'rfc7315-4.4-access', 'rfc7315-4.3-visited', 'rfc7315-4.1-associated', 'rfc3327-5.2-insert', 'rfc3608-3-service-route', 'rfc3608-3-originating',
] as const;

const UE: Node = { id: 'ue', label: 'UE', kind: 'ua', ip: '10.45.0.7', br: 'ue' };
const PCSCF: Node = { id: 'pcscf', label: 'P-CSCF', kind: 'proxy', ip: '10.255.0.10', uri: `sip:pcscf.${D}:5068;lr`, br: 'pc' };
const ICSCF: Node = { id: 'icscf', label: 'I-CSCF', kind: 'proxy', ip: '10.255.0.20', uri: `sip:icscf.${D};lr`, br: 'ic' };
const SCSCF: Node = { id: 'scscf', label: 'S-CSCF', kind: 'registrar', ip: '10.255.0.30', uri: `sip:orig@scscf.${D};lr`, contact: `sip:scscf.${D}`, br: 'sc' };
const HSS = { id: 'hss', label: 'HSS', kind: 'server' as const, ip: '10.255.0.40' };

const SEC_CLIENT = 'Security-Client: ipsec-3gpp;alg=hmac-sha-1-96;ealg=null;spi-c=11111;spi-s=22222;port-c=5062;port-s=5064';
const SEC_SERVER = 'ipsec-3gpp;q=0.1;alg=hmac-sha-1-96;ealg=null;spi-c=33333;spi-s=44444;port-c=5066;port-s=5068';
const NONCES = ['dGhpcyBpcyBhIGZha2UgUkFORCtBVVROIG5vbmNlIDE=', 'c2Vjb25kIFJBTkQrQVVUTiBhZnRlciByZXN5bmMgMg=='];
const CONTACT = (port: number) => `<sip:+14045550111@10.45.0.7:${port}>;+sip.instance="<urn:gsma:imei:35209900-176148-1>";+g.3gpp.icsi-ref="urn%3Aurn-7%3A3gpp-service.ims.icsi.mmtel"`;

export function buildImsReg(options: ImsRegOptions): FlowData {
  const o = options;
  const ims = o.auth !== 'md5';
  const w = new FlowWriter();
  const diameter = (from: string, to: string, label: string, caption: string, detail: string, more: Partial<FlowStep> = {}) =>
    w.steps.push({ from, to, proto: 'net', label, caption, detail, ...more });
  let cseq = 0;
  const register = (auth: string, protectedPort: boolean, verify: boolean): Msg => ({
    line: `REGISTER sip:${D} SIP/2.0`, via: [`SIP/2.0/UDP 10.45.0.7:${protectedPort ? 5062 : 5060};branch=${w.branch(UE)}`], maxForwards: 70,
    from: `<${IMPU}>;tag=4fa3`, to: `<${IMPU}>`, callId: 'apb03a0s09dkjdfglkj49111@10.45.0.7', cseq: `${++cseq} REGISTER`,
    extra: [`Contact: ${CONTACT(protectedPort ? 5064 : 5060)}`, 'Expires: 600000', auth,
      ...(ims ? ['Require: sec-agree', 'Proxy-Require: sec-agree', SEC_CLIENT, ...(verify ? [`Security-Verify: ${SEC_SERVER}`] : [])] : []),
      'Supported: path, gruu', ...(ims ? ['P-Access-Network-Info: 3GPP-E-UTRAN-FDD; utran-cell-id-3gpp=0010100010019B01'] : [])],
  });
  /** The P-CSCF consumes sec-agree, says whether the request was integrity protected, and adds Path and its P-headers. */
  const atP = (m: Msg, integrity: 'no' | 'yes'): Msg => {
    const f = w.forward(m, PCSCF, { initial: true });
    const extra = (f.extra ?? []).filter(h => !/^(Require|Proxy-Require|Security-(Client|Verify)): /.test(h))
      .map(h => (h.startsWith('Authorization:') && ims ? `${h}, integrity-protected="${integrity}"` : h));
    return { ...f, extra: [...extra, `Path: <sip:term@pcscf.${D};lr>`, 'P-Visited-Network-ID: "Operator 001-01"', `P-Charging-Vector: icid-value="AyretyU0dm+6O2IrT5tAFrbHLso=${cseq}"`] };
  };
  const uar = () => {
    diameter('icscf', 'hss', 'Diameter UAR', 'The I-CSCF asks the HSS: may this user register here, and which S-CSCF serves it?',
      `Diameter Cx  User-Authorization-Request\n  Public-Identity: ${IMPU}\n  User-Name: ${IMPI}\n  Visited-Network-Identifier: Operator 001-01`);
    diameter('hss', 'icscf', 'Diameter UAA', 'The HSS names the S-CSCF.', `Diameter Cx  User-Authorization-Answer\n  Result-Code: DIAMETER_SUCCESS\n  Server-Name: sip:scscf.${D}`);
  };
  const mar = (resync: boolean) => {
    diameter('scscf', 'hss', 'Diameter MAR', resync ? 'The S-CSCF sends the AUTS to the HSS, which resynchronises the sequence number and makes new vectors.' : 'The S-CSCF asks the HSS for an AKA authentication vector.',
      `Diameter Cx  Multimedia-Auth-Request\n  User-Name: ${IMPI}\n  SIP-Auth-Data-Item: SIP-Authentication-Scheme = Digest-AKAv1-MD5${resync ? '\n                      SIP-Authorization = RAND + AUTS' : ''}`);
    diameter('hss', 'scscf', 'Diameter MAA', 'The HSS returns RAND, AUTN, the expected result XRES, and the keys CK and IK.',
      'Diameter Cx  Multimedia-Auth-Answer\n  SIP-Auth-Data-Item: RAND, AUTN (nonce), XRES, CK, IK', resync ? {} : { rfc: 'rfc3310-2-xres' });
  };
  /** A REGISTER from the UE through to the S-CSCF; returns the three hops. */
  const up = (m: Msg, caption: string, more: Partial<FlowStep>, integrity: 'no' | 'yes') => {
    w.msg(UE, PCSCF, m.extra!.some(h => /response="[0-9a-f]/.test(h)) ? 'REGISTER (credentials)' : 'REGISTER', caption, m, more);
    const p = atP(m, integrity);
    w.msg(PCSCF, ICSCF, 'REGISTER', integrity === 'yes' ? 'The request came over the IPsec association, so the P-CSCF marks it integrity-protected="yes".'
      : 'The P-CSCF removes the sec-agree headers, and adds Path, P-Visited-Network-ID, and P-Charging-Vector.', p,
      integrity === 'yes' ? {} : { rfc: 'rfc3327-5.2-insert' });
    uar();
    const s = w.forward(p, ICSCF, { initial: true });
    w.msg(ICSCF, SCSCF, 'REGISTER', 'The I-CSCF forwards the REGISTER to that S-CSCF.', s);
    return { m, p, s };
  };
  /** A response from the S-CSCF back to the UE, hop by hop. */
  const down = (h: { m: Msg; p: Msg; s: Msg }, status: string, more: Partial<Msg>, captions: [string, string, string], last: Partial<FlowStep> = {}, ueExtra: (x: Msg) => Msg = x => x) => {
    const r = w.response({ from: ICSCF, to: SCSCF, msg: h.s }, status, { tag: 'sc81f2', ...more });
    w.msg(SCSCF, ICSCF, status, captions[0], r, status.startsWith('401') ? { rfc: 'rfc3310-3.2-nonce' } : status.startsWith('200') ? { rfc: 'rfc3608-3-service-route' } : {});
    w.msg(ICSCF, PCSCF, status, captions[1], { ...r, via: r.via.slice(1) });
    w.msg(PCSCF, UE, status, captions[2], ueExtra({ ...r, via: r.via.slice(2) }), last);
  };
  const challenge = (nonce: string): Partial<Msg> => ({
    extra: [`WWW-Authenticate: Digest realm="${D}", nonce="${nonce}", algorithm=AKAv1-MD5, qop="auth"${ims ? ', ik="0123456789abcdeffedcba9876543210", ck="99887766554433221100aabbccddeeff"' : ''}`],
  });
  const stripKeys = (x: Msg): Msg => ({
    ...x, extra: [...(x.extra ?? []).map(h => h.replace(/, ik="[^"]*", ck="[^"]*"/, '')), ...(ims ? [`Security-Server: ${SEC_SERVER}`] : [])],
  });
  const empty = `Authorization: Digest username="${IMPI}", realm="${D}", uri="sip:${D}", nonce="", response=""`;
  const cred = (nonce: string, response: string, extra = '') =>
    `Authorization: Digest username="${IMPI}", realm="${D}", uri="sip:${D}", nonce="${nonce}", algorithm=AKAv1-MD5, response="${response}", qop=auth, nc=00000001, cnonce="7e3a9f1c"${extra}`;

  // 1. The initial REGISTER, and the challenge.
  let h = up(register(ims ? empty : `Authorization: Digest username="${IMPI}", realm="${D}", uri="sip:${D}", nonce="", response=""`, false, false),
    ims ? 'The UE registers its public identity. Security-Client lists the IPsec settings it supports; the Authorization header is empty but names the private identity.'
      : 'A generic SIP client registers to the IMS. It has a username and password, but no ISIM.',
    ims ? { rfc: 'rfc3329-2.1-client-list', status: { ue: 'Unregistered' } } : { status: { ue: 'Unregistered' } }, 'no');
  mar(false);
  const ueCaption = ims ? 'The P-CSCF keeps CK and IK for IPsec, removes them, and adds Security-Server with its own IPsec settings.' : 'The challenge reaches the client.';
  down(h, '401 Unauthorized', challenge(NONCES[0]!), ['The S-CSCF challenges with AKA: the nonce carries RAND and AUTN, and algorithm=AKAv1-MD5.', 'The I-CSCF forwards the challenge.', ueCaption],
    { rfc: ims ? 'rfc3310-3.1-algorithm' : undefined, status: { ue: 'Challenged' } }, stripKeys);

  if (o.auth === 'md5') {
    h = up(register(cred(NONCES[0]!, '6629fae49393a05397450978507c4ef1').replace('algorithm=AKAv1-MD5', 'algorithm=MD5'), false, false),
      'The client does not know AKA. It answers as for a normal digest challenge: MD5, with its configured password.',
      { warn: 'IMS does not use a password. The S-CSCF expects RES from the ISIM as the digest password.' }, 'no');
    down(h, '403 Forbidden', {}, ['The response does not match XRES. The S-CSCF rejects the registration.', 'The I-CSCF forwards the 403.', 'The client cannot register. It must use AKA with an ISIM or USIM.'],
      { status: { ue: 'Rejected' } });
    return imsRegDone(o, w);
  }

  if (o.auth === 'resync') {
    h = up(register(cred(NONCES[0]!, '', ', auts="CjkyMzRfOiwg5CfkJ2UK="'), false, false),
      'The ISIM finds the sequence number out of range. The UE sends AUTS, with an empty password, and sets up no IPsec.',
      { rfc: 'rfc3310-3.4-auts', status: { ue: 'SQN mismatch' } }, 'no');
    mar(true);
    down(h, '401 Unauthorized', challenge(NONCES[1]!), ['The S-CSCF challenges again, with a fresh vector.', 'The I-CSCF forwards the new challenge.', ueCaption],
      { status: { ue: 'Challenged' } }, stripKeys);
  }

  // 2. IPsec, then the protected REGISTER.
  w.steps.push({ from: 'ue', to: 'pcscf', proto: 'net', label: 'IPsec SAs up', status: { ue: 'IPsec ready' },
    caption: 'The ISIM checks AUTN and computes RES, CK, and IK. The UE and the P-CSCF set up IPsec with IK, on the ports in the Security headers.',
    detail: 'Two pairs of IPsec security associations (ESP, transport mode):\n  UE 5062 → P-CSCF 5068   (spi-s 44444)\n  P-CSCF 5066 → UE 5064   (spi-s 22222)\n  Integrity: HMAC-SHA-1-96 with IK; encryption: null' });
  const nonce = NONCES[o.auth === 'resync' ? 1 : 0]!;
  h = up(register(cred(nonce, 'b36e1f3c4c9d1a02c2f53f62f4b3c89e'), true, true),
    'Over the protected port, the UE answers with RES as the digest password. Security-Verify repeats the P-CSCF\'s list.',
    { rfc: 'rfc3329-2.1-verify' }, 'yes');
  diameter('scscf', 'hss', 'Diameter SAR', 'The response matches XRES. The S-CSCF tells the HSS that it now serves the user, and asks for the user profile.',
    `Diameter Cx  Server-Assignment-Request\n  Public-Identity: ${IMPU}\n  Server-Assignment-Type: REGISTRATION`, { rfc: 'rfc3310-3.3-res' });
  diameter('hss', 'scscf', 'Diameter SAA', 'The HSS returns the user profile: the identities, and the initial filter criteria for the application servers.',
    'Diameter Cx  Server-Assignment-Answer\n  User-Data: IMS subscription (public identities, iFC → MMTel AS)');
  down(h, '200 OK', {
    extra: [`Contact: ${CONTACT(5064)};expires=600000`, `Path: <sip:term@pcscf.${D};lr>`, `Service-Route: <${SCSCF.uri}>`,
      `P-Associated-URI: <${IMPU}>, <tel:+14045550111>`, 'P-Charging-Function-Addresses: ccf=pri_ccf_address'],
  }, ['The S-CSCF accepts. Service-Route names the route for the UE\'s own requests; P-Associated-URI lists its other identities.', 'The I-CSCF forwards the 200 OK.',
    'Registration done. The UE stores the Service-Route, and uses it in every later request.'], { status: { ue: 'Registered' }, rfc: 'rfc7315-4.1-associated' });

  // 3. Optional: subscribe to its own registration state, along the Service-Route.
  if (o.regEvent) {
    const sub: Msg = {
      line: `SUBSCRIBE ${IMPU} SIP/2.0`, via: [`SIP/2.0/UDP 10.45.0.7:5062;branch=${w.branch(UE)}`], maxForwards: 70, route: o.ignoreServiceRoute ? [PCSCF.uri!] : [PCSCF.uri!, SCSCF.uri!],
      from: `<${IMPU}>;tag=31415`, to: `<${IMPU}>`, callId: 'b89rjhnedlrfjflslj40a222@10.45.0.7', cseq: '61 SUBSCRIBE', contact: 'sip:+14045550111@10.45.0.7:5064',
      extra: ['Event: reg', 'Expires: 600000', 'Accept: application/reginfo+xml', 'P-Preferred-Identity: <tel:+14045550111>'],
    };
    if (o.ignoreServiceRoute) {
      w.msg(UE, PCSCF, 'SUBSCRIBE', 'The UE subscribes to its own registration state, but its Route lists only the P-CSCF. It ignored the Service-Route.', sub,
        { warn: 'Without the S-CSCF in Route, the request would miss the user\'s S-CSCF: no services, no charging.' });
      w.msg(PCSCF, UE, '400 Bad Request', 'The P-CSCF checks the Route against the stored Service-Route. They differ, and this operator\'s policy is to reject.',
        w.response({ from: UE, to: PCSCF, msg: sub }, '400 Bad Request', { tag: 'pc0400', extra: ['Warning: 399 pcscf "Route does not match the Service-Route"'] }), { rfc: 'rfc3608-3-originating' });
      return imsRegDone(o, w);
    }
    w.msg(UE, PCSCF, 'SUBSCRIBE', 'The UE subscribes to its own registration state. Route lists the P-CSCF, then the Service-Route: the S-CSCF.', sub, { rfc: 'rfc3608-3-originating' });
    const s2 = w.forward(sub, PCSCF, { initial: true });
    const s2x: Msg = { ...s2, extra: [...(s2.extra ?? []).filter(x => !x.startsWith('P-Preferred')), `P-Asserted-Identity: <${IMPU}>`] };
    w.msg(PCSCF, SCSCF, 'SUBSCRIBE', 'The P-CSCF replaces P-Preferred-Identity with P-Asserted-Identity, and follows the Route straight to the S-CSCF. No I-CSCF, no HSS query.', s2x);
    const ok = w.response({ from: PCSCF, to: SCSCF, msg: s2x }, '200 OK', { tag: 'sc5551', contact: SCSCF.contact, extra: ['Expires: 600000'] });
    w.msg(SCSCF, PCSCF, '200 OK', 'The S-CSCF accepts the subscription.', ok);
    w.msg(PCSCF, UE, '200 OK', 'The P-CSCF forwards it.', { ...ok, via: ok.via.slice(1) });
    const body = ['<?xml version="1.0"?>', `<reginfo xmlns="urn:ietf:params:xml:ns:reginfo" version="0" state="full">`, `  <registration aor="${IMPU}" id="a7" state="active">`,
      '    <contact id="76" state="active" event="registered" expires="600000"><uri>sip:+14045550111@10.45.0.7:5064</uri></contact>', '  </registration>', '</reginfo>'].join('\n') + '\n';
    const n: Msg = {
      line: 'NOTIFY sip:+14045550111@10.45.0.7:5064 SIP/2.0', via: [w.via(SCSCF)], maxForwards: 70, route: [`sip:term@pcscf.${D};lr`],
      from: `<${IMPU}>;tag=sc5551`, to: `<${IMPU}>;tag=31415`, callId: sub.callId, cseq: '1 NOTIFY', contact: SCSCF.contact,
      extra: ['Event: reg', 'Subscription-State: active;expires=600000'], body: { type: 'application/reginfo+xml', text: body },
    };
    w.msg(SCSCF, PCSCF, 'NOTIFY', 'The S-CSCF sends the full registration state, along the Path that the P-CSCF added.', n);
    const n2 = w.forward(n, { ...PCSCF, uri: `sip:term@pcscf.${D};lr` }, { initial: false });
    w.msg(PCSCF, UE, 'NOTIFY', 'The P-CSCF forwards the NOTIFY over the IPsec association.', n2);
    const nok = w.response({ from: PCSCF, to: UE, msg: n2 }, '200 OK', {});
    w.msg(UE, PCSCF, '200 OK', 'The UE confirms. If the network later ends or shortens the registration, a NOTIFY tells the UE at once.', nok);
    w.msg(PCSCF, SCSCF, '200 OK', 'The P-CSCF forwards the 200 OK.', { ...nok, via: nok.via.slice(1) });
  }
  return imsRegDone(o, w);
}

function imsRegDone(o: ImsRegOptions, w: FlowWriter): FlowData {
  return {
    id: `imsreg-${imsRegKey(o)}`,
    title: `IMS registration: ${o.auth === 'md5' ? 'a client without AKA is rejected' : o.auth === 'resync' ? 'AKA with a resynchronisation' : 'AKA and IPsec'}${o.regEvent && o.auth !== 'md5' ? ', then the reg event' : ''}`,
    lanes: [UE, PCSCF, ICSCF, SCSCF, HSS].map(n => ({ id: n.id, label: n.label, kind: n.kind, sub: n.ip })),
    steps: w.steps,
  };
}

// ---------------------------------------------------------------------------
// A VoLTE call with segmented QoS preconditions (27.5, 27.6)

export const VOLTE_CODECS = { evs: 'Both have EVS', 'amr-wb': 'UE B has AMR-WB only' } as const;
export interface VolteOptions {
  codec: keyof typeof VOLTE_CODECS;
  preconditions: boolean;
  /** Not in the builder: UE A never reports its bearer in an UPDATE (the broken flow of Common mistakes). */
  stall?: boolean;
}
export const DEFAULT_VOLTE: VolteOptions = { codec: 'evs', preconditions: true };
export const applyVolte = (o: VolteOptions, change: Partial<VolteOptions>) => ({ options: { ...o, ...change }, notes: [] as string[] });
export const volteInactive = (_: VolteOptions) => ({});
export const volteKey = (o: VolteOptions) => [o.codec, o.preconditions ? 'qos' : 'noqos', o.stall ? 'stall' : ''].filter(Boolean).join('.');
export const allVoltes = (): VolteOptions[] => (Object.keys(VOLTE_CODECS) as VolteOptions['codec'][]).flatMap(codec => [true, false].map(preconditions => ({ codec, preconditions })));

export const VOLTE_QUOTES = ['rfc3312-4-segmented', 'rfc3312-5.1.1-local-remote', 'rfc3312-1-ghost', 'rfc3262-3-require', 'rfc7315-4.6-charging', 'rfc3311-1-early'] as const;

const UE_A: Node = { id: 'ueA', label: 'UE A', kind: 'ua', ip: '10.45.0.7', contact: 'sip:+14045550111@10.45.0.7:5064', tag: 'a73kszlfl', br: 'ua' };
const CORE: Node = { id: 'core', label: 'IMS core', kind: 'proxy', ip: '10.255.0.10', uri: `sip:pcscf.${D}:5068;lr`, br: 'co' };
const UE_B: Node = { id: 'ueB', label: 'UE B', kind: 'ua', ip: '10.46.0.9', contact: 'sip:+14045550222@10.46.0.9:5064', tag: 'b81q2wz', br: 'ub' };

interface Qos { local: 'none' | 'sendrecv'; remote: 'none' | 'sendrecv' }
function volteSdp(user: string, id: number, version: number, ip: string, pts: number[], qos?: Qos & { desRemote: 'optional' | 'mandatory'; conf?: boolean }): string {
  const MAP: Record<number, string[]> = {
    96: ['a=rtpmap:96 EVS/16000', 'a=fmtp:96 br=5.9-24.4;bw=nb-swb;max-red=0'],
    97: ['a=rtpmap:97 AMR-WB/16000/1', 'a=fmtp:97 mode-change-capability=2;max-red=0'],
    105: ['a=rtpmap:105 telephone-event/16000', 'a=fmtp:105 0-15'],
  };
  return ['v=0', `o=${user} ${id} ${version} IN IP4 ${ip}`, 's=-', `c=IN IP4 ${ip}`, 'b=AS:49', 't=0 0', `m=audio 49152 RTP/AVP ${pts.join(' ')}`, 'b=AS:49',
    ...pts.flatMap(p => MAP[p]!),
    ...(qos ? [`a=curr:qos local ${qos.local}`, `a=curr:qos remote ${qos.remote}`, 'a=des:qos mandatory local sendrecv', `a=des:qos ${qos.desRemote} remote sendrecv`,
      ...(qos.conf ? ['a=conf:qos remote sendrecv'] : [])] : []),
    'a=sendrecv', 'a=ptime:20', 'a=maxptime:240'].join('\n') + '\n';
}

export function buildVolte(o: VolteOptions): FlowData {
  const w = new FlowWriter();
  w.recordRoute = true;
  const q = o.preconditions;
  const answerPt = o.codec === 'evs' ? 96 : 97;
  const FROM = `<tel:+14045550111>;tag=${UE_A.tag}`, TO = '<tel:+14045550222>';
  // UE A's UPDATE: its own segment is ready; it does not know about UE B's yet. The answer made both segments mandatory.
  const aSdp = (v: number, local: Qos['local']) => volteSdp('ueA', 3500, v, UE_A.ip, [answerPt, 105], { local, remote: 'none', desRemote: 'mandatory' });
  const inv: Msg = {
    line: 'INVITE tel:+14045550222 SIP/2.0', via: [`SIP/2.0/UDP 10.45.0.7:5062;branch=${w.branch(UE_A)}`], maxForwards: 70, route: [CORE.uri!, `sip:orig@scscf.${D};lr`],
    from: FROM, to: TO, callId: 'volte-8c1e2f7a@10.45.0.7', cseq: '1 INVITE', contact: `${UE_A.contact}`,
    extra: [`Supported: ${q ? 'precondition, ' : ''}100rel, timer`, 'P-Preferred-Service: urn:urn-7:3gpp-service.ims.icsi.mmtel', 'P-Preferred-Identity: <tel:+14045550111>',
      'Accept-Contact: *;+g.3gpp.icsi-ref="urn%3Aurn-7%3A3gpp-service.ims.icsi.mmtel"', 'P-Access-Network-Info: 3GPP-E-UTRAN-FDD; utran-cell-id-3gpp=0010100010019B01'],
    sdp: volteSdp('ueA', 3500, 3500, UE_A.ip, [96, 97, 105], q ? { local: 'none', remote: 'none', desRemote: 'optional' } : undefined),
  };
  w.msg(UE_A, CORE, 'INVITE', q ? 'UE A offers EVS and AMR-WB. a=curr says no QoS yet on either side; a=des says UE A must have its own.' : 'UE A offers EVS and AMR-WB, with no preconditions.',
    inv, { rfc: q ? 'rfc3312-5.1.1-local-remote' : undefined, status: { ueA: q ? 'No QoS' : 'Calling' } });
  w.msg(CORE, UE_A, '100 Trying', 'The P-CSCF stops UE A\'s retransmissions.', w.response({ from: UE_A, to: CORE, msg: inv }, '100 Trying', {}));
  // The IMS core stands for P-CSCF A, S-CSCF, and P-CSCF B; the ladder shows it as one proxy.
  const fwd = w.forward({ ...inv, route: [CORE.uri!] }, CORE, { initial: true, retarget: UE_B.contact });
  // With the precondition lines, the INVITE is over 1300 bytes: the core sends it over TCP (RFC 3261 §18.1.1).
  if (q) fwd.via = [fwd.via[0]!.replace('SIP/2.0/UDP', 'SIP/2.0/TCP'), ...fwd.via.slice(1)];
  const inv2: Msg = { ...fwd, extra: [...(fwd.extra ?? []).filter(x => !/^P-Preferred|^Route/.test(x)), 'P-Asserted-Identity: <tel:+14045550111>', 'P-Called-Party-ID: <tel:+14045550222>',
    `P-Charging-Vector: icid-value="1234bc9876e";icid-generated-at=10.255.0.10;orig-ioi=${D}`] };
  w.msg(CORE, UE_B, 'INVITE', q ? 'The core asserts the caller\'s identity and adds a charging vector. Now over 1300 bytes, the INVITE goes over TCP.'
    : 'The IMS core routes the call: P-Asserted-Identity in place of P-Preferred-Identity, a charging vector, and the MMTel services.', inv2,
    { rfc: 'rfc7315-4.6-charging', status: { ueB: q ? 'No QoS' : 'Incoming' } });

  const bResp = (status: string, more: Partial<Msg>) => w.response({ from: CORE, to: UE_B, msg: inv2 }, status, { tag: UE_B.tag, contact: UE_B.contact, recordRoute: inv2.recordRoute, ...more });
  const pass = (r: Msg, label: string, caption: string, more: Partial<FlowStep> = {}) => w.msg(CORE, UE_A, label, caption, { ...r, via: r.via.slice(1) }, more);
  const bSdp = (v: number, local: Qos['local'], remote: Qos['local']) => volteSdp('ueB', 7100, v, UE_B.ip, [answerPt, 105], q ? { local, remote, desRemote: 'mandatory', conf: v === 7100 } : undefined);
  const bearer = (to: 'ueA' | 'ueB', caption: string, status: string) => w.steps.push({
    from: 'core', to, proto: 'net', label: 'dedicated bearer (QCI 1)', caption, status: { [to]: status },
    detail: `P-CSCF → PCRF (Rx AAR: codec ${answerPt === 96 ? 'EVS' : 'AMR-WB'}, 49 kbit/s)\nPCRF → PGW (Gx RAR) → MME → eNodeB\nEPS dedicated bearer: QCI 1, GBR 49 kbit/s up and down`,
  });
  const inDialog = (from: Node, to: Node, method: string, seq: number, more: Partial<Msg>): Msg => ({
    line: `${method} ${to.contact} SIP/2.0`, via: [from === UE_A ? `SIP/2.0/UDP 10.45.0.7:5062;branch=${w.branch(UE_A)}` : w.via(from)], maxForwards: 70, route: [CORE.uri!],
    from: from === UE_A ? FROM : withTag(TO, UE_B.tag!), to: from === UE_A ? withTag(TO, UE_B.tag!) : FROM, callId: inv.callId, cseq: `${seq} ${method}`, ...more,
  });
  const through = (from: Node, to: Node, m: Msg, label: string, captions: [string, string], more: Partial<FlowStep> = {}, more2: Partial<FlowStep> = {}) => {
    w.msg(from, CORE, label, captions[0], m, more);
    const f = w.forward(m, CORE, { initial: false });
    w.msg(CORE, to, label, captions[1], f, more2);
    return f;
  };
  const answerBack = (f: Msg, from: Node, label: string, captions: [string, string], sdpText?: string, more: Partial<FlowStep> = {}, more2: Partial<FlowStep> = {}) => {
    const r = w.response({ from: CORE, to: from === UE_B ? UE_B : UE_A, msg: f }, '200 OK', sdpText ? { sdp: sdpText } : {});
    w.msg(from === UE_B ? UE_B : UE_A, CORE, label, captions[0], r, more);
    w.msg(CORE, from === UE_B ? UE_A : UE_B, label, captions[1], { ...r, via: r.via.slice(1) }, more2);
  };

  if (!q) {
    const r180 = bResp('180 Ringing', {});
    w.msg(UE_B, CORE, '180 Ringing', 'UE B rings at once. No voice bearer exists yet on either side.', r180, { rfc: 'rfc3312-1-ghost', status: { ueB: 'Ringing' } });
    pass(r180, '180 Ringing', 'UE A plays a ringback tone.', { status: { ueA: 'Ringing' } });
    const r200 = bResp('200 OK', { sdp: bSdp(7100, 'none', 'none') });
    w.msg(UE_B, CORE, '200 OK', 'Bob answers. Only now do the P-CSCFs ask for the voice bearers.', r200, { status: { ueB: 'In call' } });
    pass(r200, '200 OK', 'If the radio network cannot give a bearer now, Bob has answered a call with no audio.', { status: { ueA: 'In call' } });
    bearer('ueA', 'The network sets up UE A\'s voice bearer, after the answer.', 'In call');
    bearer('ueB', 'And UE B\'s.', 'In call');
  } else {
    const r183 = bResp('183 Session Progress', { extra: ['Require: 100rel, precondition', 'RSeq: 1'], sdp: bSdp(7100, 'none', 'none') });
    w.msg(UE_B, CORE, '183 Session Progress', 'UE B answers in a reliable 183, without ringing. a=des: both sides must have QoS; a=conf asks UE A to report its side.', r183, { rfc: 'rfc3262-3-require' });
    pass(r183, '183 Session Progress', 'The answer reaches UE A. Both P-CSCFs now know the codec, and ask the PCRF for voice bearers.', { rfc: 'rfc3312-4-segmented' });
    bearer('ueA', 'The network sets up a dedicated bearer for UE A\'s voice: QCI 1, with a guaranteed bit rate.', 'Local QoS');
    bearer('ueB', 'And one for UE B. UE B now has its own QoS, but does not know about UE A\'s.', 'Local QoS');
    const prack = inDialog(UE_A, UE_B, 'PRACK', 2, { extra: ['RAck: 1 1 INVITE'] });
    const pf = through(UE_A, UE_B, prack, 'PRACK', ['UE A acknowledges the reliable 183.', 'The core forwards the PRACK.']);
    answerBack(pf, UE_B, '200 OK (PRACK)', ['UE B confirms the PRACK.', 'The core forwards the 200 OK.']);
    if (o.stall) {
      w.steps[w.steps.length - 1]!.warn = 'UE A never sends the UPDATE that a=conf asked for. UE B waits, and never rings.';
      const c = w.cancel({ from: UE_A, to: CORE, msg: inv });
      w.msg(UE_A, CORE, 'CANCEL', 'After about 30 seconds of silence, Alice gives up. Her phone shows "connecting" the whole time.', c, { at: 30, status: { ueA: 'Ended' } });
      w.msg(CORE, UE_A, '200 OK (CANCEL)', 'The core accepts the CANCEL.', w.response({ from: UE_A, to: CORE, msg: c }, '200 OK', {}));
      const c2 = w.cancel({ from: CORE, to: UE_B, msg: inv2 });
      w.msg(CORE, UE_B, 'CANCEL', 'The core cancels the INVITE to UE B.', c2);
      w.msg(UE_B, CORE, '200 OK (CANCEL)', 'UE B accepts. It never rang.', w.response({ from: CORE, to: UE_B, msg: c2 }, '200 OK', { tag: UE_B.tag }), { status: { ueB: 'Ended' } });
      const r487 = bResp('487 Request Terminated', { contact: undefined, recordRoute: undefined });
      w.msg(UE_B, CORE, '487 Request Terminated', 'UE B ends the INVITE transaction.', r487);
      w.msg(CORE, UE_B, 'ACK', 'The core acknowledges the 487.', w.ackNon2xx({ from: CORE, to: UE_B, msg: inv2 }, UE_B.tag!));
      pass(r487, '487 Request Terminated', 'The 487 reaches UE A.');
      w.msg(UE_A, CORE, 'ACK', 'UE A acknowledges.', w.ackNon2xx({ from: UE_A, to: CORE, msg: inv }, UE_B.tag!));
      return volteDone(o, w);
    }
    const upd = inDialog(UE_A, UE_B, 'UPDATE', 3, { contact: UE_A.contact, sdp: aSdp(3501, 'sendrecv') });
    const uf = through(UE_A, UE_B, upd, 'UPDATE', ['UE A has its bearer. As a=conf asked, it reports a=curr:qos local sendrecv in an UPDATE.', 'UE B learns that UE A\'s side is ready. Both segments now have QoS.'],
      { rfc: 'rfc3311-1-early' }, { status: { ueB: 'Both QoS' } });
    answerBack(uf, UE_B, '200 OK (UPDATE)', ['UE B answers: its local and remote QoS are both sendrecv. The preconditions are met.', 'UE A learns the same.'],
      bSdp(7101, 'sendrecv', 'sendrecv'), {}, { status: { ueA: 'Both QoS' } });
    const r180 = bResp('180 Ringing', {});
    w.msg(UE_B, CORE, '180 Ringing', 'Only now does UE B ring: both radio links now have a guaranteed voice path.', r180, { status: { ueB: 'Ringing' } });
    pass(r180, '180 Ringing', 'UE A plays a ringback tone.', { status: { ueA: 'Ringing' } });
    const r200 = bResp('200 OK', {});
    w.msg(UE_B, CORE, '200 OK', 'Bob answers. The SDP is already agreed, so the 200 OK has none.', r200, { status: { ueB: 'In call' } });
    pass(r200, '200 OK', 'The call is up.', { status: { ueA: 'In call' } });
  }
  const ack = inDialog(UE_A, UE_B, 'ACK', 1, {});
  through(UE_A, UE_B, ack, 'ACK', ['UE A acknowledges.', 'The core forwards the ACK.']);
  w.media(UE_A, UE_B, `RTP (${answerPt === 96 ? 'EVS' : 'AMR-WB'})`, `HD voice with ${answerPt === 96 ? 'EVS' : 'AMR-WB'}, 16 kHz, on the QCI 1 bearers.`);
  return volteDone(o, w);
}

function volteDone(o: VolteOptions, w: FlowWriter): FlowData {
  return {
    id: `volte-${volteKey(o)}`,
    title: `A VoLTE call${o.preconditions ? ', with QoS preconditions' : ', no preconditions'}${o.stall ? ': UE A never reports its QoS' : ''}`,
    lanes: [UE_A, CORE, UE_B].map(n => ({ id: n.id, label: n.label, kind: n.kind, sub: n.ip })),
    steps: w.steps,
  };
}
