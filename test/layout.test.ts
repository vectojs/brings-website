import { expect, test } from 'bun:test';
import { resolveEditorLayout } from '../src/view/layout';

test('uses both fixed panels on a wide desktop scene', () => {
  expect(resolveEditorLayout(1440, 900)).toEqual({
    toolbarHeight: 56,
    leftPanel: { mode: 'visible', width: 240 },
    rightPanel: { mode: 'visible', width: 296 },
    viewport: { x: 240, y: 56, width: 904, height: 844 },
  });
});

test('turns the properties panel into a drawer on a constrained desktop scene', () => {
  expect(resolveEditorLayout(1024, 768)).toEqual({
    toolbarHeight: 56,
    leftPanel: { mode: 'visible', width: 240 },
    rightPanel: { mode: 'drawer', width: 296 },
    viewport: { x: 240, y: 56, width: 784, height: 712 },
  });
});

test('uses mutually exclusive drawers below the tablet breakpoint', () => {
  expect(resolveEditorLayout(700, 600)).toEqual({
    toolbarHeight: 56,
    leftPanel: { mode: 'drawer', width: 240 },
    rightPanel: { mode: 'drawer', width: 296 },
    viewport: { x: 0, y: 56, width: 700, height: 544 },
  });
});

test('never produces a negative canvas viewport on a constrained host', () => {
  expect(resolveEditorLayout(1, 1).viewport).toEqual({
    x: 0,
    y: 56,
    width: 1,
    height: 0,
  });
});
