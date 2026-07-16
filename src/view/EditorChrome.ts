import { type A11yAttributes, type ContentProjection, Entity, type IRenderer } from '@vectojs/core';

/** A reusable command surface for editor chrome and history controls. */
export class ToolbarButton extends Entity {
  private active = false;
  private enabled = true;
  private visible = true;
  private hovered = false;

  public constructor(
    id: string,
    private readonly label: string,
    private readonly glyph: string,
    private readonly onActivate: () => void,
  ) {
    super(id);
    this.interactive = true;
    this.on('pointerdown', (event) => {
      event.preventDefault();
      if (!this.enabled) return;
      this.onActivate();
    });
    this.on('pointermove', () => {
      if (this.hovered) return;
      this.hovered = true;
      this.scene?.markDirty();
    });
    this.on('pointerleave', () => {
      if (!this.hovered) return;
      this.hovered = false;
      this.scene?.markDirty();
    });
    this.on('keydown', (event) => {
      if (!this.enabled || (event.key !== 'Enter' && event.key !== ' ')) return;
      event.preventDefault();
      this.onActivate();
    });
  }

  public setFrame(
    x: number,
    y: number,
    width: number,
    active: boolean,
    visible = true,
    enabled = true,
  ): void {
    this.x = x;
    this.y = y;
    this.width = visible ? width : 0;
    this.height = visible ? 36 : 0;
    this.active = active;
    this.visible = visible;
    this.enabled = enabled;
    // Disabled semantic buttons must stay projected for assistive technology,
    // but their VMT hit target remains inert.
    this.interactive = visible;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.interactive = this.visible;
  }

  public override getA11yAttributes(): A11yAttributes {
    const attributes: A11yAttributes = {
      role: 'button',
      label: this.active ? `${this.label} tool selected` : this.label,
    };
    if (!this.enabled) attributes.disabled = true;
    return attributes;
  }

  public override isPointInside(globalX: number, globalY: number): boolean {
    if (!this.enabled) return false;
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
    if (!this.visible) return;
    renderer.beginPath();
    renderer.roundRect(0, 0, this.width, this.height, 7);
    renderer.fill(
      this.active ? '#6558e8' : this.hovered && this.enabled ? '#34363f' : 'rgba(0, 0, 0, 0)',
    );
    renderer.fillText(
      this.glyph,
      this.width / 2 - (this.glyph.length > 1 ? 8 : 4),
      23,
      '600 15px system-ui, sans-serif',
      this.enabled ? '#f7f7fb' : '#686b75',
    );
  }
}

/** A passive camera status label owned by the canvas scene. */
export class ZoomReadout extends Entity {
  private visible = false;
  private zoomLevel = 1;

  public constructor() {
    super('brings-zoom-readout');
    this.interactive = false;
  }

  public setFrame(x: number, y: number, visible: boolean, zoom: number): void {
    this.x = x;
    this.y = y;
    this.width = visible ? 72 : 0;
    this.height = visible ? 32 : 0;
    this.visible = visible;
    this.zoomLevel = zoom;
  }

  public override getA11yAttributes(): A11yAttributes {
    return { role: 'status', label: `Zoom ${Math.round(this.zoomLevel * 100)}%` };
  }

  public override isPointInside(): boolean {
    return false;
  }

  public override render(renderer: IRenderer): void {
    if (!this.visible) return;
    renderer.fillText(
      `${Math.round(this.zoomLevel * 100)}%`,
      8,
      21,
      '600 12px system-ui, sans-serif',
      '#cbd5e1',
    );
  }
}

/** A projected explanation for the intentionally navigation-only narrow mode. */
export class MobileModeNotice extends Entity {
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

/** A lightweight retained-mode label shared by fixed editor surfaces. */
export class CanvasLabel extends Entity {
  private visible = false;

  public constructor(
    id: string,
    private text: string,
    private readonly font: string,
    private readonly color: string,
  ) {
    super(id);
  }

  public setText(text: string): void {
    this.text = text;
  }

  public setFrame(
    x: number,
    y: number,
    visible: boolean,
    maxWidth = Number.POSITIVE_INFINITY,
  ): void {
    this.x = x;
    this.y = y;
    this.width = visible ? Math.max(1, Math.min(maxWidth, this.text.length * 8)) : 0;
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
