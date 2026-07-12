import { type A11yAttributes, type ContentProjection, Entity, type IRenderer } from '@vectojs/core';
import { type EditorLayout, resolveEditorLayout } from './layout';

export type DrawerSide = 'left' | 'right';

class EditorRegion extends Entity {
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

  public override getA11yAttributes(): A11yAttributes {
    return this.attributes;
  }

  public override isPointInside(): boolean {
    return false;
  }

  public override render(_renderer: IRenderer): void {}
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
  private activeDrawer: DrawerSide | null = null;
  private layout: EditorLayout;

  public constructor(width: number, height: number) {
    super('brings-editor-shell');
    this.interactive = true;
    this.add(this.toolbar);
    this.add(this.layers);
    this.add(this.canvasRegion);
    this.add(this.properties);
    this.toolbar.add(this.title);
    this.layers.add(this.pagesLabel);
    this.layers.add(this.layersLabel);
    this.canvasRegion.add(this.workspaceLabel);
    this.canvasRegion.add(this.mobileModeLabel);
    this.canvasRegion.add(this.mobileModeNotice);
    this.properties.add(this.propertiesLabel);
    this.layout = resolveEditorLayout(width, height);
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
}
