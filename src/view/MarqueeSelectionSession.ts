import type {
  BringsError,
  NodeId,
  PageRect,
  Result,
  StructuralSelection,
} from '@vectojs/brings-core';
import {
  pageDeltaBetween,
  pageRectBetween,
  type EditorPagePoint,
  type PageDelta,
  type ViewportPoint,
} from '../editor/selectionCoordinates';
import type {
  SelectionInteractionStart,
  SelectionProposal,
  SelectionProposalProvider,
} from '../editor/selectionInteraction';

const GESTURE_THRESHOLD_SQUARED = 4 * 4;

type SelectionGesturePhase = 'pending' | 'marquee' | 'moving' | 'terminal';

/** One browser-free pointer observation converted by the VectoJS view. */
export type SelectionPointerSample = Readonly<{
  pointerId: number;
  viewportPoint: ViewportPoint;
  pagePoint: EditorPagePoint;
  shiftKey: boolean;
}>;

/** Transient canvas-native state produced without mutating Brings Core. */
export type SelectionGestureVisual = Readonly<{
  selection: StructuralSelection;
  marquee: PageRect | null;
  movementDelta: PageDelta | null;
}>;

/** One declarative instruction interpreted by the VectoJS view. */
export type SelectionGestureEffect =
  | Readonly<{ kind: 'preview'; visual: SelectionGestureVisual }>
  | Readonly<{ kind: 'commit-selection'; proposal: SelectionProposal }>
  | Readonly<{
      kind: 'commit-move';
      proposal: SelectionProposal;
      delta: PageDelta;
    }>
  | Readonly<{
      kind: 'discard';
      reason: 'pointercancel' | 'escape' | 'stale' | 'error';
      error?: BringsError;
    }>
  | Readonly<{ kind: 'ignore' }>;

/** An out-of-band terminal routed by the VectoJS view. */
export type SelectionGestureCancel =
  | Readonly<{ kind: 'pointercancel'; pointerId: number }>
  | Readonly<{ kind: 'escape' }>
  | Readonly<{ kind: 'error'; error: BringsError }>;

function success<T>(value: T): Result<T> {
  return { ok: true, value };
}

function coordinateFailure(): BringsError {
  return { code: 'interaction.coordinate-invalid', path: '/viewport/distance' };
}

function copyViewportPoint(point: ViewportPoint): ViewportPoint {
  return Object.freeze({ x: point.x, y: point.y }) as ViewportPoint;
}

function copyPagePoint(point: EditorPagePoint): EditorPagePoint {
  return Object.freeze({ x: point.x, y: point.y }) as EditorPagePoint;
}

/**
 * Owns one pure selection gesture. It emits effects for the view to interpret
 * and never mutates a Scene, browser pointer, or Brings Core store directly.
 */
export class MarqueeSelectionSession {
  private phase: SelectionGesturePhase = 'pending';
  private currentProposal: SelectionProposal;
  private moveProposal: SelectionProposal | null = null;
  private latestVisual: SelectionGestureVisual | null = null;

  private constructor(
    private readonly ownerPointerId: number,
    private readonly startViewportPoint: ViewportPoint,
    private readonly startPagePoint: EditorPagePoint,
    private readonly frozenObjectShift: boolean,
    private readonly interactionStart: SelectionInteractionStart,
    private readonly ownerId: NodeId | null,
    beginProposal: SelectionProposal,
  ) {
    this.currentProposal = beginProposal;
  }

  /** Resolve the click proposal and capture immutable gesture ownership. */
  public static begin(
    start: SelectionInteractionStart,
    sample: SelectionPointerSample,
    provider: SelectionProposalProvider,
  ): Result<MarqueeSelectionSession> {
    const ownerPointerId = sample.pointerId;
    const frozenObjectShift = sample.shiftKey;
    const startViewportPoint = copyViewportPoint(sample.viewportPoint);
    const startPagePoint = copyPagePoint(sample.pagePoint);
    const point = provider.point(start, startPagePoint, frozenObjectShift ? 'toggle' : 'replace');
    if (!point.ok) return point;
    return success(
      new MarqueeSelectionSession(
        ownerPointerId,
        startViewportPoint,
        startPagePoint,
        frozenObjectShift,
        start,
        point.value.ownerId,
        point.value.proposal,
      ),
    );
  }

  /** Advance the owner gesture and return only its latest transient effect. */
  public update(
    sample: SelectionPointerSample,
    provider: SelectionProposalProvider,
  ): SelectionGestureEffect {
    if (this.phase === 'terminal' || sample.pointerId !== this.ownerPointerId) {
      return { kind: 'ignore' };
    }
    return this.advance(sample, provider);
  }

  /** Perform one final calculation and emit exactly one terminal commit or discard. */
  public finish(
    sample: SelectionPointerSample,
    provider: SelectionProposalProvider,
  ): SelectionGestureEffect {
    if (this.phase === 'terminal' || sample.pointerId !== this.ownerPointerId) {
      return { kind: 'ignore' };
    }
    const advanced = this.advance(sample, provider);
    if (advanced.kind === 'discard') return advanced;

    const completedPhase = this.phase;
    this.phase = 'terminal';
    if (completedPhase !== 'moving') {
      return { kind: 'commit-selection', proposal: this.currentProposal };
    }

    const delta = this.latestVisual?.movementDelta;
    if (delta === null || delta === undefined) {
      return this.discardAfterTerminal({
        code: 'interaction.coordinate-invalid',
        path: '/delta',
      });
    }
    const deltaX = delta.x;
    const deltaY = delta.y;
    if (deltaX === 0 && deltaY === 0) {
      return { kind: 'commit-selection', proposal: this.currentProposal };
    }
    return { kind: 'commit-move', proposal: this.currentProposal, delta };
  }

  /** End the owner session without writing captured state back into Core. */
  public cancel(input: SelectionGestureCancel): SelectionGestureEffect {
    if (this.phase === 'terminal') return { kind: 'ignore' };
    if (input.kind === 'pointercancel' && input.pointerId !== this.ownerPointerId) {
      return { kind: 'ignore' };
    }
    this.phase = 'terminal';
    if (input.kind === 'error') {
      return { kind: 'discard', reason: 'error', error: input.error };
    }
    return { kind: 'discard', reason: input.kind };
  }

  private advance(
    sample: SelectionPointerSample,
    provider: SelectionProposalProvider,
  ): SelectionGestureEffect {
    const currentViewportPoint = copyViewportPoint(sample.viewportPoint);
    const distanceSquared = this.distanceSquared(currentViewportPoint);
    if (!distanceSquared.ok) return this.discard(distanceSquared.error);
    if (this.phase === 'pending' && distanceSquared.value < GESTURE_THRESHOLD_SQUARED) {
      return { kind: 'ignore' };
    }

    const currentPagePoint = copyPagePoint(sample.pagePoint);
    if (this.ownerId === null) {
      return this.advanceMarquee(currentPagePoint, sample.shiftKey, provider);
    }
    return this.advanceMove(currentPagePoint, provider);
  }

  private advanceMarquee(
    currentPagePoint: EditorPagePoint,
    shiftKey: boolean,
    provider: SelectionProposalProvider,
  ): SelectionGestureEffect {
    const rect = pageRectBetween(this.startPagePoint, currentPagePoint);
    if (!rect.ok) return this.discard(rect.error);
    const proposal = provider.area(this.interactionStart, rect.value, shiftKey ? 'add' : 'replace');
    if (!proposal.ok) return this.discard(proposal.error);

    this.phase = 'marquee';
    this.currentProposal = proposal.value;
    this.latestVisual = {
      selection: proposal.value.selection,
      marquee: rect.value,
      movementDelta: null,
    };
    return { kind: 'preview', visual: this.latestVisual };
  }

  private advanceMove(
    currentPagePoint: EditorPagePoint,
    provider: SelectionProposalProvider,
  ): SelectionGestureEffect {
    if (this.moveProposal === null) {
      const ownerWasSelected = this.interactionStart.selection.nodeIds.includes(this.ownerId!);
      const proposal = provider.point(
        this.interactionStart,
        this.startPagePoint,
        this.frozenObjectShift || ownerWasSelected ? 'add-for-drag' : 'replace',
      );
      if (!proposal.ok) return this.discard(proposal.error);
      this.moveProposal = proposal.value.proposal;
    }

    const delta = pageDeltaBetween(this.startPagePoint, currentPagePoint);
    if (!delta.ok) return this.discard(delta.error);
    this.phase = 'moving';
    this.currentProposal = this.moveProposal;
    this.latestVisual = {
      selection: this.currentProposal.selection,
      marquee: null,
      movementDelta: delta.value,
    };
    return { kind: 'preview', visual: this.latestVisual };
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
      ? success(squared)
      : { ok: false, error: coordinateFailure() };
  }

  private discard(error: BringsError): SelectionGestureEffect {
    this.phase = 'terminal';
    return {
      kind: 'discard',
      reason: error.code === 'interaction.stale' ? 'stale' : 'error',
      error,
    };
  }

  private discardAfterTerminal(error: BringsError): SelectionGestureEffect {
    return { kind: 'discard', reason: 'error', error };
  }
}
