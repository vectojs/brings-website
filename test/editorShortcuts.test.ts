import { describe, expect, test } from 'bun:test';
import { isNativeEditorTarget, resolveEditorShortcut } from '../src/view/editorShortcuts';

describe('editor shortcuts', () => {
  test.each([
    [{ key: 'z', ctrlKey: true, metaKey: false, shiftKey: false }, 'undo'],
    [{ key: 'Z', ctrlKey: false, metaKey: true, shiftKey: false }, 'undo'],
    [{ key: 'z', ctrlKey: true, metaKey: false, shiftKey: true }, 'redo'],
    [{ key: 'y', ctrlKey: true, metaKey: false, shiftKey: false }, 'redo'],
    [{ key: 'y', ctrlKey: false, metaKey: true, shiftKey: false }, null],
  ] as const)('resolves history event %o to %s', (event, expected) => {
    expect(resolveEditorShortcut(event)).toBe(expected);
  });

  test.each([
    [{ key: 'Delete', ctrlKey: false, metaKey: false, shiftKey: false }, 'delete'],
    [{ key: 'Backspace', ctrlKey: false, metaKey: false, shiftKey: false }, 'delete'],
    [{ key: 'Delete', ctrlKey: true, metaKey: false, shiftKey: false }, null],
    [{ key: 'Delete', ctrlKey: false, metaKey: true, shiftKey: false }, null],
    [{ key: 'Backspace', ctrlKey: true, metaKey: false, shiftKey: false }, null],
    [{ key: 'Backspace', ctrlKey: false, metaKey: true, shiftKey: false }, null],
    [{ key: 'Delete', ctrlKey: false, metaKey: false, altKey: true, shiftKey: false }, null],
    [{ key: 'Backspace', ctrlKey: false, metaKey: false, altKey: true, shiftKey: false }, null],
    [{ key: 'Delete', ctrlKey: false, metaKey: false, shiftKey: true }, null],
    [{ key: 'Backspace', ctrlKey: false, metaKey: false, shiftKey: true }, null],
  ] as const)('resolves deletion event %o to %s', (event, expected) => {
    expect(resolveEditorShortcut(event)).toBe(expected);
  });

  test.each([
    [{ tagName: 'input' }, true],
    [{ tagName: 'TEXTAREA' }, true],
    [{ tagName: 'div', isContentEditable: true }, true],
    [{ tagName: 'div', isContentEditable: false }, false],
    [null, false],
  ] as const)('classifies native editor target %o', (target, expected) => {
    expect(isNativeEditorTarget(target as EventTarget | null)).toBe(expected);
  });
});
