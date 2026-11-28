// OpenTower - approach (TRACON) mode: airborne sequencing, vectors and handoffs.
// Original implementation; shares only type/airport data with the tower mode.

import { AIRPORT, TYPES, AIRLINES, GA_TYPES, DIFFICULTIES, runwayGeometry } from './config.js';
import { findAddressee, normalize, spokenRunway } from './phraseology.js';
import { runwayForWind } from './weather.js';

const NM = 1852;
const KT = 0.514444;
const RAD = Math.PI / 180;
const FINAL_DIST = 9 * NM;
const APPROACH_TIMEOUT = 45; // seconds cleared without establishing
const GO_AROUND_SECONDS = 10; // climb-out before leaving the frequency
const RADAR_LIMIT = 24 * NM; // no arrival may orbit outside the scope forever

const REASONS_ES = {
  'go around is for arrivals': 'la frustrada es para las llegadas',
  'no approach to abandon': 'no hay aproximación que abandonar',
  'not established on the approach': 'no está establecido en la aproximación',
  'not in tower airspace yet': 'aún no está en el espacio aéreo de la torre',
  'not a departure': 'no es una salida',
  'not at the center handoff point yet': 'aún no está en el punto de transferencia a centro',
  'too close to the runway for a handoff': 'demasiado cerca de la pista para la transferencia',
  'approach clearance is for arrivals': 'la autorización de aproximación es para las llegadas',
  'already handed off': 'ya fue transferido',
  'not on the approach course': 'no está en el curso de aproximación',
  'not aligned with the final': 'no está alineado con la final',
  'not established on the localizer': 'no está establecido en el localizador',
  'altitude out of range': 'altitud fuera de rango',
  'speed out of range': 'velocidad fuera de rango',
  'nothing to repeat': 'nada que repetir',
  'unrecognized instruction': 'instrucción no reconocida',
};

const MISS_REASONS_ES = {
  'left the radar area': 'salió del área de radar',
  'not established on the approach': 'no se estableció en la aproximación',
  'localizer deviation': 'desviación del localizador',
  'not handed to tower': 'no fue transferido a torre',
  'no approach clearance': 'sin autorización de aproximación',
  'go around instruction': 'instrucción de frustrada',
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

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const pad2 = (n) => String(n).padStart(2, '0');
const pad3 = (n) => String(Math.round(n)).padStart(3, '0');
const norm360 = (d) => ((d % 360) + 360) % 360;
const angleDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

function turnToward(current, target, maxDelta) {
  const d = ((target - current + 540) % 360) - 180;
  if (Math.abs(d) <= maxDelta) return norm360(target);
  return norm360(current + Math.sign(d) * maxDelta);
}

function bearingTo(ac, x, y) {
  return norm360(Math.atan2(x - ac.x, y - ac.y) / RAD);
}

/**
 * Coherent final-approach geometry for the east-west runway.
 * landing: the heading flown at touchdown; course: the outbound final course
 * (opposite the landing heading, away from the threshold).
 */
export function approachGeometry(geo) {
  const landing = geo.heading ?? (geo.dir === -1 ? 270 : 90);
  return {
    landing,
    course: geo.courseHeading ?? (landing + 180) % 360,
    thresholdX: geo.thresholdX,
    ux: Math.sin(landing * RAD),
    uy: Math.cos(landing * RAD),
  };
}

/** Signed distance from the extended centreline and position along the final. */
export function localizerOffset(ac, geo) {
  const a = approachGeometry(geo);
  const dx = ac.x - a.thresholdX;
  const dy = ac.y;
  const along = -(dx * a.ux + dy * a.uy);
  const signedLateral = dx * a.uy - dy * a.ux;
  const lateral = Math.abs(signedLateral);
  const angle = Math.atan2(lateral, Math.max(1, along)) / RAD;
  return {
    ...a,
    along,
    lateral,
    signedLateral,
    angle,
    onLocalizer: along > 0 && lateral <= 1.5 * NM && angle <= 20,
  };
}

function compass(deg, lang = 'en') {
  if (lang === 'es') {
    const dirs = ['norte', 'noreste', 'este', 'sureste', 'sur', 'suroeste', 'oeste', 'noroeste'];
    return dirs[Math.round(norm360(deg) / 45) % 8];
  }
  const dirs = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
  return dirs[Math.round(norm360(deg) / 45) % 8];
}

/**
 * Deterministic approach (TRACON) simulation engine.
 *
 * Owns radar arrivals, vectors, descent, localizer/ILS capture, separation,
 * go-arounds and handoffs. Pure logic and Node-testable; it does not touch the
 * DOM. The canvas renderer lives in `tracon-renderer.js`.
 *
 * @param {object} [options]
 * @param {number} [options.duration=600] - Shift length in simulated seconds.
 * @param {string} [options.difficulty='calm'] - Difficulty id.
 * @param {number} [options.seed=1] - PRNG seed; same seed, same traffic.
 * @param {object|null} [options.weather] - Pre-fetched weather snapshot.
 * @param {object|null} [options.scenario] - Built-in scenario override.
 * @param {'en'|'es'} [options.lang='en'] - Radio language.
 */
export class TraconEngine {
  constructor({ duration = 600, difficulty = 'calm', seed = 1, weather = null, scenario = null, lang = 'en' } = {}) {
    this.mode = 'tracon';
    this.lang = lang === 'es' ? 'es' : 'en';
    this.scenario = scenario || null;
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
    this.stats = { served: 0, failed: 0, clearanceErrors: 0, responseTimes: [], departureWaits: [], unanswered: 0 };
    this.weather = weather;
    const windDir = weather?.windDir ?? (this.rand() < 0.5 ? 270 : 90);
    this.activeRunway = scenario?.runway ?? runwayForWind(windDir);
    this.geo = runwayGeometry(this.activeRunway);
    this.geo.runway = this.activeRunway;
    this.wind = { dir: windDir, speed: weather?.windSpeed ?? Math.floor(this.rand() * 12) };
    this.altimeter = weather?.altimeter ?? '29.92';
    this.visibility = weather?.visibilitySm ?? 10;
    this.atis = String.fromCharCode(65 + Math.floor(this.rand() * 26));
    this.lastHeavy = { t: -999, wake: 'L' };
    this.script = scenario?.script ? scenario.script.map((s) => ({ ...s, done: false })) : null;
    this.spawnTimer = this.script ? 1e9 : 8;
    this.appFreq = '124.2';
    const source = weather?.live ? ` · KPHX en vivo ${weather.raw}` : '';
    this.log(
      'SYS',
      this.lang === 'es'
        ? `Aproximación Copper en línea. ${this.appFreq}, pista ${this.activeRunway}, viento ${pad3(this.wind.dir)} a ${this.wind.speed}.${source}`
        : `Approach online. Copper Approach ${this.appFreq}, runway ${this.activeRunway}, wind ${pad3(this.wind.dir)} at ${this.wind.speed}.${source}`,
      'APP',
    );
  }

  log(from, text, freq = 'APP') {
    this.radio.push({ seq: ++this.radioSeq, t: this.t, from, text, freq });
    if (this.radio.length > 400) this.radio.splice(0, this.radio.length - 400);
  }

  incident(type, text, { force = false } = {}) {
    const last = this.incidentCooldown.get(type) ?? -999;
    if (!force && this.t - last < 20) return;
    this.incidentCooldown.set(type, this.t);
    this.incidents.push({ t: this.t, type, text });
    this.log('SYS', `${this.lang === 'es' ? 'ALERTA' : 'ALERT'}: ${text}`, 'APP');
  }

  /** Put one arrival into a bounded go-around state, exactly once. */
  missApproach(ac, reason) {
    if (!ac || ac.kind !== 'arrival') return false;
    if (['goAround', 'done', 'removed'].includes(ac.phase)) return false;
    ac.phase = 'goAround';
    ac.goAroundAt = this.t;
    ac.doneAt = this.t + GO_AROUND_SECONDS;
    ac.cleared = false;
    ac.onApproach = false;
    ac.handed = false;
    ac.assignedHdg = ac.hdg;
    ac.assignedAlt = Math.max(ac.alt, AIRPORT.elevation + 3000);
    ac.assignedSpeed = 180;
    this.stats.failed += 1;
    const reasonText = this.lang === 'es' ? (MISS_REASONS_ES[reason] || reason) : reason;
    this.incident(
      'deviation',
      this.lang === 'es'
        ? `${ac.callsign} frustró la aproximación: ${reasonText}`
        : `${ac.callsign} went around: ${reasonText}`,
      { force: true },
    );
    this.log('PILOT', this.lang === 'es' ? `Frustrada, ${ac.callsign}.` : `Going around, ${ac.callsign}.`, 'APP');
    return true;
  }

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

  makeFlight(opts = {}) {
    if (opts.callsign) {
      let callsign = opts.callsign;
      if (this.callsigns.has(callsign)) callsign = this.uniqueCallsign(() => `${opts.callsign}${1 + Math.floor(this.rand() * 9)}`);
      else this.callsigns.add(callsign);
      const airline = AIRLINES.find((a) => callsign.startsWith(a.code)) || null;
      const type = TYPES[opts.type] || (airline ? TYPES[airline.types[0]] : TYPES.C172);
      return { airline, type, callsign, spoken: callsign };
    }
    if (opts.type && TYPES[opts.type]) {
      const type = TYPES[opts.type];
      const airline = AIRLINES.find((a) => a.types.includes(opts.type)) || null;
      const callsign = airline
        ? this.uniqueCallsign(() => `${airline.code}${1 + Math.floor(this.rand() * 899)}`)
        : this.uniqueCallsign(() => `N${1 + Math.floor(this.rand() * 899)}`);
      return { airline, type, callsign, spoken: airline ? `${airline.name.toUpperCase()} ${callsign.slice(airline.code.length)}` : callsign };
    }
    if (this.rand() < 0.65) {
      const airline = AIRLINES[Math.floor(this.rand() * AIRLINES.length)];
      const type = TYPES[airline.types[Math.floor(this.rand() * airline.types.length)]];
      const callsign = this.uniqueCallsign(() => `${airline.code}${1 + Math.floor(this.rand() * 899)}`);
      return { airline, type, callsign, spoken: `${airline.name.toUpperCase()} ${callsign.slice(airline.code.length)}` };
    }
    const type = TYPES[GA_TYPES[Math.floor(this.rand() * GA_TYPES.length)]];
    const callsign = this.uniqueCallsign(() => `N${1 + Math.floor(this.rand() * 899)}${this.rand() < 0.5 ? String.fromCharCode(65 + Math.floor(this.rand() * 26), 65 + Math.floor(this.rand() * 26)) : ''}`);
    return { airline: null, type, callsign, spoken: callsign };
  }

  spawn(kind, opts = {}) {
    if (this.finished) return null;
    if (this.aircraft.filter((a) => !['done', 'removed', 'goAround'].includes(a.phase)).length >= this.difficulty.maxTraffic + 2) return null;
    const flight = this.makeFlight(opts);
    const { airline, type, callsign } = flight;

    if (kind === 'departure') {
      const hdg = this.geo.heading;
      const ac = {
        id: this.nextId++,
        callsign,
        spoken: flight.spoken,
        type,
        airline,
        wake: type.wake,
        kind: 'departure',
        x: this.geo.thresholdX,
        y: 0,
        alt: AIRPORT.elevation + 1800,
        hdg,
        speed: 180,
        assignedHdg: hdg,
        assignedAlt: AIRPORT.elevation + 5000,
        assignedSpeed: null,
        phase: 'departed',
        cleared: false,
        onApproach: false,
        handed: false,
        centerRequested: false,
        call: null,
        spawnedAt: this.t,
        doneAt: null,
      };
      this.aircraft.push(ac);
      this.call(
        ac,
        this.lang === 'es'
          ? `Salida, ${callsign}, ascendiendo ${Math.round(ac.alt)} para ${Math.round(ac.assignedAlt)}, rumbo ${pad3(hdg)}.`
          : `Departure, ${callsign}, climbing ${Math.round(ac.alt)} for ${Math.round(ac.assignedAlt)}, heading ${pad3(hdg)}.`,
        'checkin',
        'APP',
      );
      return ac;
    }

    const radial = Math.floor(this.rand() * 360);
    const distance = (12 + this.rand() * 4) * NM;
    const x = Math.sin(radial * RAD) * distance;
    const y = Math.cos(radial * RAD) * distance;
    const hdg = bearingTo({ x, y }, this.geo.thresholdX, 0);
    const cruiseKt = Math.round(type.cruise / KT);
    const alt = AIRPORT.elevation + 6000 + Math.floor(this.rand() * 4) * 1000;
    const ac = {
      id: this.nextId++,
      callsign,
      spoken: flight.spoken,
      type,
      airline,
      wake: type.wake,
      kind: 'arrival',
      x,
      y,
      alt,
      hdg,
      speed: cruiseKt,
      assignedHdg: null,
      assignedAlt: null,
      assignedSpeed: cruiseKt,
      phase: 'cruise',
      cleared: false,
      onApproach: false,
      handed: false,
      call: null,
      spawnedAt: this.t,
      doneAt: null,
      inboundNm: Math.round((distance / NM) * 10) / 10,
    };
    this.aircraft.push(ac);
    this.call(
      ac,
      this.lang === 'es'
        ? `Aproximación, ${callsign}, ${ac.inboundNm} millas al ${compass(radial, this.lang)}, ${Math.round(alt)}, entrando.`
        : `Approach, ${callsign}, ${ac.inboundNm} miles ${compass(radial, this.lang)}, ${Math.round(alt)}, inbound.`,
      'checkin',
      'APP',
    );
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
        const arrivals = this.aircraft.filter((a) => !['done', 'removed', 'goAround'].includes(a.phase) && a.kind === 'arrival').length;
        const departures = this.aircraft.filter((a) => !['done', 'removed', 'goAround'].includes(a.phase) && a.kind === 'departure').length;
        this.spawn(departures + 1 < arrivals * 0.5 ? 'departure' : 'arrival');
        this.spawnTimer = (this.difficulty.interval / this.difficulty.density) * (0.8 + this.rand() * 0.4);
      }
    }

    for (const ac of this.aircraft) this.updateAircraft(ac, step);
    this.detectConflicts();
    this.updateCalls();

    for (const ac of this.aircraft) {
      if (ac.phase === 'goAround' && ac.doneAt !== null && this.t >= ac.doneAt) {
        ac.phase = 'done';
        ac.doneAt = this.t;
      } else if (ac.phase === 'done' && ac.doneAt !== null && this.t - ac.doneAt > 4) {
        ac.phase = 'removed';
      }
    }
    if (this.t >= this.duration) this.finish();
  }

  updateAircraft(ac, dt) {
    if (ac.phase === 'done' || ac.phase === 'removed') return;
    if (ac.phase === 'goAround') {
      this.updateGoAround(ac, dt);
      return;
    }

    const speedMs = ac.speed * KT;
    const fromField = Math.hypot(ac.x, ac.y);
    if (fromField > RADAR_LIMIT) {
      if (ac.kind === 'arrival') {
        this.missApproach(ac, 'left the radar area');
      } else {
        ac.phase = 'done';
        ac.doneAt = this.t;
        this.stats.failed += 1;
        this.incident(
          'deviation',
          this.lang === 'es'
            ? `${ac.callsign} salió del área de radar sin transferencia`
            : `${ac.callsign} left the radar area without a handoff`,
        );
      }
      return;
    }

    if (ac.kind === 'arrival') {
      const dThreshold = Math.hypot(ac.x - this.geo.thresholdX, ac.y);
      const finalHdg = this.geo.heading;
      const loc = localizerOffset(ac, this.geo);
      const clearedFor = ac.clearedAt != null ? this.t - ac.clearedAt : Infinity;

      if (ac.cleared) {
        if (!ac.onApproach) {
          if (clearedFor > APPROACH_TIMEOUT || dThreshold < 4 * NM) {
            this.missApproach(ac, 'not established on the approach');
            return;
          }
          if (dThreshold < FINAL_DIST && loc.onLocalizer) {
            ac.onApproach = true;
            ac.phase = 'approach';
            this.log(
              'SYS',
              this.lang === 'es'
                ? `${ac.callsign} establecido en la final ${spokenRunway(this.activeRunway, this.lang)}.`
                : `${ac.callsign} established on the ${spokenRunway(this.activeRunway)} final.`,
              'APP',
            );
          }
        }
        if (ac.onApproach) {
          const locNow = localizerOffset(ac, this.geo);
          if (locNow.along < -0.5 * NM || locNow.lateral > 2.5 * NM) {
            this.missApproach(ac, 'localizer deviation');
            return;
          }
          const glideAlt = AIRPORT.elevation + Math.max(400, dThreshold * 0.0524 * 3.28084);
          ac.assignedAlt = Math.round(glideAlt / 100) * 100;
          ac.assignedHdg = locNow.lateral > 150
            ? bearingTo(ac, this.geo.thresholdX, 0)
            : finalHdg;
          ac.assignedSpeed = dThreshold < 4 * NM ? 160 : 180;
          if (dThreshold < 3 * NM) ac.phase = 'final';
          if (dThreshold < 1.5 * NM && !ac.handed) {
            this.missApproach(ac, 'not handed to tower');
            return;
          }
        }
      } else if (dThreshold < 4 * NM) {
        this.missApproach(ac, 'no approach clearance');
        return;
      }
    } else {
      // Departure: climb out and wait for the controller to hand it to center.
      const d = Math.hypot(ac.x, ac.y);
      if (d > 15 * NM && !ac.centerRequested) {
        ac.centerRequested = true;
        this.log(
          'SYS',
          this.lang === 'es'
            ? `${ac.callsign} listo para centro.`
            : `${ac.callsign} is ready for center.`,
          'APP',
        );
      }
    }

    if (ac.assignedHdg != null) ac.hdg = turnToward(ac.hdg, ac.assignedHdg, 3.2 * dt);
    if (ac.assignedAlt != null) {
      const rate = (ac.assignedAlt < ac.alt ? 2200 : 1800) / 60;
      ac.alt += clamp(ac.assignedAlt - ac.alt, -rate * dt, rate * dt);
    }
    if (ac.assignedSpeed != null) {
      ac.speed += clamp(ac.assignedSpeed - ac.speed, -2 * dt, 2 * dt);
    }

    const h = ac.hdg * RAD;
    ac.x += Math.sin(h) * speedMs * dt;
    ac.y += Math.cos(h) * speedMs * dt;
  }

  updateGoAround(ac, dt) {
    if (ac.assignedHdg != null) ac.hdg = turnToward(ac.hdg, ac.assignedHdg, 3.2 * dt);
    if (ac.assignedAlt != null) {
      const rate = (ac.assignedAlt < ac.alt ? 2200 : 1800) / 60;
      ac.alt += clamp(ac.assignedAlt - ac.alt, -rate * dt, rate * dt);
    }
    if (ac.assignedSpeed != null) {
      ac.speed += clamp(ac.assignedSpeed - ac.speed, -2 * dt, 2 * dt);
    }
    const h = ac.hdg * RAD;
    ac.x += Math.sin(h) * ac.speed * KT * dt;
    ac.y += Math.cos(h) * ac.speed * KT * dt;
    if (ac.doneAt != null && this.t >= ac.doneAt) {
      ac.phase = 'done';
      ac.doneAt = this.t;
    }
  }

  detectConflicts() {
    const active = this.aircraft.filter((a) => !['done', 'removed', 'goAround'].includes(a.phase));
    for (const ac of this.aircraft) ac.conflict = false;
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i];
        const b = active[j];
        const dNm = Math.hypot(a.x - b.x, a.y - b.y) / NM;
        const dv = Math.abs(a.alt - b.alt);
        if (dNm < 3 && dv < 1000) {
          a.conflict = true;
          b.conflict = true;
          this.incident(
            'air',
            this.lang === 'es'
              ? `pérdida de separación: ${a.callsign} y ${b.callsign} (${dNm.toFixed(1)} NM, ${Math.round(dv)} ft)`
              : `separation loss: ${a.callsign} and ${b.callsign} (${dNm.toFixed(1)} NM, ${Math.round(dv)} ft)`,
          );
        }
      }
    }
  }

  updateCalls() {
    for (const ac of this.aircraft) {
      if (['goAround', 'done', 'removed'].includes(ac.phase)) continue;
      if (ac.call && !ac.call.answered && this.t - ac.call.at > 60 && !ac.call.unansweredCounted) {
        ac.call.unansweredCounted = true;
        this.stats.unanswered = (this.stats.unanswered || 0) + 1;
      }
    }
  }

  command(text) {
    const raw = String(text || '').trim();
    if (!raw || this.finished) return { ok: false };
    const active = this.aircraft.filter((a) => !['done', 'removed'].includes(a.phase));
    const found = findAddressee(raw, active);
    if (!found.aircraft) {
      this.log('ATC', raw, 'APP');
      this.log(
        'SYS',
        this.lang === 'es' ? 'Ninguna aeronave coincide con ese indicativo.' : 'No aircraft matches that callsign.',
        'APP',
      );
      return { ok: false, error: 'unknown callsign' };
    }
    if (found.ambiguous) {
      this.log('ATC', raw, 'APP');
      this.log(
        'SYS',
        this.lang === 'es'
          ? 'Varias aeronaves coinciden; use el indicativo completo.'
          : 'Several aircraft match; use the full callsign.',
        'APP',
      );
      return { ok: false, error: 'ambiguous' };
    }
    const ac = found.aircraft;
    this.answer(ac);
    const t = normalize(raw);
    const result = this.apply(ac, t);
    if (result.atc) this.log('ATC', result.atc, 'APP');
    if (result.pilot) this.log('PILOT', result.pilot, 'APP');
    if (result.system) this.log('SYS', result.system, 'APP');
    return result;
  }

  apply(ac, t) {
    const es = this.lang === 'es';
    const runway = spokenRunway(this.activeRunway, this.lang);

    if (/(^| )(GO AROUND|MISSED APPROACH|FRUSTRADA|FRUSTRADO|MOTOR Y AL AIRE|DESESTIMADA|DESESTIMADO|IDA AL AIRE)( |$)/.test(t)) {
      if (ac.kind !== 'arrival') return this.unable(ac, 'go around is for arrivals');
      const started = this.missApproach(ac, 'go around instruction');
      if (!started) return this.unable(ac, 'no approach to abandon');
      return {
        ok: true,
        atc: es ? `${ac.callsign}, frustrada.` : `${ac.callsign}, going around.`,
        aircraft: ac,
      };
    }

    if (/(^| )(CONTACT TOWER|CONTACTE (CON )?(LA )?TORRE|CAMBIO (A|CON) (LA )?TORRE|CONTACTAR (LA )?TORRE|LLAME A (LA )?TORRE|CAMBIE A (LA )?TORRE|PASE A (LA )?TORRE)( |$)/.test(t)) {
      if (ac.kind !== 'arrival' || !ac.onApproach) return this.unable(ac, 'not established on the approach');
      const d = Math.hypot(ac.x - this.geo.thresholdX, ac.y);
      if (d < 1.5 * NM) return this.unable(ac, 'too close to the runway for a handoff');
      if (d > 6 * NM) return this.unable(ac, 'not in tower airspace yet');
      ac.handed = true;
      ac.phase = 'done';
      ac.doneAt = this.t;
      this.stats.served += 1;
      return this.ok(
        ac,
        es ? `${ac.callsign}, contacte torre ${AIRPORT.tower}.` : `${ac.callsign}, contact tower ${AIRPORT.tower}.`,
        es ? `Cambio a torre, ${ac.callsign}.` : `Over to tower, ${ac.callsign}.`,
      );
    }

    if (/(^| )(CONTACT (CENTER|DEPARTURE)|CONTACTE (CON )?(EL )?(CENTRO|SALIDAS)|CAMBIO (A|CON) (EL )?(CENTRO|SALIDAS)|CONTACTAR (EL )?(CENTRO|SALIDAS)|LLAME A (EL )?(CENTRO|SALIDAS)|CAMBIE A (EL )?(CENTRO|SALIDAS)|PASE A (EL )?(CENTRO|SALIDAS))( |$)/.test(t)) {
      if (ac.kind !== 'departure') return this.unable(ac, 'not a departure');
      const d = Math.hypot(ac.x, ac.y);
      if (d < 15 * NM) return this.unable(ac, 'not at the center handoff point yet');
      ac.phase = 'done';
      ac.doneAt = this.t;
      this.stats.served += 1;
      return this.ok(
        ac,
        es ? `${ac.callsign}, contacte centro.` : `${ac.callsign}, contact center.`,
        es ? `Cambio a centro, ${ac.callsign}.` : `Over to center, ${ac.callsign}.`,
      );
    }

    if (/(^| )(CLEARED (ILS|APPROACH|VISUAL)|AUTORIZADO (PARA |A )?(EL |LA )?(ILS|APROXIMACION|VISUAL))( |$)/.test(t)) {
      if (ac.kind !== 'arrival') return this.clearanceError(ac, 'approach clearance is for arrivals');
      if (ac.handed) return this.unable(ac, 'already handed off');
      const loc = localizerOffset(ac, this.geo);
      if (loc.along <= 0 || loc.along > 12 * NM) return this.unable(ac, 'not on the approach course');
      if (angleDiff(ac.hdg, loc.landing) > 45) return this.unable(ac, 'not aligned with the final');
      if (!loc.onLocalizer) return this.unable(ac, 'not established on the localizer');
      ac.cleared = true;
      ac.clearedAt = this.t;
      ac.assignedAlt = Math.min(ac.alt, AIRPORT.elevation + 3000);
      return this.ok(
        ac,
        es ? `${ac.callsign}, autorizado ILS pista ${runway}.` : `${ac.callsign}, cleared ILS runway ${runway}.`,
        es ? `Autorizado ILS pista ${runway}, ${ac.callsign}.` : `Cleared ILS runway ${runway}, ${ac.callsign}.`,
      );
    }

    const hdg = t.match(/(?:HEADING|RUMBO) (\d{3})/);
    if (hdg) {
      const value = Number(hdg[1]) % 360;
      ac.assignedHdg = value;
      return this.ok(
        ac,
        es ? `${ac.callsign}, rumbo ${pad3(value)}.` : `${ac.callsign}, heading ${pad3(value)}.`,
        es ? `Rumbo ${pad3(value)}, ${ac.callsign}.` : `Heading ${pad3(value)}, ${ac.callsign}.`,
      );
    }
    const turn = t.match(/(?:TURN (LEFT|RIGHT))|(?:(?:VIR(?:E|AR)|GIR(?:E|AR)) (?:A LA |A )?(IZQUIERDA|DERECHA))/);
    if (turn) {
      const dir = turn[1] || turn[2];
      const left = dir === 'LEFT' || dir === 'IZQUIERDA';
      const delta = left ? -30 : 30;
      ac.assignedHdg = norm360(Math.round(ac.hdg / 10) * 10 + delta);
      return this.ok(
        ac,
        es
          ? `${ac.callsign}, vire a la ${left ? 'izquierda' : 'derecha'} rumbo ${pad3(ac.assignedHdg)}.`
          : `${ac.callsign}, turn ${left ? 'left' : 'right'} heading ${pad3(ac.assignedHdg)}.`,
        es
          ? `Virando a la ${left ? 'izquierda' : 'derecha'} rumbo ${pad3(ac.assignedHdg)}, ${ac.callsign}.`
          : `Turn ${left ? 'left' : 'right'} heading ${pad3(ac.assignedHdg)}, ${ac.callsign}.`,
      );
    }

    const alt = t.match(/(?:MAINTAIN|DESCEND(?: AND MAINTAIN)?|CLIMB(?: AND MAINTAIN)?|MANTENGA|MANTENER|DESCIENDA(?: Y MANTENGA)?(?: A)?|DESCENDER(?: Y MANTENER)?(?: A)?|BAJE(?: Y MANTENGA)?(?: A)?|SUBA(?: Y MANTENGA)?(?: A)?|ASCIENDA(?: Y MANTENGA)?(?: A)?|ASCENDER(?: Y MANTENER)?(?: A)?) (\d{3,5})/);
    if (alt) {
      const value = Number(alt[1]);
      if (value < 1000 || value > 12000) return this.unable(ac, 'altitude out of range');
      ac.assignedAlt = value;
      const down = value < ac.alt;
      return this.ok(
        ac,
        es
          ? `${ac.callsign}, ${down ? 'descienda y mantenga' : 'ascienda y mantenga'} ${value}.`
          : `${ac.callsign}, ${down ? 'descend and maintain' : 'climb and maintain'} ${value}.`,
        es
          ? `${down ? 'Desciendo' : 'Asciendo'} y mantengo ${value}, ${ac.callsign}.`
          : `${down ? 'Descend' : 'Climb'} and maintain ${value}, ${ac.callsign}.`,
      );
    }

    const speed = t.match(/(?:SPEED|VELOCIDAD) (\d{2,3})/);
    if (speed) {
      const value = Number(speed[1]);
      if (value < 120 || value > 300) return this.unable(ac, 'speed out of range');
      ac.assignedSpeed = value;
      return this.ok(
        ac,
        es ? `${ac.callsign}, velocidad ${value}.` : `${ac.callsign}, speed ${value}.`,
        es ? `Velocidad ${value}, ${ac.callsign}.` : `Speed ${value}, ${ac.callsign}.`,
      );
    }

    if (/(^| )(SAY AGAIN|REPITA|REPITE|OTRA VEZ|DIGA OTRA VEZ)( |$)/.test(t)) {
      if (ac.call) {
        return this.ok(
          ac,
          es ? `${ac.callsign}, repito.` : `${ac.callsign}, I say again.`,
          ac.call.text,
        );
      }
      return this.unable(ac, 'nothing to repeat');
    }
    if (/(^| )(STANDBY|ESPERE|ESPERA|AGUARDE|MANTENGASE)( |$)/.test(t)) {
      return { ok: true, system: `${ac.callsign}, ${es ? 'espere' : 'standby'}.` };
    }
    if (/(^| )(ROGER|AFFIRM|ACKNOWLEDGE|RECIBIDO|COPIO|ENTENDIDO|AFIRMATIVO|CORRECTO)( |$)/.test(t)) {
      return this.ok(
        ac,
        `${ac.callsign}, ${es ? 'recibido' : 'roger'}.`,
        `${ac.callsign}.`,
      );
    }
    return this.unable(ac, 'unrecognized instruction');
  }

  ok(ac, atc, pilot) {
    return { ok: true, atc, pilot, aircraft: ac };
  }

  reason(why) {
    if (this.lang !== 'es') return why;
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

  finish() {
    if (this.finished) return;
    this.finished = true;
    this.score = this.computeScore();
    this.log(
      'SYS',
      this.lang === 'es'
        ? `Turno completo. Calificación ${this.score.grade} (${this.score.total}/100).`
        : `Shift complete. Grade ${this.score.grade} (${this.score.total}/100).`,
      'APP',
    );
  }

  computeScore() {
    const es = this.lang === 'es';
    const active = this.aircraft.filter((a) => !['done', 'removed'].includes(a.phase));
    const conflicts = this.incidents.filter((i) => i.type === 'air').length;
    const deviations = this.incidents.filter((i) => i.type === 'deviation').length;
    const safety = Math.max(0, 40 - conflicts * 8 - deviations * 4);
    const times = this.stats.responseTimes;
    const credit = times.length ? times.reduce((sum, t) => sum + this.responseCredit(t), 0) / times.length : 0;
    const unanswered = this.stats.unanswered || 0;
    const comms = Math.max(0, Math.round(30 * credit) - this.stats.clearanceErrors * 2 - unanswered * 2);
    const waiting = active.filter((a) => ['cruise', 'approach', 'final', 'departed'].includes(a.phase)).length;
    const denom = this.stats.served + this.stats.failed + waiting * 0.5;
    const handledTotal = this.stats.served + this.stats.failed + waiting;
    const traffic = denom ? Math.round(30 * (this.stats.served / denom)) : 30;
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
    const safetyNotes = [
      conflicts ? (es ? `${conflicts} conflicto(s)` : `${conflicts} conflict(s)`) : (es ? 'Sin pérdidas de separación.' : 'No separation losses.'),
      deviations ? (es ? `${deviations} frustrada(s)` : `${deviations} go-around(s)`) : '',
    ].filter(Boolean);
    const commsNotes = [
      times.length
        ? (es
          ? `${times.filter((x) => x <= 20).length} de ${times.length} llamadas respondidas en 20 s.`
          : `${times.filter((x) => x <= 20).length} of ${times.length} calls answered within 20 s.`)
        : (es ? 'No se respondió ninguna llamada.' : 'No pilot calls.'),
      unanswered ? (es ? `${unanswered} llamada(s) sin responder.` : `${unanswered} call(s) left unanswered.`) : '',
      this.stats.clearanceErrors ? (es ? `${this.stats.clearanceErrors} error(es) de autorización.` : `${this.stats.clearanceErrors} clearance error(s).`) : '',
    ].filter(Boolean);
    const trafficNotes = [
      handledTotal
        ? (es
          ? `${this.stats.served} de ${handledTotal} aeronaves atendidas.`
          : `${this.stats.served} of ${handledTotal} aircraft handled.`)
        : (es ? 'Sin tráfico.' : 'No traffic.'),
      waiting ? (es ? `${waiting} aún en frecuencia.` : `${waiting} still on frequency.`) : '',
    ].filter(Boolean);
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

  activeAircraft() {
    return this.aircraft.filter((a) => !['done', 'removed', 'goAround'].includes(a.phase));
  }

  /** Aircraft that should remain visible on the radar, including go-arounds. */
  scopeAircraft() {
    return this.aircraft.filter((a) => !['done', 'removed'].includes(a.phase));
  }

  pendingCalls() {
    return this.activeAircraft().filter((a) => a.call && !a.call.answered);
  }

  runwayOccupied() {
    return false;
  }

  clock() {
    const total = Math.max(0, Math.min(this.duration, this.t));
    return `${pad2(Math.floor(total / 60))}:${pad2(Math.floor(total % 60))}`;
  }

  remaining() {
    return Math.max(0, this.duration - this.t);
  }
}
