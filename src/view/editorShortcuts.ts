export type EditorShortcutAction = 'undo' | 'redo' | 'delete' | 'group' | 'ungroup';

export interface EditorShortcutEvent {
  readonly key?: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey?: boolean;
  readonly shiftKey: boolean;
}

/** Resolve platform editor chords without coupling them to browser listeners. */
export function resolveEditorShortcut(event: EditorShortcutEvent): EditorShortcutAction | null {
  const key = event.key?.toLowerCase();
  const primaryModifier = event.ctrlKey || event.metaKey;
  if (primaryModifier && key === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (event.ctrlKey && key === 'y') return 'redo';
  if (primaryModifier && key === 'g') return event.shiftKey ? 'ungroup' : 'group';
  const deletionModifier = primaryModifier || event.altKey === true || event.shiftKey;
  if (!deletionModifier && (key === 'delete' || key === 'backspace')) return 'delete';
  return null;
}

/** Keep native editor shortcuts owned by their input, textarea, or editable host. */
export function isNativeEditorTarget(target: EventTarget | null): boolean {
  if (target === null || typeof target !== 'object') return false;
  const candidate = target as { readonly tagName?: unknown; readonly isContentEditable?: unknown };
  const tagName = typeof candidate.tagName === 'string' ? candidate.tagName.toUpperCase() : '';
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || candidate.isContentEditable === true;
}
