/**
 * Method cards (Module 5): one card per SIP method. Select a card and it
 * turns over to show what the method does, whether it lives in a dialog,
 * and a short ladder you can step through.
 */
import { useState } from 'react';
import Ladder from './Ladder.tsx';
import { markKeywords } from './Inspector.tsx';
import { PlayerControls, usePlayer } from './player.tsx';
import type { ClientFlow, ClientQuote } from './types.ts';

export interface CardInfo {
  method: string;
  group: 'core' | 'ext';
  rfc: number;
  section: string;
  url: string;
  purpose: string;
  dialog: string;
  body: string;
  note: string;
  quote: string;
}

interface Props {
  cards: CardInfo[];
  flows: Record<string, ClientFlow>;
  quotes: Record<string, ClientQuote>;
  initial?: string;
}

const GROUPS: [CardInfo['group'], string][] = [['core', 'Core methods · RFC 3261'], ['ext', 'Extension methods']];

function Detail({ card, flow, quote }: { card: CardInfo; flow: ClientFlow; quote?: ClientQuote }) {
  const p = usePlayer(flow.steps.length, 2000);
  const step = flow.steps[p.current]!;
  return (
    <div className="mc-detail" id="mc-detail" role="region" aria-label={`${card.method} method`}>
      <div className="mc-facts">
        <p className="mc-big">{card.method}</p>
        <p className="mc-purpose">{card.purpose}</p>
        <dl className="eg-facts">
          <dt>Dialog</dt><dd>{card.dialog}</dd>
          <dt>Body</dt><dd>{card.body}</dd>
          <dt>Defined in</dt><dd><a href={card.url} target="_blank" rel="noopener">RFC {card.rfc} §{card.section} ↗</a></dd>
        </dl>
        <p className="mc-note">{card.note}</p>
        {quote && (
          <blockquote className="insp-quote">
            <p className="insp-q-src">RFC {quote.rfc} §{quote.section} · {quote.title}</p>
            <p>“{markKeywords(quote.text)}”</p>
            <a href={quote.url} target="_blank" rel="noopener">Read the section ↗</a>
          </blockquote>
        )}
      </div>
      <div className="mc-flow" tabIndex={0} onKeyDown={p.onKey} aria-label={`Ladder for ${card.method}. Use the arrow keys to step.`}>
        <div className="mc-ladder">
          <Ladder flow={flow} current={p.current} onSelect={p.go} compact />
        </div>
        <div className="stage-caption" aria-live="polite">
          <span className="cap-num">{String(p.current + 1).padStart(2, '0')}<span>/{String(flow.steps.length).padStart(2, '0')}</span></span>
          <p className="cap-text">{step.caption}</p>
        </div>
        <PlayerControls p={p} />
      </div>
    </div>
  );
}

export default function MethodCards({ cards, flows, quotes, initial }: Props) {
  const [sel, setSel] = useState(initial ?? cards[0]!.method);
  const card = cards.find(c => c.method === sel)!;

  return (
    <section className="mcards" aria-label="SIP method cards">
      <header className="stage-head">
        <div>
          <p className="eyebrow">Method cards</p>
          <p className="stage-title">Fourteen methods, one job each</p>
        </div>
        <ul className="legend" aria-label="Legend">
          <li><i className="lg-sip" />SIP</li>
          <li><span className="mc-chip is-dialog">dialog</span>Creates a dialog</li>
          <li><span className="mc-chip">in dialog</span>Only inside a dialog</li>
        </ul>
      </header>

      {GROUPS.map(([g, title]) => (
        <div key={g} className="mc-group">
          <p className="eyebrow mc-group-title">{title}</p>
          <div className={`mc-grid g-${g}`}>
            {cards.filter(c => c.group === g).map(c => {
              const creates = /^Creates/.test(c.dialog);
              const inside = /^Only inside|^Inside/.test(c.dialog);
              return (
                <button
                  key={c.method}
                  type="button"
                  className={`mc-card${c.method === sel ? ' is-sel' : ''}`}
                  aria-pressed={c.method === sel}
                  aria-controls="mc-detail"
                  onClick={() => setSel(c.method)}
                >
                  <span className="mc-name">{c.method}</span>
                  <span className="mc-rfc">RFC {c.rfc}</span>
                  <span className="mc-short">{c.purpose.split('. ')[0]!.replace(/\.$/, '')}.</span>
                  {(creates || inside) && <span className={`mc-chip${creates ? ' is-dialog' : ''}`}>{creates ? 'dialog' : 'in dialog'}</span>}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <Detail key={card.method} card={card} flow={flows[card.method]!} quote={quotes[card.quote]} />
    </section>
  );
}
