import type {
  BringsError,
  EditorSnapshot,
  Result,
  StructuralSelection,
} from '@vectojs/brings-core';
import type { PageDelta } from '../editor/selectionCoordinates';
import type { SelectionProposal } from '../editor/selectionInteraction';
import type { SelectionGestureEffect, SelectionGestureVisual } from './MarqueeSelectionSession';

export type SelectionGestureInterpreterPorts = Readonly<{
  commitSelection: (proposal: SelectionProposal) => Result<EditorSnapshot>;
  commitMove: (
    input: Readonly<{ proposal: SelectionProposal; delta: PageDelta }>,
  ) => Result<EditorSnapshot>;
  reportInteractionError: (error: BringsError) => void;
  markDirty: () => void;
}>;

function snapshotSelection(selection: StructuralSelection): StructuralSelection {
  return Object.freeze({
    nodeIds: Object.freeze([...selection.nodeIds]),
    activeNodeId: selection.activeNodeId,
  });
}

function snapshotVisual(visual: SelectionGestureVisual): SelectionGestureVisual {
  const marquee = visual.marquee;
  const movementDelta = visual.movementDelta;
  return Object.freeze({
    selection: snapshotSelection(visual.selection),
    marquee:
      marquee === null
        ? null
        : Object.freeze({
            x: marquee.x,
            y: marquee.y,
            width: marquee.width,
            height: marquee.height,
          }),
    movementDelta:
      movementDelta === null
        ? null
        : (Object.freeze({ x: movementDelta.x, y: movementDelta.y }) as PageDelta),
  });
}

function sameSelection(left: StructuralSelection, right: StructuralSelection): boolean {
  return (
    left.activeNodeId === right.activeNodeId &&
    left.nodeIds.length === right.nodeIds.length &&
    left.nodeIds.every((id, index) => id === right.nodeIds[index])
  );
}

function sameRect(
  left: SelectionGestureVisual['marquee'],
  right: SelectionGestureVisual['marquee'],
): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

function sameDelta(
  left: SelectionGestureVisual['movementDelta'],
  right: SelectionGestureVisual['movementDelta'],
): boolean {
  if (left === null || right === null) return left === right;
  return left.x === right.x && left.y === right.y;
}

function sameVisual(left: SelectionGestureVisual, right: SelectionGestureVisual): boolean {
  return (
    sameSelection(left.selection, right.selection) &&
    sameRect(left.marquee, right.marquee) &&
    sameDelta(left.movementDelta, right.movementDelta)
  );
}

/**
 * Applies browser-free gesture effects to Core ports while owning only the
 * detached transient visual consumed by the canvas renderer.
 */
export class SelectionGestureInterpreter {
  private currentVisual: SelectionGestureVisual | null = null;
  private stateVersion = 0;

  public constructor(private readonly ports: SelectionGestureInterpreterPorts) {}

  /** The immutable canvas-only preview currently owned by the view. */
  public get visual(): SelectionGestureVisual | null {
    return this.currentVisual;
  }

  /** Apply one effect and report whether its Core commit changed a snapshot. */
  public apply(effect: SelectionGestureEffect): boolean {
    if (effect.kind === 'ignore') return false;
    if (effect.kind === 'preview') {
      const version = this.stateVersion;
      const next = snapshotVisual(effect.visual);
      if (this.stateVersion !== version) return false;
      if (this.currentVisual !== null && sameVisual(this.currentVisual, next)) return false;
      this.currentVisual = next;
      this.stateVersion += 1;
      this.ports.markDirty();
      return false;
    }
    if (effect.kind === 'discard') {
      this.clearVisual();
      const error = effect.error;
      if (error !== undefined) this.ports.reportInteractionError(error);
      return false;
    }

    const version = this.stateVersion;
    const hadVisual = this.currentVisual !== null;
    const result =
      effect.kind === 'commit-selection'
        ? this.ports.commitSelection(effect.proposal)
        : this.ports.commitMove({ proposal: effect.proposal, delta: effect.delta });
    const ok = result.ok;
    if (!ok) {
      const error = (result as Readonly<{ ok: false; error: BringsError }>).error;
      if (this.stateVersion === version && hadVisual) this.clearVisual();
      this.ports.reportInteractionError(error);
      return false;
    }
    if (this.stateVersion === version) {
      if (hadVisual) this.currentVisual = null;
      this.stateVersion += 1;
      this.ports.markDirty();
    }
    return true;
  }

  private clearVisual(): void {
    if (this.currentVisual === null) return;
    this.currentVisual = null;
    this.stateVersion += 1;
    this.ports.markDirty();
  }
}
