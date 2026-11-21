import assert from 'node:assert/strict';
import { TraconEngine } from '../src/tracon.js';

const NM = 1852;

function makeEngine(seed = 1) {
  const e = new TraconEngine({
    duration: 600,
    seed,
    difficulty: 'calm',
    weather: { windDir: 270, windSpeed: 8, altimeter: '29.95', visibilitySm: 10, live: false },
  });
  e.spawnTimer = 9999;
  e.aircraft = [];
  return e;
}

function landingHeading(e) {
  return e.geo.heading;
}

function placeOnFinal(e, ac, distanceNm, { lateralNm = 0, heading = null, alt = 3000 } = {}) {
  const d = distanceNm * NM;
  ac.x = e.geo.thresholdX - e.geo.dir * d;
  ac.y = lateralNm * NM;
  ac.alt = alt;
  ac.hdg = heading ?? landingHeading(e);
  ac.speed = 160;
  ac.phase = 'cruise';
  ac.cleared = false;
  ac.onApproach = false;
  ac.clearedAt = null;
  return ac;
}

function deviationCount(e) {
  return e.incidents.filter((i) => i.type === 'deviation').length;
}

// 1. Arrival inside 4 NM with no clearance: one failure, one incident, leaves the frequency.
{
  const e = makeEngine(11);
  const ac = e.spawn('arrival');
  placeOnFinal(e, ac, 3.9);
  e.tick(0.2);
  assert.equal(e.stats.failed, 1, 'one failure');
  assert.equal(deviationCount(e), 1, 'one deviation incident');
  assert.equal(ac.phase, 'goAround');
  assert.ok(!e.activeAircraft().includes(ac), 'go-around leaves activeAircraft');
  const failed = e.stats.failed;
  for (let i = 0; i < 400; i++) e.tick(0.1);
  assert.equal(e.stats.failed, failed, 'failure is counted once, not every tick');
  assert.equal(deviationCount(e), 1, 'incident is recorded once');
  assert.ok(['done', 'removed'].includes(ac.phase), 'go-around is cleaned up');
}

// 2. Established arrival at 1.4 NM without tower handoff: one failure.
{
  const e = makeEngine(12);
  const ac = e.spawn('arrival');
  placeOnFinal(e, ac, 1.4);
  ac.cleared = true;
  ac.clearedAt = e.t;
  ac.onApproach = true;
  ac.phase = 'approach';
  e.tick(0.2);
  assert.equal(ac.phase, 'goAround');
  assert.equal(e.stats.failed, 1);
  assert.equal(deviationCount(e), 1);
  const failed = e.stats.failed;
  e.tick(1);
  assert.equal(e.stats.failed, failed, 'no repeated failure');
}

// 3. Command go-around while established: terminal state, cannot be reabsorbed.
{
  const e = makeEngine(13);
  const ac = e.spawn('arrival');
  placeOnFinal(e, ac, 6);
  ac.cleared = true;
  ac.clearedAt = e.t;
  ac.onApproach = true;
  ac.phase = 'approach';
  const r = e.command(`${ac.callsign} go around`);
  assert.equal(r.ok, true);
  assert.equal(ac.phase, 'goAround');
  assert.equal(e.stats.failed, 1);
  assert.equal(ac.onApproach, false);
  assert.equal(ac.cleared, false);
  for (let i = 0; i < 30; i++) e.tick(0.2);
  assert.ok(['goAround', 'done', 'removed'].includes(ac.phase), 'not reabsorbed into approach');
  assert.equal(e.stats.failed, 1, 'still only one failure');
}

// 4. Cleared but never established / off centerline: times out once and is cleaned up.
{
  const e = makeEngine(14);
  const ac = e.spawn('arrival');
  placeOnFinal(e, ac, 6, { lateralNm: 5, heading: landingHeading(e) });
  ac.cleared = true;
  ac.clearedAt = e.t;
  for (let i = 0; i < 520; i++) e.tick(0.1); // > 45 s
  assert.equal(e.stats.failed, 1, 'exactly one failure');
  assert.equal(deviationCount(e), 1, 'exactly one incident');
  assert.ok(['goAround', 'done', 'removed'].includes(ac.phase));
  assert.ok(!e.activeAircraft().includes(ac), 'not left in cruise/approach forever');
}

// 5. Free shift keeps spawning after a missed arrival; failure does not grow every tick.
{
  const e = new TraconEngine({ duration: 600, seed: 15, difficulty: 'calm' });
  e.aircraft = [];
  e.spawnTimer = 9999;
  const ac = e.spawn('arrival');
  placeOnFinal(e, ac, 3.9);
  e.tick(0.2);
  assert.equal(e.stats.failed, 1);
  assert.equal(e.aircraft.length, 1);
  e.spawnTimer = 0.1;
  e.tick(0.2);
  assert.ok(e.aircraft.length > 1, 'the free shift keeps spawning traffic');
  const failed = e.stats.failed;
  for (let i = 0; i < 50; i++) e.tick(0.1);
  assert.equal(e.stats.failed, failed, 'no per-tick failure inflation');
}

console.log('OpenTower TRACON go-around checks passed');

// --- P0.2: coherent final-approach geometry --------------------------------
{
  const { approachGeometry, localizerOffset } = await import('../src/tracon.js');
  const { runwayGeometry } = await import('../src/config.js');
  for (const rwy of ['09', '27']) {
    const g = runwayGeometry(rwy);
    const a = approachGeometry(g);
    assert.equal(a.landing, g.heading, `${rwy} landing heading`);
    assert.equal(a.course, (g.heading + 180) % 360, `${rwy} course is opposite landing`);
    const p = {
      x: g.thresholdX + Math.sin(a.course * Math.PI / 180) * 6 * NM,
      y: Math.cos(a.course * Math.PI / 180) * 6 * NM,
    };
    const loc = localizerOffset(p, g);
    assert.ok(loc.onLocalizer, `${rwy} 6 NM on course is on the localizer`);
    assert.ok(Math.abs(loc.along - 6 * NM) < 5, `${rwy} along-course distance`);
    assert.ok(loc.lateral < 1, `${rwy} centred laterally`);
  }
}

// 1. Extended centreline at 6 NM: cleared, established, handed off.
{
  const e = makeEngine(21);
  const ac = e.spawn('arrival');
  placeOnFinal(e, ac, 6);
  const loc = (await import('../src/tracon.js')).localizerOffset(ac, e.geo);
  assert.ok(loc.onLocalizer, 'test starts on the localizer');
  const r = e.command(`${ac.callsign} cleared ILS`);
  assert.equal(r.ok, true, 'centreline clearance accepted');
  for (let i = 0; i < 40; i++) e.tick(0.1);
  assert.ok(ac.onApproach, 'established on the approach');
  const handoff = e.command(`${ac.callsign} contact tower`);
  assert.equal(handoff.ok, true, 'handoff accepted inside 6 NM');
  assert.ok(e.stats.served >= 1);
}

// 2. Five miles abeam: clearance rejected; never stuck in approach.
{
  const e = makeEngine(22);
  const ac = e.spawn('arrival');
  ac.x = e.geo.thresholdX;
  ac.y = 5 * NM;
  ac.alt = 4000;
  ac.hdg = landingHeading(e);
  ac.cleared = false;
  const r = e.command(`${ac.callsign} cleared ILS`);
  assert.equal(r.ok, false, 'abeam clearance rejected');
  assert.equal(ac.cleared, false);
  for (let i = 0; i < 3200; i++) e.tick(0.1); // fly out of the radar area
  assert.ok(!['approach', 'final'].includes(ac.phase), 'not permanently in approach');
  assert.equal(e.stats.failed, 1, 'one failure only');
  assert.ok(['done', 'removed'].includes(ac.phase), 'cleaned up');
}

// 3. Cleared slightly off-centre: intercepts the localizer and is handed off.
{
  const e = makeEngine(23);
  const ac = e.spawn('arrival');
  placeOnFinal(e, ac, 6, { lateralNm: 1 });
  const before = Math.abs(ac.y);
  const r = e.command(`${ac.callsign} cleared ILS`);
  assert.equal(r.ok, true, 'off-centre but on-localizer clearance accepted');
  for (let i = 0; i < 60; i++) e.tick(0.1);
  assert.ok(Math.abs(ac.y) < before, 'tracks toward the centreline');
  assert.ok(ac.onApproach, 'established during the intercept');
  const handoff = e.command(`${ac.callsign} contact tower`);
  assert.equal(handoff.ok, true);
}

// 4. Cleared off-centre beyond the localizer: one failure and cleanup.
{
  const e = makeEngine(24);
  const ac = e.spawn('arrival');
  placeOnFinal(e, ac, 6, { lateralNm: 1 });
  ac.cleared = true;
  ac.clearedAt = e.t;
  ac.onApproach = true;
  ac.phase = 'approach';
  ac.y = 3 * NM; // drift well outside the localizer
  e.tick(0.2);
  assert.equal(ac.phase, 'goAround');
  assert.equal(e.stats.failed, 1);
  assert.equal(deviationCount(e), 1);
  e.tick(1);
  assert.equal(e.stats.failed, 1, 'drift failure is counted once');
}

console.log('OpenTower TRACON geometry checks passed');

// P2: departures are not auto-served; contact center hands them off.
{
  const e = makeEngine(31);
  const dep = e.spawn('departure', { type: 'B738', callsign: 'DEP1' });
  dep.x = 16 * NM;
  dep.y = 0;
  dep.alt = 8000;
  e.tick(0.2);
  assert.equal(e.stats.served, 0, 'not served without a handoff');
  const r = e.command(`${dep.callsign} contact center`);
  assert.equal(r.ok, true);
  assert.equal(e.stats.served, 1);
}

console.log('OpenTower approach handoff checks passed');

// P0.1 regression: an unattended free shift fails aircraft once, not every tick.
{
  const e = new TraconEngine({ duration: 300, seed: 77, difficulty: 'busy' });
  for (let i = 0; i < 3000; i++) e.tick(0.1);
  assert.ok(e.stats.failed <= 12, `bounded failures (${e.stats.failed})`);
  assert.ok(e.activeAircraft().length <= 10, 'traffic does not pile up');
  assert.ok(e.activeAircraft().every((a) => a.phase !== 'goAround'), 'no go-around stays active');
  e.finish();
  assert.ok(e.score.total > 0, 'score still computes');
}

console.log('OpenTower unattended-shift checks passed');

// Spanish radio language in TRACON: vectors, descent, ILS, handoff and reasons.
{
  const e = new TraconEngine({
    duration: 600,
    seed: 32,
    difficulty: 'calm',
    lang: 'es',
    weather: { windDir: 270, windSpeed: 8, altimeter: '29.95', visibilitySm: 10, live: false },
  });
  e.spawnTimer = 9999;
  e.aircraft = [];
  const arrival = e.spawn('arrival', { callsign: 'SWA321' });
  assert.ok(arrival, 'Spanish arrival spawned');
  assert.ok(/millas al/i.test(arrival.call.text), 'Spanish check-in call');

  placeOnFinal(e, arrival, 6);
  const turn = e.command(`${arrival.callsign} gire a la izquierda`);
  assert.equal(turn.ok, true, 'Spanish turn accepted');
  assert.ok(/vire a la izquierda rumbo/i.test(turn.atc));

  const descend = e.command(`${arrival.callsign} descienda y mantenga 2000`);
  assert.equal(descend.ok, true, 'Spanish descent accepted');
  assert.ok(/descienda y mantenga 2000/i.test(descend.atc));

  const speed = e.command(`${arrival.callsign} velocidad 180`);
  assert.equal(speed.ok, true, 'Spanish speed accepted');
  assert.ok(/velocidad 180/i.test(speed.atc));

  const ils = e.command(`${arrival.callsign} autorizado ILS`);
  assert.equal(ils.ok, true, 'Spanish ILS clearance accepted');
  assert.ok(/autorizado ILS pista dos siete/i.test(ils.atc));

  const repeat = e.command(`${arrival.callsign} repita`);
  assert.equal(repeat.ok, true, 'Spanish say-again accepted');
  assert.ok(/repito/i.test(repeat.atc));

  for (let i = 0; i < 40; i++) e.tick(0.1);
  assert.ok(arrival.onApproach, 'established on the approach');
  const handoff = e.command(`${arrival.callsign} contacte torre`);
  assert.equal(handoff.ok, true, 'Spanish tower handoff accepted');
  assert.ok(/contacte torre/i.test(handoff.atc));
  assert.ok(/cambio a torre/i.test(handoff.pilot));

  const second = e.spawn('arrival', { callsign: 'SWA322' });
  const refused = e.command(`${second.callsign} contacte torre`);
  assert.equal(refused.ok, false, 'handoff refused before established');
  assert.ok(/imposible/i.test(refused.atc));
  assert.ok(/no está establecido en la aproximación/i.test(refused.atc));
}

console.log('OpenTower Spanish TRACON checks passed');
