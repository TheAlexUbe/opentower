// OpenTower - built-in scenarios.
// Script entries: { t (seconds), kind: 'departure'|'arrival', gate?, type?, callsign? }

export const SCENARIOS = [
  {
    id: 'free',
    name: 'Free shift',
    tagline: 'Endless traffic, your settings',
    description: 'Pick a length and traffic level. The field keeps generating departures and arrivals until the clock runs out.',
    mode: 'tower',
    duration: null,
    difficulty: null,
    script: null,
    goals: null,
  },
  {
    id: 'first',
    name: 'First shift',
    tagline: 'One departure, one arrival',
    description: 'A gentle start: taxi one departure, get it airborne, then land one arrival and taxi it to the ramp.',
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
    tagline: 'Four departures before the bank',
    description: 'The first bank is pushing. Sequence four departures and fit one arrival between them.',
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
    tagline: 'A 777 needs room',
    description: 'A heavy arrives while a light departure waits. Mind the wake separation, then launch the 737.',
    mode: 'tower',
    duration: 300,
    difficulty: 'calm',
    script: [
      { t: 2, kind: 'departure', type: 'C172', callsign: 'N172OT' },
      { t: 25, kind: 'arrival', type: 'B77W', callsign: 'FDX77' },
      { t: 95, kind: 'departure', type: 'B738', callsign: 'SWA88' },
    ],
    goals: { served: 3, maxIncidents: 0 },
  },
  {
    id: 'north',
    name: 'North ramp',
    tagline: 'Cross runway 12',
    description: 'Work the north ramp. Every taxi to or from the main runway crosses inactive runway 12: issue "cross runway 12" at the hold.',
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
    tagline: 'TRACON radar, 12 miles out',
    description: 'Work Copper Approach: vector and descend arrivals, sequence them onto the final, and hand them to tower.',
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

export function scenarioById(id) {
  return SCENARIOS.find((s) => s.id === id) || SCENARIOS[0];
}
