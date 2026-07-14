import {
  createDocumentStore,
  hitTestPage,
  intersectPageRect,
  prepareSelectionResize,
  resolveStructuralSelection,
  type BringsError,
  type BringsDocument,
  type BringsDocumentStore,
  type CreateDocumentInput,
  type EditorSnapshot,
  type NodeId,
  type Result,
  type ResizeBounds,
  type ResizeHandlePosition,
  type SelectionResizeProposal,
  type SelectionResizeProposalInput,
  type StructuralSelection,
} from '@vectojs/brings-core';
import {
  pageDeltaBetween,
  viewportPoint,
  viewportToPagePoint,
  type EditorPagePoint,
  type EditorPageRect,
  type PageDelta,
} from './selectionCoordinates';
import type {
  AreaSelectionMode,
  PointSelectionMode,
  ResizeInteractionProposal,
  ResizeInteractionStart,
  SelectionInteractionStart,
  SelectionInteractionToken,
  SelectionProposal,
} from './selectionInteraction';

/** Caller-owned allocation boundary for document and initial-page identities. */
export type UuidFactory = () => string;

type ControllerStore = Pick<
  BringsDocumentStore,
  'snapshot' | 'setSelection' | 'execute' | 'undo' | 'redo'
>;

type ControllerOptions = Readonly<{
  createStore?: (input: CreateDocumentInput) => Result<ControllerStore>;
}>;

type PreparedCommitProposal = Readonly<{
  before: EditorSnapshot;
  selection: StructuralSelection;
  nodeIds: readonly NodeId[];
}>;

function cloneSelection(selection: StructuralSelection): StructuralSelection {
  return {
    nodeIds: [...selection.nodeIds],
    activeNodeId: selection.activeNodeId,
  };
}

function sameSelection(left: StructuralSelection, right: StructuralSelection): boolean {
  return (
    left.activeNodeId === right.activeNodeId &&
    left.nodeIds.length === right.nodeIds.length &&
    left.nodeIds.every((id, index) => id === right.nodeIds[index])
  );
}

function freezeSelection(selection: StructuralSelection): StructuralSelection {
  return Object.freeze({
    nodeIds: Object.freeze([...selection.nodeIds]),
    activeNodeId: selection.activeNodeId,
  });
}

function freezeResizeBounds(bounds: ResizeBounds): ResizeBounds {
  return Object.freeze({
    minX: bounds.minX,
    minY: bounds.minY,
    maxX: bounds.maxX,
    maxY: bounds.maxY,
  });
}

function freezeResizeHandles(
  handles: readonly ResizeHandlePosition[],
): readonly ResizeHandlePosition[] {
  return Object.freeze(
    handles.map((entry) =>
      Object.freeze({
        handle: entry.handle,
        point: Object.freeze({ x: entry.point.x, y: entry.point.y }),
      }),
    ),
  );
}

function freezeResizeInput(input: SelectionResizeProposalInput): SelectionResizeProposalInput {
  return Object.freeze({
    handle: input.handle,
    startPoint: Object.freeze({ x: input.startPoint.x, y: input.startPoint.y }),
    currentPoint: Object.freeze({ x: input.currentPoint.x, y: input.currentPoint.y }),
    preserveAspectRatio: input.preserveAspectRatio,
    fromCenter: input.fromCenter,
  });
}

function freezeResizeProposal(resize: SelectionResizeProposal): SelectionResizeProposal {
  return Object.freeze({
    handle: resize.handle,
    anchor: Object.freeze({ x: resize.anchor.x, y: resize.anchor.y }),
    scaleX: resize.scaleX,
    scaleY: resize.scaleY,
    bounds: freezeResizeBounds(resize.bounds),
    command: Object.freeze({
      kind: resize.command.kind,
      nodeIds: Object.freeze([...resize.command.nodeIds]),
      delta: Object.freeze([...resize.command.delta]) as typeof resize.command.delta,
    }),
  });
}

function sameNumbers(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameResize(left: SelectionResizeProposal, right: SelectionResizeProposal): boolean {
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
    left.command.kind === right.command.kind &&
    left.command.nodeIds.length === right.command.nodeIds.length &&
    left.command.nodeIds.every((id, index) => id === right.command.nodeIds[index]) &&
    sameNumbers(left.command.delta, right.command.delta)
  );
}

/**
 * Owns durable Brings Core state for one browser editor session. VectoJS views
 * consume its detached snapshots rather than keeping a parallel document model.
 */
export class BringsEditorController {
  private readonly store: ControllerStore;
  private readonly createUuid: UuidFactory;
  private activeFrameId: string | null = null;
  private selectionGeneration = 0;

  public constructor(createUuid: UuidFactory, options: ControllerOptions = {}) {
    this.createUuid = createUuid;
    const createStore = options.createStore ?? createDocumentStore;
    const created = createStore({
      id: createUuid(),
      name: 'Untitled',
      initialPage: {
        id: createUuid(),
        name: 'Page 1',
      },
    });
    if (!created.ok) {
      throw new Error(`Brings Core rejected the initial document: ${created.error.code}.`);
    }
    this.store = created.value;
  }

  /** Return a Core-owned detached snapshot suitable for rendering or diagnostics. */
  public snapshot(): EditorSnapshot {
    return this.store.snapshot();
  }

  /** Return complete detached controller state for deterministic transaction diagnostics. */
  public debugInteractionState(): Readonly<{
    snapshot: EditorSnapshot;
    selectionGeneration: number;
    activeFrameId: string | null;
  }> {
    return {
      snapshot: this.store.snapshot(),
      selectionGeneration: this.selectionGeneration,
      activeFrameId: this.activeFrameId,
    };
  }

  /** Capture the durable and ephemeral versions used by one pure interaction. */
  public beginSelectionInteraction(): SelectionInteractionStart {
    const snapshot = this.store.snapshot();
    return {
      token: {
        documentRevision: snapshot.document.revision,
        selectionGeneration: this.selectionGeneration,
      },
      selection: cloneSelection(snapshot.selection),
    };
  }

  /** Capture immutable Core resize geometry for the current normalized selection. */
  public beginResizeInteraction(): Result<ResizeInteractionStart> {
    const snapshot = this.store.snapshot();
    const prepared = prepareSelectionResize(snapshot.document, snapshot.selection);
    if (!prepared.ok) return prepared;
    return {
      ok: true,
      value: Object.freeze({
        token: Object.freeze({
          documentRevision: snapshot.document.revision,
          selectionGeneration: this.selectionGeneration,
        }),
        selection: freezeSelection(prepared.value.selection),
        bounds: freezeResizeBounds(prepared.value.bounds),
        handles: freezeResizeHandles(prepared.value.handles),
      }),
    };
  }

  /** Ask Core for one pure resize proposal without mutating document history. */
  public proposeResize(
    input: Readonly<{
      start: ResizeInteractionStart;
      input: SelectionResizeProposalInput;
    }>,
  ): Result<ResizeInteractionProposal> {
    const capturedStart = this.captureResizeStart(input.start);
    const capturedInput = freezeResizeInput(input.input);
    const valid = this.validateToken(capturedStart.token);
    if (!valid.ok) return valid;
    const snapshot = this.store.snapshot();
    if (!sameSelection(snapshot.selection, capturedStart.selection)) {
      return this.failure('interaction.selection-mismatch', '/selection');
    }
    const prepared = prepareSelectionResize(snapshot.document, capturedStart.selection);
    if (!prepared.ok) return prepared;
    const proposed = prepared.value.propose(capturedInput);
    if (!proposed.ok) return proposed;
    return {
      ok: true,
      value: Object.freeze({
        token: capturedStart.token,
        selection: freezeSelection(prepared.value.selection),
        input: capturedInput,
        resize: freezeResizeProposal(proposed.value),
      }),
    };
  }

  /** Validate and execute the exact final Core resize command as one history entry. */
  public commitResize(proposal: ResizeInteractionProposal): Result<EditorSnapshot> {
    const captured = this.captureResizeProposal(proposal);
    const valid = this.validateToken(captured.token);
    if (!valid.ok) return valid;
    const before = this.store.snapshot();
    if (!sameSelection(before.selection, captured.selection)) {
      return this.failure('interaction.selection-mismatch', '/selection');
    }
    const prepared = prepareSelectionResize(before.document, captured.selection);
    if (!prepared.ok) return prepared;
    const expected = prepared.value.propose(captured.input);
    if (!expected.ok) return expected;
    if (!sameResize(expected.value, captured.resize)) {
      return this.failure('interaction.resize-mismatch', '/resize');
    }
    const result = this.store.execute(captured.resize.command);
    return this.finishOperation(before.selection, result);
  }

  /** Propose a normalized point selection without mutating the Core store. */
  public proposePointSelection(
    input: Readonly<{
      start: SelectionInteractionStart;
      point: EditorPagePoint;
      mode: PointSelectionMode;
    }>,
  ): Result<Readonly<{ proposal: SelectionProposal; ownerId: NodeId | null }>> {
    const validToken = this.validateToken(input.start.token);
    if (!validToken.ok) return validToken;
    const snapshot = this.store.snapshot();
    const [rawHit] = hitTestPage(snapshot.document, input.point);
    const ownerId =
      rawHit === undefined
        ? null
        : this.resolveStructuralOwner(snapshot.document, rawHit, input.start.selection);
    const originalIds = [...input.start.selection.nodeIds];
    let nodeIds: readonly NodeId[];
    let activeNodeId: NodeId | null;

    if (input.mode === 'replace') {
      nodeIds = ownerId === null ? [] : [ownerId];
      activeNodeId = ownerId;
    } else if (ownerId === null) {
      nodeIds = originalIds;
      activeNodeId = input.start.selection.activeNodeId;
    } else if (input.mode === 'toggle' && originalIds.includes(ownerId)) {
      nodeIds = originalIds.filter((id) => id !== ownerId);
      activeNodeId = nodeIds.at(-1) ?? null;
    } else if (originalIds.includes(ownerId)) {
      nodeIds = originalIds;
      activeNodeId = input.start.selection.activeNodeId;
    } else {
      nodeIds = [...originalIds, ownerId];
      activeNodeId = ownerId;
    }

    const selection = resolveStructuralSelection(snapshot.document, { nodeIds, activeNodeId });
    if (!selection.ok) return selection;
    return {
      ok: true,
      value: {
        ownerId,
        proposal: this.proposal(input.start, selection.value),
      },
    };
  }

  /** Propose a normalized rectangle selection without mutating the Core store. */
  public proposeAreaSelection(
    input: Readonly<{
      start: SelectionInteractionStart;
      rect: EditorPageRect;
      mode: AreaSelectionMode;
    }>,
  ): Result<SelectionProposal> {
    const validToken = this.validateToken(input.start.token);
    if (!validToken.ok) return validToken;
    const snapshot = this.store.snapshot();
    const intersection = intersectPageRect(snapshot.document, input.rect);
    if (!intersection.ok) return intersection;

    let nodeIds: readonly NodeId[] = intersection.value;
    let activeNodeId = intersection.value.at(-1) ?? null;
    if (input.mode === 'add') {
      const existing = new Set(input.start.selection.nodeIds);
      const appended = intersection.value.filter((id) => !existing.has(id));
      nodeIds = [...input.start.selection.nodeIds, ...appended];
      activeNodeId = appended.at(-1) ?? input.start.selection.activeNodeId;
    }

    const selection = resolveStructuralSelection(snapshot.document, { nodeIds, activeNodeId });
    if (!selection.ok) return selection;
    return { ok: true, value: this.proposal(input.start, selection.value) };
  }

  /** Commit one normalized ephemeral selection if its interaction token is current. */
  public commitSelection(proposal: SelectionProposal): Result<EditorSnapshot> {
    const prepared = this.prepareCommitProposal(proposal);
    if (!prepared.ok) return prepared;
    return this.finishOperation(
      prepared.value.before.selection,
      this.store.setSelection(prepared.value.selection),
    );
  }

  /** Atomically commit a proposed selection and one page-space translation. */
  public commitMove(
    input: Readonly<{
      proposal: SelectionProposal;
      delta: PageDelta;
    }>,
  ): Result<EditorSnapshot> {
    const delta = input.delta;
    const deltaX = delta.x;
    const deltaY = delta.y;
    const prepared = this.prepareCommitProposal(input.proposal);
    if (!prepared.ok) return prepared;
    if (prepared.value.nodeIds.length === 0) {
      return this.failure('selection.empty', '/nodeIds');
    }
    const originalSelection = prepared.value.before.selection;
    const selected = this.store.setSelection(prepared.value.selection);
    if (!selected.ok) return selected;

    let moved: Result<EditorSnapshot>;
    try {
      moved = this.store.execute({
        kind: 'apply-transform-delta',
        nodeIds: prepared.value.nodeIds,
        delta: [1, 0, 0, 1, deltaX, deltaY],
      });
    } catch (error) {
      this.restoreSelectionOrThrow(originalSelection, error);
      throw error;
    }
    if (!moved.ok) {
      this.restoreSelectionOrThrow(originalSelection, moved.error);
      return moved;
    }
    return this.finishOperation(originalSelection, moved);
  }

  /** Create a Frame at page-space coordinates and retain it as the shape parent. */
  public createFrameAt(x: number, y: number): Result<EditorSnapshot> {
    const id = this.createUuid();
    const snapshot = this.store.snapshot();
    const result = this.store.execute({
      kind: 'create-frame',
      pageId: snapshot.document.activePageId,
      parentId: null,
      index:
        snapshot.document.pages.find((page) => page.id === snapshot.document.activePageId)
          ?.rootNodeIds.length ?? 0,
      frame: {
        id,
        name: 'Frame',
        visible: true,
        locked: false,
        opacity: 1,
        transform: [1, 0, 0, 1, x, y],
        width: 400,
        height: 300,
        cornerRadii: [0, 0, 0, 0],
        background: { type: 'solid', r: 1, g: 1, b: 1, a: 1 },
        stroke: { paint: { type: 'solid', r: 0.8, g: 0.84, b: 0.9, a: 1 }, width: 1 },
        clipChildren: false,
      },
    });
    if (result.ok) this.activeFrameId = id;
    return this.finishOperation(snapshot.selection, result);
  }

  /** Create a Rectangle in the latest Frame created by this local editor session. */
  public createRectangleAt(x: number, y: number): Result<EditorSnapshot> {
    if (this.activeFrameId === null) return this.failure('shape.frame-required', '/parentId');
    const snapshot = this.store.snapshot();
    const frame = snapshot.document.nodes.find((node) => node.id === this.activeFrameId);
    if (frame?.type !== 'frame') return this.failure('shape.frame-required', '/parentId');
    const localX = Math.max(0, Math.min(frame.width - 120, x - frame.transform[4]));
    const localY = Math.max(0, Math.min(frame.height - 80, y - frame.transform[5]));
    const result = this.store.execute({
      kind: 'create-rectangle',
      pageId: snapshot.document.activePageId,
      parentId: frame.id,
      index: frame.childIds.length,
      rectangle: {
        id: this.createUuid(),
        name: 'Rectangle',
        visible: true,
        locked: false,
        opacity: 1,
        transform: [1, 0, 0, 1, localX, localY],
        width: 120,
        height: 80,
        cornerRadii: [8, 8, 8, 8],
        fill: { type: 'solid', r: 0.18, g: 0.45, b: 0.95, a: 1 },
        stroke: null,
      },
    });
    return this.finishOperation(snapshot.selection, result);
  }

  /** Select the frontmost eligible Core node at a page-space point. */
  public selectAt(x: number, y: number): Result<EditorSnapshot> {
    const viewport = viewportPoint(x, y);
    if (!viewport.ok) return viewport;
    const point = viewportToPagePoint(viewport.value);
    if (!point.ok) return point;
    const start = this.beginSelectionInteraction();
    const proposed = this.proposePointSelection({ start, point: point.value, mode: 'replace' });
    return proposed.ok ? this.commitSelection(proposed.value.proposal) : proposed;
  }

  /** Commit one page-space translation for the current Core-owned selection. */
  public moveSelectionBy(deltaX: number, deltaY: number): Result<EditorSnapshot> {
    const start = this.beginSelectionInteraction();
    if (start.selection.nodeIds.length === 0) return this.failure('selection.empty', '/nodeIds');
    const originViewport = viewportPoint(0, 0);
    if (!originViewport.ok) return originViewport;
    const destinationViewport = viewportPoint(deltaX, deltaY);
    if (!destinationViewport.ok) return destinationViewport;
    const origin = viewportToPagePoint(originViewport.value);
    if (!origin.ok) return origin;
    const destination = viewportToPagePoint(destinationViewport.value);
    if (!destination.ok) return destination;
    const delta = pageDeltaBetween(origin.value, destination.value);
    if (!delta.ok) return delta;
    return this.commitMove({
      proposal: this.proposal(start, start.selection),
      delta: delta.value,
    });
  }

  /** Delete the normalized selection as one Core command; empty selection is a no-op. */
  public deleteSelection(): Result<EditorSnapshot> {
    const snapshot = this.store.snapshot();
    if (snapshot.selection.nodeIds.length === 0) return { ok: true, value: snapshot };
    return this.finishOperation(
      snapshot.selection,
      this.store.execute({
        kind: 'delete-nodes',
        nodeIds: snapshot.selection.nodeIds,
      }),
    );
  }

  /** Undo the most recent durable Core command. */
  public undo(): Result<EditorSnapshot> {
    const before = this.store.snapshot().selection;
    return this.finishOperation(before, this.store.undo());
  }

  /** Reapply the most recently undone durable Core command. */
  public redo(): Result<EditorSnapshot> {
    const before = this.store.snapshot().selection;
    return this.finishOperation(before, this.store.redo());
  }

  private proposal(
    start: SelectionInteractionStart,
    selection: StructuralSelection,
  ): SelectionProposal {
    return {
      token: { ...start.token },
      originalSelection: cloneSelection(start.selection),
      selection: cloneSelection(selection),
    };
  }

  private currentToken(): SelectionInteractionToken {
    return {
      documentRevision: this.store.snapshot().document.revision,
      selectionGeneration: this.selectionGeneration,
    };
  }

  private captureResizeStart(start: ResizeInteractionStart): ResizeInteractionStart {
    const token = start.token;
    return Object.freeze({
      token: Object.freeze({
        documentRevision: token.documentRevision,
        selectionGeneration: token.selectionGeneration,
      }),
      selection: freezeSelection(start.selection),
      bounds: freezeResizeBounds(start.bounds),
      handles: freezeResizeHandles(start.handles),
    });
  }

  private captureResizeProposal(proposal: ResizeInteractionProposal): ResizeInteractionProposal {
    const token = proposal.token;
    return Object.freeze({
      token: Object.freeze({
        documentRevision: token.documentRevision,
        selectionGeneration: token.selectionGeneration,
      }),
      selection: freezeSelection(proposal.selection),
      input: freezeResizeInput(proposal.input),
      resize: freezeResizeProposal(proposal.resize),
    });
  }

  private validateToken(token: SelectionInteractionToken): Result<void> {
    const current = this.currentToken();
    return current.documentRevision === token.documentRevision &&
      current.selectionGeneration === token.selectionGeneration
      ? { ok: true, value: undefined }
      : this.failure('interaction.stale', '/interaction');
  }

  /** Detach untrusted caller state before validation or durable store mutation. */
  private prepareCommitProposal(proposal: SelectionProposal): Result<PreparedCommitProposal> {
    const tokenSource = proposal.token;
    const token: SelectionInteractionToken = {
      documentRevision: tokenSource.documentRevision,
      selectionGeneration: tokenSource.selectionGeneration,
    };
    const selectionSource = proposal.selection;
    const rawNodeIds: unknown = selectionSource.nodeIds;
    const activeNodeId: unknown = selectionSource.activeNodeId;
    const nodeIds = Array.isArray(rawNodeIds) ? [...rawNodeIds] : rawNodeIds;
    const before = this.store.snapshot();

    if (
      before.document.revision !== token.documentRevision ||
      this.selectionGeneration !== token.selectionGeneration
    ) {
      return this.failure('interaction.stale', '/interaction');
    }

    const normalized = resolveStructuralSelection(before.document, {
      nodeIds: nodeIds as readonly string[],
      activeNodeId: activeNodeId as string | null,
    });
    if (!normalized.ok) return normalized;
    const normalizedNodeIds = [...normalized.value.nodeIds];
    const selection: StructuralSelection = {
      nodeIds: normalizedNodeIds,
      activeNodeId: normalized.value.activeNodeId,
    };
    return {
      ok: true,
      value: {
        before,
        selection,
        nodeIds: normalizedNodeIds,
      },
    };
  }

  /** Restore the pre-transaction selection or surface the broken atomicity invariant. */
  private restoreSelectionOrThrow(
    originalSelection: StructuralSelection,
    operationCause: unknown,
  ): void {
    let restored: Result<EditorSnapshot>;
    try {
      restored = this.store.setSelection(originalSelection);
    } catch (restorationCause) {
      throw new Error('Controller invariant violation: selection restoration threw.', {
        cause: new AggregateError(
          [operationCause, restorationCause],
          'The move operation and its selection restoration both failed.',
        ),
      });
    }
    if (!restored.ok) {
      throw new Error(
        `Controller invariant violation: selection restoration failed with ${restored.error.code} at ${restored.error.path}.`,
        { cause: operationCause },
      );
    }
  }

  private finishOperation(
    before: StructuralSelection,
    result: Result<EditorSnapshot>,
  ): Result<EditorSnapshot> {
    if (result.ok && !sameSelection(before, result.value.selection)) {
      this.selectionGeneration += 1;
    }
    return result;
  }

  private resolveStructuralOwner(
    document: BringsDocument,
    rawHit: NodeId,
    selection: StructuralSelection,
  ): NodeId {
    const selected = new Set(selection.nodeIds);
    const nodes = new Map(document.nodes.map((node) => [node.id, node]));
    let current = nodes.get(rawHit);
    while (current !== undefined) {
      if (selected.has(current.id)) return current.id;
      current = current.parentId === null ? undefined : nodes.get(current.parentId);
    }
    return rawHit;
  }

  private failure(code: string, path: string): Result<never> {
    const error: BringsError = { code, path };
    return { ok: false, error };
  }
}
