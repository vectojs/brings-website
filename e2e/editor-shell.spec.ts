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
