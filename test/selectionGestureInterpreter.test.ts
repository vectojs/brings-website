import { expect, test } from 'bun:test';
import type {
  BringsError,
  EditorSnapshot,
  NodeId,
  Result,
  StructuralSelection,
} from '@vectojs/brings-core';
import {
  pageDeltaBetween,
  pageRectBetween,
  viewportPoint,
  viewportToPagePoint,
} from '../src/editor/selectionCoordinates';
import type { SelectionProposal } from '../src/editor/selectionInteraction';
import type {
  SelectionGestureEffect,
  SelectionGestureVisual,
} from '../src/view/MarqueeSelectionSession';
import { SelectionGestureInterpreter } from '../src/view/SelectionGestureInterpreter';

const first = '11111111-1111-4111-8111-111111111111' as NodeId;
const second = '22222222-2222-4222-8222-222222222222' as NodeId;

function unwrap<T>(result: Readonly<{ ok: true; value: T }> | Readonly<{ ok: false }>): T {
  if (!result.ok) throw new Error('Fixture coordinate was rejected.');
  return result.value;
}

function selection(nodeIds: readonly NodeId[]): StructuralSelection {
  return { nodeIds: [...nodeIds], activeNodeId: nodeIds.at(-1) ?? null };
}

function proposal(nodeIds: readonly NodeId[]): SelectionProposal {
  return {
    token: { documentRevision: 3, selectionGeneration: 2 },
    originalSelection: selection([first]),
    selection: selection(nodeIds),
  };
}

function visual(nodeIds: readonly NodeId[] = [first]): SelectionGestureVisual {
  const start = unwrap(viewportToPagePoint(unwrap(viewportPoint(10, 20))));
  const end = unwrap(viewportToPagePoint(unwrap(viewportPoint(40, 60))));
  return {
    selection: selection(nodeIds),
    marquee: unwrap(pageRectBetween(start, end)),
    movementDelta: null,
  };
}

function snapshot(): EditorSnapshot {
  return {} as EditorSnapshot;
}

function fixture(
  input: Readonly<{ selectionFailure?: BringsError; moveFailure?: BringsError }> = {},
) {
  let dirtyCalls = 0;
  const errors: BringsError[] = [];
  const selectionCommits: SelectionProposal[] = [];
  const moveCommits: Array<
    Readonly<{ proposal: SelectionProposal; delta: { x: number; y: number } }>
  > = [];
  const interpreter = new SelectionGestureInterpreter({
    commitSelection(value) {
      selectionCommits.push(value);
      return input.selectionFailure === undefined
        ? { ok: true, value: snapshot() }
        : { ok: false, error: input.selectionFailure };
    },
    commitMove(value) {
      moveCommits.push(value);
      return input.moveFailure === undefined
        ? { ok: true, value: snapshot() }
        : { ok: false, error: input.moveFailure };
    },
    reportInteractionError(error) {
      errors.push(error);
    },
    markDirty() {
      dirtyCalls += 1;
    },
  });
  return {
    interpreter,
    errors,
    selectionCommits,
    moveCommits,
    dirtyCalls: () => dirtyCalls,
  };
}

test('owns a deeply detached frozen preview and deduplicates semantic repeats', () => {
  const state = fixture();
  const source = visual();
  const mutable: {
    selection: { nodeIds: NodeId[]; activeNodeId: NodeId | null };
    marquee: { x: number; y: number; width: number; height: number };
    movementDelta: null;
  } = {
    selection: {
      nodeIds: [...source.selection.nodeIds],
      activeNodeId: source.selection.activeNodeId,
    },
    marquee: { ...source.marquee! },
    movementDelta: null,
  };

  expect(state.interpreter.apply({ kind: 'preview', visual: mutable })).toBe(false);
  mutable.selection.nodeIds.push(second);
  mutable.marquee.x = 999;

  expect(state.interpreter.visual).toEqual(visual());
  expect(Object.isFrozen(state.interpreter.visual)).toBe(true);
  expect(Object.isFrozen(state.interpreter.visual?.selection)).toBe(true);
  expect(Object.isFrozen(state.interpreter.visual?.selection.nodeIds)).toBe(true);
  expect(state.dirtyCalls()).toBe(1);

  expect(state.interpreter.apply({ kind: 'preview', visual: visual() })).toBe(false);
  expect(state.dirtyCalls()).toBe(1);
});

test('commits selection once, clears a visible preview, and marks one frame', () => {
  const state = fixture();
  const next = proposal([second]);
  state.interpreter.apply({ kind: 'preview', visual: visual([second]) });

  expect(state.interpreter.apply({ kind: 'commit-selection', proposal: next })).toBe(true);

  expect(state.selectionCommits).toEqual([next]);
  expect(state.interpreter.visual).toBeNull();
  expect(state.dirtyCalls()).toBe(2);
  expect(state.errors).toEqual([]);
});

test('reports a failed click without dirtying and clears a failed preview commit once', () => {
  const error = { code: 'interaction.stale', path: '/token' };
  const click = fixture({ selectionFailure: error });

  expect(click.interpreter.apply({ kind: 'commit-selection', proposal: proposal([]) })).toBe(false);
  expect(click.errors).toEqual([error]);
  expect(click.dirtyCalls()).toBe(0);

  const drag = fixture({ selectionFailure: error });
  drag.interpreter.apply({ kind: 'preview', visual: visual() });
  expect(drag.interpreter.apply({ kind: 'commit-selection', proposal: proposal([]) })).toBe(false);
  expect(drag.errors).toEqual([error]);
  expect(drag.interpreter.visual).toBeNull();
  expect(drag.dirtyCalls()).toBe(2);
});

test('commits a move through one object input and reports discard errors once', () => {
  const state = fixture();
  const start = unwrap(viewportToPagePoint(unwrap(viewportPoint(2, 3))));
  const end = unwrap(viewportToPagePoint(unwrap(viewportPoint(12, 18))));
  const delta = unwrap(pageDeltaBetween(start, end));
  const next = proposal([first]);

  state.interpreter.apply({ kind: 'preview', visual: { ...visual(), movementDelta: delta } });
  expect(state.interpreter.apply({ kind: 'commit-move', proposal: next, delta })).toBe(true);
  expect(state.moveCommits).toEqual([{ proposal: next, delta }]);
  expect(state.dirtyCalls()).toBe(2);

  state.interpreter.apply({ kind: 'preview', visual: visual() });
  const error = { code: 'interaction.coordinate-invalid', path: '/viewport/x' };
  const discard: SelectionGestureEffect = { kind: 'discard', reason: 'error', error };
  expect(state.interpreter.apply(discard)).toBe(false);
  expect(state.errors).toEqual([error]);
  expect(state.interpreter.visual).toBeNull();
  expect(state.dirtyCalls()).toBe(4);

  expect(state.interpreter.apply({ kind: 'ignore' })).toBe(false);
  expect(state.dirtyCalls()).toBe(4);
});

test('treats node order, active identity, and null versus zero delta as visual semantics', () => {
  const state = fixture();
  const base = visual([first, second]);
  state.interpreter.apply({ kind: 'preview', visual: base });
  state.interpreter.apply({
    kind: 'preview',
    visual: {
      ...base,
      selection: { nodeIds: [second, first], activeNodeId: first },
    },
  });
  state.interpreter.apply({
    kind: 'preview',
    visual: {
      ...base,
      marquee: null,
      movementDelta: { x: 0, y: 0 } as typeof base.movementDelta,
    },
  });
  state.interpreter.apply({
    kind: 'preview',
    visual: { ...base, marquee: null, movementDelta: null },
  });

  expect(state.dirtyCalls()).toBe(4);
});

test('reads commit result and error accessors once', () => {
  let okReads = 0;
  let errorReads = 0;
  const error = { code: 'test.accessor', path: '/result' };
  const reported: BringsError[] = [];
  const interpreter = new SelectionGestureInterpreter({
    commitSelection: () =>
      ({
        get ok() {
          okReads += 1;
          return false;
        },
        get error() {
          errorReads += 1;
          return error;
        },
      }) as Result<EditorSnapshot>,
    commitMove: () => ({ ok: true, value: snapshot() }),
    reportInteractionError: (value) => reported.push(value),
    markDirty: () => undefined,
  });

  interpreter.apply({ kind: 'commit-selection', proposal: proposal([]) });

  expect(okReads).toBe(1);
  expect(errorReads).toBe(1);
  expect(reported).toEqual([error]);
});

test('does not let an outer commit overwrite a preview created reentrantly by its port', () => {
  let dirtyCalls = 0;
  let interpreter!: SelectionGestureInterpreter;
  const nested = visual([second]);
  interpreter = new SelectionGestureInterpreter({
    commitSelection: () => {
      interpreter.apply({ kind: 'preview', visual: nested });
      return { ok: true, value: snapshot() };
    },
    commitMove: () => ({ ok: true, value: snapshot() }),
    reportInteractionError: () => undefined,
    markDirty: () => {
      dirtyCalls += 1;
    },
  });
  interpreter.apply({ kind: 'preview', visual: visual([first]) });

  expect(interpreter.apply({ kind: 'commit-selection', proposal: proposal([first]) })).toBe(true);
  expect(interpreter.visual).toEqual(nested);
  expect(dirtyCalls).toBe(2);
});

test('preserves a preview created reentrantly while reporting a commit failure', () => {
  let interpreter!: SelectionGestureInterpreter;
  const nested = visual([second]);
  const error = { code: 'test.reentrant-report', path: '/commit' };
  interpreter = new SelectionGestureInterpreter({
    commitSelection: () => ({ ok: false, error }),
    commitMove: () => ({ ok: true, value: snapshot() }),
    reportInteractionError: () => {
      interpreter.apply({ kind: 'preview', visual: nested });
    },
    markDirty: () => undefined,
  });
  interpreter.apply({ kind: 'preview', visual: visual([first]) });

  interpreter.apply({ kind: 'commit-selection', proposal: proposal([first]) });

  expect(interpreter.visual).toEqual(nested);
});

test('does not let an accessor-backed outer preview overwrite a reentrant preview', () => {
  const state = fixture();
  const nested = visual([second]);
  const outer = visual([first]);
  const accessorVisual = {
    get selection() {
      state.interpreter.apply({ kind: 'preview', visual: nested });
      return outer.selection;
    },
    get marquee() {
      return outer.marquee;
    },
    get movementDelta() {
      return outer.movementDelta;
    },
  };
  state.interpreter.apply({ kind: 'preview', visual: visual([]) });
  state.interpreter.apply({ kind: 'preview', visual: accessorVisual });

  expect(state.interpreter.visual).toEqual(nested);
  expect(state.dirtyCalls()).toBe(2);
});

test('does not install an outer preview after its accessor commits Core reentrantly', () => {
  const state = fixture();
  const outer = visual([first]);
  const accessorVisual = {
    get selection() {
      state.interpreter.apply({ kind: 'commit-selection', proposal: proposal([second]) });
      return outer.selection;
    },
    get marquee() {
      return outer.marquee;
    },
    get movementDelta() {
      return outer.movementDelta;
    },
  };

  state.interpreter.apply({ kind: 'preview', visual: accessorVisual });

  expect(state.interpreter.visual).toBeNull();
  expect(state.selectionCommits).toEqual([proposal([second])]);
  expect(state.dirtyCalls()).toBe(1);
});
