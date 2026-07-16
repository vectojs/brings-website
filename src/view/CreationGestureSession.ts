import type { EditorPagePoint, ViewportPoint } from '../editor/selectionCoordinates';

const GESTURE_THRESHOLD_SQUARED = 4 * 4;
const GESTURE_THRESHOLD_EPSILON = 1e-3;
const MIN_CREATION_SIZE = 1;
const IGNORE_EFFECT = Object.freeze({ kind: 'ignore' } as const);

export type CreationShapeTool = 'frame' | 'rectangle' | 'ellipse';

export type CreationBounds = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type CreationPointerSample = Readonly<{
  pointerId: number;
  viewportPoint: ViewportPoint;
  pagePoint: EditorPagePoint;
  shiftKey: boolean;
  altKey: boolean;
}>;

export type CreationGestureVisual = Readonly<{
  tool: CreationShapeTool;
  bounds: CreationBounds;
}>;

export type CreationGestureEffect =
  | Readonly<{ kind: 'preview'; visual: CreationGestureVisual }>
  | Readonly<{
      kind: 'commit';
      tool: CreationShapeTool;
      mode: 'default' | 'drag';
      bounds: CreationBounds;
    }>
  | Readonly<{
      kind: 'discard';
      reason: 'escape' | 'pointercancel' | 'tool-change' | 'authoring-disabled' | 'error';
    }>
  | Readonly<{ kind: 'ignore' }>;

export type CreationGestureCancel =
  | Readonly<{ kind: 'escape' }>
  | Readonly<{ kind: 'pointercancel'; pointerId: number }>
  | Readonly<{ kind: 'tool-change' }>
  | Readonly<{ kind: 'authoring-disabled' }>
  | Readonly<{ kind: 'error' }>;

export type CreationGestureSessionSnapshot = Readonly<{
  phase: 'pending' | 'drawing' | 'terminal';
  terminalEffect: 'commit' | 'discard' | null;
  tool: CreationShapeTool;
  pointerId: number;
  shiftKey: boolean;
  altKey: boolean;
  start: Readonly<{
    viewport: Readonly<{ x: number; y: number }>;
    page: Readonly<{ x: number; y: number }>;
  }>;
  current: Readonly<{
    viewport: Readonly<{ x: number; y: number }>;
    page: Readonly<{ x: number; y: number }>;
  }>;
  bounds: CreationBounds;
}>;

const DEFAULT_GEOMETRY: Readonly<
  Record<CreationShapeTool, Readonly<{ width: number; height: number }>>
> = Object.freeze({
  frame: Object.freeze({ width: 400, height: 300 }),
  rectangle: Object.freeze({ width: 120, height: 80 }),
  ellipse: Object.freeze({ width: 120, height: 120 }),
});

function snapshotPoint(
  point: Readonly<{ x: number; y: number }>,
): Readonly<{ x: number; y: number }> {
  return Object.freeze({ x: point.x, y: point.y });
}

function snapshotSample(sample: CreationPointerSample): CreationPointerSample {
  return Object.freeze({
    pointerId: sample.pointerId,
    viewportPoint: snapshotPoint(sample.viewportPoint) as ViewportPoint,
    pagePoint: snapshotPoint(sample.pagePoint) as EditorPagePoint,
    shiftKey: sample.shiftKey,
    altKey: sample.altKey,
  });
}

function snapshotBounds(bounds: CreationBounds): CreationBounds {
  return Object.freeze({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  });
}

function defaultBounds(tool: CreationShapeTool, sample: CreationPointerSample): CreationBounds {
  const size = DEFAULT_GEOMETRY[tool];
  return snapshotBounds({
    x: sample.pagePoint.x - (sample.altKey ? size.width / 2 : 0),
    y: sample.pagePoint.y - (sample.altKey ? size.height / 2 : 0),
    width: size.width,
    height: size.height,
  });
}

function signedMagnitude(value: number, magnitude: number): number {
  return (value < 0 ? -1 : 1) * magnitude;
}

function constrainedDelta(
  tool: CreationShapeTool,
  deltaX: number,
  deltaY: number,
): Readonly<{ x: number; y: number }> {
  const size = DEFAULT_GEOMETRY[tool];
  const ratio = size.width / size.height;
  const width = Math.max(Math.abs(deltaX), Math.abs(deltaY) * ratio, MIN_CREATION_SIZE);
  const height = Math.max(width / ratio, MIN_CREATION_SIZE);
  return Object.freeze({
    x: signedMagnitude(deltaX, width),
    y: signedMagnitude(deltaY, height),
  });
}

function dragBounds(
  tool: CreationShapeTool,
  start: CreationPointerSample,
  current: CreationPointerSample,
): CreationBounds {
  let deltaX = current.pagePoint.x - start.pagePoint.x;
  let deltaY = current.pagePoint.y - start.pagePoint.y;
  if (current.shiftKey) {
    const constrained = constrainedDelta(tool, deltaX, deltaY);
    deltaX = constrained.x;
    deltaY = constrained.y;
  } else {
    deltaX = signedMagnitude(deltaX, Math.max(Math.abs(deltaX), MIN_CREATION_SIZE));
    deltaY = signedMagnitude(deltaY, Math.max(Math.abs(deltaY), MIN_CREATION_SIZE));
  }

  if (current.altKey) {
    return snapshotBounds({
      x: start.pagePoint.x - Math.abs(deltaX),
      y: start.pagePoint.y - Math.abs(deltaY),
      width: Math.abs(deltaX) * 2,
      height: Math.abs(deltaY) * 2,
    });
  }

  const endX = start.pagePoint.x + deltaX;
  const endY = start.pagePoint.y + deltaY;
  return snapshotBounds({
    x: Math.min(start.pagePoint.x, endX),
    y: Math.min(start.pagePoint.y, endY),
    width: Math.abs(deltaX),
    height: Math.abs(deltaY),
  });
}

function crossedThreshold(start: CreationPointerSample, current: CreationPointerSample): boolean {
  const x = current.viewportPoint.x - start.viewportPoint.x;
  const y = current.viewportPoint.y - start.viewportPoint.y;
  return x * x + y * y + GESTURE_THRESHOLD_EPSILON >= GESTURE_THRESHOLD_SQUARED;
}

/**
 * Browser-free transactional creation state. It owns only transient geometry;
 * durable Brings Core state is reached through the terminal commit effect.
 */
export class CreationGestureSession {
  private phase: CreationGestureSessionSnapshot['phase'] = 'pending';
  private terminalEffect: CreationGestureSessionSnapshot['terminalEffect'] = null;
  private currentSample: CreationPointerSample;
  private currentBounds: CreationBounds;

  private constructor(
    private readonly tool: CreationShapeTool,
    private readonly startSample: CreationPointerSample,
  ) {
    this.currentSample = startSample;
    this.currentBounds = defaultBounds(tool, startSample);
  }

  public static begin(
    tool: CreationShapeTool,
    sample: CreationPointerSample,
  ): CreationGestureSession {
    return new CreationGestureSession(tool, snapshotSample(sample));
  }

  public snapshot(): CreationGestureSessionSnapshot {
    const startViewport = snapshotPoint(this.startSample.viewportPoint);
    const startPage = snapshotPoint(this.startSample.pagePoint);
    const currentViewport = snapshotPoint(this.currentSample.viewportPoint);
    const currentPage = snapshotPoint(this.currentSample.pagePoint);
    return Object.freeze({
      phase: this.phase,
      terminalEffect: this.terminalEffect,
      tool: this.tool,
      pointerId: this.startSample.pointerId,
      shiftKey: this.currentSample.shiftKey,
      altKey: this.currentSample.altKey,
      start: Object.freeze({ viewport: startViewport, page: startPage }),
      current: Object.freeze({ viewport: currentViewport, page: currentPage }),
      bounds: snapshotBounds(this.currentBounds),
    });
  }

  public update(sample: CreationPointerSample): CreationGestureEffect {
    if (this.phase === 'terminal' || sample.pointerId !== this.startSample.pointerId) {
      return IGNORE_EFFECT;
    }
    this.currentSample = snapshotSample(sample);
    if (!crossedThreshold(this.startSample, this.currentSample)) return IGNORE_EFFECT;
    this.phase = 'drawing';
    this.currentBounds = dragBounds(this.tool, this.startSample, this.currentSample);
    return Object.freeze({
      kind: 'preview',
      visual: Object.freeze({ tool: this.tool, bounds: snapshotBounds(this.currentBounds) }),
    });
  }

  public finish(sample: CreationPointerSample): CreationGestureEffect {
    if (this.phase === 'terminal' || sample.pointerId !== this.startSample.pointerId) {
      return IGNORE_EFFECT;
    }
    this.currentSample = snapshotSample(sample);
    const mode = crossedThreshold(this.startSample, this.currentSample) ? 'drag' : 'default';
    this.currentBounds =
      mode === 'drag'
        ? dragBounds(this.tool, this.startSample, this.currentSample)
        : defaultBounds(
            this.tool,
            Object.freeze({ ...this.currentSample, pagePoint: this.startSample.pagePoint }),
          );
    this.phase = 'terminal';
    this.terminalEffect = 'commit';
    return Object.freeze({
      kind: 'commit',
      tool: this.tool,
      mode,
      bounds: snapshotBounds(this.currentBounds),
    });
  }

  public cancel(input: CreationGestureCancel): CreationGestureEffect {
    if (this.phase === 'terminal') return IGNORE_EFFECT;
    if (input.kind === 'pointercancel' && input.pointerId !== this.startSample.pointerId) {
      return IGNORE_EFFECT;
    }
    this.phase = 'terminal';
    this.terminalEffect = 'discard';
    return Object.freeze({ kind: 'discard', reason: input.kind });
  }
}
