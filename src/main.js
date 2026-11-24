// OpenTower - UI bootstrap and game loop.
import { SimEngine } from './engine.js';
import { Renderer } from './render.js';
import { TraconEngine, TraconRenderer } from './tracon.js';
import { AIRPORT } from './config.js';
import { SCENARIOS, scenarioById, scenarioName, scenarioTagline, scenarioDescription } from './scenarios.js';
import { effectiveScenarioSettings, bestScoreKey } from './scenario-state.js';
import { t } from './i18n.js';
import { preferredRadioLang, phoneticSpeech, speechErrorMessage, speechLang, transcriptsFromSpeechEvent } from './voice.js';
import { fetchWeather } from './weather.js';

const $ = (sel) => document.querySelector(sel);
const canvas = $('#scope');
let renderer = new Renderer(canvas);

let engine = null;
let raf = null;
let lastTs = 0;
let lastUi = 0;
let speed = 1;
let paused = false;
let selectedId = null;
let endShown = false;
let activeScenario = null;
let settings = {
  duration: 600,
  difficulty: 'calm',
  freeDuration: 600,
  freeDifficulty: 'calm',
  scenarioId: 'free',
  liveWx: true,
  lang: 'en',
};

const safeGet = (key, fallback = null) => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};

const safeSet = (key, value) => {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
};

const storedLang = safeGet('opentower.lang', null);
settings.lang = preferredRadioLang(storedLang, navigator.language);

const isEs = () => settings.lang === 'es';
const ui = (en, es) => (isEs() ? es : en);
const tr = (key, vars = {}) => t(settings.lang, key, vars);

function setSelected(id) {
  selectedId = id;
  if (renderer) renderer.selectedId = selectedId;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function applyStaticI18n(lang = settings.lang) {
  document.documentElement.lang = lang;
  document.title = t(lang, 'appTitle');
  for (const el of document.querySelectorAll('[data-i18n]')) {
    el.textContent = t(lang, el.dataset.i18n);
  }
  for (const el of document.querySelectorAll('[data-i18n-html]')) {
    el.innerHTML = t(lang, el.dataset.i18nHtml);
  }
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) {
    el.placeholder = t(lang, el.dataset.i18nPlaceholder);
  }
  for (const el of document.querySelectorAll('[data-i18n-title]')) {
    el.title = t(lang, el.dataset.i18nTitle);
  }
  for (const el of document.querySelectorAll('[data-i18n-aria-label]')) {
    el.setAttribute('aria-label', t(lang, el.dataset.i18nAriaLabel));
  }
  const pause = $('#btn-pause');
  if (pause) {
    const key = paused ? 'resume' : 'pause';
    pause.title = t(lang, key);
    pause.setAttribute('aria-label', t(lang, key));
  }
  const mic = $('#btn-mic');
  if (mic) {
    if (mic.disabled) {
      mic.title = t(lang, 'micTitleUnsupported');
      mic.setAttribute('aria-label', t(lang, 'micTitleUnsupported'));
    } else if (mic.dataset.braveHint) {
      mic.title = t(lang, 'braveHint');
      mic.setAttribute('aria-label', t(lang, 'braveHint'));
    } else {
      mic.title = t(lang, 'pushToTalk');
      mic.setAttribute('aria-label', t(lang, 'pushToTalk'));
    }
  }
}

// ------------------------------------------------------------------ overlays
function selectChip(container, attr, value) {
  for (const b of container.querySelectorAll('button')) {
    const on = b.dataset[attr] === String(value);
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  }
}

$('#duration-chips').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  settings.duration = Number(b.dataset.duration);
  settings.freeDuration = settings.duration;
  selectChip($('#duration-chips'), 'duration', settings.duration);
});

$('#difficulty-chips').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  settings.difficulty = b.dataset.difficulty;
  settings.freeDifficulty = settings.difficulty;
  selectChip($('#difficulty-chips'), 'difficulty', settings.difficulty);
  showBest();
});

const langChips = $('#lang-chips');
langChips.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  applyLanguage(b.dataset.lang);
});

function applyLanguage(lang, { persist = true } = {}) {
  const next = lang === 'es' ? 'es' : 'en';
  settings.lang = next;
  selectChip(langChips, 'lang', next);
  applyStaticI18n(next);
  const cmd = $('#cmd');
  if (cmd) cmd.setAttribute('lang', next);
  for (const sel of ['#radio', '#live-radio', '#quick', '#strips', '#pending-badge', '#scope-alert', '#voice-toast', '.scope-help', '#wind-line']) {
    const el = $(sel);
    if (el) el.setAttribute('lang', next);
  }
  populateScenarioOptions();
  showBest();
  if (recognition) recognition.lang = speechLang(next);
  if ($('#btn-tts')) updateTtsButton();
  if (engine) {
    setWxLine(engine.weather, engine);
    renderStrips();
    renderQuick();
    updateHeader();
    renderAlert();
  }
  if (persist) safeSet('opentower.lang', next);
}

const scenarioSelect = $('#scenario-select');

function populateScenarioOptions() {
  const selected = settings.scenarioId;
  scenarioSelect.replaceChildren();
  for (const s of SCENARIOS) {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = `${scenarioName(s, settings.lang)} — ${scenarioTagline(s, settings.lang)}`;
    scenarioSelect.appendChild(opt);
  }
  scenarioSelect.value = selected;
}

function setChipsLocked(container, locked) {
  container.classList.toggle('locked', locked);
  for (const b of container.querySelectorAll('button')) b.disabled = locked;
}

function applyScenario(id) {
  const s = scenarioById(id);
  settings.scenarioId = s.id;
  scenarioSelect.value = s.id;
  $('#scenario-desc').textContent = scenarioDescription(s, settings.lang);
  const eff = effectiveScenarioSettings(s, {
    duration: settings.freeDuration,
    difficulty: settings.freeDifficulty,
  });
  settings.duration = eff.duration;
  settings.difficulty = eff.difficulty;
  selectChip($('#duration-chips'), 'duration', eff.duration);
  selectChip($('#difficulty-chips'), 'difficulty', eff.difficulty);
  setChipsLocked($('#duration-chips'), eff.durationLocked);
  setChipsLocked($('#difficulty-chips'), eff.difficultyLocked);
  showBest();
}

scenarioSelect.addEventListener('change', () => applyScenario(scenarioSelect.value));
$('#live-wx').addEventListener('change', (e) => {
  settings.liveWx = e.target.checked;
});

function showBest() {
  const scenario = scenarioById(settings.scenarioId);
  const eff = effectiveScenarioSettings(scenario, {
    duration: settings.freeDuration,
    difficulty: settings.freeDifficulty,
  });
  const best = Number(safeGet(bestScoreKey(scenario.id, eff.difficulty), '0')) || 0;
  $('#best-line').textContent = best
    ? `${tr('best')} ${scenarioName(scenario, settings.lang)} · ${tr(eff.difficulty)}: ${best}/100.`
    : '';
}

async function startShift() {
  const startBtn = $('#btn-start');
  startBtn.disabled = true;
  let weather = null;
  if (settings.liveWx) {
    startBtn.textContent = tr('fetching');
    weather = await fetchWeather({ timeoutMs: 3000 });
  }
  startBtn.textContent = tr('startShift');
  startBtn.disabled = false;

  activeScenario = scenarioById(settings.scenarioId);
  safeSet('opentower.onboarded', '1');
  const common = {
    duration: settings.duration,
    difficulty: settings.difficulty,
    seed: (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0,
    weather,
    scenario: activeScenario,
    lang: settings.lang,
  };
  if (activeScenario.mode === 'tracon') {
    engine = new TraconEngine(common);
    renderer = new TraconRenderer(canvas);
  } else {
    engine = new SimEngine(common);
    renderer = new Renderer(canvas);
  }
  speed = 1;
  paused = false;
  setSelected(null);
  endShown = false;
  lastAlertText = null;
  renderer.setEngine(engine);
  renderer.selectedId = selectedId;
  renderer.resize();
  $('#start').classList.add('hidden');
  $('#end').classList.add('hidden');
  $('#app').inert = false;
  $('#btn-speed').textContent = '1×';
  updatePauseButton();
  $('#active-rwy').textContent = engine.geo.runway;
  $('#wind-line').textContent = `${tr('wind')} ${String(engine.wind.dir).padStart(3, '0')}/${String(engine.wind.speed).padStart(2, '0')} · A${engine.altimeter}`;
  if (engine.mode === 'tracon') {
    $('#airport-name').textContent = 'COPPER APPROACH · APP';
    $('#freq-twr').textContent = '124.2';
    $('#freq-gnd').textContent = '—';
    $('#scope').setAttribute('aria-label', tr('scopeTraconAria'));
    document.querySelector('.scope-help').textContent = tr('scopeTracon');
  } else {
    $('#airport-name').textContent = `${AIRPORT.code} · ${AIRPORT.name}`;
    $('#freq-twr').textContent = AIRPORT.tower;
    $('#freq-gnd').textContent = AIRPORT.ground;
    $('#scope').setAttribute('aria-label', tr('scopeTowerAria'));
    document.querySelector('.scope-help').textContent = tr('scopeTower');
  }
  setWxLine(weather, engine);
  resetRadioLog();
  resetStrips();
  renderStrips();
  renderRadio();
  renderQuick();
  updateHeader();
  resetSpeechCursor();
  $('#cmd').focus();
  lastTs = performance.now();
  stopLoop();
  raf = requestAnimationFrame(frame);
}

function setWxLine(weather, eng) {
  const line = $('#wx-line');
  if (weather?.live) {
    line.className = 'wx-line';
    line.textContent = `${tr('live')} · ${weather.raw}`;
  } else if (eng) {
    line.className = 'wx-line sim';
    line.textContent = `${tr('simWx')} · ${tr('wind')} ${String(eng.wind.dir).padStart(3, '0')}/${String(eng.wind.speed).padStart(2, '0')} · A${eng.altimeter}`;
  } else {
    line.className = 'wx-line sim';
    line.textContent = settings.liveWx ? tr('weatherUnavailable') : '';
  }
}

$('#btn-start').addEventListener('click', startShift);
$('#btn-again').addEventListener('click', startShift);
$('#btn-menu').addEventListener('click', () => {
  stopLoop();
  $('#app').inert = true;
  $('#end').classList.add('hidden');
  $('#start').classList.remove('hidden');
  showBest();
  requestAnimationFrame(() => $('#start .modal').focus());
});
$('#btn-new').addEventListener('click', () => {
  if (engine) engine.paused = true;
  stopLoop();
  $('#app').inert = true;
  $('#end').classList.add('hidden');
  $('#start').classList.remove('hidden');
  showBest();
  requestAnimationFrame(() => $('#start .modal').focus());
});

// ------------------------------------------------------------------ controls
$('#btn-pause').addEventListener('click', () => {
  if (!engine || engine.finished) return;
  paused = !paused;
  engine.paused = paused;
  updatePauseButton();
});

$('#btn-speed').addEventListener('click', () => {
  speed = speed === 1 ? 2 : speed === 2 ? 4 : 1;
  $('#btn-speed').textContent = `${speed}×`;
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  const overlay = !$('#start').classList.contains('hidden')
    ? $('#start')
    : (!$('#end').classList.contains('hidden') ? $('#end') : null);
  if (!overlay) return;
  const items = [...overlay.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')]
    .filter((el) => el.offsetParent !== null);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) {
    if (e.key === 'Escape') e.target.blur();
    return;
  }
  if (!$('#start').classList.contains('hidden') || !$('#end').classList.contains('hidden')) return;
  if (e.target instanceof Element && e.target.closest('button, select, a, [role="button"]')) return;
  if (e.key === ' ') {
    e.preventDefault();
    $('#btn-pause').click();
  } else if (e.key === '1' || e.key === '2' || e.key === '4') {
    speed = Number(e.key);
    $('#btn-speed').textContent = `${speed}×`;
  } else if (e.key === 'Escape') {
    setSelected(null);
    renderStrips();
  } else if (e.key.toLowerCase() === 'm') {
    toggleMic();
  } else if (e.key.toLowerCase() === 'v') {
    toggleTts();
  } else if (e.key === '/' || e.key === 'Enter') {
    e.preventDefault();
    $('#cmd').focus();
  }
});

// ------------------------------------------------------------------- command
$('#cmd-form').addEventListener('submit', (e) => {
  e.preventDefault();
  transmit($('#cmd').value);
});

function transmit(text, { voice = false } = {}) {
  const raw = String(text || '').trim();
  if (!raw || !engine) return;
  if (voice) engine.log('SYS', `MIC: ${raw}`, engine.mode === 'tracon' ? 'APP' : 'TWR');
  engine.command(raw);
  $('#cmd').value = '';
  renderStrips();
  renderRadio();
  renderQuick();
  updateHeader();
}

// --------------------------------------------------------------- voice (local)
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
const synth = window.speechSynthesis || null;
let recognition = null;
let listening = false;
let ttsOn = true;
let speechCursor = 0;
let liveCursor = 0;
let radioCursor = 0;
let lastAlertText = null;
let voiceToastTimer = null;
let voices = [];

function loadVoices() {
  if (!synth) return;
  voices = synth.getVoices() || [];
}
if (synth) {
  loadVoices();
  synth.addEventListener?.('voiceschanged', loadVoices);
}

function resetSpeechCursor() {
  speechCursor = engine ? engine.radio.length : 0;
  liveCursor = engine ? engine.radio.length : 0;
}

function resetRadioLog() {
  radioCursor = 0;
  const box = $('#radio');
  if (box) box.replaceChildren();
}

function showVoiceToast(text, tone = 'error', ms = 9000) {
  const el = $('#voice-toast');
  if (!el) return;
  el.textContent = text;
  el.classList.remove('hidden');
  el.classList.toggle('ok', tone === 'ok');
  if (voiceToastTimer) clearTimeout(voiceToastTimer);
  voiceToastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}

function hideVoiceToast() {
  const el = $('#voice-toast');
  if (el) el.classList.add('hidden');
  if (voiceToastTimer) clearTimeout(voiceToastTimer);
  voiceToastTimer = null;
}

function voiceError(code) {
  const message = speechErrorMessage(code, settings.lang);
  if (!message) return;
  showVoiceToast(message);
  if (engine) engine.log('SYS', `MIC: ${message}`, engine.mode === 'tracon' ? 'APP' : 'TWR');
}

function speak(text) {
  if (!ttsOn || !synth || !text) return;
  if (listening) stopMic();
  const spoken = phoneticSpeech(text);
  if (!spoken) return;
  const u = new SpeechSynthesisUtterance(spoken);
  const lang = speechLang(settings.lang);
  const prefix = lang.slice(0, 2);
  const preferred = voices.find((v) => String(v.lang).toLowerCase().startsWith(prefix) && /(david|mark|alex|guy|male|jorge|diego|carlos|pablo|enrique|raul)/i.test(v.name))
    || voices.find((v) => String(v.lang).toLowerCase().startsWith(prefix));
  if (preferred) u.voice = preferred;
  u.lang = lang;
  u.rate = 1.04;
  u.pitch = 0.92;
  u.volume = 0.9;
  synth.speak(u);
}

function speakNewPilot() {
  if (!engine || !ttsOn) {
    if (engine) speechCursor = engine.radio.length;
    return;
  }
  if (speechCursor > engine.radio.length) speechCursor = engine.radio.length;
  for (let i = speechCursor; i < engine.radio.length; i++) {
    const entry = engine.radio[i];
    if (entry.from === 'PILOT') speak(entry.text);
  }
  speechCursor = engine.radio.length;
}

function updateTtsButton() {
  $('#btn-tts').textContent = ttsOn ? tr('voiceOn') : tr('voiceOff');
  $('#btn-tts').title = tr('pilotVoices');
  $('#btn-tts').classList.toggle('off', !ttsOn);
}

function updatePauseButton() {
  const btn = $('#btn-pause');
  if (!btn) return;
  btn.textContent = paused ? '▶' : '❚❚';
  const key = paused ? 'resume' : 'pause';
  btn.title = tr(key);
  btn.setAttribute('aria-label', tr(key));
}

function toggleTts() {
  ttsOn = !ttsOn;
  if (!ttsOn && synth) synth.cancel();
  if (ttsOn) resetSpeechCursor();
  updateTtsButton();
}

if (SpeechRec) {
  recognition = new SpeechRec();
  recognition.lang = speechLang(settings.lang);
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;
  recognition.onstart = () => {
    listening = true;
    $('#btn-mic').classList.add('listening');
    $('#btn-mic').textContent = tr('listening');
    $('#btn-mic').setAttribute('aria-pressed', 'true');
    hideVoiceToast();
    if (synth) synth.cancel();
  };
  recognition.onend = () => {
    listening = false;
    $('#btn-mic').classList.remove('listening');
    $('#btn-mic').textContent = 'MIC';
    $('#btn-mic').setAttribute('aria-pressed', 'false');
  };
  recognition.onerror = (event) => {
    listening = false;
    $('#btn-mic').classList.remove('listening');
    $('#btn-mic').textContent = 'MIC';
    $('#btn-mic').setAttribute('aria-pressed', 'false');
    voiceError(event?.error || event?.message || 'unknown');
  };
  recognition.onresult = (event) => {
    const { interim, final } = transcriptsFromSpeechEvent(event);
    if (interim) $('#cmd').value = interim;
    if (final) {
      $('#cmd').value = final;
      hideVoiceToast();
      transmit(final, { voice: true });
    }
  };
} else {
  $('#btn-mic').disabled = true;
  $('#btn-mic').title = tr('micTitleUnsupported');
  $('#btn-mic').setAttribute('aria-label', tr('micTitleUnsupported'));
}

if (recognition && navigator.brave?.isBrave) {
  navigator.brave.isBrave()
    .then((isBrave) => {
      if (isBrave) {
        const mic = $('#btn-mic');
        mic.dataset.braveHint = '1';
        mic.title = tr('braveHint');
        mic.setAttribute('aria-label', tr('braveHint'));
      }
    })
    .catch(() => {});
}

function startMic() {
  if (!recognition) {
    showVoiceToast(tr('micUnsupported'));
    return;
  }
  if (typeof window.isSecureContext === 'boolean' && !window.isSecureContext) {
    showVoiceToast(tr('micSecure'));
    return;
  }
  recognition.lang = speechLang(settings.lang);
  if (synth) synth.cancel();
  try {
    recognition.start();
  } catch (err) {
    showVoiceToast(tr('micStartError', { message: err?.message || err }));
  }
}

function stopMic() {
  if (!recognition || !listening) return;
  try {
    recognition.stop();
  } catch {
    // ignore
  }
}

function toggleMic() {
  if (!recognition) {
    showVoiceToast(tr('micUnsupported'));
    return;
  }
  if (listening) stopMic();
  else startMic();
}

$('#btn-mic').addEventListener('click', toggleMic);
$('#btn-tts').addEventListener('click', toggleTts);
updateTtsButton();

function commandFor(ac, cmd) {
  return `${ac.callsign} ${cmd}`;
}

// ------------------------------------------------------------------ rendering
function stopLoop() {
  if (raf) cancelAnimationFrame(raf);
  raf = null;
}

function frame(ts) {
  if (!engine) return;
  const realDt = Math.min(0.1, Math.max(0, (ts - lastTs) / 1000));
  lastTs = ts;

  if (!engine.finished && !engine.paused) {
    let remaining = realDt * speed;
    let guard = 0;
    while (remaining > 0 && guard++ < 20) {
      const step = Math.min(0.1, remaining);
      engine.tick(step);
      remaining -= step;
    }
  }

  if (renderer) renderer.selectedId = selectedId;
  renderer.draw();

  if (ts - lastUi > 180) {
    lastUi = ts;
    updateHeader();
    renderStrips();
    renderRadio();
    renderQuick();
    renderAlert();
    speakNewPilot();
  }

  if (engine.finished) {
    if (!endShown) showEnd();
    raf = null;
    return;
  }
  raf = requestAnimationFrame(frame);
}

function updateHeader() {
  if (!engine) return;
  $('#clock').textContent = engine.clock();
  $('#clock').title = tr('secondsRemaining', { count: Math.ceil(engine.remaining()) });
  const pending = engine.pendingCalls().length;
  const badge = $('#pending-badge');
  badge.textContent = pending === 1 ? tr('waitingOne') : tr('waiting', { count: pending });
  badge.classList.toggle('alert', pending > 0);
}

const PHASE_LABEL = {
  parked: 'AT GATE',
  taxi: 'TAXI',
  holding: 'HOLD SHORT',
  crossing: 'HOLD RWY 12',
  lineup: 'LINE UP',
  lined_up: 'LINED UP',
  takeoff: 'ROLLING',
  final: 'INBOUND',
  rollout: 'LANDING',
  abort: 'ABORT',
  aborted: 'STOPPED',
  abortTaxi: 'TAXI CLEAR',
  goAround: 'GO AROUND',
  ground: 'AWAIT TAXI',
  taxiRamp: 'TAXI RAMP',
  cruise: 'ENROUTE',
  approach: 'APPROACH',
  departed: 'DEPARTED',
  done: 'DONE',
};

const PHASE_LABEL_ES = {
  parked: 'EN PUERTA',
  taxi: 'RODANDO',
  holding: 'ESPERA',
  crossing: 'ESPERA P12',
  lineup: 'ALINEAR',
  lined_up: 'ALINEADO',
  takeoff: 'CARRERA',
  final: 'ENTRANDO',
  rollout: 'ATERRIZANDO',
  abort: 'ABORTA',
  aborted: 'DETENIDO',
  abortTaxi: 'DESPEJANDO',
  goAround: 'FRUSTRADA',
  ground: 'ESPERA RODAJE',
  taxiRamp: 'A PLATAFORMA',
  cruise: 'EN RUTA',
  approach: 'APROXIMACIÓN',
  departed: 'SALIÓ',
  done: 'LISTO',
};

const stripNodes = new Map();
let stripOrder = '';

function resetStrips() {
  stripNodes.clear();
  stripOrder = '';
  const list = $('#strips');
  if (list) list.replaceChildren();
}

function createStripNode() {
  const el = document.createElement('div');
  el.className = 'strip';
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  const top = document.createElement('div');
  top.className = 'strip-top';
  const cs = document.createElement('span');
  cs.className = 'strip-cs';
  const type = document.createElement('span');
  type.className = 'strip-type';
  const status = document.createElement('span');
  status.className = 'strip-status';
  top.append(cs, type, status);
  const sub = document.createElement('div');
  sub.className = 'strip-sub';
  const subText = document.createElement('span');
  sub.append(subText);
  el.append(top, sub);
  el._cs = cs;
  el._type = type;
  el._status = status;
  el._sub = subText;
  return el;
}

function updateStripNode(el, ac, { sub, phaseLabel, callLabel, selected }) {
  const sig = [ac.callsign, ac.type.code, ac.wake, ac.kind, phaseLabel, sub, callLabel, selected].join('\u0001');
  if (el._sig === sig) return;
  el._sig = sig;
  el.dataset.id = String(ac.id);
  el.classList.toggle('arrival', ac.kind === 'arrival');
  el.classList.toggle('selected', selected);
  el.setAttribute('aria-label', `${ac.callsign} ${ac.type.code} ${phaseLabel}`);
  el._cs.textContent = ac.callsign;
  el._type.textContent = `${ac.type.code} · ${ac.wake}`;
  el._status.textContent = phaseLabel;
  el._sub.textContent = sub;
  let callEl = el.querySelector('.strip-call');
  if (callLabel) {
    if (!callEl) {
      callEl = document.createElement('div');
      callEl.className = 'strip-call';
      el.append(callEl);
    }
    callEl.textContent = callLabel;
  } else if (callEl) {
    callEl.remove();
  }
}

function renderStrips() {
  if (!engine) return;
  const list = $('#strips');
  const active = engine.activeAircraft();
  const order = { final: 0, holding: 1, lined_up: 2, takeoff: 3, rollout: 4, abort: 5, goAround: 6, lineup: 7, taxi: 8, taxiRamp: 9, ground: 10, parked: 11 };
  const rows = active
    .slice()
    .sort((a, b) => {
      const pa = a.call && !a.call.answered ? -1 : order[a.phase] ?? 20;
      const pb = b.call && !b.call.answered ? -1 : order[b.phase] ?? 20;
      return pa - pb || a.id - b.id;
    });

  const labels = isEs() ? PHASE_LABEL_ES : PHASE_LABEL;
  const focusedId = document.activeElement?.closest?.('.strip')?.dataset.id;
  const seen = new Set();
  for (const ac of rows) {
    let el = stripNodes.get(ac.id);
    if (!el) {
      el = createStripNode();
      stripNodes.set(ac.id, el);
    }
    const sub = engine.mode === 'tracon'
      ? `${Math.round(ac.alt)} ft · ${Math.round(ac.speed)} kt${ac.cleared ? (isEs() ? ' · autorizado' : ' · cleared') : ''}`
      : ac.kind === 'departure'
        ? `${ac.gate ? ac.gate.id : '—'} · ${isEs() ? 'PISTA' : 'RWY'} ${engine.geo.runway}`
        : ac.phase === 'final' || ac.phase === 'goAround'
          ? `${ac.inboundNm ?? '—'} NM · ${Math.round(ac.alt)} ft`
          : `${ac.gate ? ac.gate.id : '—'} · ${Math.round(ac.speed / 0.514444)} kt`;
    const callLabel = ac.call && !ac.call.answered ? ac.call.text : '';
    const closeFinal = ac.phase === 'final' && Math.abs(ac.x - engine.geo.touchdownX) < 1500;
    const phaseLabel = closeFinal ? (isEs() ? 'FINAL CORTA' : 'SHORT FINAL') : (labels[ac.phase] || ac.phase);
    updateStripNode(el, ac, {
      sub,
      phaseLabel,
      callLabel,
      selected: ac.id === selectedId,
    });
    seen.add(ac.id);
  }

  for (const [id, el] of stripNodes) {
    if (!seen.has(id)) {
      el.remove();
      stripNodes.delete(id);
    }
  }

  const nextOrder = rows.map((ac) => ac.id).join(',');
  if (nextOrder !== stripOrder) {
    for (const ac of rows) list.append(stripNodes.get(ac.id));
    stripOrder = nextOrder;
    if (focusedId) {
      list.querySelector(`.strip[data-id="${focusedId}"]`)?.focus({ preventScroll: true });
    }
  }

  $('#strip-count').textContent = String(active.length);
}

$('#strips').addEventListener('click', (e) => {
  const el = e.target.closest('.strip');
  if (!el) return;
  const id = Number(el.dataset.id);
  setSelected(selectedId === id ? null : id);
  const ac = engine?.activeAircraft().find((a) => a.id === id);
  if (ac) $('#cmd').value = `${ac.callsign} `;
  renderStrips();
  renderQuick();
  $('#cmd').focus();
});

$('#strips').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const el = e.target.closest('.strip');
  if (!el) return;
  e.preventDefault();
  e.stopPropagation();
  el.click();
});

function radioLineNode(entry) {
  const who = entry.from === 'ATC' ? (engine.mode === 'tracon' ? 'APP' : 'TWR') : entry.from === 'PILOT' ? 'PILOT' : 'SYS';
  const cls = entry.from === 'ATC' ? 'atc' : entry.from === 'PILOT' ? 'pilot' : 'sys';
  const t = `${String(Math.floor(entry.t / 60)).padStart(2, '0')}:${String(Math.floor(entry.t % 60)).padStart(2, '0')}`;
  const line = document.createElement('div');
  line.className = `line ${cls}`;
  const time = document.createElement('span');
  time.className = 't';
  time.textContent = t;
  const speaker = document.createElement('span');
  speaker.className = 'who';
  speaker.textContent = who;
  const text = document.createElement('span');
  text.className = 'txt';
  text.textContent = entry.text;
  line.append(time, speaker, text);
  return line;
}

function renderRadio() {
  if (!engine) return;
  if (liveCursor > engine.radio.length) liveCursor = engine.radio.length;
  const freshPilot = engine.radio.slice(liveCursor).filter((r) => r.from === 'PILOT');
  if (freshPilot.length) {
    const live = $('#live-radio');
    if (live) live.textContent = freshPilot.map((r) => r.text).join(' ');
  }
  liveCursor = engine.radio.length;

  const box = $('#radio');
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  let appended = false;
  for (const entry of engine.radio) {
    if ((entry.seq ?? 0) <= radioCursor) continue;
    box.append(radioLineNode(entry));
    radioCursor = entry.seq;
    appended = true;
  }
  if (appended && nearBottom) box.scrollTop = box.scrollHeight;
}

function renderQuick() {
  if (!engine) return;
  const box = $('#quick');
  const ac = engine.activeAircraft().find((a) => a.id === selectedId);
  if (!ac) {
    const pending = engine.pendingCalls()[0];
    if (pending) {
      box.innerHTML = `<button data-cmd="${esc(commandFor(pending, ui('say again', 'repita')))}">${ui('Say again to', 'Repita a')} ${esc(pending.callsign)}</button>`;
      bindQuick();
    } else {
      box.innerHTML = '';
    }
    return;
  }

  if (engine.mode === 'tracon') {
    const cmds = [];
    if (ac.kind === 'arrival') {
      cmds.push([ui('Turn left 30', 'Gire a la izquierda'), ui('turn left', 'gire a la izquierda')]);
      cmds.push([ui('Turn right 30', 'Gire a la derecha'), ui('turn right', 'gire a la derecha')]);
      const alt = ac.alt > 4500 ? 3000 : 2000;
      cmds.push([ui(`Descend ${alt}`, `Descienda ${alt}`), ui(`descend and maintain ${alt}`, `descienda y mantenga ${alt}`)]);
      if (!ac.cleared) cmds.push([ui('Cleared ILS', 'Autorizado ILS'), ui('cleared ILS', 'autorizado ILS')]);
      if (ac.onApproach) cmds.push([ui('Contact tower', 'Contacte torre'), ui('contact tower', 'contacte torre')]);
      cmds.push([ui('Go around', 'Frustrada'), ui('go around', 'frustrada')]);
    } else {
      cmds.push([ui('Turn left 30', 'Gire a la izquierda'), ui('turn left', 'gire a la izquierda')]);
      cmds.push([ui('Turn right 30', 'Gire a la derecha'), ui('turn right', 'gire a la derecha')]);
      cmds.push([ui('Climb 6000', 'Ascienda 6000'), ui('climb and maintain 6000', 'ascienda y mantenga 6000')]);
      cmds.push([ui('Contact center', 'Contacte centro'), ui('contact center', 'contacte centro')]);
    }
    cmds.push([ui('Say again', 'Repita'), ui('say again', 'repita')]);
    box.innerHTML = cmds
      .map(([label, cmd]) => `<button data-cmd="${esc(commandFor(ac, cmd))}">${esc(label)} · ${esc(ac.callsign)}</button>`)
      .join('');
    bindQuick();
    return;
  }

  const cmds = [];
  if (ac.phase === 'crossing') cmds.push([ui('Cross runway 12', 'Cruce la pista 12'), ui('cross runway 12', 'cruce la pista 12')]);
  if (ac.kind === 'departure') {
    if (['parked', 'taxi', 'holding'].includes(ac.phase)) cmds.push([ui('Taxi to runway', 'Ruede a la pista'), ui('taxi to runway', 'ruede a la pista')]);
    if (ac.phase === 'holding') {
      cmds.push([ui('Line up and wait', 'Alinéese y espere'), ui('line up and wait', 'alinéese y espere')]);
      cmds.push([ui('Cleared for takeoff', 'Autorizado para despegar'), ui('cleared for takeoff', 'autorizado para despegar')]);
    }
    if (ac.phase === 'lined_up') cmds.push([ui('Cleared for takeoff', 'Autorizado para despegar'), ui('cleared for takeoff', 'autorizado para despegar')]);
    if (ac.phase === 'takeoff') cmds.push([ui('Cancel takeoff', 'Cancele el despegue'), ui('cancel takeoff', 'cancele el despegue')]);
    if (ac.phase === 'aborted') cmds.push([ui('Taxi to ramp', 'Ruede a la plataforma'), ui('taxi to the ramp', 'ruede a la plataforma')]);
    if (!['takeoff', 'airborne', 'aborted', 'abortTaxi'].includes(ac.phase)) cmds.push([ui('Hold short', 'Alto antes'), ui('hold short', 'alto antes de la pista')]);
  } else {
    if (ac.phase === 'final') {
      cmds.push([ui('Cleared to land', 'Autorizado para aterrizar'), ui('cleared to land', 'autorizado para aterrizar')]);
      cmds.push([ui('Go around', 'Frustrada'), ui('go around', 'frustrada')]);
    }
    if (ac.phase === 'ground') cmds.push([ui('Taxi to ramp', 'Ruede a la plataforma'), ui('taxi to the ramp', 'ruede a la plataforma')]);
  }
  cmds.push([ui('Say again', 'Repita'), ui('say again', 'repita')]);

  box.innerHTML = cmds
    .map(([label, cmd]) => `<button data-cmd="${esc(commandFor(ac, cmd))}">${esc(label)} · ${esc(ac.callsign)}</button>`)
    .join('');
  bindQuick();
}

function bindQuick() {
  for (const b of $('#quick').querySelectorAll('button')) {
    b.addEventListener('click', () => transmit(b.dataset.cmd));
  }
}

function renderAlert() {
  if (!engine) return;
  const el = $('#scope-alert');
  const recent = engine.incidents.filter((i) => engine.t - i.t < 6).slice(-1)[0];
  let text = '';
  if (recent) {
    text = recent.text.toUpperCase();
  } else if (engine.runwayOccupied()) {
    text = tr('alertRunwayOccupied', { rwy: engine.geo.runway });
  } else {
    const pending = engine.pendingCalls().length;
    if (pending) text = pending === 1 ? tr('alertCallsOne') : tr('alertCalls', { count: pending });
  }
  if (text === lastAlertText) return;
  lastAlertText = text;
  if (!text) {
    el.classList.add('hidden');
    return;
  }
  el.textContent = text;
  el.classList.remove('hidden');
}

// ----------------------------------------------------------------- end screen
function showEnd() {
  endShown = true;
  const score = engine.score || engine.computeScore();
  $('#grade').textContent = score.grade;
  $('#total').textContent = `${score.total} / 100`;
  const gradeKeys = { 'A+': 'gradeAp', A: 'gradeA', B: 'gradeB', C: 'gradeC', D: 'gradeD', F: 'gradeF' };
  $('#grade-note').textContent = tr(gradeKeys[score.grade] || 'gradeF');

  $('#score-parts').innerHTML = score.parts
    .map((p) => {
      const pct = Math.max(0, Math.min(100, (p.points / p.max) * 100));
      return `<div class="part">
        <div>${esc(p.label)}</div>
        <div class="part-bar"><i style="width:${pct}%"></i></div>
        <div class="part-val">${p.points}/${p.max}</div>
        <div class="part-note">${p.notes.map(esc).join(' · ')}</div>
      </div>`;
    })
    .join('');

  const incidents = score.incidents;
  $('#incident-list').innerHTML = incidents.length
    ? incidents
        .map((i) => {
          const t = `${String(Math.floor(i.t / 60)).padStart(2, '0')}:${String(Math.floor(i.t % 60)).padStart(2, '0')}`;
          return `<li>${t} · ${esc(i.text)}</li>`;
        })
        .join('')
    : `<li class="none">${esc(tr('noIncidents'))}</li>`;

  const objectives = score.objectives || [];
  $('#objectives-wrap').classList.toggle('hidden', !objectives.length);
  $('#objectives').innerHTML = objectives
    .map((o) => `<li class="${o.ok ? 'ok' : 'fail'}">${esc(o.label)} — ${o.ok ? esc(tr('met')) : esc(tr('missed'))}</li>`)
    .join('');

  const kicker = document.querySelector('#end .modal-kicker');
  if (kicker) kicker.textContent = `${tr('debrief')} · ${scenarioName(activeScenario || scenarioById('free'), settings.lang).toUpperCase()}`;

  const effectiveDifficulty = engine?.difficulty?.id || settings.difficulty;
  const scenarioId = activeScenario?.id || settings.scenarioId;
  const key = bestScoreKey(scenarioId, effectiveDifficulty);
  const best = Number(safeGet(key, '0')) || 0;
  if (score.total > best) safeSet(key, String(score.total));

  $('#end').classList.remove('hidden');
  $('#app').inert = true;
  requestAnimationFrame(() => $('#end .modal').focus());
}

// --------------------------------------------------------------------- canvas
canvas.addEventListener('pointerdown', (e) => {
  if (!engine) return;
  const rect = canvas.getBoundingClientRect();
  const ac = renderer.pick(e.clientX - rect.left, e.clientY - rect.top);
  setSelected(ac ? (selectedId === ac.id ? null : ac.id) : null);
  if (ac && ac.id === selectedId) $('#cmd').value = `${ac.callsign} `;
  renderStrips();
  renderQuick();
  if (selectedId) $('#cmd').focus();
});

const ro = new ResizeObserver(() => {
  renderer.resize();
  renderer.draw();
});
ro.observe(canvas);
window.addEventListener('resize', () => {
  renderer.resize();
  renderer.draw();
});

document.addEventListener('visibilitychange', () => {
  if (!engine || engine.finished) return;
  if (document.hidden) {
    paused = true;
    engine.paused = true;
    updatePauseButton();
  }
});

// PWA: installable, offline shell + update prompt.
const hadServiceWorkerController = 'serviceWorker' in navigator && !!navigator.serviceWorker.controller;

$('#btn-reload').addEventListener('click', () => window.location.reload());

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadServiceWorkerController) $('#update-toast').classList.remove('hidden');
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

// Init
renderer.resize();
applyLanguage(settings.lang, { persist: false });
if (!safeGet('opentower.onboarded')) $('#howto').open = true;
applyScenario('free');
requestAnimationFrame(() => $('#start .modal').focus());

// Test hook, only when explicitly requested with ?debug.
if (new URLSearchParams(location.search).has('debug')) {
  window.__opentower = {
    get engine() { return engine; },
    get renderer() { return renderer; },
    isRunning: () => raf !== null,
    finish: () => engine?.finish(),
  };
}
