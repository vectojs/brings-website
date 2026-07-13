import { expect, test } from '@playwright/test';

test('projects one named Brings application shell', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('canvas')).toHaveCount(1);
  await expect(page.getByRole('application', { name: 'Brings design editor' })).toBeVisible();
  await expect(page.getByRole('toolbar', { name: 'Tools' })).toBeVisible();
  await expect(page.getByRole('tree', { name: 'Layers' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Design canvas' })).toBeVisible();
});

test('loads the headless DevTools model only for debug sessions', async ({ page }) => {
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => Reflect.has(window, '__brings'))).toBe(false);

  await page.goto('/?debug');
  await page.waitForFunction(() => Reflect.has(window, '__brings'));
  await expect(page.locator('canvas')).toHaveCount(1);
  await expect
    .poll(() => page.evaluate(() => typeof Reflect.get(window, '__brings')))
    .toBe('object');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const debug = Reflect.get(window, '__brings') as {
          snapshot: () => { document: { revision: number; pages: readonly { name: string }[] } };
        };
        const snapshot = debug.snapshot();
        return { revision: snapshot.document.revision, pageName: snapshot.document.pages[0]?.name };
      }),
    )
    .toEqual({ revision: 0, pageName: 'Page 1' });
});

test('does not project closed compact drawers over the design canvas', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/?debug');
  await page.waitForFunction(() => Reflect.has(window, '__brings'));

  await expect(page.getByRole('group', { name: 'Properties' })).toHaveCount(0);
  const findings = await page.evaluate(() => {
    const debug = Reflect.get(window, '__brings') as { audit: () => unknown[] };
    return debug.audit();
  });
  expect(findings).toEqual([]);
});

test('creates a Frame and nested Rectangle through canvas-native tools', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?debug');
  await page.waitForFunction(() => Reflect.has(window, '__brings'));

  await page.getByRole('button', { name: /Frame/ }).click();
  await page.getByRole('region', { name: 'Design canvas' }).click({ position: { x: 180, y: 164 } });
  await page.getByRole('button', { name: /Rectangle/ }).click();
  await page.getByRole('region', { name: 'Design canvas' }).click({ position: { x: 220, y: 204 } });

  await expect
    .poll(() =>
      page.evaluate(() => {
        const debug = Reflect.get(window, '__brings') as {
          snapshot: () => {
            document: {
              revision: number;
              nodes: readonly { type: string; parentId: string | null }[];
            };
          };
        };
        return debug.snapshot().document;
      }),
    )
    .toMatchObject({
      revision: 2,
      nodes: [
        { type: 'frame', parentId: null },
        { type: 'rectangle', parentId: expect.any(String) },
      ],
    });
});

test('selects the frontmost shape from the canvas without changing document history', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?debug');
  await page.waitForFunction(() => Reflect.has(window, '__brings'));

  const canvas = page.getByRole('region', { name: 'Design canvas' });
  await page.getByRole('button', { name: /Frame/ }).click();
  await canvas.click({ position: { x: 180, y: 164 } });
  await page.getByRole('button', { name: /Rectangle/ }).click();
  await canvas.click({ position: { x: 220, y: 204 } });
  await page.getByRole('button', { name: /Select/ }).click();
  await canvas.click({ position: { x: 220, y: 204 } });

  await expect
    .poll(() =>
      page.evaluate(() => {
        const debug = Reflect.get(window, '__brings') as {
          snapshot: () => {
            document: { revision: number; nodes: readonly { id: string; type: string }[] };
            selection: { nodeIds: readonly string[]; activeNodeId: string | null };
            undoDepth: number;
          };
        };
        const snapshot = debug.snapshot();
        const selectedNode = snapshot.document.nodes.find(
          (node) => node.id === snapshot.selection.activeNodeId,
        );
        return {
          revision: snapshot.document.revision,
          undoDepth: snapshot.undoDepth,
          selectedType: selectedNode?.type ?? null,
          selectedCount: snapshot.selection.nodeIds.length,
        };
      }),
    )
    .toEqual({ revision: 2, undoDepth: 2, selectedType: 'rectangle', selectedCount: 1 });
});
