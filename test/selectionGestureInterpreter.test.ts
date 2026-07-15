import { expect, test } from 'bun:test';
import type {
  BringsError,
  EditorSnapshot,
  NodeId,
  Result,
  SelectionResizeProposal,
  StructuralSelection,
} from '@vectojs/brings-core';
import {
  pageDeltaBetween,
  pageRectBetween,
  viewportPoint,
  viewportToPagePoint,
  type PageDelta,
} from '../src/editor/selectionCoordinates';
import type {
  MoveInteractionProposal,
  ResizeInteractionProposal,
  SelectionProposal,
} from '../src/editor/selectionInteraction';
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

function moveAlignment(): MoveInteractionProposal {
  return {
    token: { documentRevision: 3, selectionGeneration: 2 },
    selection: selection([first]),
    rawDelta: { x: 34, y: 0 } as PageDelta,
    delta: { x: 40, y: 0 } as PageDelta,
    guides: [
      {
        axis: 'x',
        sourceAnchor: 'max',
        targetAnchor: 'min',
        targetNodeId: second,
        coordinate: 100,
        minExtent: 10,
        maxExtent: 150,
      },
    ],
  };
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

  state.interpreter.apply({
    kind: 'preview',
    visual: { selection: visual().selection, marquee: null, movementDelta: delta },
  });
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

test('guarded-snapshots and deeply freezes move alignment before commit', () => {
  let committed:
    | Readonly<{
        proposal: SelectionProposal;
        delta: PageDelta;
        alignment?: MoveInteractionProposal;
      }>
    | undefined;
  const interpreter = new SelectionGestureInterpreter({
    commitSelection: () => ({ ok: true, value: snapshot() }),
    commitMove: (value) => {
      committed = value;
      return { ok: true, value: snapshot() };
    },
    reportInteractionError: () => undefined,
    markDirty: () => undefined,
  });
  const source = moveAlignment();
  const sourceDelta = { x: 40, y: 0 } as PageDelta;

  expect(
    interpreter.apply({
      kind: 'commit-move',
      proposal: proposal([first]),
      delta: sourceDelta,
      alignment: source,
    }),
  ).toBe(true);
  (source.rawDelta as { x: number }).x = 999;
  (source.delta as { x: number }).x = 999;
  (source.guides as unknown as Array<{ coordinate: number }>)[0]!.coordinate = 999;
  (source.selection.nodeIds as unknown as NodeId[]).push(second);
  (sourceDelta as { x: number }).x = 999;

  expect(committed).toMatchObject({
    delta: { x: 40, y: 0 },
    alignment: moveAlignment(),
  });
  expect(committed?.alignment).not.toBe(source);
  expect(Object.isFrozen(committed)).toBe(true);
  expect(Object.isFrozen(committed?.delta)).toBe(true);
  expect(Object.isFrozen(committed?.alignment)).toBe(true);
  expect(Object.isFrozen(committed?.alignment?.token)).toBe(true);
  expect(Object.isFrozen(committed?.alignment?.selection.nodeIds)).toBe(true);
  expect(Object.isFrozen(committed?.alignment?.rawDelta)).toBe(true);
  expect(Object.isFrozen(committed?.alignment?.delta)).toBe(true);
  expect(Object.isFrozen(committed?.alignment?.guides)).toBe(true);
  expect(Object.isFrozen(committed?.alignment?.guides[0])).toBe(true);
});

test('rejects a move commit whose alignment accessor installs a newer preview', () => {
  let commits = 0;
  let interpreter!: SelectionGestureInterpreter;
  const newer = visual([second]);
  interpreter = new SelectionGestureInterpreter({
    commitSelection: () => ({ ok: true, value: snapshot() }),
    commitMove: () => {
      commits += 1;
      return { ok: true, value: snapshot() };
    },
    reportInteractionError: () => undefined,
    markDirty: () => undefined,
  });
  interpreter.apply({ kind: 'preview', visual: visual([first]) });
  const effect = Object.defineProperties(
    {
      kind: 'commit-move' as const,
      proposal: proposal([first]),
      delta: { x: 40, y: 0 } as PageDelta,
    },
    {
      alignment: {
        get() {
          interpreter.apply({ kind: 'preview', visual: newer });
          return moveAlignment();
        },
      },
    },
  ) as Extract<SelectionGestureEffect, { kind: 'commit-move' }>;

  expect(interpreter.apply(effect)).toBe(false);
  expect(commits).toBe(0);
  expect(interpreter.visual).toEqual(newer);
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
      selection: base.selection,
      marquee: null,
      movementDelta: { x: 0, y: 0 } as PageDelta,
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
  state.interpreter.apply({ kind: 'preview', visual: accessorVisual as SelectionGestureVisual });

  expect(state.interpreter.visual).toEqual(nested);
  expect(state.dirtyCalls()).toBe(2);
});

test('reads the effect discriminant once and rejects a stale reentrant effect', () => {
  const state = fixture();
  const nested = visual([second]);
  const outer = visual([first]);
  let kindReads = 0;
  const effect = {
    get kind() {
      kindReads += 1;
      if (kindReads === 1) state.interpreter.apply({ kind: 'preview', visual: nested });
      return 'preview' as const;
    },
    visual: outer,
  } as SelectionGestureEffect;

  expect(state.interpreter.apply(effect)).toBe(false);

  expect(kindReads).toBe(1);
  expect(state.interpreter.visual).toEqual(nested);
  expect(state.dirtyCalls()).toBe(1);
});

test('reports deeply detached frozen commit and discard diagnostics with one accessor read', () => {
  let commitCode = 'test.commit-source';
  let commitPath = '/commit/source';
  let commitCodeReads = 0;
  let commitPathReads = 0;
  const commitError = {
    get code() {
      commitCodeReads += 1;
      return commitCode;
    },
    get path() {
      commitPathReads += 1;
      return commitPath;
    },
  };
  const commit = fixture({ selectionFailure: commitError });

  commit.interpreter.apply({ kind: 'commit-selection', proposal: proposal([]) });
  commitCode = 'test.commit-mutated';
  commitPath = '/commit/mutated';

  expect(commitCodeReads).toBe(1);
  expect(commitPathReads).toBe(1);
  expect(commit.errors).toEqual([{ code: 'test.commit-source', path: '/commit/source' }]);
  expect(commit.errors[0]).not.toBe(commitError);
  expect(Object.isFrozen(commit.errors[0])).toBe(true);

  let discardCode = 'test.discard-source';
  let discardPath = '/discard/source';
  let discardCodeReads = 0;
  let discardPathReads = 0;
  const discardError = {
    get code() {
      discardCodeReads += 1;
      return discardCode;
    },
    get path() {
      discardPathReads += 1;
      return discardPath;
    },
  };
  const discard = fixture();

  discard.interpreter.apply({ kind: 'discard', reason: 'error', error: discardError });
  discardCode = 'test.discard-mutated';
  discardPath = '/discard/mutated';

  expect(discardCodeReads).toBe(1);
  expect(discardPathReads).toBe(1);
  expect(discard.errors).toEqual([{ code: 'test.discard-source', path: '/discard/source' }]);
  expect(discard.errors[0]).not.toBe(discardError);
  expect(Object.isFrozen(discard.errors[0])).toBe(true);
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

  state.interpreter.apply({ kind: 'preview', visual: accessorVisual as SelectionGestureVisual });

  expect(state.interpreter.visual).toBeNull();
  expect(state.selectionCommits).toEqual([proposal([second])]);
  expect(state.dirtyCalls()).toBe(1);
});

function resizeProposal(): ResizeInteractionProposal {
  const resize: SelectionResizeProposal = {
    handle: 'south-east',
    anchor: { x: 10, y: 20 },
    scaleX: 2,
    scaleY: 3,
    bounds: { minX: 10, minY: 20, maxX: 110, maxY: 170 },
    command: {
      kind: 'apply-transform-delta',
      nodeIds: [first],
      delta: [2, 0, 0, 3, -10, -40],
    },
  };
  return {
    token: { documentRevision: 3, selectionGeneration: 2 },
    selection: selection([first]),
    input: {
      handle: 'south-east',
      startPoint: { x: 60, y: 70 },
      currentPoint: { x: 110, y: 170 },
      preserveAspectRatio: false,
      fromCenter: false,
    },
    resize,
    guides: [],
  };
}

test('owns one detached resize visual and routes its exact proposal through commit-resize', () => {
  const commits: ResizeInteractionProposal[] = [];
  let dirty = 0;
  const interpreter = new SelectionGestureInterpreter({
    commitSelection: () => ({ ok: true, value: snapshot() }),
    commitMove: () => ({ ok: true, value: snapshot() }),
    commitResize: (value) => {
      commits.push(value);
      return { ok: true, value: snapshot() };
    },
    reportInteractionError: () => undefined,
    markDirty: () => {
      dirty += 1;
    },
  });
  const proposal = resizeProposal();
  const mutable = {
    selection: selection([first]),
    marquee: null,
    movementDelta: null,
    resize: proposal.resize,
  };

  expect(interpreter.apply({ kind: 'preview', visual: mutable })).toBe(false);
  (proposal.resize.command.delta as unknown as number[])[0] = 99;

  expect(interpreter.visual?.resize?.command.delta[0]).toBe(2);
  expect(Object.isFrozen(interpreter.visual?.resize?.command.delta)).toBe(true);
  expect(interpreter.apply({ kind: 'commit-resize', proposal: resizeProposal() })).toBe(true);
  expect(commits).toEqual([resizeProposal()]);
  expect(interpreter.visual).toBeNull();
  expect(dirty).toBe(2);
});

test('reports a resize commit failure once and preserves a newer reentrant preview', () => {
  let interpreter!: SelectionGestureInterpreter;
  const error = { code: 'interaction.stale', path: '/interaction' };
  const newer = visual([second]);
  interpreter = new SelectionGestureInterpreter({
    commitSelection: () => ({ ok: true, value: snapshot() }),
    commitMove: () => ({ ok: true, value: snapshot() }),
    commitResize: () => ({ ok: false, error }),
    reportInteractionError: () => {
      interpreter.apply({ kind: 'preview', visual: newer });
    },
    markDirty: () => undefined,
  });
  const proposal = resizeProposal();
  interpreter.apply({
    kind: 'preview',
    visual: {
      selection: proposal.selection,
      marquee: null,
      movementDelta: null,
      resize: proposal.resize,
    },
  });

  expect(interpreter.apply({ kind: 'commit-resize', proposal })).toBe(false);
  expect(interpreter.visual).toEqual(newer);
});

test('contains a thrown resize commit, clears its preview once, and reports one stable error', () => {
  const errors: BringsError[] = [];
  let dirty = 0;
  const durableRevision = 7;
  const interpreter = new SelectionGestureInterpreter({
    commitSelection: () => ({ ok: true, value: snapshot() }),
    commitMove: () => ({ ok: true, value: snapshot() }),
    commitResize: () => {
      throw new Error('Core commit escaped');
    },
    reportInteractionError: (error) => errors.push(error),
    markDirty: () => {
      dirty += 1;
    },
  });
  const proposal = resizeProposal();
  interpreter.apply({
    kind: 'preview',
    visual: {
      selection: proposal.selection,
      marquee: null,
      movementDelta: null,
      resize: proposal.resize,
    },
  });

  expect(interpreter.apply({ kind: 'commit-resize', proposal })).toBe(false);
  expect(interpreter.visual).toBeNull();
  expect(errors).toEqual([{ code: 'interaction.commit-threw', path: '/commitResize' }]);
  expect(dirty).toBe(2);
  expect(durableRevision).toBe(7);
});
