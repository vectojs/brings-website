import type {
  BringsError,
  EditorSnapshot,
  Matrix,
  Result,
  SelectionResizeProposal,
  StructuralSelection,
} from '@vectojs/brings-core';
import type { PageDelta } from '../editor/selectionCoordinates';
import type {
  ResizeInteractionProposal,
  SelectionInteractionToken,
  SelectionProposal,
} from '../editor/selectionInteraction';
import type { SelectionGestureEffect, SelectionGestureVisual } from './MarqueeSelectionSession';

const INTERRUPTED = Symbol('selection-interpreter-interrupted');

type SnapshotGuard = () => boolean;

export type SelectionGestureInterpreterPorts = Readonly<{
  commitSelection: (proposal: SelectionProposal) => Result<EditorSnapshot>;
  commitMove: (
    input: Readonly<{ proposal: SelectionProposal; delta: PageDelta }>,
  ) => Result<EditorSnapshot>;
  commitResize?: (proposal: ResizeInteractionProposal) => Result<EditorSnapshot>;
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
  const resize = guardedRead(() => visual.resize, guard);
  const detachedSelection = snapshotSelection(selection, guard);
  const detachedMarquee =
    marquee === null
      ? null
      : Object.freeze({
          x: guardedRead(() => marquee.x, guard),
          y: guardedRead(() => marquee.y, guard),
          width: guardedRead(() => marquee.width, guard),
          height: guardedRead(() => marquee.height, guard),
        });
  const detachedDelta =
    movementDelta === null
      ? null
      : (Object.freeze({
          x: guardedRead(() => movementDelta.x, guard),
          y: guardedRead(() => movementDelta.y, guard),
        }) as PageDelta);
  if (resize !== undefined) {
    return Object.freeze({
      selection: detachedSelection,
      marquee: null,
      movementDelta: null,
      resize: snapshotResize(resize, guard),
    });
  }
  if (detachedDelta !== null) {
    return Object.freeze({
      selection: detachedSelection,
      marquee: null,
      movementDelta: detachedDelta,
    });
  }
  return Object.freeze({
    selection: detachedSelection,
    marquee: detachedMarquee,
    movementDelta: null,
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

function snapshotPoint(
  point: Readonly<{ x: number; y: number }>,
  guard?: SnapshotGuard,
): Readonly<{ x: number; y: number }> {
  return Object.freeze({
    x: guardedRead(() => point.x, guard),
    y: guardedRead(() => point.y, guard),
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
  const bounds = guardedRead(() => resize.bounds, guard);
  return Object.freeze({
    handle: guardedRead(() => resize.handle, guard),
    anchor: snapshotPoint(
      guardedRead(() => resize.anchor, guard),
      guard,
    ),
    scaleX: guardedRead(() => resize.scaleX, guard),
    scaleY: guardedRead(() => resize.scaleY, guard),
    bounds: Object.freeze({
      minX: guardedRead(() => bounds.minX, guard),
      minY: guardedRead(() => bounds.minY, guard),
      maxX: guardedRead(() => bounds.maxX, guard),
      maxY: guardedRead(() => bounds.maxY, guard),
    }),
    command: Object.freeze({
      kind: guardedRead(() => command.kind, guard),
      nodeIds: Object.freeze([...guardedRead(() => command.nodeIds, guard)]),
      delta: snapshotMatrix(
        guardedRead(() => command.delta, guard),
        guard,
      ),
    }),
  });
}

function snapshotResizeProposal(
  proposal: ResizeInteractionProposal,
  guard?: SnapshotGuard,
): ResizeInteractionProposal {
  const input = guardedRead(() => proposal.input, guard);
  return Object.freeze({
    token: snapshotToken(
      guardedRead(() => proposal.token, guard),
      guard,
    ),
    selection: snapshotSelection(
      guardedRead(() => proposal.selection, guard),
      guard,
    ),
    input: Object.freeze({
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
    }),
    resize: snapshotResize(
      guardedRead(() => proposal.resize, guard),
      guard,
    ),
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

function sameResize(
  left: SelectionGestureVisual['resize'],
  right: SelectionGestureVisual['resize'],
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return (
    left.handle === right.handle &&
    left.anchor.x === right.anchor.x &&
    left.anchor.y === right.anchor.y &&
    left.scaleX === right.scaleX &&
    left.scaleY === right.scaleY &&
    left.bounds.minX === right.bounds.minX &&
    left.bounds.minY === right.bounds.minY &&
    left.bounds.maxX === right.bounds.maxX &&
    left.bounds.maxY === right.bounds.maxY &&
    left.command.nodeIds.length === right.command.nodeIds.length &&
    left.command.nodeIds.every((id, index) => id === right.command.nodeIds[index]) &&
    left.command.delta.every((value, index) => value === right.command.delta[index])
  );
}

function sameVisual(left: SelectionGestureVisual, right: SelectionGestureVisual): boolean {
  return (
    sameSelection(left.selection, right.selection) &&
    sameRect(left.marquee, right.marquee) &&
    sameDelta(left.movementDelta, right.movementDelta) &&
    sameResize(left.resize, right.resize)
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
        { kind: 'commit-selection' | 'commit-move' | 'commit-resize' }
      >;
      const proposal = guardedRead(() => commit.proposal, current);
      const hadVisual = this.currentVisual !== null;
      let result: Result<EditorSnapshot>;
      try {
        result =
          kind === 'commit-selection'
            ? this.ports.commitSelection(proposal as SelectionProposal)
            : kind === 'commit-move'
              ? this.ports.commitMove({
                  proposal: proposal as SelectionProposal,
                  delta: guardedRead(
                    () =>
                      (commit as Extract<SelectionGestureEffect, { kind: 'commit-move' }>).delta,
                    current,
                  ),
                })
              : (this.ports.commitResize?.(
                  snapshotResizeProposal(proposal as ResizeInteractionProposal, current),
                ) ?? {
                  ok: false,
                  error: { code: 'interaction.resize-unavailable', path: '/commitResize' },
                });
      } catch (error) {
        if (error === INTERRUPTED) return false;
        if (kind !== 'commit-resize') throw error;
        const commitError = Object.freeze({
          code: 'interaction.commit-threw',
          path: '/commitResize',
        });
        if (current() && hadVisual) this.clearVisual();
        this.ports.reportInteractionError(commitError);
        return false;
      }
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
