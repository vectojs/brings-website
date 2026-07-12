import {
  createDocumentStore,
  type BringsDocumentStore,
  type EditorSnapshot,
} from '@vectojs/brings-core';

/** Caller-owned allocation boundary for document and initial-page identities. */
export type UuidFactory = () => string;

/**
 * Owns durable Brings Core state for one browser editor session. VectoJS views
 * consume its detached snapshots rather than keeping a parallel document model.
 */
export class BringsEditorController {
  private readonly store: BringsDocumentStore;

  public constructor(createUuid: UuidFactory) {
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
}
