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
  SelectionResizeProposalInput,
  StructuralSelection,
} from '@vectojs/brings-core';
import type {
  ResizeInteractionProposal,
  ResizeInteractionStart,
  ResizeProposalProvider,
  SelectionInteractionToken,
} from '../editor/selectionInteraction';
import type {
  SelectionGestureCancel,
  SelectionGestureEffect,
  SelectionGestureVisual,
} from './MarqueeSelectionSession';

const INTERRUPTED = Symbol('resize-session-interrupted');
const IGNORE_EFFECT = Object.freeze({ kind: 'ignore' } as const);

type SnapshotGuard = () => boolean;
type ResizeSessionPhase = 'resizing' | 'terminal';
type ResizeTerminalEffect = 'commit-resize' | 'discard';

/** One browser-free resize observation converted by the VectoJS view. */
export type ResizePointerSample = Readonly<{
  pointerId: number;
  pagePoint: ResizePoint;
  shiftKey: boolean;
  altKey: boolean;
}>;

/** Detached JSON-safe state for diagnostics and shell tests. */
export type ResizeSelectionSessionSnapshot = Readonly<{
  phase: ResizeSessionPhase;
  terminalEffect: ResizeTerminalEffect | null;
  pointerId: number;
  handle: ResizeHandle;
  shiftKey: boolean;
  altKey: boolean;
  start: ResizePoint;
  current: ResizePoint;
  anchor: ResizePoint | null;
  bounds: ResizeBounds;
}>;

function guardedRead<T>(read: () => T, guard?: SnapshotGuard): T {
  const value = read();
  if (guard !== undefined && !guard()) throw INTERRUPTED;
  return value;
}

function success<T>(value: T): Result<T> {
  return Object.freeze({ ok: true, value });
}

function failure(error: BringsError): Result<never> {
  return Object.freeze({ ok: false, error });
}

function snapshotError(error: BringsError, guard?: SnapshotGuard): BringsError {
  return Object.freeze({
    code: guardedRead(() => error.code, guard),
    path: guardedRead(() => error.path, guard),
  });
}

function snapshotPoint(point: ResizePoint, guard?: SnapshotGuard): ResizePoint {
  return Object.freeze({
    x: guardedRead(() => point.x, guard),
    y: guardedRead(() => point.y, guard),
  });
}

function snapshotBounds(bounds: ResizeBounds, guard?: SnapshotGuard): ResizeBounds {
  return Object.freeze({
    minX: guardedRead(() => bounds.minX, guard),
    minY: guardedRead(() => bounds.minY, guard),
    maxX: guardedRead(() => bounds.maxX, guard),
    maxY: guardedRead(() => bounds.maxY, guard),
  });
}

function snapshotNodeIds(nodeIds: readonly NodeId[], guard?: SnapshotGuard): readonly NodeId[] {
  const length = guardedRead(() => nodeIds.length, guard);
  const detached: NodeId[] = [];
  for (let index = 0; index < length; index += 1) {
    detached.push(guardedRead(() => nodeIds[index]!, guard));
  }
  return Object.freeze(detached);
}

function snapshotSelection(
  selection: StructuralSelection,
  guard?: SnapshotGuard,
): StructuralSelection {
  const nodeIds = guardedRead(() => selection.nodeIds, guard);
  return Object.freeze({
    nodeIds: snapshotNodeIds(nodeIds, guard),
    activeNodeId: guardedRead(() => selection.activeNodeId, guard),
  });
}

function snapshotToken(
  token: SelectionInteractionToken,
  guard?: SnapshotGuard,
): SelectionInteractionToken {
  return Object.freeze({
    documentRevision: guardedRead(() => token.documentRevision, guard),
    selectionGeneration: guardedRead(() => token.selectionGeneration, guard),
  });
}

function snapshotHandles(
  handles: readonly ResizeHandlePosition[],
  guard?: SnapshotGuard,
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
  guard?: SnapshotGuard,
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

function snapshotSample(sample: ResizePointerSample, guard?: SnapshotGuard): ResizePointerSample {
  return Object.freeze({
    pointerId: guardedRead(() => sample.pointerId, guard),
    pagePoint: snapshotPoint(
      guardedRead(() => sample.pagePoint, guard),
      guard,
    ),
    shiftKey: guardedRead(() => sample.shiftKey, guard),
    altKey: guardedRead(() => sample.altKey, guard),
  });
}

function snapshotOwnedSample(
  sample: ResizePointerSample,
  pointerId: number,
  guard?: SnapshotGuard,
): ResizePointerSample {
  return Object.freeze({
    pointerId,
    pagePoint: snapshotPoint(
      guardedRead(() => sample.pagePoint, guard),
      guard,
    ),
    shiftKey: guardedRead(() => sample.shiftKey, guard),
    altKey: guardedRead(() => sample.altKey, guard),
  });
}

function snapshotMatrix(matrix: Matrix, guard?: SnapshotGuard): Matrix {
  return Object.freeze([
    guardedRead(() => matrix[0], guard),
    guardedRead(() => matrix[1], guard),
    guardedRead(() => matrix[2], guard),
    guardedRead(() => matrix[3], guard),
    guardedRead(() => matrix[4], guard),
    guardedRead(() => matrix[5], guard),
  ]);
}

function snapshotResize(
  resize: SelectionResizeProposal,
  guard?: SnapshotGuard,
): SelectionResizeProposal {
  const command = guardedRead(() => resize.command, guard);
  return Object.freeze({
    handle: guardedRead(() => resize.handle, guard),
    anchor: snapshotPoint(
      guardedRead(() => resize.anchor, guard),
      guard,
    ),
    scaleX: guardedRead(() => resize.scaleX, guard),
    scaleY: guardedRead(() => resize.scaleY, guard),
    bounds: snapshotBounds(
      guardedRead(() => resize.bounds, guard),
      guard,
    ),
    command: Object.freeze({
      kind: guardedRead(() => command.kind, guard),
      nodeIds: snapshotNodeIds(
        guardedRead(() => command.nodeIds, guard),
        guard,
      ),
      delta: snapshotMatrix(
        guardedRead(() => command.delta, guard),
        guard,
      ),
    }),
  });
}

function snapshotInput(
  input: SelectionResizeProposalInput,
  guard?: SnapshotGuard,
): SelectionResizeProposalInput {
  return Object.freeze({
    handle: guardedRead(() => input.handle, guard),
    startPoint: snapshotPoint(
      guardedRead(() => input.startPoint, guard),
      guard,
    ),
    currentPoint: snapshotPoint(
      guardedRead(() => input.currentPoint, guard),
      guard,
    ),
    preserveAspectRatio: guardedRead(() => input.preserveAspectRatio, guard),
    fromCenter: guardedRead(() => input.fromCenter, guard),
  });
}

function snapshotProposal(
  proposal: ResizeInteractionProposal,
  guard?: SnapshotGuard,
): ResizeInteractionProposal {
  return Object.freeze({
    token: snapshotToken(
      guardedRead(() => proposal.token, guard),
      guard,
    ),
    selection: snapshotSelection(
      guardedRead(() => proposal.selection, guard),
      guard,
    ),
    input: snapshotInput(
      guardedRead(() => proposal.input, guard),
      guard,
    ),
    resize: snapshotResize(
      guardedRead(() => proposal.resize, guard),
      guard,
    ),
  });
}

function snapshotProviderResult(
  result: Result<ResizeInteractionProposal>,
  guard: SnapshotGuard,
): Result<ResizeInteractionProposal> {
  if (!guardedRead(() => result.ok, guard)) {
    const source = result as Readonly<{ ok: false; error: BringsError }>;
    return failure(
      snapshotError(
        guardedRead(() => source.error, guard),
        guard,
      ),
    );
  }
  const source = result as Readonly<{ ok: true; value: ResizeInteractionProposal }>;
  return success(
    snapshotProposal(
      guardedRead(() => source.value, guard),
      guard,
    ),
  );
}

function freezePreview(proposal: ResizeInteractionProposal): SelectionGestureEffect {
  const visual: SelectionGestureVisual = Object.freeze({
    selection: proposal.selection,
    marquee: null,
    movementDelta: null,
    resize: proposal.resize,
  });
  return Object.freeze({ kind: 'preview', visual });
}

function isIdentityProposal(proposal: ResizeInteractionProposal): boolean {
  const delta = proposal.resize.command.delta;
  return (
    delta[0] === 1 &&
    delta[1] === 0 &&
    delta[2] === 0 &&
    delta[3] === 1 &&
    delta[4] === 0 &&
    delta[5] === 0
  );
}

/**
 * Owns one resize pointer stream while Core remains the only geometry and
 * command authority. Singular samples retain the previous valid proposal.
 */
export class ResizeSelectionSession {
  private phase: ResizeSessionPhase = 'resizing';
  private terminalEffect: ResizeTerminalEffect | null = null;
  private stateVersion = 0;
  private currentSample: ResizePointerSample;
  private latestProposal: ResizeInteractionProposal | null = null;

  private constructor(
    private readonly start: ResizeInteractionStart,
    private readonly handle: ResizeHandle,
    private readonly ownerPointerId: number,
    private readonly startPoint: ResizePoint,
    initialSample: ResizePointerSample,
  ) {
    this.currentSample = initialSample;
  }

  /** Capture caller state without proposing an identity transform. */
  public static begin(
    start: ResizeInteractionStart,
    handle: ResizeHandle,
    sample: ResizePointerSample,
    _provider: ResizeProposalProvider,
  ): Result<ResizeSelectionSession> {
    try {
      const capturedStart = snapshotStart(start);
      const capturedSample = snapshotSample(sample);
      if (!capturedStart.handles.some((entry) => entry.handle === handle)) {
        return failure(Object.freeze({ code: 'resize.handle', path: '/handle' }));
      }
      return success(
        new ResizeSelectionSession(
          capturedStart,
          handle,
          capturedSample.pointerId,
          capturedSample.pagePoint,
          capturedSample,
        ),
      );
    } catch {
      return failure(Object.freeze({ code: 'interaction.coordinate-invalid', path: '/resize' }));
    }
  }

  /** Return a fresh deeply frozen diagnostic snapshot. */
  public snapshot(): ResizeSelectionSessionSnapshot {
    const resize = this.latestProposal?.resize;
    return Object.freeze({
      phase: this.phase,
      terminalEffect: this.terminalEffect,
      pointerId: this.ownerPointerId,
      handle: this.handle,
      shiftKey: this.currentSample.shiftKey,
      altKey: this.currentSample.altKey,
      start: snapshotPoint(this.startPoint),
      current: snapshotPoint(this.currentSample.pagePoint),
      anchor: resize === undefined ? null : snapshotPoint(resize.anchor),
      bounds: snapshotBounds(resize?.bounds ?? this.start.bounds),
    });
  }

  /** Propose one transient resize for the owner pointer. */
  public update(
    sample: ResizePointerSample,
    provider: ResizeProposalProvider,
  ): SelectionGestureEffect {
    return this.advance(sample, provider, false);
  }

  /** Commit the latest valid non-identity proposal exactly once. */
  public finish(
    sample: ResizePointerSample,
    provider: ResizeProposalProvider,
  ): SelectionGestureEffect {
    return this.advance(sample, provider, true);
  }

  /** Cancel the owner stream without mutating durable Core state. */
  public cancel(input: SelectionGestureCancel): SelectionGestureEffect {
    if (this.phase === 'terminal') return IGNORE_EFFECT;
    const version = this.stateVersion;
    const current = () => this.isCurrent(version);
    try {
      const kind = guardedRead(() => input.kind, current);
      if (kind === 'pointercancel') {
        const pointerId = guardedRead(
          () => (input as Extract<SelectionGestureCancel, { kind: 'pointercancel' }>).pointerId,
          current,
        );
        if (pointerId !== this.ownerPointerId) return IGNORE_EFFECT;
        return this.markDiscard('pointercancel');
      }
      if (kind === 'error') {
        const error = snapshotError(
          guardedRead(
            () => (input as Extract<SelectionGestureCancel, { kind: 'error' }>).error,
            current,
          ),
          current,
        );
        return this.markDiscard('error', error);
      }
      return this.markDiscard('escape');
    } catch (error) {
      if (error === INTERRUPTED) return IGNORE_EFFECT;
      throw error;
    }
  }

  private advance(
    sample: ResizePointerSample,
    provider: ResizeProposalProvider,
    finish: boolean,
  ): SelectionGestureEffect {
    if (this.phase === 'terminal') return IGNORE_EFFECT;
    const version = this.stateVersion;
    const current = () => this.isCurrent(version);
    let pointerId: number;
    try {
      pointerId = guardedRead(() => sample.pointerId, current);
    } catch (error) {
      if (error === INTERRUPTED) return IGNORE_EFFECT;
      return this.markDiscard(
        'error',
        Object.freeze({ code: 'interaction.coordinate-invalid', path: '/resize/pointerId' }),
      );
    }
    if (pointerId !== this.ownerPointerId) return IGNORE_EFFECT;
    let captured: ResizePointerSample;
    try {
      captured = snapshotOwnedSample(sample, pointerId, current);
    } catch (error) {
      if (error === INTERRUPTED) return IGNORE_EFFECT;
      return this.markDiscard(
        'error',
        Object.freeze({ code: 'interaction.coordinate-invalid', path: '/resize/sample' }),
      );
    }
    this.currentSample = captured;

    const moved =
      captured.pagePoint.x !== this.startPoint.x || captured.pagePoint.y !== this.startPoint.y;
    if (!moved && this.latestProposal === null) {
      return finish ? this.markDiscard('no-change') : IGNORE_EFFECT;
    }

    const input = Object.freeze({
      handle: this.handle,
      startPoint: snapshotPoint(this.startPoint),
      currentPoint: snapshotPoint(captured.pagePoint),
      preserveAspectRatio: captured.shiftKey,
      fromCenter: captured.altKey,
    });
    let result: Result<ResizeInteractionProposal>;
    try {
      const resize = guardedRead(() => provider.resize, current);
      const raw = resize.call(provider, this.start, input);
      if (!current()) return IGNORE_EFFECT;
      result = snapshotProviderResult(raw, current);
    } catch (error) {
      if (error === INTERRUPTED || !current()) return IGNORE_EFFECT;
      return this.markDiscard(
        'error',
        Object.freeze({ code: 'interaction.provider-threw', path: '/provider/resize' }),
      );
    }
    if (!result.ok) {
      if (result.error.code === 'matrix.singular') {
        if (!finish) return IGNORE_EFFECT;
        if (this.latestProposal === null) return this.markDiscard('no-change');
        return this.commitLatest();
      }
      return this.markDiscard(
        result.error.code === 'interaction.stale' ? 'stale' : 'error',
        result.error,
      );
    }
    if (!current()) return IGNORE_EFFECT;
    this.latestProposal = result.value;
    this.stateVersion += 1;
    return finish ? this.commitLatest() : freezePreview(result.value);
  }

  private commitLatest(): SelectionGestureEffect {
    const proposal = this.latestProposal;
    if (proposal === null) return this.markDiscard('no-change');
    if (isIdentityProposal(proposal)) return this.markDiscard('no-change');
    this.phase = 'terminal';
    this.terminalEffect = 'commit-resize';
    this.stateVersion += 1;
    return Object.freeze({ kind: 'commit-resize', proposal });
  }

  private markDiscard(
    reason: 'pointercancel' | 'escape' | 'stale' | 'error' | 'no-change',
    error?: BringsError,
  ): SelectionGestureEffect {
    this.phase = 'terminal';
    this.terminalEffect = 'discard';
    this.stateVersion += 1;
    return error === undefined
      ? Object.freeze({ kind: 'discard', reason })
      : Object.freeze({ kind: 'discard', reason, error: snapshotError(error) });
  }

  private isCurrent(version: number): boolean {
    return this.phase !== 'terminal' && this.stateVersion === version;
  }
}
