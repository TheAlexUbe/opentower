/**
 * OpenTower UI and game-loop orchestration.
 *
 * Owns the browser UI, canvas renderers, radio/strip updates and the fixed-step
 * animation clock. Engine and renderer implementations are injected by the
 * composition root in `main.js`; simulation rules stay in the engine modules.
 */

import { AIRPORT } from './config.js';
import { SCENARIOS, scenarioById, scenarioName, scenarioTagline, scenarioDescription } from './scenarios.js';
import { effectiveScenarioSettings, bestScoreKey } from './scenario-state.js';
import { createTranslator, applyLanguage, isSpanish, pickLanguage } from './i18n.js';
import { preferredRadioLang, VoiceController } from './voice.js';
import { fetchWeather } from './weather.js';

/**
 * Create and start the browser app.
 *
 * @param {{
 *   document?: Document,
 *   window?: Window,
 *   createEngine: (mode: 'tower'|'tracon', options: object) => object,
 *   createRenderer: (mode: 'tower'|'tracon', canvas: HTMLCanvasElement) => object,
 * }} options
 * @returns {object} App handle (also exposed as window.__opentower with ?debug).
 */
export function createApp({
  document: doc = globalThis.document,
  window: win = globalThis.window,
  createEngine,
  createRenderer,
} = {}) {
  if (!doc || !win) throw new Error('createApp requires a browser document and window');
  if (typeof createEngine !== 'function' || typeof createRenderer !== 'function') {
    throw new TypeError('createApp requires createEngine and createRenderer factories');
  }

  const storage = (() => {
    try {
      return win.localStorage;
    } catch {
      return null;
    }
  })();
  const requestFrame = (cb) => win.requestAnimationFrame(cb);
  const cancelFrame = (id) => win.cancelAnimationFrame(id);

  const $ = (sel) => doc.querySelector(sel);
  const canvas = $('#scope');
  let renderer = canvas ? createRenderer('tower', canvas) : null;

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
      return storage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  };

  const safeSet = (key, value) => {
    try {
      storage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  };

  const storedLang = safeGet('opentower.lang', null);
  settings.lang = preferredRadioLang(storedLang, win.navigator.language);

  const isEs = () => isSpanish(settings.lang);
  const ui = (en, es) => pickLanguage(settings.lang, en, es);
  const tr = createTranslator(() => settings.lang);

  function setSelected(id) {
    selectedId = id;
    if (renderer) renderer.selectedId = selectedId;
  }

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

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
    applyUiLanguage(b.dataset.lang);
  });

  /**
   * App-side language switch: i18n.js owns the state/static DOM, while this
   * callback refreshes live simulation and speech surfaces.
   *
   * @param {'en'|'es'} lang - Target language.
   * @param {{persist?: boolean}} [options] - Persist the choice to localStorage.
   */
  function applyUiLanguage(lang, { persist = true } = {}) {
    return applyLanguage(lang, {
      settings,
      root: doc,
      paused,
      persist,
      selectChip: (next) => selectChip(langChips, 'lang', next),
      persistLanguage: (next) => safeSet('opentower.lang', next),
      onApply: (next) => {
        populateScenarioOptions();
        applyScenario(settings.scenarioId);
        voice.setLanguage(next);
        voice.updateTtsButton();
        if (engine) {
          setWxLine(engine.weather, engine);
          renderStrips();
          renderQuick();
          updateHeader();
          renderAlert();
        }
      },
    });
  }

  const scenarioSelect = $('#scenario-select');

  function populateScenarioOptions() {
    const selected = settings.scenarioId;
    scenarioSelect.replaceChildren();
    for (const s of SCENARIOS) {
      const opt = doc.createElement('option');
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

  function startButtonKey(s = scenarioById(settings.scenarioId)) {
    if (s.id === 'free') return 'startShift';
    return s.mode === 'tracon' ? 'startApproach' : 'startScenario';
  }

  function updateStartButton(s = scenarioById(settings.scenarioId)) {
    const button = $('#btn-start');
    if (button) button.textContent = tr(startButtonKey(s));
  }

  function applyScenario(id) {
    const s = scenarioById(id);
    settings.scenarioId = s.id;
    scenarioSelect.value = s.id;
    $('#scenario-desc').textContent = scenarioDescription(s, settings.lang);
    updateStartButton(s);
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

  // Mobile-only tabs keep the scope usable without splitting the side panel
  // into two tiny scroll areas. Desktop keeps both panels visible via CSS.
  const sideTabs = [$('#tab-strips'), $('#tab-radio')].filter(Boolean);
  const sidePanels = { strips: $('#panel-strips'), radio: $('#panel-radio') };

  function setSideTab(name) {
    const next = name === 'radio' ? 'radio' : 'strips';
    for (const tab of sideTabs) {
      const active = tab.id === `tab-${next}`;
      tab.classList.toggle('on', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    }
    for (const [key, panel] of Object.entries(sidePanels)) {
      panel?.classList.toggle('active', key === next);
    }
  }

  for (const tab of sideTabs) {
    tab.addEventListener('click', () => setSideTab(tab.id === 'tab-radio' ? 'radio' : 'strips'));
    tab.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const current = sideTabs.indexOf(tab);
      const delta = e.key === 'ArrowRight' ? 1 : -1;
      const next = sideTabs[(current + delta + sideTabs.length) % sideTabs.length];
      next.focus();
      setSideTab(next.id === 'tab-radio' ? 'radio' : 'strips');
    });
  }
  setSideTab('strips');

  /**
   * Start a shift: fetch weather, build the selected scenario, create the
   * matching engine/renderer pair and start the animation loop.
   */
  async function startShift() {
    const startBtn = $('#btn-start');
    startBtn.disabled = true;
    let weather = null;
    if (settings.liveWx) {
      startBtn.textContent = tr('fetching');
      weather = await fetchWeather({ timeoutMs: 3000 });
    }
    startBtn.textContent = tr(startButtonKey());
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
    engine = createEngine(activeScenario.mode, common);
    renderer = createRenderer(activeScenario.mode, canvas);
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
    $('#cmd').placeholder = tr(engine.mode === 'tracon' ? 'cmdPlaceholderTracon' : 'cmdPlaceholderTower', { runway: engine.geo.runway });
    $('#wind-line').textContent = `${tr('wind')} ${String(engine.wind.dir).padStart(3, '0')}/${String(engine.wind.speed).padStart(2, '0')} · A${engine.altimeter}`;
    if (engine.mode === 'tracon') {
      $('#airport-name').textContent = 'COPPER APPROACH · APP';
      $('#freq-twr').textContent = '124.2';
      $('#freq-gnd').textContent = '—';
      $('#scope').setAttribute('aria-label', tr('scopeTraconAria'));
      doc.querySelector('.scope-help').textContent = tr('scopeTracon');
    } else {
      $('#airport-name').textContent = `${AIRPORT.code} · ${AIRPORT.name}`;
      $('#freq-twr').textContent = AIRPORT.tower;
      $('#freq-gnd').textContent = AIRPORT.ground;
      $('#scope').setAttribute('aria-label', tr('scopeTowerAria'));
      doc.querySelector('.scope-help').textContent = tr('scopeTower');
    }
    setWxLine(weather, engine);
    resetRadioLog();
    resetStrips();
    renderStrips();
    renderRadio();
    renderQuick();
    updateHeader();
    voice.resetSpeechCursor();
    $('#cmd').focus();
    lastTs = win.performance.now();
    stopLoop();
    raf = requestFrame(frame);
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
    requestFrame(() => $('#start .modal').focus());
  });
  $('#btn-new').addEventListener('click', () => {
    if (engine) engine.paused = true;
    stopLoop();
    $('#app').inert = true;
    $('#end').classList.add('hidden');
    $('#start').classList.remove('hidden');
    showBest();
    requestFrame(() => $('#start .modal').focus());
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

  doc.addEventListener('keydown', (e) => {
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
    if (e.shiftKey && doc.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && doc.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  doc.addEventListener('keydown', (e) => {
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
      voice.toggleMic();
    } else if (e.key.toLowerCase() === 'v') {
      voice.toggleTts();
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

  /**
   * Submit a controller transmission to the active engine.
   *
   * @param {string} text - Raw clearance or radio phrase.
   * @param {{voice?: boolean}} [options] - Mark the line as microphone input.
   */
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

  let liveCursor = 0;
  let radioCursor = 0;
  let lastAlertText = null;

  function resetRadioLog() {
    radioCursor = 0;
    const box = $('#radio');
    if (box) box.replaceChildren();
  }

  function updatePauseButton() {
    const btn = $('#btn-pause');
    if (!btn) return;
    btn.textContent = paused ? '▶' : '❚❚';
    const key = paused ? 'resume' : 'pause';
    btn.title = tr(key);
    btn.setAttribute('aria-label', tr(key));
  }

  const voice = new VoiceController({
    root: doc,
    getEngine: () => engine,
    getLang: () => settings.lang,
    tr,
    onTransmit: (text, options) => transmit(text, options),
    SpeechRecognition: win.SpeechRecognition || win.webkitSpeechRecognition || null,
    speechSynthesis: win.speechSynthesis || null,
    navigatorObject: win.navigator,
  });

  function commandFor(ac, cmd) {
    return `${ac.callsign} ${cmd}`;
  }

  // ------------------------------------------------------------------ rendering
  function stopLoop() {
    if (raf) cancelFrame(raf);
    raf = null;
  }

  /**
   * requestAnimationFrame callback: advance the simulation and redraw.
   *
   * @param {number} ts - High-resolution frame timestamp in milliseconds.
   */
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
      voice.speakNewPilot();
    }

    if (engine.finished) {
      if (!endShown) showEnd();
      raf = null;
      return;
    }
    raf = requestFrame(frame);
  }

  function updateHeader() {
    if (!engine) return;
    $('#clock').textContent = engine.clock();
    $('#clock').title = tr('secondsRemaining', { count: Math.ceil(engine.remaining()) });
    const pending = engine.pendingCalls().length;
    const badge = $('#pending-badge');
    badge.textContent = pending === 1 ? tr('waitingOne') : tr('waiting', { count: pending });
    badge.classList.toggle('alert', pending > 0);
    const tabPending = $('#tab-pending-count');
    if (tabPending) tabPending.textContent = String(pending);
    $('#tab-radio')?.classList.toggle('alert', pending > 0);
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
    const el = doc.createElement('div');
    el.className = 'strip';
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    const top = doc.createElement('div');
    top.className = 'strip-top';
    const cs = doc.createElement('span');
    cs.className = 'strip-cs';
    const type = doc.createElement('span');
    type.className = 'strip-type';
    const status = doc.createElement('span');
    status.className = 'strip-status';
    top.append(cs, type, status);
    const sub = doc.createElement('div');
    sub.className = 'strip-sub';
    const subText = doc.createElement('span');
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
        callEl = doc.createElement('div');
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
    const focusedId = doc.activeElement?.closest?.('.strip')?.dataset.id;
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
    const tabStrips = $('#tab-strip-count');
    if (tabStrips) tabStrips.textContent = String(active.length);
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
    const freq = String(entry.freq || '').toUpperCase();
    const fallback = engine.mode === 'tracon' ? 'APP' : 'TWR';
    const who = entry.from === 'ATC'
      ? (['GND', 'TWR', 'APP'].includes(freq) ? freq : fallback)
      : entry.from === 'PILOT' ? 'PILOT' : 'SYS';
    const cls = entry.from === 'ATC' ? 'atc' : entry.from === 'PILOT' ? 'pilot' : 'sys';
    const t = `${String(Math.floor(entry.t / 60)).padStart(2, '0')}:${String(Math.floor(entry.t % 60)).padStart(2, '0')}`;
    const line = doc.createElement('div');
    line.className = `line ${cls}`;
    const time = doc.createElement('span');
    time.className = 't';
    time.textContent = t;
    const speaker = doc.createElement('span');
    speaker.className = 'who';
    speaker.textContent = who;
    const text = doc.createElement('span');
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

    const kicker = doc.querySelector('#end .modal-kicker');
    if (kicker) kicker.textContent = `${tr('debrief')} · ${scenarioName(activeScenario || scenarioById('free'), settings.lang).toUpperCase()}`;

    const effectiveDifficulty = engine?.difficulty?.id || settings.difficulty;
    const scenarioId = activeScenario?.id || settings.scenarioId;
    const key = bestScoreKey(scenarioId, effectiveDifficulty);
    const best = Number(safeGet(key, '0')) || 0;
    if (score.total > best) safeSet(key, String(score.total));

    $('#end').classList.remove('hidden');
    $('#app').inert = true;
    requestFrame(() => $('#end .modal').focus());
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

  const ResizeObserverCtor = win.ResizeObserver;
  if (ResizeObserverCtor && canvas) {
    const ro = new ResizeObserverCtor(() => {
      renderer?.resize();
      renderer?.draw();
    });
    ro.observe(canvas);
  }
  win.addEventListener('resize', () => {
    renderer?.resize();
    renderer?.draw();
  });

  doc.addEventListener('visibilitychange', () => {
    if (!engine || engine.finished) return;
    if (doc.hidden) {
      paused = true;
      engine.paused = true;
      updatePauseButton();
    }
  });

  // PWA: installable, offline shell + update prompt.
  const hadServiceWorkerController = 'serviceWorker' in win.navigator && !!win.navigator.serviceWorker.controller;

  $('#btn-reload').addEventListener('click', () => win.location.reload());

  if ('serviceWorker' in win.navigator) {
    win.navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadServiceWorkerController) $('#update-toast').classList.remove('hidden');
    });
    win.addEventListener('load', () => {
      win.navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }

  // Init
  if (renderer) renderer.resize();
  applyUiLanguage(settings.lang, { persist: false });
  if (!safeGet('opentower.onboarded')) $('#howto').open = true;
  applyScenario('free');
  requestFrame(() => $('#start .modal').focus());

  const app = {
    get engine() { return engine; },
    get renderer() { return renderer; },
    get settings() { return settings; },
    isRunning: () => raf !== null,
    startShift,
    finish: () => engine?.finish(),
  };

  // Test hook, only when explicitly requested with ?debug.
  if (new URLSearchParams(win.location.search).has('debug')) win.__opentower = app;
  return app;
  }
