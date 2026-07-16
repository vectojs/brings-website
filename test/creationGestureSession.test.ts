import { expect, test } from 'bun:test';
import type { Result } from '@vectojs/brings-core';
import {
  CreationGestureSession,
  type CreationPointerSample,
  type CreationShapeTool,
} from '../src/view/CreationGestureSession';
import {
  editorPagePoint,
  viewportPoint,
  type EditorPagePoint,
  type ViewportPoint,
} from '../src/editor/selectionCoordinates';

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function sample(
  pointerId: number,
  viewportX: number,
  viewportY: number,
  pageX = viewportX,
  pageY = viewportY,
  shiftKey = false,
  altKey = false,
): CreationPointerSample {
  return Object.freeze({
    pointerId,
    viewportPoint: unwrap(viewportPoint(viewportX, viewportY)) as ViewportPoint,
    pagePoint: unwrap(editorPagePoint(pageX, pageY)) as EditorPagePoint,
    shiftKey,
    altKey,
  });
}

test.each([
  ['frame', 400, 300],
  ['rectangle', 120, 80],
  ['ellipse', 120, 120],
] as const)('commits the %s default bounds for a click', (tool, width, height) => {
  const session = CreationGestureSession.begin(tool, sample(7, 20, 30, 120, 140));

  expect(session.finish(sample(7, 22, 31, 122, 141))).toEqual({
    kind: 'commit',
    tool,
    mode: 'default',
    bounds: { x: 120, y: 140, width, height },
  });
  expect(session.snapshot()).toMatchObject({
    phase: 'terminal',
    terminalEffect: 'commit',
  });
});

test('previews and commits normalized page bounds after crossing the viewport threshold', () => {
  const session = CreationGestureSession.begin('rectangle', sample(8, 10, 20, 100, 200));

  expect(session.update(sample(8, 13, 22, 80, 160))).toEqual({ kind: 'ignore' });
  expect(session.update(sample(8, 30, 40, 60, 150))).toEqual({
    kind: 'preview',
    visual: {
      tool: 'rectangle',
      bounds: { x: 60, y: 150, width: 40, height: 50 },
    },
  });
  expect(session.finish(sample(8, 35, 45, 50, 140))).toEqual({
    kind: 'commit',
    tool: 'rectangle',
    mode: 'drag',
    bounds: { x: 50, y: 140, width: 50, height: 60 },
  });
});

test.each([
  ['frame', 4 / 3],
  ['rectangle', 3 / 2],
  ['ellipse', 1],
] as const)('Shift preserves the %s default aspect ratio', (tool, ratio) => {
  const session = CreationGestureSession.begin(tool, sample(9, 0, 0, 100, 100));
  const effect = session.update(sample(9, 30, 50, 130, 150, true));

  expect(effect.kind).toBe('preview');
  if (effect.kind !== 'preview') throw new Error('missing preview');
  expect(effect.visual.bounds.width / effect.visual.bounds.height).toBeCloseTo(ratio, 10);
  expect(effect.visual.bounds.x).toBe(100);
  expect(effect.visual.bounds.y).toBe(100);
});

test('Alt creates from center and combines dynamically with Shift', () => {
  const session = CreationGestureSession.begin('ellipse', sample(10, 50, 50, 200, 300));

  expect(session.update(sample(10, 80, 70, 230, 320, false, true))).toEqual({
    kind: 'preview',
    visual: {
      tool: 'ellipse',
      bounds: { x: 170, y: 280, width: 60, height: 40 },
    },
  });
  expect(session.update(sample(10, 80, 70, 230, 320, true, true))).toEqual({
    kind: 'preview',
    visual: {
      tool: 'ellipse',
      bounds: { x: 170, y: 270, width: 60, height: 60 },
    },
  });
});

test('Alt centers default click geometry around the pointer-down point', () => {
  const session = CreationGestureSession.begin(
    'rectangle',
    sample(11, 50, 50, 200, 300, false, true),
  );

  expect(session.finish(sample(11, 50, 50, 200, 300, false, true))).toMatchObject({
    kind: 'commit',
    mode: 'default',
    bounds: { x: 140, y: 260, width: 120, height: 80 },
  });
});

test.each(['escape', 'pointercancel', 'tool-change', 'authoring-disabled'] as const)(
  'discards %s once and ignores late events',
  (reason) => {
    const session = CreationGestureSession.begin('frame', sample(12, 0, 0));
    session.update(sample(12, 30, 40));

    expect(
      session.cancel(
        reason === 'pointercancel' ? { kind: 'pointercancel', pointerId: 12 } : { kind: reason },
      ),
    ).toEqual({ kind: 'discard', reason });
    expect(session.finish(sample(12, 100, 100))).toEqual({ kind: 'ignore' });
  },
);

test('ignores foreign pointers without changing owner diagnostics', () => {
  const session = CreationGestureSession.begin('ellipse', sample(13, 10, 10));

  expect(session.update(sample(99, 100, 100))).toEqual({ kind: 'ignore' });
  expect(session.cancel({ kind: 'pointercancel', pointerId: 99 })).toEqual({ kind: 'ignore' });
  expect(session.snapshot()).toMatchObject({ phase: 'pending', pointerId: 13 });
});

test('returns fresh deeply frozen diagnostics with current modifier and bounds state', () => {
  const session = CreationGestureSession.begin('rectangle', sample(14, 10, 20, 100, 200));
  session.update(sample(14, 30, 50, 130, 250, true, true));

  const snapshot = session.snapshot();
  const again = session.snapshot();
  expect(snapshot).not.toBe(again);
  expect(snapshot).toMatchObject({
    phase: 'drawing',
    tool: 'rectangle',
    pointerId: 14,
    shiftKey: true,
    altKey: true,
    start: { viewport: { x: 10, y: 20 }, page: { x: 100, y: 200 } },
    current: { viewport: { x: 30, y: 50 }, page: { x: 130, y: 250 } },
  });
  expect(Object.isFrozen(snapshot)).toBe(true);
  expect(Object.isFrozen(snapshot.bounds)).toBe(true);
});

test('supports every public shape tool in its detached tool contract', () => {
  const tools: readonly CreationShapeTool[] = ['frame', 'rectangle', 'ellipse'];
  expect(
    tools.map((tool) => CreationGestureSession.begin(tool, sample(20, 0, 0)).snapshot().tool),
  ).toEqual([...tools]);
});
