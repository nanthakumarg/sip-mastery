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
│  │  └─ digest.ts               # HA1 / HA2 / response
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
│  ├─ pages/
│  └─ styles/tokens.css, base.css, diagram.css
├─ scripts/
│  ├─ check-content.ts           # runs both linters over every flow
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
| `invite-final-ack` | Every final response to an INVITE is followed by an ACK from the UAC side |
| `dialog-tags` | In-dialog requests (and the ACK for a 2xx) use the From/To tags of an established dialog |

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
- Removes page headers and footers, finds the cited section, normalises whitespace, and checks that the quote appears word for word in that section.
- Fails on a missing section or a quote that doesn't match.

## 7. Deployment

- GitHub Actions workflow: install → content checks → tests → `astro build` → Pagefind index → upload to Pages.
- `astro.config.mjs` reads `SITE` and `BASE` from the environment. For a project page, `BASE=/sip-course`. A custom domain later only needs `BASE=/` and a `CNAME` file.
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
