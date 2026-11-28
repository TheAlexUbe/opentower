// OpenTower - built-in scenarios.
// Script entries: { t (seconds), kind: 'departure'|'arrival', gate?, type?, callsign? }

export const SCENARIOS = [
  {
    id: 'free',
    name: 'Free shift',
    nameEs: 'Turno libre',
    tagline: 'Endless traffic, your settings',
    taglineEs: 'Tráfico sin fin, tus ajustes',
    description: 'Pick a length and traffic level. The field keeps generating departures and arrivals until the clock runs out.',
    descriptionEs: 'Elige duración y nivel de tráfico. El campo genera salidas y llegadas hasta que termine el reloj.',
    mode: 'tower',
    duration: null,
    difficulty: null,
    script: null,
    goals: null,
  },
  {
    id: 'first',
    name: 'First shift',
    nameEs: 'Primer turno',
    tagline: 'One departure, one arrival',
    taglineEs: 'Una salida, una llegada',
    description: 'A gentle start: taxi one departure, get it airborne, then land one arrival and taxi it to the ramp.',
    descriptionEs: 'Un inicio tranquilo: saca una salida, ponla en el aire y luego aterriza una llegada y llévala a la plataforma.',
    mode: 'tower',
    duration: 300,
    difficulty: 'calm',
    script: [
      { t: 2, kind: 'departure', type: 'C172' },
      { t: 40, kind: 'arrival', type: 'C182' },
    ],
    goals: { served: 2, maxIncidents: 0 },
  },
  {
    id: 'push',
    name: 'Morning push',
    nameEs: 'Push de la mañana',
    tagline: 'Four departures before the bank',
    taglineEs: 'Cuatro salidas antes del banco',
    description: 'The first bank is pushing. Sequence four departures and fit one arrival between them.',
    descriptionEs: 'El primer banco está saliendo. Secuencia cuatro salidas e intercala una llegada.',
    mode: 'tower',
    duration: 600,
    difficulty: 'busy',
    script: [
      { t: 2, kind: 'departure', type: 'B738' },
      { t: 20, kind: 'departure', type: 'A320' },
      { t: 45, kind: 'departure', type: 'E75L' },
      { t: 70, kind: 'arrival', type: 'B738' },
      { t: 130, kind: 'departure', type: 'CRJ9' },
    ],
    goals: { served: 4, maxIncidents: 1 },
  },
  {
    id: 'heavy',
    name: 'Heavy arrival',
    nameEs: 'Llegada pesada',
    tagline: 'A 777 needs room',
    taglineEs: 'Un 777 necesita espacio',
    description: 'A heavy arrives while a light departure waits. Mind the wake separation, then launch the 737.',
    descriptionEs: 'Llega un pesado mientras espera una salida ligera. Cuida la estela y luego lanza el 737.',
    mode: 'tower',
    duration: 300,
    difficulty: 'calm',
    script: [
      { t: 2, kind: 'departure', type: 'C172', callsign: 'N172OT' },
      { t: 25, kind: 'arrival', type: 'B77W', callsign: 'CFX77' },
      { t: 95, kind: 'departure', type: 'B738', callsign: 'CMX88' },
    ],
    goals: { served: 3, maxIncidents: 0 },
  },
  {
    id: 'north',
    name: 'North ramp',
    nameEs: 'Ramal norte',
    tagline: 'Cross runway 12',
    taglineEs: 'Cruza la pista 12',
    description: 'Work the north ramp. Every taxi to or from the main runway crosses inactive runway 12: issue "cross runway 12" at the hold.',
    descriptionEs: 'Trabaja el ramal norte. Cada rodaje cruza la pista inactiva 12: autoriza "cruce la pista 12" en el punto de espera.',
    mode: 'tower',
    duration: 600,
    difficulty: 'calm',
    script: [
      { t: 2, kind: 'departure', gate: 'N1', type: 'PC12' },
      { t: 55, kind: 'departure', gate: 'N2', type: 'C182' },
      { t: 120, kind: 'arrival', gate: 'N1', type: 'BE20' },
    ],
    goals: { served: 3, maxIncidents: 1 },
  },
  {
    id: 'tracon',
    name: 'Approach final',
    nameEs: 'Final de aproximación',
    tagline: 'TRACON radar, 12 miles out',
    taglineEs: 'Radar TRACON, a 12 millas',
    description: 'Work Copper Approach: vector and descend arrivals, sequence them onto the final, and hand them to tower.',
    descriptionEs: 'Trabaja Copper Approach: vectoriza y desciende llegadas, sécalas en la final y entrégalas a torre.',
    mode: 'tracon',
    duration: 600,
    difficulty: 'calm',
    script: [
      { t: 4, kind: 'arrival', type: 'B738' },
      { t: 30, kind: 'arrival', type: 'A320' },
      { t: 60, kind: 'departure', type: 'B738' },
      { t: 95, kind: 'arrival', type: 'E75L' },
    ],
    goals: { served: 3, maxIncidents: 1 },
  },
];

/**
 * Look up a built-in scenario by id.
 *
 * @param {string} id - Scenario id.
 * @returns {object} The matching scenario, or the first scenario as a fallback.
 */
export function scenarioById(id) {
  return SCENARIOS.find((s) => s.id === id) || SCENARIOS[0];
}

/**
 * Localised display name for a scenario.
 *
 * @param {object} s - Scenario object.
 * @param {'en'|'es'} [lang] - Display language.
 * @returns {string}
 */
export function scenarioName(s, lang = 'en') {
  return lang === 'es' ? (s.nameEs || s.name) : s.name;
}

/**
 * Localised one-line tagline for a scenario.
 *
 * @param {object} s - Scenario object.
 * @param {'en'|'es'} [lang] - Display language.
 * @returns {string}
 */
export function scenarioTagline(s, lang = 'en') {
  return lang === 'es' ? (s.taglineEs || s.tagline) : s.tagline;
}

/**
 * Localised long description for a scenario.
 *
 * @param {object} s - Scenario object.
 * @param {'en'|'es'} [lang] - Display language.
 * @returns {string}
 */
export function scenarioDescription(s, lang = 'en') {
  return lang === 'es' ? (s.descriptionEs || s.description) : s.description;
}
