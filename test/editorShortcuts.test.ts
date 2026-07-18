import { describe, expect, test } from 'bun:test';
import { isNativeEditorTarget, resolveEditorShortcut } from '../src/view/editorShortcuts';

describe('editor shortcuts', () => {
  test.each([
    [{ key: 'z', ctrlKey: true, metaKey: false, shiftKey: false }, 'undo'],
    [{ key: 'Z', ctrlKey: false, metaKey: true, shiftKey: false }, 'undo'],
    [{ key: 'z', ctrlKey: true, metaKey: false, shiftKey: true }, 'redo'],
    [{ key: 'y', ctrlKey: true, metaKey: false, shiftKey: false }, 'redo'],
    [{ key: 'y', ctrlKey: false, metaKey: true, shiftKey: false }, null],
    [{ key: 'g', ctrlKey: true, metaKey: false, shiftKey: false }, 'group'],
    [{ key: 'G', ctrlKey: false, metaKey: true, shiftKey: true }, 'ungroup'],
    [{ key: 'a', ctrlKey: true, metaKey: false, shiftKey: false }, 'select-all'],
    [{ key: ']', ctrlKey: false, metaKey: false, shiftKey: false }, 'bring-forward'],
    [{ key: ']', ctrlKey: true, metaKey: false, shiftKey: false }, 'bring-front'],
    [{ key: '[', ctrlKey: false, metaKey: false, shiftKey: false }, 'send-backward'],
    [{ key: '[', ctrlKey: false, metaKey: true, shiftKey: false }, 'send-back'],
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
    ['v', 'tool-select'],
    ['F', 'tool-frame'],
    ['r', 'tool-rectangle'],
    ['O', 'tool-ellipse'],
    ['p', 'tool-pen'],
    ['t', 'tool-text'],
  ] as const)('maps unmodified %s to %s', (key, expected) => {
    expect(resolveEditorShortcut({ key, ctrlKey: false, metaKey: false, shiftKey: false })).toBe(
      expected,
    );
  });

  test.each([
    { key: 'o', ctrlKey: true, metaKey: false, shiftKey: false },
    { key: 'o', ctrlKey: false, metaKey: true, shiftKey: false },
    { key: 'o', ctrlKey: false, metaKey: false, altKey: true, shiftKey: false },
    { key: 'o', ctrlKey: false, metaKey: false, shiftKey: true },
  ])('does not switch tools for modified event %o', (event) => {
    expect(resolveEditorShortcut(event)).toBeNull();
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
