import {
  type A11yAttributes,
  type ContentProjection,
  Entity,
  Group,
  type IRenderer,
  Rect,
  type VectoJSEvent,
} from '@vectojs/core';
import { Input } from '@vectojs/ui/input';
import type {
  AlignmentGuide,
  BringsError,
  EditorSnapshot,
  Matrix,
  NodeId,
  NodePropertyPatchInput,
  ResizeBounds,
  ResizeHandle,
  ResizePoint,
  Result,
  SceneNode,
  SelectionResizeProposal,
} from '@vectojs/brings-core';
import type { BringsLayerItem } from '../editor/BringsEditorController';
import { editorPagePoint, viewportPoint, type PageDelta } from '../editor/selectionCoordinates';
import { createCameraViewport, normalizeWheelDelta } from './CameraViewport';
import { CanvasLabel, MobileModeNotice, ToolbarButton, ZoomReadout } from './EditorChrome';
import type {
  ResizeInteractionProposal,
  ResizeInteractionStart,
  ResizeProposalProvider,
  MoveInteractionProposal,
  SelectionInteractionStart,
  SelectionProposal,
  SelectionProposalProvider,
} from '../editor/selectionInteraction';
import { type EditorLayout, resolveEditorLayout } from './layout';
import { isNativeEditorTarget, resolveEditorShortcut } from './editorShortcuts';
import {
  MarqueeSelectionSession,
  type SelectionGestureSessionSnapshot,
  type SelectionGestureVisual,
  type SelectionPointerSample,
} from './MarqueeSelectionSession';
import {
  type CapturedResizeInteraction,
  captureResizeInteraction,
  resolveResizePreviewLocalMatrix,
} from './ResizeInteractionGeometry';
import {
  ResizeSelectionSession,
  type ResizePointerSample,
  type ResizeSelectionSessionSnapshot,
} from './ResizeSelectionSession';
import { SelectionGestureInterpreter } from './SelectionGestureInterpreter';
import {
  CreationGestureSession,
  type CreationBounds,
  type CreationGestureEffect,
  type CreationGestureSessionSnapshot,
  type CreationGestureVisual,
  type CreationPointerSample,
  type CreationShapeTool,
} from './CreationGestureSession';

export type DrawerSide = 'left' | 'right';

const IDENTITY_MATRIX: Matrix = Object.freeze([1, 0, 0, 1, 0, 0]);

function multiplyMatrices(left: Matrix, right: Matrix): Matrix | null {
  const product = [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
  return product.every(Number.isFinite) ? (Object.freeze(product) as Matrix) : null;
}

function moveDeltaInParentSpace(parent: Matrix, delta: PageDelta): PageDelta | null {
  if (parent[1] !== 0 || parent[2] !== 0 || parent[0] === 0 || parent[3] === 0) return null;
  const x = delta.x / parent[0];
  const y = delta.y / parent[3];
  return Number.isFinite(x) && Number.isFinite(y) ? (Object.freeze({ x, y }) as PageDelta) : null;
}

function applyAxisAlignedMatrix(renderer: IRenderer, matrix: Matrix): boolean {
  if (matrix[1] !== 0 || matrix[2] !== 0) return false;
  renderer.translate(matrix[4], matrix[5]);
  renderer.scale(matrix[0], matrix[3]);
  return true;
}

function appendEllipsePath(
  renderer: IRenderer,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const radiusX = width / 2;
  const radiusY = height / 2;
  const centerX = x + radiusX;
  const centerY = y + radiusY;
  const control = 0.5522847498307936;
  const controlX = radiusX * control;
  const controlY = radiusY * control;
  renderer.moveTo(centerX, y);
  renderer.bezierCurveTo(centerX + controlX, y, x + width, centerY - controlY, x + width, centerY);
  renderer.bezierCurveTo(
    x + width,
    centerY + controlY,
    centerX + controlX,
    y + height,
    centerX,
    y + height,
  );
  renderer.bezierCurveTo(centerX - controlX, y + height, x, centerY + controlY, x, centerY);
  renderer.bezierCurveTo(x, centerY - controlY, centerX - controlX, y, centerX, y);
  renderer.closePath();
}

class EditorRegion extends Entity {
  private pointerHandler: ((event: VectoJSEvent) => void) | null = null;
  private pointerListenerAttached = false;
  public constructor(
    id: string,
    private readonly attributes: A11yAttributes,
  ) {
    super(id);
  }

  public setFrame(x: number, y: number, width: number, height: number, interactive: boolean): void {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
    this.interactive = interactive;
  }

  public setPointerHandler(handler: ((event: VectoJSEvent) => void) | null): void {
    this.pointerHandler = handler;
    if (handler !== null && !this.pointerListenerAttached) {
      this.pointerListenerAttached = true;
      for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'] as const) {
        this.on(type, (event) => this.pointerHandler?.(event));
      }
    }
  }

  public override getA11yAttributes(): A11yAttributes {
    return this.attributes;
  }

  public override isPointInside(globalX: number, globalY: number): boolean {
    if (!this.interactive || this.pointerHandler === null) return false;
    const local = this.worldToLocal(globalX, globalY);
    return (
      local !== null &&
      local.x >= 0 &&
      local.x <= this.width &&
      local.y >= 0 &&
      local.y <= this.height
    );
  }

  public override render(_renderer: IRenderer): void {}
}

export type CreationTool = 'frame' | 'rectangle' | 'ellipse' | 'text';
type CanvasTool = 'select' | CreationTool;

type NativePointerSnapshot = Readonly<{
  pointerId: number;
  button: number;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}>;

type NativePointerSource = Readonly<{
  pointerId?: number;
  button?: number;
  shiftKey?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}>;

type NativePointerFailure = Readonly<{
  ok: false;
  error: BringsError;
  pointerId: number | null;
}>;

type NativePointerHeadResult =
  | Readonly<{
      ok: true;
      value: Readonly<{ source: NativePointerSource; pointerId: number }>;
    }>
  | NativePointerFailure;

type NativePointerSnapshotResult =
  Readonly<{ ok: true; value: NativePointerSnapshot }> | NativePointerFailure;

type IdleEditorInteractionSnapshot = Readonly<{
  phase: 'idle';
  terminalEffect: null;
  pointerId: null;
  shiftKey: null;
  start: null;
  current: null;
  visual: null;
}>;

type SelectionEditorInteractionSnapshot = Readonly<{
  phase: SelectionGestureSessionSnapshot['phase'];
  terminalEffect: SelectionGestureSessionSnapshot['terminalEffect'];
  pointerId: number | null;
  shiftKey: boolean | null;
  start: SelectionGestureSessionSnapshot['start'] | null;
  current: SelectionGestureSessionSnapshot['current'] | null;
  visual: SelectionGestureVisual | null;
}>;

type ResizeEditorInteractionSnapshot = Readonly<{
  phase: ResizeSelectionSessionSnapshot['phase'];
  terminalEffect: ResizeSelectionSessionSnapshot['terminalEffect'];
  pointerId: number;
  handle: ResizeHandle;
  shiftKey: boolean;
  altKey: boolean;
  start: null;
  current: null;
  resizeStart: ResizePoint;
  resizeCurrent: ResizePoint;
  anchor: ResizePoint | null;
  bounds: ResizeBounds;
  visual: SelectionGestureVisual | null;
}>;

type CreationEditorInteractionSnapshot = Readonly<{
  phase: CreationGestureSessionSnapshot['phase'];
  terminalEffect: CreationGestureSessionSnapshot['terminalEffect'];
  pointerId: number;
  shiftKey: boolean;
  altKey: boolean;
  start: CreationGestureSessionSnapshot['start'];
  current: CreationGestureSessionSnapshot['current'];
  tool: CreationShapeTool;
  bounds: CreationBounds;
  visual: null;
  creationVisual: CreationGestureVisual | null;
}>;

/** Fresh JSON-safe diagnostic state exposed only through the debug reader. */
export type EditorInteractionSnapshot =
  | IdleEditorInteractionSnapshot
  | SelectionEditorInteractionSnapshot
  | ResizeEditorInteractionSnapshot
  | CreationEditorInteractionSnapshot;

function pointerInvalid(path: string, pointerId: number | null): NativePointerFailure {
  return Object.freeze({
    ok: false,
    error: Object.freeze({ code: 'interaction.pointer-invalid', path }),
    pointerId,
  });
}

function snapshotPosition(
  position: SelectionGestureSessionSnapshot['start'],
): SelectionGestureSessionSnapshot['start'] {
  return Object.freeze({
    viewport: Object.freeze({ x: position.viewport.x, y: position.viewport.y }),
    page: Object.freeze({ x: position.page.x, y: position.page.y }),
  });
}

function snapshotSession(
  session: SelectionGestureSessionSnapshot,
): SelectionGestureSessionSnapshot {
  return Object.freeze({
    phase: session.phase,
    terminalEffect: session.terminalEffect,
    pointerId: session.pointerId,
    shiftKey: session.shiftKey,
    start: snapshotPosition(session.start),
    current: snapshotPosition(session.current),
  });
}

function snapshotResizeSession(
  session: ResizeSelectionSessionSnapshot,
  visual: SelectionGestureVisual | null,
): ResizeEditorInteractionSnapshot {
  return Object.freeze({
    phase: session.phase,
    terminalEffect: session.terminalEffect,
    pointerId: session.pointerId,
    handle: session.handle,
    shiftKey: session.shiftKey,
    altKey: session.altKey,
    start: null,
    current: null,
    resizeStart: Object.freeze({ x: session.start.x, y: session.start.y }),
    resizeCurrent: Object.freeze({ x: session.current.x, y: session.current.y }),
    anchor:
      session.anchor === null ? null : Object.freeze({ x: session.anchor.x, y: session.anchor.y }),
    bounds: Object.freeze({
      minX: session.bounds.minX,
      minY: session.bounds.minY,
      maxX: session.bounds.maxX,
      maxY: session.bounds.maxY,
    }),
    visual: snapshotVisual(visual),
  });
}

function snapshotCreationVisual(
  visual: CreationGestureVisual | null,
): CreationGestureVisual | null {
  return visual === null
    ? null
    : Object.freeze({
        tool: visual.tool,
        bounds: Object.freeze({ ...visual.bounds }),
      });
}

function snapshotCreationSession(
  session: CreationGestureSessionSnapshot,
  visual: CreationGestureVisual | null,
): CreationEditorInteractionSnapshot {
  return Object.freeze({
    phase: session.phase,
    terminalEffect: session.terminalEffect,
    pointerId: session.pointerId,
    shiftKey: session.shiftKey,
    altKey: session.altKey,
    start: Object.freeze({
      viewport: Object.freeze({ ...session.start.viewport }),
      page: Object.freeze({ ...session.start.page }),
    }),
    current: Object.freeze({
      viewport: Object.freeze({ ...session.current.viewport }),
      page: Object.freeze({ ...session.current.page }),
    }),
    tool: session.tool,
    bounds: Object.freeze({ ...session.bounds }),
    visual: null,
    creationVisual: snapshotCreationVisual(visual),
  });
}

function snapshotVisual(visual: SelectionGestureVisual | null): SelectionGestureVisual | null {
  if (visual === null) return null;
  const marquee = visual.marquee;
  const movementDelta = visual.movementDelta;
  const resize = visual.resize;
  const guides = visual.guides;
  const detachedGuides =
    guides === undefined
      ? undefined
      : Object.freeze(
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
  const selection = Object.freeze({
    nodeIds: Object.freeze([...visual.selection.nodeIds]),
    activeNodeId: visual.selection.activeNodeId,
  });
  if (resize !== undefined) {
    const detachedResize: SelectionResizeProposal = Object.freeze({
      handle: resize.handle,
      anchor: Object.freeze({ x: resize.anchor.x, y: resize.anchor.y }),
      scaleX: resize.scaleX,
      scaleY: resize.scaleY,
      bounds: Object.freeze({ ...resize.bounds }),
      command: Object.freeze({
        kind: resize.command.kind,
        nodeIds: Object.freeze([...resize.command.nodeIds]),
        delta: Object.freeze([...resize.command.delta]) as Matrix,
      }),
    });
    return Object.freeze({
      selection,
      marquee: null,
      movementDelta: null,
      resize: detachedResize,
      ...(detachedGuides === undefined ? {} : { guides: detachedGuides }),
    });
  }
  if (movementDelta !== null) {
    return Object.freeze({
      selection,
      marquee: null,
      movementDelta: Object.freeze({ x: movementDelta.x, y: movementDelta.y }) as PageDelta,
      ...(detachedGuides === undefined ? {} : { guides: detachedGuides }),
    });
  }
  return Object.freeze({
    selection,
    marquee:
      marquee === null
        ? null
        : Object.freeze({
            x: marquee.x,
            y: marquee.y,
            width: marquee.width,
            height: marquee.height,
          }),
    movementDelta: null,
    ...(detachedGuides === undefined ? {} : { guides: detachedGuides }),
  });
}

export interface EditorShellPorts {
  readonly documentSnapshot?: () => EditorSnapshot;
  /** Select a layer without introducing an undoable document change. */
  readonly selectLayer?: (
    nodeIds: readonly string[],
    activeNodeId: string | null,
  ) => Result<EditorSnapshot>;
  /** Toggle visibility for one row without selecting it first. */
  readonly setLayerVisibility?: (nodeId: string) => Result<EditorSnapshot>;
  readonly setSelectionProperties?: (patch: NodePropertyPatchInput) => Result<EditorSnapshot>;
  readonly createAt?: (tool: CreationTool, x: number, y: number) => Result<EditorSnapshot>;
  readonly createInBounds?: (
    tool: CreationShapeTool,
    bounds: CreationBounds,
  ) => Result<EditorSnapshot>;
  readonly beginSelectionInteraction?: () => SelectionInteractionStart;
  readonly proposePointSelection?: SelectionProposalProvider['point'];
  readonly proposeAreaSelection?: SelectionProposalProvider['area'];
  readonly proposeMove?: SelectionProposalProvider['move'];
  readonly commitSelection?: (proposal: SelectionProposal) => Result<EditorSnapshot>;
  readonly commitMove?: (
    input: Readonly<{
      proposal: SelectionProposal;
      delta: PageDelta;
      alignment?: MoveInteractionProposal;
    }>,
  ) => Result<EditorSnapshot>;
  readonly beginResizeInteraction?: () => Result<ResizeInteractionStart>;
  readonly proposeResize?: (
    input: Readonly<{
      start: ResizeInteractionStart;
      input: Parameters<ResizeProposalProvider['resize']>[1];
    }>,
  ) => Result<ResizeInteractionProposal>;
  readonly commitResize?: (proposal: ResizeInteractionProposal) => Result<EditorSnapshot>;
  readonly reportInteractionError?: (error: BringsError) => void;
  readonly runHistory?: (action: 'undo' | 'redo') => Result<EditorSnapshot>;
  readonly deleteSelection?: () => Result<EditorSnapshot>;
  readonly groupSelection?: () => Result<EditorSnapshot>;
  readonly ungroupSelection?: () => Result<EditorSnapshot>;
}

type ResolvedEditorShellPorts = Readonly<{
  documentSnapshot: () => EditorSnapshot;
  selectLayer: (nodeIds: readonly string[], activeNodeId: string | null) => Result<EditorSnapshot>;
  setLayerVisibility: (nodeId: string) => Result<EditorSnapshot>;
  setSelectionProperties: (patch: NodePropertyPatchInput) => Result<EditorSnapshot>;
  createAt: (tool: CreationTool, x: number, y: number) => Result<EditorSnapshot>;
  createInBounds: (tool: CreationShapeTool, bounds: CreationBounds) => Result<EditorSnapshot>;
  beginSelectionInteraction: () => SelectionInteractionStart;
  proposePointSelection: SelectionProposalProvider['point'];
  proposeAreaSelection: SelectionProposalProvider['area'];
  proposeMove: NonNullable<SelectionProposalProvider['move']>;
  commitSelection: (proposal: SelectionProposal) => Result<EditorSnapshot>;
  commitMove: (
    input: Readonly<{
      proposal: SelectionProposal;
      delta: PageDelta;
      alignment?: MoveInteractionProposal;
    }>,
  ) => Result<EditorSnapshot>;
  beginResizeInteraction: () => Result<ResizeInteractionStart>;
  proposeResize: (
    input: Readonly<{
      start: ResizeInteractionStart;
      input: Parameters<ResizeProposalProvider['resize']>[1];
    }>,
  ) => Result<ResizeInteractionProposal>;
  commitResize: (proposal: ResizeInteractionProposal) => Result<EditorSnapshot>;
  reportInteractionError: (error: BringsError) => void;
  runHistory: (action: 'undo' | 'redo') => Result<EditorSnapshot>;
  deleteSelection: () => Result<EditorSnapshot>;
  groupSelection: () => Result<EditorSnapshot>;
  ungroupSelection: () => Result<EditorSnapshot>;
}>;

const DEFAULT_DOCUMENT_SNAPSHOT = (): EditorSnapshot => ({
  document: {
    id: '00000000-0000-4000-8000-000000000000' as EditorSnapshot['document']['id'],
    revision: 0,
    name: 'Untitled',
    pageOrder: [],
    activePageId:
      '00000000-0000-4000-8000-000000000000' as EditorSnapshot['document']['activePageId'],
    pages: [],
    nodes: [],
  },
  selection: { nodeIds: [], activeNodeId: null },
  undoDepth: 0,
  redoDepth: 0,
});

function unavailable(code: string): Result<never> {
  return { ok: false, error: { code, path: '/' } };
}

const DEFAULT_EDITOR_SHELL_PORTS: Omit<
  ResolvedEditorShellPorts,
  'documentSnapshot' | 'beginSelectionInteraction'
> = {
  selectLayer: () => unavailable('layer.selection-unavailable'),
  setLayerVisibility: () => unavailable('layer.visibility-unavailable'),
  setSelectionProperties: () => unavailable('properties.unavailable'),
  createAt: () => unavailable('shape.unavailable'),
  createInBounds: () => unavailable('shape.unavailable'),
  proposePointSelection: () => unavailable('selection.unavailable'),
  proposeAreaSelection: () => unavailable('selection.unavailable'),
  proposeMove: (_start, proposal, delta) => ({
    ok: true,
    value: Object.freeze({
      token: Object.freeze({ ...proposal.token }),
      selection: Object.freeze({
        nodeIds: Object.freeze([...proposal.selection.nodeIds]),
        activeNodeId: proposal.selection.activeNodeId,
      }),
      rawDelta: Object.freeze({ x: delta.x, y: delta.y }) as PageDelta,
      delta: Object.freeze({ x: delta.x, y: delta.y }) as PageDelta,
      guides: Object.freeze([]),
    }),
  }),
  commitSelection: () => unavailable('selection.unavailable'),
  commitMove: () => unavailable('transform.unavailable'),
  beginResizeInteraction: () => unavailable('resize.unavailable'),
  proposeResize: () => unavailable('resize.unavailable'),
  commitResize: () => unavailable('resize.unavailable'),
  reportInteractionError: () => undefined,
  runHistory: () => unavailable('history.unavailable'),
  deleteSelection: () => unavailable('selection.delete-unavailable'),
  groupSelection: () => unavailable('selection.group-unavailable'),
  ungroupSelection: () => unavailable('selection.ungroup-unavailable'),
};

function resolveEditorShellPorts(ports: EditorShellPorts): ResolvedEditorShellPorts {
  const documentSnapshot = ports.documentSnapshot ?? DEFAULT_DOCUMENT_SNAPSHOT;
  return {
    documentSnapshot,
    selectLayer: ports.selectLayer ?? DEFAULT_EDITOR_SHELL_PORTS.selectLayer,
    setLayerVisibility: ports.setLayerVisibility ?? DEFAULT_EDITOR_SHELL_PORTS.setLayerVisibility,
    setSelectionProperties:
      ports.setSelectionProperties ?? DEFAULT_EDITOR_SHELL_PORTS.setSelectionProperties,
    createAt: ports.createAt ?? DEFAULT_EDITOR_SHELL_PORTS.createAt,
    createInBounds: ports.createInBounds ?? DEFAULT_EDITOR_SHELL_PORTS.createInBounds,
    beginSelectionInteraction:
      ports.beginSelectionInteraction ??
      (() => {
        const snapshot = documentSnapshot();
        return {
          token: { documentRevision: snapshot.document.revision, selectionGeneration: 0 },
          selection: {
            nodeIds: [...snapshot.selection.nodeIds],
            activeNodeId: snapshot.selection.activeNodeId,
          },
        };
      }),
    proposePointSelection:
      ports.proposePointSelection ?? DEFAULT_EDITOR_SHELL_PORTS.proposePointSelection,
    proposeAreaSelection:
      ports.proposeAreaSelection ?? DEFAULT_EDITOR_SHELL_PORTS.proposeAreaSelection,
    proposeMove: ports.proposeMove ?? DEFAULT_EDITOR_SHELL_PORTS.proposeMove,
    commitSelection: ports.commitSelection ?? DEFAULT_EDITOR_SHELL_PORTS.commitSelection,
    commitMove: ports.commitMove ?? DEFAULT_EDITOR_SHELL_PORTS.commitMove,
    beginResizeInteraction:
      ports.beginResizeInteraction ?? DEFAULT_EDITOR_SHELL_PORTS.beginResizeInteraction,
    proposeResize: ports.proposeResize ?? DEFAULT_EDITOR_SHELL_PORTS.proposeResize,
    commitResize: ports.commitResize ?? DEFAULT_EDITOR_SHELL_PORTS.commitResize,
    reportInteractionError:
      ports.reportInteractionError ?? DEFAULT_EDITOR_SHELL_PORTS.reportInteractionError,
    runHistory: ports.runHistory ?? DEFAULT_EDITOR_SHELL_PORTS.runHistory,
    deleteSelection: ports.deleteSelection ?? DEFAULT_EDITOR_SHELL_PORTS.deleteSelection,
    groupSelection: ports.groupSelection ?? DEFAULT_EDITOR_SHELL_PORTS.groupSelection,
    ungroupSelection: ports.ungroupSelection ?? DEFAULT_EDITOR_SHELL_PORTS.ungroupSelection,
  };
}

/** A compact Figma-style row; all changes remain routed through the controller ports. */
class LayerRow extends Entity {
  private item: BringsLayerItem | null = null;

  public constructor(
    id: string,
    private readonly onSelect: (nodeId: NodeId) => Result<EditorSnapshot>,
    private readonly onToggleVisibility: (nodeId: NodeId) => Result<EditorSnapshot>,
    private readonly markDirty: () => void,
  ) {
    super(id);
    this.interactive = true;
    this.on('pointerdown', (event) => this.routePointerDown(event));
  }

  public setLayer(item: BringsLayerItem, x: number, y: number, width: number): void {
    this.item = item;
    this.x = x;
    this.y = y;
    this.width = Math.max(0, width);
    this.height = 26;
  }

  public override getA11yAttributes(): A11yAttributes {
    const item = this.item;
    if (item === null) return { role: 'button', label: 'Layer' };
    return {
      role: 'button',
      label: `${item.name} layer${item.selected ? ' selected' : ''}`,
    };
  }

  public override getContentProjection(): ContentProjection | null {
    const item = this.item;
    return item === null ? null : { text: item.name, font: '500 12px system-ui, sans-serif' };
  }

  public override isPointInside(globalX: number, globalY: number): boolean {
    const local = this.worldToLocal(globalX, globalY);
    return (
      local !== null &&
      local.x >= 0 &&
      local.x <= this.width &&
      local.y >= 0 &&
      local.y <= this.height
    );
  }

  public override render(renderer: IRenderer): void {
    const item = this.item;
    if (item === null) return;
    if (item.selected) {
      renderer.beginPath();
      renderer.roundRect(0, 1, this.width, this.height - 2, 4);
      renderer.fill('#385a98');
    }
    const glyph =
      item.type === 'frame'
        ? '□'
        : item.type === 'group'
          ? '◇'
          : item.type === 'ellipse'
            ? '○'
            : item.type === 'text'
              ? 'T'
              : '◆';
    renderer.fillText(glyph, 6, 17, '600 11px system-ui, sans-serif', '#aebed6');
    renderer.fillText(item.name, 24, 17, '500 12px system-ui, sans-serif', '#f3f6fb');
    if (item.locked)
      renderer.fillText('▣', this.width - 38, 17, '500 11px system-ui, sans-serif', '#cbd5e1');
    renderer.fillText(
      item.visible ? '◉' : '○',
      this.width - 18,
      17,
      '500 11px system-ui, sans-serif',
      '#cbd5e1',
    );
  }

  private routePointerDown(event: VectoJSEvent): void {
    const item = this.item;
    if (item === null) return;
    event.preventDefault();
    event.stopPropagation();
    const result =
      (event.localX ?? 0) >= this.width - 26
        ? this.onToggleVisibility(item.id)
        : this.onSelect(item.id);
    if (result.ok) this.markDirty();
  }
}

class PropertyToggle extends Entity {
  public checked = false;

  public constructor(
    id: string,
    private readonly label: string,
    private readonly onChange: (checked: boolean) => void,
  ) {
    super(id);
    this.width = 90;
    this.height = 18;
    this.interactive = true;
    this.on('pointerdown', (event) => {
      event.preventDefault();
      this.onChange(!this.checked);
    });
  }

  public override getA11yAttributes(): A11yAttributes {
    return { role: 'switch', label: this.label, checked: this.checked };
  }

  public override isPointInside(globalX: number, globalY: number): boolean {
    const local = this.worldToLocal(globalX, globalY);
    return (
      local !== null &&
      local.x >= 0 &&
      local.x <= this.width &&
      local.y >= 0 &&
      local.y <= this.height
    );
  }

  public override render(renderer: IRenderer): void {
    renderer.fillText(this.label, 0, 14, '500 12px system-ui, sans-serif', '#dbe5f3');
    renderer.beginPath();
    renderer.roundRect(56, 0, 34, 18, 9);
    renderer.fill(this.checked ? '#4f7dd4' : '#465268');
    renderer.beginPath();
    renderer.roundRect(this.checked ? 74 : 58, 2, 14, 14, 7);
    renderer.fill('#f8fafc');
  }
}

/**
 * The first canvas-native Brings surface. It owns explicit numeric panel bounds;
 * later tools reconcile document entities below the `canvasRegion` seam.
 */
export class EditorShell extends Entity {
  private readonly fileBar = new EditorRegion('brings-file-bar', {
    role: 'toolbar',
    label: 'Document controls',
  });
  private readonly layers = new EditorRegion('brings-layers', {
    role: 'tree',
    label: 'Layers',
  });
  private readonly canvasRegion = new EditorRegion('brings-canvas-region', {
    role: 'region',
    label: 'Design canvas',
    tabIndex: 0,
  });
  private readonly properties = new EditorRegion('brings-properties', {
    role: 'group',
    label: 'Properties',
  });
  private readonly toolDock = new EditorRegion('brings-tool-dock', {
    role: 'toolbar',
    label: 'Creation tools',
  });
  private readonly fileBarSurface = new Rect({
    fill: '#18191e',
    stroke: '#2d2f36',
    strokeWidth: 1,
  }).set({ id: 'brings-file-bar-surface' });
  private readonly toolDockSurface = new Rect({
    fill: '#202126',
    stroke: '#3c3e47',
    strokeWidth: 1,
    radius: 13,
  }).set({ id: 'brings-tool-dock-surface' });
  private readonly mobileModeNotice = new MobileModeNotice('brings-mobile-mode-notice');
  private readonly title = new CanvasLabel(
    'brings-title',
    'Brings',
    '600 18px system-ui, sans-serif',
    '#ecfdf5',
  );
  private readonly documentNameLabel = new CanvasLabel(
    'brings-document-name',
    'Untitled',
    '500 12px system-ui, sans-serif',
    '#f4f4f6',
  );
  private readonly localStatusLabel = new CanvasLabel(
    'brings-local-status',
    'Saved locally',
    '500 11px system-ui, sans-serif',
    '#9b91ff',
  );
  private readonly pagesLabel = new CanvasLabel(
    'brings-pages-label',
    'Pages',
    '600 12px system-ui, sans-serif',
    '#e5e7eb',
  );
  private readonly layersLabel = new CanvasLabel(
    'brings-layers-label',
    'Layers',
    '600 12px system-ui, sans-serif',
    '#e5e7eb',
  );
  private readonly layersTabIndicator = new Rect({ width: 44, height: 2, fill: '#766bf1' }).set({
    id: 'brings-layers-tab-indicator',
  });
  private readonly activePageLabel = new CanvasLabel(
    'brings-active-page',
    'Page 1',
    '500 12px system-ui, sans-serif',
    '#c8cad1',
  );
  private readonly propertiesLabel = new CanvasLabel(
    'brings-properties-label',
    'Design',
    '600 12px system-ui, sans-serif',
    '#e5e7eb',
  );
  private readonly positionLabel = new CanvasLabel(
    'brings-position-label',
    'Position',
    '600 11px system-ui, sans-serif',
    '#aeb2bd',
  );
  private readonly appearanceLabel = new CanvasLabel(
    'brings-appearance-label',
    'Appearance',
    '600 11px system-ui, sans-serif',
    '#aeb2bd',
  );
  private readonly propertiesEmptyLabel = new CanvasLabel(
    'brings-properties-empty',
    'Select an object to edit properties',
    '500 11px system-ui, sans-serif',
    '#7f838e',
  );
  private readonly workspaceLabel = new CanvasLabel(
    'brings-workspace-label',
    'Local-first design workspace',
    '500 16px system-ui, sans-serif',
    '#334155',
  );
  private readonly mobileModeLabel = new CanvasLabel(
    'brings-mobile-mode-label',
    'View and navigation mode',
    '500 12px system-ui, sans-serif',
    '#475569',
  );
  private readonly selectTool = new ToolbarButton('brings-select-tool', 'Select', '↖', () => {
    this.activateTool('select');
  });
  private readonly frameTool = new ToolbarButton('brings-frame-tool', 'Frame', '⌗', () => {
    this.activateTool('frame');
  });
  private readonly rectangleTool = new ToolbarButton(
    'brings-rectangle-tool',
    'Rectangle',
    '□',
    () => {
      this.activateTool('rectangle');
    },
  );
  private readonly ellipseTool = new ToolbarButton('brings-ellipse-tool', 'Ellipse', '○', () => {
    this.activateTool('ellipse');
  });
  private readonly textTool = new ToolbarButton('brings-text-tool', 'Text', 'T', () => {
    this.activateTool('text');
  });
  private readonly zoomOutTool = new ToolbarButton('brings-zoom-out', 'Zoom out', '−', () => {
    this.zoomCamera(1 / 1.2);
  });
  private readonly zoomInTool = new ToolbarButton('brings-zoom-in', 'Zoom in', '+', () => {
    this.zoomCamera(1.2);
  });
  private readonly zoomReadout = new ZoomReadout();
  private readonly undoButton = new ToolbarButton('brings-undo', 'Undo', '↶', () => {
    this.runHistoryFromChrome('undo');
  });
  private readonly redoButton = new ToolbarButton('brings-redo', 'Redo', '↷', () => {
    this.runHistoryFromChrome('redo');
  });
  private readonly toolControls = new Group(
    this.selectTool,
    this.frameTool,
    this.rectangleTool,
    this.ellipseTool,
    this.textTool,
    this.zoomOutTool,
    this.zoomReadout,
    this.zoomInTool,
  ).set({ id: 'brings-tool-controls' });
  private readonly historyControls = new Group(this.undoButton, this.redoButton).set({
    id: 'brings-history-controls',
  });
  private readonly layerRows = new Map<NodeId, LayerRow>();
  private layerSignature = '';
  private readonly nameInput: Input;
  private readonly opacityInput: Input;
  private readonly widthInput: Input;
  private readonly heightInput: Input;
  private readonly contentInput: Input;
  private readonly visibleToggle: PropertyToggle;
  private readonly lockedToggle: PropertyToggle;
  private propertySignature = '';
  private activeDrawer: DrawerSide | null = null;
  private activeTool: CanvasTool = 'select';
  private selectionSession: MarqueeSelectionSession | null = null;
  private selectionPointerId: number | null = null;
  private resizeSession: ResizeSelectionSession | null = null;
  private resizePointerId: number | null = null;
  private resizeInteraction: CapturedResizeInteraction | null = null;
  private creationSession: CreationGestureSession | null = null;
  private creationPointerId: number | null = null;
  private creationVisual: CreationGestureVisual | null = null;
  private terminalInteraction:
    | SelectionGestureSessionSnapshot
    | ResizeSelectionSessionSnapshot
    | CreationGestureSessionSnapshot
    | null = null;
  private pointerRouteVersion = 0;
  private readonly quarantinedPointerIds = new Set<number>();
  private readonly reportedRenderErrors = new Set<string>();
  private layout: EditorLayout;
  private readonly ports: ResolvedEditorShellPorts;
  private readonly selectionProvider: SelectionProposalProvider;
  private readonly resizeProvider: ResizeProposalProvider;
  private readonly selectionInterpreter: SelectionGestureInterpreter;
  private camera = createCameraViewport({ width: 1, height: 1 });
  private cameraHasMeasuredViewport = false;
  private cameraPointerId: number | null = null;
  private cameraLastViewportPoint: Readonly<{ x: number; y: number }> | null = null;
  private spacePanHeld = false;

  public constructor(width = 1, height = 1, ports: EditorShellPorts = {}) {
    super('brings-editor-shell');
    this.ports = resolveEditorShellPorts(ports);
    this.nameInput = this.createPropertyInput('brings-property-name', 'Name');
    this.opacityInput = this.createPropertyInput('brings-property-opacity', 'Opacity');
    this.widthInput = this.createPropertyInput('brings-property-width', 'Width');
    this.heightInput = this.createPropertyInput('brings-property-height', 'Height');
    this.contentInput = this.createPropertyInput('brings-property-content', 'Text content');
    this.visibleToggle = this.createPropertyToggle('brings-property-visible', 'Visible', 'visible');
    this.lockedToggle = this.createPropertyToggle('brings-property-locked', 'Locked', 'locked');
    this.selectionProvider = {
      point: (start, point, mode) => this.ports.proposePointSelection(start, point, mode),
      area: (start, rect, mode) => this.ports.proposeAreaSelection(start, rect, mode),
      move: (start, proposal, delta) => this.ports.proposeMove(start, proposal, delta),
    };
    this.resizeProvider = {
      resize: (start, input) => this.ports.proposeResize({ start, input }),
    };
    this.selectionInterpreter = new SelectionGestureInterpreter({
      commitSelection: (proposal) => this.refreshAfter(this.ports.commitSelection(proposal)),
      commitMove: (input) => this.refreshAfter(this.ports.commitMove(input)),
      commitResize: (proposal) => this.refreshAfter(this.ports.commitResize(proposal)),
      reportInteractionError: (error) => this.ports.reportInteractionError(error),
      markDirty: () => this.scene?.markDirty(),
    });
    this.interactive = true;
    this.add(this.fileBar, this.layers, this.canvasRegion, this.properties, this.toolDock);
    this.fileBar.add(
      this.fileBarSurface,
      this.title,
      this.documentNameLabel,
      this.localStatusLabel,
      this.historyControls,
    );
    this.layers.add(
      this.pagesLabel,
      this.layersLabel,
      this.layersTabIndicator,
      this.activePageLabel,
    );
    this.canvasRegion.add(this.workspaceLabel, this.mobileModeLabel, this.mobileModeNotice);
    this.properties.add(
      this.propertiesLabel,
      this.positionLabel,
      this.appearanceLabel,
      this.propertiesEmptyLabel,
      this.nameInput,
      this.opacityInput,
      this.widthInput,
      this.heightInput,
      this.contentInput,
      this.visibleToggle,
      this.lockedToggle,
    );
    this.toolDock.add(this.toolDockSurface, this.toolControls);
    this.canvasRegion.on('keydown', (event) => this.routeEditorShortcut(event));
    this.canvasRegion.on('keyup', (event) => this.routeCameraKeyUp(event));
    this.canvasRegion.on('blur', () => {
      this.spacePanHeld = false;
    });
    // A panel must participate in hit testing so its interactive row descendants can own events.
    this.layers.setPointerHandler(() => undefined);
    this.fileBar.setPointerHandler(() => undefined);
    this.toolDock.setPointerHandler(() => undefined);
    this.layout = resolveEditorLayout(width, height);
    this.camera = createCameraViewport(this.cameraViewportSize());
    this.cameraHasMeasuredViewport = this.hasMeasuredViewport();
    this.canvasRegion.setPointerHandler((event) => this.routeCanvasPointer(event));
    this.canvasRegion.on('wheel', (event) => this.routeCanvasWheel(event));
    this.resize(width, height);
    this.syncLayerRows();
    this.syncProperties();
  }

  /** True while the narrow-screen shell supports editing tools. */
  public get authoringEnabled(): boolean {
    return this.width >= 600;
  }

  /** Read a fresh detached interaction snapshot without exposing mutation controls. */
  public interactionSnapshot(): EditorInteractionSnapshot {
    const activeCreation = this.creationSession?.snapshot();
    if (activeCreation !== undefined) {
      return snapshotCreationSession(activeCreation, this.creationVisual);
    }
    const activeResize = this.resizeSession?.snapshot();
    if (activeResize !== undefined) {
      return snapshotResizeSession(activeResize, this.selectionInterpreter.visual);
    }
    const source = this.selectionSession?.snapshot() ?? this.terminalInteraction;
    if (source === null) {
      return Object.freeze({
        phase: 'idle',
        terminalEffect: null,
        pointerId: null,
        shiftKey: null,
        start: null,
        current: null,
        visual: null,
      });
    }
    if ('tool' in source) {
      return snapshotCreationSession(source, null);
    }
    if ('handle' in source) {
      return snapshotResizeSession(source, this.selectionInterpreter.visual);
    }
    const session = snapshotSession(source);
    return Object.freeze({
      phase: session.phase,
      terminalEffect: session.terminalEffect,
      pointerId: session.pointerId,
      shiftKey: session.shiftKey,
      start: session.start,
      current: session.current,
      visual: snapshotVisual(this.selectionInterpreter.visual),
    });
  }

  /** Read detached camera state for debugging and deterministic browser verification. */
  public cameraSnapshot(): Readonly<{ center: Readonly<{ x: number; y: number }>; zoom: number }> {
    return Object.freeze({
      center: Object.freeze({ x: this.camera.state.center.x, y: this.camera.state.center.y }),
      zoom: this.camera.state.zoom,
    });
  }

  public openDrawer(side: DrawerSide): boolean {
    const panel = side === 'left' ? this.layout.leftPanel : this.layout.rightPanel;
    if (panel.mode !== 'drawer') return false;

    this.activeDrawer = side;
    this.applyLayout();
    this.scene?.markDirty();
    return true;
  }

  public closeDrawer(): boolean {
    if (!this.activeDrawer) return false;
    this.activeDrawer = null;
    this.applyLayout();
    this.scene?.markDirty();
    return true;
  }

  public resize(width: number, height: number): void {
    if (this.authoringEnabled && width < 600) {
      if (this.creationSession !== null) {
        const session = this.creationSession;
        const pointerId = this.creationPointerId;
        const effect = session.cancel({ kind: 'authoring-disabled' });
        this.closeCreationSession(session);
        if (pointerId !== null) this.quarantinedPointerIds.add(pointerId);
        this.applyCreationEffect(effect);
      } else if (this.resizeSession !== null) {
        const session = this.resizeSession;
        const pointerId = this.resizePointerId;
        const effect = session.cancel({ kind: 'escape' });
        this.closeResizeSession(session);
        if (pointerId !== null) this.quarantinedPointerIds.add(pointerId);
        this.selectionInterpreter.apply(effect);
      }
    }
    this.width = width;
    this.height = height;
    this.layout = resolveEditorLayout(width, height);
    this.camera = createCameraViewport(
      this.cameraViewportSize(),
      this.cameraHasMeasuredViewport ? this.camera.state : undefined,
    );
    this.cameraHasMeasuredViewport ||= this.hasMeasuredViewport();

    if (this.activeDrawer) {
      const activePanel =
        this.activeDrawer === 'left' ? this.layout.leftPanel : this.layout.rightPanel;
      if (activePanel.mode !== 'drawer') this.activeDrawer = null;
    }

    this.applyLayout();
  }

  public override getA11yAttributes(): A11yAttributes {
    return { role: 'application', label: 'Brings design editor' };
  }

  public override isPointInside(): boolean {
    return false;
  }

  public override render(renderer: IRenderer): void {
    this.syncDocumentChrome();
    this.syncLayerRows();
    this.syncProperties();
    const { viewport } = this.layout;

    renderer.beginPath();
    renderer.roundRect(0, 0, this.width, this.height, 0);
    renderer.fill('#b8bbc1');

    renderer.beginPath();
    renderer.roundRect(viewport.x, viewport.y, viewport.width, viewport.height, 0);
    renderer.fill('#b8bbc1');
    this.renderDocument(renderer, viewport.x, viewport.y);

    this.renderPanel(renderer, this.layers);
    this.renderPanel(renderer, this.properties);
  }

  private applyLayout(): void {
    const { fileBarHeight, leftPanel, rightPanel, viewport, toolDock } = this.layout;
    const contentHeight = Math.max(0, this.height - fileBarHeight);
    const leftWidth = Math.min(leftPanel.width, this.width);
    const rightWidth = Math.min(rightPanel.width, this.width);
    const leftOpen = leftPanel.mode === 'visible' || this.activeDrawer === 'left';
    const rightOpen = rightPanel.mode === 'visible' || this.activeDrawer === 'right';
    const snapshot = this.ports.documentSnapshot();
    this.syncDocumentChrome(snapshot);

    this.fileBar.setFrame(0, 0, this.width, Math.min(fileBarHeight, this.height), true);
    this.fileBarSurface.set({ width: this.fileBar.width, height: this.fileBar.height });
    this.layers.setFrame(0, fileBarHeight, leftWidth, contentHeight, leftOpen);
    this.canvasRegion.setFrame(viewport.x, viewport.y, viewport.width, viewport.height, true);
    this.properties.setFrame(
      Math.max(0, this.width - rightWidth),
      fileBarHeight,
      rightWidth,
      contentHeight,
      rightOpen,
    );
    this.toolDock.setFrame(
      toolDock.x,
      toolDock.y,
      toolDock.width,
      toolDock.height,
      toolDock.width > 0,
    );
    this.toolDockSurface.set({ width: toolDock.width, height: toolDock.height });
    this.mobileModeNotice.setFrame(
      28,
      100,
      Math.max(0, viewport.width - 56),
      20,
      !this.authoringEnabled,
    );
    this.title.setFrame(20, 28, true);
    this.documentNameLabel.setFrame(120, 28, this.width >= 360);
    this.localStatusLabel.setFrame(240, 28, this.width >= 520);
    this.historyControls.set({ x: Math.max(0, this.width - 92), y: 6 });
    this.undoButton.setFrame(0, 0, 36, false, this.width >= 320, snapshot.undoDepth > 0);
    this.redoButton.setFrame(44, 0, 36, false, this.width >= 320, snapshot.redoDepth > 0);

    const authoring = toolDock.mode === 'authoring';
    this.toolControls.set({ x: 8, y: 6 });
    this.selectTool.setFrame(0, 0, 36, this.activeTool === 'select');
    this.frameTool.setFrame(44, 0, 36, this.activeTool === 'frame', authoring);
    this.rectangleTool.setFrame(88, 0, 36, this.activeTool === 'rectangle', authoring);
    this.ellipseTool.setFrame(132, 0, 36, this.activeTool === 'ellipse', authoring);
    this.textTool.setFrame(176, 0, 36, this.activeTool === 'text', authoring);
    const zoomStart = authoring ? 248 : 44;
    this.zoomOutTool.setFrame(zoomStart, 0, 36, false);
    this.zoomReadout.setFrame(zoomStart + 40, 0, true, this.camera.state.zoom);
    this.zoomInTool.setFrame(zoomStart + 116, 0, 36, false);

    this.pagesLabel.setFrame(20, 27, this.layers.interactive);
    this.layersLabel.setFrame(84, 27, this.layers.interactive);
    this.layersTabIndicator.set({
      x: 82,
      y: 48,
      width: this.layers.interactive ? 48 : 0,
      height: this.layers.interactive ? 2 : 0,
    });
    this.activePageLabel.setFrame(20, 70, this.layers.interactive);
    this.propertiesLabel.setFrame(20, 30, this.properties.interactive);
    this.workspaceLabel.setFrame(28, 40, true);
    this.mobileModeLabel.setFrame(28, 70, !this.authoringEnabled);

    if (!leftOpen) this.layers.setFrame(0, 0, 0, 0, false);
    if (!rightOpen) this.properties.setFrame(0, 0, 0, 0, false);
    this.layoutLayerRows();
    this.layoutProperties();
  }

  private syncDocumentChrome(snapshot = this.ports.documentSnapshot()): void {
    const activePage = snapshot.document.pages.find(
      (page) => page.id === snapshot.document.activePageId,
    );
    this.documentNameLabel.setText(snapshot.document.name);
    this.activePageLabel.setText(activePage?.name ?? 'No active page');
    this.undoButton.setEnabled(snapshot.undoDepth > 0);
    this.redoButton.setEnabled(snapshot.redoDepth > 0);
  }

  private syncLayerRows(): void {
    const items = this.deriveLayerItems(this.ports.documentSnapshot());
    const signature = items
      .map(
        (item) =>
          `${item.id}:${item.name}:${item.visible}:${item.locked}:${item.selected}:${item.depth}`,
      )
      .join('|');
    if (signature === this.layerSignature) return;
    this.layerSignature = signature;
    const wanted = new Set(items.map((item) => item.id));
    for (const [id, row] of this.layerRows) {
      if (wanted.has(id)) continue;
      this.layers.remove(row);
      this.layerRows.delete(id);
    }
    for (const item of items) {
      let row = this.layerRows.get(item.id);
      if (row === undefined) {
        row = new LayerRow(
          `brings-layer-${item.id}`,
          (nodeId) => this.ports.selectLayer([nodeId], nodeId),
          (nodeId) => this.ports.setLayerVisibility(nodeId),
          () => this.refreshDocumentState(),
        );
        this.layerRows.set(item.id, row);
        this.layers.add(row);
      }
    }
    this.layoutLayerRows(items);
  }

  private layoutLayerRows(items = this.deriveLayerItems(this.ports.documentSnapshot())): void {
    for (const [index, item] of items.entries()) {
      const row = this.layerRows.get(item.id);
      if (row === undefined) continue;
      row.setLayer(
        item,
        12 + item.depth * 16,
        96 + index * 28,
        this.layers.width - 24 - item.depth * 16,
      );
    }
  }

  private deriveLayerItems(snapshot: EditorSnapshot): readonly BringsLayerItem[] {
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
      layers.push({
        id: node.id,
        parentId: node.parentId,
        type: node.type,
        name: node.name,
        depth,
        visible: node.visible,
        locked: node.locked,
        selected: selected.has(node.id),
        hasChildren,
      });
      if (!hasChildren) return;
      for (const childId of node.childIds) visit(childId, depth + 1);
    };
    for (const rootId of page.rootNodeIds) visit(rootId, 0);
    return layers;
  }

  private createPropertyInput(id: string, placeholder: string): Input {
    const input = new Input({
      width: 200,
      height: 28,
      placeholder,
      font: '500 12px system-ui, sans-serif',
      bg: '#222936',
      border: '#3c4759',
      color: '#f8fafc',
      onChange: () => this.scene?.markDirty(),
    });
    input.id = id;
    input.on('keydown', (event: VectoJSEvent) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      this.commitPropertyInput(input);
    });
    input.on('blur', () => this.commitPropertyInput(input));
    return input;
  }

  private createPropertyToggle(
    id: string,
    label: string,
    property: 'visible' | 'locked',
  ): PropertyToggle {
    return new PropertyToggle(id, label, (checked) =>
      this.commitProperties({ [property]: checked }),
    );
  }

  private layoutProperties(): void {
    const visible = this.properties.interactive && this.propertySignature !== '';
    const width = Math.max(0, this.properties.width - 40);
    const setInput = (input: Input, y: number, show = visible): void => {
      input.x = 20;
      input.y = y;
      input.width = width;
      input.height = show ? 28 : 0;
      input.interactive = show;
      input.opacity = show ? 1 : 0;
    };
    this.positionLabel.setFrame(20, 92, visible);
    this.appearanceLabel.setFrame(20, 202, visible);
    this.propertiesEmptyLabel.setFrame(
      20,
      62,
      this.properties.interactive && this.propertySignature === '',
      width,
    );
    setInput(this.nameInput, 50);
    setInput(this.widthInput, 106, visible && this.widthInput.value !== '');
    setInput(this.heightInput, 142, visible && this.heightInput.value !== '');
    setInput(this.opacityInput, 216);
    setInput(this.contentInput, 300, visible && this.contentInput.value !== '');
    this.visibleToggle.x = 20;
    this.visibleToggle.y = 258;
    this.visibleToggle.interactive = visible;
    this.visibleToggle.opacity = visible ? 1 : 0;
    this.lockedToggle.x = 120;
    this.lockedToggle.y = 258;
    this.lockedToggle.interactive = visible;
    this.lockedToggle.opacity = visible ? 1 : 0;
  }

  private syncProperties(): void {
    const snapshot = this.ports.documentSnapshot();
    const activeId = snapshot.selection.activeNodeId;
    const node =
      activeId === null ? undefined : snapshot.document.nodes.find((item) => item.id === activeId);
    const signature =
      node === undefined
        ? ''
        : `${node.id}:${node.name}:${node.visible}:${node.locked}:${node.opacity}:${'width' in node ? node.width : ''}:${'height' in node ? node.height : ''}:${node.type === 'text' ? node.content : ''}`;
    if (signature === this.propertySignature) return;
    this.propertySignature = signature;
    this.nameInput.value = node?.name ?? '';
    this.opacityInput.value = node === undefined ? '' : String(Math.round(node.opacity * 100));
    this.widthInput.value = node !== undefined && 'width' in node ? String(node.width) : '';
    this.heightInput.value = node !== undefined && 'height' in node ? String(node.height) : '';
    this.contentInput.value = node?.type === 'text' ? node.content : '';
    this.visibleToggle.checked = node?.visible ?? false;
    this.lockedToggle.checked = node?.locked ?? false;
    this.layoutProperties();
  }

  private renderPanel(renderer: IRenderer, panel: EditorRegion): void {
    if (!panel.interactive) return;
    renderer.beginPath();
    renderer.roundRect(panel.x, panel.y, panel.width, panel.height, 0);
    renderer.fill('#1d1f24');
  }

  private commitPropertyInput(input: Input): void {
    if (input === this.nameInput) this.commitProperties({ name: input.value.trim() });
    else if (input === this.opacityInput)
      this.commitNumberProperty('opacity', input.value, 0, 100, 0.01);
    else if (input === this.widthInput)
      this.commitNumberProperty('width', input.value, 0, Number.MAX_SAFE_INTEGER, 1);
    else if (input === this.contentInput) this.commitProperties({ content: input.value });
    else this.commitNumberProperty('height', input.value, 0, Number.MAX_SAFE_INTEGER, 1);
  }

  private commitNumberProperty(
    property: 'opacity' | 'width' | 'height',
    value: string,
    minimum: number,
    maximum: number,
    scale: number,
  ): void {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) return;
    this.commitProperties({ [property]: parsed * scale });
  }

  private commitProperties(patch: NodePropertyPatchInput): void {
    const snapshot = this.ports.documentSnapshot();
    if (snapshot.selection.nodeIds.length === 0) return;
    const result = this.ports.setSelectionProperties(patch);
    if (result.ok) {
      this.refreshDocumentState();
    }
  }

  private renderDocument(renderer: IRenderer, originX: number, originY: number): void {
    const snapshot = this.ports.documentSnapshot();
    const document = snapshot.document;
    const visual = this.selectionInterpreter.visual;
    const selected = new Set((visual?.selection ?? snapshot.selection).nodeIds);
    const movementDelta = visual?.movementDelta;
    const resizeDelta = visual?.resize?.command.delta;
    const resizeRoots = new Set(visual?.resize?.command.nodeIds ?? []);
    const nodes = new Map(document.nodes.map((node) => [node.id, node]));
    const nodeIndexes = new Map(document.nodes.map((node, index) => [node.id, index]));
    const renderNode = (
      node: SceneNode,
      parentMatrix: Matrix,
      parentOpacity: number,
      ancestorMoved: boolean,
      ancestorResized: boolean,
    ): void => {
      if (!node.visible) return;
      const nodeIndex = nodeIndexes.get(node.id);
      if (nodeIndex === undefined) return;
      const transformPath = `/nodes/${nodeIndex}/transform`;
      if (node.transform[1] !== 0 || node.transform[2] !== 0) {
        this.reportRenderErrorOnce({
          code: 'render.transform-unsupported',
          path: transformPath,
        });
        return;
      }
      const movesBranch = selected.has(node.id) && !ancestorMoved && movementDelta != null;
      const resizesBranch =
        resizeRoots.has(node.id) && !ancestorResized && resizeDelta !== undefined;
      let localMatrix = node.transform;
      if (resizesBranch) {
        const resized = resolveResizePreviewLocalMatrix(parentMatrix, localMatrix, resizeDelta);
        if (!resized.ok) {
          this.reportRenderErrorOnce({
            code:
              resized.reason === 'unsupported'
                ? 'render.transform-unsupported'
                : 'render.transform-overflow',
            path: transformPath,
          });
          return;
        }
        localMatrix = resized.value;
      } else if (movesBranch) {
        const localDelta = moveDeltaInParentSpace(parentMatrix, movementDelta);
        if (localDelta === null) {
          this.reportRenderErrorOnce({
            code: 'render.transform-unsupported',
            path: transformPath,
          });
          return;
        }
        localMatrix = Object.freeze([
          localMatrix[0],
          localMatrix[1],
          localMatrix[2],
          localMatrix[3],
          localMatrix[4] + localDelta.x,
          localMatrix[5] + localDelta.y,
        ]) as Matrix;
      }
      const pageMatrix = multiplyMatrices(parentMatrix, localMatrix);
      if (pageMatrix === null) {
        this.reportRenderErrorOnce({ code: 'render.transform-overflow', path: transformPath });
        return;
      }
      const opacity = parentOpacity * node.opacity;
      if (!Number.isFinite(opacity)) {
        this.reportRenderErrorOnce({
          code: 'render.opacity-overflow',
          path: `/nodes/${nodeIndex}/opacity`,
        });
        return;
      }
      renderer.save();
      if (!applyAxisAlignedMatrix(renderer, localMatrix)) {
        renderer.restore();
        this.reportRenderErrorOnce({
          code: 'render.transform-unsupported',
          path: transformPath,
        });
        return;
      }
      if (node.type === 'frame' || node.type === 'rectangle') {
        renderer.setGlobalAlpha(opacity);
        renderer.beginPath();
        renderer.roundRect(0, 0, node.width, node.height, [...node.cornerRadii]);
        const fill = node.type === 'frame' ? node.background : node.fill;
        if (fill !== null) renderer.fill(this.paint(fill));
        if (node.stroke !== null) renderer.stroke(this.paint(node.stroke.paint), node.stroke.width);
        if (selected.has(node.id)) {
          renderer.setGlobalAlpha(1);
          renderer.beginPath();
          renderer.roundRect(-2, -2, node.width + 4, node.height + 4, [...node.cornerRadii]);
          renderer.stroke('#2563eb', 2);
        }
      } else if (node.type === 'ellipse') {
        renderer.setGlobalAlpha(opacity);
        renderer.beginPath();
        appendEllipsePath(renderer, 0, 0, node.width, node.height);
        if (node.fill !== null) renderer.fill(this.paint(node.fill));
        if (node.stroke !== null) renderer.stroke(this.paint(node.stroke.paint), node.stroke.width);
        if (selected.has(node.id)) {
          renderer.setGlobalAlpha(1);
          renderer.beginPath();
          appendEllipsePath(renderer, -2, -2, node.width + 4, node.height + 4);
          renderer.stroke('#2563eb', 2);
        }
      } else if (node.type === 'text') {
        renderer.setGlobalAlpha(opacity);
        const font = `${node.fontWeight} ${node.fontSize}px ${node.fontFamilies.join(', ')}`;
        const lines = node.content.split('\n');
        for (const [lineIndex, line] of lines.entries()) {
          renderer.fillText(
            line,
            0,
            node.fontSize + lineIndex * node.lineHeight,
            font,
            this.paint(node.fill),
          );
        }
        if (selected.has(node.id)) {
          renderer.setGlobalAlpha(1);
          renderer.beginPath();
          renderer.roundRect(-2, -2, node.width + 4, node.height + 4, 2);
          renderer.stroke('#2563eb', 2);
        }
      }
      if (node.type === 'frame' && node.clipChildren) renderer.clip(0, 0, node.width, node.height);
      if (node.type === 'frame' || node.type === 'group') {
        for (const childId of node.childIds) {
          const child = nodes.get(childId);
          if (child !== undefined) {
            renderNode(
              child,
              pageMatrix,
              opacity,
              ancestorMoved || movesBranch,
              ancestorResized || resizesBranch,
            );
          }
        }
      }
      renderer.restore();
    };
    const activePage = document.pages.find((page) => page.id === document.activePageId);
    if (activePage === undefined) return;
    renderer.save();
    const cameraOrigin = this.camera.viewportPointAt({ x: 0, y: 0 });
    renderer.translate(originX + cameraOrigin.x, originY + cameraOrigin.y);
    renderer.scale(this.camera.state.zoom, this.camera.state.zoom);
    for (const rootId of activePage.rootNodeIds) {
      const root = nodes.get(rootId);
      if (root !== undefined) renderNode(root, IDENTITY_MATRIX, 1, false, false);
    }
    // Selection affordances follow the camera position but retain screen-space
    // stroke and handle dimensions, matching the editor convention used by Figma.
    renderer.save();
    renderer.scale(1 / this.camera.state.zoom, 1 / this.camera.state.zoom);
    this.renderCreationPreview(renderer, this.camera.state.zoom);
    this.renderAlignmentGuides(renderer, visual?.guides ?? [], this.camera.state.zoom);
    this.renderResizeOverlay(renderer, visual, this.camera.state.zoom);
    if (visual?.marquee !== null && visual?.marquee !== undefined) {
      const source = visual.marquee;
      const x = Math.min(source.x, source.x + source.width);
      const y = Math.min(source.y, source.y + source.height);
      const width = Math.abs(source.width);
      const height = Math.abs(source.height);
      renderer.save();
      renderer.setGlobalAlpha(1);
      renderer.beginPath();
      renderer.roundRect(
        x * this.camera.state.zoom,
        y * this.camera.state.zoom,
        width * this.camera.state.zoom,
        height * this.camera.state.zoom,
        0,
      );
      renderer.fill('rgba(37, 99, 235, 0.12)');
      renderer.stroke('#2563eb', 1);
      renderer.restore();
    }
    renderer.restore();
    renderer.restore();
  }

  private renderCreationPreview(renderer: IRenderer, zoom: number): void {
    const visual = this.creationVisual;
    if (visual === null) return;
    const bounds = visual.bounds;
    const x = bounds.x * zoom;
    const y = bounds.y * zoom;
    const width = bounds.width * zoom;
    const height = bounds.height * zoom;
    renderer.save();
    renderer.setGlobalAlpha(1);
    renderer.beginPath();
    if (visual.tool === 'ellipse') appendEllipsePath(renderer, x, y, width, height);
    else renderer.roundRect(x, y, width, height, visual.tool === 'rectangle' ? 8 : 0);
    renderer.fill(
      visual.tool === 'frame' ? 'rgba(255, 255, 255, 0.55)' : 'rgba(37, 99, 235, 0.22)',
    );
    renderer.stroke('#2563eb', 1);
    renderer.restore();
  }

  private renderAlignmentGuides(
    renderer: IRenderer,
    guides: readonly AlignmentGuide[],
    zoom: number,
  ): void {
    renderer.save();
    renderer.setGlobalAlpha(1);
    for (const guide of guides) {
      if (
        (guide.axis !== 'x' && guide.axis !== 'y') ||
        !Number.isFinite(guide.coordinate) ||
        !Number.isFinite(guide.minExtent) ||
        !Number.isFinite(guide.maxExtent)
      ) {
        continue;
      }
      renderer.beginPath();
      if (guide.axis === 'x') {
        renderer.moveTo(guide.coordinate * zoom, guide.minExtent * zoom);
        renderer.lineTo(guide.coordinate * zoom, guide.maxExtent * zoom);
      } else {
        renderer.moveTo(guide.minExtent * zoom, guide.coordinate * zoom);
        renderer.lineTo(guide.maxExtent * zoom, guide.coordinate * zoom);
      }
      renderer.stroke('#2563eb', 1);
    }
    renderer.restore();
  }

  private renderResizeOverlay(
    renderer: IRenderer,
    visual: SelectionGestureVisual | null,
    zoom: number,
  ): void {
    if (!this.authoringEnabled || this.activeTool !== 'select' || this.selectionSession !== null) {
      return;
    }
    if (visual !== null && visual.resize === undefined) return;
    let interaction = this.resizeInteraction;
    if (interaction === null) {
      try {
        const result = this.ports.beginResizeInteraction();
        if (!result.ok) return;
        const captured = captureResizeInteraction(result.value);
        if (!captured.ok) return;
        interaction = captured.value;
      } catch {
        return;
      }
    }
    const overlay = interaction.overlay(visual?.resize);
    if (overlay === null || overlay.handles.length !== 8) return;
    const bounds = overlay.bounds;
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;

    renderer.save();
    renderer.setGlobalAlpha(1);
    renderer.beginPath();
    renderer.roundRect(bounds.minX * zoom, bounds.minY * zoom, width * zoom, height * zoom, 0);
    renderer.stroke('#2563eb', 1);
    for (const handle of overlay.handles) {
      renderer.beginPath();
      renderer.roundRect(
        (handle.x + handle.width / 2) * zoom - handle.width / 2,
        (handle.y + handle.height / 2) * zoom - handle.height / 2,
        handle.width,
        handle.height,
        0,
      );
      renderer.fill('#ffffff');
      renderer.stroke('#2563eb', 1);
    }
    renderer.restore();
  }

  private routeCanvasPointer(event: VectoJSEvent): void {
    const routeVersion = ++this.pointerRouteVersion;
    const head = this.snapshotPointerHead(event);
    if (this.pointerRouteVersion !== routeVersion) return;
    if (!head.ok) {
      this.rejectInvalidNativePointer(event, head);
      return;
    }
    const pointerId = head.value.pointerId;
    if (this.quarantinedPointerIds.has(pointerId)) {
      if (event.type === 'pointerup' || event.type === 'pointercancel') {
        this.quarantinedPointerIds.delete(pointerId);
      }
      return;
    }

    const activePointerId =
      this.creationPointerId ?? this.resizePointerId ?? this.selectionPointerId;
    if (this.cameraPointerId !== null && this.cameraPointerId !== pointerId) {
      if (event.type === 'pointerdown') this.quarantinedPointerIds.add(pointerId);
      return;
    }
    if (activePointerId !== null && activePointerId !== pointerId) {
      if (event.type === 'pointerdown') this.quarantinedPointerIds.add(pointerId);
      return;
    }

    if (event.type === 'pointercancel') {
      if (this.cameraPointerId === pointerId) {
        this.closeCameraPointer();
        event.preventDefault();
        return;
      }
      const creationSession = this.creationSession;
      if (creationSession !== null && this.creationPointerId === pointerId) {
        const effect = creationSession.cancel({ kind: 'pointercancel', pointerId });
        this.closeCreationSession(creationSession);
        this.applyCreationEffect(effect);
        event.preventDefault();
        return;
      }
      const resizeSession = this.resizeSession;
      if (resizeSession !== null && this.resizePointerId === pointerId) {
        const effect = resizeSession.cancel({ kind: 'pointercancel', pointerId });
        this.closeResizeSession(resizeSession);
        this.selectionInterpreter.apply(effect);
        event.preventDefault();
        return;
      }
      const selectionSession = this.selectionSession;
      if (selectionSession !== null && this.selectionPointerId === pointerId) {
        const effect = selectionSession.cancel({ kind: 'pointercancel', pointerId });
        this.closeSelectionSession(selectionSession);
        this.selectionInterpreter.apply(effect);
        event.preventDefault();
      }
      return;
    }

    const captured = this.snapshotPointerEvent(head.value);
    if (this.pointerRouteVersion !== routeVersion) return;
    if (!captured.ok) {
      this.rejectInvalidNativePointer(event, captured);
      return;
    }
    const native = captured.value;

    if (event.type === 'pointerdown') {
      this.routeCanvasPointerDown(event, native, routeVersion);
      return;
    }
    if (this.cameraPointerId === pointerId) {
      this.routeCameraPointer(event);
      return;
    }
    const creationSession = this.creationSession;
    if (creationSession !== null && this.creationPointerId === pointerId) {
      this.routeCreationPointer(event, native, creationSession);
      return;
    }
    const resizeSession = this.resizeSession;
    if (resizeSession !== null && this.resizePointerId === pointerId) {
      this.routeResizePointer(event, native, resizeSession);
      return;
    }
    const session = this.selectionSession;
    if (session === null || this.selectionPointerId !== pointerId) return;

    const sampled = this.selectionSample(event, native);
    if (!sampled.ok) {
      const effect = session.cancel({ kind: 'error', error: sampled.error });
      this.closeSelectionSession(session);
      if (event.type !== 'pointerup') this.quarantinedPointerIds.add(pointerId);
      this.selectionInterpreter.apply(effect);
      event.preventDefault();
      return;
    }
    if (event.type === 'pointermove') {
      const effect = session.update(sampled.value, this.selectionProvider);
      if (this.selectionSession !== session) return;
      if (effect.kind === 'discard') {
        this.closeSelectionSession(session);
        this.quarantinedPointerIds.add(pointerId);
      }
      this.selectionInterpreter.apply(effect);
      event.preventDefault();
      return;
    }
    if (event.type === 'pointerup') {
      const effect = session.finish(sampled.value, this.selectionProvider);
      if (this.selectionSession !== session) return;
      this.closeSelectionSession(session);
      this.selectionInterpreter.apply(effect);
      event.preventDefault();
    }
  }

  private routeCreationPointer(
    event: VectoJSEvent,
    native: NativePointerSnapshot,
    session: CreationGestureSession,
  ): void {
    const pointerId = native.pointerId;
    const sampled = this.creationSample(event, native);
    if (!sampled.ok) {
      const effect = session.cancel({ kind: 'error' });
      this.closeCreationSession(session);
      if (event.type !== 'pointerup') this.quarantinedPointerIds.add(pointerId);
      this.applyCreationEffect(effect);
      this.ports.reportInteractionError(sampled.error);
      event.preventDefault();
      return;
    }
    if (event.type === 'pointermove') {
      const effect = session.update(sampled.value);
      if (this.creationSession !== session) return;
      this.applyCreationEffect(effect);
      event.preventDefault();
      return;
    }
    if (event.type === 'pointerup') {
      const effect = session.finish(sampled.value);
      if (this.creationSession !== session) return;
      this.closeCreationSession(session);
      this.applyCreationEffect(effect);
      event.preventDefault();
    }
  }

  private routeResizePointer(
    event: VectoJSEvent,
    native: NativePointerSnapshot,
    session: ResizeSelectionSession,
  ): void {
    const pointerId = native.pointerId;
    const sampled = this.resizeSample(event, native);
    if (!sampled.ok) {
      const effect = session.cancel({ kind: 'error', error: sampled.error });
      this.closeResizeSession(session);
      if (event.type !== 'pointerup') this.quarantinedPointerIds.add(pointerId);
      this.selectionInterpreter.apply(effect);
      event.preventDefault();
      return;
    }
    if (event.type === 'pointermove') {
      const effect = session.update(sampled.value, this.resizeProvider);
      if (this.resizeSession !== session) return;
      if (effect.kind === 'discard') {
        this.closeResizeSession(session);
        this.quarantinedPointerIds.add(pointerId);
      }
      this.selectionInterpreter.apply(effect);
      event.preventDefault();
      return;
    }
    if (event.type === 'pointerup') {
      const effect = session.finish(sampled.value, this.resizeProvider);
      if (this.resizeSession !== session) return;
      this.closeResizeSession(session);
      this.selectionInterpreter.apply(effect);
      event.preventDefault();
    }
  }

  private routeCanvasPointerDown(
    event: VectoJSEvent,
    native: Readonly<{
      pointerId: number;
      button: number;
      shiftKey: boolean;
      altKey: boolean;
      ctrlKey: boolean;
      metaKey: boolean;
    }>,
    routeVersion: number,
  ): void {
    const pointerId = native.pointerId;
    if (native.button === 1 || (native.button === 0 && this.spacePanHeld)) {
      const viewport = this.viewportSample(event);
      if (!viewport.ok) {
        this.rejectPointer(pointerId, viewport.error);
        return;
      }
      this.cameraPointerId = pointerId;
      this.cameraLastViewportPoint = viewport.value;
      event.preventDefault();
      return;
    }
    if (!this.authoringEnabled) return;
    const activePointerId =
      this.creationPointerId ?? this.resizePointerId ?? this.selectionPointerId;
    if (activePointerId !== null) {
      if (activePointerId !== pointerId) this.quarantinedPointerIds.add(pointerId);
      return;
    }
    const supported = native.button === 0 && !native.ctrlKey && !native.metaKey;
    if (!supported) {
      this.quarantinedPointerIds.add(pointerId);
      return;
    }
    const sampled = this.selectionSample(event, native);
    if (!sampled.ok) {
      this.rejectPointer(pointerId, sampled.error);
      return;
    }

    if (this.activeTool === 'text') {
      const result = this.ports.createAt(
        this.activeTool,
        sampled.value.pagePoint.x,
        sampled.value.pagePoint.y,
      );
      if (result.ok) this.refreshDocumentState();
      return;
    }

    if (this.activeTool !== 'select') {
      const creationSample: CreationPointerSample = Object.freeze({
        pointerId,
        viewportPoint: sampled.value.viewportPoint,
        pagePoint: sampled.value.pagePoint,
        shiftKey: native.shiftKey,
        altKey: native.altKey,
      });
      this.creationSession = CreationGestureSession.begin(this.activeTool, creationSample);
      this.creationPointerId = pointerId;
      this.creationVisual = null;
      this.terminalInteraction = null;
      return;
    }

    let resizeStartResult: Result<ResizeInteractionStart>;
    try {
      resizeStartResult = this.ports.beginResizeInteraction();
    } catch {
      if (
        this.pointerRouteVersion !== routeVersion ||
        this.selectionSession !== null ||
        this.resizeSession !== null
      ) {
        return;
      }
      this.rejectPointer(pointerId, {
        code: 'interaction.begin-threw',
        path: '/beginResizeInteraction',
      });
      return;
    }
    if (
      this.pointerRouteVersion !== routeVersion ||
      this.selectionSession !== null ||
      this.resizeSession !== null
    ) {
      return;
    }
    if (resizeStartResult.ok) {
      const currentRoute = () =>
        this.pointerRouteVersion === routeVersion &&
        this.selectionSession === null &&
        this.resizeSession === null;
      const captured = captureResizeInteraction(resizeStartResult.value, currentRoute);
      if (!currentRoute()) return;
      if (!captured.ok) {
        this.rejectPointer(pointerId, captured.error);
        return;
      }
      const handle: ResizeHandle | null = captured.value.hit(sampled.value.pagePoint);
      if (!currentRoute()) return;
      if (handle !== null) {
        const resizeSample: ResizePointerSample = Object.freeze({
          pointerId,
          pagePoint: sampled.value.pagePoint,
          shiftKey: native.shiftKey,
          altKey: native.altKey,
        });
        const begun = ResizeSelectionSession.begin(
          captured.value.start,
          handle,
          resizeSample,
          this.resizeProvider,
        );
        if (
          this.pointerRouteVersion !== routeVersion ||
          this.selectionSession !== null ||
          this.resizeSession !== null
        ) {
          return;
        }
        if (!begun.ok) {
          this.rejectPointer(pointerId, begun.error);
          return;
        }
        this.resizeSession = begun.value;
        this.resizePointerId = pointerId;
        this.resizeInteraction = captured.value;
        this.terminalInteraction = null;
        event.preventDefault();
        return;
      }
    }

    if (native.altKey) {
      this.quarantinedPointerIds.add(pointerId);
      return;
    }

    let start: SelectionInteractionStart;
    try {
      start = this.ports.beginSelectionInteraction();
    } catch {
      if (
        this.pointerRouteVersion !== routeVersion ||
        this.selectionSession !== null ||
        this.resizeSession !== null
      ) {
        return;
      }
      this.rejectPointer(pointerId, {
        code: 'interaction.begin-threw',
        path: '/beginSelectionInteraction',
      });
      return;
    }
    if (
      this.pointerRouteVersion !== routeVersion ||
      this.selectionSession !== null ||
      this.resizeSession !== null
    ) {
      return;
    }
    const begun = MarqueeSelectionSession.begin(start, sampled.value, this.selectionProvider);
    if (
      this.pointerRouteVersion !== routeVersion ||
      this.selectionSession !== null ||
      this.resizeSession !== null
    ) {
      return;
    }
    if (!begun.ok) {
      this.rejectPointer(pointerId, begun.error);
      return;
    }
    this.selectionSession = begun.value;
    this.selectionPointerId = pointerId;
    this.terminalInteraction = null;
    event.preventDefault();
  }

  private snapshotPointerHead(event: VectoJSEvent): NativePointerHeadResult {
    let source: NativePointerSource | undefined;
    try {
      source = event.nativeEvent as typeof source;
    } catch {
      return pointerInvalid('/nativeEvent', null);
    }

    let pointerId: number | undefined;
    try {
      pointerId = source?.pointerId;
    } catch {
      return pointerInvalid('/nativeEvent/pointerId', null);
    }
    if (pointerId === undefined || !Number.isFinite(pointerId)) {
      return pointerInvalid('/nativeEvent/pointerId', null);
    }
    return Object.freeze({
      ok: true,
      value: Object.freeze({ source: source ?? Object.freeze({}), pointerId }),
    });
  }

  private snapshotPointerEvent(
    head: Readonly<{ source: NativePointerSource; pointerId: number }>,
  ): NativePointerSnapshotResult {
    const source = head.source;
    const pointerId = head.pointerId;
    let button: number | undefined;
    let shiftKey: boolean | undefined;
    let altKey: boolean | undefined;
    let ctrlKey: boolean | undefined;
    let metaKey: boolean | undefined;
    try {
      button = source?.button;
    } catch {
      return pointerInvalid('/nativeEvent/button', pointerId);
    }
    try {
      shiftKey = source?.shiftKey;
    } catch {
      return pointerInvalid('/nativeEvent/shiftKey', pointerId);
    }
    try {
      altKey = source?.altKey;
    } catch {
      return pointerInvalid('/nativeEvent/altKey', pointerId);
    }
    try {
      ctrlKey = source?.ctrlKey;
    } catch {
      return pointerInvalid('/nativeEvent/ctrlKey', pointerId);
    }
    try {
      metaKey = source?.metaKey;
    } catch {
      return pointerInvalid('/nativeEvent/metaKey', pointerId);
    }
    return Object.freeze({
      ok: true,
      value: Object.freeze({
        pointerId,
        button: button ?? 0,
        shiftKey: shiftKey ?? false,
        altKey: altKey ?? false,
        ctrlKey: ctrlKey ?? false,
        metaKey: metaKey ?? false,
      }),
    });
  }

  private rejectInvalidNativePointer(
    event: VectoJSEvent,
    failure: Readonly<{ ok: false; error: BringsError; pointerId: number | null }>,
  ): void {
    const pointerId = failure.pointerId;
    if (pointerId === null) {
      this.ports.reportInteractionError(failure.error);
      return;
    }
    const terminal = event.type === 'pointerup' || event.type === 'pointercancel';
    if (this.quarantinedPointerIds.has(pointerId)) {
      if (terminal) this.quarantinedPointerIds.delete(pointerId);
      return;
    }

    const creationSession = this.creationSession;
    if (creationSession !== null && this.creationPointerId === pointerId) {
      const effect = creationSession.cancel({ kind: 'error' });
      this.closeCreationSession(creationSession);
      if (!terminal) this.quarantinedPointerIds.add(pointerId);
      this.applyCreationEffect(effect);
      this.ports.reportInteractionError(failure.error);
      event.preventDefault();
      return;
    }

    const resizeSession = this.resizeSession;
    if (resizeSession !== null && this.resizePointerId === pointerId) {
      const effect = resizeSession.cancel({ kind: 'error', error: failure.error });
      this.closeResizeSession(resizeSession);
      if (!terminal) this.quarantinedPointerIds.add(pointerId);
      this.selectionInterpreter.apply(effect);
      event.preventDefault();
      return;
    }

    const session = this.selectionSession;
    if (session !== null && this.selectionPointerId === pointerId) {
      const effect = session.cancel({ kind: 'error', error: failure.error });
      this.closeSelectionSession(session);
      if (!terminal) this.quarantinedPointerIds.add(pointerId);
      this.selectionInterpreter.apply(effect);
      event.preventDefault();
      return;
    }

    if (!terminal) this.quarantinedPointerIds.add(pointerId);
    this.ports.reportInteractionError(failure.error);
  }

  private selectionSample(
    event: VectoJSEvent,
    native: Readonly<{ pointerId: number; shiftKey: boolean }>,
  ): Result<SelectionPointerSample> {
    const viewport = this.viewportSample(event);
    if (!viewport.ok) return viewport;
    const converted = this.camera.pagePointAt(viewport.value);
    const page = editorPagePoint(converted.x, converted.y);
    if (!page.ok) return page;
    return {
      ok: true,
      value: {
        pointerId: native.pointerId,
        viewportPoint: viewport.value,
        pagePoint: page.value,
        shiftKey: native.shiftKey,
      },
    };
  }

  private creationSample(
    event: VectoJSEvent,
    native: Readonly<{
      pointerId: number;
      shiftKey: boolean;
      altKey: boolean;
    }>,
  ): Result<CreationPointerSample> {
    const sampled = this.selectionSample(event, native);
    if (!sampled.ok) return sampled;
    return {
      ok: true,
      value: Object.freeze({
        pointerId: native.pointerId,
        viewportPoint: sampled.value.viewportPoint,
        pagePoint: sampled.value.pagePoint,
        shiftKey: native.shiftKey,
        altKey: native.altKey,
      }),
    };
  }

  private viewportSample(
    event: VectoJSEvent,
  ): Result<import('../editor/selectionCoordinates').ViewportPoint> {
    return viewportPoint(event.localX ?? Number.NaN, event.localY ?? Number.NaN);
  }

  private routeCameraPointer(event: VectoJSEvent): void {
    const viewport = this.viewportSample(event);
    if (!viewport.ok) {
      if (this.cameraPointerId !== null) this.rejectPointer(this.cameraPointerId, viewport.error);
      this.closeCameraPointer();
      return;
    }
    if (event.type === 'pointermove' && this.cameraLastViewportPoint !== null) {
      this.camera = this.camera.panBySceneDelta({
        x: viewport.value.x - this.cameraLastViewportPoint.x,
        y: viewport.value.y - this.cameraLastViewportPoint.y,
      });
      this.cameraLastViewportPoint = viewport.value;
      this.scene?.markDirty();
      event.preventDefault();
      return;
    }
    if (event.type === 'pointerup') {
      this.closeCameraPointer();
      event.preventDefault();
    }
  }

  private closeCameraPointer(): void {
    this.cameraPointerId = null;
    this.cameraLastViewportPoint = null;
  }

  private zoomCamera(factor: number): void {
    const center = Object.freeze({
      x: this.layout.viewport.width / 2,
      y: this.layout.viewport.height / 2,
    });
    this.camera = this.camera.zoomByFactorAtViewportPoint(center, factor);
    this.applyLayout();
    this.scene?.markDirty();
  }

  private runHistoryFromChrome(action: 'undo' | 'redo'): void {
    const result = this.ports.runHistory(action);
    if (!result.ok) return;
    this.refreshDocumentState();
  }

  private refreshAfter(result: Result<EditorSnapshot>): Result<EditorSnapshot> {
    // SelectionGestureInterpreter owns the corresponding dirty notification.
    if (result.ok) this.refreshDocumentState(false);
    return result;
  }

  private refreshDocumentState(markDirty = true): void {
    this.layerSignature = '';
    this.propertySignature = '';
    this.syncDocumentChrome();
    this.syncLayerRows();
    this.syncProperties();
    this.applyLayout();
    if (markDirty) this.scene?.markDirty();
  }

  private cameraViewportSize(): Readonly<{ width: number; height: number }> {
    return Object.freeze({
      width: Math.max(1, this.layout.viewport.width),
      height: Math.max(1, this.layout.viewport.height),
    });
  }

  private hasMeasuredViewport(): boolean {
    return this.layout.viewport.width > 0 && this.layout.viewport.height > 0;
  }

  private routeCanvasWheel(event: VectoJSEvent): void {
    const native = event.nativeEvent as
      | Readonly<{
          deltaX?: number;
          deltaY?: number;
          deltaMode?: number;
          shiftKey?: boolean;
          ctrlKey?: boolean;
          metaKey?: boolean;
        }>
      | undefined;
    const viewport = this.viewportSample(event);
    if (!viewport.ok || native === undefined) return;
    const deltaX = native.deltaX ?? Number.NaN;
    const deltaY = native.deltaY ?? Number.NaN;
    const deltaMode = native.deltaMode ?? 0;
    try {
      const delta = normalizeWheelDelta(
        { deltaX, deltaY, deltaMode, shiftKey: native.shiftKey },
        this.layout.viewport,
      );
      this.camera =
        native.ctrlKey === true || native.metaKey === true
          ? this.camera.zoomAtViewportPoint(viewport.value, delta.y)
          : this.camera.panBySceneDelta({ x: -delta.x, y: -delta.y });
      this.applyLayout();
      this.scene?.markDirty();
      event.preventDefault();
    } catch {
      this.ports.reportInteractionError({ code: 'interaction.coordinate-invalid', path: '/wheel' });
    }
  }

  private resizeSample(
    event: VectoJSEvent,
    native: Readonly<{ pointerId: number; shiftKey: boolean; altKey: boolean }>,
  ): Result<ResizePointerSample> {
    const sampled = this.selectionSample(event, native);
    if (!sampled.ok) return sampled;
    return Object.freeze({
      ok: true,
      value: Object.freeze({
        pointerId: native.pointerId,
        pagePoint: sampled.value.pagePoint,
        shiftKey: native.shiftKey,
        altKey: native.altKey,
      }),
    });
  }

  private rejectPointer(pointerId: number, error: BringsError): void {
    this.quarantinedPointerIds.add(pointerId);
    this.ports.reportInteractionError(error);
  }

  private reportRenderErrorOnce(error: BringsError): void {
    const key = `${error.code}:${error.path}`;
    if (this.reportedRenderErrors.has(key)) return;
    this.reportedRenderErrors.add(key);
    this.ports.reportInteractionError(error);
  }

  private closeSelectionSession(expected: MarqueeSelectionSession): boolean {
    if (this.selectionSession !== expected) return false;
    const terminal = expected.snapshot();
    this.selectionSession = null;
    this.selectionPointerId = null;
    this.terminalInteraction = terminal.phase === 'terminal' ? snapshotSession(terminal) : null;
    return true;
  }

  private closeCreationSession(expected: CreationGestureSession): boolean {
    if (this.creationSession !== expected) return false;
    const terminal = expected.snapshot();
    this.creationSession = null;
    this.creationPointerId = null;
    this.creationVisual = null;
    this.terminalInteraction = terminal.phase === 'terminal' ? terminal : null;
    return true;
  }

  private applyCreationEffect(effect: CreationGestureEffect): void {
    if (effect.kind === 'ignore') return;
    if (effect.kind === 'preview') {
      this.creationVisual = snapshotCreationVisual(effect.visual);
      this.scene?.markDirty();
      return;
    }
    this.creationVisual = null;
    if (effect.kind === 'commit') {
      const result = this.ports.createInBounds(effect.tool, effect.bounds);
      if (result.ok) this.refreshDocumentState();
      else this.ports.reportInteractionError(result.error);
      return;
    }
    this.scene?.markDirty();
  }

  private closeResizeSession(expected: ResizeSelectionSession): boolean {
    if (this.resizeSession !== expected) return false;
    const terminal = expected.snapshot();
    this.resizeSession = null;
    this.resizePointerId = null;
    this.resizeInteraction = null;
    this.terminalInteraction = terminal.phase === 'terminal' ? terminal : null;
    return true;
  }

  private activateTool(tool: CanvasTool): void {
    if (tool === this.activeTool) return;

    // A tool switch is a transactional boundary: no preview owned by the old
    // tool may remain visible or accept a late terminal pointer event.
    this.pointerRouteVersion += 1;
    const creationSession = this.creationSession;
    if (creationSession !== null) {
      const pointerId = this.creationPointerId;
      const effect = creationSession.cancel({ kind: 'tool-change' });
      this.closeCreationSession(creationSession);
      if (pointerId !== null) this.quarantinedPointerIds.add(pointerId);
      this.applyCreationEffect(effect);
    } else if (this.resizeSession !== null) {
      const resizeSession = this.resizeSession;
      const pointerId = this.resizePointerId;
      const effect = resizeSession.cancel({ kind: 'escape' });
      this.closeResizeSession(resizeSession);
      if (pointerId !== null) this.quarantinedPointerIds.add(pointerId);
      this.selectionInterpreter.apply(effect);
    } else {
      const selectionSession = this.selectionSession;
      if (selectionSession !== null) {
        const pointerId = this.selectionPointerId;
        const effect = selectionSession.cancel({ kind: 'escape' });
        this.closeSelectionSession(selectionSession);
        if (pointerId !== null) this.quarantinedPointerIds.add(pointerId);
        this.selectionInterpreter.apply(effect);
      }
    }

    this.activeTool = tool;
    this.applyLayout();
    this.scene?.markDirty();
  }

  private routeEditorShortcut(event: VectoJSEvent): void {
    if (
      event.key === ' ' &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !this.shouldYieldNativeEditor(event)
    ) {
      this.spacePanHeld = true;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key === 'Escape' && this.creationSession !== null) {
      const session = this.creationSession;
      const pointerId = this.creationPointerId;
      const effect = session.cancel({ kind: 'escape' });
      this.closeCreationSession(session);
      if (pointerId !== null) this.quarantinedPointerIds.add(pointerId);
      this.applyCreationEffect(effect);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key === 'Escape' && this.resizeSession !== null) {
      const session = this.resizeSession;
      const pointerId = this.resizePointerId;
      const effect = session.cancel({ kind: 'escape' });
      this.closeResizeSession(session);
      if (pointerId !== null) this.quarantinedPointerIds.add(pointerId);
      this.selectionInterpreter.apply(effect);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key === 'Escape' && this.selectionSession !== null) {
      const session = this.selectionSession;
      const pointerId = this.selectionPointerId;
      const effect = session.cancel({ kind: 'escape' });
      this.closeSelectionSession(session);
      if (pointerId !== null) this.quarantinedPointerIds.add(pointerId);
      this.selectionInterpreter.apply(effect);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const action = resolveEditorShortcut(event);
    if (action === null || this.shouldYieldNativeEditor(event)) return;

    event.preventDefault();
    event.stopPropagation();
    switch (action) {
      case 'tool-select':
        this.activateTool('select');
        return;
      case 'tool-frame':
        this.activateTool('frame');
        return;
      case 'tool-rectangle':
        this.activateTool('rectangle');
        return;
      case 'tool-ellipse':
        this.activateTool('ellipse');
        return;
      case 'tool-text':
        this.activateTool('text');
        return;
    }
    const result =
      action === 'delete'
        ? this.ports.deleteSelection()
        : action === 'group'
          ? this.ports.groupSelection()
          : action === 'ungroup'
            ? this.ports.ungroupSelection()
            : this.ports.runHistory(action);
    if (result.ok) this.refreshDocumentState();
  }

  private routeCameraKeyUp(event: VectoJSEvent): void {
    if (event.key !== ' ' || this.shouldYieldNativeEditor(event)) return;
    this.spacePanHeld = false;
    event.preventDefault();
    event.stopPropagation();
  }

  private shouldYieldNativeEditor(event: VectoJSEvent): boolean {
    const nativeEvent = event.nativeEvent as { readonly target?: EventTarget | null } | null;
    return isNativeEditorTarget(nativeEvent?.target ?? null);
  }

  private paint(paint: {
    readonly r: number;
    readonly g: number;
    readonly b: number;
    readonly a: number;
  }): string {
    return `rgba(${Math.round(paint.r * 255)}, ${Math.round(paint.g * 255)}, ${Math.round(paint.b * 255)}, ${paint.a})`;
  }
}
