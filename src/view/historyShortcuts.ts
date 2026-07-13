export type HistoryAction = 'undo' | 'redo';

export interface HistoryShortcutEvent {
  readonly key?: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}

/** Resolve platform history chords without coupling them to browser listeners. */
export function resolveHistoryShortcut(event: HistoryShortcutEvent): HistoryAction | null {
  const key = event.key?.toLowerCase();
  const primaryModifier = event.ctrlKey || event.metaKey;
  if (primaryModifier && key === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (event.ctrlKey && key === 'y') return 'redo';
  return null;
}

/** Keep native editor history owned by its input, textarea, or editable host. */
export function isNativeHistoryTarget(target: EventTarget | null): boolean {
  if (target === null || typeof target !== 'object') return false;
  const candidate = target as { readonly tagName?: unknown; readonly isContentEditable?: unknown };
  const tagName = typeof candidate.tagName === 'string' ? candidate.tagName.toUpperCase() : '';
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || candidate.isContentEditable === true;
}
