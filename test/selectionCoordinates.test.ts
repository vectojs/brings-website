import { expect, test } from 'bun:test';
import type { Result } from '@vectojs/brings-core';
import {
  pageDeltaBetween,
  pageRectBetween,
  viewportPoint,
  viewportToPagePoint,
  type EditorPagePoint,
  type EditorPageRect,
  type PageDelta,
  type ViewportPoint,
} from '../src/editor/selectionCoordinates';

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

test('constructs finite viewport and identity page points as fresh frozen values', () => {
  const viewport = unwrap(viewportPoint(12, 18));
  const duplicate = unwrap(viewportPoint(12, 18));
  const page = unwrap(viewportToPagePoint(viewport));
  const duplicatePage = unwrap(viewportToPagePoint(viewport));

  expect(viewport).toMatchObject({ x: 12, y: 18 });
  expect(page).toMatchObject({ x: 12, y: 18 });
  expect(viewport).not.toBe(duplicate);
  expect(viewport).not.toBe(page);
  expect(page).not.toBe(duplicatePage);
  expect(Object.isFrozen(viewport)).toBe(true);
  expect(Object.isFrozen(page)).toBe(true);
  expect(Reflect.ownKeys(viewport)).toEqual(['x', 'y']);
  expect(Reflect.ownKeys(page)).toEqual(['x', 'y']);
});

test('normalizes reversed page rectangles and derives page deltas', () => {
  const viewport = unwrap(viewportPoint(12, 18));
  const page = unwrap(viewportToPagePoint(viewport));
  const reverseViewport = unwrap(viewportPoint(2, 3));
  const reversePage = unwrap(viewportToPagePoint(reverseViewport));
  const rect = unwrap(pageRectBetween(page, reversePage));
  const delta = unwrap(pageDeltaBetween(page, reversePage));
  const duplicateRect = unwrap(pageRectBetween(page, reversePage));
  const duplicateDelta = unwrap(pageDeltaBetween(page, reversePage));

  expect(rect).toMatchObject({ x: 2, y: 3, width: 10, height: 15 });
  expect(delta).toMatchObject({ x: -10, y: -15 });
  expect(rect).not.toBe(duplicateRect);
  expect(delta).not.toBe(duplicateDelta);
  expect(Object.isFrozen(rect)).toBe(true);
  expect(Object.isFrozen(delta)).toBe(true);
  expect(Reflect.ownKeys(rect)).toEqual(['x', 'y', 'width', 'height']);
  expect(Reflect.ownKeys(delta)).toEqual(['x', 'y']);
});

test('rejects non-finite viewport and page-point construction at stable paths', () => {
  expect(viewportPoint(Number.NaN, 1)).toEqual({
    ok: false,
    error: { code: 'interaction.coordinate-invalid', path: '/viewport/x' },
  });
  expect(viewportPoint(1, Number.POSITIVE_INFINITY)).toEqual({
    ok: false,
    error: { code: 'interaction.coordinate-invalid', path: '/viewport/y' },
  });

  expect(viewportToPagePoint({ x: Number.NEGATIVE_INFINITY, y: 1 } as ViewportPoint)).toEqual({
    ok: false,
    error: { code: 'interaction.coordinate-invalid', path: '/page/x' },
  });
  expect(viewportToPagePoint({ x: 1, y: Number.NaN } as ViewportPoint)).toEqual({
    ok: false,
    error: { code: 'interaction.coordinate-invalid', path: '/page/y' },
  });
});

test('rejects non-finite derived rectangle and delta arithmetic', () => {
  const negative = { x: -Number.MAX_VALUE, y: 0 } as EditorPagePoint;
  const positive = { x: Number.MAX_VALUE, y: 1 } as EditorPagePoint;

  expect(pageRectBetween(negative, positive)).toEqual({
    ok: false,
    error: { code: 'interaction.coordinate-invalid', path: '/rect' },
  });
  expect(pageDeltaBetween(negative, positive)).toEqual({
    ok: false,
    error: { code: 'interaction.coordinate-invalid', path: '/delta' },
  });
});

test('snapshots accessor-backed viewport coordinates exactly once', () => {
  let xReads = 0;
  let yReads = 0;
  const point = Object.defineProperties(
    {},
    {
      x: {
        get() {
          xReads += 1;
          return xReads === 1 ? 12 : Number.NaN;
        },
      },
      y: {
        get() {
          yReads += 1;
          return yReads === 1 ? 18 : Number.NaN;
        },
      },
    },
  ) as ViewportPoint;

  const result = viewportToPagePoint(point);

  expect(result).toMatchObject({ ok: true, value: { x: 12, y: 18 } });
  expect(xReads).toBe(1);
  expect(yReads).toBe(1);
});

test('derives rectangles consistently from one proxy read per coordinate', () => {
  const reads = { startX: 0, startY: 0, currentX: 0, currentY: 0 };
  const start = new Proxy({} as EditorPagePoint, {
    get(_target, property) {
      if (property === 'x') {
        reads.startX += 1;
        return reads.startX === 1 ? 12 : Number.NaN;
      }
      if (property === 'y') {
        reads.startY += 1;
        return reads.startY === 1 ? 18 : Number.NaN;
      }
      return undefined;
    },
  });
  const current = new Proxy({} as EditorPagePoint, {
    get(_target, property) {
      if (property === 'x') {
        reads.currentX += 1;
        return reads.currentX === 1 ? 2 : Number.NaN;
      }
      if (property === 'y') {
        reads.currentY += 1;
        return reads.currentY === 1 ? 3 : Number.NaN;
      }
      return undefined;
    },
  });

  expect(pageRectBetween(start, current)).toMatchObject({
    ok: true,
    value: { x: 2, y: 3, width: 10, height: 15 },
  });
  expect(reads).toEqual({ startX: 1, startY: 1, currentX: 1, currentY: 1 });
});

test('rejects a snapshotted non-finite proxy delta without rereading it', () => {
  const reads = { startX: 0, startY: 0, currentX: 0, currentY: 0 };
  const start = new Proxy({} as EditorPagePoint, {
    get(_target, property) {
      if (property === 'x') {
        reads.startX += 1;
        return 12;
      }
      if (property === 'y') {
        reads.startY += 1;
        return 18;
      }
      return undefined;
    },
  });
  const current = new Proxy({} as EditorPagePoint, {
    get(_target, property) {
      if (property === 'x') {
        reads.currentX += 1;
        return reads.currentX === 1 ? Number.POSITIVE_INFINITY : 2;
      }
      if (property === 'y') {
        reads.currentY += 1;
        return 3;
      }
      return undefined;
    },
  });

  expect(pageDeltaBetween(start, current)).toEqual({
    ok: false,
    error: { code: 'interaction.coordinate-invalid', path: '/delta' },
  });
  expect(reads).toEqual({ startX: 1, startY: 1, currentX: 1, currentY: 1 });
});

test('keeps viewport, page, rectangle, and delta values nominally separate', () => {
  const viewport = unwrap(viewportPoint(12, 18));
  const page = unwrap(viewportToPagePoint(viewport));
  const otherPage = unwrap(viewportToPagePoint(unwrap(viewportPoint(2, 3))));
  const rect = unwrap(pageRectBetween(page, otherPage));
  const delta = unwrap(pageDeltaBetween(page, otherPage));

  // @ts-expect-error Viewport points are not Editor page points.
  const invalidPage: EditorPagePoint = viewport;
  // @ts-expect-error Editor page points are not movement deltas.
  const invalidDelta: PageDelta = page;
  // @ts-expect-error Editor page points are not viewport points.
  const invalidViewport: ViewportPoint = page;
  // @ts-expect-error Plain structural rectangles do not carry the private brand.
  const invalidRectLiteral: EditorPageRect = { x: 0, y: 0, width: 1, height: 1 };
  // @ts-expect-error Branded rectangles are not Editor page points.
  const invalidPointFromRect: EditorPagePoint = rect;
  // @ts-expect-error Branded deltas are not viewport points.
  const invalidViewportFromDelta: ViewportPoint = delta;

  void invalidPage;
  void invalidDelta;
  void invalidViewport;
  void invalidRectLiteral;
  void invalidPointFromRect;
  void invalidViewportFromDelta;
});
