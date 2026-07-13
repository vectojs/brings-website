import { describe, expect, test } from 'bun:test';
import { isNativeHistoryTarget, resolveHistoryShortcut } from '../src/view/historyShortcuts';

describe('history shortcuts', () => {
  test.each([
    [{ key: 'z', ctrlKey: true, metaKey: false, shiftKey: false }, 'undo'],
    [{ key: 'Z', ctrlKey: false, metaKey: true, shiftKey: false }, 'undo'],
    [{ key: 'z', ctrlKey: true, metaKey: false, shiftKey: true }, 'redo'],
    [{ key: 'y', ctrlKey: true, metaKey: false, shiftKey: false }, 'redo'],
    [{ key: 'y', ctrlKey: false, metaKey: true, shiftKey: false }, null],
  ] as const)('resolves %o to %s', (event, expected) => {
    expect(resolveHistoryShortcut(event)).toBe(expected);
  });

  test.each([
    [{ tagName: 'input' }, true],
    [{ tagName: 'TEXTAREA' }, true],
    [{ tagName: 'div', isContentEditable: true }, true],
    [{ tagName: 'div', isContentEditable: false }, false],
    [null, false],
  ] as const)('classifies native editor target %o', (target, expected) => {
    expect(isNativeHistoryTarget(target as EventTarget | null)).toBe(expected);
  });
});
