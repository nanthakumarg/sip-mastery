/**
 * Home page hero: the INVITE flow plays itself in a loop.
 * With reduced motion (or without JavaScript) it shows every step.
 */
import { useEffect, useState } from 'react';
import Ladder from './Ladder.tsx';
import type { ClientFlow } from './types.ts';

export default function HeroLadder({ flow }: { flow: ClientFlow }) {
  const last = flow.steps.length - 1;
  const [current, setCurrent] = useState(last);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setCurrent(0);
    const t = setInterval(() => setCurrent(c => (c >= last + 2 ? 0 : c + 1)), 1300);
    return () => clearInterval(t);
  }, [last]);

  return <Ladder flow={flow} current={Math.min(current, last)} future="hide" />;
}
