/**
 * A packet drawn 32 bits to a row, as the RFCs draw headers (Modules 16, 17).
 * Each field is a button; long fields (more than two rows) take one row.
 */
import type { BitField } from '../net/bits.ts';

export type { BitField };

interface Seg { f: BitField; row: number; col: number; span: number; first: boolean }

/** Cuts each field into row segments of a 32-bit grid. Long fields take one full row. */
export function layout(fields: BitField[]): Seg[] {
  const segs: Seg[] = [];
  let shift = 0; // rows saved by drawing long fields as one row
  for (const f of fields) {
    let bit = f.bit - shift * 32;
    if (f.bits > 64) {
      segs.push({ f, row: Math.floor(bit / 32), col: 0, span: 32, first: true });
      shift += Math.ceil(f.bits / 32) - 1;
      continue;
    }
    let left = f.bits, first = true;
    while (left > 0) {
      const col = bit % 32, span = Math.min(left, 32 - col);
      segs.push({ f, row: Math.floor(bit / 32), col, span, first });
      bit += span; left -= span; first = false;
    }
  }
  return segs;
}

export default function BitMap({ fields, sel, onSelect, label }: { fields: BitField[]; sel?: string; onSelect: (key: string) => void; label: string }) {
  const segs = layout(fields);
  const rows = segs.length ? Math.max(...segs.map(s => s.row)) + 1 : 0;
  return (
    <>
      <div className="rtph-ruler" aria-hidden="true">
        {Array.from({ length: 32 }, (_, i) => <span key={i}>{i % 8 === 0 ? i : ''}</span>)}
      </div>
      <div className="rtph-map" style={{ gridTemplateRows: `repeat(${rows}, auto)` }} role="group" aria-label={label}>
        {segs.map((s, i) => (
          <button key={i} type="button"
            className={`rtph-cell p-${s.f.part}${s.f.key === sel ? ' is-sel' : ''}${s.span < 3 ? ' is-narrow' : ''}`}
            style={{ gridRow: s.row + 1, gridColumn: `${s.col + 1} / span ${s.span}` }}
            onClick={() => onSelect(s.f.key)} aria-pressed={s.f.key === sel}
            title={`${s.f.name}: ${s.f.shown}`}>
            <span className="rtph-k">{s.first ? s.f.label ?? s.f.key : ''}</span>
            {s.first && s.span >= 3 && <span className="rtph-v">{s.f.shown}</span>}
          </button>
        ))}
      </div>
    </>
  );
}
