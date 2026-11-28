import assert from 'node:assert/strict';
import fs from 'node:fs';
import { STRINGS, t, createTranslator, applyLanguage, applyStaticI18n, isSpanish, pickLanguage } from '../src/i18n.js';
import { SCENARIOS, scenarioById, scenarioName, scenarioDescription } from '../src/scenarios.js';

assert.deepEqual(Object.keys(STRINGS.en).sort(), Object.keys(STRINGS.es).sort(), 'EN/ES dictionaries have the same keys');

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const htmlKeys = [...html.matchAll(/data-i18n(?:-html|-placeholder|-title|-aria-label)?="([^"]+)"/g)].map((m) => m[1]);
for (const key of htmlKeys) {
  assert.ok(STRINGS.en[key], `index.html i18n key exists: ${key}`);
}

assert.equal(t('en', 'waiting', { count: 3 }), '3 waiting');
assert.equal(t('es', 'waiting', { count: 3 }), '3 en espera');
assert.equal(t('en', 'secondsRemaining', { count: 42 }), '42 s remaining');
assert.equal(t('es', 'secondsRemaining', { count: 42 }), '42 s restantes');
assert.equal(t('es', 'startShift'), 'EMPEZAR TURNO →');
assert.equal(t('es', 'noIncidents'), 'Sin incidentes. Turno limpio.');
assert.equal(t('fr', 'startShift'), 'START FREE SHIFT →', 'unknown language falls back to English');
assert.equal(t('es', 'missing-key'), 'missing-key');
assert.equal(isSpanish('es'), true);
assert.equal(isSpanish('en'), false);
assert.equal(pickLanguage('es', 'Hello', 'Hola'), 'Hola');
assert.equal(pickLanguage('fr', 'Hello', 'Hola'), 'Hello');
const tr = createTranslator(() => 'es');
assert.equal(tr('startShift'), 'EMPEZAR TURNO →');

// applyLanguage is dependency-injected so the language contract can be tested
// without a browser. A fake root returns no elements and records nothing.
{
  const fakeRoot = {
    documentElement: { lang: 'en' },
    title: '',
    querySelectorAll: () => [],
    querySelector: () => null,
  };
  const settings = { lang: 'en' };
  let chip = null;
  let applied = null;
  let persisted = null;
  const result = applyLanguage('es', {
    settings,
    root: fakeRoot,
    paused: false,
    selectChip: (lang) => { chip = lang; },
    onApply: (lang) => { applied = lang; },
    persistLanguage: (lang) => { persisted = lang; },
  });
  assert.equal(result, 'es');
  assert.equal(settings.lang, 'es');
  assert.equal(chip, 'es');
  assert.equal(applied, 'es');
  assert.equal(persisted, 'es');
  assert.equal(fakeRoot.documentElement.lang, 'es');
  assert.equal(fakeRoot.title, STRINGS.es.appTitle);
}
{
  const fakeRoot = {
    documentElement: { lang: 'en' },
    title: '',
    querySelectorAll: () => [],
    querySelector: () => null,
  };
  const settings = { lang: 'es' };
  let persisted = false;
  applyLanguage('fr', {
    settings,
    root: fakeRoot,
    persist: false,
    persistLanguage: () => { persisted = true; },
  });
  assert.equal(settings.lang, 'en', 'unknown languages fall back to English');
  assert.equal(persisted, false, 'persist:false suppresses storage writes');
}
assert.doesNotThrow(() => applyStaticI18n('en', { root: null }));

assert.equal(scenarioName(scenarioById('free'), 'es'), 'Turno libre');
assert.match(scenarioDescription(scenarioById('tracon'), 'es'), /vectoriza/i);
for (const scenario of SCENARIOS) {
  assert.ok(scenario.nameEs, `${scenario.id} has a Spanish name`);
  assert.ok(scenario.descriptionEs, `${scenario.id} has a Spanish description`);
}

console.log('OpenTower i18n checks passed');
