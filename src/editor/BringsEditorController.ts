import {
  createDocumentStore,
  type BringsError,
  type BringsDocumentStore,
  type EditorSnapshot,
  type Result,
} from '@vectojs/brings-core';

/** Caller-owned allocation boundary for document and initial-page identities. */
export type UuidFactory = () => string;

/**
 * Owns durable Brings Core state for one browser editor session. VectoJS views
 * consume its detached snapshots rather than keeping a parallel document model.
 */
export class BringsEditorController {
  private readonly store: BringsDocumentStore;
  private readonly createUuid: UuidFactory;
  private activeFrameId: string | null = null;

  public constructor(createUuid: UuidFactory) {
    this.createUuid = createUuid;
    const created = createDocumentStore({
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
    return result;
  }

  /** Create a Rectangle in the latest Frame created by this local editor session. */
  public createRectangleAt(x: number, y: number): Result<EditorSnapshot> {
    if (this.activeFrameId === null) return this.failure('shape.frame-required', '/parentId');
    const snapshot = this.store.snapshot();
    const frame = snapshot.document.nodes.find((node) => node.id === this.activeFrameId);
    if (frame?.type !== 'frame') return this.failure('shape.frame-required', '/parentId');
    const localX = Math.max(0, Math.min(frame.width - 120, x - frame.transform[4]));
    const localY = Math.max(0, Math.min(frame.height - 80, y - frame.transform[5]));
    return this.store.execute({
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
  }

  private failure(code: string, path: string): Result<never> {
    const error: BringsError = { code, path };
    return { ok: false, error };
  }
}
