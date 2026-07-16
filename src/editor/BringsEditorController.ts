import {
  createDocumentStore,
  hitTestPage,
  intersectPageRect,
  prepareSelectionAlignment,
  prepareSelectionResize,
  resolveStructuralSelection,
  type BringsError,
  type BringsDocument,
  type BringsDocumentStore,
  type AlignmentGuide,
  type CreateDocumentInput,
  type EditorSnapshot,
  type NodeId,
  type NodePropertyPatchInput,
  type Result,
  type SceneNode,
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
  MoveInteractionProposal,
  SelectionInteractionStart,
  SelectionInteractionToken,
  SelectionProposal,
} from './selectionInteraction';

/** Caller-owned allocation boundary for document and initial-page identities. */
export type UuidFactory = () => string;

/** One canvas Layers row derived directly from the active Core document page. */
export type BringsLayerItem = Readonly<{
  id: NodeId;
  parentId: NodeId | null;
  type: SceneNode['type'];
  name: string;
  depth: number;
  visible: boolean;
  locked: boolean;
  selected: boolean;
  hasChildren: boolean;
}>;

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

type PreparedAlignment =
  ReturnType<typeof prepareSelectionAlignment> extends Result<infer T> ? T : never;

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

function freezeGuides(guides: readonly AlignmentGuide[]): readonly AlignmentGuide[] {
  return Object.freeze(
    guides.map((guide) =>
      Object.freeze({
        axis: guide.axis,
        sourceAnchor: guide.sourceAnchor,
        targetAnchor: guide.targetAnchor,
        targetNodeId: guide.targetNodeId,
        coordinate: guide.coordinate,
        minExtent: guide.minExtent,
        maxExtent: guide.maxExtent,
      }),
    ),
  );
}

function freezePageDelta(delta: PageDelta): PageDelta {
  return Object.freeze({ x: delta.x, y: delta.y }) as PageDelta;
}

function sameGuides(left: readonly AlignmentGuide[], right: readonly AlignmentGuide[]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (guide, index) =>
        guide.axis === right[index]?.axis &&
        guide.sourceAnchor === right[index]?.sourceAnchor &&
        guide.targetAnchor === right[index]?.targetAnchor &&
        guide.targetNodeId === right[index]?.targetNodeId &&
        guide.coordinate === right[index]?.coordinate &&
        guide.minExtent === right[index]?.minExtent &&
        guide.maxExtent === right[index]?.maxExtent,
    )
  );
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
  private alignment: Readonly<{ key: string; value: PreparedAlignment }> | null = null;

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

  /** Flatten the active page hierarchy in Core paint order for the Layers panel. */
  public layers(): readonly BringsLayerItem[] {
    const snapshot = this.store.snapshot();
    const page = snapshot.document.pages.find(
      (candidate) => candidate.id === snapshot.document.activePageId,
    );
    if (page === undefined) return [];
    const nodes = new Map(snapshot.document.nodes.map((node) => [node.id, node]));
    const selected = new Set(snapshot.selection.nodeIds);
    const layers: BringsLayerItem[] = [];
    const visit = (nodeId: NodeId, depth: number): void => {
      const node = nodes.get(nodeId);
      if (node === undefined) return;
      const hasChildren = node.type === 'frame' || node.type === 'group';
      layers.push(
        Object.freeze({
          id: node.id,
          parentId: node.parentId,
          type: node.type,
          name: node.name,
          depth,
          visible: node.visible,
          locked: node.locked,
          selected: selected.has(node.id),
          hasChildren,
        }),
      );
      if (!hasChildren) return;
      for (const childId of node.childIds) visit(childId, depth + 1);
    };
    for (const rootId of page.rootNodeIds) visit(rootId, 0);
    return Object.freeze(layers);
  }

  /** Set ephemeral selection from a Layers interaction without adding history. */
  public setLayerSelection(
    nodeIds: readonly string[],
    activeNodeId: string | null = nodeIds.at(-1) ?? null,
  ): Result<EditorSnapshot> {
    const before = this.store.snapshot().selection;
    return this.finishOperation(before, this.store.setSelection({ nodeIds, activeNodeId }));
  }

  /** Apply one Core-compatible patch to the normalized current selection. */
  public setSelectionProperties(patch: NodePropertyPatchInput): Result<EditorSnapshot> {
    const snapshot = this.store.snapshot();
    if (snapshot.selection.nodeIds.length === 0) return this.failure('selection.empty', '/nodeIds');
    return this.finishOperation(
      snapshot.selection,
      this.store.execute({
        kind: 'set-node-properties',
        nodeIds: snapshot.selection.nodeIds,
        patch,
      }),
    );
  }

  /** Rename exactly one active layer through the Core property command. */
  public renameSelection(name: string): Result<EditorSnapshot> {
    const snapshot = this.store.snapshot();
    if (snapshot.selection.nodeIds.length !== 1)
      return this.failure('selection.single-required', '/nodeIds');
    return this.setSelectionProperties({ name });
  }

  /** Toggle visibility for every selected compatible Core node. */
  public setSelectionVisibility(visible: boolean): Result<EditorSnapshot> {
    return this.setSelectionProperties({ visible });
  }

  /** Toggle lock state for every selected compatible Core node. */
  public setSelectionLocked(locked: boolean): Result<EditorSnapshot> {
    return this.setSelectionProperties({ locked });
  }

  /** Toggle one Layers-row visibility without changing the active selection first. */
  public toggleLayerVisibility(nodeId: string): Result<EditorSnapshot> {
    const snapshot = this.store.snapshot();
    const node = snapshot.document.nodes.find((candidate) => candidate.id === nodeId);
    if (node === undefined) return this.failure('node.not-found', '/nodeIds');
    return this.finishOperation(
      snapshot.selection,
      this.store.execute({
        kind: 'set-node-properties',
        nodeIds: [node.id],
        patch: { visible: !node.visible },
      }),
    );
  }

  /** Wrap selected sibling roots in a named Core Group. */
  public groupSelection(name = 'Group'): Result<EditorSnapshot> {
    const snapshot = this.store.snapshot();
    if (snapshot.selection.nodeIds.length < 2)
      return this.failure('selection.group-minimum', '/nodeIds');
    return this.finishOperation(
      snapshot.selection,
      this.store.execute({
        kind: 'group-nodes',
        nodeIds: snapshot.selection.nodeIds,
        group: { id: this.createUuid(), name },
      }),
    );
  }

  /** Dissolve the one selected Core Group while retaining Core history behavior. */
  public ungroupSelection(): Result<EditorSnapshot> {
    const snapshot = this.store.snapshot();
    if (snapshot.selection.nodeIds.length !== 1 || snapshot.selection.activeNodeId === null) {
      return this.failure('selection.single-required', '/nodeIds');
    }
    return this.finishOperation(
      snapshot.selection,
      this.store.execute({ kind: 'ungroup-node', nodeId: snapshot.selection.activeNodeId }),
    );
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

  /** Report bounded prepared-alignment ownership without exposing its captured document. */
  public debugPreparedAlignmentCount(): 0 | 1 {
    return this.alignment === null ? 0 : 1;
  }

  /** Capture the durable and ephemeral versions used by one pure interaction. */
  public beginSelectionInteraction(): SelectionInteractionStart {
    const snapshot = this.store.snapshot();
    const start = {
      token: {
        documentRevision: snapshot.document.revision,
        selectionGeneration: this.selectionGeneration,
      },
      selection: cloneSelection(snapshot.selection),
    };
    this.captureAlignment(snapshot.document, start.selection, start.token);
    return start;
  }

  /** Capture immutable Core resize geometry for the current normalized selection. */
  public beginResizeInteraction(): Result<ResizeInteractionStart> {
    this.clearAlignment();
    const snapshot = this.store.snapshot();
    const prepared = prepareSelectionResize(snapshot.document, snapshot.selection);
    if (!prepared.ok) return prepared;
    const start = Object.freeze({
      token: Object.freeze({
        documentRevision: snapshot.document.revision,
        selectionGeneration: this.selectionGeneration,
      }),
      selection: freezeSelection(prepared.value.selection),
      bounds: freezeResizeBounds(prepared.value.bounds),
      handles: freezeResizeHandles(prepared.value.handles),
    });
    this.captureAlignment(snapshot.document, start.selection, start.token);
    return { ok: true, value: start };
  }

  /** Ask Core for one immutable snapped move proposal without changing history. */
  public proposeMove(
    input: Readonly<{
      start: SelectionInteractionStart;
      proposal: SelectionProposal;
      delta: PageDelta;
    }>,
  ): Result<MoveInteractionProposal> {
    if (!this.sameToken(input.start.token, input.proposal.token)) {
      return this.failure('interaction.stale', '/interaction');
    }
    const prepared = this.prepareCommitProposal(input.proposal);
    if (!prepared.ok) return prepared;
    const alignment = this.alignmentFor(
      prepared.value.before.document,
      prepared.value.selection,
      input.proposal.token,
    );
    if (!alignment.ok) return alignment;
    const rawDelta = freezePageDelta(input.delta);
    const resolved = alignment.value.resolveMove(rawDelta);
    if (!resolved.ok) return resolved;
    return {
      ok: true,
      value: Object.freeze({
        token: Object.freeze({ ...input.proposal.token }),
        selection: freezeSelection(prepared.value.selection),
        rawDelta,
        delta: freezePageDelta(resolved.value.delta as PageDelta),
        guides: freezeGuides(resolved.value.guides),
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
    const alignment = this.alignmentFor(
      snapshot.document,
      capturedStart.selection,
      capturedStart.token,
    );
    if (!alignment.ok) return alignment;
    const proposed = alignment.value.resolveResize(capturedInput);
    if (!proposed.ok) return proposed;
    const adjustedInput = freezeResizeInput({
      ...capturedInput,
      currentPoint: proposed.value.currentPoint,
    });
    return {
      ok: true,
      value: Object.freeze({
        token: capturedStart.token,
        selection: freezeSelection(alignment.value.selection),
        input: adjustedInput,
        resize: freezeResizeProposal(proposed.value.resize),
        guides: freezeGuides(proposed.value.guides),
      }),
    };
  }

  /** Validate and execute the exact final Core resize command as one history entry. */
  public commitResize(proposal: ResizeInteractionProposal): Result<EditorSnapshot> {
    try {
      const captured = this.captureResizeProposal(proposal);
      const valid = this.validateToken(captured.token);
      if (!valid.ok) return valid;
      const before = this.store.snapshot();
      if (!sameSelection(before.selection, captured.selection)) {
        return this.failure('interaction.selection-mismatch', '/selection');
      }
      const alignment = this.alignmentFor(before.document, captured.selection, captured.token);
      if (!alignment.ok) return alignment;
      const expected = alignment.value.resolveResize(captured.input);
      if (!expected.ok) return expected;
      if (
        !sameResize(expected.value.resize, captured.resize) ||
        !sameGuides(expected.value.guides, captured.guides) ||
        expected.value.currentPoint.x !== captured.input.currentPoint.x ||
        expected.value.currentPoint.y !== captured.input.currentPoint.y
      ) {
        return this.failure('interaction.resize-mismatch', '/resize');
      }
      const result = this.store.execute(captured.resize.command);
      return this.finishOperation(before.selection, result);
    } finally {
      this.clearAlignment();
    }
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
    try {
      const prepared = this.prepareCommitProposal(proposal);
      if (!prepared.ok) return prepared;
      return this.finishOperation(
        prepared.value.before.selection,
        this.store.setSelection(prepared.value.selection),
      );
    } finally {
      this.clearAlignment();
    }
  }

  /** Atomically commit a proposed selection and one page-space translation. */
  public commitMove(
    input: Readonly<{
      proposal: SelectionProposal;
      delta: PageDelta;
      alignment?: MoveInteractionProposal;
    }>,
  ): Result<EditorSnapshot> {
    try {
      return this.commitMoveOwned(input);
    } finally {
      this.clearAlignment();
    }
  }

  private commitMoveOwned(
    input: Readonly<{
      proposal: SelectionProposal;
      delta: PageDelta;
      alignment?: MoveInteractionProposal;
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
    if (input.alignment !== undefined) {
      const captured = this.captureMoveProposal(input.alignment);
      if (
        !this.sameToken(captured.token, input.proposal.token) ||
        !sameSelection(captured.selection, prepared.value.selection)
      ) {
        return this.failure('interaction.move-mismatch', '/move');
      }
      const alignment = this.alignmentFor(
        prepared.value.before.document,
        prepared.value.selection,
        captured.token,
      );
      if (!alignment.ok) return alignment;
      const expected = alignment.value.resolveMove(captured.rawDelta);
      if (
        !expected.ok ||
        expected.value.delta.x !== captured.delta.x ||
        expected.value.delta.y !== captured.delta.y ||
        !sameGuides(expected.value.guides, captured.guides) ||
        captured.delta.x !== deltaX ||
        captured.delta.y !== deltaY
      ) {
        return this.failure('interaction.move-mismatch', '/move');
      }
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
    return this.createFrameInBounds(
      Object.freeze({ x, y, width: 400, height: 300 }) as EditorPageRect,
    );
  }

  /** Create a root Frame from validated page-space bounds. */
  public createFrameInBounds(
    bounds: Readonly<{ x: number; y: number; width: number; height: number }>,
  ): Result<EditorSnapshot> {
    const captured = this.captureCreationBounds(bounds);
    if (!captured.ok) return captured;
    const id = this.createUuid();
    const snapshot = this.store.snapshot();
    const geometry = captured.value;
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
        transform: [1, 0, 0, 1, geometry.x, geometry.y],
        width: geometry.width,
        height: geometry.height,
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
    return this.createRectangleInBounds(
      Object.freeze({ x, y, width: 120, height: 80 }) as EditorPageRect,
    );
  }

  /** Create a Rectangle from page bounds, clamped into the active Frame. */
  public createRectangleInBounds(
    bounds: Readonly<{ x: number; y: number; width: number; height: number }>,
  ): Result<EditorSnapshot> {
    const captured = this.captureCreationBounds(bounds);
    if (!captured.ok) return captured;
    if (this.activeFrameId === null) return this.failure('shape.frame-required', '/parentId');
    const snapshot = this.store.snapshot();
    const frame = snapshot.document.nodes.find((node) => node.id === this.activeFrameId);
    if (frame?.type !== 'frame') return this.failure('shape.frame-required', '/parentId');
    const local = this.frameLocalCreationBounds(frame, captured.value);
    if (!local.ok) return local;
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
        transform: [1, 0, 0, 1, local.value.x, local.value.y],
        width: local.value.width,
        height: local.value.height,
        cornerRadii: [8, 8, 8, 8],
        fill: { type: 'solid', r: 0.18, g: 0.45, b: 0.95, a: 1 },
        stroke: null,
      },
    });
    return this.finishOperation(snapshot.selection, result);
  }

  /** Create an Ellipse in the latest Frame created by this local editor session. */
  public createEllipseAt(x: number, y: number): Result<EditorSnapshot> {
    return this.createEllipseInBounds(
      Object.freeze({ x, y, width: 120, height: 120 }) as EditorPageRect,
    );
  }

  /** Create an Ellipse from page bounds, clamped into the active Frame. */
  public createEllipseInBounds(
    bounds: Readonly<{ x: number; y: number; width: number; height: number }>,
  ): Result<EditorSnapshot> {
    const captured = this.captureCreationBounds(bounds);
    if (!captured.ok) return captured;
    if (this.activeFrameId === null) return this.failure('shape.frame-required', '/parentId');
    const snapshot = this.store.snapshot();
    const frame = snapshot.document.nodes.find((node) => node.id === this.activeFrameId);
    if (frame?.type !== 'frame') return this.failure('shape.frame-required', '/parentId');
    const local = this.frameLocalCreationBounds(frame, captured.value);
    if (!local.ok) return local;
    const result = this.store.execute({
      kind: 'create-ellipse',
      pageId: snapshot.document.activePageId,
      parentId: frame.id,
      index: frame.childIds.length,
      ellipse: {
        id: this.createUuid(),
        name: 'Ellipse',
        visible: true,
        locked: false,
        opacity: 1,
        transform: [1, 0, 0, 1, local.value.x, local.value.y],
        width: local.value.width,
        height: local.value.height,
        fill: { type: 'solid', r: 0.18, g: 0.45, b: 0.95, a: 1 },
        stroke: null,
      },
    });
    return this.finishOperation(snapshot.selection, result);
  }

  /** Create editable auto-width text in the latest Frame created by this local editor session. */
  public createTextAt(x: number, y: number): Result<EditorSnapshot> {
    if (this.activeFrameId === null) return this.failure('shape.frame-required', '/parentId');
    const snapshot = this.store.snapshot();
    const frame = snapshot.document.nodes.find((node) => node.id === this.activeFrameId);
    if (frame?.type !== 'frame') return this.failure('shape.frame-required', '/parentId');
    const localX = Math.max(0, Math.min(frame.width - 160, x - frame.transform[4]));
    const localY = Math.max(0, Math.min(frame.height - 32, y - frame.transform[5]));
    const id = this.createUuid();
    const result = this.store.execute({
      kind: 'create-text',
      pageId: snapshot.document.activePageId,
      parentId: frame.id,
      index: frame.childIds.length,
      text: {
        id,
        name: 'Text',
        visible: true,
        locked: false,
        opacity: 1,
        transform: [1, 0, 0, 1, localX, localY],
        content: 'Text',
        fontFamilies: ['Inter'],
        fontWeight: 400,
        fontSize: 16,
        lineHeight: 24,
        horizontalAlign: 'left',
        layoutMode: 'autoWidth',
        width: 160,
        height: 24,
        fill: { type: 'solid', r: 0.07, g: 0.09, b: 0.13, a: 1 },
      },
    });
    if (!result.ok) return this.finishOperation(snapshot.selection, result);
    return this.finishOperation(
      snapshot.selection,
      this.store.setSelection({ nodeIds: [id], activeNodeId: id }),
    );
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

  private captureCreationBounds(
    bounds: Readonly<{ x: number; y: number; width: number; height: number }>,
  ): Result<EditorPageRect> {
    let x: number;
    let y: number;
    let width: number;
    let height: number;
    try {
      x = bounds.x;
      y = bounds.y;
      width = bounds.width;
      height = bounds.height;
    } catch {
      return this.failure('interaction.coordinate-invalid', '/bounds');
    }
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
      return this.failure('interaction.coordinate-invalid', '/bounds');
    }
    return {
      ok: true,
      value: Object.freeze({ x, y, width, height }) as EditorPageRect,
    };
  }

  private frameLocalCreationBounds(
    frame: Extract<SceneNode, { type: 'frame' }>,
    bounds: EditorPageRect,
  ): Result<EditorPageRect> {
    const [scaleX, shearY, shearX, scaleY, translateX, translateY] = frame.transform;
    if (
      shearX !== 0 ||
      shearY !== 0 ||
      scaleX === 0 ||
      scaleY === 0 ||
      ![scaleX, scaleY, translateX, translateY].every(Number.isFinite)
    ) {
      return this.failure('shape.frame-transform-unsupported', '/parentId');
    }
    const width = Math.min(frame.width, bounds.width / Math.abs(scaleX));
    const height = Math.min(frame.height, bounds.height / Math.abs(scaleY));
    const rawX =
      scaleX > 0 ? (bounds.x - translateX) / scaleX : (bounds.x - translateX) / scaleX - width;
    const rawY =
      scaleY > 0 ? (bounds.y - translateY) / scaleY : (bounds.y - translateY) / scaleY - height;
    const x = Math.max(0, Math.min(frame.width - width, rawX));
    const y = Math.max(0, Math.min(frame.height - height, rawY));
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
      return this.failure('interaction.coordinate-invalid', '/bounds');
    }
    return {
      ok: true,
      value: Object.freeze({ x, y, width, height }) as EditorPageRect,
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
      guides: freezeGuides(proposal.guides),
    });
  }

  private captureMoveProposal(proposal: MoveInteractionProposal): MoveInteractionProposal {
    return Object.freeze({
      token: Object.freeze({ ...proposal.token }),
      selection: freezeSelection(proposal.selection),
      rawDelta: freezePageDelta(proposal.rawDelta),
      delta: freezePageDelta(proposal.delta),
      guides: freezeGuides(proposal.guides),
    });
  }

  private alignmentKey(token: SelectionInteractionToken, selection: StructuralSelection): string {
    return `${token.documentRevision}:${token.selectionGeneration}:${selection.activeNodeId ?? ''}:${selection.nodeIds.join(',')}`;
  }

  private captureAlignment(
    document: BringsDocument,
    selection: StructuralSelection,
    token: SelectionInteractionToken,
  ): void {
    this.alignment = null;
    if (selection.nodeIds.length === 0) return;
    const key = this.alignmentKey(token, selection);
    const prepared = prepareSelectionAlignment(document, selection);
    if (prepared.ok) this.alignment = Object.freeze({ key, value: prepared.value });
  }

  private alignmentFor(
    document: BringsDocument,
    selection: StructuralSelection,
    token: SelectionInteractionToken,
  ): Result<PreparedAlignment> {
    const key = this.alignmentKey(token, selection);
    if (this.alignment?.key === key) return { ok: true, value: this.alignment.value };
    const prepared = prepareSelectionAlignment(document, selection);
    this.alignment = prepared.ok ? Object.freeze({ key, value: prepared.value }) : null;
    return prepared;
  }

  private clearAlignment(): void {
    this.alignment = null;
  }

  private sameToken(left: SelectionInteractionToken, right: SelectionInteractionToken): boolean {
    return (
      left.documentRevision === right.documentRevision &&
      left.selectionGeneration === right.selectionGeneration
    );
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
    this.clearAlignment();
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
    if (code === 'interaction.stale' || code === 'interaction.selection-mismatch') {
      this.clearAlignment();
    }
    const error: BringsError = { code, path };
    return { ok: false, error };
  }
}
