// OpenTower - radio phraseology: parse controller text and build readbacks.
// Standard ATC phraseology; all strings are original.

export function normalize(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\bALFA\b/g, 'ALPHA')
    .replace(/\bECO\b/g, 'ECHO')
    .replace(/\bJULIETA\b/g, 'JULIETT')
    .replace(/\bNOVIEMBRE\b/g, 'NOVEMBER')
    .replace(/\bEQUIS\b/g, 'XRAY')
    .replace(/\bI GRIEGA\b/g, 'YANKEE')
    .replace(/\bGRIEGA\b/g, 'YANKEE')
    .replace(/\bYANQUI\b/g, 'YANKEE')
    .replace(/\bYANKI\b/g, 'YANKEE')
    .replace(/\bYE\b/g, 'YANKEE')
    .replace(/\bJOTA\b/g, 'JULIETT')
    .replace(/\bUVE DOBLE\b/g, 'WHISKEY')
    .replace(/\bDOBLE UVE\b/g, 'WHISKEY')
    .replace(/\bDOBLE VE\b/g, 'WHISKEY')
    .replace(/\bDOBLE U\b/g, 'WHISKEY')
    .replace(/\bWHISKY\b/g, 'WHISKEY')
    .replace(/\bX RAY\b/g, 'XRAY')
    .replace(/\bNINER\b/g, 'NINE')
    .replace(/\s+/g, ' ')
    .trim();
}

const NATO = {
  A: 'ALPHA', B: 'BRAVO', C: 'CHARLIE', D: 'DELTA', E: 'ECHO', F: 'FOXTROT',
  G: 'GOLF', H: 'HOTEL', I: 'INDIA', J: 'JULIETT', K: 'KILO', L: 'LIMA',
  M: 'MIKE', N: 'NOVEMBER', O: 'OSCAR', P: 'PAPA', Q: 'QUEBEC', R: 'ROMEO',
  S: 'SIERRA', T: 'TANGO', U: 'UNIFORM', V: 'VICTOR', W: 'WHISKEY',
  X: 'XRAY', Y: 'YANKEE', Z: 'ZULU',
};
const DIGIT_WORDS = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'];
const DIGIT_WORDS_ES = ['CERO', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE'];

/** Spell a callsign in ICAO/NATO words, with optional digit handling. */
function spell(text, { digitsAsWords = true, firstLetterAsLetter = false, digitWords = DIGIT_WORDS } = {}) {
  const clean = String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return [...clean].map((ch, i) => {
    if (ch >= '0' && ch <= '9') return digitsAsWords ? digitWords[Number(ch)] : ch;
    if (firstLetterAsLetter && i === 0) return ch;
    return NATO[ch] || ch;
  }).join(' ');
}

/** Spell letters and keep a run of digits together ("NOVEMBER 123 ALPHA BRAVO"). */
function spellMixed(text, { firstLetterAsLetter = false, digitWords = DIGIT_WORDS } = {}) {
  const clean = String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const out = [];
  let digits = '';
  [...clean].forEach((ch, i) => {
    if (ch >= '0' && ch <= '9') {
      digits += ch;
      return;
    }
    if (digits) {
      out.push(digits);
      digits = '';
    }
    out.push(firstLetterAsLetter && i === 0 ? ch : (NATO[ch] || ch));
  });
  if (digits) out.push(digits);
  return out.join(' ');
}

/** Spell digits as words (or raw) but keep letters as single letters. */
function spellLoose(text, { digitsAsWords = true, digitWords = DIGIT_WORDS } = {}) {
  const clean = String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return [...clean].map((ch) => {
    if (ch >= '0' && ch <= '9') return digitsAsWords ? digitWords[Number(ch)] : ch;
    return ch;
  }).join(' ');
}

/** Keep digit runs together and letters as single letters ("N 123 A B"). */
function spellLooseMixed(text) {
  const clean = String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const out = [];
  let digits = '';
  [...clean].forEach((ch) => {
    if (ch >= '0' && ch <= '9') {
      digits += ch;
      return;
    }
    if (digits) {
      out.push(digits);
      digits = '';
    }
    out.push(ch);
  });
  if (digits) out.push(digits);
  return out.join(' ');
}

export function spokenRunway(r, lang = 'en') {
  const v = String(r);
  if (lang === 'es') {
    if (v === '27') return 'dos siete';
    if (v === '09') return 'cero nueve';
    return v;
  }
  if (v === '27') return 'two seven';
  if (v === '09') return 'zero nine';
  return v;
}

function esc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function keysFor(ac) {
  const keys = new Set();
  const raw = normalize(ac.callsign).replace(/\s+/g, '');
  if (raw) {
    keys.add(raw);
    if (raw.startsWith('N') && raw.length >= 3) keys.add(raw.slice(1));
    keys.add(spellLooseMixed(raw));
    for (const digitWords of [DIGIT_WORDS, DIGIT_WORDS_ES]) {
      keys.add(spell(raw, { digitWords }));
      keys.add(spellMixed(raw, { digitWords }));
      keys.add(spellLoose(raw, { digitWords }));
      keys.add(spell(raw, { digitsAsWords: false, digitWords }));
      keys.add(spellLoose(raw, { digitsAsWords: false, digitWords }));
      if (raw.startsWith('N')) {
        keys.add(spell(raw, { firstLetterAsLetter: true, digitWords }));
        keys.add(spellMixed(raw, { firstLetterAsLetter: true, digitWords }));
        keys.add(spell(raw, { digitsAsWords: false, firstLetterAsLetter: true, digitWords }));
        keys.add(spell(raw.slice(1), { digitWords }));
      }
    }
    if (raw.includes('0')) {
      const full = spell(raw);
      keys.add(full.replace(/\bZERO\b/g, 'OH'));
      if (raw.startsWith('N')) keys.add(spell(raw, { firstLetterAsLetter: true }).replace(/\bZERO\b/g, 'OH'));
      keys.add(spellLoose(raw).replace(/\bZERO\b/g, 'OH'));
    }
  }
  const spoken = normalize(ac.spoken);
  if (spoken) {
    keys.add(spoken);
    if (spoken !== raw) {
      for (const digitWords of [DIGIT_WORDS, DIGIT_WORDS_ES]) {
        keys.add(spoken.replace(/\d/g, (d) => ` ${digitWords[Number(d)]} `).replace(/\s+/g, ' ').trim());
      }
      keys.add(spoken.replace(/\s+/g, ''));
    }
  }
  return [...keys].filter(Boolean);
}

/** Longest exact token match wins; identical length matches are ambiguous. */
export function findAddressee(text, aircraft) {
  const t = normalize(text);
  let best = null;
  const ties = [];
  for (const ac of aircraft) {
    for (const key of keysFor(ac)) {
      const re = new RegExp(`(^| )${esc(key)}( |$)`);
      if (!re.test(t)) continue;
      if (!best || key.length > best.len) {
        best = { ac, len: key.length };
        ties.length = 0;
        ties.push(ac);
      } else if (key.length === best.len && best.ac !== ac) {
        ties.push(ac);
      }
    }
  }
  if (!best) return { aircraft: null, ambiguous: false };
  return { aircraft: best.ac, ambiguous: ties.length > 1 };
}

function runwayIn(t) {
  if (/(^| )(27|TWO SEVEN|DOS SIETE|VEINTISIETE)( |$)/.test(t)) return '27';
  if (/(^| )(09|9|NINE|ZERO NINE|OH NINE|NUEVE|CERO NUEVE)( |$)/.test(t)) return '09';
  return null;
}

export function parseInstruction(text) {
  const t = normalize(text);
  if (!t) return { type: 'empty' };
  const runway = runwayIn(t);

  if (/(^| )(SAY AGAIN|REPEAT|REPITE|REPITA|OTRA VEZ|DIGA OTRA VEZ)( |$)/.test(t)) return { type: 'sayAgain' };
  if (/(^| )(GO AROUND|MISSED APPROACH|FRUSTRADA|FRUSTRADO|MOTOR Y AL AIRE|DESESTIMADA|DESESTIMADO)( |$)/.test(t)) return { type: 'goAround' };
  if (/(^| )(CANCEL TAKEOFF|CANCEL THE TAKEOFF|ABORT|CANCELE (EL )?DESPEGUE|CANCELAR (EL )?DESPEGUE|ABORTE( EL DESPEGUE)?|ABORTA( EL DESPEGUE)?)( |$)/.test(t)) return { type: 'abort' };
  if (/(^| )(CONTINUE TAXI|CONTINUE|CONTINUE RODAJE|CONTINUE EL RODAJE|CONTINUE CON EL RODAJE|CONTINUA|PROSIGA|SIGA)( |$)/.test(t)) return { type: 'continueTaxi' };
  if (/(^| )(LINE UP AND WAIT|LINE UP|LUAW|ALINEESE Y ESPERE|ALINEARSE Y ESPERAR|ALINEA Y ESPERA|ALINEESE Y ESPEREN)( |$)/.test(t)) return { type: 'lineUp', runway };
  if (/(^| )(CLEARED (FOR )?TAKEOFF|TAKEOFF|AUTORIZADO (PARA |A )?(EL )?(DESPEGAR|DESPEGUE)|DESPEGAR|DESPEGUE)( |$)/.test(t)) return { type: 'takeoff', runway };
  if (/(^| )(CLEARED TO LAND|CLEARED (FOR )?LAND|LAND|AUTORIZADO (PARA |A )?(EL )?(ATERRIZAR|ATERRIZAJE)|ATERRIZAR|ATERRIZAJE)( |$)/.test(t)) return { type: 'land', runway };
  if (/(^| )(CROSS (RUNWAY )?(12|ONE TWO|TWELVE)|CRUCE (LA )?(PISTA )?(12|UNO DOS|DOCE)|CRUZAR (LA )?(PISTA )?(12|UNO DOS|DOCE))( |$)/.test(t)) return { type: 'cross', runway: '12' };
  if (/(^| )(HOLD SHORT|ALTO ANTES( (DE LA )?PISTA)?|DETENGASE ANTES( (DE LA )?PISTA)?|ESPERE ANTES( (DE LA )?PISTA)?|MANTENGASE ANTES( (DE LA )?PISTA)?|ESPERE EN EL PUNTO DE ESPERA|ALTO EN EL PUNTO DE ESPERA)( |$)/.test(t)) return { type: 'holdShort', runway };
  if (/(^| )(TAXI|TAXIING|RUEDE|RUEDA|RODIA|RODAR|RODANDO)( |$)/.test(t)) {
    const viaBravo = /(^| )(VIA|POR)( LA)? (BRAVO|B)( |$)/.test(t);
    const toRamp = /(^| )(RAMP|GATE|PARKING|APRON|PLATAFORMA|RAMPA|PUERTA|HANGAR)( |$)/.test(t);
    return { type: 'taxi', to: toRamp ? 'ramp' : 'runway', viaBravo, runway };
  }
  if (/(^| )(CONTACT (GROUND|TOWER)|MONITOR|FREQUENCY|CONTACTE (CON )?(TIERRA|TORRE)|CONTACTO CON (TIERRA|TORRE)|LLAME A (LA )?(TIERRA|TORRE)|CAMBIE A (LA )?(TIERRA|TORRE)|CAMBIO (A|CON) (LA )?(TIERRA|TORRE)|PASE A (LA )?(TIERRA|TORRE)|CONTACTAR (TIERRA|TORRE))( |$)/.test(t)) return { type: 'contact' };
  if (/(^| )(STANDBY|HOLD ON|ESPERE|ESPERA|AGUARDE|MANTENGASE)( |$)/.test(t)) return { type: 'standby' };
  if (/(^| )(ROGER|AFFIRM|ACKNOWLEDGE|COPY|RECIBIDO|COPIO|ENTENDIDO|AFIRMATIVO|CORRECTO)( |$)/.test(t)) return { type: 'ack' };
  return { type: 'unknown' };
}

export const phrase = {
  taxi: (ac, geo, lang = 'en') => {
    const r = spokenRunway(geo.runway, lang);
    if (lang === 'es') {
      return {
        atc: `${ac.callsign}, ruede a la pista ${r} por alfa, alto antes de la pista ${r}.`,
        pilot: `Ruedo a la pista ${r} por alfa, alto antes, ${ac.callsign}.`,
      };
    }
    return {
      atc: `${ac.callsign}, taxi to runway ${r} via alpha, hold short runway ${r}.`,
      pilot: `Taxi to runway ${r} via alpha, hold short, ${ac.callsign}.`,
    };
  },
  taxiRamp: (ac, gate, lang = 'en') => ({
    atc: lang === 'es'
      ? `${ac.callsign}, ruede a la plataforma ${gate.id}.`
      : `${ac.callsign}, taxi to the ${gate.id} ramp.`,
    pilot: lang === 'es'
      ? `Ruedo a la plataforma ${gate.id}, ${ac.callsign}.`
      : `Taxi to the ${gate.id} ramp, ${ac.callsign}.`,
  }),
  holdShort: (ac, geo, lang = 'en') => {
    const r = spokenRunway(geo.runway, lang);
    return {
      atc: lang === 'es'
        ? `${ac.callsign}, alto antes de la pista ${r}.`
        : `${ac.callsign}, hold short of runway ${r}.`,
      pilot: lang === 'es'
        ? `Alto antes de la pista ${r}, ${ac.callsign}.`
        : `Holding short of runway ${r}, ${ac.callsign}.`,
    };
  },
  lineUp: (ac, geo, lang = 'en') => {
    const r = spokenRunway(geo.runway, lang);
    return {
      atc: lang === 'es'
        ? `${ac.callsign}, alinéese y espere pista ${r}.`
        : `${ac.callsign}, line up and wait runway ${r}.`,
      pilot: lang === 'es'
        ? `Alineado y esperando pista ${r}, ${ac.callsign}.`
        : `Line up and wait runway ${r}, ${ac.callsign}.`,
    };
  },
  takeoff: (ac, geo, lang = 'en') => {
    const r = spokenRunway(geo.runway, lang);
    return {
      atc: lang === 'es'
        ? `${ac.callsign}, pista ${r}, autorizado para despegar.`
        : `${ac.callsign}, runway ${r}, cleared for takeoff.`,
      pilot: lang === 'es'
        ? `Autorizado para despegar pista ${r}, ${ac.callsign}.`
        : `Cleared for takeoff runway ${r}, ${ac.callsign}.`,
    };
  },
  land: (ac, geo, lang = 'en') => {
    const r = spokenRunway(geo.runway, lang);
    return {
      atc: lang === 'es'
        ? `${ac.callsign}, pista ${r}, autorizado para aterrizar.`
        : `${ac.callsign}, runway ${r}, cleared to land.`,
      pilot: lang === 'es'
        ? `Autorizado para aterrizar pista ${r}, ${ac.callsign}.`
        : `Cleared to land runway ${r}, ${ac.callsign}.`,
    };
  },
  goAround: (ac, lang = 'en') => ({
    atc: lang === 'es'
      ? `${ac.callsign}, frustrada, repito, frustrada.`
      : `${ac.callsign}, go around, I say again, go around.`,
    pilot: lang === 'es' ? `Frustrada, ${ac.callsign}.` : `Going around, ${ac.callsign}.`,
  }),
  contactGround: (ac, lang = 'en') => ({
    atc: lang === 'es'
      ? `${ac.callsign}, contacte tierra 121.7.`
      : `${ac.callsign}, contact ground 121.7.`,
    pilot: lang === 'es' ? `Cambio a tierra, ${ac.callsign}.` : `Over to ground, ${ac.callsign}.`,
  }),
  continueTaxi: (ac, lang = 'en') => ({
    atc: lang === 'es' ? `${ac.callsign}, continúe el rodaje.` : `${ac.callsign}, continue taxi.`,
    pilot: lang === 'es' ? `Continúo el rodaje, ${ac.callsign}.` : `Continuing taxi, ${ac.callsign}.`,
  }),
  cancelTakeoff: (ac, lang = 'en') => ({
    atc: lang === 'es'
      ? `${ac.callsign}, cancele el despegue, deténgase.`
      : `${ac.callsign}, cancel takeoff clearance, stop straight ahead.`,
    pilot: lang === 'es' ? `Deteniéndome, ${ac.callsign}.` : `Stopping, ${ac.callsign}.`,
  }),
  initialTaxi: (ac, gate, atis, lang = 'en') => (lang === 'es'
    ? `Tierra, ${ac.callsign} en ${gate.id}, listo para rodar con información ${atis}.`
    : `Ground, ${ac.callsign} at ${gate.id}, ready to taxi with information ${atis}.`),
  initialInbound: (ac, nm, direction, atis, lang = 'en') => (lang === 'es'
    ? `Torre, ${ac.callsign}, ${nm} millas al ${direction === 'east' ? 'este' : 'oeste'}, entrando para aterrizar con información ${atis}.`
    : `Tower, ${ac.callsign}, ${nm} miles ${direction}, inbound for landing with information ${atis}.`),
  holdingShort: (ac, geo, lang = 'en') => {
    const r = spokenRunway(geo.runway, lang);
    return lang === 'es'
      ? `Torre, ${ac.callsign} en el punto de espera de la pista ${r}, listo para salir.`
      : `Tower, ${ac.callsign} holding short runway ${r}, ready for departure.`;
  },
  landed: (ac, geo, gate, lang = 'en') => {
    const r = spokenRunway(geo.runway, lang);
    return lang === 'es'
      ? `Tierra, ${ac.callsign}, pista ${r} despejada, ruedo a la plataforma ${gate.id}.`
      : `Ground, ${ac.callsign}, runway ${r} clear, taxi to the ${gate.id} ramp.`;
  },
};
