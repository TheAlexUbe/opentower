import assert from 'node:assert/strict';
import fs from 'node:fs';
import { STRINGS, t } from '../src/i18n.js';
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

assert.equal(scenarioName(scenarioById('free'), 'es'), 'Turno libre');
assert.match(scenarioDescription(scenarioById('tracon'), 'es'), /vectoriza/i);
for (const scenario of SCENARIOS) {
  assert.ok(scenario.nameEs, `${scenario.id} has a Spanish name`);
  assert.ok(scenario.descriptionEs, `${scenario.id} has a Spanish description`);
}

console.log('OpenTower i18n checks passed');
