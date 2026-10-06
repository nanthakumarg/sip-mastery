# SIP Mastery

A free, open, interactive course on the Session Initiation Protocol (SIP), for support/NOC engineers and developers. Every concept is a call flow you can step through message by message, with the exact RFC sentence that defines it.

- **Course plan:** [COURSE_STRUCTURE.md](COURSE_STRUCTURE.md)
- **Technical design:** [TECH_DESIGN.md](TECH_DESIGN.md)
- **Status:** Module 13 (Digest authentication) is the reference lesson. The other modules follow.

## Run it

Needs Node.js 24 (see `.nvmrc`).

```bash
nvm use
npm install
npm run dev        # http://localhost:4321
```

| Command | What it does |
|---|---|
| `npm run dev` | Development server with hot reload |
| `npm run build` | Content checks, then the static site in `dist/` |
| `npm run check:content` | Protocol checks and diagram language checks on every flow, and on every call flow generator combination |
| `npm run verify:rfc` | Checks every RFC quote word for word against rfc-editor.org |
| `npm run sync:rfc-index` | Refreshes `rfc-index.json` (titles, dates, status, obsoletes/updates) from the official RFC index, for the RFCs in `rfcs.yaml` |
| `npm test` | Unit tests (parser, checks, digest maths, transaction timers, dialog state, routing, DNS, registrar, security, SDP and offer/answer, RTP, RTCP, SRTP, transports, NAT, STUN, ICE, and the call flow generator) |
| `npm run verify` | `check:content`, `verify:rfc`, and `test` together |
| `npm run check` | TypeScript and Astro type check |

## Writing content

All course content lives in `src/content/`.

| File | Holds |
|---|---|
| `modules/NN-slug.mdx` | One lesson. Frontmatter is validated (see `src/content.config.ts`). |
| `flows/*.yaml` | Call flows: lanes, steps, captions, and raw SIP messages |
| `rfc-quotes.yaml` | Exact RFC quotes, referenced by id |
| `rfcs.yaml` | The RFCs on the RFC map: area, summary, and modules. Run `npm run sync:rfc-index` after editing. |
| `rfc-index.json` | Generated from the official RFC index. Do not edit by hand. |
| `glossary.yaml` | The controlled vocabulary. Lane labels and diagram labels must use these terms. |
| `headers.yaml` | Explanations for the message inspector |
| `header-reference.yaml` | The header reference: group, and who adds, changes, and removes each header (meanings come from headers.yaml) |
| `codes.yaml` | The response code atlas: meaning, causes, origin, and Q.850 causes for each code (phrases follow IANA) |
| `methods.yaml` | The method cards: facts and a short ladder for each SIP method (checked like a flow) |
| `elements.yaml` | The element gallery cards: each points at a flow and the steps the element receives and sends |

### Components available in MDX (no import needed)

```mdx
<Flow id="register-401" />                                     full stage: ladder + inspector + player
<Scrolly flow="invite-407"> <Step n={1}>…</Step> </Scrolly>      text scrolls past a pinned ladder
<BrokenFixedFlow broken="invite-407-no-ack" fixed="invite-407-ack" />
<Digest flow="invite-407" step={4} />                          calculator pre-filled from a flow step
<RfcQuote id="rfc3261-22.2-cseq-increment" />
<Term t="nonce" />                                             glossary hover definition
<Note kind="tip|warn|note">…</Note>
<Mistakes><Mistake title="…">…</Mistake></Mistakes>
<Stats><Stat value="407" label="…" /></Stats>
<CompareFlows a="udp-options" b="tcp-options" labels={['UDP', 'TCP']} />   two flows behind a switch
<ElementGallery initial="stateful" />                         one card per SIP element (elements.yaml)
<HeaderReference initial="Via" />  <HeaderJourney flow="header-journey" />  <CodeAtlas initial={486} />  <MethodCards initial="INVITE" />  <CapabilityLab />  <MessageAnatomy />  <FramingLab />  <UriDissector mode="header" />
<UriDissector />  <LocationService />  <AddressClassifier />  <NatRewrite />  <PacketExplorer flow="…" step={1} />
<TransactionPlayer />  <TimerTimeline />  <TransactionMatcher />                transaction state machines, timers, matching (src/sip/transaction.ts)
<DialogTable flow="dialog-call" />  <ForkingTree flows={['fork-one-answers', 'fork-two-answer']} labels={[…]} />   dialog state per UA (src/sip/dialog.ts)
<RoutingLab />  <ViaStack flow="via-stack" />                                    Record-Route paths and the Via stack (src/sip/routing.ts)
<DnsResolver />                                                                 NAPTR, SRV, A lookups and failover (src/sip/dns.ts)
<RegistrarView flow="register-lifecycle" />  <RegistrarView flows="a,b" labels="A|B" />   bindings step by step (src/sip/registrar.ts)
<ExpiryClock initial={{ asked: 3600, natTimeout: 60 }} />                      registration expiry vs NAT mapping (src/sip/expiry.ts)
<AttackMap />  <CertCheck />                                                   attacks and defences; RFC 5922 certificate check (src/sip/attacks.ts, cert.ts)
<SdpLinter />  <OfferAnswer />  <HoldPlayer />                                 SDP lines, offer/answer, hold and resume (src/sip/sdp.ts)
<RtpHeader />  <JitterBuffer />  <BandwidthCalc />                            RTP header bits, jitter buffer, bandwidth per layer (src/net/rtp.ts)
<RtcpExplorer />  <RttTimeline />  <MosCalc />                               RTCP reports, round-trip time, R-factor and MOS (src/net/rtcp.ts)
<SrtpPacket />  <KeyExchange />                                               SRTP with real AES/HMAC; where the keys travel (src/net/srtp.ts)
<TransportRace />                                                              one message over UDP (fragments) and TCP (src/net/transport.ts)
<NatSimulator />  <IceChecker />                                              a call through two NAT routers; ICE candidates and checks (src/net/nat.ts, nat-call.ts, ice.ts)
<CallBuilder preset={{ path: 'two-proxies', outcome: 'busy' }} />             the call flow builder: any basic call, with "what if" options (src/sip/callflow.ts)
```

### Flow file rules

- Write messages as they appear on the wire. The loader converts them to CRLF.
- `Content-Length: {auto}` becomes the real body length in bytes.
- `response="{digest}"` becomes the real digest response, calculated from the header's parameters and the flow's `credentials`. `{digest:INVITE}` calculates it for another method (an ACK copies the INVITE credentials).
- `at:` gives a step's time in seconds, and `registrar: { lane: … }` checks a registration flow against the registrar model. `trust: [lanes]` marks the trust domain for the P-Asserted-Identity check. A `kind: media` step with `oneway: true` is drawn with one arrowhead (hold, early media).
- A flow with `broken: true` must list the rules it breaks in `breaks: [...]`. The build fails if it breaks other rules, or does not break the listed ones.
- Captions: at most 2 sentences of 20 words each, active voice. Labels: at most 5 words, starting with a method, a status code, or a glossary term.

## Deploy

Live site: https://sip.nanthakumar.com/

GitHub Actions builds and deploys to GitHub Pages on every push to `main` (`.github/workflows/deploy.yml`).

1. Push the repository to GitHub (`https://github.com/nanthakumarg/sip-mastery`).
2. In **Settings → Pages**, set **Source** to **GitHub Actions**.
3. In **Settings → Pages → Custom domain**, enter `sip.nanthakumar.com`, then tick **Enforce HTTPS**. DNS: a `CNAME` record from `sip` to `nanthakumarg.github.io`.
4. Push to `main`. The workflow builds for `https://sip.nanthakumar.com` with base path `/`.

## Licences

- Code: [MIT](LICENSE)
- Course text, flows, and diagrams: [CC BY 4.0](LICENSE-CONTENT)
- RFC excerpts: IETF Trust Legal Provisions (BCP 78), quoted with a link to each section
