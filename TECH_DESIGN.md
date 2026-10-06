# SIP Mastery: Technical Design (v1)

This document turns [COURSE_STRUCTURE.md](COURSE_STRUCTURE.md) into a buildable system. It covers the stack, the content model, the diagram kit, the build-time checks, and deployment.

## 1. Constraints

| Constraint | Source |
|---|---|
| Public, static, read-only site; no login, no server, no database | Product decision |
| English only | Product decision |
| No analytics (for now) | Product decision |
| Hosted on **GitHub Pages** | Product decision |
| **Open source**: code under MIT, course content under CC BY 4.0 | Product decision |
| One author (plus Claude as writing assistant), so content lives in the repo as files | Product decision |
| Interactive, data-driven diagrams that follow the controlled diagram language (COURSE_STRUCTURE §5) | Course design |
| RFC quotes are exact and linked | Course design |
| Visual language of `presentations/` (dark console, protocol colours, Bricolage Grotesque + Martian Mono) | Course design |

## 2. Stack

| Layer | Choice | Version (Oct 2026) |
|---|---|---|
| Runtime | Node.js | 24 (see `.nvmrc`; Astro 7 needs ≥ 22.12) |
| Site framework | Astro (static output) | 7.x |
| Content | MDX + Astro content collections (Zod schemas) | `@astrojs/mdx` 8.x |
| Interactive islands | React + TypeScript | React 19, TS 6 |
| Diagrams | Custom SVG renderer (ported from `presentations/`) | in repo |
| Data files | YAML (`yaml` package) | 2.x |
| Styling | Plain CSS + design tokens | in repo |
| Fonts | Self-hosted via Fontsource (Bricolage Grotesque variable, Martian Mono) | – |
| Search | Pagefind (static index, runs in the browser) | 1.x (added in Phase 1 polish) |
| Hashing (digest calculator) | Web Crypto (SHA-256) + `spark-md5` (MD5) | – |
| Tests | Vitest (logic), Playwright + axe (visual and accessibility) | Playwright added with CI |
| CI / deploy | GitHub Actions → GitHub Pages | – |

**Why not TypeScript 7?** `@astrojs/check` supports TS 5–6 only. We stay on TS 6 until it supports TS 7.

## 3. Repository layout

```
sip-course/
├─ astro.config.mjs
├─ src/
│  ├─ content.config.ts          # schema for the modules (MDX) collection
│  ├─ content/
│  │  ├─ modules/                # 13-digest-authentication.mdx …
│  │  ├─ flows/                  # register-401.yaml, invite-407.yaml …
│  │  ├─ glossary.yaml           # controlled vocabulary
│  │  ├─ headers.yaml            # header reference used by the inspector
│  │  └─ rfc-quotes.yaml         # quote id → rfc, section, title, text
│  ├─ lib/                       # build-time only: data.ts (YAML loaders), bundle.ts (island props), outline.ts
│  ├─ sip/                       # pure TypeScript, no DOM: runs in browser AND at build time
│  │  ├─ parse.ts                # SIP + SDP message parser
│  │  ├─ flow.ts                 # flow types, loading, placeholder expansion
│  │  ├─ lint-flow.ts            # protocol rules (RFC 3261 checks)
│  │  ├─ lint-diagram.ts         # controlled diagram language rules (§5)
│  │  ├─ registrar.ts            # RFC 3261 §10.3 registrar, Path, Outbound, GRUU (Module 12)
│  │  ├─ expiry.ts               # registration expiry vs NAT mapping timeline (Module 12)
│  │  ├─ attacks.ts              # attacks and the defences that close them (Module 14)
│  │  ├─ cert.ts                 # RFC 5922 §7 server certificate check (Module 14)
│  │  ├─ sdp.ts                  # SDP parser and linter, RFC 3264 offer/answer, hold (Module 15)
│  │  ├─ sipgen.ts               # building blocks for the generators: the network, messages as data, dialogs
│  │  ├─ callflow.ts             # basic calls of RFC 3665, with "what if" options and call forwarding (Modules 21, 22)
│  │  ├─ reinvite.ts             # hold, resume, codec, video, address, session refresh; re-INVITE or UPDATE; glare (Module 22)
│  │  ├─ transfer.ts             # blind and attended transfer: REFER, NOTIFY with sipfrag, Replaces (Module 22)
│  │  ├─ events.ts               # SUBSCRIBE/NOTIFY for presence (with PUBLISH), dialog, message-summary, reg (Module 23)
│  │  ├─ trunk.ts                # a PBX calls the PSTN through a carrier SBC and gateway: ISUP, Q.850, caller ID (Module 24)
│  │  ├─ numbers.ts              # number normalisation to E.164, tel URI, user=phone (Module 24)
│  │  ├─ elements.ts             # the same call through a proxy and a B2BUA, paired message by message (Module 25)
│  │  ├─ sbc.ts                  # SBC functions on one INVITE: topology hiding, normalisation, media, transcoding, security, CAC (Module 25)
│  │  ├─ balance.ts              # a load balancer with OPTIONS health checks and failover (Module 25)
│  │  ├─ webrtc.ts               # a browser calls a SIP phone through a WebRTC gateway; WebRTC SDP; gateway layers (Module 26)
│  │  ├─ ims.ts                  # IMS core map, IMS registration (AKA, IPsec, Service-Route), VoLTE with preconditions (Module 27)
│  │  ├─ stir.ts                 # PASSporT and the Identity header: canonical JSON, ES256 with Web Crypto, verifier checks (Module 28)
│  │  ├─ stir-data.ts            # GENERATED by `npm run gen:stir`: an example key pair and the signed PASSporTs
│  │  ├─ stir-flow.ts            # signing, transit, and verification of a call, with attestation and failures (Module 28)
│  │  ├─ generators.ts           # the generators and their options, for the FlowBuilder island
│  │  └─ digest.ts               # HA1 / HA2 / response
│  ├─ net/                       # below SIP: addresses, packets, RTP
│  │  ├─ address.ts              # address classes (Module 2)
│  │  ├─ packet.ts               # Ethernet / IPv4 / UDP frame builder (Module 2)
│  │  ├─ rtp.ts                  # RTP header, telephone-event, bandwidth, jitter buffer (Module 16)
│  │  ├─ rtcp.ts                 # RTCP SR/RR/SDES/BYE, round-trip time, E-model (Module 17)
│  │  ├─ srtp.ts                 # SRTP key derivation, AES-CM, HMAC-SHA1 (WebCrypto); a=crypto, a=setup (Module 18)
│  │  ├─ transport.ts            # IP fragments, TCP segments, the 1300-byte rule, UDP vs TCP race (Module 19)
│  │  ├─ nat.ts                  # NAT routers with RFC 4787 mapping and filtering, hosts, TURN relays (Module 20)
│  │  ├─ nat-call.ts             # the NAT simulator: a call with rport, Contact rewriting, and media fixes (Module 20)
│  │  ├─ ice.ts                  # ICE candidates, priorities, pairs, connectivity checks (Module 20)
│  │  ├─ stun.ts                 # STUN messages: XOR-MAPPED-ADDRESS, MESSAGE-INTEGRITY, FINGERPRINT (Module 20)
│  │  └─ bits.ts                 # field type for the bit-map diagrams (src/diagrams/BitMap.tsx)
│  ├─ diagrams/                  # React islands
│  │  ├─ Ladder.tsx              # call-flow ladder, step player
│  │  ├─ Inspector.tsx           # message inspector with explanations + diff
│  │  ├─ FlowStage.tsx           # Ladder + Inspector + player + caption
│  │  ├─ BrokenFixed.tsx         # toggles between two flows
│  │  ├─ ScrollyFlow.tsx         # pinned diagram driven by scrolling text
│  │  └─ DigestCalculator.tsx
│  ├─ components/                # Astro (static) components
│  │  ├─ RfcQuote.astro
│  │  ├─ Term.astro              # glossary term with hover definition
│  │  ├─ Mistake.astro
│  │  └─ ModuleHeader.astro …
│  ├─ layouts/
│  ├─ pages/                     # also flow-builder.json: quotes and header notes shared by every flow builder
│  └─ styles/tokens.css, base.css, diagram.css
├─ scripts/
│  ├─ check-content.ts           # runs both linters over every flow, and every combination of every generator
│  └─ verify-rfc-quotes.ts       # verifies quotes against rfc-editor.org text
├─ tests/                        # Vitest
├─ presentations/                # original decks (design reference)
├─ COURSE_STRUCTURE.md
└─ TECH_DESIGN.md
```

## 4. Content model

**Loading.** Modules (MDX) are an Astro content collection with a Zod schema. Flows, quotes, the glossary, and the header reference are YAML files read by `src/lib/data.ts`. This lets the same loader run inside Astro pages **and** in the plain Node scripts (`check-content`, `verify-rfc-quotes`), which cannot use `astro:content`. Islands never read files: Astro passes them prepared data as props.

### 4.1 Modules (MDX)
One MDX file per module. The frontmatter is validated:

```yaml
---
module: 13
title: Digest authentication
part: 4
level: [intermediate, advanced]
paths: { noc: core, dev: core }
objectives:
  - Explain why the password never travels in SIP digest authentication.
summary: How SIP proves who you are with 401 and 407 challenges.
---
```

The body is Markdown with components:

```mdx
<FlowStage client:visible flow="invite-407" />
<RfcQuote id="rfc3261-17.1.1.3-ack-address" />
<Mistake title="No ACK for the 407">
  <BrokenFixed client:visible broken="invite-407-no-ack" fixed="invite-407" />
</Mistake>
```

### 4.2 Flows (YAML)
A flow is the single source for a ladder diagram, the inspector, step captions, and the checks.

```yaml
id: invite-407
title: INVITE with a 407 challenge
lanes:
  - { id: alice, label: Alice, kind: ua }
  - { id: proxyA, label: Proxy A, kind: proxy }
  - { id: bob, label: Bob, kind: ua }
steps:
  - from: alice
    to: proxyA
    proto: sip            # colour key from the protocol map
    label: INVITE
    caption: Alice sends an INVITE. It has no credentials.
    rfc: rfc3261-22.3     # optional quote id shown in the inspector
    message: |
      INVITE sip:bob@biloxi.example SIP/2.0
      Via: SIP/2.0/UDP 192.0.2.10:5060;branch=z9hG4bK74bf9
      …
      Content-Length: {auto}
```

Rules:
- Messages are written as they appear on the wire. The loader converts line endings to CRLF.
- `Content-Length: {auto}` is replaced with the real byte length of the body. A literal number is kept as is (needed for "wrong Content-Length" examples).
- `response="{digest}"` is replaced with the real digest response, calculated from the header's own parameters and the flow's example `credentials`. `{digest:INVITE}` uses another method (an ACK copies the INVITE credentials, RFC 3261 §22.1). So every digest in the course is correct by construction.
- `broken: true` marks a deliberately wrong flow. It must list the rule IDs it breaks in `breaks: [...]`. The build fails if a broken flow does **not** break those rules, or if it breaks any rule it doesn't list.
- Non-message steps (`kind: note`, `kind: timer`, `kind: media`) are supported for timers and RTP.
- `at: 900` on a step gives its time in seconds since the start of the flow, where time matters (registration). Later steps without `at` keep that time.
- `trust: [proxyA, alice]` lists the lanes in the trust domain and turns on the `pai-trust` check.
- Every SDP body is checked (`src/sip/sdp.ts`): `sdp-syntax` (RFC 8866), `sdp-version` and `sdp-mlines` (RFC 3264 §8), `answer-codec` and `answer-direction` (RFC 3264 §6.1), and `sdp-private-address` (a private `c=` address that reaches a user agent with a public address). Offers and answers are tracked on each hop, following RFC 3261 §13.2.1 and RFC 3262 §5; a rejected offer restores the previous SDP. `oneway: true` on a media step draws one arrowhead.
- `registrar: { lane: registrar, maxExpires: 600, lookup: [proxyB] }` marks a registration flow. The `registrar-model` rule runs the registrar model (`src/sip/registrar.ts`) over its REGISTER requests, with that policy, and checks every response of the registrar and every location-service lookup of the `lookup` lanes.

### 4.3 RFC quotes (YAML)
```yaml
- id: rfc3261-17.1.1.3-ack-address
  rfc: 3261
  section: 17.1.1.3
  title: Construction of the ACK Request
  text: >-
    The ACK MUST be sent to the same address, port, and transport to which
    the original request was sent.
```
The component builds the link `https://www.rfc-editor.org/rfc/rfc3261#section-17.1.1.3` and highlights RFC 2119 keywords.

A few older RFCs, such as RFC 2782, have headings without numbers. For them, `section` is the heading text (`section: The format of the SRV RR`); the quote shows as "RFC 2782 · The format of the SRV RR" and links to the whole RFC (`src/lib/rfc-ref.ts`).

### 4.4 Glossary and header reference (YAML)
- `glossary.yaml` is the controlled vocabulary. Every lane label and diagram term must exist here.
- `headers.yaml` gives the inspector a short explanation, the RFC section, and the "who adds / who changes" data for each header.

## 5. Diagram kit

All diagrams are React islands that render SVG. They share one design-token file and one protocol colour map.

| Component | Phase | Notes |
|---|---|---|
| `Ladder` | 1 | Lanes, arrows, step highlight, dim non-current steps, draw-in animation |
| `Inspector` | 1 | Raw message; hover/click a line for its meaning and RFC link; diff with the previous message on the same transaction |
| `FlowStage` | 1 | Ladder + Inspector + player (⏮ ⏭ ▶ ↺) + caption; keyboard operable |
| `BrokenFixed` | 1 | One switch between two flows; the steps that differ are marked |
| `ScrollyFlow` | 1 | Pinned FlowStage; each text step scrolls the diagram to a flow step (IntersectionObserver) |
| `DigestCalculator` | 1 | Live HA1/HA2/response for MD5 and SHA-256 |
| `Topology` | 2 | Port of `graph()` + packet animation from `scaled-architecture.html` |
| `HeroLadder` | 1 | Home page: the INVITE flow plays itself in a loop |
| `StateMachine`, `Timeline`, `BitMap` | 2–3 | |
| `TraceViewer`, `DecisionTree` | 3 | |

Rendering choices:
- SVG with a `viewBox`, so diagrams scale. Text uses Martian Mono.
- Initial HTML is rendered on the server by Astro, so a diagram is readable before JavaScript loads and with JavaScript off.
- Islands hydrate with `client:visible`, so off-screen diagrams cost nothing.
- **Width.** Lesson text stays in a centred 72ch column; diagrams break out of it (up to `--wide-max`, 1800px). A ladder never scales past `--ladder-scale` (115%) of its natural size, so on wide screens the extra width goes to the inspector (up to `--insp-max`, 600px). Each stage is only as wide as that combination needs.
- **Expand.** Every stage has an Expand button: full screen, ladder up to 145%, inspector up to 760px, Esc closes and focus returns to the button.
- Animation uses CSS transitions. `prefers-reduced-motion` turns off movement but keeps stepping.

## 6. Build-time checks

`npm run check:content` runs before every build and in CI. Any error fails the build.

### 6.1 Protocol checks (`lint-flow.ts`)
| Rule ID | Check |
|---|---|
| `parse` | The message parses: start line, headers, empty line |
| `mandatory-headers` | Requests have Via, From, To, Call-ID, CSeq, Max-Forwards; INVITE has Contact |
| `cseq-method` | CSeq method equals the request method |
| `branch-cookie` | Via branch starts with `z9hG4bK` |
| `content-length` | Content-Length equals the body length in bytes |
| `ack-non2xx-branch` | ACK for a non-2xx response has the INVITE's branch and CSeq number |
| `ack-2xx-branch` | ACK for a 2xx response has a new branch |
| `auth-retry` | A retry after 401/407 has CSeq + 1, the same Call-ID and From-tag, a new branch, and Authorization/Proxy-Authorization |
| `invite-final-ack` | Every final response to an INVITE is ACKed: a 300–699 on its own hop; a 2xx end to end (the receiving UA sends an ACK, and an ACK reaches the sending UA) |
| `dialog-tags` | In-dialog requests (and the ACK for a 2xx) use the From/To tags of an established dialog |
| `cancel-after-final` | No CANCEL after the INVITE has a final response on that hop (RFC 3261 §9.1) |
| `dialog-target` | A UA sends each request inside a dialog to the remote target, with the route set as Route (RFC 3261 §12.2.1.1); if the first route has no `lr`, the request uses strict routing. Dialog state comes from `src/sip/dialog.ts`, the request format from `src/sip/routing.ts`. |
| `record-route-lr` | Every Record-Route URI in a request has the `lr` parameter (RFC 3261 §16.6 item 4) |
| `response-via` | A response carries the Via headers (sent-by and branch) of its request on the same hop, in the same order (RFC 3261 §8.2.6.2, §16.7) |
| `max-forwards` | A proxy forwards a request with Max-Forwards one lower than it arrived with (RFC 3261 §16.6 item 3) |
| `register-uri` | The Request-URI of a REGISTER has no user part (RFC 3261 §10.2) |
| `register-star` | `Contact: *` is the only Contact value and comes with `Expires: 0` (RFC 3261 §10.2.2) |
| `min-expires` | A 423 Interval Too Brief carries Min-Expires (RFC 3261 §10.3 step 7) |
| `register-refresh` | A UA refreshes a binding before the expiry that the last 2xx granted it; needs `at` on the steps (RFC 3261 §10.2.4) |
| `registrar-model` | In a flow with `registrar:`, each registrar response has the status, Contact list (with expires, q, and GRUUs), Path, and Service-Route of the registrar model, and a proxy that looks up the AOR forwards to a registered Contact with the stored Path as Route, or answers with an error when there is none (RFC 3261 §10.3, RFC 3327, RFC 3608, RFC 5626 §6, RFC 5627 §5) |
| `pai-trust` | In a flow with `trust: [...]`, a lane in the trust domain does not forward a P-Asserted-Identity that it received from a lane outside it (RFC 3325 §5) |
| `user-enumeration` | Security practice, not an RFC rule (Module 14): a server does not answer 404 to an unauthenticated request for one user and 401/407 for another |
| `sdp-syntax` | Every SDP body is valid: line order, required lines, `c=` for every stream, an `rtpmap` for every dynamic payload type (RFC 8866 §5, RFC 3551 §3) |
| `sdp-version` | A changed SDP from the same side has the next `o=` version; an unchanged version means an unchanged SDP (RFC 3264 §8) |
| `sdp-mlines` | The answer has the m= lines of the offer, in the same order and of the same types; a new SDP never has fewer m= lines (RFC 3264 §6, §8) |
| `answer-codec` | An accepted stream in the answer has at least one codec from the offer (RFC 3264 §6.1) |
| `answer-direction` | The direction in the answer is one that the offered direction allows: sendonly → recvonly or inactive, and so on (RFC 3264 §6.1) |
| `sdp-private-address` | A private `c=` address does not reach a user agent with a public address (RFC 6314 §3) |
| `sdes-over-tls` | An SDP with an SDES key (`a=crypto` with `inline:`) travels only on a TLS (or WSS) hop, from the top Via (RFC 4568 §8.3) |
| `udp-size` | A request over 1300 bytes is not sent over UDP (top Via), at any hop (RFC 3261 §18.1.1) |
| `sip-alg` | A message that leaves a NAT lane is the message that entered it: a NAT router rewrites IP and UDP headers, not SIP (RFC 4787 §7, RFC 6314 §3) |
| `replaces-match` | The Replaces header of an INVITE names a dialog of the receiver: to-tag is the receiver's own tag; an early dialog only at the UA that created it (RFC 3891 §3) |
| `prack-rack` | A PRACK's RAck holds the RSeq, CSeq number, and method of a reliable provisional response on its hop (RFC 3262 §7.2) |
| `notify-headers` | A NOTIFY has Event and Subscription-State; its Event matches the SUBSCRIBE; after an accepted unsubscribe, the next NOTIFY is terminated (RFC 6665) |
| `subscribe-expires` | A 2xx to SUBSCRIBE has Expires, no longer than the request asked (RFC 6665 §3.1.1) |
| `notify-early` | A subscriber does not answer 481 to a NOTIFY for a subscription it asked for, even before the 200 OK (RFC 6665 §4.1.2.4) |
| `late-offer-ack` | When the INVITE has no SDP, the 2xx carries the offer, and the ACK for it carries the answer (RFC 3261 §13.2.2.4, RFC 3264 §4) |
| `dtls-setup` | A DTLS-SRTP offer says `a=setup:actpass`; the answer says `active` or `passive`, the opposite of a fixed role in the offer (RFC 8842 §5.2, RFC 4145 §4.1) |

### 6.2 Diagram language checks (`lint-diagram.ts`)
| Rule ID | Check |
|---|---|
| `label-words` | Arrow label ≤ 5 words |
| `label-start` | Arrow label starts with a SIP method, a status code, or a glossary term |
| `lane-ref` | Every step uses lanes that exist |
| `caption-words` | Each caption sentence ≤ 20 words; at most 2 sentences |
| `caption-passive` | Warning: possible passive voice ("is added", "was sent") |
| `lane-count` | ≤ 7 lanes |
| `lane-glossary` | Each lane label is a glossary term |
| `proto-color` | `proto` is a key in the protocol colour map |

### 6.3 RFC quote verification (`verify-rfc-quotes.ts`)
- Downloads each cited RFC as plain text from `https://www.rfc-editor.org/rfc/rfcNNNN.txt` once, and caches it in `.cache/rfc/` (CI uses `actions/cache`).
- Removes page headers and footers, finds the cited section, normalises whitespace, and checks that the quote appears word for word in that section. A section without a number runs from its heading line to the next line at column 0.
- Fails on a missing section or a quote that doesn't match.

## 7. Deployment

- GitHub Actions workflow: install → content checks → tests → `astro build` → Pagefind index → upload to Pages.
- `astro.config.mjs` reads `SITE` and `BASE` from the environment. The site uses the custom domain https://sip.nanthakumar.com/ with `BASE=/`, set in the workflow. Without the custom domain, the project page needs `BASE=/sip-mastery`.
- Every internal link uses the base-aware helper, so moving to a custom domain doesn't break links.

## 8. Licences

- Code: **MIT** (`LICENSE`)
- Course text and diagrams: **CC BY 4.0** (`LICENSE-CONTENT`)
- RFC excerpts: quoted under the IETF Trust Legal Provisions (BCP 78), with attribution and a link on every quote.
- Fonts: SIL Open Font License (Bricolage Grotesque, Martian Mono).

## 9. Accessibility and performance targets

- WCAG 2.2 AA contrast with the dark palette (checked with axe in CI).
- Every diagram is keyboard operable: ←/→ steps, Space plays, Enter on a message opens it in the inspector.
- Colour never carries meaning alone (line style, icon, or label as well).
- Each diagram has a text alternative: the step list is in the HTML as an ordered list.
- Lighthouse performance ≥ 95 on a lesson page. JavaScript only for islands in view.

## 10. Phase 1 deliverable: the Module 13 prototype

Status: built. Pagefind search, Playwright visual tests, and axe checks are still to do.


- Site shell: header, course navigation, module page layout, design tokens, fonts
- Content collections with schemas for modules, flows, quotes, glossary, headers
- SIP parser, both linters, digest functions, with tests
- Diagram kit Phase 1: `Ladder`, `Inspector`, `FlowStage`, `BrokenFixed`, `ScrollyFlow`, `DigestCalculator`
- Module 13 written in full as the reference lesson
- GitHub Pages workflow
