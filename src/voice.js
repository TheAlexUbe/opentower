// OpenTower - browser speech-recognition diagnostics.
// Pure helpers so the error copy can be tested in Node.

export const SPEECH_ERROR_COPY = {
  network: 'Speech service unavailable. Brave and some Chromium builds block the browser speech service — type the clearance or use Chrome/Edge with speech enabled.',
  'not-allowed': 'Microphone permission denied. Allow the microphone in the browser and try again.',
  'service-not-allowed': 'The browser blocked the speech service.',
  'audio-capture': 'No microphone was found. Check the input device and try again.',
  'no-speech': 'No speech detected. Hold the mic button and speak again.',
  'language-not-supported': 'This browser speech service does not support English.',
  'bad-grammar': 'The speech service rejected the grammar.',
  aborted: '',
};

export const SPEECH_ERROR_COPY_ES = {
  network: 'Servicio de voz no disponible. Brave y algunos navegadores Chromium bloquean el servicio de voz del navegador; escriba la autorización o use Chrome/Edge con voz activada.',
  'not-allowed': 'Permiso de micrófono denegado. Permita el micrófono en el navegador e inténtelo de nuevo.',
  'service-not-allowed': 'El navegador bloqueó el servicio de voz.',
  'audio-capture': 'No se encontró un micrófono. Revise el dispositivo de entrada e inténtelo de nuevo.',
  'no-speech': 'No se detectó voz. Mantenga pulsado el botón del micrófono y hable de nuevo.',
  'language-not-supported': 'El servicio de voz de este navegador no admite español.',
  'bad-grammar': 'El servicio de voz rechazó la gramática.',
  aborted: '',
};

/** BCP 47 language tag used by SpeechRecognition and speechSynthesis. */
export function speechLang(lang = 'en') {
  return lang === 'es' ? 'es-ES' : 'en-US';
}

const NATO_WORDS = {
  A: 'Alpha', B: 'Bravo', C: 'Charlie', D: 'Delta', E: 'Echo', F: 'Foxtrot',
  G: 'Golf', H: 'Hotel', I: 'India', J: 'Juliett', K: 'Kilo', L: 'Lima',
  M: 'Mike', N: 'November', O: 'Oscar', P: 'Papa', Q: 'Quebec', R: 'Romeo',
  S: 'Sierra', T: 'Tango', U: 'Uniform', V: 'Victor', W: 'Whiskey',
  X: 'Xray', Y: 'Yankee', Z: 'Zulu',
};
const DIGIT_WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];

function spellToken(token) {
  return [...token].map((ch) => {
    if (ch >= '0' && ch <= '9') return DIGIT_WORDS[Number(ch)];
    if (ch === '.') return 'Point';
    return NATO_WORDS[ch] || ch;
  }).join(' ');
}

/**
 * Make callsigns and numbers speakable before handing text to TTS.
 * N279NJ -> "November Two Seven Nine November Juliett".
 */
export function phoneticSpeech(text) {
  const source = String(text || '');
  if (!source.trim()) return '';
  return source
    .replace(/\b(?:N\d{1,4}[A-Z]{0,2}|[A-Z]{2,3}\d{1,4}[A-Z]{0,2})\b/g, (token) => spellToken(token))
    .replace(/\b\d+(?:\.\d+)?\b/g, (token) => spellToken(token));
}

/** Saved radio language wins; otherwise follow a Spanish browser locale. */
export function preferredRadioLang(stored, browserLang = 'en') {
  if (stored === 'es' || stored === 'en') return stored;
  return String(browserLang || '').toLowerCase().startsWith('es') ? 'es' : 'en';
}

export function speechErrorMessage(code, lang = 'en') {
  const copy = lang === 'es' ? SPEECH_ERROR_COPY_ES : SPEECH_ERROR_COPY;
  if (Object.prototype.hasOwnProperty.call(copy, code)) {
    return copy[code];
  }
  return lang === 'es'
    ? `El reconocimiento de voz falló (${code || 'error desconocido'}). Escriba la autorización.`
    : `Speech recognition failed (${code || 'unknown error'}). Type the clearance instead.`;
}

/** Pull the newly available interim/final text out of a SpeechRecognition event. */
export function transcriptsFromSpeechEvent(event) {
  let interim = '';
  let final = '';
  const results = event?.results || [];
  const start = event?.resultIndex || 0;
  for (let i = start; i < results.length; i++) {
    const chunk = results[i]?.[0]?.transcript || '';
    if (results[i]?.isFinal) final += chunk;
    else interim += chunk;
  }
  return { interim: interim.trim(), final: final.trim() };
}
