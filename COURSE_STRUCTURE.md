# SIP Mastery: Course Structure (Draft v2)

A free, public, read-only web course. It takes support/NOC engineers and developers from "what is SIP?" to finding the cause of NAT, routing, auth, and media faults in real call flows.

**Changes from v1**
- Audience is now support/NOC engineers and developers. The architect path is gone.
- Everything is conceptual and runs in the browser. There are no labs with real software.
- IMS/VoLTE, STIR/SHAKEN, and WebRTC are core modules. T.38 fax is removed.
- There are no quizzes, accounts, progress tracking, or certificates. The course teaches with interactive diagrams.
- Every lesson quotes and links the RFC sections it relies on.
- The visual design follows the two decks in `presentations/`.
- Diagrams follow a "visual ASD-STE100" rule set: about 80% of the way to strict Simplified Technical English, applied to labels, symbols, and steps (see §5).

---

## 1. Course principles

| Principle | What it means in practice |
|---|---|
| **One call, many zoom levels** | Module 0 shows one complete call. Every later module zooms into a part of that same call. |
| **One cast, one topology** | Alice, Bob, Proxy A, Proxy B, the Registrar, the SBC, a home NAT router, and a carrier gateway appear in every example. They use the RFC 3665 / RFC 3261 example domains (`atlanta.example`, `biloxi.example`). |
| **Diagrams teach, prose explains** | Each concept starts with a diagram the reader can play with. The text explains what the diagram shows. |
| **Colour names the protocol** | The colour of a line always tells the reader which protocol is on the wire (see §4). |
| **The RFC is the authority** | Each important rule shows the exact RFC sentence, with a link to the section. |
| **Every mistake is shown, not just listed** | Each common mistake has a "Broken / Fixed" toggle on a diagram. |
| **Diagrams speak a controlled language** | One symbol has one meaning, labels use glossary terms only, and each step changes one thing (see §5). |

---

## 2. Audience and reading paths

Both paths use the same pages. A path only changes the order and which lessons it marks "core" or "optional".

| | 🛠 Support / NOC path | 💻 Developer path |
|---|---|---|
| Goal | Read a trace and find the fault fast | Build or debug SIP software that follows the RFCs |
| Focus | Symptoms → causes, header meaning, call flows, NAT, media faults | State machines, matching rules, message construction, timers |
| Core modules | 0, 2–7, 10, 12–13, 15–16, 19–24, 30–32 | 0–29 (all), then 31–32 |
| Diagram emphasis | Trace viewer, broken/fixed toggles, symptom map | Transaction and dialog state machines, step-by-step header changes |

Each module page shows a badge: `NOC core`, `DEV core`, or `optional for this path`.

---

## 3. Course map

**Levels:** 🟢 Basic · 🟡 Intermediate · 🔴 Advanced

| Part | Theme | Modules | Level |
|---|---|---|---|
| 0 | Orientation | 0 | 🟢 |
| 1 | Foundations | 1–2 | 🟢 |
| 2 | The SIP language | 3–7 | 🟢→🟡 |
| 3 | SIP mechanics | 8–11 | 🟡→🔴 |
| 4 | Registration, authentication, security | 12–14 | 🟡→🔴 |
| 5 | Media: SDP, RTP, RTCP, SRTP | 15–18 | 🟡→🔴 |
| 6 | Transports: UDP, TCP, TLS, WebSocket | 19 | 🟡→🔴 |
| 7 | NAT traversal | 20 | 🔴 |
| 8 | Call flow library | 21–24 | 🟡→🔴 |
| 9 | SIP in the real world: SBCs, WebRTC, IMS/VoLTE, STIR/SHAKEN, quality | 25–29 | 🔴 |
| 10 | Troubleshooting | 30–31 | 🔴 |
| 11 | Case files | 32 | 🔴 |

### Module page template
Every module uses the same layout:
1. **Header:** title, level, path badges, "you are here" mini-map of the Module 0 call
2. **Objectives:** 3–5 "After this module, you can…" statements
3. **Lessons:** prose, interactive diagrams, and RFC quote blocks
4. **Common mistakes:** each one is a Broken/Fixed diagram toggle
5. **RFC references:** the sections quoted in the module, with links
6. **Key terms:** links to the glossary

---

## Part 0: Orientation

### Module 0: Anatomy of one phone call 🟢
**Objectives:** Name the main elements of a SIP call. Tell signaling from media. Follow one call from registration to hang-up.

- 0.1 Alice calls Bob: the full story in 60 seconds
- 0.2 Two paths: signaling (SIP) and media (RTP)
- 0.3 The protocol family: SIP, SDP, RTP, RTCP, SRTP, and the transports below them
- 0.4 How to read this course: colours, diagram controls, RFC blocks

**Diagrams**
- 🎞 **Hero call player:** the whole topology with packets moving through it: REGISTER → 401 → REGISTER → INVITE → 407 → INVITE → 100/180/200 → ACK → RTP both ways → BYE → 200. A play/pause/step control and a speed control. Each later module links back to its part of this call.
- 🗺 **Course mini-map:** the same call, with each part labelled with the module that explains it.

---

## Part 1: Foundations

### Module 1: VoIP and where SIP fits 🟢
- 1.1 From PSTN circuits to IP packets
- 1.2 Signaling protocols side by side: SIP, H.323, MGCP, ISUP (overview only)
- 1.3 SIP's design: text-based, HTTP-like, request/response, end-to-end
- 1.4 The RFC family: RFC 3261 and the RFCs that extend it
- 1.5 Where SIP runs today: PBXs, SIP trunks, mobile networks (IMS/VoLTE), browsers (WebRTC), UC platforms

**Diagrams:** 🧭 *RFC map*, an interactive graph of RFCs: click an RFC to see what it updates and which module covers it. 📊 *Stack view*: click each layer to see which protocol lives there.

**Common mistakes**
- "SIP carries the voice." It does not. SIP sets up, changes, and ends sessions. RTP carries the media.
- Learning from RFC 2543 examples. Many old guides show behaviour that RFC 3261 replaced.

### Module 2: Networking for SIP 🟢
- 2.1 IP addresses, ports, and sockets; public and private ranges
- 2.2 UDP and TCP: the short version (full detail in Module 19)
- 2.3 DNS: A and AAAA records (SRV and NAPTR are in Module 11)
- 2.4 What NAT does to a packet (full detail in Module 20)
- 2.5 How a packet capture shows the layers

**Diagrams:** 📦 *Packet layer explorer*: click Ethernet, IP, UDP, and SIP in one captured packet to expand each layer. 🔁 *NAT rewrite preview*: one packet passes a NAT router and the source address changes.

**Common mistakes**
- Thinking the source port of a request is the port the device listens on. With UDP and NAT, this is often false.
- Capturing only port 5060 and missing SIP on other ports or over TLS.

---

## Part 2: The SIP language

### Module 3: SIP elements and addresses 🟢
- 3.1 User agents: UAC and UAS (one device can be both)
- 3.2 Proxies: stateless, transaction-stateful, dialog-stateful
- 3.3 Registrar, location service, redirect server
- 3.4 B2BUA: two user agents back to back
- 3.5 SBC: a B2BUA at the network edge
- 3.6 SIP URIs: `sip:`, `sips:`, `tel:`; user, host, port, parameters
- 3.7 Address of Record (AOR) and Contact address

**Diagrams:** 🧩 *Element gallery*: one card per element showing what it may and may not change in a message. 🔍 *URI dissector*: type a URI and see each part labelled.

**Common mistakes**
- Calling Asterisk or FreeSWITCH a "proxy". They are B2BUAs, and B2BUAs change headers that proxies keep.
- Confusing the AOR (`sip:alice@atlanta.example`) with the Contact (`sip:alice@192.0.2.10:5060`).
- Thinking `sips:` protects only the first hop. It requires TLS on every hop.

**RFC sections:** RFC 3261 §6 (Definitions), §19.1 (SIP and SIPS URIs); RFC 3966 (tel URI)

### Module 4: Anatomy of a SIP message 🟢
- 4.1 Request line and status line
- 4.2 Headers: names, values, multiple values
- 4.3 Compact header forms (`v`, `f`, `t`, `i`, `m`, `l`, `c`, `k`, `s`)
- 4.4 The empty line and the body
- 4.5 Content-Length, Content-Type, and multipart bodies
- 4.6 Case rules: which parts are case-insensitive
- 4.7 Header parameters and URI parameters (the angle-bracket rule)

**Diagrams:** 🔬 *Message inspector*: a full INVITE where you point at a line to see what it means and which RFC section defines it. 🧱 *Message layers*: the start line, headers, empty line, and body separate and join with an animation.

**Common mistakes**
- A wrong Content-Length after a body is changed.
- LF line endings instead of CRLF.
- No angle brackets: `Contact: sip:a@b;expires=60` puts `expires` on the URI, not on the header.

**RFC sections:** RFC 3261 §7 (SIP Messages), §7.3.3 (Compact Form), §7.5 (Framing SIP Messages), §20.10 (Contact)

### Module 5: SIP methods 🟢→🟡
- 5.1 Core methods: INVITE, ACK, BYE, CANCEL, REGISTER, OPTIONS
- 5.2 Extension methods: PRACK, UPDATE, INFO, SUBSCRIBE, NOTIFY, REFER, MESSAGE, PUBLISH
- 5.3 Which methods make a dialog; in-dialog and out-of-dialog requests
- 5.4 Capability headers: Allow, Supported, Require, Proxy-Require, Unsupported

**Diagrams:** 🃏 *Method cards*: each card flips to show a mini ladder of that method. 🧮 *Capability negotiation*: set Supported/Require on each side and see whether the result is 200 or 420.

**Common mistakes**
- Sending CANCEL after a 200 OK. It is too late; send BYE.
- Putting an option tag in Require that the peer does not support (420 Bad Extension).
- Using INFO for DTMF without an agreed Info Package.

**RFC sections:** RFC 3261 §9 (Canceling a Request), §11 (OPTIONS), §15 (Terminating a Session); RFC 3262, 3311, 6086, 6665, 3515, 3428, 3903

### Module 6: Response codes 🟢→🟡
- 6.1 The six classes: 1xx to 6xx
- 6.2 Provisional responses: 100 (hop-by-hop), 180, 181, 182, 183
- 6.3 Important final responses, grouped by "who must act" (caller, network, callee)
- 6.4 Unknown codes: treat them as x00
- 6.5 Retry-After, Warning, and Reason headers
- 6.6 SIP codes and Q.850 cause values (preview of Module 24)

**Diagrams:** 🗂 *Response code atlas*: a filterable grid of codes. Click a code to see a mini ladder, typical causes, and what the phone shows. 🚦 *Who stops the call?*: watch where in the path each code is created.

**Common mistakes**
- Mixing up 401 (`WWW-Authenticate`, from a registrar or UAS) and 407 (`Proxy-Authenticate`, from a proxy).
- Reading 183 as "ringing". It means session progress, usually with early media.
- Sending 503 to reject one call. Many proxies read 503 as "this server is down" and fail over.
- Forwarding 100 Trying. It is hop-by-hop.

**RFC sections:** RFC 3261 §21 (Response Codes), §21.1.1 (100 Trying), §8.1.3.2 (Unrecognized responses)

### Module 7: Headers and parameters 🟡
- 7.1 Mandatory headers: Via, From, To, Call-ID, CSeq, Max-Forwards, and Contact (INVITE)
- 7.2 Tags: From-tag, To-tag, and why they exist
- 7.3 Via parameters: `branch`, `received`, `rport`, `maddr`
- 7.4 Contact parameters: `expires`, `q`, `+sip.instance`, `reg-id`
- 7.5 URI parameters: `transport`, `lr`, `user=phone`, `maddr`, `ob`
- 7.6 Routing headers: Route and Record-Route (detail in Module 10)
- 7.7 Identity headers: P-Asserted-Identity, P-Preferred-Identity, Privacy
- 7.8 Redirect history: Diversion and History-Info
- 7.9 Session timers: Session-Expires and Min-SE
- 7.10 Other headers: User-Agent, Server, Reason, Warning, Date, Subject

**Diagrams:** 📚 *Header reference*: searchable, and each header shows who adds it, who changes it, and who removes it. 🛤 *Header journey*: one INVITE travels through Proxy A, Proxy B, and an SBC. A highlight shows the headers that change at each hop.

**Common mistakes**
- Changing the From-tag or To-tag in a dialog.
- Using the same Call-ID for unrelated calls.
- Trusting From for caller identity instead of PAI from a trusted peer.
- Not decrementing Max-Forwards.

**RFC sections:** RFC 3261 §8.1.1 (Generating the Request), §19.3 (Tags), §20 (Header Fields); RFC 3325 (PAI); RFC 3323 (Privacy); RFC 7044 (History-Info); RFC 4028 (Session Timers)

---

## Part 3: SIP mechanics

### Module 8: Transactions 🟡→🔴
- 8.1 A transaction: one request and all its responses
- 8.2 How elements match a transaction: the Via `branch`, the `z9hG4bK` magic cookie, and the method
- 8.3 Four state machines: INVITE client, INVITE server, non-INVITE client, non-INVITE server
- 8.4 Timers T1, T2, T4, and Timers A to K
- 8.5 Retransmissions over UDP; no retransmissions over TCP/TLS
- 8.6 ACK for a non-2xx response (same transaction, hop-by-hop) and ACK for a 2xx response (new transaction, end-to-end)
- 8.7 CANCEL: its own transaction that targets another
- 8.8 Later fixes: RFC 6026 (the Accepted state) and RFC 4320

**Diagrams**
- ⚙️ *Transaction state machine player:* the state diagram and a ladder side by side. Press "drop packet" on any message to see the timers fire and the retransmissions start.
- ⏱ *Timer timeline:* T1 doubling to T2, shown on a time axis, with Timer B ending at 64×T1 = 32 s.

**Common mistakes**
- **The 32-second drop:** the ACK for the 200 OK never arrives, Timer H expires, and the call ends. (Broken/Fixed: the cause is a wrong Contact or a missing Record-Route.)
- A new branch on the ACK for a non-2xx response (it must match the INVITE).
- The same branch on the ACK for a 2xx response (it must be new).
- Counting retransmissions as new calls.

**RFC sections:** RFC 3261 §17 (Transactions), §17.1.1.3 (Construction of the ACK Request), §17.2.3 (Matching Requests to Server Transactions), §8.1.1.7 (Via), Appendix A (Timer Values); RFC 6026 §7

### Module 9: Dialogs 🟡→🔴
- 9.1 Dialog ID = Call-ID + local tag + remote tag
- 9.2 Early dialogs and confirmed dialogs
- 9.3 Dialog state: CSeq values, remote target, route set
- 9.4 In-dialog requests: re-INVITE, UPDATE, BYE, INFO, REFER, NOTIFY
- 9.5 Forking: many early dialogs, and more than one 2xx
- 9.6 Glare and 491 Request Pending
- 9.7 Session timers: who refreshes, and how
- 9.8 Call, session, dialog, transaction: four different things

**Diagrams:** 📋 *Live dialog table*: step through a call, and the dialog state table for Alice and for Bob updates at each message. 🌳 *Forking tree*: one INVITE forks to three phones, and you watch the early dialogs appear and close.

**Common mistakes**
- Sending an in-dialog request to the first Request-URI instead of the remote target (Contact).
- 481 Call/Transaction Does Not Exist, because an element lost dialog state or changed tags.
- Not ACKing and then BYEing the extra 2xx responses after forking.
- The session timer refresh fails, so the call drops at a fixed time.

**RFC sections:** RFC 3261 §12 (Dialogs), §12.1.2 (UAC Behavior), §14 (Modifying an Existing Session), §14.1 (491); RFC 4028

### Module 10: Routing: Via, Record-Route, Route 🔴
- 10.1 Two paths: responses follow Via; requests follow Request-URI and Route
- 10.2 The Via stack: each hop adds one, each response removes one
- 10.3 `received` and `rport`: the response path behind NAT
- 10.4 Record-Route: a proxy stays in the path for later requests in the dialog
- 10.5 Building the route set
- 10.6 Loose routing (`;lr`) and strict routing
- 10.7 Outbound proxy and pre-loaded Route
- 10.8 Request-URI and To: why they can be different
- 10.9 Loops, spirals, Max-Forwards, 482, 483
- 10.10 Double Record-Route on multi-homed proxies

**Diagrams:** 🧭 *Routing visualiser*: turn Record-Route on or off for each proxy and see how ACK, BYE, and re-INVITE travel. 📚 *Via stack animation*: Via headers stack up on the request and come off on the response.

**Common mistakes**
- Confusing Via (response path) with Record-Route (path for later requests).
- A proxy that does not Record-Route and so never sees the BYE.
- A missing `;lr`, which turns on strict routing.
- One Record-Route on a proxy with two interfaces, so the BYE leaves on the wrong one.

**RFC sections:** RFC 3261 §16.6 (Request Forwarding), §16.7 (Response Processing), §16.12 (Summary of Proxy Route Processing), §12.1.2, §18.2.2 (Sending Responses); RFC 3581 §4

### Module 11: Finding SIP servers with DNS 🔴
- 11.1 NAPTR → SRV → A/AAAA
- 11.2 SRV priority and weight: failover and load sharing
- 11.3 How the client selects a transport
- 11.4 Failover on 503 and on transport errors

**Diagrams:** 🧾 *DNS resolver step-through*: watch each query and answer, then take a server down and see the failover.

**Common mistakes**
- Putting a port in the URI (`sip:carrier.example:5060`), which stops SRV lookup.
- Hard-coding IP addresses and losing the carrier's failover.

**RFC sections:** RFC 3263 §4 (Client Usage), §4.1 (Selecting a Transport Protocol); RFC 2782

---

## Part 4: Registration, authentication, security

### Module 12: Registration 🟢→🟡
- 12.1 What registration does: it binds an AOR to a Contact
- 12.2 REGISTER: Request-URI, To, From, Contact, Expires
- 12.3 Refresh, query, and remove a registration (`Expires: 0`, `Contact: *`)
- 12.4 More than one device per AOR; `q` values
- 12.5 423 Interval Too Brief and Min-Expires
- 12.6 Path and Service-Route
- 12.7 SIP Outbound and GRUU (overview)

**Diagrams:** 🗃 *Location service view*: a ladder on the left and the registrar's binding table on the right, which updates live. ⏳ *Expiry clock*: registration expiry and NAT binding timeout on one timeline.

**Common mistakes**
- A registration expiry longer than the NAT binding timeout, so incoming calls fail.
- `Contact: *` without `Expires: 0`.
- Ignoring the shorter expiry that the registrar returns in the 200 OK.

**RFC sections:** RFC 3261 §10 (Registrations), §10.2.2 (Removing Bindings), §10.3 (Processing REGISTER Requests); RFC 3327; RFC 3608; RFC 5626; RFC 5627

### Module 13: Digest authentication 🟡→🔴
- 13.1 Challenge and response: the password never travels
- 13.2 401 with WWW-Authenticate/Authorization, and 407 with Proxy-Authenticate/Proxy-Authorization
- 13.3 Parameters: `realm`, `nonce`, `opaque`, `algorithm`, `qop`, `nc`, `cnonce`, `uri`, `response`, `stale`
- 13.4 The calculation: HA1, HA2, and the response
- 13.5 **REGISTER challenge:** REGISTER → 401 → REGISTER (CSeq + 1, Authorization) → 200
- 13.6 **INVITE challenge:** INVITE → 407 → **ACK** → INVITE (CSeq + 1, same Call-ID and From-tag, new branch, Proxy-Authorization) → 100/180/200 → ACK
- 13.7 Nonce reuse, `stale=true`, and nonce count
- 13.8 Algorithms: MD5, SHA-256, SHA-512-256
- 13.9 More than one challenge on one request

**Diagrams**
- 🔐 *Digest calculator:* enter values and see HA1, HA2, and the response built step by step. Each input field is linked to the header parameter it comes from.
- 🪜 *Challenge ladders:* the REGISTER flow and the INVITE flow. A diff view shows what changed between the first and the second request (CSeq, branch, new header).

**Common mistakes**
- No ACK for the 407.
- The same CSeq on the second request, or a new Call-ID or From-tag.
- A digest `uri` that is not the same as the Request-URI.
- The auth username is not the From user, and the wrong one is configured.
- Trying to challenge ACK or CANCEL.

**RFC sections:** RFC 3261 §22 (Usage of HTTP Authentication), §22.2, §22.3, §22.4; RFC 8760; RFC 7616 §3.4.1 (Response)

### Module 14: SIP security 🔴
- 14.1 Threats: eavesdropping, toll fraud, registration hijack, scanners, flooding
- 14.2 TLS, SIPS, certificate checks, mutual TLS on trunks
- 14.3 Edge protection: SBC, topology hiding, rate limits, blocking after failed auth
- 14.4 Trust domains: PAI and Privacy (RFC 3325)
- 14.5 Media security (link to Module 18) and caller identity (link to Module 28)

**Diagrams:** 🛡 *Attack surface map*: the topology with attack paths in coral. Turn on each defence and the matching path closes.

**Common mistakes**
- A PBX open on port 5060 with weak extension passwords.
- Different replies for known and unknown users (404 and 401), which lets scanners list extensions.
- TLS for signaling, but RTP without encryption.
- Accepting PAI from an untrusted source.

**RFC sections:** RFC 3261 §26 (Security Considerations); RFC 3325; RFC 5922; RFC 5630

---

## Part 5: Media

### Module 15: SDP and offer/answer 🟡→🔴
- 15.1 What SDP does: it describes media, it does not carry it
- 15.2 Each line: `v=`, `o=`, `s=`, `c=`, `t=`, `m=`, `a=`, `b=`
- 15.3 The `m=` line: media, port, profile, payload types
- 15.4 Payload types: static and dynamic; `rtpmap` and `fmtp`
- 15.5 Direction: sendrecv, sendonly, recvonly, inactive; hold and resume
- 15.6 Other attributes: `ptime`, `maxptime`, `rtcp`, `rtcp-mux`, `mid`, `group:BUNDLE`
- 15.7 DTMF with `telephone-event`
- 15.8 Offer/answer rules: the same number and order of m-lines, port 0 to reject, codec subset
- 15.9 Where the offer goes: in the INVITE (early offer) or in the 200 OK and ACK (late offer)
- 15.10 New offers: increment the `o=` version
- 15.11 SDP in 183, with PRACK or UPDATE

**Diagrams**
- 🤝 *Offer/answer negotiator:* build Alice's offer, set Bob's capabilities, and see the answer and the selected codec.
- 🧪 *SDP linter:* paste SDP and see each line explained and each error flagged.
- ⏸ *Hold player:* direction attributes change, and arrows on the media path turn on and off.

**Common mistakes**
- A private IP address in `c=`, so audio goes one way or not at all.
- The `o=` version is not incremented in a new offer, so the peer ignores the change.
- The answer has a different number or order of m-lines.
- Assuming a dynamic payload type number is the same on both sides.
- No `telephone-event`, so DTMF fails.

**RFC sections:** RFC 8866 §5 (SDP Specification); RFC 3264 §5 (Generating the Initial Offer), §6 (Generating the Answer), §8 (Modifying the Session), §8.4 (Putting a Unicast Media Stream on Hold); RFC 4733

### Module 16: RTP 🟡
- 16.1 The RTP header: V, P, X, CC, M, PT, sequence number, timestamp, SSRC, CSRC
- 16.2 Clock rate, timestamp, and packet time
- 16.3 Codecs: G.711, G.722, G.729, Opus, AMR-WB, EVS
- 16.4 Jitter, loss, delay, and the jitter buffer
- 16.5 DTMF: RFC 4733 events, SIP INFO, or in-band
- 16.6 Comfort noise and silence suppression
- 16.7 Symmetric RTP and latching
- 16.8 How to calculate bandwidth

**Diagrams:** 🧬 *RTP header bit map*: click each field to see its bits and meaning; paste a hex packet to decode it. 📈 *Jitter buffer simulation*: change the network jitter and buffer size, and see late and lost packets. 🧮 *Bandwidth calculator*: codec, ptime, and transport to kbps, with the overhead of each layer shown.

**Common mistakes**
- Reading an SSRC, sequence, or timestamp jump as an error. It is normal after a transfer or re-INVITE.
- Planning bandwidth from the codec rate only. G.711 at 20 ms is about 87 kbps on Ethernet, not 64.
- DTMF sent both in-band and as RFC 4733, so each digit shows twice.

**RFC sections:** RFC 3550 §5.1 (RTP Fixed Header Fields), §5.2; RFC 3551; RFC 4733; RFC 3389; RFC 4961 (Symmetric RTP)

### Module 17: RTCP 🟡→🔴
- 17.1 What RTCP does: quality feedback, timing, identification
- 17.2 Packet types: SR, RR, SDES, BYE, APP, and XR
- 17.3 Jitter, loss, and round-trip time from the reports
- 17.4 Ports: RTP + 1, `a=rtcp`, and `rtcp-mux`
- 17.5 Feedback for video: NACK, PLI, FIR
- 17.6 MOS and R-factor

**Diagrams:** 📡 *Report explorer*: an SR and an RR with each field explained; the round-trip time calculation is animated on a timeline.

**Common mistakes**
- Blocking RTCP in the firewall, which removes quality data.
- Thinking RTCP is always on RTP port + 1.
- Confusing an RTCP BYE with a SIP BYE.

**RFC sections:** RFC 3550 §6 (RTCP), §6.4.1 (SR), §6.4.2 (RR), Appendix A.8 (Interarrival Jitter); RFC 3611; RFC 5761; RFC 4585

### Module 18: SRTP and media security 🔴
- 18.1 SRTP and SRTCP: encryption and authentication
- 18.2 Key exchange: SDES (`a=crypto`), DTLS-SRTP (`a=fingerprint`, `a=setup`), ZRTP
- 18.3 Profiles: RTP/SAVP and RTP/SAVPF; best-effort SRTP
- 18.4 New keys on re-INVITE; SRTP to RTP at an SBC

**Diagrams:** 🔑 *Key exchange comparison*: three ladders side by side showing where the keys travel. A "capture view" shows what an attacker on the path can read in each case.

**Common mistakes**
- SDES over SIP without TLS, so the keys are visible on the network.
- Offering RTP/SAVP to a peer that supports only RTP/AVP, which gives 488.
- Both sides use the same DTLS `a=setup` role.

**RFC sections:** RFC 3711 §3 (SRTP Framework); RFC 4568; RFC 5763; RFC 5764; RFC 6189

---

## Part 6: Transports

### Module 19: SIP over UDP, TCP, TLS, and WebSocket 🟡→🔴
- 19.1 UDP: simple, needs retransmission timers, can fragment
- 19.2 The 1300-byte rule
- 19.3 TCP: connections, framing with Content-Length, connection reuse
- 19.4 TLS: handshake, SNI, certificate checks, port 5061
- 19.5 WebSocket: SIP in the browser
- 19.6 The transport in Via and `;transport=`; changing transport between hops
- 19.7 Keepalives: CRLF ping/pong, OPTIONS, TCP keepalive
- 19.8 Behind NAT, the server must reuse the client's connection

**Diagrams:** 🚚 *Transport race*: one large INVITE sent over UDP fragments and is lost, and the same INVITE over TCP arrives. 🔒 *TLS handshake ladder*, annotated with the certificate checks.

**Common mistakes**
- A large INVITE over UDP is fragmented and dropped.
- The server opens a new TCP/TLS connection to a client behind NAT instead of reusing the existing one.
- The TLS certificate does not match the SIP domain.

**RFC sections:** RFC 3261 §18 (Transport), §18.1.1 (Sending Requests: the 1300-byte rule); RFC 5923; RFC 5922; RFC 7118; RFC 5626 (keepalives)

---

## Part 7: NAT traversal

### Module 20: NAT and SIP 🔴
- 20.1 Why NAT breaks SIP: private addresses in Via, Contact, and SDP
- 20.2 NAT behaviour: mapping and filtering types ("symmetric NAT")
- 20.3 Signaling fixes: `rport`, `received`, Contact rewriting, Path, SIP Outbound
- 20.4 Keep the binding open: keepalives and short registration intervals
- 20.5 Media fixes: symmetric RTP, latching, media relays, SBC anchoring
- 20.6 STUN, TURN, and ICE: candidates and connectivity checks
- 20.7 SIP ALG: why router "helpers" often break calls
- 20.8 One-way audio: a step-by-step diagnosis

**Diagrams**
- 🧱 *NAT simulator:* put Alice and Bob behind different NAT types. Turn rport, Contact rewriting, a media relay, or ICE on and off. See whether the signaling and each direction of audio arrive. Each packet shows the address before and after the NAT.
- 🧊 *ICE candidate checker:* host, server-reflexive, and relay candidates; the connectivity checks run and the selected pair is shown.

**Common mistakes**
- SIP ALG left on in the router.
- Fixing the signaling (Contact) but not the media (SDP `c=`), or the reverse.
- Opening port 5060 but not the RTP port range.
- A registration interval of 3600 s behind a NAT that times out after 30–60 s.
- STUN alone behind symmetric NAT (you need TURN or a relay).

**RFC sections:** RFC 3581 §3, §4; RFC 5626; RFC 8489 (STUN); RFC 8656 (TURN); RFC 8445 (ICE); RFC 4787 (NAT behaviour); RFC 6314 (NAT traversal practices)

---

## Part 8: Call flow library

Every flow here is a full interactive ladder:
- Play, pause, step, and jump to any message
- Click a message to open it in the message inspector
- **"What if…" toggles:** drop this packet, the callee is busy, the caller hangs up now, a NAT is in the path
- A **diff view** that shows which headers changed since the last message

The flows follow RFC 3665 (basic call flows) and RFC 5359 (service examples).

### Module 21: Basic call flows 🟢→🟡
- 21.1 Registration, with and without a challenge
- 21.2 Direct call between two user agents
- 21.3 Call through one proxy, then through two proxies with Record-Route
- 21.4 Call with a 407 challenge
- 21.5 Busy (486), no answer (408/480), rejected (603), not found (404)
- 21.6 The caller cancels: CANCEL → 200 (CANCEL) → 487 → ACK
- 21.7 Early media (183 with SDP)
- 21.8 Late offer (SDP in the 200 OK and in the ACK)
- 21.9 Redirect (302)
- 21.10 Forking: parallel and sequential

### Module 22: Mid-call features 🟡→🔴
- 22.1 Hold and resume
- 22.2 Re-INVITE: codec change, add video, new media address
- 22.3 Reliable provisional responses: 100rel, PRACK, RSeq, RAck
- 22.4 UPDATE before the answer (preconditions overview)
- 22.5 Session timer refresh
- 22.6 Blind transfer: REFER, Refer-To, 202, NOTIFY with sipfrag
- 22.7 Attended transfer: REFER with Replaces
- 22.8 Call forwarding: unconditional, busy, no answer
- 22.9 Call pickup and call park (concepts)
- 22.10 Third-party call control (3PCC)
- 22.11 Conferences (concepts)

### Module 23: Events, presence, and messaging 🟡
- 23.1 SUBSCRIBE and NOTIFY: Event, Subscription-State, Expires
- 23.2 Event packages: presence, dialog (BLF), message-summary (MWI), reg, refer
- 23.3 PUBLISH and presence servers
- 23.4 MESSAGE (page-mode instant messages)

### Module 24: PSTN interworking and SIP trunks 🔴
- 24.1 SIP trunks: registration-based and IP-based
- 24.2 Numbers: E.164, `tel:` URIs, `user=phone`, normalisation
- 24.3 Caller ID: From, PAI, and Privacy; withheld numbers
- 24.4 Diversion and History-Info for forwarded calls
- 24.5 Q.850 causes and SIP codes; the Reason header
- 24.6 Early media from the PSTN: ringback and announcements in 183

**Common mistakes (Part 8)**
- No ACK after the 487 that follows a CANCEL.
- Local ringback while the network also sends early media, so there is double ringback or silence.
- REFER without handling the NOTIFY, so the transferor never learns the result.
- A number in the wrong format for the carrier.
- The original called number is lost on a forwarded call, so voicemail fails.

**RFC sections:** RFC 3665; RFC 5359; RFC 3262; RFC 3311; RFC 3515; RFC 3891; RFC 3725; RFC 6665; RFC 3842; RFC 4235; RFC 3398; RFC 6432; RFC 3966

---

## Part 9: SIP in the real world

### Module 25: Proxies, B2BUAs, and SBCs 🔴
- 25.1 What a proxy may change, and what a B2BUA may change
- 25.2 Common open-source roles: Kamailio and OpenSIPS (proxy), Asterisk and FreeSWITCH (B2BUA), rtpengine (media relay). Concepts only.
- 25.3 SBC functions: topology hiding, normalisation, transcoding, NAT handling, security, call admission control
- 25.4 Load balancing and failover with OPTIONS health checks
- 25.5 High availability: shared state and floating IPs

**Diagrams:** ⚖️ *Proxy vs B2BUA side-by-side*: the same call through each, with a diff of the messages on both sides of the element. 🏗 *SBC function explorer*: topology view with toggles (as in `presentations/scaled-architecture.html`).

### Module 26: WebRTC and SIP 🔴
- 26.1 The WebRTC media stack: ICE, DTLS-SRTP, `rtcp-mux`, BUNDLE
- 26.2 JSEP and how WebRTC SDP is different from classic SIP SDP
- 26.3 SIP over secure WebSocket (WSS): register and call from a browser
- 26.4 Trickle ICE
- 26.5 The gateway between WebRTC and classic SIP: what it must convert
- 26.6 Opus, G.711, and transcoding

**Diagrams:** 🌐 *WebRTC ↔ SIP gateway view*: a browser on the left, a SIP phone on the right, and the gateway converting each layer (WSS → UDP, DTLS-SRTP → RTP, BUNDLE → separate ports). 🔍 *SDP comparison*: WebRTC SDP and classic SDP side by side, with the differences highlighted.

**Common mistakes**
- No TURN server, so calls fail on restrictive networks.
- The SIP side does not accept DTLS-SRTP, and the gateway does not convert it.
- The certificate is not valid for the WSS domain.
- Codec mismatch (Opus only on one side, G.711 only on the other) without transcoding.

**RFC sections:** RFC 8825 (WebRTC overview); RFC 8829 / RFC 9429 (JSEP); RFC 7118; RFC 8843 (BUNDLE); RFC 8838 (Trickle ICE); RFC 5763; RFC 5764

### Module 27: IMS and VoLTE 🔴
- 27.1 Why IMS exists: SIP for mobile operators
- 27.2 Architecture: UE, P-CSCF, I-CSCF, S-CSCF, HSS, MMTel AS, IBCF/BGCF/MGCF
- 27.3 IMS registration: P-CSCF discovery, AKA authentication, IPsec security association (Security-Client/Server/Verify)
- 27.4 IMS headers: P-Access-Network-Info, P-Visited-Network-ID, P-Charging-Vector, P-Associated-URI, Path, Service-Route
- 27.5 A VoLTE call: preconditions, QoS bearers, UPDATE, 183 with SDP
- 27.6 VoLTE codecs: AMR-WB and EVS
- 27.7 VoWiFi (ePDG) and emergency calls (overview)
- 27.8 Where IMS SIP is different from RFC 3261 SIP in daily practice

**Diagrams:** 🏢 *IMS core map*: click each CSCF to see its job and the headers it adds. 🪜 *IMS registration ladder* with the AKA challenge and IPsec setup. 🪜 *VoLTE call ladder* with the precondition state at each step.

**Common mistakes**
- Expecting MD5 digest. IMS uses AKA (AKAv1-MD5).
- Ignoring Service-Route on later requests.
- Not answering the precondition steps, so the call stays at "connecting".

**References:** 3GPP TS 24.229; 3GPP TS 23.228; GSMA IR.92; RFC 3310 (AKA digest); RFC 3329 (Security agreement); RFC 7315 (P-headers); RFC 3312 / RFC 4032 (preconditions)

### Module 28: Caller identity: STIR/SHAKEN 🔴
- 28.1 The problem: spoofed caller ID and robocalls
- 28.2 PASSporT: a signed token about the call
- 28.3 The Identity header: what it contains
- 28.4 Attestation levels A, B, and C
- 28.5 Signing service and verification service flow
- 28.6 Certificates: STI-PA, STI-CA, and certificate repositories
- 28.7 Diverted calls (`div` PASSporT) and other extensions
- 28.8 What the called user sees

**Diagrams:** 🧾 *PASSporT decoder*: an Identity header splits into its header, payload, and signature, and each claim is explained. 🔗 *Signing and verification path*: originating carrier → transit → terminating carrier, with the checks at each step.

**Common mistakes**
- Giving A attestation for a number the caller is not proven to own.
- Removing or changing the Identity header in transit.
- A clock difference that makes `iat` too old, so verification fails.

**RFC sections:** RFC 8224 (Identity header); RFC 8225 (PASSporT); RFC 8588 (SHAKEN); RFC 8946 (div); ATIS-1000074

### Module 29: Voice quality 🔴
- 29.1 Delay, jitter, and loss budgets
- 29.2 DSCP marking: EF for RTP, CS3/AF31 for signaling
- 29.3 Transcoding: CPU cost and quality loss
- 29.4 Echo: causes and fixes
- 29.5 MOS and R-factor in practice

**Diagrams:** 🎚 *Quality slider*: change delay, jitter, and loss, and see the MOS change.

---

## Part 10: Troubleshooting

### Module 30: Reading traces 🟡→🔴
Everything runs in the browser. There are no tools to install. Real tools are named so the reader can find them later.
- 30.1 Trace formats: what a sngrep, Wireshark, or HOMER view shows
- 30.2 Reading a ladder fast: find the Call-ID, the final response, and the first odd message
- 30.3 Filter thinking: by Call-ID, by user, by code
- 30.4 Reading RTP stream statistics: loss, jitter, sequence errors
- 30.5 Logs and traces together

**Diagrams:** 🖥 *In-browser trace viewer*: a sngrep-like view of prepared example traces, with a call list, a ladder, and a message pane. 📊 *RTP stream panel*: a graph of loss and jitter per stream.

### Module 31: Troubleshooting playbook 🔴
A symptom map. Click a symptom to see the decision tree and the example trace.

| Symptom | Usual causes |
|---|---|
| One-way or no audio | NAT, private IP in SDP, SIP ALG, firewall RTP range, direction attribute stuck |
| Call drops at about 32 s | ACK not received: wrong Contact, NAT, missing Record-Route |
| Call drops at a fixed time (e.g. 15 or 30 min) | Session timer refresh fails; NAT or firewall timeout |
| Registration fails or flaps | Auth or realm, NAT timeout and expiry, ALG, DNS |
| 401/407 loop | Wrong credentials or realm, wrong digest `uri`, stale nonce |
| 488 Not Acceptable Here | Codec mismatch, SRTP profile mismatch |
| 481 on BYE or re-INVITE | Dialog state lost, wrong tags |
| 408 or 503 | DNS, transport, overload, failover |
| Large INVITE is lost | UDP fragmentation; use TCP |
| DTMF fails | Payload type mismatch; in-band vs RFC 4733 vs INFO |
| Wrong caller ID | From, PAI, and Privacy handling; trunk number format |
| Incoming calls fail, outgoing calls work | NAT binding expired, Contact unreachable, no keepalive |
| STIR/SHAKEN shows "not verified" | Identity header removed, certificate failure, attestation level |
| WebRTC call connects but has no audio | ICE failure, no TURN, DTLS role mismatch |

**Diagrams:** 🌲 *Symptom decision tree*: answer "yes/no" at each node to reach the cause and an example trace. (This is a guided tree, not a quiz. There is no score.)

## Part 11: Case files

### Module 32: Case files 🔴
Ten guided investigations. Each case has a short story ("the customer reports…"), a prepared trace in the trace viewer, hints that open one at a time, and a final explanation with the fix shown as a Broken/Fixed diagram. There is no score.

Example cases:
1. Remote workers lose incoming calls after 5 minutes
2. Every call to one carrier drops at 32 seconds
3. Audio only in one direction for home users
4. Transfers fail on one model of phone
5. Calls from the WebRTC client have no audio on hotel Wi-Fi
6. Calls are "Spam likely" after a carrier change (STIR/SHAKEN)
7. VoLTE calls stay at "connecting" (preconditions)
8. 401 loop after a password change
9. Large INVITEs disappear after video is turned on
10. BYE never reaches the gateway in an HA pair

---

## 4. Visual design direction (from `presentations/`)

The course uses the same visual language as both decks. This is a direction, not the final technical design.

**Look**
- Dark "signaling console" theme. Background `#0E1013`, panels `#15181d` / `#1b1f26`, lines `#2a3039`, text `#ECE7DC`, dim text `#BEB8AC`, muted `#828a95`
- Faint scanline texture on diagram stages
- Fonts: **Bricolage Grotesque** (headings and text) and **Martian Mono** (messages, headers, labels)
- Large, tight headings with one key phrase highlighted in amber (`h2 em`)
- Panels with a small uppercase mono label and a coloured bar (`.ph`)
- Notes with a coloured left border (`.note`) for RFC quotes and warnings
- Stat tiles for key numbers (T1 = 500 ms, 64×T1 = 32 s, 1300 bytes)
- Entrance animations: lines draw in, labels fade in; respects `prefers-reduced-motion`

**Protocol colour map** (extends the decks' map)

| Colour | Hex | Meaning |
|---|---|---|
| Amber | `#FFB000` | SIP signaling |
| Bone | `#E3D6B8` | SDP (the SIP body) |
| Cyan (dashed line) | `#3FD0C9` | RTP media |
| Green | `#7BD88F` | RTCP and keepalives |
| Blue | `#7FA6FF` | DNS, STUN, ICE |
| Grey | `#A7AFB9` | Lower-layer packets: TCP handshakes, ICMP |
| Coral | `#FF6B5A` | Errors, failed paths, attacks |
| Red | `#FF4F6A` | Lost packets and elements that are down |
| 🔒 + double line | (any colour) | Encrypted (TLS, SRTP, DTLS) |

**Page format.** The decks are slides. The course is a reading site, so lessons are scrolling pages. Diagrams sit in "stages" like the one in `scaled-architecture.html`: a diagram, an inspector panel beside it, and a player bar under it. On long explanations the diagram stays fixed while the text steps scroll past it ("scrollytelling"). Each step of the text moves the diagram forward.

**Responsive.** Below tablet width the inspector moves under the diagram, and ladders scroll horizontally inside their stage, not the page.

### Interactive diagram kit
A small set of reusable diagram types used across all modules. Each one is driven by data, not drawn by hand.

| Component | Used for | Interactions |
|---|---|---|
| **Ladder** | All call flows | Play/step, click message → inspector, "what if" toggles, header diff, timer overlay |
| **Topology** | Elements, routing, NAT, SBC, IMS | Click node/link, animated packets, toggle features, mark elements down |
| **Message inspector** | Every SIP/SDP message | Point at a line to see its meaning, RFC link, and change from the last hop |
| **State machine** | Transactions, dialogs, subscriptions | Step by event, linked to a ladder |
| **Bit map** | RTP, RTCP, STUN headers | Click a field; paste hex to decode |
| **Timeline** | Timers, expiry, session timers, NAT timeout | Drag time; see events fire |
| **Broken/Fixed toggle** | Every common mistake | One toggle switches the diagram between the two states |
| **Calculator** | Digest, bandwidth, MOS | Live inputs; each step of the result is shown |
| **Trace viewer** | Modules 30–32 | Call list, ladder, message pane, RTP stats |
| **Decision tree** | Troubleshooting playbook | Choose a branch; reach the cause |

### RFC quote block
Every rule that matters gets one of these:

> **RFC 3261 §17.1.1.3: Construction of the ACK Request**
> "The ACK MUST be sent to the same address, port, and transport to which the original request was sent."
> [Read the section →](https://www.rfc-editor.org/rfc/rfc3261#section-17.1.1.3)

- RFC 2119 keywords (MUST, SHOULD, MAY) are highlighted in the quote.
- Links use `https://www.rfc-editor.org/rfc/rfcNNNN#section-X.Y`.
- Each quote is checked word for word against rfc-editor.org when the lesson is written. The section numbers in this outline are pointers to check, not final citations.
- Quotes are short and attributed. RFC text may be quoted under the IETF Trust Legal Provisions (BCP 78).

---

## 5. Diagram language: "80% ASD-STE100"

ASD-STE100 (Simplified Technical English) controls words: one word has one meaning, sentences are short, and the active voice is required. The course applies the same idea to **diagrams**: a controlled visual language in which each symbol, colour, and label has exactly one meaning. We follow about 80% of the strict rules and relax the rest where they would hide technical detail.

### 5.1 Controlled vocabulary (labels)
- Labels use **glossary terms only**. One term for one concept, everywhere: always "UAC", never also "client" or "caller side" for the same thing.
- Element names never change: "Proxy A" in Module 3 is "Proxy A" in Module 31.
- Arrow labels show the **method or status code** plus at most one key detail: `INVITE`, `407 Proxy Auth`, `ACK (new branch)`. Maximum 5 words.
- Node labels: maximum 3 words for the name and 2 short lines for the subtitle.
- No synonyms, slang, or decorative words in a diagram.

### 5.2 Controlled symbols (one symbol, one meaning)

| Visual element | Only ever means |
|---|---|
| Colour | The protocol on the wire (map in §4). Never used for emphasis. |
| Solid line | Signaling |
| Dashed line | Media |
| Double line + 🔒 | Encrypted (TLS, SRTP, DTLS) |
| Coral | An error or a failed path |
| Red ✕ | A lost packet, or an element that is down |
| White outline | The element or message the current step is about |
| Rounded box | User agent |
| Square box | Proxy, registrar, or server |
| Box with a double border | B2BUA or SBC |
| Brick wall | NAT or firewall |

A symbol is never reused for another meaning. A new meaning needs a new symbol, added to this table and to the on-page legend.

### 5.3 Controlled layout
- In a call-flow ladder, time runs down. The caller is always on the left and the callee on the right. The lane order is the same in every module.
- In a network map, the access side (phones, browsers) is on the left, the core is in the middle, and the carrier/PSTN is on the right.
- Maximum 7 lanes or nodes in one view. A larger view is split, or its detail is folded behind a "show more" control.
- Every diagram has a legend that shows only the symbols it uses.

### 5.4 Controlled steps (one step, one idea)
- Each step of the player changes **one thing**: one message, one state change, or one timer.
- Only what changed in this step is highlighted; everything else is dimmed.
- The caption for each step is a short STE sentence: maximum 20 words, active voice, present tense, subject first.
  - ✅ "Proxy A adds a Via header. The branch value is new."
  - ❌ "A new Via header containing a freshly generated branch parameter is inserted by the proxy."
- One caption per step. Detail goes in the inspector panel, not in the caption.
- Warnings in a diagram are coral, start with "⚠", and are separate from the step caption.

### 5.5 Controlled interaction
- The same control does the same thing in every diagram: ▶ play, ⏭ step, ⏮ back, ↺ reset, "Broken / Fixed" switch, "What if…" chips.
- Clicking a message or node always opens the inspector panel, in the same place.
- Every animation can be stepped manually. Nothing important happens only in motion. All animation respects `prefers-reduced-motion`.
- Colour never carries meaning alone: each colour also has a line style, an icon, or a label (for colour-blind readers and printing).

### 5.6 The relaxed 20%
- Real protocol names, header names, parameters, and codes appear as they are (`Record-Route`, `;lr`, `rport`, `z9hG4bK`), even though STE has no such words.
- The **message inspector** shows the full raw message. Raw protocol text is not simplified.
- Abbreviations are allowed when the glossary defines them (UAC, SBC, CSCF, ICE).
- Dense reference views (the Response code atlas, the RFC map, the IMS core map) may go above 7 elements, but they must filter and focus on the user's selection.
- Short explanatory connectors ("because", "so") are allowed in captions when they make a cause clear.

### 5.7 Example: one step of the INVITE challenge ladder

| | Strict and clear (✅ course style) | Uncontrolled (❌) |
|---|---|---|
| Arrow label | `ACK` | `ACK sent to complete the INVITE transaction after 407` |
| Highlight | Only the ACK arrow | ACK arrow, 407 arrow, and Proxy A box, all in different colours |
| Caption | "Alice sends ACK for the 407. This ends the first INVITE transaction." | "Next, an acknowledgement is generated by the UA so that the transaction which was challenged can be cleaned up." |
| Colour | Amber (SIP) | Green "because it is a success step" (breaks the colour rule) |

The lesson prose that explains each diagram has no fixed style rules. It should be plain, clear English.

---

## 6. Content production order

1. **Phase 1: core story.** Modules 0, 3–6, 12, 13, 21. A reader can follow a registration and a basic call with authentication. This phase also builds the Ladder, Message inspector, and Broken/Fixed components.
2. **Phase 2: mechanics.** Modules 7–10, 15–16, 19–20, 22. Adds the State machine, Topology, NAT simulator, and SDP negotiator.
3. **Phase 3: depth.** Modules 11, 14, 17–18, 23–24, 30–31. Adds the Trace viewer, Bit map, and Decision tree.
4. **Phase 4: real world.** Modules 1–2, 25–29, 32.

## 7. Key RFC index

3261 (SIP) · 3262 (PRACK) · 3263 (DNS) · 3264 (offer/answer) · 3310 (AKA) · 3311 (UPDATE) · 3312/4032 (preconditions) · 3323 (Privacy) · 3325 (PAI) · 3326 (Reason) · 3327 (Path) · 3329 (sec-agree) · 3398 (ISUP mapping) · 3428 (MESSAGE) · 3515 (REFER) · 3550 (RTP/RTCP) · 3551 (RTP profiles) · 3581 (rport) · 3608 (Service-Route) · 3611 (RTCP XR) · 3665 (basic call flows) · 3711 (SRTP) · 3725 (3PCC) · 3842 (MWI) · 3891 (Replaces) · 3903 (PUBLISH) · 3966 (tel URI) · 4028 (session timers) · 4235 (dialog events) · 4320 · 4568 (SDES) · 4585 (AVPF) · 4733 (DTMF) · 4787 (NAT behaviour) · 4961 (symmetric RTP) · 5359 (service examples) · 5626 (Outbound) · 5627 (GRUU) · 5761 (rtcp-mux) · 5763/5764 (DTLS-SRTP) · 5922 (TLS certs) · 5923 (connection reuse) · 6026 · 6086 (INFO) · 6189 (ZRTP) · 6314 (NAT practices) · 6432 (Reason Q.850) · 6665 (events) · 7044 (History-Info) · 7118 (WebSocket) · 7315 (P-headers) · 7616 / 8760 (digest) · 8224 / 8225 / 8588 / 8946 (STIR/SHAKEN) · 8445 (ICE) · 8489 (STUN) · 8656 (TURN) · 8825 (WebRTC) · 8838 (Trickle ICE) · 8843 (BUNDLE) · 8866 (SDP) · 9429 (JSEP)
3GPP TS 24.229 · 3GPP TS 23.228 · GSMA IR.92 · ATIS-1000074
