import { expect, test } from 'bun:test';
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
