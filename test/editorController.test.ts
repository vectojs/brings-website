import { expect, test } from 'bun:test';
import { BringsEditorController } from '../src/editor/BringsEditorController';

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
