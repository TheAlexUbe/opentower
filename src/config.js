// OpenTower - aircraft performance and airport data.
// Original data for a fictional airport. Performance figures are typical,
// public-domain-style round numbers for each class, not taken from any product.

export const KT = 0.514444;
const kt = (v) => v * KT;

/**
 * Aircraft performance.
 * taxi/rotate/climb/final/cruise in m/s (converted from knots),
 * climbFpm in feet per minute, accel/decel in m/s^2, lengthFt for spacing.
 * wake: L (light), M (medium), H (heavy), J (super).
 */
export const TYPES = {
  C172: { code: 'C172', name: 'Cessna 172', category: 'piston', wake: 'L', taxi: kt(14), rotate: kt(55), climb: kt(75), final: kt(65), cruise: kt(110), climbFpm: 700, descentFpm: 600, accel: 3.0, decel: 4.0, lengthFt: 27 },
  C182: { code: 'C182', name: 'Cessna 182', category: 'piston', wake: 'L', taxi: kt(14), rotate: kt(60), climb: kt(85), final: kt(70), cruise: kt(135), climbFpm: 900, descentFpm: 700, accel: 3.0, decel: 4.0, lengthFt: 29 },
  SR22: { code: 'SR22', name: 'Cirrus SR22', category: 'piston', wake: 'L', taxi: kt(15), rotate: kt(70), climb: kt(105), final: kt(80), cruise: kt(170), climbFpm: 1100, descentFpm: 800, accel: 4.0, decel: 4.0, lengthFt: 26 },
  PA28: { code: 'PA28', name: 'Piper Archer', category: 'piston', wake: 'L', taxi: kt(14), rotate: kt(60), climb: kt(80), final: kt(70), cruise: kt(125), climbFpm: 800, descentFpm: 650, accel: 3.0, decel: 4.0, lengthFt: 24 },
  PA34: { code: 'PA34', name: 'Piper Seneca', category: 'piston', wake: 'L', taxi: kt(14), rotate: kt(70), climb: kt(95), final: kt(85), cruise: kt(180), climbFpm: 1200, descentFpm: 800, accel: 3.0, decel: 4.0, lengthFt: 29 },
  BE20: { code: 'BE20', name: 'King Air 200', category: 'turboprop', wake: 'L', taxi: kt(15), rotate: kt(95), climb: kt(130), final: kt(100), cruise: kt(250), climbFpm: 1800, descentFpm: 1200, accel: 4.0, decel: 4.0, lengthFt: 43 },
  PC12: { code: 'PC12', name: 'Pilatus PC-12', category: 'turboprop', wake: 'L', taxi: kt(15), rotate: kt(85), climb: kt(120), final: kt(95), cruise: kt(270), climbFpm: 1500, descentFpm: 1100, accel: 4.0, decel: 4.0, lengthFt: 47 },
  C25A: { code: 'C25A', name: 'Citation CJ2', category: 'jet', wake: 'L', taxi: kt(16), rotate: kt(105), climb: kt(160), final: kt(115), cruise: kt(380), climbFpm: 3000, descentFpm: 1500, accel: 4.5, decel: 3.5, lengthFt: 47 },
  E75L: { code: 'E75L', name: 'Embraer 175', category: 'jet', wake: 'M', taxi: kt(16), rotate: kt(135), climb: kt(180), final: kt(130), cruise: kt(430), climbFpm: 2800, descentFpm: 1500, accel: 4.5, decel: 3.5, lengthFt: 104 },
  CRJ9: { code: 'CRJ9', name: 'CRJ-900', category: 'jet', wake: 'M', taxi: kt(16), rotate: kt(140), climb: kt(185), final: kt(135), cruise: kt(440), climbFpm: 2800, descentFpm: 1500, accel: 4.5, decel: 3.5, lengthFt: 119 },
  B738: { code: 'B738', name: 'Boeing 737-800', category: 'jet', wake: 'M', taxi: kt(16), rotate: kt(148), climb: kt(190), final: kt(140), cruise: kt(450), climbFpm: 2500, descentFpm: 1500, accel: 4.5, decel: 3.5, lengthFt: 129 },
  A320: { code: 'A320', name: 'Airbus A320', category: 'jet', wake: 'M', taxi: kt(16), rotate: kt(145), climb: kt(185), final: kt(138), cruise: kt(450), climbFpm: 2500, descentFpm: 1500, accel: 4.5, decel: 3.5, lengthFt: 123 },
  B77W: { code: 'B77W', name: 'Boeing 777-300ER', category: 'jet', wake: 'H', taxi: kt(17), rotate: kt(165), climb: kt(200), final: kt(150), cruise: kt(480), climbFpm: 2200, descentFpm: 1500, accel: 4.0, decel: 3.5, lengthFt: 242 },
  A388: { code: 'A388', name: 'Airbus A380', category: 'jet', wake: 'J', taxi: kt(17), rotate: kt(170), climb: kt(205), final: kt(152), cruise: kt(480), climbFpm: 2000, descentFpm: 1500, accel: 3.8, decel: 3.5, lengthFt: 239 },
};

export const AIRLINES = [
  { code: 'SWA', name: 'Southwest', types: ['B738'] },
  { code: 'DAL', name: 'Delta', types: ['A320', 'B738'] },
  { code: 'AAL', name: 'American', types: ['B738', 'A320'] },
  { code: 'UAL', name: 'United', types: ['B738', 'A320'] },
  { code: 'ASA', name: 'Alaska', types: ['B738'] },
  { code: 'JBU', name: 'JetBlue', types: ['A320'] },
  { code: 'SKW', name: 'SkyWest', types: ['E75L', 'CRJ9'] },
  { code: 'FDX', name: 'FedEx', types: ['B77W'] },
];

export const GA_TYPES = ['C172', 'C182', 'SR22', 'PA28', 'PA34', 'BE20', 'PC12'];

export const AIRPORT = {
  code: 'KXCM',
  name: 'Copper Mesa',
  elevation: 1450,
  tower: '118.3',
  ground: '121.7',
  atis: '124.9',
  // Fictional single-runway field, runway 09/27, 1,700 m, laid out east-west.
  runway: { low: '09', high: '27', length: 1700, width: 30 },
  secondaryRunway: {
    id: '12/30',
    from: { x: -950, y: -480 },
    to: { x: -400, y: -180 },
    width: 24,
  },
  northRamp: { x1: -790, y1: -770, x2: -410, y2: -580 },
  crossing: { x: -600, id: '12', southHoldY: -250, northHoldY: -320, centerY: -289 },
  alphaY: 110,
  alphaDepY: 96,
  alphaArrY: 124,
  // Connectors between the runway and taxiway Alpha.
  connectors: [
    { id: 'A1', x: -700 },
    { id: 'A2', x: -450 },
    { id: 'A3', x: -200 },
    { id: 'A4', x: 50 },
    { id: 'A5', x: 300 },
    { id: 'A6', x: 550 },
    { id: 'A7', x: 750 },
  ],
  gates: [
    { id: 'W1', x: -660, y: 250 },
    { id: 'W2', x: -520, y: 250 },
    { id: 'G1', x: -240, y: 265 },
    { id: 'G2', x: -80, y: 265 },
    { id: 'G3', x: 80, y: 265 },
    { id: 'G4', x: 240, y: 265 },
    { id: 'F1', x: 520, y: 250 },
    { id: 'F2', x: 660, y: 250 },
    { id: 'N1', x: -720, y: -660 },
    { id: 'N2', x: -480, y: -660 },
  ],
};

/**
 * Geometry for the active runway. The runway is physically east-west:
 * 09 runs toward +x (heading 090), 27 toward -x (heading 270).
 */
export function runwayGeometry(runway) {
  const is27 = String(runway) === '27';
  const dir = is27 ? -1 : 1;
  const thresholdX = -dir * 850;
  const holdX = is27 ? 750 : -700;
  const holdId = is27 ? 'A7' : 'A1';
  const lineupX = -dir * 780;
  const touchdownX = thresholdX + dir * 150;
  const exitX = is27 ? 300 : -200;
  const exitId = is27 ? 'A5' : 'A3';
  const heading = dir === 1 ? 90 : 270;
  const courseHeading = (heading + 180) % 360;
  return { runway: is27 ? '27' : '09', dir, thresholdX, holdX, holdId, lineupX, touchdownX, exitX, exitId, heading, courseHeading };
}

export const DIFFICULTIES = {
  calm: { id: 'calm', label: 'Calm', interval: 62, maxTraffic: 4, density: 0.75 },
  busy: { id: 'busy', label: 'Busy', interval: 42, maxTraffic: 6, density: 1.25 },
  rush: { id: 'rush', label: 'Rush', interval: 30, maxTraffic: 8, density: 1.8 },
};
