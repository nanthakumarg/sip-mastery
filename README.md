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
| `npm run check:content` | Protocol checks and diagram language checks on every flow |
| `npm run verify:rfc` | Checks every RFC quote word for word against rfc-editor.org |
| `npm test` | Unit tests (parser, checks, digest maths) |
| `npm run verify` | All three checks above |
| `npm run check` | TypeScript and Astro type check |

## Writing content

All course content lives in `src/content/`.

| File | Holds |
|---|---|
| `modules/NN-slug.mdx` | One lesson. Frontmatter is validated (see `src/content.config.ts`). |
| `flows/*.yaml` | Call flows: lanes, steps, captions, and raw SIP messages |
| `rfc-quotes.yaml` | Exact RFC quotes, referenced by id |
| `glossary.yaml` | The controlled vocabulary. Lane labels and diagram labels must use these terms. |
| `headers.yaml` | Explanations for the message inspector |

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
```

### Flow file rules

- Write messages as they appear on the wire. The loader converts them to CRLF.
- `Content-Length: {auto}` becomes the real body length in bytes.
- `response="{digest}"` becomes the real digest response, calculated from the header's parameters and the flow's `credentials`. `{digest:INVITE}` calculates it for another method (an ACK copies the INVITE credentials).
- A flow with `broken: true` must list the rules it breaks in `breaks: [...]`. The build fails if it breaks other rules, or does not break the listed ones.
- Captions: at most 2 sentences of 20 words each, active voice. Labels: at most 5 words, starting with a method, a status code, or a glossary term.

## Deploy

GitHub Actions builds and deploys to GitHub Pages on every push to `main` (`.github/workflows/deploy.yml`).

1. Push the repository to GitHub.
2. In **Settings → Pages**, set **Source** to **GitHub Actions**.
3. Push to `main`. The workflow sets the site URL and base path from the repository name.

## Licences

- Code: [MIT](LICENSE)
- Course text, flows, and diagrams: [CC BY 4.0](LICENSE-CONTENT)
- RFC excerpts: IETF Trust Legal Provisions (BCP 78), quoted with a link to each section
