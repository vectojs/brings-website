import type { EditorSnapshot, NodeId, SceneNode } from '@vectojs/brings-core';

export type EditorCommandState = Readonly<{
  canSelectAll: boolean;
  canDelete: boolean;
  canGroup: boolean;
  canUngroup: boolean;
  canBringForward: boolean;
  canBringFront: boolean;
  canSendBackward: boolean;
  canSendBack: boolean;
}>;

function childIds(node: SceneNode | undefined): readonly NodeId[] | null {
  return node?.type === 'frame' || node?.type === 'group' ? node.childIds : null;
}

/** Derive one immutable command surface shared by menus, shortcuts, and tests. */
export function deriveEditorCommandState(snapshot: EditorSnapshot): EditorCommandState {
  const page = snapshot.document.pages.find(
    (candidate) => candidate.id === snapshot.document.activePageId,
  );
  const nodes = new Map(snapshot.document.nodes.map((node) => [node.id, node]));
  const selectedNodes = snapshot.selection.nodeIds
    .map((nodeId) => nodes.get(nodeId))
    .filter((node): node is SceneNode => node !== undefined);
  const selected = selectedNodes.length > 0;
  const sharedParent = selectedNodes[0]?.parentId;
  const canGroup =
    selectedNodes.length >= 2 && selectedNodes.every((node) => node.parentId === sharedParent);
  const activeNode =
    snapshot.selection.nodeIds.length === 1 && snapshot.selection.activeNodeId !== null
      ? nodes.get(snapshot.selection.activeNodeId)
      : undefined;
  const siblings =
    activeNode === undefined
      ? null
      : activeNode.parentId === null
        ? (page?.rootNodeIds ?? null)
        : childIds(nodes.get(activeNode.parentId));
  const siblingIndex = siblings?.indexOf(activeNode?.id as NodeId) ?? -1;
  const canMoveBackward = siblingIndex > 0;
  const canMoveForward =
    siblings !== null && siblingIndex >= 0 && siblingIndex < siblings.length - 1;

  return Object.freeze({
    canSelectAll: (page?.rootNodeIds.length ?? 0) > 0,
    canDelete: selected,
    canGroup,
    canUngroup: activeNode?.type === 'group',
    canBringForward: canMoveForward,
    canBringFront: canMoveForward,
    canSendBackward: canMoveBackward,
    canSendBack: canMoveBackward,
  });
}
