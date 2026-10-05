/** A field of a binary header, by bit offset, for the bit-map diagrams (src/diagrams/BitMap.tsx). */
export interface BitField {
  key: string;
  /** Short label in the cell, when it differs from the key. */
  label?: string;
  name: string;
  /** Bit offset from the start of the packet, and length in bits. */
  bit: number;
  bits: number;
  shown: string;
  /** Colour group: a CSS class p-<part>. */
  part: string;
}
