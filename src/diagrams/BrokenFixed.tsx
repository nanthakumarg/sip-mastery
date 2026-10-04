/**
 * A two-way switch between flows. Two uses:
 *  - Broken / Fixed (COURSE_STRUCTURE §5.5): the mistake, then the correct behaviour. Opens on "Broken".
 *  - A neutral comparison, such as UDP / TCP (pass `labels` and `neutral`).
 */
import { useState } from 'react';
import FlowStage from './FlowStage.tsx';
import { ladderWidth } from './Ladder.tsx';
import type { FlowBundle } from './types.ts';

interface Props {
  broken: FlowBundle;
  fixed: FlowBundle;
  /** Button labels; default ['Broken', 'Fixed']. */
  labels?: [string, string];
  /** A comparison, not a mistake: no ✕/✓ marks, neutral colours. */
  neutral?: boolean;
}

export default function BrokenFixed({ broken, fixed, labels = ['Broken', 'Fixed'], neutral = false }: Props) {
  const [mode, setMode] = useState<'broken' | 'fixed'>('broken');
  const bundle = mode === 'broken' ? broken : fixed;
  return (
    <div className={`brokenfixed is-${mode}${neutral ? ' is-neutral' : ''}`} style={{ ['--lw' as string]: `${ladderWidth(bundle.flow.lanes.length)}px` }}>
      <div className="bf-switch" role="radiogroup" aria-label={neutral ? 'Choose a flow to compare' : 'Show the broken or the fixed flow'}>
        <button type="button" role="radio" aria-checked={mode === 'broken'} className="bf-broken" onClick={() => setMode('broken')}>
          {!neutral && <span aria-hidden="true">✕</span>} {labels[0]}
        </button>
        <button type="button" role="radio" aria-checked={mode === 'fixed'} className="bf-fixed" onClick={() => setMode('fixed')}>
          {!neutral && <span aria-hidden="true">✓</span>} {labels[1]}
        </button>
      </div>
      <FlowStage key={mode} {...bundle} eyebrow={mode === 'broken' ? labels[0] : labels[1]} />
    </div>
  );
}
