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

/**
 * Localised, user-facing message for a speech-recognition error code.
 *
 * @param {string} code - Browser `SpeechRecognitionErrorEvent.error` value.
 * @param {'en'|'es'} [lang] - Radio language.
 * @returns {string} Human-readable guidance; typing always remains available.
 */
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

/**
 * Browser voice layer: speech recognition, pilot TTS and the mic/voice buttons.
 *
 * All app state is injected so the controller can be instantiated by the
 * composition root and kept out of the simulation/UI modules. Pure helpers
 * above remain testable in Node.
 */
export class VoiceController {
  /**
   * @param {{
   *   root?: Document|null,
   *   getEngine?: () => object|null,
   *   getLang?: () => ('en'|'es'),
   *   tr?: (key: string, vars?: Record<string, string|number>) => string,
   *   onTransmit?: (text: string, options: {voice: boolean}) => void,
   *   SpeechRecognition?: Function|null,
   *   speechSynthesis?: object|null,
   *   navigatorObject?: Navigator|null,
   * }} [options]
   */
  constructor({
    root = globalThis.document || null,
    getEngine = () => null,
    getLang = () => 'en',
    tr = (key) => key,
    onTransmit = () => {},
    SpeechRecognition = globalThis.window?.SpeechRecognition || globalThis.window?.webkitSpeechRecognition || null,
    speechSynthesis = globalThis.window?.speechSynthesis || null,
    navigatorObject = globalThis.navigator || null,
  } = {}) {
    this.root = root;
    this.getEngine = getEngine;
    this.getLang = getLang;
    this.tr = tr;
    this.onTransmit = onTransmit;
    this.micButton = root?.querySelector?.('#btn-mic') || null;
    this.ttsButton = root?.querySelector?.('#btn-tts') || null;
    this.cmdInput = root?.querySelector?.('#cmd') || null;
    this.toastElement = root?.querySelector?.('#voice-toast') || null;
    this.synth = speechSynthesis;
    this.recognition = SpeechRecognition ? new SpeechRecognition() : null;
    this.listening = false;
    this.ttsOn = true;
    this.speechCursor = 0;
    this.toastTimer = null;
    this.voices = [];

    if (this.synth) {
      this.loadVoices();
      this.synth.addEventListener?.('voiceschanged', () => this.loadVoices());
    }

    if (this.recognition) {
      this.recognition.lang = speechLang(this.getLang());
      this.recognition.interimResults = true;
      this.recognition.continuous = false;
      this.recognition.maxAlternatives = 1;
      this.recognition.onstart = () => {
        this.listening = true;
        this.micButton?.classList.add('listening');
        if (this.micButton) this.micButton.textContent = this.tr('listening');
        this.micButton?.setAttribute('aria-pressed', 'true');
        this.hideToast();
        this.synth?.cancel();
      };
      this.recognition.onend = () => {
        this.listening = false;
        this.micButton?.classList.remove('listening');
        if (this.micButton) this.micButton.textContent = 'MIC';
        this.micButton?.setAttribute('aria-pressed', 'false');
      };
      this.recognition.onerror = (event) => {
        this.listening = false;
        this.micButton?.classList.remove('listening');
        if (this.micButton) this.micButton.textContent = 'MIC';
        this.micButton?.setAttribute('aria-pressed', 'false');
        this.voiceError(event?.error || event?.message || 'unknown');
      };
      this.recognition.onresult = (event) => {
        const { interim, final } = transcriptsFromSpeechEvent(event);
        if (interim && this.cmdInput) this.cmdInput.value = interim;
        if (final) {
          if (this.cmdInput) this.cmdInput.value = final;
          this.hideToast();
          this.onTransmit(final, { voice: true });
        }
      };
    } else if (this.micButton) {
      this.micButton.disabled = true;
      this.micButton.title = this.tr('micTitleUnsupported');
      this.micButton.setAttribute('aria-label', this.tr('micTitleUnsupported'));
    }

    if (this.recognition && navigatorObject?.brave?.isBrave) {
      navigatorObject.brave.isBrave()
        .then((isBrave) => {
          if (isBrave && this.micButton) {
            this.micButton.dataset.braveHint = '1';
            this.micButton.title = this.tr('braveHint');
            this.micButton.setAttribute('aria-label', this.tr('braveHint'));
          }
        })
        .catch(() => {});
    }

    this.micButton?.addEventListener('click', () => this.toggleMic());
    this.ttsButton?.addEventListener('click', () => this.toggleTts());
    this.updateTtsButton();
  }

  loadVoices() {
    if (!this.synth) return;
    this.voices = this.synth.getVoices() || [];
  }

  setLanguage(lang) {
    if (this.recognition) this.recognition.lang = speechLang(lang);
  }

  resetSpeechCursor() {
    this.speechCursor = this.getEngine()?.radio.length || 0;
  }

  showToast(text, tone = 'error', ms = 9000) {
    if (!this.toastElement) return;
    this.toastElement.textContent = text;
    this.toastElement.classList.remove('hidden');
    this.toastElement.classList.toggle('ok', tone === 'ok');
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastElement.classList.add('hidden'), ms);
  }

  hideToast() {
    if (this.toastElement) this.toastElement.classList.add('hidden');
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = null;
  }

  voiceError(code) {
    const message = speechErrorMessage(code, this.getLang());
    if (!message) return;
    this.showToast(message);
    const engine = this.getEngine();
    if (engine) engine.log('SYS', `MIC: ${message}`, engine.mode === 'tracon' ? 'APP' : 'TWR');
  }

  speak(text) {
    if (!this.ttsOn || !this.synth || !text) return;
    if (this.listening) this.stopMic();
    const spoken = phoneticSpeech(text);
    if (!spoken) return;
    const Utterance = globalThis.SpeechSynthesisUtterance;
    if (!Utterance) return;
    const utterance = new Utterance(spoken);
    const lang = speechLang(this.getLang());
    const prefix = lang.slice(0, 2);
    const preferred = this.voices.find((v) => String(v.lang).toLowerCase().startsWith(prefix) && /(david|mark|alex|guy|male|jorge|diego|carlos|pablo|enrique|raul)/i.test(v.name))
      || this.voices.find((v) => String(v.lang).toLowerCase().startsWith(prefix));
    if (preferred) utterance.voice = preferred;
    utterance.lang = lang;
    utterance.rate = 1.04;
    utterance.pitch = 0.92;
    utterance.volume = 0.9;
    this.synth.speak(utterance);
  }

  speakNewPilot() {
    const engine = this.getEngine();
    if (!engine || !this.ttsOn) {
      if (engine) this.speechCursor = engine.radio.length;
      return;
    }
    if (this.speechCursor > engine.radio.length) this.speechCursor = engine.radio.length;
    for (let i = this.speechCursor; i < engine.radio.length; i++) {
      const entry = engine.radio[i];
      if (entry.from === 'PILOT') this.speak(entry.text);
    }
    this.speechCursor = engine.radio.length;
  }

  updateTtsButton() {
    if (!this.ttsButton) return;
    this.ttsButton.textContent = this.ttsOn ? this.tr('voiceOn') : this.tr('voiceOff');
    this.ttsButton.title = this.tr('pilotVoices');
    this.ttsButton.classList.toggle('off', !this.ttsOn);
  }

  toggleTts() {
    this.ttsOn = !this.ttsOn;
    if (!this.ttsOn) this.synth?.cancel();
    if (this.ttsOn) this.resetSpeechCursor();
    this.updateTtsButton();
  }

  startMic() {
    if (!this.recognition) {
      this.showToast(this.tr('micUnsupported'));
      return;
    }
    const win = globalThis.window;
    if (typeof win?.isSecureContext === 'boolean' && !win.isSecureContext) {
      this.showToast(this.tr('micSecure'));
      return;
    }
    this.recognition.lang = speechLang(this.getLang());
    this.synth?.cancel();
    try {
      this.recognition.start();
    } catch (err) {
      this.showToast(this.tr('micStartError', { message: err?.message || err }));
    }
  }

  stopMic() {
    if (!this.recognition || !this.listening) return;
    try {
      this.recognition.stop();
    } catch {
      // ignore
    }
  }

  toggleMic() {
    if (!this.recognition) {
      this.showToast(this.tr('micUnsupported'));
      return;
    }
    if (this.listening) this.stopMic();
    else this.startMic();
  }
}
