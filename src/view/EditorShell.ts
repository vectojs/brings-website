import {
  type A11yAttributes,
  type ContentProjection,
  Entity,
  type IRenderer,
  type VectoJSEvent,
} from '@vectojs/core';
import type {
  BringsError,
  EditorSnapshot,
  Matrix,
  Result,
  SceneNode,
  SelectionResizeProposal,
} from '@vectojs/brings-core';
import { viewportPoint, viewportToPagePoint, type PageDelta } from '../editor/selectionCoordinates';
import type {
  SelectionInteractionStart,
  SelectionProposal,
  SelectionProposalProvider,
} from '../editor/selectionInteraction';
import { type EditorLayout, resolveEditorLayout } from './layout';
import {
  type EditorShortcutAction,
  isNativeEditorTarget,
  resolveEditorShortcut,
} from './editorShortcuts';
import {
  MarqueeSelectionSession,
  type SelectionGestureSessionSnapshot,
  type SelectionGestureVisual,
  type SelectionPointerSample,
} from './MarqueeSelectionSession';
import { SelectionGestureInterpreter } from './SelectionGestureInterpreter';

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

export type CreationTool = 'frame' | 'rectangle';
type CanvasTool = 'select' | CreationTool;

type NativePointerSnapshot = Readonly<{
  pointerId: number;
  button: number;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}>;

type NativePointerSnapshotResult =
  | Readonly<{ ok: true; value: NativePointerSnapshot }>
  | Readonly<{ ok: false; error: BringsError; pointerId: number | null }>;

/** Fresh JSON-safe diagnostic state exposed only through the debug reader. */
export type EditorInteractionSnapshot = Readonly<{
  phase: 'idle' | SelectionGestureSessionSnapshot['phase'];
  terminalEffect: SelectionGestureSessionSnapshot['terminalEffect'];
  pointerId: number | null;
  shiftKey: boolean | null;
  start: SelectionGestureSessionSnapshot['start'] | null;
  current: SelectionGestureSessionSnapshot['current'] | null;
  visual: SelectionGestureVisual | null;
}>;

function pointerInvalid(path: string, pointerId: number | null): NativePointerSnapshotResult {
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

function snapshotVisual(visual: SelectionGestureVisual | null): SelectionGestureVisual | null {
  if (visual === null) return null;
  const marquee = visual.marquee;
  const movementDelta = visual.movementDelta;
  const resize = visual.resize;
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
    });
  }
  if (movementDelta !== null) {
    return Object.freeze({
      selection,
      marquee: null,
      movementDelta: Object.freeze({ x: movementDelta.x, y: movementDelta.y }) as PageDelta,
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
  });
}

export interface EditorShellPorts {
  readonly documentSnapshot?: () => EditorSnapshot;
  readonly createAt?: (tool: CreationTool, x: number, y: number) => Result<EditorSnapshot>;
  readonly beginSelectionInteraction?: () => SelectionInteractionStart;
  readonly proposePointSelection?: SelectionProposalProvider['point'];
  readonly proposeAreaSelection?: SelectionProposalProvider['area'];
  readonly commitSelection?: (proposal: SelectionProposal) => Result<EditorSnapshot>;
  readonly commitMove?: (
    input: Readonly<{
      proposal: SelectionProposal;
      delta: PageDelta;
    }>,
  ) => Result<EditorSnapshot>;
  readonly reportInteractionError?: (error: BringsError) => void;
  readonly runHistory?: (action: Exclude<EditorShortcutAction, 'delete'>) => Result<EditorSnapshot>;
  readonly deleteSelection?: () => Result<EditorSnapshot>;
}

type ResolvedEditorShellPorts = Readonly<{
  documentSnapshot: () => EditorSnapshot;
  createAt: (tool: CreationTool, x: number, y: number) => Result<EditorSnapshot>;
  beginSelectionInteraction: () => SelectionInteractionStart;
  proposePointSelection: SelectionProposalProvider['point'];
  proposeAreaSelection: SelectionProposalProvider['area'];
  commitSelection: (proposal: SelectionProposal) => Result<EditorSnapshot>;
  commitMove: (
    input: Readonly<{
      proposal: SelectionProposal;
      delta: PageDelta;
    }>,
  ) => Result<EditorSnapshot>;
  reportInteractionError: (error: BringsError) => void;
  runHistory: (action: Exclude<EditorShortcutAction, 'delete'>) => Result<EditorSnapshot>;
  deleteSelection: () => Result<EditorSnapshot>;
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
  createAt: () => unavailable('shape.unavailable'),
  proposePointSelection: () => unavailable('selection.unavailable'),
  proposeAreaSelection: () => unavailable('selection.unavailable'),
  commitSelection: () => unavailable('selection.unavailable'),
  commitMove: () => unavailable('transform.unavailable'),
  reportInteractionError: () => undefined,
  runHistory: () => unavailable('history.unavailable'),
  deleteSelection: () => unavailable('selection.delete-unavailable'),
};

function resolveEditorShellPorts(ports: EditorShellPorts): ResolvedEditorShellPorts {
  const documentSnapshot = ports.documentSnapshot ?? DEFAULT_DOCUMENT_SNAPSHOT;
  return {
    documentSnapshot,
    createAt: ports.createAt ?? DEFAULT_EDITOR_SHELL_PORTS.createAt,
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
    commitSelection: ports.commitSelection ?? DEFAULT_EDITOR_SHELL_PORTS.commitSelection,
    commitMove: ports.commitMove ?? DEFAULT_EDITOR_SHELL_PORTS.commitMove,
    reportInteractionError:
      ports.reportInteractionError ?? DEFAULT_EDITOR_SHELL_PORTS.reportInteractionError,
    runHistory: ports.runHistory ?? DEFAULT_EDITOR_SHELL_PORTS.runHistory,
    deleteSelection: ports.deleteSelection ?? DEFAULT_EDITOR_SHELL_PORTS.deleteSelection,
  };
}

class ToolbarButton extends Entity {
  private active = false;

  public constructor(
    id: string,
    private readonly label: string,
    private readonly onActivate: () => void,
  ) {
    super(id);
    this.interactive = true;
    this.on('pointerdown', (event) => {
      event.preventDefault();
      this.onActivate();
    });
  }

  public setFrame(x: number, y: number, active: boolean): void {
    this.x = x;
    this.y = y;
    this.width = 88;
    this.height = 32;
    this.active = active;
  }

  public override getA11yAttributes(): A11yAttributes {
    return { role: 'button', label: this.active ? `${this.label} tool selected` : this.label };
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
    renderer.beginPath();
    renderer.roundRect(0, 0, this.width, this.height, 6);
    renderer.fill(this.active ? '#2563eb' : '#3a404b');
    renderer.fillText(this.label, 12, 21, '600 12px system-ui, sans-serif', '#f8fafc');
  }
}

class MobileModeNotice extends Entity {
  private visible = false;

  public setFrame(x: number, y: number, width: number, height: number, visible: boolean): void {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
    this.visible = visible;
    this.interactive = false;
  }

  public override getContentProjection(): ContentProjection | null {
    if (!this.visible) return null;
    return {
      text: 'Authoring tools are disabled on narrow screens. Use view, select, pan, and zoom.',
      font: '500 12px system-ui, sans-serif',
    };
  }

  public override isPointInside(): boolean {
    return false;
  }

  public override render(_renderer: IRenderer): void {}
}

class CanvasLabel extends Entity {
  private visible = false;

  public constructor(
    id: string,
    private readonly text: string,
    private readonly font: string,
    private readonly color: string,
  ) {
    super(id);
  }

  public setFrame(x: number, y: number, visible: boolean): void {
    this.x = x;
    this.y = y;
    this.width = visible ? Math.max(1, this.text.length * 8) : 0;
    this.height = visible ? 20 : 0;
    this.visible = visible;
    this.interactive = false;
  }

  public override getContentProjection(): ContentProjection | null {
    if (!this.visible) return null;
    return { text: this.text, font: this.font };
  }

  public override isPointInside(): boolean {
    return false;
  }

  public override render(renderer: IRenderer): void {
    if (this.visible) renderer.fillText(this.text, 0, 0, this.font, this.color);
  }
}

/**
 * The first canvas-native Brings surface. It owns explicit numeric panel bounds;
 * later tools reconcile document entities below the `canvasRegion` seam.
 */
export class EditorShell extends Entity {
  private readonly toolbar = new EditorRegion('brings-toolbar', {
    role: 'toolbar',
    label: 'Tools',
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
  private readonly mobileModeNotice = new MobileModeNotice('brings-mobile-mode-notice');
  private readonly title = new CanvasLabel(
    'brings-title',
    'Brings',
    '600 18px system-ui, sans-serif',
    '#ecfdf5',
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
  private readonly propertiesLabel = new CanvasLabel(
    'brings-properties-label',
    'Design',
    '600 12px system-ui, sans-serif',
    '#e5e7eb',
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
  private readonly selectTool = new ToolbarButton('brings-select-tool', 'Select', () => {
    this.activeTool = 'select';
    this.scene?.markDirty();
  });
  private readonly frameTool = new ToolbarButton('brings-frame-tool', 'Frame', () => {
    this.activeTool = 'frame';
    this.scene?.markDirty();
  });
  private readonly rectangleTool = new ToolbarButton('brings-rectangle-tool', 'Rectangle', () => {
    this.activeTool = 'rectangle';
    this.scene?.markDirty();
  });
  private activeDrawer: DrawerSide | null = null;
  private activeTool: CanvasTool = 'select';
  private selectionSession: MarqueeSelectionSession | null = null;
  private selectionPointerId: number | null = null;
  private terminalInteraction: SelectionGestureSessionSnapshot | null = null;
  private pointerRouteVersion = 0;
  private readonly quarantinedPointerIds = new Set<number>();
  private readonly reportedRenderErrors = new Set<string>();
  private layout: EditorLayout;
  private readonly ports: ResolvedEditorShellPorts;
  private readonly selectionProvider: SelectionProposalProvider;
  private readonly selectionInterpreter: SelectionGestureInterpreter;

  public constructor(width = 1, height = 1, ports: EditorShellPorts = {}) {
    super('brings-editor-shell');
    this.ports = resolveEditorShellPorts(ports);
    this.selectionProvider = {
      point: (start, point, mode) => this.ports.proposePointSelection(start, point, mode),
      area: (start, rect, mode) => this.ports.proposeAreaSelection(start, rect, mode),
    };
    this.selectionInterpreter = new SelectionGestureInterpreter({
      commitSelection: (proposal) => this.ports.commitSelection(proposal),
      commitMove: (input) => this.ports.commitMove(input),
      reportInteractionError: (error) => this.ports.reportInteractionError(error),
      markDirty: () => this.scene?.markDirty(),
    });
    this.interactive = true;
    this.add(this.toolbar);
    this.add(this.layers);
    this.add(this.canvasRegion);
    this.add(this.properties);
    this.toolbar.add(this.title);
    this.toolbar.add(this.selectTool);
    this.toolbar.add(this.frameTool);
    this.toolbar.add(this.rectangleTool);
    this.layers.add(this.pagesLabel);
    this.layers.add(this.layersLabel);
    this.canvasRegion.add(this.workspaceLabel);
    this.canvasRegion.add(this.mobileModeLabel);
    this.canvasRegion.add(this.mobileModeNotice);
    this.properties.add(this.propertiesLabel);
    this.canvasRegion.on('keydown', (event) => this.routeEditorShortcut(event));
    this.layout = resolveEditorLayout(width, height);
    this.canvasRegion.setPointerHandler((event) => this.routeCanvasPointer(event));
    this.resize(width, height);
  }

  /** True while the narrow-screen shell supports editing tools. */
  public get authoringEnabled(): boolean {
    return this.width >= 600;
  }

  /** Read a fresh detached interaction snapshot without exposing mutation controls. */
  public interactionSnapshot(): EditorInteractionSnapshot {
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
    this.width = width;
    this.height = height;
    this.layout = resolveEditorLayout(width, height);

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
    const { toolbarHeight, viewport } = this.layout;
    const toolbarHeightInScene = Math.min(toolbarHeight, this.height);

    renderer.beginPath();
    renderer.roundRect(0, 0, this.width, this.height, 0);
    renderer.fill('#f8f9fc');

    renderer.beginPath();
    renderer.roundRect(0, 0, this.width, toolbarHeightInScene, 0);
    renderer.fill('#20242b');

    renderer.beginPath();
    renderer.roundRect(viewport.x, viewport.y, viewport.width, viewport.height, 0);
    renderer.fill('#f4f6fa');
    this.renderDocument(renderer, viewport.x, viewport.y);

    this.renderPanel(renderer, this.layers);
    this.renderPanel(renderer, this.properties);
  }

  private applyLayout(): void {
    const { toolbarHeight, leftPanel, rightPanel, viewport } = this.layout;
    const contentHeight = Math.max(0, this.height - toolbarHeight);
    const leftWidth = Math.min(leftPanel.width, this.width);
    const rightWidth = Math.min(rightPanel.width, this.width);
    const leftOpen = leftPanel.mode === 'visible' || this.activeDrawer === 'left';
    const rightOpen = rightPanel.mode === 'visible' || this.activeDrawer === 'right';

    this.toolbar.setFrame(0, 0, this.width, Math.min(toolbarHeight, this.height), true);
    this.layers.setFrame(0, toolbarHeight, leftWidth, contentHeight, leftOpen);
    this.canvasRegion.setFrame(viewport.x, viewport.y, viewport.width, viewport.height, true);
    this.properties.setFrame(
      Math.max(0, this.width - rightWidth),
      toolbarHeight,
      rightWidth,
      contentHeight,
      rightOpen,
    );
    this.mobileModeNotice.setFrame(
      28,
      100,
      Math.max(0, viewport.width - 56),
      20,
      !this.authoringEnabled,
    );
    this.title.setFrame(20, 35, true);
    this.selectTool.setFrame(120, 12, this.activeTool === 'select');
    this.frameTool.setFrame(216, 12, this.activeTool === 'frame');
    this.rectangleTool.setFrame(312, 12, this.activeTool === 'rectangle');
    this.pagesLabel.setFrame(20, 30, this.layers.interactive);
    this.layersLabel.setFrame(20, 72, this.layers.interactive);
    this.propertiesLabel.setFrame(20, 30, this.properties.interactive);
    this.workspaceLabel.setFrame(28, 40, true);
    this.mobileModeLabel.setFrame(28, 70, !this.authoringEnabled);

    if (!leftOpen) this.layers.setFrame(0, 0, 0, 0, false);
    if (!rightOpen) this.properties.setFrame(0, 0, 0, 0, false);
  }

  private renderPanel(renderer: IRenderer, panel: EditorRegion): void {
    if (!panel.interactive) return;
    renderer.beginPath();
    renderer.roundRect(panel.x, panel.y, panel.width, panel.height, 0);
    renderer.fill('#2b3038');
  }

  private renderDocument(renderer: IRenderer, originX: number, originY: number): void {
    const snapshot = this.ports.documentSnapshot();
    const document = snapshot.document;
    const visual = this.selectionInterpreter.visual;
    const selected = new Set((visual?.selection ?? snapshot.selection).nodeIds);
    const movementDelta = visual?.movementDelta;
    const nodes = new Map(document.nodes.map((node) => [node.id, node]));
    const nodeIndexes = new Map(document.nodes.map((node, index) => [node.id, index]));
    const renderNode = (
      node: SceneNode,
      parentMatrix: Matrix,
      parentOpacity: number,
      ancestorMoved: boolean,
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
      let localMatrix = node.transform;
      if (movesBranch) {
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
      }
      if (node.type === 'frame' && node.clipChildren) renderer.clip(0, 0, node.width, node.height);
      if (node.type === 'frame' || node.type === 'group') {
        for (const childId of node.childIds) {
          const child = nodes.get(childId);
          if (child !== undefined) {
            renderNode(child, pageMatrix, opacity, ancestorMoved || movesBranch);
          }
        }
      }
      renderer.restore();
    };
    const activePage = document.pages.find((page) => page.id === document.activePageId);
    if (activePage === undefined) return;
    renderer.save();
    renderer.translate(originX, originY);
    for (const rootId of activePage.rootNodeIds) {
      const root = nodes.get(rootId);
      if (root !== undefined) renderNode(root, IDENTITY_MATRIX, 1, false);
    }
    if (visual?.marquee !== null && visual?.marquee !== undefined) {
      const source = visual.marquee;
      const x = Math.min(source.x, source.x + source.width);
      const y = Math.min(source.y, source.y + source.height);
      const width = Math.abs(source.width);
      const height = Math.abs(source.height);
      renderer.save();
      renderer.setGlobalAlpha(1);
      renderer.beginPath();
      renderer.roundRect(x, y, width, height, 0);
      renderer.fill('rgba(37, 99, 235, 0.12)');
      renderer.stroke('#2563eb', 1);
      renderer.restore();
    }
    renderer.restore();
  }

  private routeCanvasPointer(event: VectoJSEvent): void {
    const routeVersion = ++this.pointerRouteVersion;
    const captured = this.snapshotPointerEvent(event);
    if (this.pointerRouteVersion !== routeVersion) return;
    if (!captured.ok) {
      this.rejectInvalidNativePointer(event, captured);
      return;
    }
    const native = captured.value;
    const pointerId = native.pointerId;
    if (this.quarantinedPointerIds.has(pointerId)) {
      if (event.type === 'pointerup' || event.type === 'pointercancel') {
        this.quarantinedPointerIds.delete(pointerId);
      }
      return;
    }

    if (event.type === 'pointercancel') {
      const session = this.selectionSession;
      if (session === null || this.selectionPointerId !== pointerId) return;
      const effect = session.cancel({ kind: 'pointercancel', pointerId });
      this.closeSelectionSession(session);
      this.selectionInterpreter.apply(effect);
      event.preventDefault();
      return;
    }

    if (event.type === 'pointerdown') {
      this.routeCanvasPointerDown(event, native, routeVersion);
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
    if (!this.authoringEnabled) return;
    const pointerId = native.pointerId;
    if (this.selectionSession !== null) {
      if (this.selectionPointerId !== pointerId) this.quarantinedPointerIds.add(pointerId);
      return;
    }
    const supported = native.button === 0 && !native.altKey && !native.ctrlKey && !native.metaKey;
    if (!supported) {
      this.quarantinedPointerIds.add(pointerId);
      return;
    }
    const sampled = this.selectionSample(event, native);
    if (!sampled.ok) {
      this.rejectPointer(pointerId, sampled.error);
      return;
    }

    if (this.activeTool !== 'select') {
      const result = this.ports.createAt(
        this.activeTool,
        sampled.value.pagePoint.x,
        sampled.value.pagePoint.y,
      );
      if (result.ok) this.scene?.markDirty();
      return;
    }

    let start: SelectionInteractionStart;
    try {
      start = this.ports.beginSelectionInteraction();
    } catch {
      if (this.pointerRouteVersion !== routeVersion || this.selectionSession !== null) return;
      this.rejectPointer(pointerId, {
        code: 'interaction.begin-threw',
        path: '/beginSelectionInteraction',
      });
      return;
    }
    if (this.pointerRouteVersion !== routeVersion || this.selectionSession !== null) return;
    const begun = MarqueeSelectionSession.begin(start, sampled.value, this.selectionProvider);
    if (this.pointerRouteVersion !== routeVersion || this.selectionSession !== null) return;
    if (!begun.ok) {
      this.rejectPointer(pointerId, begun.error);
      return;
    }
    this.selectionSession = begun.value;
    this.selectionPointerId = pointerId;
    this.terminalInteraction = null;
    event.preventDefault();
  }

  private snapshotPointerEvent(event: VectoJSEvent): NativePointerSnapshotResult {
    let source:
      | {
          readonly pointerId?: number;
          readonly button?: number;
          readonly shiftKey?: boolean;
          readonly altKey?: boolean;
          readonly ctrlKey?: boolean;
          readonly metaKey?: boolean;
        }
      | undefined;
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
    failure: Extract<NativePointerSnapshotResult, { ok: false }>,
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
    const localX = event.localX;
    const localY = event.localY;
    const viewport = viewportPoint(localX ?? Number.NaN, localY ?? Number.NaN);
    if (!viewport.ok) return viewport;
    const page = viewportToPagePoint(viewport.value);
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

  private routeEditorShortcut(event: VectoJSEvent): void {
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
    const result =
      action === 'delete' ? this.ports.deleteSelection() : this.ports.runHistory(action);
    if (result.ok) this.scene?.markDirty();
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
