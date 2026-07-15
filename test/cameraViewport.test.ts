import { expect, test } from 'bun:test';
import {
  createCameraViewport,
  normalizeWheelDelta,
  type CameraViewport,
} from '../src/view/CameraViewport';

function camera(
  viewport: Readonly<{ width: number; height: number }> = { width: 800, height: 600 },
): CameraViewport {
  return createCameraViewport(viewport);
}

test('maps the default camera as an identity viewport', () => {
  const value = camera();
  expect(value.state).toEqual({ center: { x: 400, y: 300 }, zoom: 1 });
  expect(value.pagePointAt({ x: 120, y: 80 })).toEqual({ x: 120, y: 80 });
  expect(value.viewportPointAt({ x: 120, y: 80 })).toEqual({ x: 120, y: 80 });
});

test('pans in inverse page space without changing zoom', () => {
  const value = createCameraViewport(
    { width: 800, height: 600 },
    { center: { x: 100, y: 80 }, zoom: 2 },
  );
  expect(value.panBySceneDelta({ x: 20, y: -10 }).state).toEqual({
    center: { x: 90, y: 85 },
    zoom: 2,
  });
});

test('normalizes wheel delta modes and Shift axis swapping', () => {
  expect(
    normalizeWheelDelta({ deltaX: 2, deltaY: -3, deltaMode: 0 }, { width: 800, height: 600 }),
  ).toEqual({
    x: 2,
    y: -3,
  });
  expect(
    normalizeWheelDelta({ deltaX: 2, deltaY: -3, deltaMode: 1 }, { width: 800, height: 600 }),
  ).toEqual({
    x: 32,
    y: -48,
  });
  expect(
    normalizeWheelDelta({ deltaX: 2, deltaY: -3, deltaMode: 2 }, { width: 800, height: 600 }),
  ).toEqual({
    x: 1600,
    y: -1800,
  });
  expect(
    normalizeWheelDelta(
      { deltaX: 2, deltaY: -3, deltaMode: 0, shiftKey: true },
      { width: 800, height: 600 },
    ),
  ).toEqual({ x: -3, y: 2 });
});

test('keeps the page point below the pointer fixed while clamping zoom', () => {
  const value = camera();
  const pointer = { x: 650, y: 200 };
  const pageBefore = value.pagePointAt(pointer);
  const zoomed = value.zoomAtViewportPoint(pointer, -200);
  expect(zoomed.state.zoom).toBeGreaterThan(1);
  expect(zoomed.viewportPointAt(pageBefore).x).toBeCloseTo(pointer.x, 10);
  expect(zoomed.viewportPointAt(pageBefore).y).toBeCloseTo(pointer.y, 10);
  expect(value.zoomAtViewportPoint(pointer, 100_000).state.zoom).toBe(0.05);
  expect(value.zoomAtViewportPoint(pointer, -100_000).state.zoom).toBe(64);
});
