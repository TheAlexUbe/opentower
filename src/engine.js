// OpenTower - deterministic simulation engine (no DOM).
// Original implementation. Inspired by classic tower/ground ATC workflows.

import { AIRPORT, TYPES, AIRLINES, GA_TYPES, DIFFICULTIES, runwayGeometry } from './config.js';
import {
  dist, freeGate, gateById, onRunwaySurface,
  routeGateToHold, routeExitToGate, routeHoldToLineup,
} from './airport.js';
import { findAddressee, parseInstruction, phrase } from './phraseology.js';
import { runwayForWind } from './weather.js';

const TAXI_BOOST = 2.0;
const GROUND_PHASES = new Set(['parked', 'taxi', 'holding', 'crossing', 'lineup', 'lined_up', 'takeoff', 'rollout', 'abort', 'aborted', 'abortTaxi', 'ground', 'taxiRamp']);
const RUNWAY_PHASES = new Set(['lineup', 'lined_up', 'takeoff', 'rollout', 'abort', 'aborted', 'abortTaxi']);

const SAFETY_WEIGHTS = {
  runway: 12,
  air: 8,
  wake: 5,
  deviation: 4,
  lowAlt: 5,
  taxi: 2,
  unresolved: 2,
};

// Spanish controller reasons. The English string stays the internal key so
// both languages share one command path.
const REASONS_ES = {
  'taxiway bravo is not available; use alpha': 'la calle de rodaje bravo no está disponible; use alfa',
  'you are on the runway; taxi to the ramp': 'está en la pista; ruede a la plataforma',
  'unable to taxi clear': 'no es posible despejar la pista',
  'you are already at the ramp': 'ya está en la plataforma',
  'taxi to the ramp is not available for a departure; continue to the runway': 'el rodaje a la plataforma no está disponible para una salida; continúe a la pista',
  'taxi to the ramp is required after landing': 'se requiere rodar a la plataforma después de aterrizar',
  'taxi is not available in your current state': 'el rodaje no está disponible en su estado actual',
  'not holding short of runway one two': 'no está en el punto de espera de la pista uno dos',
  'runway one two occupied, hold short': 'pista uno dos ocupada; manténgase antes',
  'use cancel takeoff to stop the roll': 'use cancelar despegue para detener la carrera',
  'not available in your current state': 'no disponible en su estado actual',
  'not holding short of that runway': 'no está en el punto de espera de esa pista',
  'line up is for departing traffic': 'alinearse es para las salidas',
  'not at the holding point yet': 'aún no está en el punto de espera',
  'runway occupied': 'pista ocupada',
  'traffic on short final': 'tráfico en final corta',
  'takeoff clearance is for departing traffic': 'la autorización de despegue es para las salidas',
  'not ready for departure': 'aún no está listo para salir',
  'landing clearance is for inbound traffic': 'la autorización de aterrizaje es para las llegadas',
  'go around is for inbound traffic': 'la frustrada es para las llegadas',
  'no takeoff to cancel': 'no hay despegue que cancelar',
  'unable to continue': 'no es posible continuar',
  'nothing to repeat': 'nada que repetir',
  'unrecognized instruction': 'instrucción no reconocida',
};

const SAFETY_LABELS_ES = {
  runway: 'incursión de pista',
  air: 'conflicto aéreo',
  wake: 'estela',
  deviation: 'desviación/frustrada',
  lowAlt: 'baja altitud',
  taxi: 'conflicto de rodaje',
  unresolved: 'llamada sin resolver',
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const approachSpeed = (current, target, rate, dt) => {
  if (current < target) return Math.min(target, current + rate * dt);
  if (current > target) return Math.max(target, current - rate * dt);
  return current;
};

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * Deterministic Tower/Ground simulation engine.
 *
 * Owns the clock, traffic generation, aircraft movement, clearances,
 * runway/taxi conflicts and scoring. It never touches the DOM.
 *
 * @param {object} [options]
 * @param {number} [options.duration=600] - Shift length in simulated seconds.
 * @param {string} [options.difficulty='calm'] - Difficulty id.
 * @param {number} [options.seed=1] - PRNG seed; same seed, same traffic.
 * @param {object|null} [options.weather] - Pre-fetched weather snapshot.
 * @param {object|null} [options.scenario] - Built-in scenario override.
 * @param {'en'|'es'} [options.lang='en'] - Radio language.
 */
export class SimEngine {
  constructor({ duration = 600, difficulty = 'calm', seed = 1, weather = null, scenario = null, lang = 'en' } = {}) {
    this.scenario = scenario || null;
    this.mode = 'tower';
    this.lang = lang === 'es' ? 'es' : 'en';
    this.duration = scenario?.duration ?? duration;
    this.difficulty = DIFFICULTIES[scenario?.difficulty ?? difficulty] || DIFFICULTIES.calm;
    this.rand = mulberry32(seed);
    this.t = 0;
    this.finished = false;
    this.paused = false;
    this.aircraft = [];
    this.radio = [];
    this.radioSeq = 0;
    this.incidents = [];
    this.incidentCooldown = new Map();
    this.nextId = 1;
    this.callsigns = new Set();
    this.stats = {
      served: 0,
      failed: 0,
      clearanceErrors: 0,
      lateHandoffs: 0,
      departureWaits: [],
      responseTimes: [],
    };
    this.lastHeavy = { t: -999, wake: 'L' };
    this.crossingOwnerId = null;
    this.atis = String.fromCharCode(65 + Math.floor(this.rand() * 26));
    this.weather = weather;
    const windDir = weather?.windDir ?? (this.rand() < 0.5 ? 270 : 90);
    this.activeRunway = scenario?.runway ?? runwayForWind(windDir);
    this.geo = runwayGeometry(this.activeRunway);
    this.wind = {
      dir: windDir,
      speed: weather?.windSpeed ?? Math.floor(this.rand() * 12),
    };
    this.altimeter = weather?.altimeter ?? '29.92';
    this.visibility = weather?.visibilitySm ?? 10;
    this.script = scenario?.script ? scenario.script.map((s) => ({ ...s, done: false })) : null;
    this.spawnTimer = this.script ? 1e9 : 12;
    const source = weather?.live ? ` · KPHX en vivo ${weather.raw}` : '';
    this.log(
      'SYS',
      this.lang === 'es'
        ? `Inicio del turno. ${AIRPORT.name} (${AIRPORT.code}), pista ${this.activeRunway}, viento ${pad2(this.wind.dir)} a ${this.wind.speed}.${source}`
        : `Shift start. ${AIRPORT.name} (${AIRPORT.code}), runway ${this.activeRunway}, wind ${pad2(this.wind.dir)} at ${this.wind.speed}.${source}`,
      'TWR',
    );
    if (!this.script) this.spawn('departure');
    if (this.script) this.spawnTimer = 1e9;
  }

  // ---------------------------------------------------------------- logging
  log(from, text, freq = 'TWR') {
    this.radio.push({ seq: ++this.radioSeq, t: this.t, from, text, freq });
    if (this.radio.length > 400) this.radio.splice(0, this.radio.length - 400);
  }

  incident(type, text) {
    const last = this.incidentCooldown.get(type) ?? -999;
    if (this.t - last < 15) return;
    this.incidentCooldown.set(type, this.t);
    this.incidents.push({ t: this.t, type, text });
    this.log('SYS', `${this.lang === 'es' ? 'ALERTA' : 'ALERT'}: ${text}`, 'TWR');
  }

  // ------------------------------------------------------------- callsigns
  uniqueCallsign(make) {
    for (let i = 0; i < 60; i++) {
      const cs = make();
      if (!this.callsigns.has(cs)) {
        this.callsigns.add(cs);
        return cs;
      }
    }
    const cs = `N${9000 + Math.floor(this.rand() * 999)}`;
    this.callsigns.add(cs);
    return cs;
  }

  makeFlight(airlineChance = 0.55, opts = {}) {
    const gaCallsign = () => this.uniqueCallsign(() => {
      const digits = String(1 + Math.floor(this.rand() * 899));
      const letters = this.rand() < 0.55
        ? String.fromCharCode(65 + Math.floor(this.rand() * 26), 65 + Math.floor(this.rand() * 26))
        : '';
      return `N${digits}${letters}`;
    });

    if (opts.callsign) {
      let callsign = opts.callsign;
      if (this.callsigns.has(callsign)) {
        callsign = this.uniqueCallsign(() => `${opts.callsign}${1 + Math.floor(this.rand() * 9)}`);
      } else {
        this.callsigns.add(callsign);
      }
      const airline = AIRLINES.find((a) => callsign.startsWith(a.code)) || null;
      const type = TYPES[opts.type] || (airline ? TYPES[airline.types[0]] : TYPES.C172);
      return { airline, type, callsign, spoken: callsign };
    }

    if (opts.type && TYPES[opts.type]) {
      const type = TYPES[opts.type];
      const airline = AIRLINES.find((a) => a.types.includes(opts.type)) || null;
      const callsign = airline
        ? this.uniqueCallsign(() => `${airline.code}${1 + Math.floor(this.rand() * 899)}`)
        : gaCallsign();
      return {
        airline,
        type,
        callsign,
        spoken: airline ? `${airline.name.toUpperCase()} ${callsign.slice(airline.code.length)}` : callsign,
      };
    }

    if (this.rand() < airlineChance) {
      const airline = AIRLINES[Math.floor(this.rand() * AIRLINES.length)];
      const type = TYPES[airline.types[Math.floor(this.rand() * airline.types.length)]];
      const number = 1 + Math.floor(this.rand() * 899);
      const callsign = this.uniqueCallsign(() => `${airline.code}${number + Math.floor(this.rand() * 5)}`);
      return {
        airline,
        type,
        callsign,
        spoken: `${airline.name.toUpperCase()} ${callsign.slice(airline.code.length)}`,
      };
    }
    const type = TYPES[GA_TYPES[Math.floor(this.rand() * GA_TYPES.length)]];
    const callsign = gaCallsign();
    return { airline: null, type, callsign, spoken: callsign };
  }

  // -------------------------------------------------------------- spawning
  spawn(kind, opts = {}) {
    if (this.finished) return null;
    if (this.aircraft.filter((a) => a.phase !== 'done' && a.phase !== 'removed').length >= this.difficulty.maxTraffic) return null;

    if (kind === 'departure') {
      let gate = null;
      if (opts.gate) gate = freeGate(this.aircraft, AIRPORT.gates.filter((g) => g.id === opts.gate));
      if (!gate) {
        const gateOrder = AIRPORT.gates
          .filter((g) => g.y >= 0)
          .sort((a, b) => Math.abs(a.x - this.geo.holdX) - Math.abs(b.x - this.geo.holdX));
        gate = freeGate(this.aircraft, gateOrder);
      }
      if (!gate) return null;
      const flight = this.makeFlight(0.5, opts);
      const { airline, type, callsign } = flight;
      const ac = {
        id: this.nextId++,
        callsign,
        spoken: flight.spoken,
        type,
        airline,
        wake: type.wake,
        kind: 'departure',
        gate,
        phase: 'parked',
        x: gate.x,
        y: gate.y,
        alt: AIRPORT.elevation,
        heading: -Math.PI / 2,
        speed: 0,
        route: [],
        routeIdx: 0,
        call: null,
        readyAt: this.t + 2 + this.rand() * 4,
        clearedLand: false,
        clearedTakeoff: false,
        holdShort: true,
        holdHeld: false,
        holdSince: null,
        autoTakeoff: false,
        aborted: false,
        conflict: false,
        exited: false,
        doneAt: null,
        crossCleared: false,
        crossPrevPhase: null,
        crossingDirection: 0,
      };
      this.aircraft.push(ac);
      return ac;
    }

    // Arrival on a straight-in final.
    const flight = this.makeFlight(0.6, opts);
    const { airline, type, callsign } = flight;
    let gate = null;
    if (opts.gate) gate = freeGate(this.aircraft, AIRPORT.gates.filter((g) => g.id === opts.gate));
    if (!gate && this.rand() < 0.25) gate = freeGate(this.aircraft, AIRPORT.gates.filter((g) => g.y < 0));
    if (!gate) gate = freeGate(this.aircraft, AIRPORT.gates.filter((g) => g.y >= 0));
    if (!gate) gate = freeGate(this.aircraft);
    const finalDistance = 3000 + this.rand() * 400;
    const ac = {
      id: this.nextId++,
      callsign,
      spoken: flight.spoken,
      type,
      airline,
      wake: type.wake,
      kind: 'arrival',
      gate,
      phase: 'final',
      x: this.geo.thresholdX - this.geo.dir * finalDistance,
      y: 0,
      alt: AIRPORT.elevation + finalDistance * 0.0524 * 3.28084,
      heading: this.geo.dir === -1 ? Math.PI : 0,
      speed: type.final,
      route: [],
      routeIdx: 0,
      call: null,
      clearedLand: false,
      clearedTakeoff: false,
      holdShort: false,
      holdHeld: false,
      holdSince: null,
      autoTakeoff: false,
      aborted: false,
      conflict: false,
      exited: false,
      doneAt: null,
      crossCleared: false,
      crossPrevPhase: null,
      crossingDirection: 0,
      inboundNm: Math.max(1, Math.round((finalDistance / 1852) * 10) / 10),
    };
    this.aircraft.push(ac);
    this.call(ac, phrase.initialInbound(ac, ac.inboundNm, this.geo.dir === -1 ? 'east' : 'west', this.atis, this.lang), 'inbound', 'TWR');
    return ac;
  }

  call(ac, text, kind, freq) {
    ac.call = { text, kind, at: this.t, answered: false };
    this.log('PILOT', text, freq);
  }

  answer(ac) {
    if (ac.call && !ac.call.answered) {
      ac.call.answered = true;
      this.stats.responseTimes.push(this.t - ac.call.at);
    }
  }

  // ---------------------------------------------------------------- ticking
  tick(dt) {
    if (this.finished || this.paused) return;
    const step = Math.min(Math.max(dt, 0), 0.25);
    this.t += step;

    if (this.script) {
      for (const s of this.script) {
        if (!s.done && this.t >= s.t) {
          s.done = true;
          this.spawn(s.kind, s);
        }
      }
    } else {
      this.spawnTimer -= step;
      if (this.spawnTimer <= 0) {
        const active = this.aircraft.filter((a) => a.phase !== 'done' && a.phase !== 'removed');
        const depCount = active.filter((a) => a.kind === 'departure').length;
        const arrCount = active.filter((a) => a.kind === 'arrival').length;
        const preferred = depCount <= arrCount ? 'departure' : 'arrival';
        if (active.length < this.difficulty.maxTraffic) {
          this.spawn(preferred) || this.spawn(preferred === 'departure' ? 'arrival' : 'departure');
        }
        this.spawnTimer = (this.difficulty.interval / this.difficulty.density) * (0.75 + this.rand() * 0.5);
      }
    }

    for (const ac of this.aircraft) this.updateAircraft(ac, step);

    this.updateCrossingOwner();
    this.detectConflicts();
    this.updateCalls();

    for (const ac of this.aircraft) {
      if (ac.phase === 'done' && ac.doneAt !== null && this.t - ac.doneAt > 4) {
        ac.phase = 'removed';
      }
    }

    if (this.t >= this.duration) this.finish();
  }

  updateCalls() {
    for (const ac of this.aircraft) {
      if (ac.phase === 'parked' && this.t >= ac.readyAt && !ac.call) {
        this.call(ac, phrase.initialTaxi(ac, ac.gate, this.atis, this.lang), 'readyTaxi', 'GND');
      }
      if (ac.call && !ac.call.answered && this.t - ac.call.at > 90 && !ac.call.unansweredCounted) {
        this.stats.unanswered = (this.stats.unanswered || 0) + 1;
        ac.call.unansweredCounted = true;
      }
    }
  }

  updateAircraft(ac, dt) {
    switch (ac.phase) {
      case 'parked':
        ac.speed = 0;
        break;
      case 'taxi':
      case 'taxiRamp':
      case 'lineup':
        if (this.moveGround(ac, dt)) this.onGroundArrive(ac);
        break;
      case 'holding':
      case 'lined_up':
      case 'ground':
        ac.speed = 0;
        break;
      case 'takeoff':
        this.updateTakeoff(ac, dt);
        break;
      case 'airborne':
        this.updateAirborne(ac, dt);
        break;
      case 'final':
        this.updateFinal(ac, dt);
        break;
      case 'goAround':
        this.updateGoAround(ac, dt);
        break;
      case 'rollout':
        this.updateRollout(ac, dt);
        break;
      case 'abort':
        this.updateAbort(ac, dt);
        break;
      case 'aborted':
        ac.speed = 0;
        if (ac.abortedStoppedAt != null && this.t - ac.abortedStoppedAt > 20) {
          this.recoverAborted(ac, 'automatic');
        }
        break;
      case 'abortTaxi':
        if (this.moveGround(ac, dt)) this.onGroundArrive(ac);
        break;
      case 'done':
        break;
      default:
        break;
    }
  }

  // --------------------------------------------------------------- movement
  moveGround(ac, dt) {
    if (ac.holdHeld) {
      ac.speed = Math.max(0, ac.speed - ac.type.decel * 2.5 * dt);
      const move = ac.speed * dt;
      if (move > 0) {
        ac.x += Math.cos(ac.heading) * move;
        ac.y += Math.sin(ac.heading) * move;
      }
      return false;
    }
    if (!ac.route || ac.routeIdx >= ac.route.length) {
      ac.speed = Math.max(0, ac.speed - ac.type.decel * dt);
      return ac.speed < 0.05;
    }
    const target = ac.route[ac.routeIdx];
    const dx = target.x - ac.x;
    const dy = target.y - ac.y;
    const d = Math.hypot(dx, dy);

    if (target.cross && !ac.crossCleared) {
      if (d <= 6) {
        ac.x = target.x;
        ac.y = target.y;
        ac.speed = 0;
        if (ac.phase !== 'crossing') {
          ac.crossPrevPhase = ac.phase;
          ac.phase = 'crossing';
          this.call(
            ac,
            this.lang === 'es'
              ? `Torre, ${ac.callsign} en el punto de espera de la pista uno dos.`
              : `Tower, ${ac.callsign} holding short runway one two.`,
            'crossing',
            'TWR',
          );
        }
        return false;
      }
      const stopSpeed = Math.min(ac.type.taxi * TAXI_BOOST, Math.sqrt(2 * ac.type.decel * Math.max(0, d - 2)));
      const blockedCrossing = this.blockedAhead(ac);
      ac.heading = Math.atan2(dy, dx);
      ac.speed = approachSpeed(ac.speed, blockedCrossing ? 0 : stopSpeed, ac.type.decel * 1.5, dt);
      const moveToHold = Math.min(d, ac.speed * dt);
      ac.x += Math.cos(ac.heading) * moveToHold;
      ac.y += Math.sin(ac.heading) * moveToHold;
      return false;
    }

    if (d < 2.5) {
      ac.x = target.x;
      ac.y = target.y;
      ac.routeIdx++;
      if (ac.routeIdx >= ac.route.length) {
        ac.speed = 0;
        return true;
      }
      return false;
    }

    ac.heading = Math.atan2(dy, dx);
    const isLast = ac.routeIdx === ac.route.length - 1;
    let targetSpeed = ac.type.taxi * TAXI_BOOST;
    if (isLast) targetSpeed = Math.min(targetSpeed, Math.sqrt(2 * ac.type.decel * Math.max(0, d - 1)));
    if (this.blockedAhead(ac)) targetSpeed = 0;

    const blocked = targetSpeed === 0 && ac.speed > 0;
    const rate = blocked ? ac.type.decel * 2.5 : targetSpeed > ac.speed ? ac.type.accel : ac.type.decel;
    ac.speed = approachSpeed(ac.speed, targetSpeed, rate, dt);
    const move = Math.min(d, ac.speed * dt);
    ac.x += Math.cos(ac.heading) * move;
    ac.y += Math.sin(ac.heading) * move;
    return false;
  }

  blockedAhead(ac) {
    const hx = Math.cos(ac.heading);
    const hy = Math.sin(ac.heading);
    for (const other of this.aircraft) {
      if (other === ac || other.phase === 'done' || other.phase === 'removed') continue;
      if (!GROUND_PHASES.has(other.phase) && other.phase !== 'final') continue;
      const dx = other.x - ac.x;
      const dy = other.y - ac.y;
      const d = Math.hypot(dx, dy);
      if (d > 38) continue;
      const ahead = dx * hx + dy * hy;
      const lateral = Math.abs(dx * -hy + dy * hx);
      if (ahead > 2 && lateral < 12) return true;
    }
    return false;
  }

  onGroundArrive(ac) {
    if (ac.phase === 'taxi') {
      ac.phase = 'holding';
      ac.holdSince = this.t;
      ac.speed = 0;
      this.call(ac, phrase.holdingShort(ac, this.geo, this.lang), 'holdingShort', 'TWR');
    } else if (ac.phase === 'lineup') {
      ac.phase = 'lined_up';
      ac.speed = 0;
      if (ac.autoTakeoff) {
        ac.autoTakeoff = false;
        this.beginTakeoff(ac);
      }
    } else if (ac.phase === 'abortTaxi') {
      ac.phase = 'done';
      ac.doneAt = this.t;
      ac.speed = 0;
      this.log(
        'SYS',
        this.lang === 'es'
          ? `${ac.callsign} regresó a ${ac.gate.id} tras el despegue cancelado.`
          : `${ac.callsign} returned to ${ac.gate.id} after the cancelled takeoff.`,
        'GND',
      );
    } else if (ac.phase === 'taxiRamp') {
      ac.phase = 'done';
      ac.doneAt = this.t;
      this.stats.served += 1;
      this.log(
        'SYS',
        this.lang === 'es'
          ? `${ac.callsign} estacionado en ${ac.gate.id}. Tarea del turno completada.`
          : `${ac.callsign} parked at ${ac.gate.id}. Shift task complete.`,
        'GND',
      );
    }
  }

  updateTakeoff(ac, dt) {
    ac.y = 0;
    ac.heading = this.geo.dir === -1 ? Math.PI : 0;
    ac.speed = Math.min(ac.type.rotate + 20, ac.speed + ac.type.accel * dt);
    ac.x += this.geo.dir * ac.speed * dt;
    if (ac.speed >= ac.type.rotate && ac.alt <= AIRPORT.elevation + 1) {
      ac.phase = 'airborne';
      ac.alt = AIRPORT.elevation + 50;
      this.stats.served += 1;
      this.log('SYS', this.lang === 'es' ? `${ac.callsign} en el aire.` : `${ac.callsign} airborne.`, 'TWR');
    }
  }

  updateAirborne(ac, dt) {
    ac.alt += (ac.type.climbFpm / 60) * dt;
    ac.speed = approachSpeed(ac.speed, ac.type.climb, ac.type.accel, dt);
    ac.x += this.geo.dir * ac.speed * dt;
    if (ac.alt - AIRPORT.elevation >= 3000 || Math.abs(ac.x) > 6800) {
      ac.phase = 'done';
      ac.doneAt = this.t;
    }
  }

  updateFinal(ac, dt) {
    ac.heading = this.geo.dir === -1 ? Math.PI : 0;
    const gap = Math.abs(ac.x - this.geo.touchdownX);
    ac.alt = AIRPORT.elevation + Math.max(0, gap * 0.0524 * 3.28084);
    ac.speed = ac.type.final;
    ac.x += this.geo.dir * ac.speed * dt;

    if (!ac.clearedLand && gap < 1500) {
      ac.phase = 'goAround';
      ac.goAroundAt = this.t;
      this.stats.failed += 1;
      this.incident(
        'deviation',
        this.lang === 'es'
          ? `${ac.callsign} frustró la aproximación: sin autorización de aterrizaje.`
          : `${ac.callsign} went around: no landing clearance.`,
      );
      this.log('PILOT', this.lang === 'es' ? `Frustrada, ${ac.callsign}.` : `Going around, ${ac.callsign}.`, 'TWR');
      return;
    }
    if (ac.clearedLand && gap < 450 && this.runwayOccupants(ac).length > 0) {
      ac.phase = 'goAround';
      ac.goAroundAt = this.t;
      this.stats.failed += 1;
      this.incident(
        'deviation',
        this.lang === 'es'
          ? `${ac.callsign} frustró la aproximación: pista ocupada.`
          : `${ac.callsign} went around: runway occupied.`,
      );
      this.log('PILOT', this.lang === 'es' ? `Frustrada, pista ocupada, ${ac.callsign}.` : `Going around, runway occupied, ${ac.callsign}.`, 'TWR');
      return;
    }
    if (gap < 15) {
      ac.phase = 'rollout';
      ac.y = 0;
      ac.alt = AIRPORT.elevation;
      ac.speed = Math.max(ac.type.final * 0.95, 20);
      this.log(
        'SYS',
        this.lang === 'es'
          ? `${ac.callsign} tomó tierra en la pista ${this.activeRunway}.`
          : `${ac.callsign} touchdown runway ${this.activeRunway}.`,
        'TWR',
      );
      if (ac.wake === 'H' || ac.wake === 'J') {
        this.lastHeavy = { t: this.t, wake: ac.wake };
        this.log(
          'SYS',
          this.lang === 'es'
            ? 'Separación de estela: aterrizó un pesado. Espere 2 minutos antes de la próxima salida.'
            : 'Wake separation: heavy landing. Wait 2 minutes before the next departure.',
          'TWR',
        );
      }
    }
  }

  updateRollout(ac, dt) {
    const exitX = this.geo.exitX;
    const targetSpeed = Math.max(ac.type.taxi * TAXI_BOOST, 8);
    ac.speed = approachSpeed(ac.speed, targetSpeed, ac.type.decel, dt);
    ac.heading = this.geo.dir === -1 ? Math.PI : 0;
    ac.x += this.geo.dir * ac.speed * dt;

    const passedExit = (ac.x - exitX) * this.geo.dir >= 0;
    if (passedExit) {
      ac.x = exitX;
      ac.y = 0;
      ac.speed = Math.min(ac.speed, ac.type.taxi * TAXI_BOOST);
      const gate = ac.gate || freeGate(this.aircraft) || AIRPORT.gates[0];
      ac.gate = gate;
      ac.route = routeExitToGate(exitX, gate);
      ac.routeIdx = 0;
      ac.phase = 'ground';
      ac.exited = true;
      ac.heading = Math.PI / 2;
      this.call(ac, phrase.landed(ac, this.geo, gate, this.lang), 'taxiRequest', 'GND');
    }
  }

  updateAbort(ac, dt) {
    const decel = Math.max(ac.type.decel * 1.5, 5);
    ac.heading = this.geo.dir === -1 ? Math.PI : 0;
    ac.speed = Math.max(0, ac.speed - decel * dt);
    ac.x += this.geo.dir * ac.speed * dt;
    const limit = 870;
    if (Math.abs(ac.x) > limit) {
      ac.x = Math.sign(ac.x) * limit;
      ac.speed = 0;
    }
    if (ac.speed < 0.2) {
      ac.speed = 0;
      ac.phase = 'aborted';
      ac.abortedStoppedAt = this.t;
      ac.clearedTakeoff = false;
      this.call(
        ac,
        this.lang === 'es'
          ? `Torre, ${ac.callsign} detenido en la pista.`
          : `Tower, ${ac.callsign} stopped on the runway.`,
        'aborted',
        'TWR',
      );
      this.log(
        'SYS',
        this.lang === 'es'
          ? `${ac.callsign} detenido tras el despegue cancelado.`
          : `${ac.callsign} stopped after a cancelled takeoff.`,
        'TWR',
      );
    }
  }

  nearestRunwayExit(ac) {
    const ahead = AIRPORT.connectors
      .filter((c) => (c.x - ac.x) * this.geo.dir >= -5)
      .sort((a, b) => Math.abs(a.x - ac.x) - Math.abs(b.x - ac.x));
    const choice = ahead[0]
      || AIRPORT.connectors.slice().sort((a, b) => Math.abs(a.x - ac.x) - Math.abs(b.x - ac.x))[0];
    return choice.x;
  }

  /** Leave the runway after a cancelled takeoff and return to a gate. */
  recoverAborted(ac, source = 'instruction') {
    if (ac.phase !== 'aborted') return false;
    const gate = ac.gate || freeGate(this.aircraft) || AIRPORT.gates[0];
    ac.gate = gate;
    const exitX = this.nearestRunwayExit(ac);
    ac.route = [
      { x: exitX, y: 0 },
      { x: exitX, y: AIRPORT.alphaArrY },
      { x: gate.x, y: AIRPORT.alphaArrY },
      { x: gate.x, y: gate.y },
    ];
    ac.routeIdx = 0;
    ac.phase = 'abortTaxi';
    ac.abortedStoppedAt = null;
    ac.speed = Math.min(ac.speed, ac.type.taxi * TAXI_BOOST);
    if (source === 'automatic') {
      this.log(
        'SYS',
        this.lang === 'es'
          ? `${ac.callsign} está despejando la pista.`
          : `${ac.callsign} is taxiing clear of the runway.`,
        'TWR',
      );
    }
    return true;
  }

  updateGoAround(ac, dt) {
    ac.alt += (ac.type.climbFpm / 60) * dt;
    ac.speed = approachSpeed(ac.speed, ac.type.climb, ac.type.accel, dt);
    ac.x += this.geo.dir * ac.speed * dt;
    if (ac.alt - AIRPORT.elevation > 1200) {
      ac.phase = 'done';
      ac.doneAt = this.t;
    }
  }

  // --------------------------------------------------------------- helpers
  runwayOccupants(exclude) {
    return this.aircraft.filter((a) => {
      if (a === exclude || a.phase === 'done' || a.phase === 'removed') return false;
      if (!RUNWAY_PHASES.has(a.phase)) return false;
      return onRunwaySurface(a.x, a.y, this.geo);
    });
  }

  runwayOccupied(exclude) {
    return this.runwayOccupants(exclude).length > 0;
  }

  trafficOnFinal(exclude) {
    return this.aircraft.find(
      (a) => a !== exclude && a.phase === 'final' && Math.abs(a.x - this.geo.touchdownX) < 900,
    );
  }

  updateCrossingOwner() {
    if (this.crossingOwnerId == null) return;
    const ac = this.aircraft.find((a) => a.id === this.crossingOwnerId);
    if (!ac || ['done', 'removed'].includes(ac.phase)) {
      this.crossingOwnerId = null;
      return;
    }
    const c = AIRPORT.crossing;
    const passed = ac.crossingDirection >= 0
      ? ac.y > c.centerY + 28
      : ac.y < c.centerY - 28;
    if (passed) {
      ac.crossCleared = false;
      this.crossingOwnerId = null;
    }
  }

  detectConflicts() {
    for (const ac of this.aircraft) ac.conflict = false;
    const occ = this.runwayOccupants();
    if (occ.length >= 2) {
      this.incident(
        'runway',
        this.lang === 'es'
          ? `incursión de pista: ${occ.map((a) => a.callsign).join(', ')}`
          : `runway incursion: ${occ.map((a) => a.callsign).join(', ')}`,
      );
    }

    const ground = this.aircraft.filter((a) => ['taxi', 'taxiRamp', 'ground', 'rollout'].includes(a.phase));
    for (let i = 0; i < ground.length; i++) {
      for (let j = i + 1; j < ground.length; j++) {
        const a = ground[i];
        const b = ground[j];
        const d = dist(a, b);
        a.conflict = b.conflict = d < 55 && Math.abs(a.y - b.y) < 14 && a.speed > 1 && b.speed > 1;
        if (d < 9 && a.speed > 0.8 && b.speed > 0.8) {
          this.incident(
            'taxi',
            this.lang === 'es'
              ? `conflicto de rodaje: ${a.callsign} y ${b.callsign}`
              : `taxi conflict: ${a.callsign} and ${b.callsign}`,
          );
        }
      }
    }
  }

  beginTakeoff(ac) {
    ac.phase = 'takeoff';
    ac.clearedTakeoff = true;
    ac.clearedLand = false;
    ac.holdHeld = false;
    const wait = ac.holdSince !== null ? this.t - ac.holdSince : 0;
    if (wait > 0) this.stats.departureWaits.push(wait);
    ac.holdSince = null;
    if (this.t - this.lastHeavy.t < 120 && (ac.wake === 'L' || ac.wake === 'M')) {
      this.incident(
        'wake',
        this.lang === 'es'
          ? `turbulencia de estela: ${ac.callsign} despegó detrás de un pesado en menos de 2 minutos`
          : `wake turbulence: ${ac.callsign} departed behind a heavy within 2 minutes`,
      );
    }
    if (ac.wake === 'H' || ac.wake === 'J') {
      this.lastHeavy = { t: this.t, wake: ac.wake };
      this.log(
        'SYS',
        this.lang === 'es'
          ? 'Separación de estela: salida pesada. Espere 2 minutos antes de la próxima salida.'
          : 'Wake separation: heavy departure. Wait 2 minutes before the next departure.',
        'TWR',
      );
    }
    this.log(
      'SYS',
      this.lang === 'es'
        ? `${ac.callsign} iniciando carrera en la pista ${this.activeRunway}.`
        : `${ac.callsign} rolling runway ${this.activeRunway}.`,
      'TWR',
    );
  }

  // --------------------------------------------------------------- commands
  command(text) {
    const raw = String(text || '').trim();
    if (!raw) return { ok: false };
    if (this.finished) return { ok: false, error: 'Shift is over.' };

    const active = this.aircraft.filter((a) => !['done', 'removed'].includes(a.phase));
    const found = findAddressee(raw, active);
    if (!found.aircraft) {
      this.log('ATC', raw, 'TWR');
      this.log(
        'SYS',
        this.lang === 'es'
          ? 'Ninguna aeronave coincide con ese indicativo. Revise las fichas y repita.'
          : 'No aircraft matches that callsign. Check the strips and say again.',
        'TWR',
      );
      return { ok: false, error: 'unknown callsign' };
    }
    if (found.ambiguous) {
      this.log('ATC', raw, 'TWR');
      this.log(
        'SYS',
        this.lang === 'es'
          ? 'Varias aeronaves coinciden; use el indicativo completo.'
          : 'Several aircraft match; use the full callsign.',
        'TWR',
      );
      return { ok: false, error: 'ambiguous callsign' };
    }

    const ac = found.aircraft;
    const ins = parseInstruction(raw);
    if (ins.type === 'empty') return { ok: false };
    this.answer(ac);

    const result = this.apply(ac, ins);
    if (result.atc) this.log('ATC', result.atc, ac.phase === 'ground' || ac.phase === 'parked' ? 'GND' : 'TWR');
    if (result.pilot) this.log('PILOT', result.pilot, ac.phase === 'ground' || ac.phase === 'parked' ? 'GND' : 'TWR');
    if (result.system) this.log('SYS', result.system, 'TWR');
    return result;
  }

  apply(ac, ins) {
    const g = this.geo;
    switch (ins.type) {
      case 'taxi': {
        if (ins.viaBravo) return this.unable(ac, 'taxiway bravo is not available; use alpha');
        if (ins.runway && ins.runway !== g.runway) {
          return this.unable(ac, `active runway is ${g.runway}`);
        }
        if (ac.kind === 'departure' && ac.phase === 'aborted') {
          if (ins.to !== 'ramp') return this.unable(ac, 'you are on the runway; taxi to the ramp');
          if (!this.recoverAborted(ac)) return this.unable(ac, 'unable to taxi clear');
          return this.ok(ac, {
            atc: this.lang === 'es'
              ? `${ac.callsign}, ruede a la plataforma ${ac.gate.id} por la salida más cercana.`
              : `${ac.callsign}, taxi to the ${ac.gate.id} ramp via the nearest exit.`,
            pilot: this.lang === 'es'
              ? `Ruedo a la plataforma ${ac.gate.id}, ${ac.callsign}.`
              : `Taxi to the ${ac.gate.id} ramp, ${ac.callsign}.`,
          });
        }
        if (ac.kind === 'departure' && ac.phase === 'abortTaxi') {
          return this.ack(ac, phrase.taxiRamp(ac, ac.gate, this.lang));
        }
        if (ac.kind === 'departure' && ['parked', 'holding', 'taxi'].includes(ac.phase)) {
          if (ins.to === 'ramp') {
            return this.unable(ac, ac.phase === 'parked'
              ? 'you are already at the ramp'
              : 'taxi to the ramp is not available for a departure; continue to the runway');
          }
          if (ac.phase === 'holding' || ac.phase === 'taxi') return this.ack(ac, phrase.taxi(ac, g, this.lang));
          ac.route = routeGateToHold(ac.gate, g);
          ac.routeIdx = 0;
          ac.phase = 'taxi';
          ac.holdShort = true;
          return this.ok(ac, phrase.taxi(ac, g, this.lang));
        }
        if (ac.kind === 'arrival' && ac.phase === 'ground') {
          if (ins.to !== 'ramp') return this.unable(ac, 'taxi to the ramp is required after landing');
          ac.route = ac.route && ac.route.length ? ac.route : routeExitToGate(g.exitX, ac.gate);
          ac.routeIdx = 0;
          ac.phase = 'taxiRamp';
          if (ac.call && !ac.call.answered) this.ack(ac, phrase.taxiRamp(ac, ac.gate, this.lang));
          this.stats.lateHandoffs += this.t - (ac.call?.at ?? this.t) > 90 ? 1 : 0;
          return this.ok(ac, phrase.taxiRamp(ac, ac.gate, this.lang));
        }
        return this.unable(ac, 'taxi is not available in your current state');
      }
      case 'cross': {
        if (ac.phase !== 'crossing') return this.unable(ac, 'not holding short of runway one two');
        if (this.crossingOwnerId != null && this.crossingOwnerId !== ac.id) {
          return this.unable(ac, 'runway one two occupied, hold short');
        }
        ac.crossingDirection = ac.y < AIRPORT.crossing.centerY ? 1 : -1;
        this.crossingOwnerId = ac.id;
        ac.crossCleared = true;
        ac.phase = ac.crossPrevPhase || 'taxi';
        ac.crossPrevPhase = null;
        return this.ok(ac, {
          atc: this.lang === 'es'
            ? `${ac.callsign}, cruce la pista uno dos.`
            : `${ac.callsign}, cross runway one two.`,
          pilot: this.lang === 'es'
            ? `Cruzo la pista uno dos, ${ac.callsign}.`
            : `Cross runway one two, ${ac.callsign}.`,
        });
      }
      case 'holdShort': {
        if (ac.phase === 'takeoff') {
          return this.unable(ac, 'use cancel takeoff to stop the roll');
        }
        if (['final', 'airborne', 'goAround', 'rollout', 'aborted', 'abortTaxi'].includes(ac.phase)) {
          return this.unable(ac, 'not available in your current state');
        }
        if (ac.phase === 'crossing') {
          if (ins.runway && ins.runway !== '12') return this.unable(ac, 'not holding short of that runway');
          ac.holdShort = true;
          return this.ack(ac, {
            atc: this.lang === 'es'
              ? `${ac.callsign}, alto antes de la pista uno dos.`
              : `${ac.callsign}, hold short runway one two.`,
            pilot: this.lang === 'es'
              ? `Alto antes de la pista uno dos, ${ac.callsign}.`
              : `Holding short runway one two, ${ac.callsign}.`,
          });
        }
        if (ins.runway && ins.runway !== g.runway) {
          return this.unable(ac, `active runway is ${g.runway}`);
        }
        ac.holdShort = true;
        if (['taxi', 'taxiRamp', 'lineup', 'abortTaxi'].includes(ac.phase)) ac.holdHeld = true;
        return this.ok(ac, phrase.holdShort(ac, g, this.lang));
      }
      case 'lineUp': {
        if (ac.kind !== 'departure') return this.clearanceError(ac, 'line up is for departing traffic');
        if (ins.runway && ins.runway !== g.runway) return this.unable(ac, `active runway is ${g.runway}`);
        if (ac.phase === 'lined_up') return this.ack(ac, phrase.lineUp(ac, g, this.lang));
        if (ac.phase !== 'holding') return this.unable(ac, 'not at the holding point yet');
        if (this.runwayOccupied(ac)) return this.unable(ac, 'runway occupied');
        if (this.trafficOnFinal(ac)) return this.unable(ac, 'traffic on short final');
        ac.route = routeHoldToLineup(g);
        ac.routeIdx = 0;
        ac.phase = 'lineup';
        ac.autoTakeoff = false;
        ac.holdHeld = false;
        return this.ok(ac, phrase.lineUp(ac, g, this.lang));
      }
      case 'takeoff': {
        if (ac.kind !== 'departure') return this.clearanceError(ac, 'takeoff clearance is for departing traffic');
        if (ins.runway && ins.runway !== this.activeRunway) return this.unable(ac, `active runway is ${this.activeRunway}`);
        if (ac.phase === 'takeoff' || ac.phase === 'airborne') return this.ack(ac, phrase.takeoff(ac, g, this.lang));
        if (ac.phase !== 'lined_up' && ac.phase !== 'holding') return this.unable(ac, 'not ready for departure');
        if (this.runwayOccupied(ac)) return this.unable(ac, 'runway occupied');
        if (this.trafficOnFinal(ac)) return this.unable(ac, 'traffic on short final');
        if (ac.phase === 'holding') {
          ac.route = routeHoldToLineup(g);
          ac.routeIdx = 0;
          ac.phase = 'lineup';
          ac.autoTakeoff = true;
        } else {
          this.beginTakeoff(ac);
        }
        ac.holdHeld = false;
        return this.ok(ac, phrase.takeoff(ac, g, this.lang));
      }
      case 'land': {
        if (ac.kind !== 'arrival' || ac.phase !== 'final') return this.clearanceError(ac, 'landing clearance is for inbound traffic');
        if (ins.runway && ins.runway !== this.activeRunway) return this.unable(ac, `active runway is ${this.activeRunway}`);
        if (this.runwayOccupied(ac)) return this.unable(ac, 'runway occupied');
        ac.clearedLand = true;
        return this.ok(ac, phrase.land(ac, g, this.lang));
      }
      case 'goAround': {
        if (ac.phase !== 'final') return this.unable(ac, 'go around is for inbound traffic');
        ac.phase = 'goAround';
        ac.goAroundAt = this.t;
        this.stats.failed += 1;
        this.incident(
          'deviation',
          this.lang === 'es'
            ? `${ac.callsign} frustró la aproximación por instrucción.`
            : `${ac.callsign} went around on instruction.`,
        );
        return this.ok(ac, phrase.goAround(ac, this.lang));
      }
      case 'abort': {
        if (ac.phase !== 'takeoff') return this.unable(ac, 'no takeoff to cancel');
        ac.phase = 'abort';
        ac.aborted = true;
        ac.clearedTakeoff = false;
        ac.speed = Math.max(0, ac.speed);
        this.stats.failed += 1;
        return this.ok(ac, phrase.cancelTakeoff(ac, this.lang));
      }
      case 'continueTaxi': {
        if (ac.phase === 'aborted') {
          if (!this.recoverAborted(ac)) return this.unable(ac, 'unable to continue');
          return this.ok(ac, {
            atc: this.lang === 'es'
              ? `${ac.callsign}, continúe el rodaje, ruede a la plataforma ${ac.gate.id} por la salida más cercana.`
              : `${ac.callsign}, continue taxi, taxi to the ${ac.gate.id} ramp via the nearest exit.`,
            pilot: this.lang === 'es'
              ? `Continúo el rodaje a la plataforma ${ac.gate.id}, ${ac.callsign}.`
              : `Continuing taxi to the ${ac.gate.id} ramp, ${ac.callsign}.`,
          });
        }
        if (ac.holdHeld) ac.holdHeld = false;
        return this.ack(ac, phrase.continueTaxi(ac, this.lang));
      }
      case 'contact': {
        return this.ack(ac, phrase.contactGround(ac, this.lang));
      }
      case 'sayAgain': {
        if (ac.call) {
          return this.ok(ac, {
            atc: `${ac.callsign}, ${this.lang === 'es' ? 'repito' : 'I say again'}.`,
            pilot: ac.call.text,
          });
        }
        return this.unable(ac, 'nothing to repeat');
      }
      case 'standby': {
        return { ok: true, system: `${ac.callsign}, ${this.lang === 'es' ? 'espere' : 'standby'}.` };
      }
      case 'ack': {
        return this.ack(ac, {
          atc: `${ac.callsign}, ${this.lang === 'es' ? 'recibido' : 'roger'}.`,
          pilot: `${ac.callsign}.`,
        });
      }
      case 'unknown':
      default:
        return this.unable(ac, 'unrecognized instruction');
    }
  }

  ok(ac, p) {
    return { ok: true, atc: p.atc, pilot: p.pilot, aircraft: ac };
  }

  ack(ac, p) {
    return { ok: true, atc: p.atc, pilot: p.pilot, aircraft: ac };
  }

  reason(why) {
    if (this.lang !== 'es') return why;
    const active = why.match(/^active runway is (\d+)$/);
    if (active) return `la pista activa es ${active[1]}`;
    return REASONS_ES[why] || why;
  }

  unable(ac, why) {
    const es = this.lang === 'es';
    return { ok: false, atc: `${ac.callsign}, ${es ? 'imposible' : 'unable'}, ${this.reason(why)}.`, pilot: `${es ? 'Imposible' : 'Unable'}, ${ac.callsign}.`, aircraft: ac };
  }

  clearanceError(ac, why) {
    this.stats.clearanceErrors += 1;
    const es = this.lang === 'es';
    return { ok: false, atc: `${ac.callsign}, ${es ? 'imposible' : 'unable'}, ${this.reason(why)}.`, pilot: `${es ? 'Imposible' : 'Unable'}, ${ac.callsign}.`, aircraft: ac, error: 'clearance' };
  }

  // ------------------------------------------------------------------ score
  finish() {
    if (this.finished) return;
    this.finished = true;
    this.score = this.computeScore();
    this.log(
      'SYS',
      this.lang === 'es'
        ? `Turno completo. Calificación ${this.score.grade} (${this.score.total}/100).`
        : `Shift complete. Grade ${this.score.grade} (${this.score.total}/100).`,
      'TWR',
    );
  }

  computeScore() {
    const es = this.lang === 'es';
    const active = this.aircraft.filter((a) => !['done', 'removed'].includes(a.phase));
    const counts = {
      runway: this.incidents.filter((i) => i.type === 'runway').length,
      air: this.incidents.filter((i) => i.type === 'air').length,
      wake: this.incidents.filter((i) => i.type === 'wake').length,
      deviation: this.incidents.filter((i) => i.type === 'deviation').length,
      lowAlt: this.incidents.filter((i) => i.type === 'lowAlt').length,
      taxi: this.incidents.filter((i) => i.type === 'taxi').length,
      unresolved: this.incidents.filter((i) => i.type === 'unresolved').length,
    };
    let safety = 40;
    const safetyNotes = [];
    for (const [key, weight] of Object.entries(SAFETY_WEIGHTS)) {
      const n = counts[key] ?? 0;
      if (!n) continue;
      safety -= n * weight;
      const label = es ? (SAFETY_LABELS_ES[key] || key) : key;
      safetyNotes.push(`${n} × ${label} (−${n * weight})`);
    }
    safety = Math.max(0, safety);
    if (!safetyNotes.length) safetyNotes.push(es ? 'Sin errores de seguridad.' : 'No safety errors.');

    const times = this.stats.responseTimes;
    const avgCredit = times.length ? times.reduce((sum, t) => sum + this.responseCredit(t), 0) / times.length : 0;
    const unanswered = this.stats.unanswered || 0;
    const comms = Math.max(
      0,
      Math.round(30 * avgCredit) - this.stats.clearanceErrors * 2 - this.stats.lateHandoffs - unanswered * 2,
    );
    const avg = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0;
    const good = times.filter((t) => t <= 20).length;
    const commsNotes = [
      times.length
        ? (es
          ? `${good} de ${times.length} llamadas respondidas en 20 s (media ${avg} s).`
          : `${good} of ${times.length} calls answered within 20 s (average ${avg} s).`)
        : (es ? 'No se respondió ninguna llamada.' : 'No pilot calls answered.'),
    ];
    if (unanswered) {
      commsNotes.push(es ? `${unanswered} llamada(s) sin responder.` : `${unanswered} call(s) left unanswered.`);
    }
    if (this.stats.clearanceErrors) {
      commsNotes.push(es ? `${this.stats.clearanceErrors} error(es) de autorización.` : `${this.stats.clearanceErrors} clearance error(s).`);
    }

    const waiting = active.filter((a) => ['holding', 'crossing', 'final', 'ground', 'parked', 'taxi', 'aborted', 'abortTaxi'].includes(a.phase)).length;
    const denom = this.stats.served + this.stats.failed + waiting * 0.5;
    const lateDepartures = this.stats.departureWaits.filter((w) => w > 120);
    const departurePenalty = lateDepartures.reduce((sum, w) => sum + Math.min(3, Math.floor((w - 120) / 60) + 1), 0);
    const traffic = Math.max(0, (denom ? Math.round(30 * (this.stats.served / denom)) : 30) - departurePenalty);
    const trafficNotes = [
      denom
        ? (es
          ? `${this.stats.served} de ${Math.round(denom * 2) / 2} aeronaves atendidas.`
          : `${this.stats.served} of ${Math.round(denom * 2) / 2} aircraft handled.`)
        : (es ? 'Sin tráfico que atender.' : 'No traffic to handle.'),
    ];
    if (this.stats.failed) {
      trafficNotes.push(es ? `${this.stats.failed} frustrada(s) o sin atender.` : `${this.stats.failed} went around or was left unhandled.`);
    }
    if (waiting) {
      trafficNotes.push(es ? `${waiting} aún en frecuencia al final.` : `${waiting} still waiting at the end.`);
    }
    if (departurePenalty) {
      trafficNotes.push(es
        ? `${lateDepartures.length} salida(s) retenida(s) más de 2 min (−${departurePenalty}).`
        : `${lateDepartures.length} departure(s) held over 2 min (−${departurePenalty}).`);
    }

    const total = Math.round(safety + comms + traffic);
    const grade = total >= 97 ? 'A+' : total >= 90 ? 'A' : total >= 80 ? 'B' : total >= 70 ? 'C' : total >= 60 ? 'D' : 'F';
    const objectives = [];
    const goals = this.scenario?.goals;
    if (goals?.served) {
      objectives.push({
        label: es ? `Atender ${goals.served} aeronaves` : `Handle ${goals.served} aircraft`,
        ok: this.stats.served >= goals.served,
      });
    }
    if (goals?.maxIncidents != null) {
      objectives.push({
        label: es ? `Como máximo ${goals.maxIncidents} incidencia(s)` : `At most ${goals.maxIncidents} incident(s)`,
        ok: this.incidents.length <= goals.maxIncidents,
      });
    }
    return {
      total,
      grade,
      objectives,
      parts: [
        { key: 'safety', label: es ? 'Seguridad' : 'Safety', points: safety, max: 40, notes: safetyNotes },
        { key: 'communication', label: es ? 'Comunicación' : 'Communication', points: comms, max: 30, notes: commsNotes },
        { key: 'traffic', label: es ? 'Tráfico' : 'Traffic', points: traffic, max: 30, notes: trafficNotes },
      ],
      incidents: this.incidents.slice(),
    };
  }

  responseCredit(t) {
    if (t <= 20) return 1;
    if (t <= 60) return 1 - ((t - 20) / 40) * 0.35;
    if (t <= 120) return 0.65 - ((t - 60) / 60) * 0.3;
    return 0.35;
  }

  // ------------------------------------------------------------ read helpers
  activeAircraft() {
    return this.aircraft.filter((a) => !['done', 'removed'].includes(a.phase));
  }

  pendingCalls() {
    return this.activeAircraft().filter((a) => a.call && !a.call.answered);
  }

  clock() {
    const total = Math.max(0, Math.min(this.duration, this.t));
    return `${pad2(Math.floor(total / 60))}:${pad2(Math.floor(total % 60))}`;
  }

  remaining() {
    return Math.max(0, this.duration - this.t);
  }
}

export { RUNWAY_PHASES, GROUND_PHASES };
