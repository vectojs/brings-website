export type CameraPoint = Readonly<{ x: number; y: number }>;

export type CameraViewportSize = Readonly<{ width: number; height: number }>;

export type CameraState = Readonly<{ center: CameraPoint; zoom: number }>;

export type WheelDeltaInput = Readonly<{
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  shiftKey?: boolean;
}>;

export type CameraViewport = Readonly<{
  state: CameraState;
  pagePointAt: (point: CameraPoint) => CameraPoint;
  viewportPointAt: (point: CameraPoint) => CameraPoint;
  panBySceneDelta: (delta: CameraPoint) => CameraViewport;
  zoomAtViewportPoint: (point: CameraPoint, deltaY: number) => CameraViewport;
  zoomByFactorAtViewportPoint: (point: CameraPoint, factor: number) => CameraViewport;
}>;

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 64;
const WHEEL_ZOOM_FACTOR = 0.002;
const LINE_HEIGHT = 16;

function finitePoint(point: CameraPoint, label: string): CameraPoint {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new TypeError(`${label} coordinates must be finite.`);
  }
  return Object.freeze({ x: point.x, y: point.y });
}

function finiteViewport(size: CameraViewportSize): CameraViewportSize {
  if (
    !Number.isFinite(size.width) ||
    !Number.isFinite(size.height) ||
    size.width <= 0 ||
    size.height <= 0
  ) {
    throw new TypeError('Camera viewport dimensions must be positive finite numbers.');
  }
  return Object.freeze({ width: size.width, height: size.height });
}

function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) throw new TypeError('Camera zoom must be finite.');
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

function cameraState(center: CameraPoint, zoom: number): CameraState {
  return Object.freeze({ center: finitePoint(center, 'Camera center'), zoom: clampZoom(zoom) });
}

function viewportCenter(size: CameraViewportSize): CameraPoint {
  return Object.freeze({ x: size.width / 2, y: size.height / 2 });
}

/** Convert native wheel units to logical Design-viewport pixels. */
export function normalizeWheelDelta(
  input: WheelDeltaInput,
  viewport: CameraViewportSize,
): CameraPoint {
  const size = finiteViewport(viewport);
  if (!Number.isFinite(input.deltaX) || !Number.isFinite(input.deltaY)) {
    throw new TypeError('Wheel deltas must be finite.');
  }
  const xMultiplier = input.deltaMode === 1 ? LINE_HEIGHT : input.deltaMode === 2 ? size.width : 1;
  const yMultiplier = input.deltaMode === 1 ? LINE_HEIGHT : input.deltaMode === 2 ? size.height : 1;
  const x = input.deltaX * xMultiplier;
  const y = input.deltaY * yMultiplier;
  return input.shiftKey ? Object.freeze({ x: y, y: x }) : Object.freeze({ x, y });
}

/** Build a detached camera that maps one logical Design viewport into page space. */
export function createCameraViewport(
  viewport: CameraViewportSize,
  initialState?: CameraState,
): CameraViewport {
  const size = finiteViewport(viewport);
  const center = viewportCenter(size);
  const state =
    initialState === undefined
      ? cameraState(center, 1)
      : cameraState(initialState.center, initialState.zoom);

  const pagePointAt = (point: CameraPoint): CameraPoint => {
    const local = finitePoint(point, 'Viewport point');
    return Object.freeze({
      x: state.center.x + (local.x - center.x) / state.zoom,
      y: state.center.y + (local.y - center.y) / state.zoom,
    });
  };
  const viewportPointAt = (point: CameraPoint): CameraPoint => {
    const page = finitePoint(point, 'Page point');
    return Object.freeze({
      x: center.x + (page.x - state.center.x) * state.zoom,
      y: center.y + (page.y - state.center.y) * state.zoom,
    });
  };
  const panBySceneDelta = (delta: CameraPoint): CameraViewport => {
    const sceneDelta = finitePoint(delta, 'Scene delta');
    return createCameraViewport(size, {
      center: {
        x: state.center.x - sceneDelta.x / state.zoom,
        y: state.center.y - sceneDelta.y / state.zoom,
      },
      zoom: state.zoom,
    });
  };
  const zoomAtViewportPoint = (point: CameraPoint, deltaY: number): CameraViewport => {
    const anchor = finitePoint(point, 'Zoom anchor');
    if (!Number.isFinite(deltaY)) throw new TypeError('Zoom delta must be finite.');
    const pageAnchor = pagePointAt(anchor);
    const zoom = clampZoom(state.zoom * Math.exp(-deltaY * WHEEL_ZOOM_FACTOR));
    return createCameraViewport(size, {
      center: {
        x: pageAnchor.x - (anchor.x - center.x) / zoom,
        y: pageAnchor.y - (anchor.y - center.y) / zoom,
      },
      zoom,
    });
  };
  const zoomByFactorAtViewportPoint = (point: CameraPoint, factor: number): CameraViewport => {
    if (!Number.isFinite(factor) || factor <= 0) {
      throw new TypeError('Camera zoom factor must be a positive finite number.');
    }
    const anchor = finitePoint(point, 'Zoom anchor');
    const pageAnchor = pagePointAt(anchor);
    const zoom = clampZoom(state.zoom * factor);
    return createCameraViewport(size, {
      center: {
        x: pageAnchor.x - (anchor.x - center.x) / zoom,
        y: pageAnchor.y - (anchor.y - center.y) / zoom,
      },
      zoom,
    });
  };

  return Object.freeze({
    state,
    pagePointAt,
    viewportPointAt,
    panBySceneDelta,
    zoomAtViewportPoint,
    zoomByFactorAtViewportPoint,
  });
}
