import { expect, test } from 'bun:test';
import type { Matrix, NodeId, ResizeHandlePosition } from '@vectojs/brings-core';
import type { ResizeInteractionStart } from '../src/editor/selectionInteraction';
import {
  captureResizeInteraction,
  resolveResizePreviewLocalMatrix,
} from '../src/view/ResizeInteractionGeometry';

const first = '11111111-1111-4111-8111-111111111111' as NodeId;

function start(handles?: readonly ResizeHandlePosition[]): ResizeInteractionStart {
  return {
    token: { documentRevision: 4, selectionGeneration: 2 },
    selection: { nodeIds: [first], activeNodeId: first },
    bounds: { minX: 10, minY: 20, maxX: 110, maxY: 70 },
    handles: handles ?? [
      { handle: 'north-west', point: { x: 10, y: 20 } },
      { handle: 'north', point: { x: 60, y: 20 } },
      { handle: 'north-east', point: { x: 110, y: 20 } },
      { handle: 'east', point: { x: 110, y: 45 } },
      { handle: 'south-east', point: { x: 110, y: 70 } },
      { handle: 'south', point: { x: 60, y: 70 } },
      { handle: 'south-west', point: { x: 10, y: 70 } },
      { handle: 'west', point: { x: 10, y: 45 } },
    ],
  };
}

test('captures one immutable interaction with Core-order hit and overlay geometry', () => {
  const source = start();
  const result = captureResizeInteraction(source);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  const captured = result.value;
  const again = captureResizeInteraction(captured.start);

  (source.bounds as { minX: number }).minX = -999;
  (source.handles[0]!.point as { x: number }).x = -999;
  expect(again).toEqual({ ok: true, value: captured });
  expect(captured.start.bounds.minX).toBe(10);
  expect(captured.hit({ x: 10, y: 20 })).toBe('north-west');
  expect(captured.overlay()).toEqual({
    bounds: { minX: 10, minY: 20, maxX: 110, maxY: 70 },
    handles: [
      { center: { x: 10, y: 20 }, x: 6, y: 16, width: 8, height: 8 },
      { center: { x: 60, y: 20 }, x: 56, y: 16, width: 8, height: 8 },
      { center: { x: 110, y: 20 }, x: 106, y: 16, width: 8, height: 8 },
      { center: { x: 110, y: 45 }, x: 106, y: 41, width: 8, height: 8 },
      { center: { x: 110, y: 70 }, x: 106, y: 66, width: 8, height: 8 },
      { center: { x: 60, y: 70 }, x: 56, y: 66, width: 8, height: 8 },
      { center: { x: 10, y: 70 }, x: 6, y: 66, width: 8, height: 8 },
      { center: { x: 10, y: 45 }, x: 6, y: 41, width: 8, height: 8 },
    ],
  });
  expect(Object.isFrozen(captured)).toBe(true);
  expect(Object.isFrozen(captured.start.handles)).toBe(true);
  expect(Object.isFrozen(captured.overlay()?.handles)).toBe(true);
});

test('keeps exact tie order and resolves page-space preview matrix ordering', () => {
  const handles = start().handles.map((entry, index) =>
    index < 2 ? { handle: entry.handle, point: { x: 10, y: 20 } } : entry,
  );
  const result = captureResizeInteraction(start(handles));
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  expect(result.value.hit({ x: 10, y: 20 })).toBe('north-west');

  const resolved = resolveResizePreviewLocalMatrix(
    Object.freeze([2, 0, 0, 2, 0, 0]) as Matrix,
    Object.freeze([1, 0, 0, 1, 10, 12]) as Matrix,
    Object.freeze([-1, 0, 0, 2, 300, -40]) as Matrix,
  );
  expect(resolved).toEqual({ ok: true, value: [-1, 0, 0, 2, 140, 4] });
});
