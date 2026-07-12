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
