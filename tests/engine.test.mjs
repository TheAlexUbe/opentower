import assert from 'node:assert/strict';
import { SimEngine } from '../src/engine.js';
import { parseInstruction, findAddressee } from '../src/phraseology.js';
import { runwayGeometry } from '../src/config.js';

function stepUntil(engine, predicate, maxSeconds = 120, dt = 0.1) {
  for (let t = 0; t < maxSeconds / dt; t++) {
    if (predicate()) return true;
    engine.tick(dt);
  }
  return predicate();
}

// --- phraseology -----------------------------------------------------------
assert.equal(parseInstruction('CMX123 taxi to runway 27 via alpha').type, 'taxi');
assert.equal(parseInstruction('N123AB hold short of runway 27').type, 'holdShort');
assert.equal(parseInstruction('N123AB line up and wait runway 09').type, 'lineUp');
assert.equal(parseInstruction('N123AB cleared for takeoff').type, 'takeoff');
assert.equal(parseInstruction('N123AB cleared to land runway 27').type, 'land');
assert.equal(parseInstruction('N123AB go around').type, 'goAround');
assert.equal(parseInstruction('N123AB taxi via bravo').viaBravo, true);
assert.equal(parseInstruction('N123AB say again').type, 'sayAgain');

const fakeAircraft = [
  { callsign: 'CMX123', spoken: 'COPPER MESA 123' },
  { callsign: 'N45AB', spoken: 'N45AB' },
];
assert.equal(findAddressee('copper mesa 123 taxi to runway 27', fakeAircraft).aircraft.callsign, 'CMX123');
assert.equal(findAddressee('N45AB hold short', fakeAircraft).aircraft.callsign, 'N45AB');
assert.equal(findAddressee('nobody here', fakeAircraft).aircraft, null);

// --- phonetic alphabet callsigns and runway words --------------------------
const phoneticAircraft = [
  { callsign: 'N123AB', spoken: 'N123AB' },
  { callsign: 'CMX123', spoken: 'COPPER MESA 123' },
  { callsign: 'N101AB', spoken: 'N101AB' },
  { callsign: 'N9XZ', spoken: 'N9XZ' },
];
assert.equal(
  findAddressee('November one two three alpha bravo, taxi to runway two seven', phoneticAircraft).aircraft.callsign,
  'N123AB',
);
assert.equal(
  findAddressee('N one two three alpha bravo, taxi to runway 27', phoneticAircraft).aircraft.callsign,
  'N123AB',
);
assert.equal(
  findAddressee('November 123 alpha bravo, taxi to runway 27', phoneticAircraft).aircraft.callsign,
  'N123AB',
);
assert.equal(
  findAddressee('Charlie mike xray one two three, taxi to runway 27', phoneticAircraft).aircraft.callsign,
  'CMX123',
);
assert.equal(
  findAddressee('Copper Mesa one two three, taxi to runway 27', phoneticAircraft).aircraft.callsign,
  'CMX123',
);
assert.equal(
  findAddressee('N one oh one alpha bravo, cleared to land', phoneticAircraft).aircraft.callsign,
  'N101AB',
);
assert.equal(
  findAddressee('N nine x-ray zulu, cleared to land', phoneticAircraft).aircraft.callsign,
  'N9XZ',
);
assert.equal(
  findAddressee('N one two three A B, taxi to runway 27', phoneticAircraft).aircraft.callsign,
  'N123AB',
);
assert.equal(
  findAddressee('N 123 A B, taxi to runway 27', phoneticAircraft).aircraft.callsign,
  'N123AB',
);
assert.equal(
  findAddressee('N nine X Z, cleared to land', phoneticAircraft).aircraft.callsign,
  'N9XZ',
);
assert.equal(
  findAddressee('N one oh one A B, cleared to land', phoneticAircraft).aircraft.callsign,
  'N101AB',
);
assert.equal(
  findAddressee('N 1 2 3 alpha bravo, taxi to runway 27', phoneticAircraft).aircraft.callsign,
  'N123AB',
);
assert.equal(
  findAddressee('N 1 2 3 A B, taxi to runway 27', phoneticAircraft).aircraft.callsign,
  'N123AB',
);
assert.equal(parseInstruction('N123AB cleared to land runway zero niner').runway, '09');
assert.equal(parseInstruction('N123AB cleared to land runway oh nine').runway, '09');
assert.equal(parseInstruction('N123AB taxi to runway two seven via alpha').runway, '27');

// --- geometry --------------------------------------------------------------
const g27 = runwayGeometry('27');
assert.equal(g27.dir, -1);
assert.equal(g27.thresholdX, 850);
assert.equal(g27.exitX, 300);
assert.equal(g27.heading, 270);
assert.equal(g27.courseHeading, 90);
const g09 = runwayGeometry('09');
assert.equal(g09.dir, 1);
assert.equal(g09.thresholdX, -850);
assert.equal(g09.exitX, -200);
assert.equal(g09.heading, 90);
assert.equal(g09.courseHeading, 270);

// --- departure flow --------------------------------------------------------
{
  const e = new SimEngine({ duration: 600, difficulty: 'calm', seed: 42 });
  e.spawnTimer = 9999;
  e.aircraft = e.aircraft.filter((a) => a.kind === 'departure');
  const dep = e.aircraft[0];
  assert.ok(dep, 'a departure should exist at start');
  dep.readyAt = 0;
  e.tick(0.2);

  let r = e.command(`${dep.callsign} taxi to runway ${e.geo.runway}`);
  assert.equal(r.ok, true, 'taxi clearance accepted');
  assert.equal(dep.phase, 'taxi');

  assert.ok(stepUntil(e, () => dep.phase === 'holding', 200), 'aircraft reaches the holding point');
  assert.ok(dep.call && dep.call.kind === 'holdingShort');

  r = e.command(`${dep.callsign} line up and wait`);
  assert.equal(r.ok, true, 'line up accepted');
  assert.ok(stepUntil(e, () => dep.phase === 'lined_up', 60), 'aircraft lines up');

  r = e.command(`${dep.callsign} cleared for takeoff`);
  assert.equal(r.ok, true, 'takeoff clearance accepted');
  assert.equal(dep.phase, 'takeoff');
  assert.ok(stepUntil(e, () => ['airborne', 'done'].includes(dep.phase), 90), 'aircraft gets airborne');
  assert.ok(e.stats.served >= 1);
}

// --- arrival flow ----------------------------------------------------------
{
  const e = new SimEngine({ duration: 600, difficulty: 'calm', seed: 7 });
  e.spawnTimer = 9999;
  e.aircraft = [];
  const arr = e.spawn('arrival');
  assert.ok(arr, 'arrival spawned');
  assert.equal(arr.phase, 'final');

  let r = e.command(`${arr.callsign} cleared to land`);
  assert.equal(r.ok, true, 'landing clearance accepted');
  assert.equal(arr.clearedLand, true);

  assert.ok(stepUntil(e, () => ['rollout', 'ground', 'taxiRamp'].includes(arr.phase), 120), 'arrival lands');
  assert.ok(stepUntil(e, () => arr.phase === 'ground', 60), 'arrival exits the runway');
  assert.ok(arr.gate, 'arrival gets a gate');

  r = e.command(`${arr.callsign} taxi to the ramp`);
  assert.equal(r.ok, true, 'taxi to ramp accepted');
  assert.ok(stepUntil(e, () => arr.phase === 'done', 120), 'arrival parks');
  assert.ok(e.stats.served >= 1);
}

// --- scoring ---------------------------------------------------------------
{
  const e = new SimEngine({ duration: 30, difficulty: 'busy', seed: 3 });
  e.spawnTimer = 9999;
  e.finish();
  const score = e.score;
  assert.ok(score && typeof score.total === 'number');
  assert.ok(score.total >= 0 && score.total <= 100);
  assert.equal(score.parts.length, 3);
}

// A shift with no answered calls must not get free communication credit.
{
  const e = new SimEngine({ duration: 600, difficulty: 'calm', seed: 4 });
  e.spawnTimer = 9999;
  e.aircraft = [];
  e.stats.responseTimes = [];
  e.stats.unanswered = 0;
  const comms = e.computeScore().parts.find((p) => p.key === 'communication');
  assert.equal(comms.points, 0, 'no answered calls => 0 communication points');
}

// Unanswered pilot calls subtract from communication points.
{
  const e = new SimEngine({ duration: 600, difficulty: 'calm', seed: 5 });
  e.spawnTimer = 9999;
  e.aircraft = [];
  e.stats.responseTimes = [5, 8, 12];
  e.stats.unanswered = 0;
  const base = e.computeScore().parts.find((p) => p.key === 'communication').points;
  e.stats.unanswered = 3;
  const penalized = e.computeScore().parts.find((p) => p.key === 'communication').points;
  assert.equal(base - penalized, 6, '2 points per unanswered call');
  assert.ok(penalized >= 0, 'communication score never goes negative');

  const es = new SimEngine({ duration: 600, difficulty: 'calm', seed: 6, lang: 'es' });
  es.spawnTimer = 9999;
  es.aircraft = [];
  es.stats.responseTimes = [];
  const esScore = es.computeScore();
  assert.equal(esScore.parts[0].label, 'Seguridad');
  assert.equal(esScore.parts[1].label, 'Comunicación');
  assert.match(esScore.parts[1].notes[0], /No se respondió ninguna llamada/);
}

// --- holding short blocks the runway --------------------------------------
{
  const e = new SimEngine({ duration: 600, difficulty: 'calm', seed: 11 });
  e.spawnTimer = 9999;
  e.aircraft = e.aircraft.filter((a) => a.kind === 'departure');
  const dep = e.aircraft[0];
  dep.readyAt = 0;
  e.tick(0.2);
  e.command(`${dep.callsign} taxi to runway ${e.geo.runway}`);
  assert.ok(stepUntil(e, () => dep.phase === 'holding', 200));
  const xAtHold = dep.x;
  e.tick(2);
  assert.equal(dep.phase, 'holding');
  assert.ok(Math.abs(dep.x - xAtHold) < 5, 'aircraft stays at the holding point');
}

console.log('OpenTower engine tests passed');

// --- full shift with a simple bot: no deadlocks ----------------------------
{
  const e = new SimEngine({ duration: 300, difficulty: 'busy', seed: 123 });
  const last = new Map();
  for (let i = 0; i < 3000; i++) {
    e.tick(0.1);
    for (const ac of e.activeAircraft()) {
      if ((last.get(ac.id) ?? -99) > e.t - 4) continue;
      let cmd = null;
      if (ac.phase === 'parked') cmd = `taxi to runway ${e.geo.runway}`;
      else if (ac.phase === 'holding') cmd = 'cleared for takeoff';
      else if (ac.phase === 'final') cmd = 'cleared to land';
      else if (ac.phase === 'crossing') cmd = 'cross runway 12';
      else if (ac.phase === 'ground') cmd = 'taxi to the ramp';
      else if (ac.phase === 'lined_up') cmd = 'cleared for takeoff';
      if (cmd) {
        e.command(`${ac.callsign} ${cmd}`);
        last.set(ac.id, e.t);
      }
    }
  }
  e.finish();
  assert.ok(e.stats.served >= 4, `bot should serve aircraft (served=${e.stats.served})`);
  assert.ok(e.activeAircraft().length <= 10, 'traffic does not pile up forever');
  assert.ok(e.score.total > 0 && e.score.total <= 100, 'score stays in range');
}

console.log('OpenTower simulation checks passed');

// --- scenarios and weather ------------------------------------------------
{
  const { scenarioById } = await import('../src/scenarios.js');
  const { runwayForWind } = await import('../src/weather.js');
  const sc = scenarioById('first');
  const e = new SimEngine({ scenario: sc, seed: 5 });
  assert.equal(e.duration, 300, 'scenario overrides duration');
  for (let i = 0; i < 30; i++) e.tick(0.1);
  assert.equal(e.activeAircraft().filter((a) => a.kind === 'departure').length, 1, 'scripted departure spawns');
  for (let i = 0; i < 420; i++) e.tick(0.1);
  assert.ok(e.activeAircraft().some((a) => a.kind === 'arrival'), 'scripted arrival spawns');
  assert.equal(runwayForWind(270), '27');
  assert.equal(runwayForWind(90), '09');
  const e2 = new SimEngine({ scenario: sc, seed: 1, weather: { windDir: 270, windSpeed: 8, altimeter: '29.95', visibilitySm: 10, live: true, raw: 'KPHX TEST' } });
  assert.equal(e2.activeRunway, '27');
  assert.equal(e2.weather.live, true);
}

console.log('OpenTower scenario checks passed');

// --- north ramp: cross inactive runway 12 --------------------------------
{
  const { scenarioById } = await import('../src/scenarios.js');
  const e = new SimEngine({ scenario: scenarioById('north'), seed: 9 });
  for (let i = 0; i < 40; i++) e.tick(0.1);
  const dep = e.aircraft.find((a) => a.kind === 'departure');
  assert.ok(dep, 'north departure spawned');
  assert.equal(dep.gate.id, 'N1');
  dep.readyAt = 0;
  e.tick(0.2);
  assert.equal(e.command(`${dep.callsign} taxi to runway ${e.geo.runway}`).ok, true);
  assert.ok(stepUntil(e, () => dep.phase === 'crossing', 240), 'holds short of runway 12');
  assert.equal(dep.call.kind, 'crossing');
  assert.equal(e.command(`${dep.callsign} cross runway 12`).ok, true);
  assert.ok(stepUntil(e, () => dep.phase === 'holding', 240), 'reaches the main runway hold');
}

console.log('OpenTower crossing checks passed');

// --- approach (TRACON) mode ----------------------------------------------
{
  const { TraconEngine } = await import('../src/tracon.js');
  const e = new TraconEngine({ duration: 600, seed: 3, difficulty: 'calm', weather: { windDir: 270, windSpeed: 8, altimeter: '29.95', visibilitySm: 10, live: false } });
  e.spawnTimer = 9999;
  e.aircraft = [];
  const ac = e.spawn('arrival');
  assert.ok(ac && ac.phase === 'cruise');
  assert.equal(e.activeRunway, '27');

  assert.equal(e.command(`${ac.callsign} turn left`).ok, true);
  assert.ok(ac.assignedHdg != null);
  assert.equal(e.command(`${ac.callsign} descend and maintain 3000`).ok, true);
  assert.equal(ac.assignedAlt, 3000);

  // Place it 6 NM out, aligned, then clear the approach.
  const finalHdg = e.geo.heading;
  ac.hdg = finalHdg;
  ac.assignedHdg = finalHdg;
  ac.x = e.geo.thresholdX + (e.geo.dir === -1 ? 6 * 1852 : -6 * 1852);
  ac.y = 0;
  ac.alt = 3000;
  const cleared = e.command(`${ac.callsign} cleared ILS`);
  assert.equal(cleared.ok, true, 'approach clearance accepted');
  assert.equal(ac.cleared, true);
  for (let i = 0; i < 80; i++) e.tick(0.2);
  assert.ok(ac.onApproach || ac.phase === 'final', 'established on the approach');
  const handoff = e.command(`${ac.callsign} contact tower`);
  assert.equal(handoff.ok, true, 'handoff accepted');
  assert.ok(e.stats.served >= 1);

  const score = e.computeScore();
  assert.equal(score.parts.length, 3);
  assert.ok(score.total >= 0 && score.total <= 100);
}

console.log('OpenTower approach checks passed');

// --- Spanish phraseology ---------------------------------------------------
{
  const ac = [{ callsign: 'N123AB', spoken: 'N123AB' }];
  assert.equal(
    findAddressee('N uno dos tres alfa bravo, ruede a la pista dos siete', ac).aircraft.callsign,
    'N123AB',
  );
  assert.equal(
    findAddressee('N uno dos tres alfa bravo, autorizado para despegar', ac).aircraft.callsign,
    'N123AB',
  );
  assert.deepEqual(parseInstruction('N123AB ruede a la pista dos siete'), {
    type: 'taxi', to: 'runway', viaBravo: false, runway: '27',
  });
  assert.equal(parseInstruction('N123AB autorizado para despegar').type, 'takeoff');
  assert.equal(parseInstruction('N123AB autorizado para aterrizar pista cero nueve').type, 'land');
  assert.equal(parseInstruction('N123AB autorizado para aterrizar pista cero nueve').runway, '09');
  assert.equal(parseInstruction('N123AB alineese y espere').type, 'lineUp');
  assert.equal(parseInstruction('N123AB alto antes de la pista dos siete').type, 'holdShort');
  assert.equal(parseInstruction('N123AB espere').type, 'standby');
  assert.equal(parseInstruction('N123AB frustrada').type, 'goAround');
  assert.equal(parseInstruction('N123AB repita').type, 'sayAgain');
  assert.equal(parseInstruction('N123AB recibido').type, 'ack');
  assert.equal(parseInstruction('N123AB cruce la pista 12').type, 'cross');
  assert.equal(parseInstruction('N123AB contacte tierra').type, 'contact');
  assert.equal(parseInstruction('N123AB contacte con torre').type, 'contact');
  assert.equal(parseInstruction('N123AB cambie a tierra').type, 'contact');
  assert.equal(parseInstruction('N123AB cancele despegue').type, 'abort');
  assert.equal(parseInstruction('N123AB continue el rodaje').type, 'continueTaxi');
  assert.equal(parseInstruction('N123AB ruede a la plataforma').to, 'ramp');
  assert.equal(parseInstruction('N123AB ruede por bravo').viaBravo, true);
  assert.equal(parseInstruction('N123AB ruede por la bravo').viaBravo, true);
  assert.equal(parseInstruction('N123AB ruede al hangar').to, 'ramp');
  assert.equal(parseInstruction('N123AB autorizado para despegar pista 09').runway, '09');
  assert.equal(parseInstruction('N123AB autorizado a despegar').type, 'takeoff');
  assert.equal(parseInstruction('N123AB autorizado para el despegue').type, 'takeoff');
  assert.equal(parseInstruction('N123AB autorizado a aterrizar').type, 'land');
  assert.equal(parseInstruction('N123AB autorizado para el aterrizaje').type, 'land');
  assert.equal(parseInstruction('N123AB deténgase antes de la pista 27').type, 'holdShort');
  assert.equal(parseInstruction('N123AB alto antes').type, 'holdShort');
  assert.equal(parseInstruction('N123AB espere en el punto de espera').type, 'holdShort');
  assert.equal(parseInstruction('N123AB prosiga').type, 'continueTaxi');
  assert.equal(parseInstruction('N123AB aguarde').type, 'standby');
  assert.equal(parseInstruction('N123AB afirmativo').type, 'ack');
  assert.equal(parseInstruction('N123AB cruce la 12').type, 'cross');
  assert.equal(parseInstruction('N123AB cruce la pista doce').type, 'cross');
  assert.equal(parseInstruction('N123AB ruede a la pista veintisiete').runway, '27');
  assert.equal(parseInstruction('N123AB ruede a la pista nueve').runway, '09');
  assert.equal(parseInstruction('N123AB ¡ruede a la pista dos siete!').type, 'taxi');

  const spanishLetters = [
    { callsign: 'N9XZ', spoken: 'N9XZ' },
    { callsign: 'N101AB', spoken: 'N101AB' },
  ];
  assert.equal(
    findAddressee('N nueve equis zulu, autorizado para aterrizar', spanishLetters).aircraft.callsign,
    'N9XZ',
  );
  assert.equal(
    findAddressee('N uno cero uno alfa bravo, autorizado para aterrizar', spanishLetters).aircraft.callsign,
    'N101AB',
  );
  assert.equal(
    findAddressee('NOVIEMBRE UNO DOS TRES ALFA BRAVO, ruede a la pista 27', ac).aircraft.callsign,
    'N123AB',
  );
}

console.log('OpenTower Spanish phraseology checks passed');
