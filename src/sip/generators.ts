/**
 * The flow generators behind the FlowBuilder island (Modules 21 and 22), each
 * with the options it shows. One island renders any of them from this table.
 */
import type { FlowData } from './flow.ts';
import {
  allCalls, applyChange, buildCall, CALL_QUOTES, callKey, DEFAULT_CALL, FORWARDS, inactive, LOSSES, OUTCOMES, PATHS,
} from './callflow.ts';
import {
  allReinvites, applyReinvite, buildReinvite, CHANGES, DEFAULT_REINVITE, METHODS, REINVITE_QUOTES, reinviteKey, RESULTS, SENDERS,
} from './reinvite.ts';
import {
  allTransfers, applyTransfer, buildTransfer, DEFAULT_TRANSFER, HANGUPS, TARGETS, TRANSFER_QUOTES, transferInactive, transferKey, TYPES,
} from './transfer.ts';

/** One row of controls: a choice of values for one option, or on/off toggles. */
export type Row =
  | { kind: 'choice'; label: string; key: string; items: Record<string, string> }
  | { kind: 'toggles'; label: string; items: [key: string, label: string][] };

type Options = Record<string, string | boolean>;

export interface Generator {
  rows: Row[];
  defaults: Options;
  /** Applies one change; the option that changed wins, and others move (with a note each). */
  apply(o: Options, change: Options): { options: Options; notes: string[] };
  /** Options that have no effect now, with the reason. */
  inactive(o: Options): Record<string, string | undefined>;
  /** The flow id is `${kind}-${key(o)}`. */
  key(o: Options): string;
  build(o: Options): FlowData;
  quotes: readonly string[];
  all(): Options[];
}

// The generators have typed options; the table works with plain records.
const wrap = (g: { [K in keyof Generator]: any }): Generator => g as Generator;

export const GENERATORS = {
  call: wrap({
    rows: [
      { kind: 'choice', label: 'Path', key: 'path', items: PATHS },
      { kind: 'choice', label: 'Outcome', key: 'outcome', items: OUTCOMES },
      { kind: 'toggles', label: 'What if', items: [['recordRoute', 'Record-Route'], ['auth', '407 challenge'], ['lateOffer', 'Late offer'], ['earlyMedia', 'Early media (183)']] },
      { kind: 'choice', label: 'Lost packet', key: 'lose', items: LOSSES },
      { kind: 'choice', label: 'Forwarding', key: 'forward', items: FORWARDS },
      { kind: 'choice', label: 'Hangs up', key: 'hangup', items: { alice: 'Alice', bob: 'Bob' } },
    ],
    defaults: DEFAULT_CALL, apply: applyChange, inactive, key: callKey, build: buildCall, quotes: CALL_QUOTES, all: allCalls,
  }),
  reinvite: wrap({
    rows: [
      { kind: 'choice', label: 'Change', key: 'change', items: CHANGES },
      { kind: 'choice', label: 'Method', key: 'method', items: METHODS },
      { kind: 'choice', label: 'Sent by', key: 'by', items: SENDERS },
      { kind: 'choice', label: 'Result', key: 'result', items: RESULTS },
    ],
    defaults: DEFAULT_REINVITE, apply: applyReinvite, inactive: () => ({}), key: reinviteKey, build: buildReinvite, quotes: REINVITE_QUOTES, all: allReinvites,
  }),
  transfer: wrap({
    rows: [
      { kind: 'choice', label: 'Transfer', key: 'type', items: TYPES },
      { kind: 'choice', label: 'Carol', key: 'target', items: TARGETS },
      { kind: 'choice', label: 'Alice hangs up', key: 'hangup', items: HANGUPS },
      { kind: 'toggles', label: 'What if', items: [['hold', 'Alice holds Bob first']] },
    ],
    defaults: DEFAULT_TRANSFER, apply: applyTransfer, inactive: transferInactive, key: transferKey, build: buildTransfer, quotes: TRANSFER_QUOTES, all: allTransfers,
  }),
};

export type GeneratorKind = keyof typeof GENERATORS;

/** Every quote id any generator can attach to a step. */
export const GENERATOR_QUOTES = [...new Set(Object.values(GENERATORS).flatMap(g => [...g.quotes]))];
