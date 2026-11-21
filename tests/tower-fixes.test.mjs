import assert from 'node:assert/strict';
import { SimEngine } from '../src/engine.js';
import { AIRPORT } from '../src/config.js';

const weather = { windDir: 270, windSpeed: 8, altimeter: '29.95', visibilitySm: 10, live: false };

function makeEngine(seed = 1) {
  const e = new SimEngine({ duration: 600, difficulty: 'calm', seed, weather });
  e.spawnTimer = 9999;
  e.aircraft = [];
  return e;
}

function linedUpDeparture(e, callsign = 'TEST1') {
  const dep = e.spawn('departure', { type: 'B738', callsign, gate: 'F2' });
  assert.ok(dep, 'departure spawned');
  dep.phase = 'lined_up';
  dep.x = e.geo.lineupX;
  dep.y = 0;
  dep.speed = 0;
  dep.heading = e.geo.dir === -1 ? Math.PI : 0;
  return dep;
}

function stopAbort(e, dep, speed) {
  const r = e.command(`${dep.callsign} cleared for takeoff`);
  assert.equal(r.ok, true, 'takeoff clearance accepted');
  dep.speed = speed;
  dep.x = e.geo.lineupX - e.geo.dir * 20;
  let lastX = dep.x;
  let maxJump = 0;
  const cancel = e.command(`${dep.callsign} cancel takeoff`);
  assert.equal(cancel.ok, true, 'cancel accepted');
  assert.equal(dep.phase, 'abort');
  for (let i = 0; i < 600 && dep.phase !== 'aborted'; i++) {
    e.tick(0.1);
    maxJump = Math.max(maxJump, Math.abs(dep.x - lastX));
    lastX = dep.x;
  }
  assert.equal(dep.phase, 'aborted', 'aircraft stops on the runway');
  assert.ok(maxJump < speed * 0.1 + 2, `no teleport (max jump ${maxJump.toFixed(2)} m)`);
  return dep;
}

// P0.3 low-speed abort: stops, does not use the landing call, recovers to the ramp.
{
  const e = makeEngine(31);
  const dep = linedUpDeparture(e);
  stopAbort(e, dep, 15);
  assert.equal(e.stats.served, 0, 'aborted departure is not served');
  assert.ok(!e.radio.some((r) => /runway .*clear, taxi to/i.test(r.text)), 'no landing call');
  assert.ok(e.radio.some((r) => /stopped on the runway/i.test(r.text)), 'pilot reports stopping');
  const r = e.command(`${dep.callsign} taxi to the ramp`);
  assert.equal(r.ok, true, 'recovery to the ramp accepted');
  assert.equal(dep.phase, 'abortTaxi');
  for (let i = 0; i < 1200 && dep.phase !== 'done'; i++) e.tick(0.1);
  assert.equal(dep.phase, 'done', 'aircraft reaches the ramp');
  assert.equal(e.stats.served, 0, 'still not counted as served');
  assert.ok(e.radio.some((r) => /returned to .* after the cancelled takeoff/i.test(r.text)));
}

// P0.3 high-speed abort: controlled stop, no backwards teleport, recoverable.
{
  const e = makeEngine(32);
  const dep = linedUpDeparture(e, 'TEST2');
  const startX = e.geo.lineupX - e.geo.dir * 20;
  stopAbort(e, dep, 60);
  assert.ok(Math.abs(dep.x - startX) < 500, 'stop distance stays realistic');
  assert.ok(Math.abs(dep.x) <= 870, 'aircraft stays on/next to the runway');
  const r = e.command(`${dep.callsign} continue taxi`);
  assert.equal(r.ok, true, 'continue taxi starts the recovery');
  assert.equal(dep.phase, 'abortTaxi');
  for (let i = 0; i < 1600 && dep.phase !== 'done'; i++) e.tick(0.1);
  assert.equal(dep.phase, 'done');
  assert.equal(e.stats.served, 0);
}

// P0.3 only a takeoff roll can be cancelled.
{
  const e = makeEngine(33);
  const dep = linedUpDeparture(e, 'TEST3');
  dep.phase = 'holding';
  const r = e.command(`${dep.callsign} cancel takeoff`);
  assert.equal(r.ok, false, 'cancel rejected when not rolling');
}

console.log('OpenTower tower abort checks passed');

// P0.4 opposite-direction crossing: one owner, the second waits, no deadlock.
{
  const e = makeEngine(41);
  const c = AIRPORT.crossing;
  const southbound = e.spawn('departure', { gate: 'N1', type: 'PC12', callsign: 'CROSS1' });
  southbound.phase = 'crossing';
  southbound.x = c.x;
  southbound.y = c.northHoldY;
  southbound.speed = 0;
  southbound.heading = Math.PI / 2;
  southbound.crossPrevPhase = 'taxi';
  southbound.crossCleared = false;
  southbound.route = [
    { x: c.x, y: c.northHoldY, cross: true },
    { x: c.x - 40, y: c.northHoldY },
    { x: c.x - 40, y: AIRPORT.alphaDepY },
  ];
  southbound.routeIdx = 0;
  southbound.call = { text: 'holding short 12', kind: 'crossing', at: e.t, answered: false };

  const northbound = e.spawn('arrival', { gate: 'N1', type: 'C182', callsign: 'CROSS2' });
  northbound.phase = 'crossing';
  northbound.x = c.x;
  northbound.y = c.southHoldY;
  northbound.speed = 0;
  northbound.heading = -Math.PI / 2;
  northbound.crossPrevPhase = 'taxiRamp';
  northbound.crossCleared = false;
  northbound.route = [
    { x: c.x, y: c.southHoldY, cross: true },
    { x: c.x + 40, y: c.southHoldY },
    { x: c.x + 40, y: -660 },
    { x: -720, y: -660 },
  ];
  northbound.routeIdx = 0;
  northbound.call = { text: 'holding short 12', kind: 'crossing', at: e.t, answered: false };

  const first = e.command('CROSS1 cross runway 12');
  assert.equal(first.ok, true, 'first crossing cleared');
  assert.equal(e.crossingOwnerId, southbound.id);
  const second = e.command('CROSS2 cross runway 12');
  assert.equal(second.ok, false, 'second crossing blocked while runway 12 is occupied');
  assert.equal(northbound.phase, 'crossing', 'second aircraft waits at its hold');
  assert.equal(northbound.crossCleared, false);

  let guard = 0;
  while (e.crossingOwnerId === southbound.id && guard++ < 600) e.tick(0.1);
  assert.equal(e.crossingOwnerId, null, 'lock released after the first aircraft passes');
  assert.ok(southbound.y > c.centerY + 20, 'first aircraft is clear of runway 12');

  const third = e.command('CROSS2 cross runway 12');
  assert.equal(third.ok, true, 'second crossing can now be cleared');
  guard = 0;
  while (e.crossingOwnerId === northbound.id && guard++ < 600) e.tick(0.1);
  assert.equal(e.crossingOwnerId, null, 'second lock released');
  assert.ok(northbound.y < c.centerY - 20, 'second aircraft is clear of runway 12');
  assert.notEqual(southbound.phase, 'crossing');
  assert.notEqual(northbound.phase, 'crossing');
}

console.log('OpenTower crossing lock checks passed');

// P1.1 hold short stops taxi and continue taxi resumes.
{
  const e = makeEngine(51);
  const dep = e.spawn('departure', { gate: 'F2', type: 'B738', callsign: 'HOLD1' });
  dep.readyAt = 0;
  e.tick(0.2);
  assert.equal(e.command(`${dep.callsign} taxi to runway ${e.geo.runway}`).ok, true);
  for (let i = 0; i < 50; i++) e.tick(0.1);
  assert.ok(dep.speed > 5, 'aircraft is taxiing');
  const x0 = dep.x;
  const y0 = dep.y;
  const hold = e.command(`${dep.callsign} hold short`);
  assert.equal(hold.ok, true, 'hold short accepted on the taxiway');
  for (let i = 0; i < 40; i++) e.tick(0.1);
  assert.ok(dep.speed < 0.2, 'aircraft stops');
  assert.ok(Math.hypot(dep.x - x0, dep.y - y0) < 25, 'controlled stop, not a teleport');
  const heldX = dep.x;
  for (let i = 0; i < 20; i++) e.tick(0.1);
  assert.ok(Math.abs(dep.x - heldX) < 0.5, 'stays stopped');
  const go = e.command(`${dep.callsign} continue taxi`);
  assert.equal(go.ok, true, 'continue taxi accepted');
  for (let i = 0; i < 30; i++) e.tick(0.1);
  assert.ok(dep.speed > 2, 'aircraft resumes taxiing');
}

// P1.1 hold short during a takeoff roll is rejected, not silently ignored.
{
  const e = makeEngine(52);
  const dep = linedUpDeparture(e, 'HOLD2');
  assert.equal(e.command(`${dep.callsign} cleared for takeoff`).ok, true);
  dep.speed = 30;
  const hold = e.command(`${dep.callsign} hold short`);
  assert.equal(hold.ok, false, 'hold short rejected during the roll');
  assert.equal(dep.phase, 'takeoff');
  for (let i = 0; i < 200 && dep.phase === 'takeoff'; i++) e.tick(0.1);
  assert.ok(['airborne', 'done'].includes(dep.phase), 'aircraft still becomes airborne');
}

console.log('OpenTower hold-short checks passed');

// P1.2 requested-runway validation in every ground clearance.
{
  const other = (e) => (e.geo.runway === '27' ? '09' : '27');

  const e = makeEngine(61);
  const dep = e.spawn('departure', { gate: 'F2', type: 'B738', callsign: 'RWY1' });
  dep.readyAt = 0;
  e.tick(0.2);

  const wrongTaxi = e.command(`${dep.callsign} taxi to runway ${other(e)}`);
  assert.equal(wrongTaxi.ok, false, 'wrong-runway taxi rejected');
  assert.equal(dep.phase, 'parked');
  assert.equal(dep.route.length, 0, 'no route started');

  assert.equal(e.command(`${dep.callsign} taxi to runway ${e.geo.runway}`).ok, true);
  dep.phase = 'holding';
  dep.x = e.geo.holdX;
  dep.y = AIRPORT.alphaY;
  dep.speed = 0;

  const wrongLineup = e.command(`${dep.callsign} line up and wait runway ${other(e)}`);
  assert.equal(wrongLineup.ok, false, 'wrong-runway line up rejected');
  assert.equal(dep.phase, 'holding');

  const wrongHold = e.command(`${dep.callsign} hold short of runway ${other(e)}`);
  assert.equal(wrongHold.ok, false, 'wrong-runway hold short rejected');
  assert.equal(dep.holdHeld, false, 'no stop applied by a rejected clearance');

  assert.equal(e.command(`${dep.callsign} line up and wait runway ${e.geo.runway}`).ok, true);
}

// P1.2 taxi to the ramp does not silently route a departure to the runway.
{
  const e = makeEngine(62);
  const dep = e.spawn('departure', { gate: 'F2', type: 'B738', callsign: 'RAMP1' });
  dep.readyAt = 0;
  e.tick(0.2);
  const r = e.command(`${dep.callsign} taxi to the ramp`);
  assert.equal(r.ok, false, 'departure taxi-to-ramp rejected');
  assert.equal(dep.phase, 'parked');
  assert.equal(dep.route.length, 0);
}

// P1.2 an arrival asking for the runway is rejected; ground taxi needs the ramp.
{
  const e = makeEngine(63);
  e.aircraft = [];
  const arr = e.spawn('arrival', { type: 'C182', callsign: 'ARR1' });
  arr.phase = 'ground';
  arr.gate = AIRPORT.gates.find((g) => g.id === 'G1');
  arr.x = e.geo.exitX;
  arr.y = AIRPORT.alphaArrY;
  arr.route = [];
  arr.call = { text: 'taxi', kind: 'taxiRequest', at: e.t, answered: false };
  const wrong = e.command(`${arr.callsign} taxi to runway ${e.geo.runway}`);
  assert.equal(wrong.ok, false, 'arrival taxi to runway rejected');
  assert.equal(arr.phase, 'ground');
  const ok = e.command(`${arr.callsign} taxi to the ramp`);
  assert.equal(ok.ok, true, 'arrival taxi to ramp accepted');
}

console.log('OpenTower runway-validation checks passed');

// P1.3 arrivals are visible in the final inset before the go-around trigger.
{
  const { FINAL_INSET_RANGE_M, finalApproachDistance, inFinalInset } = await import('../src/airport.js');
  const e = makeEngine(71);
  const arr = e.spawn('arrival', { type: 'C172', callsign: 'VIS1' });
  const d = finalApproachDistance(arr, e.geo);
  assert.ok(d <= FINAL_INSET_RANGE_M, 'spawn is inside the 4 NM inset');
  assert.ok(d > 1500, 'spawn is before the go-around trigger');
  assert.ok(inFinalInset(arr, e.geo), 'arrival is visible in the inset');
  const seconds = (d - 1500) / Math.max(1, arr.speed);
  assert.ok(seconds >= 10, `meaningful visual time (${seconds.toFixed(1)} s)`);
  const dep = e.spawn('departure', { gate: 'F2', type: 'B738', callsign: 'VIS2' });
  assert.equal(inFinalInset(dep, e.geo), false, 'ground traffic is not in the inset');
}

console.log('OpenTower final-inset checks passed');

// P1.5 C172 touches down near its final speed, not at 55 m/s.
{
  const e = makeEngine(81);
  const arr = e.spawn('arrival', { type: 'C172', callsign: 'SLOW1' });
  arr.phase = 'final';
  arr.clearedLand = true;
  arr.x = e.geo.touchdownX + 10;
  arr.y = 0;
  arr.alt = e.geo.elevation ?? 1450;
  arr.speed = arr.type.final;
  e.tick(0.2);
  assert.equal(arr.phase, 'rollout', 'touched down');
  assert.ok(arr.speed < 40, `C172 touchdown speed is type-appropriate (${arr.speed.toFixed(1)} m/s)`);
  assert.ok(Math.abs(arr.speed - arr.type.final * 0.95) < 1, 'close to final speed');
}

console.log('OpenTower touchdown-speed checks passed');

// P2: stale conflict flags are cleared each tick.
{
  const e = makeEngine(91);
  const a = e.spawn('departure', { gate: 'G1', type: 'B738', callsign: 'CF1' });
  const b = e.spawn('departure', { gate: 'G2', type: 'B738', callsign: 'CF2' });
  a.phase = 'taxi';
  b.phase = 'taxi';
  a.x = 0;
  a.y = AIRPORT.alphaDepY;
  a.heading = 0;
  a.speed = 5;
  b.x = 30;
  b.y = AIRPORT.alphaDepY;
  b.heading = 0;
  b.speed = 5;
  e.detectConflicts();
  assert.equal(a.conflict, true);
  assert.equal(b.conflict, true);
  b.y = 300;
  e.detectConflicts();
  assert.equal(a.conflict, false, 'stale conflict cleared');
  assert.equal(b.conflict, false);
}

console.log('OpenTower conflict-flag checks passed');

// Phonetic callsigns work end-to-end in a controller command.
{
  const e = makeEngine(101);
  const dep = e.spawn('departure', { callsign: 'N123AB', gate: 'F2', type: 'C172' });
  assert.ok(dep, 'departure with fixed callsign');
  dep.readyAt = 0;
  e.tick(0.2);
  const r = e.command(`November one two three alpha bravo, taxi to runway ${e.geo.runway}`);
  assert.equal(r.ok, true, 'phonetic callsign accepted');
  assert.equal(dep.phase, 'taxi');
  assert.ok(dep.route.length > 0, 'taxi route started');
}

console.log('OpenTower phonetic-callsign checks passed');

// Spanish radio language runs the same command path end to end.
{
  const e = new SimEngine({
    duration: 600,
    difficulty: 'calm',
    seed: 202,
    weather,
    lang: 'es',
  });
  e.spawnTimer = 9999;
  e.aircraft = [];
  const dep = e.spawn('departure', { callsign: 'N123AB', gate: 'F2', type: 'C172' });
  assert.ok(dep, 'Spanish departure spawned');
  dep.readyAt = 0;
  e.tick(0.2);
  assert.ok(
    e.radio.some((r) => /listo para rodar con información/i.test(r.text)),
    'initial taxi call is Spanish',
  );

  const taxi = e.command('N uno dos tres alfa bravo, ruede a la pista 27');
  assert.equal(taxi.ok, true, 'Spanish taxi clearance accepted');
  assert.ok(/pista dos siete/i.test(taxi.atc), 'ATC taxi phrase is Spanish');
  assert.equal(dep.phase, 'taxi');

  const bravo = e.command('N123AB ruede por la bravo');
  assert.equal(bravo.ok, false, 'bravo taxiway rejected in Spanish');
  assert.ok(/calle de rodaje bravo/i.test(bravo.atc), 'Spanish unable reason');

  dep.phase = 'holding';
  dep.route = [];
  dep.routeIdx = 0;
  const hold = e.command('N123AB alto antes de la pista dos siete');
  assert.equal(hold.ok, true, 'Spanish hold short accepted');
  assert.ok(/alto antes de la pista dos siete/i.test(hold.atc));

  dep.phase = 'holding';
  const lineUp = e.command('N123AB alinéese y espere');
  assert.equal(lineUp.ok, true, 'Spanish line up accepted');
  assert.equal(dep.phase, 'lineup');
  assert.ok(/alinéese y espere pista dos siete/i.test(lineUp.atc));

  dep.phase = 'lined_up';
  const takeoff = e.command('N123AB autorizado para despegar');
  assert.equal(takeoff.ok, true, 'Spanish takeoff clearance accepted');
  assert.ok(/autorizado para despegar pista dos siete/i.test(takeoff.pilot));

  const arrival = e.spawn('arrival', { callsign: 'N456CD' });
  assert.ok(arrival, 'Spanish arrival spawned');
  arrival.phase = 'final';
  arrival.x = e.geo.thresholdX - e.geo.dir * 6000;
  arrival.y = 0;
  arrival.clearedLand = false;
  const land = e.command(`${arrival.callsign} autorizado para aterrizar`);
  assert.equal(land.ok, true, 'Spanish landing clearance accepted');
  assert.ok(/pista dos siete, autorizado para aterrizar/i.test(land.atc));
  assert.ok(/autorizado para aterrizar pista dos siete/i.test(land.pilot));

  const go = e.command(`${arrival.callsign} frustrada`);
  assert.equal(go.ok, true, 'Spanish go-around accepted');
  assert.equal(arrival.phase, 'goAround');
}

console.log('OpenTower Spanish radio checks passed');
