/**
 * Broken / Fixed toggle (COURSE_STRUCTURE §5.5): one switch moves a diagram
 * between the mistake and the correct behaviour. Opens on "Broken".
 */
import { useState } from 'react';
import FlowStage from './FlowStage.tsx';
import { ladderWidth } from './Ladder.tsx';
import type { FlowBundle } from './types.ts';

interface Props {
  broken: FlowBundle;
  fixed: FlowBundle;
}

export default function BrokenFixed({ broken, fixed }: Props) {
  const [mode, setMode] = useState<'broken' | 'fixed'>('broken');
  const bundle = mode === 'broken' ? broken : fixed;
  return (
    <div className={`brokenfixed is-${mode}`} style={{ ['--lw' as string]: `${ladderWidth(bundle.flow.lanes.length)}px` }}>
      <div className="bf-switch" role="radiogroup" aria-label="Show the broken or the fixed flow">
        <button type="button" role="radio" aria-checked={mode === 'broken'} className="bf-broken" onClick={() => setMode('broken')}>
          <span aria-hidden="true">✕</span> Broken
        </button>
        <button type="button" role="radio" aria-checked={mode === 'fixed'} className="bf-fixed" onClick={() => setMode('fixed')}>
          <span aria-hidden="true">✓</span> Fixed
        </button>
      </div>
      <FlowStage key={mode} {...bundle} eyebrow={mode === 'broken' ? 'Broken' : 'Fixed'} />
    </div>
  );
}
