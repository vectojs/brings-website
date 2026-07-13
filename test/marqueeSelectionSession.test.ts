import { expect, test } from 'bun:test';
import type { BringsError, NodeId, Result, StructuralSelection } from '@vectojs/brings-core';
import {
  pageDeltaBetween,
  viewportPoint,
  viewportToPagePoint,
  type EditorPagePoint,
  type ViewportPoint,
} from '../src/editor/selectionCoordinates';
import type {
  AreaSelectionMode,
  PointSelectionMode,
  SelectionInteractionStart,
  SelectionProposal,
  SelectionProposalProvider,
} from '../src/editor/selectionInteraction';
import {
  MarqueeSelectionSession,
  type SelectionGestureEffect,
  type SelectionPointerSample,
} from '../src/view/MarqueeSelectionSession';

const first = '11111111-1111-4111-8111-111111111111' as NodeId;
const second = '22222222-2222-4222-8222-222222222222' as NodeId;
const third = '33333333-3333-4333-8333-333333333333' as NodeId;

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function structuralSelection(nodeIds: readonly NodeId[]): StructuralSelection {
  return { nodeIds: [...nodeIds], activeNodeId: nodeIds.at(-1) ?? null };
}

function interactionStart(nodeIds: readonly NodeId[] = [first, second]): SelectionInteractionStart {
  return {
    token: { documentRevision: 7, selectionGeneration: 3 },
    selection: structuralSelection(nodeIds),
  };
}

function selectionProposal(
  start: SelectionInteractionStart,
  nodeIds: readonly NodeId[],
): SelectionProposal {
  return {
    token: { ...start.token },
    originalSelection: structuralSelection(start.selection.nodeIds),
    selection: structuralSelection(nodeIds),
  };
}

function pointerSample(
  pointerId: number,
  x: number,
  y: number,
  shiftKey = false,
  pageX = x,
  pageY = y,
): SelectionPointerSample {
  const viewport = unwrap(viewportPoint(x, y));
  const page =
    pageX === x && pageY === y
      ? unwrap(viewportToPagePoint(viewport))
      : ({ x: pageX, y: pageY } as EditorPagePoint);
  return { pointerId, viewportPoint: viewport, pagePoint: page, shiftKey };
}

type ProviderLog = {
  point: Array<Readonly<{ point: EditorPagePoint; mode: PointSelectionMode }>>;
  area: Array<
    Readonly<{
      rect: Readonly<{ x: number; y: number; width: number; height: number }>;
      mode: AreaSelectionMode;
    }>
  >;
};

function providerFixture(
  input: Readonly<{
    ownerId: NodeId | null;
    areaIds?: readonly NodeId[];
    pointFailureAt?: number;
    pointError?: BringsError;
    areaError?: BringsError;
  }>,
): Readonly<{ provider: SelectionProposalProvider; log: ProviderLog }> {
  const log: ProviderLog = { point: [], area: [] };
  const provider: SelectionProposalProvider = {
    point(start, point, mode) {
      log.point.push({ point, mode });
      if (log.point.length === input.pointFailureAt) {
        return {
          ok: false,
          error: input.pointError ?? { code: 'test.point-failed', path: '/point' },
        };
      }
      const original = [...start.selection.nodeIds];
      let nodeIds: readonly NodeId[];
      if (input.ownerId === null) {
        nodeIds = mode === 'replace' ? [] : original;
      } else if (mode === 'replace') {
        nodeIds = [input.ownerId];
      } else if (mode === 'toggle' && original.includes(input.ownerId)) {
        nodeIds = original.filter((id) => id !== input.ownerId);
      } else if (original.includes(input.ownerId)) {
        nodeIds = original;
      } else {
        nodeIds = [...original, input.ownerId];
      }
      return {
        ok: true,
        value: { ownerId: input.ownerId, proposal: selectionProposal(start, nodeIds) },
      };
    },
    area(start, rect, mode) {
      log.area.push({ rect, mode });
      if (input.areaError !== undefined) return { ok: false, error: input.areaError };
      const candidates = [...(input.areaIds ?? [third])];
      const nodeIds =
        mode === 'replace'
          ? candidates
          : [
              ...start.selection.nodeIds,
              ...candidates.filter((id) => !start.selection.nodeIds.includes(id)),
            ];
      return { ok: true, value: selectionProposal(start, nodeIds) };
    },
  };
  return { provider, log };
}

function beginSession(
  start: SelectionInteractionStart,
  sample: SelectionPointerSample,
  provider: SelectionProposalProvider,
): MarqueeSelectionSession {
  return unwrap(MarqueeSelectionSession.begin(start, sample, provider));
}

test('begins empty and object clicks with replace, while Shift freezes a toggle click', () => {
  const start = interactionStart();
  const empty = providerFixture({ ownerId: null });
  const emptyShift = providerFixture({ ownerId: null });
  const object = providerFixture({ ownerId: third });
  const selectedDescendant = providerFixture({ ownerId: first });

  const emptySession = beginSession(start, pointerSample(1, 0, 0), empty.provider);
  const emptyShiftSession = beginSession(start, pointerSample(4, 0, 0, true), emptyShift.provider);
  const objectSession = beginSession(start, pointerSample(2, 10, 10), object.provider);
  const descendantSession = beginSession(
    start,
    pointerSample(3, 20, 20, true),
    selectedDescendant.provider,
  );

  expect(empty.log.point.map(({ mode }) => mode)).toEqual(['replace']);
  expect(emptyShift.log.point.map(({ mode }) => mode)).toEqual(['toggle']);
  expect(object.log.point.map(({ mode }) => mode)).toEqual(['replace']);
  expect(selectedDescendant.log.point.map(({ mode }) => mode)).toEqual(['toggle']);
  expect(emptySession.finish(pointerSample(1, 0, 0), empty.provider)).toEqual({
    kind: 'commit-selection',
    proposal: selectionProposal(start, []),
  });
  expect(emptyShiftSession.finish(pointerSample(4, 0, 0), emptyShift.provider)).toEqual({
    kind: 'commit-selection',
    proposal: selectionProposal(start, [first, second]),
  });
  expect(objectSession.finish(pointerSample(2, 10, 10), object.provider)).toEqual({
    kind: 'commit-selection',
    proposal: selectionProposal(start, [third]),
  });
  expect(descendantSession.finish(pointerSample(3, 20, 20), selectedDescendant.provider)).toEqual({
    kind: 'commit-selection',
    proposal: selectionProposal(start, [second]),
  });
});

test('stays pending below and enters marquee at the four logical-pixel squared threshold', () => {
  const start = interactionStart();
  const { provider, log } = providerFixture({ ownerId: null });
  const session = beginSession(start, pointerSample(7, 10, 10), provider);

  expect(session.update(pointerSample(7, 13.999, 10), provider)).toEqual({ kind: 'ignore' });
  expect(log.area).toHaveLength(0);
  expect(session.update(pointerSample(7, 14, 10), provider)).toEqual({
    kind: 'preview',
    visual: {
      selection: structuralSelection([third]),
      marquee: { x: 10, y: 10, width: 4, height: 0 },
      movementDelta: null,
    },
  });
  expect(log.area).toHaveLength(1);
});

test('normalizes a reverse-direction marquee before provider and preview', () => {
  const start = interactionStart();
  const { provider, log } = providerFixture({ ownerId: null });
  const session = beginSession(start, pointerSample(8, 12, 18), provider);

  const effect = session.update(pointerSample(8, 2, 3), provider);

  expect(log.area).toEqual([{ rect: { x: 2, y: 3, width: 10, height: 15 }, mode: 'replace' }]);
  expect(effect).toMatchObject({
    kind: 'preview',
    visual: { marquee: { x: 2, y: 3, width: 10, height: 15 } },
  });
});

test('samples Shift dynamically for every marquee preview and final proposal', () => {
  const start = interactionStart();
  const { provider, log } = providerFixture({ ownerId: null });
  const session = beginSession(start, pointerSample(9, 0, 0), provider);

  expect(session.update(pointerSample(9, 4, 0, false), provider)).toMatchObject({
    kind: 'preview',
    visual: { selection: { nodeIds: [third] } },
  });
  expect(session.update(pointerSample(9, 5, 0, true), provider)).toMatchObject({
    kind: 'preview',
    visual: { selection: { nodeIds: [first, second, third] } },
  });
  expect(session.finish(pointerSample(9, 6, 0, false), provider)).toMatchObject({
    kind: 'commit-selection',
    proposal: { selection: { nodeIds: [third] } },
  });
  expect(log.area.map(({ mode }) => mode)).toEqual(['replace', 'add', 'replace']);
});

test('freezes object Shift and preserves selected owners with add-for-drag', () => {
  const start = interactionStart();
  const unselectedNormal = providerFixture({ ownerId: third });
  const unselectedShift = providerFixture({ ownerId: third });
  const selectedNormal = providerFixture({ ownerId: first });
  const normalSession = beginSession(start, pointerSample(10, 20, 20), unselectedNormal.provider);
  const shiftSession = beginSession(
    start,
    pointerSample(11, 20, 20, true),
    unselectedShift.provider,
  );
  const selectedSession = beginSession(start, pointerSample(12, 20, 20), selectedNormal.provider);

  expect(
    normalSession.update(pointerSample(10, 24, 20, true), unselectedNormal.provider),
  ).toMatchObject({
    kind: 'preview',
    visual: { selection: { nodeIds: [third] }, movementDelta: { x: 4, y: 0 } },
  });
  expect(
    shiftSession.update(pointerSample(11, 24, 20, false), unselectedShift.provider),
  ).toMatchObject({
    kind: 'preview',
    visual: {
      selection: { nodeIds: [first, second, third] },
      movementDelta: { x: 4, y: 0 },
    },
  });
  expect(
    selectedSession.update(pointerSample(12, 24, 20, true), selectedNormal.provider),
  ).toMatchObject({
    kind: 'preview',
    visual: { selection: { nodeIds: [first, second] }, movementDelta: { x: 4, y: 0 } },
  });
  expect(unselectedNormal.log.point.map(({ mode }) => mode)).toEqual(['replace', 'replace']);
  expect(unselectedShift.log.point.map(({ mode }) => mode)).toEqual(['toggle', 'add-for-drag']);
  expect(selectedNormal.log.point.map(({ mode }) => mode)).toEqual(['replace', 'add-for-drag']);
  expect(unselectedNormal.log.point[1]?.point).toMatchObject({ x: 20, y: 20 });
});

test('obtains an object movement proposal once and reuses it for later deltas', () => {
  const start = interactionStart();
  const { provider, log } = providerFixture({ ownerId: third });
  const session = beginSession(start, pointerSample(13, 10, 10), provider);

  expect(session.update(pointerSample(13, 14, 10), provider)).toMatchObject({
    kind: 'preview',
    visual: { movementDelta: { x: 4, y: 0 } },
  });
  expect(session.update(pointerSample(13, 18, 16, true), provider)).toMatchObject({
    kind: 'preview',
    visual: { movementDelta: { x: 8, y: 6 } },
  });
  expect(log.point.map(({ mode }) => mode)).toEqual(['replace', 'replace']);
});

test('finishes marquee and object movement with exactly one matching commit', () => {
  const start = interactionStart();
  const marquee = providerFixture({ ownerId: null });
  const moving = providerFixture({ ownerId: third });
  const marqueeSession = beginSession(start, pointerSample(14, 10, 10), marquee.provider);
  const movingSession = beginSession(start, pointerSample(15, 10, 10), moving.provider);
  const expectedDelta = unwrap(
    pageDeltaBetween(pointerSample(15, 10, 10).pagePoint, pointerSample(15, 16, 13).pagePoint),
  );

  expect(marqueeSession.finish(pointerSample(14, 4, 3, true), marquee.provider)).toEqual({
    kind: 'commit-selection',
    proposal: selectionProposal(start, [first, second, third]),
  });
  expect(movingSession.finish(pointerSample(15, 16, 13), moving.provider)).toEqual({
    kind: 'commit-move',
    proposal: selectionProposal(start, [third]),
    delta: expectedDelta,
  });
  expect(marqueeSession.finish(pointerSample(14, 4, 3), marquee.provider)).toEqual({
    kind: 'ignore',
  });
  expect(movingSession.update(pointerSample(15, 20, 20), moving.provider)).toEqual({
    kind: 'ignore',
  });
});

test('commits a drag proposal as selection when a moving gesture returns to zero delta', () => {
  const start = interactionStart();
  const { provider } = providerFixture({ ownerId: third });
  const session = beginSession(start, pointerSample(16, 10, 10, true), provider);
  expect(session.update(pointerSample(16, 14, 10), provider).kind).toBe('preview');

  expect(session.finish(pointerSample(16, 10, 10, false), provider)).toEqual({
    kind: 'commit-selection',
    proposal: selectionProposal(start, [first, second, third]),
  });
});

test('ignores every non-owner stream without changing the owner terminal', () => {
  const start = interactionStart();
  const { provider, log } = providerFixture({ ownerId: null });
  const session = beginSession(start, pointerSample(17, 0, 0), provider);

  expect(session.update(pointerSample(99, 8, 8), provider)).toEqual({ kind: 'ignore' });
  expect(session.finish(pointerSample(99, 8, 8), provider)).toEqual({ kind: 'ignore' });
  expect(session.cancel({ kind: 'pointercancel', pointerId: 99 })).toEqual({ kind: 'ignore' });
  expect(log.area).toHaveLength(0);
  expect(session.finish(pointerSample(17, 0, 0), provider)).toMatchObject({
    kind: 'commit-selection',
  });
});

test('discards pointercancel, Escape, and external errors once', () => {
  const start = interactionStart();
  const pointerProvider = providerFixture({ ownerId: null }).provider;
  const pointerSession = beginSession(start, pointerSample(18, 0, 0), pointerProvider);
  const escapeProvider = providerFixture({ ownerId: null }).provider;
  const escapeSession = beginSession(start, pointerSample(19, 0, 0), escapeProvider);
  const errorProvider = providerFixture({ ownerId: null }).provider;
  const errorSession = beginSession(start, pointerSample(20, 0, 0), errorProvider);
  const error = { code: 'interaction.coordinate-invalid', path: '/page/x' };

  expect(pointerSession.cancel({ kind: 'pointercancel', pointerId: 18 })).toEqual({
    kind: 'discard',
    reason: 'pointercancel',
  });
  expect(escapeSession.cancel({ kind: 'escape' })).toEqual({ kind: 'discard', reason: 'escape' });
  expect(errorSession.cancel({ kind: 'error', error })).toEqual({
    kind: 'discard',
    reason: 'error',
    error,
  });
  expect(pointerSession.cancel({ kind: 'escape' })).toEqual({ kind: 'ignore' });
  expect(escapeSession.update(pointerSample(19, 8, 8), escapeProvider)).toEqual({ kind: 'ignore' });
  expect(errorSession.finish(pointerSample(20, 0, 0), errorProvider)).toEqual({ kind: 'ignore' });
});

test('maps begin, stale, and ordinary provider failures without retrying', () => {
  const start = interactionStart();
  const beginError = { code: 'test.begin-failed', path: '/point' };
  const beginFailure = providerFixture({
    ownerId: third,
    pointFailureAt: 1,
    pointError: beginError,
  });
  const staleError = { code: 'interaction.stale', path: '/interaction' };
  const stale = providerFixture({ ownerId: null, areaError: staleError });
  const pointError = { code: 'test.drag-failed', path: '/point' };
  const failedMove = providerFixture({
    ownerId: third,
    pointFailureAt: 2,
    pointError,
  });

  expect(
    MarqueeSelectionSession.begin(start, pointerSample(21, 0, 0), beginFailure.provider),
  ).toEqual({ ok: false, error: beginError });
  const staleSession = beginSession(start, pointerSample(22, 0, 0), stale.provider);
  expect(staleSession.update(pointerSample(22, 4, 0), stale.provider)).toEqual({
    kind: 'discard',
    reason: 'stale',
    error: staleError,
  });
  const moveSession = beginSession(start, pointerSample(23, 0, 0), failedMove.provider);
  expect(moveSession.update(pointerSample(23, 4, 0), failedMove.provider)).toEqual({
    kind: 'discard',
    reason: 'error',
    error: pointError,
  });
  expect(staleSession.finish(pointerSample(22, 4, 0), stale.provider)).toEqual({ kind: 'ignore' });
  expect(moveSession.update(pointerSample(23, 8, 0), failedMove.provider)).toEqual({
    kind: 'ignore',
  });
});

test('discards viewport-distance, rectangle, and delta construction failures', () => {
  const start = interactionStart();
  const coordinateProvider = providerFixture({ ownerId: null });
  const coordinateStart = {
    pointerId: 24,
    viewportPoint: { x: Number.MAX_VALUE, y: 0 } as ViewportPoint,
    pagePoint: { x: 0, y: 0 } as EditorPagePoint,
    shiftKey: false,
  };
  const coordinateSession = beginSession(start, coordinateStart, coordinateProvider.provider);
  const rectangleProvider = providerFixture({ ownerId: null });
  const rectangleSession = beginSession(
    start,
    pointerSample(25, 0, 0, false, -Number.MAX_VALUE, 0),
    rectangleProvider.provider,
  );
  const deltaProvider = providerFixture({ ownerId: third });
  const deltaSession = beginSession(
    start,
    pointerSample(26, 0, 0, false, -Number.MAX_VALUE, 0),
    deltaProvider.provider,
  );

  expect(
    coordinateSession.update(
      {
        pointerId: 24,
        viewportPoint: { x: -Number.MAX_VALUE, y: 0 } as ViewportPoint,
        pagePoint: { x: 4, y: 0 } as EditorPagePoint,
        shiftKey: false,
      },
      coordinateProvider.provider,
    ),
  ).toEqual({
    kind: 'discard',
    reason: 'error',
    error: { code: 'interaction.coordinate-invalid', path: '/viewport/distance' },
  });
  expect(
    rectangleSession.update(
      pointerSample(25, 4, 0, false, Number.MAX_VALUE, 0),
      rectangleProvider.provider,
    ),
  ).toEqual({
    kind: 'discard',
    reason: 'error',
    error: { code: 'interaction.coordinate-invalid', path: '/rect' },
  });
  expect(
    deltaSession.update(
      pointerSample(26, 4, 0, false, Number.MAX_VALUE, 0),
      deltaProvider.provider,
    ),
  ).toEqual({
    kind: 'discard',
    reason: 'error',
    error: { code: 'interaction.coordinate-invalid', path: '/delta' },
  });
});

test('makes every terminal idempotent for all late methods', () => {
  const start = interactionStart();
  const { provider } = providerFixture({ ownerId: null });
  const ownerSample = pointerSample(27, 0, 0);
  const session = beginSession(start, ownerSample, provider);

  const discarded = session.cancel({ kind: 'escape' });
  expect(discarded).toEqual({ kind: 'discard', reason: 'escape' });
  expect(session.finish(ownerSample, provider)).toEqual({ kind: 'ignore' });
  expect(session.cancel({ kind: 'pointercancel', pointerId: ownerSample.pointerId })).toEqual({
    kind: 'ignore',
  });
  expect(session.update(ownerSample, provider)).toEqual({ kind: 'ignore' });
});

test('exposes only approved effect variants from the pure session contract', () => {
  const effects: SelectionGestureEffect[] = [
    { kind: 'ignore' },
    { kind: 'discard', reason: 'escape' },
  ];
  expect(effects.map(({ kind }) => kind)).toEqual(['ignore', 'discard']);
});
