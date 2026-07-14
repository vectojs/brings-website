import { expect, test } from 'bun:test';
import {
  createDocumentStore,
  type BringsDocumentStore,
  type CreateDocumentInput,
  type DocumentCommandInput,
  type EditorSnapshot,
  type NodeId,
  type Result,
  type StructuralSelection,
} from '@vectojs/brings-core';
import { BringsEditorController } from '../src/editor/BringsEditorController';
import {
  pageDeltaBetween,
  pageRectBetween,
  viewportPoint,
  viewportToPagePoint,
  type EditorPagePoint,
  type PageDelta,
} from '../src/editor/selectionCoordinates';
import type { SelectionProposal } from '../src/editor/selectionInteraction';

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function pagePoint(x: number, y: number): EditorPagePoint {
  return unwrap(viewportToPagePoint(unwrap(viewportPoint(x, y))));
}

test('creates a detached revision-zero Core document with a caller-owned UUID policy', () => {
  const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
  const controller = new BringsEditorController(() => {
    const id = ids.shift();
    if (!id) throw new Error('fixture exhausted');
    return id;
  });
  const snapshot = controller.snapshot();

  expect(snapshot).toMatchObject({
    document: {
      id: '11111111-1111-4111-8111-111111111111',
      revision: 0,
      name: 'Untitled',
      activePageId: '22222222-2222-4222-8222-222222222222',
      pages: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          name: 'Page 1',
          rootNodeIds: [],
        },
      ],
      nodes: [],
    },
    selection: { nodeIds: [], activeNodeId: null },
    undoDepth: 0,
    redoDepth: 0,
  });

  (snapshot.document.pages as unknown as { name: string }[])[0]!.name = 'Mutated caller value';
  expect(controller.snapshot().document.pages[0]?.name).toBe('Page 1');
});

test('creates a Frame and nested Rectangle through the published Core command API', () => {
  const ids = [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-444444444444',
  ];
  const controller = new BringsEditorController(() => {
    const id = ids.shift();
    if (!id) throw new Error('fixture exhausted');
    return id;
  });

  expect(controller.createFrameAt(80, 100).ok).toBe(true);
  expect(controller.createRectangleAt(140, 160).ok).toBe(true);
  expect(controller.snapshot()).toMatchObject({
    document: {
      revision: 2,
      nodes: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          type: 'frame',
          childIds: ['44444444-4444-4444-8444-444444444444'],
        },
        {
          id: '44444444-4444-4444-8444-444444444444',
          type: 'rectangle',
          parentId: '33333333-3333-4333-8333-333333333333',
        },
      ],
    },
    undoDepth: 2,
  });
});

test('selects the frontmost Core hit without changing document history', () => {
  const ids = [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-444444444444',
  ];
  const controller = new BringsEditorController(() => {
    const id = ids.shift();
    if (!id) throw new Error('fixture exhausted');
    return id;
  });

  expect(controller.createFrameAt(80, 100).ok).toBe(true);
  expect(controller.createRectangleAt(140, 160).ok).toBe(true);
  const before = controller.snapshot();

  expect(controller.selectAt(145, 165)).toMatchObject({ ok: true });
  expect(controller.snapshot()).toMatchObject({
    document: { revision: before.document.revision },
    selection: {
      nodeIds: ['44444444-4444-4444-8444-444444444444'],
      activeNodeId: '44444444-4444-4444-8444-444444444444',
    },
    undoDepth: before.undoDepth,
    redoDepth: before.redoDepth,
  });
});

test('commits one selected-node translation and restores it through undo', () => {
  const ids = [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-444444444444',
  ];
  const controller = new BringsEditorController(() => {
    const id = ids.shift();
    if (!id) throw new Error('fixture exhausted');
    return id;
  });

  expect(controller.createFrameAt(80, 100).ok).toBe(true);
  expect(controller.createRectangleAt(140, 160).ok).toBe(true);
  expect(controller.selectAt(145, 165).ok).toBe(true);

  expect(controller.moveSelectionBy(30, 20)).toMatchObject({ ok: true });
  expect(controller.snapshot()).toMatchObject({
    document: {
      revision: 3,
      nodes: [
        { type: 'frame', transform: [1, 0, 0, 1, 80, 100] },
        { type: 'rectangle', transform: [1, 0, 0, 1, 90, 80] },
      ],
    },
    selection: {
      nodeIds: ['44444444-4444-4444-8444-444444444444'],
      activeNodeId: '44444444-4444-4444-8444-444444444444',
    },
    undoDepth: 3,
  });

  expect(controller.undo()).toMatchObject({ ok: true });
  expect(controller.snapshot()).toMatchObject({
    document: {
      revision: 4,
      nodes: [{ type: 'frame' }, { type: 'rectangle', transform: [1, 0, 0, 1, 60, 60] }],
    },
    selection: {
      nodeIds: ['44444444-4444-4444-8444-444444444444'],
      activeNodeId: '44444444-4444-4444-8444-444444444444',
    },
    undoDepth: 2,
    redoDepth: 1,
  });

  expect(controller.redo()).toMatchObject({ ok: true });
  expect(controller.snapshot()).toMatchObject({
    document: {
      revision: 5,
      nodes: [{ type: 'frame' }, { type: 'rectangle', transform: [1, 0, 0, 1, 90, 80] }],
    },
    selection: {
      nodeIds: ['44444444-4444-4444-8444-444444444444'],
      activeNodeId: '44444444-4444-4444-8444-444444444444',
    },
    undoDepth: 3,
    redoDepth: 0,
  });
});

test('deletes the selected node as one undoable Core command', () => {
  const ids = [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-444444444444',
  ];
  const controller = new BringsEditorController(() => {
    const id = ids.shift();
    if (!id) throw new Error('fixture exhausted');
    return id;
  });

  expect(controller.createFrameAt(80, 100).ok).toBe(true);
  expect(controller.createRectangleAt(140, 160).ok).toBe(true);
  expect(controller.selectAt(145, 165).ok).toBe(true);

  expect(controller.deleteSelection()).toMatchObject({ ok: true });
  expect(controller.snapshot()).toMatchObject({
    document: { revision: 3, nodes: [{ type: 'frame', childIds: [] }] },
    selection: { nodeIds: [], activeNodeId: null },
    undoDepth: 3,
  });

  expect(controller.undo()).toMatchObject({ ok: true });
  expect(controller.snapshot()).toMatchObject({
    document: { revision: 4, nodes: [{ type: 'frame' }, { type: 'rectangle' }] },
    selection: {
      nodeIds: ['44444444-4444-4444-8444-444444444444'],
      activeNodeId: '44444444-4444-4444-8444-444444444444',
    },
  });
});

test('treats empty-selection deletion as a successful byte-identical no-op', () => {
  const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
  const controller = new BringsEditorController(() => {
    const id = ids.shift();
    if (!id) throw new Error('fixture exhausted');
    return id;
  });
  const before = JSON.stringify(controller.snapshot());

  expect(controller.deleteSelection()).toMatchObject({ ok: true });
  expect(JSON.stringify(controller.snapshot())).toBe(before);
});

const interactionIds = {
  document: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  page: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  first: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' as NodeId,
  second: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' as NodeId,
} as const;

type ControllerStore = Pick<
  BringsDocumentStore,
  'snapshot' | 'setSelection' | 'execute' | 'undo' | 'redo'
>;

function populatedStore(input: CreateDocumentInput): Result<BringsDocumentStore> {
  const created = createDocumentStore(input);
  if (!created.ok) return created;
  const store = created.value;
  for (const [index, rectangle] of [
    { id: interactionIds.first, x: 10 },
    { id: interactionIds.second, x: 100 },
  ].entries()) {
    const inserted = store.execute({
      kind: 'create-rectangle',
      pageId: input.initialPage.id,
      parentId: null,
      index,
      rectangle: {
        id: rectangle.id,
        name: `Rectangle ${index + 1}`,
        visible: true,
        locked: false,
        opacity: 1,
        transform: [1, 0, 0, 1, rectangle.x, 10],
        width: 50,
        height: 50,
        cornerRadii: [0, 0, 0, 0],
        fill: null,
        stroke: null,
      },
    });
    if (!inserted.ok) return inserted;
  }
  return { ok: true, value: store };
}

function populatedController(
  createStore: (input: CreateDocumentInput) => Result<ControllerStore> = populatedStore,
): BringsEditorController {
  const ids = [interactionIds.document, interactionIds.page];
  return new BringsEditorController(
    () => {
      const id = ids.shift();
      if (id === undefined) throw new Error('fixture exhausted');
      return id;
    },
    { createStore },
  );
}

test('begins with a detached selection and monotonically tracked interaction token', () => {
  const controller = populatedController();
  const start = controller.beginSelectionInteraction();

  expect(start).toMatchObject({
    token: { documentRevision: 2, selectionGeneration: 0 },
    selection: { nodeIds: [], activeNodeId: null },
  });
  (start.selection.nodeIds as unknown as string[]).push(interactionIds.first);
  expect(controller.snapshot().selection).toEqual({ nodeIds: [], activeNodeId: null });
  expect(controller.beginSelectionInteraction().token).toEqual({
    documentRevision: 2,
    selectionGeneration: 0,
  });
});

test('proposes point replacement, toggle, and add-for-drag without mutating Core', () => {
  const controller = populatedController();
  const emptyStart = controller.beginSelectionInteraction();
  const firstPoint = pagePoint(20, 20);
  const secondPoint = pagePoint(110, 20);
  const replacement = unwrap(
    controller.proposePointSelection({ start: emptyStart, point: firstPoint, mode: 'replace' }),
  );

  expect(replacement).toMatchObject({
    ownerId: interactionIds.first,
    proposal: {
      originalSelection: { nodeIds: [], activeNodeId: null },
      selection: { nodeIds: [interactionIds.first], activeNodeId: interactionIds.first },
    },
  });
  expect(controller.snapshot().selection.nodeIds).toEqual([]);
  unwrap(controller.commitSelection(replacement.proposal));
  const selectedStart = controller.beginSelectionInteraction();
  const emptyPoint = pagePoint(500, 500);

  expect(
    unwrap(
      controller.proposePointSelection({
        start: selectedStart,
        point: firstPoint,
        mode: 'toggle',
      }),
    ).proposal.selection,
  ).toEqual({ nodeIds: [], activeNodeId: null });
  expect(
    unwrap(
      controller.proposePointSelection({
        start: selectedStart,
        point: secondPoint,
        mode: 'toggle',
      }),
    ).proposal.selection,
  ).toEqual({
    nodeIds: [interactionIds.first, interactionIds.second],
    activeNodeId: interactionIds.second,
  });
  expect(
    unwrap(
      controller.proposePointSelection({
        start: selectedStart,
        point: firstPoint,
        mode: 'add-for-drag',
      }),
    ).proposal.selection,
  ).toEqual(selectedStart.selection);
  expect(
    unwrap(
      controller.proposePointSelection({
        start: selectedStart,
        point: secondPoint,
        mode: 'add-for-drag',
      }),
    ).proposal.selection,
  ).toEqual({
    nodeIds: [interactionIds.first, interactionIds.second],
    activeNodeId: interactionIds.second,
  });
  expect(
    unwrap(
      controller.proposePointSelection({
        start: selectedStart,
        point: emptyPoint,
        mode: 'toggle',
      }),
    ).proposal.selection,
  ).toEqual(selectedStart.selection);
  expect(
    unwrap(
      controller.proposePointSelection({
        start: selectedStart,
        point: emptyPoint,
        mode: 'replace',
      }),
    ).proposal.selection,
  ).toEqual({ nodeIds: [], activeNodeId: null });
});

test('proposes ordered area replacement and addition through Core normalization', () => {
  const controller = populatedController();
  const start = controller.beginSelectionInteraction();
  const first = unwrap(
    controller.proposePointSelection({ start, point: pagePoint(20, 20), mode: 'replace' }),
  );
  unwrap(controller.commitSelection(first.proposal));
  const selectedStart = controller.beginSelectionInteraction();
  const secondRect = unwrap(pageRectBetween(pagePoint(95, 5), pagePoint(155, 65)));
  const bothRect = unwrap(pageRectBetween(pagePoint(5, 5), pagePoint(155, 65)));
  const missRect = unwrap(pageRectBetween(pagePoint(500, 500), pagePoint(510, 510)));

  expect(
    unwrap(controller.proposeAreaSelection({ start: selectedStart, rect: secondRect, mode: 'add' }))
      .selection,
  ).toEqual({
    nodeIds: [interactionIds.first, interactionIds.second],
    activeNodeId: interactionIds.second,
  });
  expect(
    unwrap(controller.proposeAreaSelection({ start: selectedStart, rect: missRect, mode: 'add' }))
      .selection,
  ).toEqual(selectedStart.selection);
  expect(
    unwrap(
      controller.proposeAreaSelection({ start: selectedStart, rect: bothRect, mode: 'replace' }),
    ).selection,
  ).toEqual({
    nodeIds: [interactionIds.first, interactionIds.second],
    activeNodeId: interactionIds.second,
  });
});

test('resolves a frontmost descendant to its selected ancestor and normalizes area hits', () => {
  const frameId = '33333333-3333-4333-8333-333333333333' as NodeId;
  const ids = [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-444444444444',
  ];
  const controller = new BringsEditorController(() => {
    const id = ids.shift();
    if (id === undefined) throw new Error('fixture exhausted');
    return id;
  });
  unwrap(controller.createFrameAt(80, 100));
  unwrap(controller.createRectangleAt(140, 160));
  unwrap(controller.selectAt(90, 110));
  const start = controller.beginSelectionInteraction();
  const point = unwrap(
    controller.proposePointSelection({ start, point: pagePoint(145, 165), mode: 'toggle' }),
  );

  expect(point.ownerId).toBe(frameId);
  expect(point.proposal.selection).toEqual({ nodeIds: [], activeNodeId: null });
  const rect = unwrap(pageRectBetween(pagePoint(70, 90), pagePoint(500, 420)));
  expect(
    unwrap(controller.proposeAreaSelection({ start, rect, mode: 'replace' })).selection,
  ).toEqual({
    nodeIds: [frameId],
    activeNodeId: frameId,
  });
});

test('rejects stale selection generations and durable revisions without mutation', () => {
  const selectionController = populatedController();
  const selectionStart = selectionController.beginSelectionInteraction();
  const proposal = unwrap(
    selectionController.proposePointSelection({
      start: selectionStart,
      point: pagePoint(20, 20),
      mode: 'replace',
    }),
  ).proposal;
  unwrap(selectionController.commitSelection(proposal));
  const selectionRevision = selectionController.snapshot().document.revision;

  expect(selectionController.commitSelection(proposal)).toEqual({
    ok: false,
    error: { code: 'interaction.stale', path: '/interaction' },
  });
  expect(
    selectionController.proposePointSelection({
      start: selectionStart,
      point: pagePoint(110, 20),
      mode: 'replace',
    }),
  ).toEqual({
    ok: false,
    error: { code: 'interaction.stale', path: '/interaction' },
  });
  expect(selectionController.snapshot().document.revision).toBe(selectionRevision);

  const ids = [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
  ];
  const revisionController = new BringsEditorController(() => {
    const id = ids.shift();
    if (id === undefined) throw new Error('fixture exhausted');
    return id;
  });
  const revisionStart = revisionController.beginSelectionInteraction();
  unwrap(revisionController.createFrameAt(0, 0));
  expect(
    revisionController.proposeAreaSelection({
      start: revisionStart,
      rect: unwrap(pageRectBetween(pagePoint(0, 0), pagePoint(10, 10))),
      mode: 'replace',
    }),
  ).toEqual({
    ok: false,
    error: { code: 'interaction.stale', path: '/interaction' },
  });
});

test('rejects an empty move proposal without changing debug state', () => {
  const controller = populatedController();
  const start = controller.beginSelectionInteraction();
  const empty = unwrap(
    controller.proposePointSelection({ start, point: pagePoint(500, 500), mode: 'replace' }),
  ).proposal;
  const before = JSON.stringify(controller.debugInteractionState());

  expect(
    controller.commitMove({
      proposal: empty,
      delta: unwrap(pageDeltaBetween(pagePoint(0, 0), pagePoint(10, 10))),
    }),
  ).toEqual({
    ok: false,
    error: { code: 'selection.empty', path: '/nodeIds' },
  });
  expect(JSON.stringify(controller.debugInteractionState())).toBe(before);
});

test('commits selection without durable history and preserves Core geometry errors', () => {
  const controller = populatedController();
  const start = controller.beginSelectionInteraction();
  const before = controller.snapshot();
  const proposal = unwrap(
    controller.proposePointSelection({ start, point: pagePoint(20, 20), mode: 'replace' }),
  ).proposal;
  const committed = unwrap(controller.commitSelection(proposal));

  expect(committed).toMatchObject({
    document: { revision: before.document.revision },
    undoDepth: before.undoDepth,
    redoDepth: before.redoDepth,
    selection: { nodeIds: [interactionIds.first], activeNodeId: interactionIds.first },
  });
  expect(controller.beginSelectionInteraction().token.selectionGeneration).toBe(1);

  const invalidRect = { x: Number.NaN, y: 0, width: 1, height: 1 } as Parameters<
    BringsEditorController['proposeAreaSelection']
  >[0]['rect'];
  expect(
    controller.proposeAreaSelection({
      start: controller.beginSelectionInteraction(),
      rect: invalidRect,
      mode: 'replace',
    }),
  ).toEqual({
    ok: false,
    error: { code: 'geometry.rect-invalid', path: '/rect/x' },
  });
});

test('commits one atomic move revision and history entry for the proposed IDs', () => {
  const controller = populatedController();
  const start = controller.beginSelectionInteraction();
  const proposal = unwrap(
    controller.proposePointSelection({ start, point: pagePoint(20, 20), mode: 'replace' }),
  ).proposal;
  const before = controller.snapshot();
  const moved = unwrap(
    controller.commitMove({
      proposal,
      delta: unwrap(pageDeltaBetween(pagePoint(0, 0), pagePoint(8, -4))),
    }),
  );

  expect(moved).toMatchObject({
    document: {
      revision: before.document.revision + 1,
    },
    undoDepth: before.undoDepth + 1,
    selection: { nodeIds: [interactionIds.first], activeNodeId: interactionIds.first },
  });
  expect(moved.document.nodes[0]).toMatchObject({
    id: interactionIds.first,
    transform: [1, 0, 0, 1, 18, 6],
  });
  expect(controller.beginSelectionInteraction().token.selectionGeneration).toBe(1);
});

test('snapshots and normalizes a dynamic proposal before selecting and moving one ID list', () => {
  const controller = populatedController();
  const start = controller.beginSelectionInteraction();
  const [first, second] = controller.snapshot().document.nodes;
  if (first === undefined || second === undefined) throw new Error('fixture nodes missing');
  let proposalSelectionReads = 0;
  let nodeIdsReads = 0;
  let activeNodeIdReads = 0;
  let idReads = 0;
  let tokenReads = 0;
  let deltaXReads = 0;
  let deltaYReads = 0;
  const changingIds = new Proxy([first.id], {
    get(target, property, receiver) {
      if (property === '0') {
        idReads += 1;
        return idReads === 1 ? first.id : second.id;
      }
      return Reflect.get(target, property, receiver);
    },
  });
  const changingSelection = Object.defineProperties(
    {},
    {
      nodeIds: {
        get() {
          nodeIdsReads += 1;
          return changingIds;
        },
      },
      activeNodeId: {
        get() {
          activeNodeIdReads += 1;
          return first.id;
        },
      },
    },
  ) as StructuralSelection;
  const proposal = Object.defineProperties(
    {},
    {
      token: {
        get() {
          tokenReads += 1;
          return tokenReads === 1
            ? start.token
            : { ...start.token, selectionGeneration: start.token.selectionGeneration + 1 };
        },
      },
      originalSelection: { value: start.selection },
      selection: {
        get() {
          proposalSelectionReads += 1;
          return changingSelection;
        },
      },
    },
  ) as SelectionProposal;
  const delta = Object.defineProperties(
    {},
    {
      x: {
        get() {
          deltaXReads += 1;
          return deltaXReads === 1 ? 8 : 800;
        },
      },
      y: {
        get() {
          deltaYReads += 1;
          return deltaYReads === 1 ? -4 : 400;
        },
      },
    },
  ) as PageDelta;

  const moved = unwrap(controller.commitMove({ proposal, delta }));

  expect(moved.selection).toEqual({ nodeIds: [first.id], activeNodeId: first.id });
  expect(moved.document.nodes[0]?.transform).toEqual([1, 0, 0, 1, 18, 6]);
  expect(moved.document.nodes[1]?.transform).toEqual([1, 0, 0, 1, 100, 10]);
  expect({ proposalSelectionReads, nodeIdsReads, activeNodeIdReads, idReads, tokenReads }).toEqual({
    proposalSelectionReads: 1,
    nodeIdsReads: 1,
    activeNodeIdReads: 1,
    idReads: 1,
    tokenReads: 1,
  });
  expect({ deltaXReads, deltaYReads }).toEqual({ deltaXReads: 1, deltaYReads: 1 });
});

test('rejects an old move when a delta getter commits a newer selection', () => {
  const controller = populatedController();
  const start = controller.beginSelectionInteraction();
  const oldProposal = unwrap(
    controller.proposePointSelection({ start, point: pagePoint(20, 20), mode: 'replace' }),
  ).proposal;
  const newerProposal = unwrap(
    controller.proposePointSelection({ start, point: pagePoint(110, 20), mode: 'replace' }),
  ).proposal;
  let deltaXReads = 0;
  let deltaYReads = 0;
  const delta = Object.defineProperties(
    {},
    {
      x: {
        get() {
          deltaXReads += 1;
          unwrap(controller.commitSelection(newerProposal));
          return 8;
        },
      },
      y: {
        get() {
          deltaYReads += 1;
          return -4;
        },
      },
    },
  ) as PageDelta;

  const result = controller.commitMove({ proposal: oldProposal, delta });

  expect(result).toEqual({
    ok: false,
    error: { code: 'interaction.stale', path: '/interaction' },
  });
  expect(controller.debugInteractionState()).toMatchObject({
    selectionGeneration: 1,
    snapshot: {
      selection: { nodeIds: [interactionIds.second], activeNodeId: interactionIds.second },
      document: {
        revision: 2,
        nodes: [
          { id: interactionIds.first, transform: [1, 0, 0, 1, 10, 10] },
          { id: interactionIds.second, transform: [1, 0, 0, 1, 100, 10] },
        ],
      },
    },
  });
  expect({ deltaXReads, deltaYReads }).toEqual({ deltaXReads: 1, deltaYReads: 1 });
});

test('Core-normalizes a caller-owned parent and child proposal before commit', () => {
  const ids = [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-444444444444',
  ];
  const controller = new BringsEditorController(() => {
    const id = ids.shift();
    if (id === undefined) throw new Error('fixture exhausted');
    return id;
  });
  unwrap(controller.createFrameAt(80, 100));
  unwrap(controller.createRectangleAt(140, 160));
  const start = controller.beginSelectionInteraction();
  const [frame, rectangle] = controller.snapshot().document.nodes;
  if (frame === undefined || rectangle === undefined) throw new Error('fixture nodes missing');

  const committed = unwrap(
    controller.commitSelection({
      token: start.token,
      originalSelection: start.selection,
      selection: { nodeIds: [frame.id, rectangle.id], activeNodeId: rectangle.id },
    }),
  );

  expect(committed.selection).toEqual({ nodeIds: [frame.id], activeNodeId: frame.id });
});

test('restores byte-identical debug state when transform execution fails', () => {
  const controller = populatedController((input) => {
    const created = populatedStore(input);
    if (!created.ok) return created;
    const store = created.value;
    const wrapper: ControllerStore = {
      snapshot: () => store.snapshot(),
      setSelection: (selection) => store.setSelection(selection),
      execute(command: DocumentCommandInput): Result<EditorSnapshot> {
        if (command.kind === 'apply-transform-delta') {
          return { ok: false, error: { code: 'test.transform-failed', path: '/delta' } };
        }
        return store.execute(command);
      },
      undo: () => store.undo(),
      redo: () => store.redo(),
    };
    return { ok: true, value: wrapper };
  });
  const start = controller.beginSelectionInteraction();
  const proposal = unwrap(
    controller.proposePointSelection({ start, point: pagePoint(20, 20), mode: 'replace' }),
  ).proposal;
  const before = JSON.stringify(controller.debugInteractionState());

  const result = controller.commitMove({
    proposal,
    delta: unwrap(pageDeltaBetween(pagePoint(0, 0), pagePoint(10, 10))),
  });

  expect(result).toEqual({
    ok: false,
    error: { code: 'test.transform-failed', path: '/delta' },
  });
  expect(JSON.stringify(controller.debugInteractionState())).toBe(before);
});

test('restores selection after execute throws and rethrows the original exception', () => {
  const executeError = new Error('test execute threw');
  const controller = populatedController((input) => {
    const created = populatedStore(input);
    if (!created.ok) return created;
    const store = created.value;
    return {
      ok: true,
      value: {
        snapshot: () => store.snapshot(),
        setSelection: (selection) => store.setSelection(selection),
        execute(command: DocumentCommandInput): Result<EditorSnapshot> {
          if (command.kind === 'apply-transform-delta') throw executeError;
          return store.execute(command);
        },
        undo: () => store.undo(),
        redo: () => store.redo(),
      },
    };
  });
  const start = controller.beginSelectionInteraction();
  const proposal = unwrap(
    controller.proposePointSelection({ start, point: pagePoint(20, 20), mode: 'replace' }),
  ).proposal;
  const before = JSON.stringify(controller.debugInteractionState());
  let caught: unknown;

  try {
    controller.commitMove({
      proposal,
      delta: unwrap(pageDeltaBetween(pagePoint(0, 0), pagePoint(10, 10))),
    });
  } catch (error) {
    caught = error;
  }

  expect(caught).toBe(executeError);
  expect(JSON.stringify(controller.debugInteractionState())).toBe(before);
});

test('throws a controller invariant error when selection restoration fails', () => {
  const transformError = { code: 'test.transform-failed', path: '/delta' } as const;
  let selectionWrites = 0;
  const controller = populatedController((input) => {
    const created = populatedStore(input);
    if (!created.ok) return created;
    const store = created.value;
    return {
      ok: true,
      value: {
        snapshot: () => store.snapshot(),
        setSelection(selection): Result<EditorSnapshot> {
          selectionWrites += 1;
          return selectionWrites === 1
            ? store.setSelection(selection)
            : { ok: false, error: { code: 'test.restore-failed', path: '/selection' } };
        },
        execute(command: DocumentCommandInput): Result<EditorSnapshot> {
          return command.kind === 'apply-transform-delta'
            ? { ok: false, error: transformError }
            : store.execute(command);
        },
        undo: () => store.undo(),
        redo: () => store.redo(),
      },
    };
  });
  const start = controller.beginSelectionInteraction();
  const proposal = unwrap(
    controller.proposePointSelection({ start, point: pagePoint(20, 20), mode: 'replace' }),
  ).proposal;
  let caught: unknown;

  try {
    controller.commitMove({
      proposal,
      delta: unwrap(pageDeltaBetween(pagePoint(0, 0), pagePoint(10, 10))),
    });
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(Error);
  expect((caught as Error).message).toContain('test.restore-failed at /selection');
  expect((caught as Error).cause).toEqual(transformError);
  expect(controller.beginSelectionInteraction().token.selectionGeneration).toBe(0);
});

test('tracks selection generation only when successful operations change selection', () => {
  const ids = [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-444444444444',
  ];
  const controller = new BringsEditorController(() => {
    const id = ids.shift();
    if (id === undefined) throw new Error('fixture exhausted');
    return id;
  });
  const generation = () => controller.beginSelectionInteraction().token.selectionGeneration;

  unwrap(controller.createFrameAt(80, 100));
  expect(generation()).toBe(0);
  unwrap(controller.selectAt(90, 110));
  expect(generation()).toBe(1);
  unwrap(controller.createRectangleAt(140, 160));
  expect(generation()).toBe(2);
  unwrap(controller.undo());
  expect(generation()).toBe(3);
  unwrap(controller.redo());
  expect(generation()).toBe(4);
  unwrap(controller.selectAt(145, 165));
  expect(generation()).toBe(5);
  unwrap(controller.moveSelectionBy(5, 5));
  expect(generation()).toBe(5);
  unwrap(controller.deleteSelection());
  expect(generation()).toBe(6);
  unwrap(controller.undo());
  expect(generation()).toBe(7);
  unwrap(controller.redo());
  expect(generation()).toBe(8);
});

test('prepares detached resize geometry and commits the exact proposal as one history entry', () => {
  const controller = populatedController();
  unwrap(controller.selectAt(20, 20));
  const start = unwrap(controller.beginResizeInteraction());
  const handle = start.handles.find((entry) => entry.handle === 'south-east');
  if (handle === undefined) throw new Error('south-east fixture handle missing');
  const input = {
    handle: handle.handle,
    startPoint: { x: handle.point.x + 3, y: handle.point.y + 2 },
    currentPoint: { x: handle.point.x + 53, y: handle.point.y + 52 },
    preserveAspectRatio: false,
    fromCenter: false,
  } as const;
  const proposal = unwrap(controller.proposeResize({ start, input }));
  const command = proposal.resize.command;
  const before = controller.snapshot();

  expect(start).toMatchObject({
    token: { documentRevision: 2, selectionGeneration: 1 },
    selection: { nodeIds: [interactionIds.first], activeNodeId: interactionIds.first },
    bounds: { minX: 10, minY: 10, maxX: 60, maxY: 60 },
  });
  expect(Object.isFrozen(start)).toBe(true);
  expect(Object.isFrozen(start.handles)).toBe(true);
  expect(Object.isFrozen(proposal)).toBe(true);
  expect(Object.isFrozen(command.delta)).toBe(true);

  const committed = unwrap(controller.commitResize(proposal));
  expect(committed).toMatchObject({
    document: { revision: before.document.revision + 1 },
    selection: start.selection,
    undoDepth: before.undoDepth + 1,
  });
  expect(committed.document.nodes[0]?.transform).toEqual([
    command.delta[0],
    command.delta[1],
    command.delta[2],
    command.delta[3],
    10,
    10,
  ]);
  expect(controller.beginSelectionInteraction().token.selectionGeneration).toBe(1);
  expect(unwrap(controller.undo()).document.nodes[0]?.transform).toEqual([1, 0, 0, 1, 10, 10]);
});

test('rejects stale and forged resize proposals without changing controller state', () => {
  const controller = populatedController();
  unwrap(controller.selectAt(20, 20));
  const start = unwrap(controller.beginResizeInteraction());
  const handle = start.handles.find((entry) => entry.handle === 'east');
  if (handle === undefined) throw new Error('east fixture handle missing');
  const proposal = unwrap(
    controller.proposeResize({
      start,
      input: {
        handle: 'east',
        startPoint: handle.point,
        currentPoint: { x: handle.point.x + 20, y: handle.point.y },
        preserveAspectRatio: false,
        fromCenter: false,
      },
    }),
  );
  const before = JSON.stringify(controller.debugInteractionState());
  const forged = {
    ...proposal,
    resize: {
      ...proposal.resize,
      command: { ...proposal.resize.command, delta: [9, 0, 0, 1, 0, 0] },
    },
  } as typeof proposal;

  expect(controller.commitResize(forged)).toEqual({
    ok: false,
    error: { code: 'interaction.resize-mismatch', path: '/resize' },
  });
  expect(JSON.stringify(controller.debugInteractionState())).toBe(before);

  unwrap(controller.moveSelectionBy(1, 0));
  const afterMove = JSON.stringify(controller.debugInteractionState());
  expect(controller.commitResize(proposal)).toEqual({
    ok: false,
    error: { code: 'interaction.stale', path: '/interaction' },
  });
  expect(JSON.stringify(controller.debugInteractionState())).toBe(afterMove);
});

test('leaves document, selection, and history byte-identical when resize execution fails', () => {
  let executed: DocumentCommandInput | undefined;
  const controller = populatedController((input) => {
    const created = populatedStore(input);
    if (!created.ok) return created;
    const store = created.value;
    return {
      ok: true,
      value: {
        snapshot: () => store.snapshot(),
        setSelection: (selection) => store.setSelection(selection),
        execute(command: DocumentCommandInput): Result<EditorSnapshot> {
          if (command.kind === 'apply-transform-delta') {
            executed = command;
            return { ok: false, error: { code: 'test.resize-failed', path: '/delta' } };
          }
          return store.execute(command);
        },
        undo: () => store.undo(),
        redo: () => store.redo(),
      },
    };
  });
  unwrap(controller.selectAt(20, 20));
  const start = unwrap(controller.beginResizeInteraction());
  const handle = start.handles.find((entry) => entry.handle === 'south-east');
  if (handle === undefined) throw new Error('south-east fixture handle missing');
  const proposal = unwrap(
    controller.proposeResize({
      start,
      input: {
        handle: 'south-east',
        startPoint: handle.point,
        currentPoint: { x: handle.point.x + 50, y: handle.point.y + 50 },
        preserveAspectRatio: false,
        fromCenter: false,
      },
    }),
  );
  const before = JSON.stringify(controller.debugInteractionState());

  expect(controller.commitResize(proposal)).toEqual({
    ok: false,
    error: { code: 'test.resize-failed', path: '/delta' },
  });
  expect(executed).toEqual(proposal.resize.command);
  expect(JSON.stringify(controller.debugInteractionState())).toBe(before);
});
