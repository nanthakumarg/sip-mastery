/**
 * Pinned ladder for scroll-driven lessons. Each text block in the container
 * with [data-scrolly-step] moves the ladder to that step when it reaches the
 * middle of the viewport. Without JavaScript the full ladder shows instead.
 */
import { useEffect, useRef, useState } from 'react';
import Ladder from './Ladder.tsx';
import type { ClientFlow } from './types.ts';

interface Props {
  flow: ClientFlow;
  /** id of the element that holds the [data-scrolly-step] blocks */
  container: string;
}

export default function ScrollyLadder({ flow, container }: Props) {
  // Server render shows every step (works without JavaScript); hydration starts at step 1.
  const [current, setCurrent] = useState(flow.steps.length - 1);
  const step = flow.steps[current]!;
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = document.getElementById(container);
    if (!root) return;
    setCurrent(0);
    const blocks = [...root.querySelectorAll<HTMLElement>('[data-scrolly-step]')];
    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        blocks.forEach(b => b.classList.toggle('is-active', b === e.target));
        setCurrent(Number((e.target as HTMLElement).dataset.scrollyStep));
      }
    }, {
      // On narrow screens the pinned ladder covers the top of the screen, so the
      // reading line moves down.
      rootMargin: window.matchMedia('(max-width: 900px)').matches ? '-62% 0px -30% 0px' : '-45% 0px -50% 0px',
    });
    blocks.forEach(b => io.observe(b));
    root.classList.add('is-live');
    return () => io.disconnect();
  }, [container]);

  // Keep the current row visible when the ladder box is shorter than the ladder.
  useEffect(() => {
    const b = box.current;
    const row = b?.querySelector<SVGGElement>(`[data-step="${current}"]`);
    if (!b || !row || b.scrollHeight <= b.clientHeight) return;
    const top = row.getBoundingClientRect().top - b.getBoundingClientRect().top + b.scrollTop;
    b.scrollTo({ top: Math.max(0, top - b.clientHeight * 0.6), behavior: 'smooth' });
  }, [current]);

  return (
    <div className="scrolly-panel">
      <div className="scrolly-ladder" ref={box}>
        <Ladder flow={flow} current={current} compact future="hide" />
      </div>
      <p className="scrolly-cap" aria-live="polite">
        <span className="cap-num">{String(current + 1).padStart(2, '0')}</span>
        {step.caption}
      </p>
    </div>
  );
}
