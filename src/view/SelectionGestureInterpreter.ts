import type {
  BringsError,
  EditorSnapshot,
  Result,
  StructuralSelection,
} from '@vectojs/brings-core';
import type { PageDelta } from '../editor/selectionCoordinates';
import type { SelectionProposal } from '../editor/selectionInteraction';
import type { SelectionGestureEffect, SelectionGestureVisual } from './MarqueeSelectionSession';

const INTERRUPTED = Symbol('selection-interpreter-interrupted');

type SnapshotGuard = () => boolean;

export type SelectionGestureInterpreterPorts = Readonly<{
  commitSelection: (proposal: SelectionProposal) => Result<EditorSnapshot>;
  commitMove: (
    input: Readonly<{ proposal: SelectionProposal; delta: PageDelta }>,
  ) => Result<EditorSnapshot>;
  reportInteractionError: (error: BringsError) => void;
  markDirty: () => void;
}>;

function guardedRead<T>(read: () => T, guard?: SnapshotGuard): T {
  const value = read();
  if (guard !== undefined && !guard()) throw INTERRUPTED;
  return value;
}

function snapshotError(error: BringsError): BringsError {
  const code = error.code;
  const path = error.path;
  return Object.freeze({ code, path });
}

function snapshotSelection(
  selection: StructuralSelection,
  guard?: SnapshotGuard,
): StructuralSelection {
  const nodeIds = guardedRead(() => selection.nodeIds, guard);
  const activeNodeId = guardedRead(() => selection.activeNodeId, guard);
  const length = guardedRead(() => nodeIds.length, guard);
  const detached = [] as (typeof nodeIds)[number][];
  for (let index = 0; index < length; index += 1) {
    detached.push(guardedRead(() => nodeIds[index]!, guard));
  }
  return Object.freeze({
    nodeIds: Object.freeze(detached),
    activeNodeId,
  });
}

function snapshotVisual(
  visual: SelectionGestureVisual,
  guard?: SnapshotGuard,
): SelectionGestureVisual {
  const selection = guardedRead(() => visual.selection, guard);
  const marquee = guardedRead(() => visual.marquee, guard);
  const movementDelta = guardedRead(() => visual.movementDelta, guard);
  return Object.freeze({
    selection: snapshotSelection(selection, guard),
    marquee:
      marquee === null
        ? null
        : Object.freeze({
            x: guardedRead(() => marquee.x, guard),
            y: guardedRead(() => marquee.y, guard),
            width: guardedRead(() => marquee.width, guard),
            height: guardedRead(() => marquee.height, guard),
          }),
    movementDelta:
      movementDelta === null
        ? null
        : (Object.freeze({
            x: guardedRead(() => movementDelta.x, guard),
            y: guardedRead(() => movementDelta.y, guard),
          }) as PageDelta),
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
    const version = this.stateVersion;
    const current = () => this.stateVersion === version;
    try {
      const kind = guardedRead(() => effect.kind, current);
      if (kind === 'ignore') return false;
      if (kind === 'preview') {
        const preview = effect as Extract<SelectionGestureEffect, { kind: 'preview' }>;
        const visual = guardedRead(() => preview.visual, current);
        const next = snapshotVisual(visual, current);
        if (this.currentVisual !== null && sameVisual(this.currentVisual, next)) return false;
        this.currentVisual = next;
        this.stateVersion += 1;
        this.ports.markDirty();
        return false;
      }
      if (kind === 'discard') {
        const discard = effect as Extract<SelectionGestureEffect, { kind: 'discard' }>;
        const sourceError = guardedRead(() => discard.error, current);
        const error = sourceError === undefined ? undefined : snapshotError(sourceError);
        if (!current()) return false;
        this.clearVisual();
        if (error !== undefined) this.ports.reportInteractionError(error);
        return false;
      }

      const commit = effect as Extract<
        SelectionGestureEffect,
        { kind: 'commit-selection' | 'commit-move' }
      >;
      const proposal = guardedRead(() => commit.proposal, current);
      const hadVisual = this.currentVisual !== null;
      const result =
        kind === 'commit-selection'
          ? this.ports.commitSelection(proposal)
          : this.ports.commitMove({
              proposal,
              delta: guardedRead(
                () => (commit as Extract<SelectionGestureEffect, { kind: 'commit-move' }>).delta,
                current,
              ),
            });
      const ok = result.ok;
      if (!ok) {
        const sourceError = (result as Readonly<{ ok: false; error: BringsError }>).error;
        const error = snapshotError(sourceError);
        if (current() && hadVisual) this.clearVisual();
        this.ports.reportInteractionError(error);
        return false;
      }
      if (current()) {
        if (hadVisual) this.currentVisual = null;
        this.stateVersion += 1;
        this.ports.markDirty();
      }
      return true;
    } catch (error) {
      if (error === INTERRUPTED) return false;
      throw error;
    }
  }

  private clearVisual(): void {
    if (this.currentVisual === null) return;
    this.currentVisual = null;
    this.stateVersion += 1;
    this.ports.markDirty();
  }
}
