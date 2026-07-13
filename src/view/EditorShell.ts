import {
  type A11yAttributes,
  type ContentProjection,
  Entity,
  type IRenderer,
  type VectoJSEvent,
} from '@vectojs/core';
import type { EditorSnapshot, Result, SceneNode } from '@vectojs/brings-core';
import { type EditorLayout, resolveEditorLayout } from './layout';

export type DrawerSide = 'left' | 'right';

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

type CreationTool = 'frame' | 'rectangle';
type CanvasTool = 'select' | CreationTool;
type DragPreview = Readonly<{ deltaX: number; deltaY: number }>;
type DragSession = Readonly<{ startX: number; startY: number }>;

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
  private dragSession: DragSession | null = null;
  private dragPreview: DragPreview | null = null;
  private layout: EditorLayout;

  public constructor(
    width: number,
    height: number,
    private readonly documentSnapshot: () => EditorSnapshot = () => ({
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
    }),
    private readonly createAt: (
      tool: CreationTool,
      x: number,
      y: number,
    ) => Result<EditorSnapshot> = () => ({
      ok: false,
      error: { code: 'shape.unavailable', path: '/' },
    }),
    private readonly selectAt: (x: number, y: number) => Result<EditorSnapshot> = () => ({
      ok: false,
      error: { code: 'selection.unavailable', path: '/' },
    }),
    private readonly moveSelectionBy: (
      deltaX: number,
      deltaY: number,
    ) => Result<EditorSnapshot> = () => ({
      ok: false,
      error: { code: 'transform.unavailable', path: '/' },
    }),
  ) {
    super('brings-editor-shell');
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
    this.layout = resolveEditorLayout(width, height);
    this.canvasRegion.setPointerHandler((event) => this.routeCanvasPointer(event));
    this.resize(width, height);
  }

  /** True while the narrow-screen shell supports editing tools. */
  public get authoringEnabled(): boolean {
    return this.width >= 600;
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
    const snapshot = this.documentSnapshot();
    const document = snapshot.document;
    const selected = new Set(snapshot.selection.nodeIds);
    const nodes = new Map(document.nodes.map((node) => [node.id, node]));
    const renderNode = (node: SceneNode, parentX: number, parentY: number): void => {
      if (!node.visible) return;
      const preview = selected.has(node.id) ? this.dragPreview : null;
      const x = parentX + node.transform[4] + (preview?.deltaX ?? 0);
      const y = parentY + node.transform[5] + (preview?.deltaY ?? 0);
      if (node.type === 'frame' || node.type === 'rectangle') {
        renderer.save();
        renderer.setGlobalAlpha(node.opacity);
        renderer.beginPath();
        renderer.roundRect(x, y, node.width, node.height, [...node.cornerRadii]);
        const fill = node.type === 'frame' ? node.background : node.fill;
        if (fill !== null) renderer.fill(this.paint(fill));
        if (node.stroke !== null) renderer.stroke(this.paint(node.stroke.paint), node.stroke.width);
        if (selected.has(node.id)) {
          renderer.beginPath();
          renderer.roundRect(x - 2, y - 2, node.width + 4, node.height + 4, [...node.cornerRadii]);
          renderer.stroke('#2563eb', 2);
        }
        renderer.restore();
      }
      if (node.type === 'frame' || node.type === 'group') {
        for (const childId of node.childIds) {
          const child = nodes.get(childId);
          if (child !== undefined) renderNode(child, x, y);
        }
      }
    };
    const activePage = document.pages.find((page) => page.id === document.activePageId);
    if (activePage === undefined) return;
    renderer.save();
    renderer.translate(originX, originY);
    for (const rootId of activePage.rootNodeIds) {
      const root = nodes.get(rootId);
      if (root !== undefined) renderNode(root, 0, 0);
    }
    renderer.restore();
  }

  private routeCanvasPointer(event: VectoJSEvent): void {
    if (!this.authoringEnabled) return;
    const x = event.localX ?? 0;
    const y = event.localY ?? 0;

    if (event.type === 'pointercancel') {
      this.clearDragPreview();
      return;
    }
    if (event.type === 'pointermove') {
      if (this.dragSession === null) return;
      this.dragPreview = {
        deltaX: x - this.dragSession.startX,
        deltaY: y - this.dragSession.startY,
      };
      this.scene?.markDirty();
      return;
    }
    if (event.type === 'pointerup') {
      if (this.dragSession === null) return;
      const deltaX = x - this.dragSession.startX;
      const deltaY = y - this.dragSession.startY;
      this.clearDragPreview();
      if (deltaX !== 0 || deltaY !== 0) this.moveSelectionBy(deltaX, deltaY);
      this.scene?.markDirty();
      return;
    }
    if (event.type !== 'pointerdown') return;

    if (this.activeTool !== 'select') {
      const result = this.createAt(this.activeTool, x, y);
      if (result.ok) this.scene?.markDirty();
      return;
    }

    const result = this.selectAt(x, y);
    if (!result.ok) return;
    this.dragSession =
      result.value.selection.nodeIds.length === 0 ? null : { startX: x, startY: y };
    this.dragPreview = null;
    this.scene?.markDirty();
  }

  private clearDragPreview(): void {
    if (this.dragSession === null && this.dragPreview === null) return;
    this.dragSession = null;
    this.dragPreview = null;
    this.scene?.markDirty();
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
