import { test, expect } from '@playwright/test';

/**
 * Boot the real app, turn off the external weather request and start a shift.
 * @param {import('@playwright/test').Page} page
 * @param {'free'|'tracon'} scenario
 */
async function boot(page, scenario = 'free') {
  await page.goto('/?debug');
  await expect(page.locator('#start')).toBeVisible();
  if (scenario !== 'free') await page.selectOption('#scenario-select', scenario);
  await page.locator('#live-wx').uncheck();
  await page.locator('#btn-start').click();
  await expect(page.locator('#start')).toBeHidden();
  await page.waitForFunction(() => Boolean(window.__opentower?.engine));
}

/** Run the simulation at 4x so approach/landing phases finish quickly. */
async function setFourTimes(page) {
  await page.locator('#btn-speed').click();
  await page.locator('#btn-speed').click();
  await expect(page.locator('#btn-speed')).toHaveText('4×');
}

/** Type a clearance into the real command form and submit it. */
async function transmit(page, text) {
  await page.locator('#cmd').fill(text);
  await page.locator('#cmd').press('Enter');
}

test('core loop: load, start, spawn, vector and hand off to tower', async ({ page }) => {
  await boot(page, 'tracon');
  await setFourTimes(page);
  await expect(page.locator('#cmd')).toHaveAttribute('placeholder', /turn left/);

  const callsign = await page.evaluate(() => window.__opentower.engine.spawn('arrival')?.callsign);
  expect(callsign).toBeTruthy();
  await expect(page.locator('.strip', { hasText: callsign })).toBeVisible();

  // Select the new target and issue a vector through the UI.
  await page.locator('.strip', { hasText: callsign }).click();
  const headingBefore = await page.evaluate(
    (cs) => window.__opentower.engine.aircraft.find((a) => a.callsign === cs)?.assignedHdg,
    callsign,
  );
  await transmit(page, `${callsign} turn left`);
  await expect.poll(
    () => page.evaluate(
      (cs) => window.__opentower.engine.aircraft.find((a) => a.callsign === cs)?.assignedHdg,
      callsign,
    ),
  ).not.toBe(headingBefore);
  await expect(page.locator('#radio')).toContainText(/turn left|heading/i);

  // Put the target on a stable 5 NM final, then work the approach to a handoff.
  await page.evaluate((cs) => {
    const engine = window.__opentower.engine;
    const ac = engine.aircraft.find((a) => a.callsign === cs);
    const NM = 1852;
    ac.x = engine.geo.thresholdX - engine.geo.dir * 5 * NM;
    ac.y = 0;
    ac.hdg = engine.geo.heading;
    ac.assignedHdg = engine.geo.heading;
    ac.alt = 3000;
    ac.assignedAlt = 3000;
    ac.speed = 160;
    ac.phase = 'cruise';
    ac.cleared = false;
    ac.clearedAt = null;
    ac.onApproach = false;
    ac.handed = false;
  }, callsign);

  await transmit(page, `${callsign} cleared ILS`);
  await expect.poll(
    () => page.evaluate(
      (cs) => window.__opentower.engine.aircraft.find((a) => a.callsign === cs)?.cleared,
      callsign,
    ),
  ).toBe(true);
  await expect.poll(
    () => page.evaluate(
      (cs) => window.__opentower.engine.aircraft.find((a) => a.callsign === cs)?.onApproach,
      callsign,
    ),
  ).toBe(true);

  await transmit(page, `${callsign} contact tower`);
  await expect.poll(
    () => page.evaluate(
      (cs) => window.__opentower.engine.aircraft.find((a) => a.callsign === cs)?.handed,
      callsign,
    ),
  ).toBe(true);
  const served = await page.evaluate(() => window.__opentower.engine.stats.served);
  expect(served).toBeGreaterThanOrEqual(1);
  await expect(page.locator('#radio')).toContainText(/contact tower|over to tower/i);
});

test('tower loop: clear an arrival to land and touch down', async ({ page }) => {
  await boot(page, 'free');
  await setFourTimes(page);
  await expect(page.locator('#cmd')).toHaveAttribute('placeholder', /taxi to runway/);

  const ground = await page.evaluate(() => ({
    callsign: window.__opentower.engine.aircraft.find((a) => a.kind === 'departure')?.callsign,
    runway: window.__opentower.engine.geo.runway,
  }));
  expect(ground.callsign).toBeTruthy();
  await transmit(page, `${ground.callsign} taxi to runway ${ground.runway}`);
  await expect(page.locator('#radio .line.atc .who').first()).toHaveText('GND');

  const callsign = await page.evaluate(() => window.__opentower.engine.spawn('arrival')?.callsign);
  expect(callsign).toBeTruthy();
  await expect(page.locator('.strip', { hasText: callsign })).toBeVisible();

  await transmit(page, `${callsign} cleared to land`);
  await expect.poll(
    () => page.evaluate(
      (cs) => window.__opentower.engine.aircraft.find((a) => a.callsign === cs)?.clearedLand,
      callsign,
    ),
  ).toBe(true);

  // Shorten the final to keep the browser test fast; the landing itself still
  // runs through SimEngine.updateFinal and the real radio log.
  await page.evaluate((cs) => {
    const engine = window.__opentower.engine;
    const ac = engine.aircraft.find((a) => a.callsign === cs);
    ac.x = engine.geo.touchdownX - engine.geo.dir * 300;
    ac.y = 0;
    ac.heading = engine.geo.dir === -1 ? Math.PI : 0;
    ac.alt = engine.geo.elevation ?? ac.alt;
    ac.speed = ac.type.final;
  }, callsign);

  await expect.poll(
    () => page.evaluate(
      (cs) => window.__opentower.engine.aircraft.find((a) => a.callsign === cs)?.phase,
      callsign,
    ),
    { timeout: 15_000 },
  ).toMatch(/rollout|ground|taxiRamp|done/);
  await expect(page.locator('#radio')).toContainText(/touchdown|tomó tierra/i);
});
