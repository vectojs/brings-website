import type {
  NodeId,
  ResizeBounds,
  ResizeHandlePosition,
  Result,
  SelectionResizeProposal,
  SelectionResizeProposalInput,
  StructuralSelection,
} from '@vectojs/brings-core';
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

/** Detached Core resize geometry captured with one interaction token. */
export type ResizeInteractionStart = Readonly<{
  token: SelectionInteractionToken;
  selection: StructuralSelection;
  bounds: ResizeBounds;
  handles: readonly ResizeHandlePosition[];
}>;

/** One token-bound Core resize proposal safe to preview and commit exactly once. */
export type ResizeInteractionProposal = Readonly<{
  token: SelectionInteractionToken;
  selection: StructuralSelection;
  input: SelectionResizeProposalInput;
  resize: SelectionResizeProposal;
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

/** Synchronous Core proposal boundary consumed by the pure resize session. */
export type ResizeProposalProvider = Readonly<{
  resize: (
    start: ResizeInteractionStart,
    input: SelectionResizeProposalInput,
  ) => Result<ResizeInteractionProposal>;
}>;
