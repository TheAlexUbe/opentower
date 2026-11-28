import assert from 'node:assert/strict';
import { SimEngine } from '../src/engine.js';
import { TraconEngine } from '../src/tracon.js';
import { AIRPORT } from '../src/config.js';

function makeTower(seed) {
  const engine = new SimEngine({ duration: 600, seed });
  engine.script = null;
  engine.spawnTimer = 9999;
  engine.aircraft = [];
  return engine;
}

function stubAircraft(id, x, y, overrides = {}) {
  return {
    id,
    callsign: `T${id}`,
    phase: 'taxi',
    kind: 'departure',
    x,
    y,
    alt: AIRPORT.elevation,
    heading: 0,
    speed: 5,
    wake: 'L',
    type: { code: 'C172', wake: 'L' },
    call: null,
    ...overrides,
  };
}

// Conflict flags must accumulate across every pair, not be overwritten by the
// last pair checked.
{
  const e = makeTower(201);
  const a = stubAircraft(1, 0, 100);
  const b = stubAircraft(2, 200, 100);
  const c = stubAircraft(3, 30, 100);
  e.aircraft = [a, b, c];
  e.detectConflicts();
  assert.equal(a.conflict, true, 'A is in conflict with C');
  assert.equal(c.conflict, true, 'C is in conflict with A');
  assert.equal(b.conflict, false, 'B is clear');

  c.x = 500;
  e.detectConflicts();
  assert.equal(a.conflict, false, 'conflict flags clear when the pair separates');
  assert.equal(c.conflict, false);
}

// TRACON separation loss must also mark the targets for the radar renderer.
{
  const e = new TraconEngine({
    duration: 600,
    seed: 202,
    weather: { windDir: 270, windSpeed: 8, altimeter: '29.95' },
  });
  e.script = null;
  e.spawnTimer = 9999;
  e.aircraft = [];
  const a = e.spawn('arrival');
  const b = e.spawn('arrival');
  a.phase = 'cruise';
  b.phase = 'cruise';
  a.x = 0;
  a.y = 0;
  a.alt = 5000;
  b.x = 1000;
  b.y = 0;
  b.alt = 5500;
  e.detectConflicts();
  assert.equal(a.conflict, true, 'A separation loss is visible');
  assert.equal(b.conflict, true, 'B separation loss is visible');
  assert.ok(e.incidents.some((i) => i.type === 'air'));
}

// Go-arounds leave the frequency but must stay on the scope while they climb.
{
  const e = new TraconEngine({
    duration: 600,
    seed: 203,
    weather: { windDir: 270, windSpeed: 8, altimeter: '29.95' },
  });
  e.script = null;
  e.spawnTimer = 9999;
  e.aircraft = [];
  const ac = e.spawn('arrival');
  e.missApproach(ac, 'go around instruction');
  assert.equal(ac.phase, 'goAround');
  assert.equal(e.activeAircraft().includes(ac), false, 'go-around is off frequency');
  assert.equal(e.scopeAircraft().includes(ac), true, 'go-around remains visible on the scope');
}

// A departure must not be cleared with traffic on a short final.
{
  const e = makeTower(204);
  const dep = e.spawn('departure', { gate: 'G1', type: 'B738', callsign: 'DEP1' });
  dep.phase = 'holding';
  dep.x = e.geo.holdX;
  dep.y = AIRPORT.alphaY;
  const arr = e.spawn('arrival', { type: 'B738', callsign: 'ARR1' });
  arr.phase = 'final';
  arr.y = 0;
  arr.x = e.geo.thresholdX - e.geo.dir * 1.4 * 1852;
  arr.clearedLand = false;
  const blocked = e.command('DEP1 cleared for takeoff');
  assert.equal(blocked.ok, false, 'takeoff rejected with traffic at 1.4 NM final');

  arr.x = e.geo.thresholdX - e.geo.dir * 5 * 1852;
  const allowed = e.command('DEP1 cleared for takeoff');
  assert.equal(allowed.ok, true, 'takeoff allowed when the final is far enough away');
}

// The debrief must never show fractional aircraft handled.
{
  const e = makeTower(205);
  const arr = e.spawn('arrival', { type: 'B738', callsign: 'ARR2' });
  arr.phase = 'final';
  arr.x = e.geo.thresholdX - e.geo.dir * 3 * 1852;
  const traffic = e.computeScore().parts.find((p) => p.key === 'traffic');
  assert.doesNotMatch(traffic.notes.join(' '), /\d\.\d/, 'aircraft counts are whole numbers');
}
{
  const e = new TraconEngine({
    duration: 600,
    seed: 206,
    weather: { windDir: 270, windSpeed: 8, altimeter: '29.95' },
  });
  e.script = null;
  e.spawnTimer = 9999;
  e.aircraft = [];
  const arr = e.spawn('arrival');
  arr.phase = 'cruise';
  const traffic = e.computeScore().parts.find((p) => p.key === 'traffic');
  assert.doesNotMatch(traffic.notes.join(' '), /\d\.\d/, 'TRACON aircraft counts are whole numbers');
}

console.log('OpenTower regression checks passed');
