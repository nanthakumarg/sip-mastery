/**
 * Shared player logic and controls. The controls look and behave the same in
 * every diagram (COURSE_STRUCTURE §5.5):
 * ⏮ first · ◀ back · ▶ play / ❚❚ pause · ▶| next · ↺ reset · step slider · optional speed;
 * keys: ←/→ step, Space play, Home/End jump.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';

/** Player icons (14×14), drawn so they look the same on every platform. */
const ICON = {
  first: 'M2 2h2v10H2zM12 2v10L5 7z',
  prev: 'M11 2v10L4 7z',
  play: 'M4 2v10l8-5z',
  pause: 'M3 2h3v10H3zM8 2h3v10H8z',
  next: 'M3 2v10l7-5zM10 2h2v10h-2z',
};
const Icon = ({ d }: { d: string }) => <svg viewBox="0 0 14 14" aria-hidden="true"><path d={d} /></svg>;
const ResetIcon = () => (
  <svg viewBox="0 0 14 14" aria-hidden="true">
    <path d="M11.6 7.4A4.6 4.6 0 1 1 7 2.4h1.6" style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 }} />
    <path d="M8 .2l3 2.2-3 2.2z" />
  </svg>
);

export const SPEEDS = [0.5, 1, 2] as const;

export interface Player {
  current: number;
  last: number;
  playing: boolean;
  speed: number;
  go: (i: number) => void;
  toggle: () => void;
  setSpeed: (s: number) => void;
  onKey: (e: KeyboardEvent) => void;
}

/**
 * @param count number of steps
 * @param msPerStep time per step at 1× while playing
 * @param start the first step to show
 */
export function usePlayer(count: number, msPerStep = 2400, start = 0): Player {
  const last = count - 1;
  const [current, setCurrent] = useState(start);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  // Autoplay: one step per interval, stop at the end.
  useEffect(() => {
    if (!playing) return;
    if (current >= last) { setPlaying(false); return; }
    const t = setTimeout(() => setCurrent(c => Math.min(c + 1, last)), msPerStep / speed);
    return () => clearTimeout(t);
  }, [playing, current, last, msPerStep, speed]);

  const go = (i: number) => { setPlaying(false); setCurrent(Math.max(0, Math.min(last, i))); };
  const toggle = () => {
    if (current >= last && !playing) { setCurrent(0); setPlaying(true); } else setPlaying(p => !p);
  };
  const onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('.insp-msg, input, button, select, a')) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); go(current + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(current - 1); }
    else if (e.key === ' ') { e.preventDefault(); toggle(); }
    else if (e.key === 'Home') { e.preventDefault(); go(0); }
    else if (e.key === 'End') { e.preventDefault(); go(last); }
  };
  return { current, last, playing, speed, go, toggle, setSpeed, onKey };
}

export function PlayerControls({ p, withSpeed = false }: { p: Player; withSpeed?: boolean }) {
  return (
    <div className="stage-controls" role="group" aria-label="Player">
      <button type="button" onClick={() => p.go(0)} disabled={p.current === 0} aria-label="First step" title="First step (Home)"><Icon d={ICON.first} /></button>
      <button type="button" onClick={() => p.go(p.current - 1)} disabled={p.current === 0} aria-label="Previous step" title="Previous step (←)"><Icon d={ICON.prev} /></button>
      <button type="button" className="play" onClick={p.toggle} aria-label={p.playing ? 'Pause' : 'Play'} title="Play / pause (Space)">
        <Icon d={p.playing ? ICON.pause : ICON.play} />
      </button>
      <button type="button" onClick={() => p.go(p.current + 1)} disabled={p.current === p.last} aria-label="Next step" title="Next step (→)"><Icon d={ICON.next} /></button>
      <button type="button" onClick={() => p.go(0)} aria-label="Reset" title="Reset"><ResetIcon /></button>
      <input type="range" min={0} max={p.last} value={p.current} onChange={e => p.go(Number(e.target.value))} aria-label="Step" />
      {withSpeed && (
        <div className="speed" role="radiogroup" aria-label="Playback speed">
          {SPEEDS.map(s => (
            <button key={s} type="button" role="radio" aria-checked={p.speed === s} onClick={() => p.setSpeed(s)}>{s}×</button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Full-screen mode: page scroll locked, Esc closes, focus returns to the button. */
export function useExpand(target: RefObject<HTMLElement | null>) {
  const [expanded, setExpanded] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!expanded) return;
    const root = document.documentElement;
    root.classList.add('stage-open');
    target.current?.focus();
    const onEsc = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false); };
    window.addEventListener('keydown', onEsc);
    return () => {
      root.classList.remove('stage-open');
      window.removeEventListener('keydown', onEsc);
      button.current?.focus();
    };
  }, [expanded, target]);
  return { expanded, setExpanded, button };
}

export function ExpandButton({ x }: { x: ReturnType<typeof useExpand> }) {
  return (
    <button type="button" ref={x.button} className="stage-expand" onClick={() => x.setExpanded(e => !e)}
      aria-pressed={x.expanded} title={x.expanded ? 'Close full screen (Esc)' : 'Open full screen'}>
      <svg viewBox="0 0 14 14" aria-hidden="true"><path d={x.expanded ? 'M5 1v4H1M9 1v4h4M5 13V9H1M9 13V9h4' : 'M1 5V1h4M13 5V1H9M1 9v4h4M13 9v4H9'} /></svg>
      {x.expanded ? 'Close' : 'Expand'}
    </button>
  );
}
