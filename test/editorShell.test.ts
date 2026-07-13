import { expect, test } from 'bun:test';
import { VectoJSEvent } from '@vectojs/core';
import { EditorShell } from '../src/view/EditorShell';

function childById(shell: EditorShell, id: string) {
  const find = (
    candidates: readonly (typeof shell.children)[number][],
  ): (typeof shell.children)[number] | undefined => {
    for (const candidate of candidates) {
      if (candidate.id === id) return candidate;
      const nested = find(candidate.children);
      if (nested) return nested;
    }
    return undefined;
  };
  const child = find(shell.children);
  if (!child) throw new Error(`Missing editor region: ${id}`);
  return child;
}

test('projects the named Brings application and primary editor regions', () => {
  const shell = new EditorShell(1440, 900);

  expect(shell.getA11yAttributes()).toEqual({
    role: 'application',
    label: 'Brings design editor',
  });
  expect(shell.children.slice(0, 4).map((child) => child.getA11yAttributes())).toEqual([
    { role: 'toolbar', label: 'Tools' },
    { role: 'tree', label: 'Layers' },
    { role: 'region', label: 'Design canvas', tabIndex: 0 },
    { role: 'group', label: 'Properties' },
  ]);
});

test('keeps closed drawers out of hit testing and accessibility projection', () => {
  const shell = new EditorShell(1024, 768);
  const properties = childById(shell, 'brings-properties');

  expect(properties.interactive).toBe(false);
  expect({
    x: properties.x,
    y: properties.y,
    width: properties.width,
    height: properties.height,
  }).toEqual({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });

  expect(shell.openDrawer('right')).toBe(true);
  expect(properties.interactive).toBe(true);
  expect({
    x: properties.x,
    y: properties.y,
    width: properties.width,
    height: properties.height,
  }).toEqual({
    x: 728,
    y: 56,
    width: 296,
    height: 712,
  });
});

test('keeps mobile drawers exclusive and marks phone layouts view-only', () => {
  const shell = new EditorShell(700, 600);
  const layers = childById(shell, 'brings-layers');
  const properties = childById(shell, 'brings-properties');

  expect(layers.interactive).toBe(false);
  expect(properties.interactive).toBe(false);
  expect(shell.openDrawer('left')).toBe(true);
  expect(layers.interactive).toBe(true);
  expect(properties.interactive).toBe(false);

  expect(shell.openDrawer('right')).toBe(true);
  expect(layers.interactive).toBe(false);
  expect(properties.interactive).toBe(true);

  shell.resize(390, 600);
  expect(shell.authoringEnabled).toBe(false);
  const notice = childById(shell, 'brings-mobile-mode-notice');
  expect(notice.interactive).toBe(false);
  expect(notice.getContentProjection()).toMatchObject({
    text: 'Authoring tools are disabled on narrow screens. Use view, select, pan, and zoom.',
  });
});

test('projects static chrome labels without making them pointer targets', () => {
  const shell = new EditorShell(1440, 900);
  const title = childById(shell, 'brings-title');
  const workspace = childById(shell, 'brings-workspace-label');

  expect(title.interactive).toBe(false);
  expect(title.getContentProjection()).toMatchObject({ text: 'Brings' });
  expect(workspace.getContentProjection()).toMatchObject({
    text: 'Local-first design workspace',
  });
});

test('starts with the Select tool active so canvas clicks select instead of creating', () => {
  const shell = new EditorShell(1440, 900);
  const selectTool = childById(shell, 'brings-select-tool');

  expect(selectTool.getA11yAttributes()).toEqual({ role: 'button', label: 'Select tool selected' });
});

test('routes unmodified deletion from the focused VMT design region', () => {
  let deleteCalls = 0;
  let prevented = false;
  const shell = new EditorShell(1440, 900, {
    deleteSelection: () => {
      deleteCalls += 1;
      return { ok: false, error: { code: 'test.delete', path: '/' } };
    },
  });
  const canvasRegion = childById(shell, 'brings-canvas-region');
  const event = new VectoJSEvent('keydown', canvasRegion, {
    key: 'Delete',
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    target: { tagName: 'CANVAS' },
    preventDefault: () => {
      prevented = true;
    },
  });

  canvasRegion.dispatchEvent(event);

  expect(deleteCalls).toBe(1);
  expect(prevented).toBe(true);
  expect(event.propagationStopped).toBe(true);
});

test('yields modified deletion keys without consuming the focused VMT event', () => {
  let deleteCalls = 0;
  let prevented = 0;
  const shell = new EditorShell(1440, 900, {
    deleteSelection: () => {
      deleteCalls += 1;
      return { ok: false, error: { code: 'test.delete', path: '/' } };
    },
  });
  const canvasRegion = childById(shell, 'brings-canvas-region');
  const events = [
    { key: 'Delete', altKey: true, shiftKey: false },
    { key: 'Backspace', altKey: true, shiftKey: false },
    { key: 'Delete', altKey: false, shiftKey: true },
    { key: 'Backspace', altKey: false, shiftKey: true },
  ].map(
    ({ key, altKey, shiftKey }) =>
      new VectoJSEvent('keydown', canvasRegion, {
        key,
        ctrlKey: false,
        metaKey: false,
        altKey,
        shiftKey,
        target: { tagName: 'CANVAS' },
        preventDefault: () => {
          prevented += 1;
        },
      }),
  );

  for (const event of events) canvasRegion.dispatchEvent(event);

  expect(deleteCalls).toBe(0);
  expect(prevented).toBe(0);
  expect(events.map((event) => event.propagationStopped)).toEqual([false, false, false, false]);
});

test('yields deletion to native editors and ignores key events outside the design region', () => {
  let deleteCalls = 0;
  const shell = new EditorShell(1440, 900, {
    deleteSelection: () => {
      deleteCalls += 1;
      return { ok: false, error: { code: 'test.delete', path: '/' } };
    },
  });
  const canvasRegion = childById(shell, 'brings-canvas-region');
  const toolbar = childById(shell, 'brings-toolbar');

  canvasRegion.dispatchEvent(
    new VectoJSEvent('keydown', canvasRegion, {
      key: 'Backspace',
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      target: { tagName: 'INPUT' },
      preventDefault: () => undefined,
    }),
  );
  toolbar.dispatchEvent(
    new VectoJSEvent('keydown', toolbar, {
      key: 'Delete',
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      target: { tagName: 'CANVAS' },
      preventDefault: () => undefined,
    }),
  );

  expect(deleteCalls).toBe(0);
});
