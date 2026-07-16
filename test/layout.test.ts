import { expect, test } from 'bun:test';
import { resolveEditorLayout } from '../src/view/layout';

test('uses both fixed panels on a wide desktop scene', () => {
  expect(resolveEditorLayout(1440, 900)).toEqual({
    fileBarHeight: 48,
    leftPanel: { mode: 'visible', width: 248 },
    rightPanel: { mode: 'visible', width: 280 },
    viewport: { x: 248, y: 48, width: 912, height: 852 },
    toolDock: { mode: 'authoring', x: 480, y: 832, width: 448, height: 48 },
  });
});

test('turns the properties panel into a drawer on a constrained desktop scene', () => {
  expect(resolveEditorLayout(1024, 768)).toEqual({
    fileBarHeight: 48,
    leftPanel: { mode: 'visible', width: 248 },
    rightPanel: { mode: 'drawer', width: 280 },
    viewport: { x: 248, y: 48, width: 776, height: 720 },
    toolDock: { mode: 'authoring', x: 412, y: 700, width: 448, height: 48 },
  });
});

test('uses mutually exclusive drawers below the tablet breakpoint', () => {
  expect(resolveEditorLayout(700, 600)).toEqual({
    fileBarHeight: 48,
    leftPanel: { mode: 'drawer', width: 248 },
    rightPanel: { mode: 'drawer', width: 280 },
    viewport: { x: 0, y: 48, width: 700, height: 552 },
    toolDock: { mode: 'authoring', x: 126, y: 532, width: 448, height: 48 },
  });
});

test('keeps the authoring dock inside the reduced viewport at the panel breakpoint', () => {
  expect(resolveEditorLayout(780, 600)).toEqual({
    fileBarHeight: 48,
    leftPanel: { mode: 'visible', width: 248 },
    rightPanel: { mode: 'drawer', width: 280 },
    viewport: { x: 248, y: 48, width: 532, height: 552 },
    toolDock: { mode: 'authoring', x: 290, y: 532, width: 448, height: 48 },
  });
});

test('uses a navigation-only dock on phone layouts', () => {
  expect(resolveEditorLayout(390, 600)).toEqual({
    fileBarHeight: 48,
    leftPanel: { mode: 'drawer', width: 248 },
    rightPanel: { mode: 'drawer', width: 280 },
    viewport: { x: 0, y: 48, width: 390, height: 552 },
    toolDock: { mode: 'navigation', x: 91, y: 532, width: 208, height: 48 },
  });
});

test('never produces a negative canvas viewport on a constrained host', () => {
  expect(resolveEditorLayout(1, 1).viewport).toEqual({
    x: 0,
    y: 48,
    width: 1,
    height: 0,
  });
  expect(resolveEditorLayout(1, 1).toolDock).toEqual({
    mode: 'navigation',
    x: 0,
    y: 48,
    width: 0,
    height: 0,
  });
});
