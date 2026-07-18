import type { BringsError, Result } from '@vectojs/brings-core';
import type { CompletedPathAnchor, CompletedPathInput } from '../editor/BringsEditorController';
import type { EditorPagePoint, ViewportPoint } from '../editor/selectionCoordinates';

const DRAG_THRESHOLD_SQUARED = 4 * 4;
const DRAG_THRESHOLD_EPSILON = 1e-3;
const CLOSE_RADIUS_SQUARED = 8 * 8;
const IGNORE_EFFECT = Object.freeze({ kind: 'ignore' } as const);

export type PenPointerSample = Readonly<{
  pointerId: number;
  viewportPoint: ViewportPoint;
  pagePoint: EditorPagePoint;
}>;

export type PenPathVisual = Readonly<{
  network: readonly CompletedPathAnchor[];
  previewAnchor: CompletedPathAnchor | null;
  closeCandidate: boolean;
}>;

export type PenPathEffect =
  | Readonly<{ kind: 'preview'; visual: PenPathVisual }>
  | Readonly<{
      kind: 'commit';
      network: readonly CompletedPathAnchor[];
      closed: boolean;
    }>
  | Readonly<{
      kind: 'discard';
      reason: 'escape' | 'pointercancel' | 'tool-change' | 'authoring-disabled';
    }>
  | Readonly<{ kind: 'discard'; reason: 'error'; error: BringsError }>
  | Readonly<{ kind: 'ignore' }>;

export type PenPathCancel =
  | Readonly<{ kind: 'escape' }>
  | Readonly<{ kind: 'pointercancel'; pointerId: number }>
  | Readonly<{ kind: 'tool-change' }>
  | Readonly<{ kind: 'authoring-disabled' }>;

export type PenPathSessionSnapshot = Readonly<{
  phase: 'drawing' | 'terminal';
  terminalEffect: 'commit' | 'discard' | null;
  pointerId: number | null;
  network: readonly CompletedPathAnchor[];
  previewAnchor: CompletedPathAnchor | null;
  closeCandidate: boolean;
}>;

type CapturedSample = Readonly<{
  pointerId: number;
  viewportPoint: ViewportPoint;
  pagePoint: EditorPagePoint;
}>;

type AnchorRecord = Readonly<{
  anchor: CompletedPathAnchor;
  viewportPoint: ViewportPoint;
}>;

type ActiveAnchor = Readonly<{
  start: CapturedSample;
  current: CapturedSample;
  dragging: boolean;
}>;

function error(code: string, path: string): BringsError {
  return Object.freeze({ code, path });
}

function freezePoint<T extends Readonly<{ x: number; y: number }>>(point: T): T {
  return Object.freeze({
    x: Object.is(point.x, -0) ? 0 : point.x,
    y: Object.is(point.y, -0) ? 0 : point.y,
  }) as T;
}

function freezeAnchor(anchor: CompletedPathAnchor): CompletedPathAnchor {
  return Object.freeze({
    position: freezePoint(anchor.position),
    incomingControl: freezePoint(anchor.incomingControl),
    outgoingControl: freezePoint(anchor.outgoingControl),
  });
}

function cornerAnchor(point: EditorPagePoint): CompletedPathAnchor {
  return freezeAnchor({
    position: point,
    incomingControl: { x: 0, y: 0 },
    outgoingControl: { x: 0, y: 0 },
  });
}

function draggedAnchor(start: EditorPagePoint, current: EditorPagePoint): CompletedPathAnchor {
  const x = current.x - start.x;
  const y = current.y - start.y;
  return freezeAnchor({
    position: start,
    incomingControl: { x: -x, y: -y },
    outgoingControl: { x, y },
  });
}

function distanceSquared(
  left: Readonly<{ x: number; y: number }>,
  right: Readonly<{ x: number; y: number }>,
): number {
  const x = left.x - right.x;
  const y = left.y - right.y;
  return x * x + y * y;
}

function samePosition(
  left: Readonly<{ x: number; y: number }>,
  right: Readonly<{ x: number; y: number }>,
): boolean {
  return distanceSquared(left, right) <= CLOSE_RADIUS_SQUARED;
}

/** Browser-free multi-click Pen state with one atomic terminal commit. */
export class PenPathSession {
  private phase: PenPathSessionSnapshot['phase'] = 'drawing';
  private terminalEffect: PenPathSessionSnapshot['terminalEffect'] = null;
  private readonly anchors: AnchorRecord[] = [];
  private active: ActiveAnchor | null;
  private hover: CapturedSample | null = null;
  private stateVersion = 0;

  private constructor(first: CapturedSample) {
    this.active = Object.freeze({ start: first, current: first, dragging: false });
  }

  public static begin(sample: PenPointerSample): Result<PenPathSession> {
    const captured = PenPathSession.captureInitialSample(sample);
    return captured.ok ? { ok: true, value: new PenPathSession(captured.value) } : captured;
  }

  public snapshot(): PenPathSessionSnapshot {
    const visual = this.visual();
    return Object.freeze({
      phase: this.phase,
      terminalEffect: this.terminalEffect,
      pointerId: this.active?.start.pointerId ?? null,
      network: visual.network,
      previewAnchor: visual.previewAnchor,
      closeCandidate: visual.closeCandidate,
    });
  }

  public beginAnchor(sample: PenPointerSample): PenPathEffect {
    if (this.phase === 'terminal' || this.active !== null) return IGNORE_EFFECT;
    const version = this.stateVersion;
    const captured = this.captureSample(sample);
    if (!captured.ok) return this.failUnlessChanged(version, captured.error);
    if (this.stateVersion !== version || this.isTerminal() || this.active !== null) {
      return IGNORE_EFFECT;
    }
    this.active = Object.freeze({
      start: captured.value,
      current: captured.value,
      dragging: false,
    });
    this.hover = null;
    this.stateVersion += 1;
    return this.preview();
  }

  public update(sample: PenPointerSample): PenPathEffect {
    if (this.phase === 'terminal') return IGNORE_EFFECT;
    const version = this.stateVersion;
    const pointerId = this.capturePointerId(sample);
    if (!pointerId.ok) return this.failUnlessChanged(version, pointerId.error);
    if (this.stateVersion !== version || this.isTerminal()) return IGNORE_EFFECT;
    if (this.active !== null && pointerId.value !== this.active.start.pointerId) {
      return IGNORE_EFFECT;
    }
    const captured = this.captureSampleRest(sample, pointerId.value);
    if (!captured.ok) return this.failUnlessChanged(version, captured.error);
    if (this.stateVersion !== version || this.isTerminal()) return IGNORE_EFFECT;
    if (this.active === null) {
      this.hover = captured.value;
    } else {
      const dragging =
        this.active.dragging ||
        distanceSquared(this.active.start.viewportPoint, captured.value.viewportPoint) +
          DRAG_THRESHOLD_EPSILON >=
          DRAG_THRESHOLD_SQUARED;
      this.active = Object.freeze({
        start: this.active.start,
        current: captured.value,
        dragging,
      });
    }
    this.stateVersion += 1;
    return this.preview();
  }

  public finishAnchor(
    sample: PenPointerSample,
    options: Readonly<{ doubleClick?: boolean }> = {},
  ): PenPathEffect {
    if (this.phase === 'terminal' || this.active === null) return IGNORE_EFFECT;
    const version = this.stateVersion;
    const pointerId = this.capturePointerId(sample);
    if (!pointerId.ok) return this.failUnlessChanged(version, pointerId.error);
    if (this.stateVersion !== version || this.isTerminal() || this.active === null) {
      return IGNORE_EFFECT;
    }
    if (pointerId.value !== this.active.start.pointerId) return IGNORE_EFFECT;
    const captured = this.captureSampleRest(sample, pointerId.value);
    if (!captured.ok) return this.failUnlessChanged(version, captured.error);
    if (this.stateVersion !== version || this.isTerminal() || this.active === null) {
      return IGNORE_EFFECT;
    }

    const active = this.active;
    const dragging =
      active.dragging ||
      distanceSquared(active.start.viewportPoint, captured.value.viewportPoint) +
        DRAG_THRESHOLD_EPSILON >=
        DRAG_THRESHOLD_SQUARED;
    const first = this.anchors[0];
    if (
      !dragging &&
      this.anchors.length >= 3 &&
      first !== undefined &&
      samePosition(captured.value.viewportPoint, first.viewportPoint)
    ) {
      return this.commit(true);
    }

    const last = this.anchors.at(-1);
    if (
      options.doubleClick === true &&
      this.anchors.length >= 2 &&
      last !== undefined &&
      samePosition(active.start.viewportPoint, last.viewportPoint)
    ) {
      return this.commit(false);
    }

    const anchor = dragging
      ? draggedAnchor(active.start.pagePoint, captured.value.pagePoint)
      : cornerAnchor(active.start.pagePoint);
    this.anchors.push(
      Object.freeze({ anchor, viewportPoint: freezePoint(active.start.viewportPoint) }),
    );
    this.active = null;
    this.hover = null;
    this.stateVersion += 1;
    return options.doubleClick === true && this.anchors.length >= 2
      ? this.commit(false)
      : this.preview();
  }

  public commitOpen(): PenPathEffect {
    return this.phase === 'drawing' && this.anchors.length >= 2
      ? this.commit(false)
      : IGNORE_EFFECT;
  }

  public cancel(input: PenPathCancel): PenPathEffect {
    if (this.phase === 'terminal') return IGNORE_EFFECT;
    if (
      input.kind === 'pointercancel' &&
      (this.active === null || input.pointerId !== this.active.start.pointerId)
    ) {
      return IGNORE_EFFECT;
    }
    this.phase = 'terminal';
    this.terminalEffect = 'discard';
    this.active = null;
    this.hover = null;
    this.stateVersion += 1;
    return Object.freeze({ kind: 'discard', reason: input.kind });
  }

  /** Terminate a draft when its external coordinate route fails. */
  public fail(cause: BringsError): PenPathEffect {
    return this.failUnlessChanged(this.stateVersion, error(cause.code, cause.path));
  }

  private static captureInitialSample(sample: PenPointerSample): Result<CapturedSample> {
    let pointerId: number;
    try {
      pointerId = sample.pointerId;
    } catch {
      return { ok: false, error: error('interaction.pointer-invalid', '/pointerId') };
    }
    if (!Number.isInteger(pointerId) || pointerId < 0) {
      return { ok: false, error: error('interaction.pointer-invalid', '/pointerId') };
    }
    return PenPathSession.captureSampleCoordinates(sample, pointerId);
  }

  private static captureSampleCoordinates(
    sample: PenPointerSample,
    pointerId: number,
  ): Result<CapturedSample> {
    let viewport: ViewportPoint;
    let page: EditorPagePoint;
    let viewportX: number;
    let viewportY: number;
    let pageX: number;
    let pageY: number;
    try {
      viewport = sample.viewportPoint;
      viewportX = viewport.x;
      viewportY = viewport.y;
    } catch {
      return { ok: false, error: error('interaction.coordinate-invalid', '/viewportPoint') };
    }
    if (![viewportX, viewportY].every(Number.isFinite)) {
      return { ok: false, error: error('interaction.coordinate-invalid', '/viewportPoint') };
    }
    try {
      page = sample.pagePoint;
      pageX = page.x;
      pageY = page.y;
    } catch {
      return { ok: false, error: error('interaction.coordinate-invalid', '/pagePoint') };
    }
    if (![pageX, pageY].every(Number.isFinite)) {
      return { ok: false, error: error('interaction.coordinate-invalid', '/pagePoint') };
    }
    return {
      ok: true,
      value: Object.freeze({
        pointerId,
        viewportPoint: freezePoint({ x: viewportX, y: viewportY }) as ViewportPoint,
        pagePoint: freezePoint({ x: pageX, y: pageY }) as EditorPagePoint,
      }),
    };
  }

  private capturePointerId(sample: PenPointerSample): Result<number> {
    let pointerId: number;
    try {
      pointerId = sample.pointerId;
    } catch {
      return { ok: false, error: error('interaction.pointer-invalid', '/pointerId') };
    }
    return Number.isInteger(pointerId) && pointerId >= 0
      ? { ok: true, value: pointerId }
      : { ok: false, error: error('interaction.pointer-invalid', '/pointerId') };
  }

  private captureSample(sample: PenPointerSample): Result<CapturedSample> {
    const pointerId = this.capturePointerId(sample);
    return pointerId.ok ? this.captureSampleRest(sample, pointerId.value) : pointerId;
  }

  private captureSampleRest(sample: PenPointerSample, pointerId: number): Result<CapturedSample> {
    return PenPathSession.captureSampleCoordinates(sample, pointerId);
  }

  private activeAnchor(): CompletedPathAnchor | null {
    if (this.active === null) return null;
    return this.active.dragging
      ? draggedAnchor(this.active.start.pagePoint, this.active.current.pagePoint)
      : cornerAnchor(this.active.start.pagePoint);
  }

  private closeCandidate(): boolean {
    const first = this.anchors[0];
    if (first === undefined || this.anchors.length < 3 || this.active?.dragging === true) {
      return false;
    }
    const candidate = this.active?.current.viewportPoint ?? this.hover?.viewportPoint;
    return candidate !== undefined && samePosition(candidate, first.viewportPoint);
  }

  private networkSnapshot(): readonly CompletedPathAnchor[] {
    return Object.freeze(this.anchors.map((record) => freezeAnchor(record.anchor)));
  }

  private visual(): PenPathVisual {
    return Object.freeze({
      network: this.networkSnapshot(),
      previewAnchor:
        this.activeAnchor() ??
        (this.hover === null ? null : cornerAnchor(this.hover.pagePoint as EditorPagePoint)),
      closeCandidate: this.closeCandidate(),
    });
  }

  private preview(): PenPathEffect {
    return Object.freeze({ kind: 'preview', visual: this.visual() });
  }

  private commit(closed: boolean): PenPathEffect {
    const network = this.networkSnapshot();
    this.phase = 'terminal';
    this.terminalEffect = 'commit';
    this.active = null;
    this.hover = null;
    this.stateVersion += 1;
    return Object.freeze({ kind: 'commit', network, closed });
  }

  private failUnlessChanged(version: number, cause: BringsError): PenPathEffect {
    if (this.stateVersion !== version || this.phase === 'terminal') return IGNORE_EFFECT;
    this.phase = 'terminal';
    this.terminalEffect = 'discard';
    this.active = null;
    this.hover = null;
    this.stateVersion += 1;
    return Object.freeze({ kind: 'discard', reason: 'error', error: cause });
  }

  private isTerminal(): boolean {
    return this.phase === 'terminal';
  }
}

export type { CompletedPathInput };
