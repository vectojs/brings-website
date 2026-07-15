import type {
  AlignmentGuide,
  BringsError,
  NodeId,
  PageRect,
  Result,
  SelectionResizeProposal,
  StructuralSelection,
} from '@vectojs/brings-core';
import {
  pageDeltaBetween,
  pageRectBetween,
  type EditorPagePoint,
  type EditorPageRect,
  type PageDelta,
  type ViewportPoint,
} from '../editor/selectionCoordinates';
import type {
  SelectionInteractionStart,
  SelectionInteractionToken,
  SelectionProposal,
  SelectionProposalProvider,
  MoveInteractionProposal,
  ResizeInteractionProposal,
} from '../editor/selectionInteraction';

const GESTURE_THRESHOLD_SQUARED = 4 * 4;
// CDP/browser scaling can turn an exact logical 4px delta into 3.99997px.
// Keep the interaction threshold logical without making that raster rounding a click.
const GESTURE_THRESHOLD_EPSILON = 1e-3;
const INTERRUPTED = Symbol('marquee-session-interrupted');
const IGNORE_EFFECT = Object.freeze({ kind: 'ignore' } as const);

type SelectionGesturePhase = 'pending' | 'marquee' | 'moving' | 'terminal';
type SelectionGestureTerminalEffect = 'commit-selection' | 'commit-move' | 'discard';

type SnapshotGuard = () => boolean;

type ResultFailure = Readonly<{ ok: false; error: BringsError }>;
type ResultSuccess<T> = Readonly<{ ok: true; value: T }>;

type PointerProposal = Readonly<{
  proposal: SelectionProposal;
  ownerId: NodeId | null;
}>;

type ProviderOutcome<T> =
  Readonly<{ kind: 'interrupted' }> | Readonly<{ kind: 'result'; result: Result<T> }>;

type AdvanceOutcome =
  | Readonly<{ kind: 'below-threshold' }>
  | Readonly<{ kind: 'interrupted' }>
  | Readonly<{ kind: 'effect'; effect: SelectionGestureEffect }>;

/** One browser-free pointer observation converted by the VectoJS view. */
export type SelectionPointerSample = Readonly<{
  pointerId: number;
  viewportPoint: ViewportPoint;
  pagePoint: EditorPagePoint;
  shiftKey: boolean;
}>;

type DiagnosticPoint = Readonly<{ x: number; y: number }>;
type DiagnosticPosition = Readonly<{
  viewport: DiagnosticPoint;
  page: DiagnosticPoint;
}>;

/** Fresh JSON-safe state for read-only interaction diagnostics. */
export type SelectionGestureSessionSnapshot = Readonly<{
  phase: SelectionGesturePhase;
  terminalEffect: SelectionGestureTerminalEffect | null;
  pointerId: number;
  shiftKey: boolean;
  start: DiagnosticPosition;
  current: DiagnosticPosition;
}>;

/** Transient canvas-native state produced without mutating Brings Core. */
export type SelectionGestureVisual = Readonly<{
  selection: StructuralSelection;
  guides?: readonly AlignmentGuide[];
}> &
  (
    | Readonly<{
        marquee: PageRect | null;
        movementDelta: null;
        resize?: never;
      }>
    | Readonly<{
        marquee: null;
        movementDelta: PageDelta;
        resize?: never;
      }>
    | Readonly<{
        marquee: null;
        movementDelta: null;
        resize: SelectionResizeProposal;
      }>
  );

/** One declarative instruction interpreted by the VectoJS view. */
export type SelectionGestureEffect =
  | Readonly<{ kind: 'preview'; visual: SelectionGestureVisual }>
  | Readonly<{ kind: 'commit-selection'; proposal: SelectionProposal }>
  | Readonly<{
      kind: 'commit-move';
      proposal: SelectionProposal;
      delta: PageDelta;
      alignment?: MoveInteractionProposal;
      guides?: readonly AlignmentGuide[];
    }>
  | Readonly<{ kind: 'commit-resize'; proposal: ResizeInteractionProposal }>
  | Readonly<{
      kind: 'discard';
      reason: 'pointercancel' | 'escape' | 'stale' | 'error' | 'no-change';
      error?: BringsError;
    }>
  | Readonly<{ kind: 'ignore' }>;

/** An out-of-band terminal routed by the VectoJS view. */
export type SelectionGestureCancel =
  | Readonly<{ kind: 'pointercancel'; pointerId: number }>
  | Readonly<{ kind: 'escape' }>
  | Readonly<{ kind: 'error'; error: BringsError }>;

function guardedRead<T>(read: () => T, guard?: SnapshotGuard): T {
  const value = read();
  if (guard !== undefined && !guard()) throw INTERRUPTED;
  return value;
}

function frozenSuccess<T>(value: T): Result<T> {
  return Object.freeze({ ok: true, value });
}

function frozenFailure(error: BringsError): Result<never> {
  return Object.freeze({ ok: false, error });
}

function snapshotError(error: BringsError, guard?: SnapshotGuard): BringsError {
  const code = guardedRead(() => error.code, guard);
  const path = guardedRead(() => error.path, guard);
  return Object.freeze({ code, path });
}

function providerThrew(path: '/provider/point' | '/provider/area'): BringsError {
  return Object.freeze({ code: 'interaction.provider-threw', path });
}

function coordinateFailure(): BringsError {
  return Object.freeze({
    code: 'interaction.coordinate-invalid',
    path: '/viewport/distance',
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
  const sourceIds = guardedRead(() => selection.nodeIds, guard);
  const activeNodeId = guardedRead(() => selection.activeNodeId, guard);
  return Object.freeze({
    nodeIds: snapshotNodeIds(sourceIds, guard),
    activeNodeId,
  });
}

function snapshotToken(
  token: SelectionInteractionToken,
  guard?: SnapshotGuard,
): SelectionInteractionToken {
  const documentRevision = guardedRead(() => token.documentRevision, guard);
  const selectionGeneration = guardedRead(() => token.selectionGeneration, guard);
  return Object.freeze({ documentRevision, selectionGeneration });
}

function snapshotStart(
  start: SelectionInteractionStart,
  guard?: SnapshotGuard,
): SelectionInteractionStart {
  const token = guardedRead(() => start.token, guard);
  const selection = guardedRead(() => start.selection, guard);
  return Object.freeze({
    token: snapshotToken(token, guard),
    selection: snapshotSelection(selection, guard),
  });
}

function snapshotProposal(proposal: SelectionProposal, guard?: SnapshotGuard): SelectionProposal {
  const token = guardedRead(() => proposal.token, guard);
  const originalSelection = guardedRead(() => proposal.originalSelection, guard);
  const selection = guardedRead(() => proposal.selection, guard);
  return Object.freeze({
    token: snapshotToken(token, guard),
    originalSelection: snapshotSelection(originalSelection, guard),
    selection: snapshotSelection(selection, guard),
  });
}

function snapshotViewportPoint(point: ViewportPoint, guard?: SnapshotGuard): ViewportPoint {
  const x = guardedRead(() => point.x, guard);
  const y = guardedRead(() => point.y, guard);
  return Object.freeze({ x, y }) as ViewportPoint;
}

function snapshotPagePoint(point: EditorPagePoint, guard?: SnapshotGuard): EditorPagePoint {
  const x = guardedRead(() => point.x, guard);
  const y = guardedRead(() => point.y, guard);
  return Object.freeze({ x, y }) as EditorPagePoint;
}

function snapshotPageRect(rect: EditorPageRect): EditorPageRect {
  const x = rect.x;
  const y = rect.y;
  const width = rect.width;
  const height = rect.height;
  return Object.freeze({ x, y, width, height }) as EditorPageRect;
}

function snapshotPageDelta(delta: PageDelta): PageDelta {
  const x = delta.x;
  const y = delta.y;
  return Object.freeze({ x, y }) as PageDelta;
}

function snapshotGuides(
  guides: readonly AlignmentGuide[],
  guard?: SnapshotGuard,
): readonly AlignmentGuide[] {
  const detached: AlignmentGuide[] = [];
  const length = guardedRead(() => guides.length, guard);
  for (let index = 0; index < length; index += 1) {
    const guide = guardedRead(() => guides[index]!, guard);
    detached.push(
      Object.freeze({
        axis: guardedRead(() => guide.axis, guard),
        sourceAnchor: guardedRead(() => guide.sourceAnchor, guard),
        targetAnchor: guardedRead(() => guide.targetAnchor, guard),
        targetNodeId: guardedRead(() => guide.targetNodeId, guard),
        coordinate: guardedRead(() => guide.coordinate, guard),
        minExtent: guardedRead(() => guide.minExtent, guard),
        maxExtent: guardedRead(() => guide.maxExtent, guard),
      }),
    );
  }
  return Object.freeze(detached);
}

function snapshotMoveProposal(
  proposal: MoveInteractionProposal,
  guard?: SnapshotGuard,
): MoveInteractionProposal {
  return Object.freeze({
    token: snapshotToken(
      guardedRead(() => proposal.token, guard),
      guard,
    ),
    selection: snapshotSelection(
      guardedRead(() => proposal.selection, guard),
      guard,
    ),
    rawDelta: snapshotPageDelta(guardedRead(() => proposal.rawDelta, guard)),
    delta: snapshotPageDelta(guardedRead(() => proposal.delta, guard)),
    guides: snapshotGuides(
      guardedRead(() => proposal.guides, guard),
      guard,
    ),
  });
}

function snapshotSample(sample: SelectionPointerSample): SelectionPointerSample {
  const pointerId = sample.pointerId;
  const shiftKey = sample.shiftKey;
  const viewportPoint = snapshotViewportPoint(sample.viewportPoint);
  const pagePoint = snapshotPagePoint(sample.pagePoint);
  return Object.freeze({ pointerId, viewportPoint, pagePoint, shiftKey });
}

function diagnosticPoint(point: Readonly<{ x: number; y: number }>): DiagnosticPoint {
  return Object.freeze({ x: point.x, y: point.y });
}

function diagnosticPosition(viewport: ViewportPoint, page: EditorPagePoint): DiagnosticPosition {
  return Object.freeze({
    viewport: diagnosticPoint(viewport),
    page: diagnosticPoint(page),
  });
}

function snapshotPointResult(
  result: Result<PointerProposal>,
  guard?: SnapshotGuard,
): Result<PointerProposal> {
  const ok = guardedRead(() => result.ok, guard);
  if (!ok) {
    const failure = result as ResultFailure;
    const error = guardedRead(() => failure.error, guard);
    return frozenFailure(snapshotError(error, guard));
  }
  const success = result as ResultSuccess<PointerProposal>;
  const value = guardedRead(() => success.value, guard);
  const ownerId = guardedRead(() => value.ownerId, guard);
  const proposal = guardedRead(() => value.proposal, guard);
  return frozenSuccess(Object.freeze({ ownerId, proposal: snapshotProposal(proposal, guard) }));
}

function snapshotAreaResult(
  result: Result<SelectionProposal>,
  guard?: SnapshotGuard,
): Result<SelectionProposal> {
  const ok = guardedRead(() => result.ok, guard);
  if (!ok) {
    const failure = result as ResultFailure;
    const error = guardedRead(() => failure.error, guard);
    return frozenFailure(snapshotError(error, guard));
  }
  const success = result as ResultSuccess<SelectionProposal>;
  const proposal = guardedRead(() => success.value, guard);
  return frozenSuccess(snapshotProposal(proposal, guard));
}

function freezePreview(visual: SelectionGestureVisual): SelectionGestureEffect {
  return Object.freeze({ kind: 'preview', visual });
}

function freezeCommitSelection(proposal: SelectionProposal): SelectionGestureEffect {
  return Object.freeze({ kind: 'commit-selection', proposal });
}

function freezeCommitMove(
  proposal: SelectionProposal,
  delta: PageDelta,
  alignment?: MoveInteractionProposal,
): SelectionGestureEffect {
  return alignment === undefined
    ? Object.freeze({ kind: 'commit-move', proposal, delta })
    : Object.freeze({
        kind: 'commit-move',
        proposal,
        delta,
        alignment,
        guides: alignment.guides,
      });
}

/**
 * Owns one pure selection gesture. Public calls are transactional so nested
 * provider or accessor calls cannot overwrite a newer preview or terminal.
 */
export class MarqueeSelectionSession {
  private phase: SelectionGesturePhase = 'pending';
  private stateVersion = 0;
  private currentProposal: SelectionProposal;
  private moveProposal: SelectionProposal | null = null;
  private latestMoveAlignment: MoveInteractionProposal | undefined;
  private latestVisual: SelectionGestureVisual | null = null;
  private currentSample: SelectionPointerSample;
  private terminalEffect: SelectionGestureTerminalEffect | null = null;

  private constructor(
    private readonly ownerPointerId: number,
    private readonly startViewportPoint: ViewportPoint,
    private readonly startPagePoint: EditorPagePoint,
    private readonly frozenObjectShift: boolean,
    private readonly interactionStart: SelectionInteractionStart,
    private readonly ownerId: NodeId | null,
    beginProposal: SelectionProposal,
    beginSample: SelectionPointerSample,
  ) {
    this.currentProposal = beginProposal;
    this.currentSample = beginSample;
  }

  /** Resolve and detach the click proposal before exposing a live session. */
  public static begin(
    start: SelectionInteractionStart,
    sample: SelectionPointerSample,
    provider: SelectionProposalProvider,
  ): Result<MarqueeSelectionSession> {
    const capturedStart = snapshotStart(start);
    const capturedSample = snapshotSample(sample);
    let point: Result<PointerProposal>;
    try {
      const callPoint = provider.point;
      point = snapshotPointResult(
        callPoint.call(
          provider,
          capturedStart,
          capturedSample.pagePoint,
          capturedSample.shiftKey ? 'toggle' : 'replace',
        ),
      );
    } catch {
      return frozenFailure(providerThrew('/provider/point'));
    }
    if (!point.ok) return point;
    return frozenSuccess(
      new MarqueeSelectionSession(
        capturedSample.pointerId,
        capturedSample.viewportPoint,
        capturedSample.pagePoint,
        capturedSample.shiftKey,
        capturedStart,
        point.value.ownerId,
        point.value.proposal,
        capturedSample,
      ),
    );
  }

  /** Return a newly detached immutable diagnostic view of the accepted owner stream. */
  public snapshot(): SelectionGestureSessionSnapshot {
    return Object.freeze({
      phase: this.phase,
      terminalEffect: this.terminalEffect,
      pointerId: this.ownerPointerId,
      shiftKey: this.currentSample.shiftKey,
      start: diagnosticPosition(this.startViewportPoint, this.startPagePoint),
      current: diagnosticPosition(this.currentSample.viewportPoint, this.currentSample.pagePoint),
    });
  }

  /** Advance the owner gesture and return only its latest transient effect. */
  public update(
    sample: SelectionPointerSample,
    provider: SelectionProposalProvider,
  ): SelectionGestureEffect {
    if (this.phase === 'terminal') return IGNORE_EFFECT;
    const version = this.stateVersion;
    const captured = this.captureOwnerSample(sample, version);
    if (captured === null) return IGNORE_EFFECT;
    this.currentSample = captured;
    const outcome = this.advance(captured, provider, version);
    return outcome.kind === 'effect' ? outcome.effect : IGNORE_EFFECT;
  }

  /** Perform one final calculation and emit exactly one terminal commit or discard. */
  public finish(
    sample: SelectionPointerSample,
    provider: SelectionProposalProvider,
  ): SelectionGestureEffect {
    if (this.phase === 'terminal') return IGNORE_EFFECT;
    const version = this.stateVersion;
    if (this.phase !== 'moving') {
      const captured = this.captureOwnerSample(sample, version);
      if (captured === null) return IGNORE_EFFECT;
      this.currentSample = captured;
      const outcome = this.advance(captured, provider, version);
      if (outcome.kind === 'interrupted') return IGNORE_EFFECT;
      if (outcome.kind === 'effect' && outcome.effect.kind === 'discard') {
        return outcome.effect;
      }
      this.markTerminal('commit-selection');
      return freezeCommitSelection(this.currentProposal);
    }
    if (!this.ownsPointer(sample, version)) return IGNORE_EFFECT;
    const delta = this.latestVisual?.movementDelta;
    if (delta === null || delta === undefined) {
      return this.discard(
        Object.freeze({ code: 'interaction.coordinate-invalid', path: '/delta' }),
      );
    }
    const deltaX = delta.x;
    const deltaY = delta.y;
    if (deltaX === 0 && deltaY === 0) {
      this.markTerminal('commit-selection');
      return freezeCommitSelection(this.currentProposal);
    }
    this.markTerminal('commit-move');
    return freezeCommitMove(this.currentProposal, delta, this.latestMoveAlignment);
  }

  /** End the owner session without writing captured state back into Core. */
  public cancel(input: SelectionGestureCancel): SelectionGestureEffect {
    if (this.phase === 'terminal') return IGNORE_EFFECT;
    const version = this.stateVersion;
    try {
      const kind = guardedRead(
        () => input.kind,
        () => this.isCurrent(version),
      );
      if (kind === 'pointercancel') {
        const pointerCancel = input as Extract<SelectionGestureCancel, { kind: 'pointercancel' }>;
        const pointerId = guardedRead(
          () => pointerCancel.pointerId,
          () => this.isCurrent(version),
        );
        if (pointerId !== this.ownerPointerId) return IGNORE_EFFECT;
        this.markTerminal('discard');
        return Object.freeze({ kind: 'discard', reason: 'pointercancel' });
      }
      if (kind === 'error') {
        const errorInput = input as Extract<SelectionGestureCancel, { kind: 'error' }>;
        const error = guardedRead(
          () => errorInput.error,
          () => this.isCurrent(version),
        );
        const detachedError = snapshotError(error, () => this.isCurrent(version));
        this.markTerminal('discard');
        return Object.freeze({ kind: 'discard', reason: 'error', error: detachedError });
      }
      this.markTerminal('discard');
      return Object.freeze({ kind: 'discard', reason: 'escape' });
    } catch (error) {
      if (error === INTERRUPTED) return IGNORE_EFFECT;
      throw error;
    }
  }

  private captureOwnerSample(
    sample: SelectionPointerSample,
    version: number,
  ): SelectionPointerSample | null {
    const current = () => this.isCurrent(version);
    try {
      const pointerId = guardedRead(() => sample.pointerId, current);
      if (pointerId !== this.ownerPointerId) return null;
      const shiftKey = guardedRead(() => sample.shiftKey, current);
      const viewportSource = guardedRead(() => sample.viewportPoint, current);
      const viewportPoint = snapshotViewportPoint(viewportSource, current);
      const pageSource = guardedRead(() => sample.pagePoint, current);
      const pagePoint = snapshotPagePoint(pageSource, current);
      return Object.freeze({ pointerId, viewportPoint, pagePoint, shiftKey });
    } catch (error) {
      if (error === INTERRUPTED) return null;
      throw error;
    }
  }

  private ownsPointer(sample: SelectionPointerSample, version: number): boolean {
    try {
      return (
        guardedRead(
          () => sample.pointerId,
          () => this.isCurrent(version),
        ) === this.ownerPointerId
      );
    } catch (error) {
      if (error === INTERRUPTED) return false;
      throw error;
    }
  }

  private advance(
    sample: SelectionPointerSample,
    provider: SelectionProposalProvider,
    version: number,
  ): AdvanceOutcome {
    const distanceSquared = this.distanceSquared(sample.viewportPoint);
    if (!distanceSquared.ok) return { kind: 'effect', effect: this.discard(distanceSquared.error) };
    if (
      this.phase === 'pending' &&
      distanceSquared.value < GESTURE_THRESHOLD_SQUARED - GESTURE_THRESHOLD_EPSILON
    ) {
      return { kind: 'below-threshold' };
    }
    return this.ownerId === null
      ? this.advanceMarquee(sample, provider, version)
      : this.advanceMove(sample.pagePoint, provider, version);
  }

  private advanceMarquee(
    sample: SelectionPointerSample,
    provider: SelectionProposalProvider,
    version: number,
  ): AdvanceOutcome {
    const rect = pageRectBetween(this.startPagePoint, sample.pagePoint);
    if (!rect.ok) return { kind: 'effect', effect: this.discard(rect.error) };
    const detachedRect = snapshotPageRect(rect.value);
    const called = this.callAreaProvider(
      provider,
      detachedRect,
      sample.shiftKey ? 'add' : 'replace',
      version,
    );
    if (called.kind === 'interrupted') return called;
    if (!called.result.ok) {
      return { kind: 'effect', effect: this.discard(called.result.error) };
    }

    const proposal = called.result.value;
    const visual = Object.freeze({
      selection: proposal.selection,
      marquee: detachedRect,
      movementDelta: null,
    });
    this.phase = 'marquee';
    this.currentProposal = proposal;
    this.latestMoveAlignment = undefined;
    this.latestVisual = visual;
    this.stateVersion += 1;
    return { kind: 'effect', effect: freezePreview(visual) };
  }

  private advanceMove(
    currentPagePoint: EditorPagePoint,
    provider: SelectionProposalProvider,
    version: number,
  ): AdvanceOutcome {
    let proposal = this.moveProposal;
    if (proposal === null) {
      const ownerWasSelected = this.interactionStart.selection.nodeIds.includes(this.ownerId!);
      const called = this.callPointProvider(
        provider,
        this.startPagePoint,
        this.frozenObjectShift || ownerWasSelected ? 'add-for-drag' : 'replace',
        version,
      );
      if (called.kind === 'interrupted') return called;
      if (!called.result.ok) {
        return { kind: 'effect', effect: this.discard(called.result.error) };
      }
      proposal = called.result.value.proposal;
    }

    const delta = pageDeltaBetween(this.startPagePoint, currentPagePoint);
    if (!delta.ok) return { kind: 'effect', effect: this.discard(delta.error) };
    const detachedDelta = snapshotPageDelta(delta.value);
    let move: MoveInteractionProposal | undefined;
    if (provider.move !== undefined) {
      const aligned = this.callMoveProvider(provider, proposal, detachedDelta, version);
      if (aligned.kind === 'interrupted') return aligned;
      if (!aligned.result.ok) {
        return { kind: 'effect', effect: this.discard(aligned.result.error) };
      }
      move = aligned.result.value;
    }
    const visual = Object.freeze({
      selection: proposal.selection,
      marquee: null,
      movementDelta: move?.delta ?? detachedDelta,
      ...(move === undefined || move.guides.length === 0 ? {} : { guides: move.guides }),
    });
    this.phase = 'moving';
    this.moveProposal = proposal;
    this.currentProposal = proposal;
    this.latestMoveAlignment = move;
    this.latestVisual = visual;
    this.stateVersion += 1;
    return { kind: 'effect', effect: freezePreview(visual) };
  }

  private callMoveProvider(
    provider: SelectionProposalProvider,
    proposal: SelectionProposal,
    delta: PageDelta,
    version: number,
  ): ProviderOutcome<MoveInteractionProposal> {
    const current = () => this.isCurrent(version);
    try {
      const callMove = guardedRead(() => provider.move, current);
      if (callMove === undefined) return { kind: 'interrupted' };
      const raw = callMove.call(provider, this.interactionStart, proposal, delta);
      if (!current()) return { kind: 'interrupted' };
      if (!raw.ok)
        return { kind: 'result', result: frozenFailure(snapshotError(raw.error, current)) };
      return { kind: 'result', result: frozenSuccess(snapshotMoveProposal(raw.value, current)) };
    } catch (error) {
      if (error === INTERRUPTED || !current()) return { kind: 'interrupted' };
      return {
        kind: 'result',
        result: frozenFailure(
          Object.freeze({ code: 'interaction.provider-threw', path: '/provider/move' }),
        ),
      };
    }
  }

  private callPointProvider(
    provider: SelectionProposalProvider,
    point: EditorPagePoint,
    mode: 'replace' | 'toggle' | 'add-for-drag',
    version: number,
  ): ProviderOutcome<PointerProposal> {
    const current = () => this.isCurrent(version);
    try {
      const callPoint = guardedRead(() => provider.point, current);
      const rawResult = callPoint.call(provider, this.interactionStart, point, mode);
      if (!current()) return { kind: 'interrupted' };
      return { kind: 'result', result: snapshotPointResult(rawResult, current) };
    } catch (error) {
      if (error === INTERRUPTED || !current()) return { kind: 'interrupted' };
      return { kind: 'result', result: frozenFailure(providerThrew('/provider/point')) };
    }
  }

  private callAreaProvider(
    provider: SelectionProposalProvider,
    rect: EditorPageRect,
    mode: 'replace' | 'add',
    version: number,
  ): ProviderOutcome<SelectionProposal> {
    const current = () => this.isCurrent(version);
    try {
      const callArea = guardedRead(() => provider.area, current);
      const rawResult = callArea.call(provider, this.interactionStart, rect, mode);
      if (!current()) return { kind: 'interrupted' };
      return { kind: 'result', result: snapshotAreaResult(rawResult, current) };
    } catch (error) {
      if (error === INTERRUPTED || !current()) return { kind: 'interrupted' };
      return { kind: 'result', result: frozenFailure(providerThrew('/provider/area')) };
    }
  }

  private distanceSquared(current: ViewportPoint): Result<number> {
    const startX = this.startViewportPoint.x;
    const startY = this.startViewportPoint.y;
    const currentX = current.x;
    const currentY = current.y;
    const deltaX = currentX - startX;
    const deltaY = currentY - startY;
    const squared = deltaX * deltaX + deltaY * deltaY;
    return [startX, startY, currentX, currentY, deltaX, deltaY, squared].every(Number.isFinite)
      ? frozenSuccess(squared)
      : frozenFailure(coordinateFailure());
  }

  private isCurrent(version: number): boolean {
    return this.phase !== 'terminal' && this.stateVersion === version;
  }

  private markTerminal(effect: SelectionGestureTerminalEffect): void {
    this.phase = 'terminal';
    this.terminalEffect = effect;
    this.stateVersion += 1;
  }

  private discard(error: BringsError): SelectionGestureEffect {
    const detachedError = snapshotError(error);
    this.markTerminal('discard');
    return Object.freeze({
      kind: 'discard',
      reason: detachedError.code === 'interaction.stale' ? 'stale' : 'error',
      error: detachedError,
    });
  }
}
