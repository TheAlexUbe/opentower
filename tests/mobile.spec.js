import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true });

test('phone layout keeps the scope, tabs and primary CTA usable', async ({ page }) => {
  await page.goto('/?debug');
  await expect(page.locator('#start')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'SCENARIO' })).toBeVisible();

  const startMetrics = await page.evaluate(() => {
    const button = document.querySelector('#btn-start').getBoundingClientRect();
    return { buttonBottom: button.bottom, viewport: innerHeight, scrollWidth: document.documentElement.scrollWidth, width: innerWidth };
  });
  expect(startMetrics.buttonBottom).toBeLessThanOrEqual(startMetrics.viewport);
  expect(startMetrics.scrollWidth).toBeLessThanOrEqual(startMetrics.width);

  await page.locator('#live-wx').uncheck();
  await page.locator('#btn-start').click();
  await page.waitForFunction(() => Boolean(window.__opentower?.engine));
  await expect(page.getByRole('tab', { name: /FLIGHT STRIPS/ })).toBeVisible();
  await expect(page.getByRole('tab', { name: /RADIO/ })).toBeVisible();

  const layout = await page.evaluate(() => {
    const scope = document.querySelector('.scope-wrap').getBoundingClientRect();
    const canvas = document.querySelector('#scope').getBoundingClientRect();
    const ghost = document.querySelector('#btn-pause').getBoundingClientRect();
    const cmd = getComputedStyle(document.querySelector('#cmd'));
    return {
      scopeHeight: scope.height,
      viewport: innerHeight,
      compact: window.__opentower.renderer.compact,
      rendererHeight: window.__opentower.renderer.cssH,
      canvasHeight: canvas.height,
      ghostHeight: ghost.height,
      inputFontSize: cmd.fontSize,
      scrollWidth: document.documentElement.scrollWidth,
      width: innerWidth,
    };
  });
  expect(layout.scopeHeight).toBeGreaterThanOrEqual(layout.viewport * 0.42);
  expect(layout.compact).toBe(true);
  expect(Math.abs(layout.rendererHeight - layout.canvasHeight)).toBeLessThan(2);
  expect(layout.ghostHeight).toBeGreaterThanOrEqual(34);
  expect(Number.parseFloat(layout.inputFontSize)).toBeGreaterThanOrEqual(16);
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);

  await page.evaluate(() => {
    const engine = window.__opentower.engine;
    engine.aircraft = [];
    engine.spawn('arrival');
    engine.spawn('departure');
  });
  await expect(page.locator('#panel-strips')).toBeVisible();
  await expect(page.locator('#panel-radio')).toBeHidden();
  await expect(page.locator('.strip')).toHaveCount(2);

  await page.locator('#tab-radio').click();
  await expect(page.locator('#panel-radio')).toBeVisible();
  await expect(page.locator('#panel-strips')).toBeHidden();
  await expect(page.locator('#radio')).toContainText('PILOT');

  await page.locator('#tab-strips').click();
  await expect(page.locator('#panel-strips')).toBeVisible();
});

test('language switch refreshes the scenario description and CTA', async ({ page }) => {
  await page.goto('/?debug');
  await page.selectOption('#scenario-select', 'tracon');
  await page.locator('#lang-chips button[data-lang="es"]').click();

  await expect(page.locator('#scenario-desc')).toContainText('vectoriza');
  await expect(page.locator('#btn-start')).toContainText('EMPEZAR APROXIMACIÓN');
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
});

test('short landscape keeps the CTA and scope usable without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/?debug');
  const start = await page.evaluate(() => {
    const button = document.querySelector('#btn-start').getBoundingClientRect();
    return { bottom: button.bottom, viewport: innerHeight, scrollWidth: document.documentElement.scrollWidth, width: innerWidth };
  });
  expect(start.bottom).toBeLessThanOrEqual(start.viewport);
  expect(start.scrollWidth).toBeLessThanOrEqual(start.width);

  await page.locator('#live-wx').uncheck();
  await page.locator('#btn-start').click();
  await page.waitForFunction(() => Boolean(window.__opentower?.engine));
  const layout = await page.evaluate(() => {
    const scope = document.querySelector('.scope-wrap').getBoundingClientRect();
    return { scopeHeight: scope.height, scrollWidth: document.documentElement.scrollWidth, width: innerWidth };
  });
  expect(layout.scopeHeight).toBeGreaterThanOrEqual(180);
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);
});
