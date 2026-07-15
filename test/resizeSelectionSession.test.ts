import { expect, test } from 'bun:test';
import type {
  AlignmentGuide,
  BringsError,
  NodeId,
  ResizeHandle,
  Result,
  SelectionResizeProposal,
  StructuralSelection,
} from '@vectojs/brings-core';
import type {
  ResizeInteractionProposal,
  ResizeInteractionStart,
  ResizeProposalProvider,
} from '../src/editor/selectionInteraction';
import {
  ResizeSelectionSession,
  type ResizePointerSample,
} from '../src/view/ResizeSelectionSession';

const first = '11111111-1111-4111-8111-111111111111' as NodeId;

function selection(): StructuralSelection {
  return { nodeIds: [first], activeNodeId: first };
}

function start(): ResizeInteractionStart {
  return {
    token: { documentRevision: 7, selectionGeneration: 3 },
    selection: selection(),
    bounds: { minX: 10, minY: 20, maxX: 110, maxY: 70 },
    handles: [
      { handle: 'north-west', point: { x: 10, y: 20 } },
      { handle: 'south-east', point: { x: 110, y: 70 } },
    ],
  };
}

function sample(
  pointerId: number,
  x: number,
  y: number,
  shiftKey = false,
  altKey = false,
): ResizePointerSample {
  return { pointerId, pagePoint: { x, y }, shiftKey, altKey };
}

function resizeValue(
  handle: ResizeHandle,
  scaleX: number,
  scaleY: number,
): SelectionResizeProposal {
  return {
    handle,
    anchor: { x: 10, y: 20 },
    scaleX,
    scaleY,
    bounds: { minX: 10, minY: 20, maxX: 10 + 100 * scaleX, maxY: 20 + 50 * scaleY },
    command: {
      kind: 'apply-transform-delta',
      nodeIds: [first],
      delta: [scaleX, 0, 0, scaleY, 10 - 10 * scaleX, 20 - 20 * scaleY],
    },
  };
}

function proposal(
  interaction: ResizeInteractionStart,
  handle: ResizeHandle,
  currentX: number,
  currentY: number,
  preserveAspectRatio: boolean,
  fromCenter: boolean,
  scaleX = 2,
  scaleY = 2,
): ResizeInteractionProposal {
  return {
    token: { ...interaction.token },
    selection: selection(),
    input: {
      handle,
      startPoint: { x: 113, y: 73 },
      currentPoint: { x: currentX, y: currentY },
      preserveAspectRatio,
      fromCenter,
    },
    resize: resizeValue(handle, scaleX, scaleY),
    guides: [],
  };
}

function providerFixture(
  interaction: ResizeInteractionStart,
  errors: readonly (BringsError | undefined)[] = [],
) {
  const calls: Array<Readonly<{ x: number; y: number; shift: boolean; alt: boolean }>> = [];
  const provider: ResizeProposalProvider = {
    resize(_start, input): Result<ResizeInteractionProposal> {
      calls.push({
        x: input.currentPoint.x,
        y: input.currentPoint.y,
        shift: input.preserveAspectRatio,
        alt: input.fromCenter,
      });
      const error = errors[calls.length - 1];
      if (error !== undefined) return { ok: false, error };
      return {
        ok: true,
        value: proposal(
          interaction,
          input.handle,
          input.currentPoint.x,
          input.currentPoint.y,
          input.preserveAspectRatio,
          input.fromCenter,
          calls.length + 1,
          calls.length + 1,
        ),
      };
    },
  };
  return { provider, calls };
}

function begin(
  interaction: ResizeInteractionStart,
  initial: ResizePointerSample,
  provider: ResizeProposalProvider,
): ResizeSelectionSession {
  const result = ResizeSelectionSession.begin(interaction, 'south-east', initial, provider);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

test('owns one pointer, preserves arbitrary handle offset, and samples Shift/Alt dynamically', () => {
  const interaction = start();
  const fixture = providerFixture(interaction);
  const session = begin(interaction, sample(4, 113, 73), fixture.provider);

  expect(session.update(sample(9, 150, 100, true, true), fixture.provider)).toEqual({
    kind: 'ignore',
  });
  const firstPreview = session.update(sample(4, 160, 120, true, false), fixture.provider);
  const secondPreview = session.update(sample(4, 170, 130, false, true), fixture.provider);

  expect(fixture.calls).toEqual([
    { x: 160, y: 120, shift: true, alt: false },
    { x: 170, y: 130, shift: false, alt: true },
  ]);
  expect(firstPreview).toMatchObject({
    kind: 'preview',
    visual: { selection: selection(), marquee: null, movementDelta: null },
  });
  expect(secondPreview).toMatchObject({ kind: 'preview', visual: { resize: { scaleX: 3 } } });
  expect(session.snapshot()).toMatchObject({
    phase: 'resizing',
    pointerId: 4,
    handle: 'south-east',
    start: { x: 113, y: 73 },
    current: { x: 170, y: 130 },
    shiftKey: false,
    altKey: true,
  });
});

test('previews and commits the exact frozen Core resize alignment proposal once', () => {
  const interaction = start();
  const guides: readonly AlignmentGuide[] = [
    {
      axis: 'y',
      sourceAnchor: 'max',
      targetAnchor: 'center',
      targetNodeId: first,
      coordinate: 99,
      minExtent: 10,
      maxExtent: 110,
    },
  ];
  const provider: ResizeProposalProvider = {
    resize(startValue, input) {
      const adjusted = { x: input.currentPoint.x, y: 99 };
      return {
        ok: true,
        value: {
          ...proposal(
            startValue,
            input.handle,
            adjusted.x,
            adjusted.y,
            input.preserveAspectRatio,
            input.fromCenter,
          ),
          input: { ...input, currentPoint: adjusted },
          guides,
        } as ResizeInteractionProposal,
      };
    },
  };
  const session = begin(interaction, sample(41, 113, 73), provider);

  const preview = session.update(sample(41, 160, 120), provider);
  expect(preview).toMatchObject({
    kind: 'preview',
    visual: { resize: { bounds: { maxY: 120 } }, guides },
  });
  if (preview.kind !== 'preview') throw new Error('expected a resize preview');
  expect(Object.isFrozen(preview.visual.guides)).toBe(true);
  expect(Object.isFrozen(preview.visual.guides?.[0])).toBe(true);

  const commit = session.finish(sample(41, 240, 260, true, true), provider);
  expect(commit).toMatchObject({
    kind: 'commit-resize',
    proposal: { input: { currentPoint: { x: 160, y: 99 } }, guides },
  });
});

test('rejects a foreign pointer before reading any of its remaining accessors', () => {
  const interaction = start();
  const fixture = providerFixture(interaction);
  const session = begin(interaction, sample(4, 113, 73), fixture.provider);
  let pagePointReads = 0;
  let shiftReads = 0;
  let altReads = 0;
  const foreign = Object.defineProperties(
    {},
    {
      pointerId: { value: 99 },
      pagePoint: {
        get() {
          pagePointReads += 1;
          throw new Error('foreign page point must stay unread');
        },
      },
      shiftKey: {
        get() {
          shiftReads += 1;
          return true;
        },
      },
      altKey: {
        get() {
          altReads += 1;
          return true;
        },
      },
    },
  ) as ResizePointerSample;

  expect(session.update(foreign, fixture.provider)).toEqual({ kind: 'ignore' });
  expect({ pagePointReads, shiftReads, altReads }).toEqual({
    pagePointReads: 0,
    shiftReads: 0,
    altReads: 0,
  });
  expect(session.snapshot()).toMatchObject({ phase: 'resizing', pointerId: 4 });
  expect(session.update(sample(4, 160, 120), fixture.provider)).toMatchObject({
    kind: 'preview',
  });
});

test('retains the last valid preview across singular samples and commits it once on finish', () => {
  const interaction = start();
  const fixture = providerFixture(interaction, [
    undefined,
    { code: 'matrix.singular', path: '/delta' },
    { code: 'matrix.singular', path: '/delta' },
  ]);
  const session = begin(interaction, sample(1, 113, 73), fixture.provider);

  session.update(sample(1, 160, 120), fixture.provider);
  expect(session.update(sample(1, 10, 20), fixture.provider)).toEqual({ kind: 'ignore' });
  const committed = session.finish(sample(1, 10, 20), fixture.provider);

  expect(committed).toEqual({
    kind: 'commit-resize',
    proposal: proposal(interaction, 'south-east', 160, 120, false, false, 2, 2),
  });
  expect(session.finish(sample(1, 180, 140), fixture.provider)).toEqual({ kind: 'ignore' });
  expect(Object.isFrozen(committed)).toBe(true);
  expect(Object.isFrozen(session.snapshot())).toBe(true);
});

test('does not commit identity on zero-motion finish and cancels only the owner once', () => {
  const interaction = start();
  const fixture = providerFixture(interaction);
  const zero = begin(interaction, sample(2, 113, 73), fixture.provider);

  expect(zero.finish(sample(2, 113, 73), fixture.provider)).toEqual({
    kind: 'discard',
    reason: 'no-change',
  });
  expect(fixture.calls).toEqual([]);

  const cancelled = begin(interaction, sample(3, 113, 73), fixture.provider);
  expect(cancelled.cancel({ kind: 'pointercancel', pointerId: 8 })).toEqual({ kind: 'ignore' });
  expect(cancelled.cancel({ kind: 'pointercancel', pointerId: 3 })).toEqual({
    kind: 'discard',
    reason: 'pointercancel',
  });
  expect(cancelled.cancel({ kind: 'escape' })).toEqual({ kind: 'ignore' });
});

test('Escape directly discards one active resize session and ignores every late event', () => {
  const interaction = start();
  const fixture = providerFixture(interaction);
  const session = begin(interaction, sample(12, 113, 73), fixture.provider);

  expect(session.cancel({ kind: 'escape' })).toEqual({ kind: 'discard', reason: 'escape' });
  expect(session.snapshot()).toMatchObject({ phase: 'terminal', terminalEffect: 'discard' });
  expect(session.update(sample(12, 160, 120), fixture.provider)).toEqual({ kind: 'ignore' });
  expect(session.finish(sample(12, 160, 120), fixture.provider)).toEqual({ kind: 'ignore' });
});

test('commits the last displayed resize when pointerup returns to its origin', () => {
  const interaction = start();
  let calls = 0;
  const provider: ResizeProposalProvider = {
    resize(_start, input) {
      calls += 1;
      const identity =
        input.currentPoint.x === input.startPoint.x && input.currentPoint.y === input.startPoint.y;
      return {
        ok: true,
        value: proposal(
          interaction,
          input.handle,
          input.currentPoint.x,
          input.currentPoint.y,
          input.preserveAspectRatio,
          input.fromCenter,
          identity ? 1 : 2,
          identity ? 1 : 2,
        ),
      };
    },
  };
  const session = begin(interaction, sample(21, 113, 73), provider);

  expect(session.update(sample(21, 160, 120), provider)).toMatchObject({ kind: 'preview' });
  expect(session.finish(sample(21, 113, 73), provider)).toMatchObject({
    kind: 'commit-resize',
    proposal: { input: { currentPoint: { x: 160, y: 120 } } },
  });
  expect(calls).toBe(1);
});

test('discards stale/provider failures and prevents outer updates from winning reentrantly', () => {
  const interaction = start();
  const stale = providerFixture(interaction, [{ code: 'interaction.stale', path: '/interaction' }]);
  expect(
    begin(interaction, sample(4, 113, 73), stale.provider).update(
      sample(4, 140, 90),
      stale.provider,
    ),
  ).toEqual({
    kind: 'discard',
    reason: 'stale',
    error: { code: 'interaction.stale', path: '/interaction' },
  });

  let session!: ResizeSelectionSession;
  const value = proposal(interaction, 'south-east', 160, 120, false, false);
  const reentrant: ResizeProposalProvider = {
    resize: () => {
      session.cancel({ kind: 'escape' });
      return { ok: true, value };
    },
  };
  session = begin(interaction, sample(5, 113, 73), reentrant);
  expect(session.update(sample(5, 160, 120), reentrant)).toEqual({ kind: 'ignore' });
  expect(session.snapshot()).toMatchObject({ phase: 'terminal', terminalEffect: 'discard' });
});

test('deeply detaches and freezes starts, proposals, visuals, commands, errors, and snapshots', () => {
  const interaction = start();
  const mutable = proposal(interaction, 'south-east', 160, 120, false, false);
  const provider: ResizeProposalProvider = { resize: () => ({ ok: true, value: mutable }) };
  const session = begin(interaction, sample(7, 113, 73), provider);
  const effect = session.update(sample(7, 160, 120), provider);

  (mutable.resize.command.delta as unknown as number[])[0] = 99;
  (mutable.selection.nodeIds as unknown as NodeId[]).push(first);

  if (effect.kind !== 'preview' || effect.visual.resize === undefined) {
    throw new Error('resize preview fixture failed');
  }
  expect(effect.visual.resize.command.delta[0]).toBe(2);
  expect(effect.visual.selection.nodeIds).toEqual([first]);
  expect(Object.isFrozen(effect)).toBe(true);
  expect(Object.isFrozen(effect.visual)).toBe(true);
  expect(Object.isFrozen(effect.visual.resize)).toBe(true);
  expect(Object.isFrozen(effect.visual.resize.command)).toBe(true);
  expect(Object.isFrozen(effect.visual.resize.command.delta)).toBe(true);

  const error = { code: 'test.failed', path: '/resize' };
  const failed = begin(interaction, sample(8, 113, 73), {
    resize: () => ({ ok: false, error }),
  }).update(sample(8, 150, 100), { resize: () => ({ ok: false, error }) });
  expect(Object.isFrozen(failed)).toBe(true);
  if (failed.kind !== 'discard' || failed.error === undefined) throw new Error('failure fixture');
  expect(Object.isFrozen(failed.error)).toBe(true);
});
