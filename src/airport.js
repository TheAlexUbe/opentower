// OpenTower - airport geometry and taxi routes.
import { AIRPORT, runwayGeometry } from './config.js';

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Look up an airport gate by id.
 *
 * @param {string} id - Gate id, for example `N1`.
 * @returns {object} The matching gate, or the first gate as a fallback.
 */
export function gateById(id) {
  return AIRPORT.gates.find((g) => g.id === id) || AIRPORT.gates[0];
}

/**
 * Find the first gate not occupied by a parked departure or an arrival.
 *
 * @param {Array<object>} aircraft - All aircraft in the current shift.
 * @param {Array<object>} [gates] - Candidate gates.
 * @returns {object|null} A free gate, or null when every gate is occupied.
 */
export function freeGate(aircraft, gates = AIRPORT.gates) {
  const used = new Set(
    aircraft
      .filter((a) => a.gate && a.phase !== 'done' && a.phase !== 'removed')
      .filter((a) => (a.kind === 'departure'
        ? a.phase === 'parked'
        : ['final', 'rollout', 'ground', 'taxiRamp'].includes(a.phase)))
      .map((a) => a.gate.id),
  );
  return gates.find((g) => !used.has(g.id)) || null;
}

/** Gate -> departure lane -> holding point. North gates cross runway 12. */
export function routeGateToHold(gate, geo) {
  if (gate.y < -100) {
    const c = AIRPORT.crossing;
    return [
      { x: gate.x, y: gate.y },
      { x: c.x, y: gate.y },
      { x: c.x, y: c.northHoldY, cross: true },
      { x: c.x - 40, y: c.northHoldY },
      { x: c.x - 40, y: AIRPORT.alphaDepY },
      { x: geo.holdX, y: AIRPORT.alphaDepY },
      { x: geo.holdX, y: AIRPORT.alphaY },
    ];
  }
  return [
    { x: gate.x, y: gate.y },
    { x: gate.x, y: AIRPORT.alphaDepY },
    { x: geo.holdX, y: AIRPORT.alphaDepY },
    { x: geo.holdX, y: AIRPORT.alphaY },
  ];
}

/** Holding point -> runway centreline, for line-up. */
export function routeHoldToLineup(geo) {
  return [{ x: geo.lineupX, y: 0 }];
}

/** Runway exit -> arrival lane -> gate. North gates cross runway 12. */
export function routeExitToGate(exitX, gate) {
  if (gate.y < -100) {
    const c = AIRPORT.crossing;
    return [
      { x: exitX, y: AIRPORT.alphaArrY },
      { x: c.x, y: AIRPORT.alphaArrY },
      { x: c.x, y: c.southHoldY, cross: true },
      { x: c.x + 40, y: c.southHoldY },
      { x: c.x + 40, y: gate.y },
      { x: gate.x, y: gate.y },
    ];
  }
  return [
    { x: exitX, y: AIRPORT.alphaArrY },
    { x: gate.x, y: AIRPORT.alphaArrY },
    { x: gate.x, y: gate.y },
  ];
}

export const FINAL_INSET_RANGE_M = 4 * 1852;

/** Distance from an arrival to its touchdown point (metres). */
export function finalApproachDistance(ac, geo) {
  return Math.abs(ac.x - geo.touchdownX);
}

/** True when an arrival should appear in the final-approach inset. */
export function inFinalInset(ac, geo) {
  return ac.phase === 'final' && finalApproachDistance(ac, geo) <= FINAL_INSET_RANGE_M;
}

/**
 * Runway geometry for the active runway designator.
 *
 * @param {'09'|'27'} runway - Active runway.
 * @returns {object} Threshold, length and surface geometry.
 */
export function geoFor(runway) {
  return runwayGeometry(runway);
}

/** True when a point is physically on the runway pavement. */
export function onRunwaySurface(x, y, geo) {
  return Math.abs(y) <= AIRPORT.runway.width / 2 + 2 && x >= -AIRPORT.runway.length / 2 && x <= AIRPORT.runway.length / 2;
}
