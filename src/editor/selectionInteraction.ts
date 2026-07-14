import type { NodeId, Result, StructuralSelection } from '@vectojs/brings-core';
import type { EditorPagePoint, EditorPageRect } from './selectionCoordinates';

/** Durable and ephemeral versions captured when one selection gesture begins. */
export type SelectionInteractionToken = Readonly<{
  documentRevision: number;
  selectionGeneration: number;
}>;

/** Detached selection state captured at the beginning of one interaction. */
export type SelectionInteractionStart = Readonly<{
  token: SelectionInteractionToken;
  selection: StructuralSelection;
}>;

/** Pure normalized selection proposed against one captured interaction token. */
export type SelectionProposal = Readonly<{
  token: SelectionInteractionToken;
  originalSelection: StructuralSelection;
  selection: StructuralSelection;
}>;

export type PointSelectionMode = 'replace' | 'toggle' | 'add-for-drag';
export type AreaSelectionMode = 'replace' | 'add';

/** Synchronous proposal boundary consumed by the browser-free gesture session. */
export type SelectionProposalProvider = Readonly<{
  point: (
    start: SelectionInteractionStart,
    point: EditorPagePoint,
    mode: PointSelectionMode,
  ) => Result<Readonly<{ proposal: SelectionProposal; ownerId: NodeId | null }>>;
  area: (
    start: SelectionInteractionStart,
    rect: EditorPageRect,
    mode: AreaSelectionMode,
  ) => Result<SelectionProposal>;
}>;
