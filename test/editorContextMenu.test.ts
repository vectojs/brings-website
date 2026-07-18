import { expect, test } from 'bun:test';
import type { EditorSnapshot, NodeId, PageId } from '@vectojs/brings-core';
import { deriveEditorCommandState } from '../src/view/editorContextMenu';

const pageId = '00000000-0000-4000-8000-000000000002' as PageId;
const first = '11111111-1111-4111-8111-111111111111' as NodeId;
const second = '22222222-2222-4222-8222-222222222222' as NodeId;
const third = '33333333-3333-4333-8333-333333333333' as NodeId;
const child = '44444444-4444-4444-8444-444444444444' as NodeId;

function snapshot(selection: readonly NodeId[] = []): EditorSnapshot {
  return {
    document: {
      id: '00000000-0000-4000-8000-000000000001' as EditorSnapshot['document']['id'],
      revision: 4,
      name: 'Fixture',
      pageOrder: [pageId],
      activePageId: pageId,
      pages: [{ id: pageId, name: 'Page 1', rootNodeIds: [first, second, third] }],
      nodes: [
        {
          id: first,
          name: 'First',
          parentId: null,
          visible: true,
          locked: false,
          opacity: 1,
          transform: [1, 0, 0, 1, 0, 0],
          type: 'rectangle',
          width: 10,
          height: 10,
          cornerRadii: [0, 0, 0, 0],
          fill: null,
          stroke: null,
        },
        {
          id: second,
          name: 'Group',
          parentId: null,
          visible: true,
          locked: false,
          opacity: 1,
          transform: [1, 0, 0, 1, 20, 0],
          type: 'group',
          childIds: [child],
        },
        {
          id: third,
          name: 'Third',
          parentId: null,
          visible: true,
          locked: false,
          opacity: 1,
          transform: [1, 0, 0, 1, 40, 0],
          type: 'ellipse',
          width: 10,
          height: 10,
          fill: null,
          stroke: null,
        },
        {
          id: child,
          name: 'Child',
          parentId: second,
          visible: true,
          locked: false,
          opacity: 1,
          transform: [1, 0, 0, 1, 0, 0],
          type: 'rectangle',
          width: 5,
          height: 5,
          cornerRadii: [0, 0, 0, 0],
          fill: null,
          stroke: null,
        },
      ],
    },
    selection: { nodeIds: selection, activeNodeId: selection.at(-1) ?? null },
    undoDepth: 0,
    redoDepth: 0,
  };
}

test('derives empty and sibling multi-selection command availability', () => {
  expect(deriveEditorCommandState(snapshot())).toEqual({
    canSelectAll: true,
    canDelete: false,
    canGroup: false,
    canUngroup: false,
    canBringForward: false,
    canBringFront: false,
    canSendBackward: false,
    canSendBack: false,
  });
  expect(deriveEditorCommandState(snapshot([first, third]))).toMatchObject({
    canDelete: true,
    canGroup: true,
    canUngroup: false,
    canBringForward: false,
    canBringFront: false,
    canSendBackward: false,
    canSendBack: false,
  });
});

test('derives arrange edges and group ungroup availability from normalized structure', () => {
  expect(deriveEditorCommandState(snapshot([first]))).toMatchObject({
    canDelete: true,
    canGroup: false,
    canUngroup: false,
    canBringForward: true,
    canBringFront: true,
    canSendBackward: false,
    canSendBack: false,
  });
  expect(deriveEditorCommandState(snapshot([second]))).toMatchObject({
    canUngroup: true,
    canBringForward: true,
    canBringFront: true,
    canSendBackward: true,
    canSendBack: true,
  });
  expect(deriveEditorCommandState(snapshot([third]))).toMatchObject({
    canBringForward: false,
    canBringFront: false,
    canSendBackward: true,
    canSendBack: true,
  });
  expect(deriveEditorCommandState(snapshot([child]))).toMatchObject({
    canBringForward: false,
    canBringFront: false,
    canSendBackward: false,
    canSendBack: false,
  });
});

test('rejects grouping selections that do not share one parent', () => {
  expect(deriveEditorCommandState(snapshot([first, child]))).toMatchObject({
    canDelete: true,
    canGroup: false,
  });
});
