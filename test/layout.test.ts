import { expect, test } from 'bun:test';
import { resolveEditorLayout } from '../src/view/layout';

test('uses both fixed panels on a wide desktop scene', () => {
  expect(resolveEditorLayout(1440, 900)).toEqual({
    toolbarHeight: 48,
    leftPanel: { mode: 'visible', width: 248 },
    rightPanel: { mode: 'visible', width: 280 },
    viewport: { x: 248, y: 48, width: 912, height: 852 },
  });
});

test('turns the properties panel into a drawer on a constrained desktop scene', () => {
  expect(resolveEditorLayout(1024, 768)).toEqual({
    toolbarHeight: 48,
    leftPanel: { mode: 'visible', width: 248 },
    rightPanel: { mode: 'drawer', width: 280 },
    viewport: { x: 248, y: 48, width: 776, height: 720 },
  });
});

test('uses mutually exclusive drawers below the tablet breakpoint', () => {
  expect(resolveEditorLayout(700, 600)).toEqual({
    toolbarHeight: 48,
    leftPanel: { mode: 'drawer', width: 248 },
    rightPanel: { mode: 'drawer', width: 280 },
    viewport: { x: 0, y: 48, width: 700, height: 552 },
  });
});

test('never produces a negative canvas viewport on a constrained host', () => {
  expect(resolveEditorLayout(1, 1).viewport).toEqual({
    x: 0,
    y: 48,
    width: 1,
    height: 0,
  });
});
