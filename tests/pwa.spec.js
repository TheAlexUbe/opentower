import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'allow' });

test('PWA shell reloads while offline', async ({ page, context }) => {
  await page.goto('/?debug');
  await expect(page.locator('#start')).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));

  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#start')).toBeVisible();
  await expect(page.locator('#btn-start')).toBeVisible();
  await expect(page.locator('#scope')).toBeVisible();
  expect(await page.evaluate(() => Boolean(window.__opentower))).toBe(true);
});
