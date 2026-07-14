import type {
  BringsError,
  Matrix,
  NodeId,
  ResizeBounds,
  ResizeHandle,
  ResizeHandlePosition,
  ResizePoint,
  Result,
  SelectionResizeProposal,
  StructuralSelection,
} from '@vectojs/brings-core';
import type {
  ResizeInteractionStart,
  SelectionInteractionToken,
} from '../editor/selectionInteraction';

const INTERRUPTED = Symbol('resize-interaction-capture-interrupted');
const RESIZE_HANDLE_SIZE = 8;
const RESIZE_HANDLE_HIT_SLOP = 6;
const RESIZE_HANDLE_HIT_HALF_SIZE = RESIZE_HANDLE_SIZE / 2 + RESIZE_HANDLE_HIT_SLOP;
const CAPTURED_STARTS = new WeakMap<ResizeInteractionStart, CapturedResizeInteraction>();

type CaptureGuard = () => boolean;

export type ResizeOverlayGeometry = Readonly<{
  bounds: ResizeBounds;
  handles: readonly Readonly<{
    center: ResizePoint;
    x: number;
    y: number;
    width: number;
    height: number;
  }>[];
}>;

export type ResizePreviewMatrixResult =
  | Readonly<{ ok: true; value: Matrix }>
  | Readonly<{ ok: false; reason: 'unsupported' | 'overflow' }>;

/** Immutable resize data and pure geometry derived from one captured Core start. */
export type CapturedResizeInteraction = Readonly<{
  start: ResizeInteractionStart;
  hit(point: ResizePoint): ResizeHandle | null;
  overlay(resize?: SelectionResizeProposal): ResizeOverlayGeometry | null;
}>;

function guardedRead<T>(read: () => T, guard?: CaptureGuard): T {
  const value = read();
  if (guard !== undefined && !guard()) throw INTERRUPTED;
  return value;
}

function snapshotToken(
  token: SelectionInteractionToken,
  guard?: CaptureGuard,
): SelectionInteractionToken {
  return Object.freeze({
    documentRevision: guardedRead(() => token.documentRevision, guard),
    selectionGeneration: guardedRead(() => token.selectionGeneration, guard),
  });
}

function snapshotNodeIds(nodeIds: readonly NodeId[], guard?: CaptureGuard): readonly NodeId[] {
  const length = guardedRead(() => nodeIds.length, guard);
  const detached: NodeId[] = [];
  for (let index = 0; index < length; index += 1) {
    detached.push(guardedRead(() => nodeIds[index]!, guard));
  }
  return Object.freeze(detached);
}

function snapshotSelection(
  selection: StructuralSelection,
  guard?: CaptureGuard,
): StructuralSelection {
  const nodeIds = guardedRead(() => selection.nodeIds, guard);
  return Object.freeze({
    nodeIds: snapshotNodeIds(nodeIds, guard),
    activeNodeId: guardedRead(() => selection.activeNodeId, guard),
  });
}

function snapshotPoint(point: ResizePoint, guard?: CaptureGuard): ResizePoint {
  return Object.freeze({
    x: guardedRead(() => point.x, guard),
    y: guardedRead(() => point.y, guard),
  });
}

function snapshotBounds(bounds: ResizeBounds, guard?: CaptureGuard): ResizeBounds {
  return Object.freeze({
    minX: guardedRead(() => bounds.minX, guard),
    minY: guardedRead(() => bounds.minY, guard),
    maxX: guardedRead(() => bounds.maxX, guard),
    maxY: guardedRead(() => bounds.maxY, guard),
  });
}

function snapshotHandles(
  handles: readonly ResizeHandlePosition[],
  guard?: CaptureGuard,
): readonly ResizeHandlePosition[] {
  const length = guardedRead(() => handles.length, guard);
  const detached: ResizeHandlePosition[] = [];
  for (let index = 0; index < length; index += 1) {
    const source = guardedRead(() => handles[index]!, guard);
    detached.push(
      Object.freeze({
        handle: guardedRead(() => source.handle, guard),
        point: snapshotPoint(
          guardedRead(() => source.point, guard),
          guard,
        ),
      }),
    );
  }
  return Object.freeze(detached);
}

function snapshotStart(
  start: ResizeInteractionStart,
  guard?: CaptureGuard,
): ResizeInteractionStart {
  return Object.freeze({
    token: snapshotToken(
      guardedRead(() => start.token, guard),
      guard,
    ),
    selection: snapshotSelection(
      guardedRead(() => start.selection, guard),
      guard,
    ),
    bounds: snapshotBounds(
      guardedRead(() => start.bounds, guard),
      guard,
    ),
    handles: snapshotHandles(
      guardedRead(() => start.handles, guard),
      guard,
    ),
  });
}

function hitHandle(
  handles: readonly ResizeHandlePosition[],
  point: ResizePoint,
): ResizeHandle | null {
  let hit: ResizeHandle | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const entry of handles) {
    const dx = point.x - entry.point.x;
    const dy = point.y - entry.point.y;
    if (Math.abs(dx) > RESIZE_HANDLE_HIT_HALF_SIZE || Math.abs(dy) > RESIZE_HANDLE_HIT_HALF_SIZE) {
      continue;
    }
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      hit = entry.handle;
      bestDistance = distance;
    }
  }
  return hit;
}

function transformPoint(matrix: Matrix, point: ResizePoint): ResizePoint | null {
  if (matrix[1] !== 0 || matrix[2] !== 0) return null;
  const x = matrix[0] * point.x + matrix[4];
  const y = matrix[3] * point.y + matrix[5];
  return Number.isFinite(x) && Number.isFinite(y) ? Object.freeze({ x, y }) : null;
}

function freezeOverlay(
  bounds: ResizeBounds,
  handles: readonly ResizePoint[],
): ResizeOverlayGeometry | null {
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  if (![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY, width, height].every(Number.isFinite)) {
    return null;
  }
  return Object.freeze({
    bounds: snapshotBounds(bounds),
    handles: Object.freeze(
      handles.map((point) => {
        const center = snapshotPoint(point);
        return Object.freeze({
          center,
          x: center.x - RESIZE_HANDLE_SIZE / 2,
          y: center.y - RESIZE_HANDLE_SIZE / 2,
          width: RESIZE_HANDLE_SIZE,
          height: RESIZE_HANDLE_SIZE,
        });
      }),
    ),
  });
}

function createCaptured(start: ResizeInteractionStart): CapturedResizeInteraction {
  const baseOverlay = freezeOverlay(
    start.bounds,
    start.handles.map((entry) => entry.point),
  );
  return Object.freeze({
    start,
    hit: (point: ResizePoint) => hitHandle(start.handles, point),
    overlay: (resize?: SelectionResizeProposal) => {
      if (resize === undefined) return baseOverlay;
      const handles: ResizePoint[] = [];
      for (const entry of start.handles) {
        const point = transformPoint(resize.command.delta, entry.point);
        if (point === null) return null;
        handles.push(point);
      }
      return freezeOverlay(resize.bounds, handles);
    },
  });
}

/** Capture caller-owned Core geometry once and reuse it without further accessor reads. */
export function captureResizeInteraction(
  source: ResizeInteractionStart,
  guard?: CaptureGuard,
): Result<CapturedResizeInteraction> {
  try {
    const cached = CAPTURED_STARTS.get(source);
    if (cached !== undefined) {
      if (guard !== undefined && !guard()) throw INTERRUPTED;
      return Object.freeze({ ok: true, value: cached });
    }
    const start = snapshotStart(source, guard);
    const captured = createCaptured(start);
    CAPTURED_STARTS.set(start, captured);
    return Object.freeze({ ok: true, value: captured });
  } catch {
    const error: BringsError = Object.freeze({
      code: 'interaction.coordinate-invalid',
      path: '/resize/start',
    });
    return Object.freeze({ ok: false, error });
  }
}

function multiplyMatrices(left: Matrix, right: Matrix): Matrix | null {
  const product = [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
  return product.every(Number.isFinite) ? (Object.freeze(product) as Matrix) : null;
}

function axisAlignedInverse(matrix: Matrix): Matrix | null {
  if (matrix[1] !== 0 || matrix[2] !== 0 || matrix[0] === 0 || matrix[3] === 0) return null;
  const inverse = [
    1 / matrix[0],
    0,
    0,
    1 / matrix[3],
    -matrix[4] / matrix[0],
    -matrix[5] / matrix[3],
  ];
  return inverse.every(Number.isFinite) ? (Object.freeze(inverse) as Matrix) : null;
}

/** Resolve a page-space resize delta into one selected root's parent-local matrix. */
export function resolveResizePreviewLocalMatrix(
  parent: Matrix,
  local: Matrix,
  delta: Matrix,
): ResizePreviewMatrixResult {
  if (
    parent[1] !== 0 ||
    parent[2] !== 0 ||
    local[1] !== 0 ||
    local[2] !== 0 ||
    delta[1] !== 0 ||
    delta[2] !== 0
  ) {
    return Object.freeze({ ok: false, reason: 'unsupported' });
  }
  const inverse = axisAlignedInverse(parent);
  if (inverse === null) return Object.freeze({ ok: false, reason: 'unsupported' });
  const deltaInParent = multiplyMatrices(inverse, delta);
  if (deltaInParent === null) return Object.freeze({ ok: false, reason: 'overflow' });
  const composed = multiplyMatrices(deltaInParent, parent);
  if (composed === null) return Object.freeze({ ok: false, reason: 'overflow' });
  const value = multiplyMatrices(composed, local);
  return value === null
    ? Object.freeze({ ok: false, reason: 'overflow' })
    : Object.freeze({ ok: true, value });
}
