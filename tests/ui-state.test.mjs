import assert from 'node:assert/strict';
import { effectiveScenarioSettings, bestScoreKey } from '../src/scenario-state.js';
import { SCENARIOS, scenarioById } from '../src/scenarios.js';

const free = { duration: 1200, difficulty: 'rush' };

{
  const s = effectiveScenarioSettings(scenarioById('free'), free);
  assert.equal(s.duration, 1200);
  assert.equal(s.difficulty, 'rush');
  assert.equal(s.durationLocked, false);
  assert.equal(s.difficultyLocked, false);
}

{
  const s = effectiveScenarioSettings(scenarioById('first'), free);
  assert.equal(s.duration, 300, 'scripted duration wins');
  assert.equal(s.difficulty, 'calm', 'scripted difficulty wins');
  assert.equal(s.durationLocked, true);
  assert.equal(s.difficultyLocked, true);
}

{
  const partial = { id: 'partial', duration: null, difficulty: 'busy' };
  const s = effectiveScenarioSettings(partial, free);
  assert.equal(s.duration, 1200, 'unspecified duration falls back to free choice');
  assert.equal(s.difficulty, 'busy', 'specified difficulty wins');
  assert.equal(s.durationLocked, false);
  assert.equal(s.difficultyLocked, true);
}

for (const scenario of SCENARIOS) {
  if (scenario.duration != null) {
    assert.ok(
      [300, 600, 1200].includes(scenario.duration),
      `${scenario.id} duration must match a visible chip (${scenario.duration})`,
    );
  }
}

assert.equal(bestScoreKey('north', 'calm'), 'opentower.best.north.calm');

console.log('OpenTower scenario-state checks passed');

// Speech-recognition diagnostics are user-facing and testable.
{
  const { preferredRadioLang, speechErrorMessage, speechLang } = await import('../src/voice.js');
  assert.match(speechErrorMessage('network'), /Brave|Chrome/i);
  assert.match(speechErrorMessage('not-allowed'), /permission/i);
  assert.match(speechErrorMessage('audio-capture'), /microphone/i);
  assert.match(speechErrorMessage('weird-code'), /weird-code/);
  assert.equal(speechErrorMessage('aborted'), '');
  assert.equal(speechLang('en'), 'en-US');
  assert.equal(speechLang('es'), 'es-ES');
  assert.match(speechErrorMessage('network', 'es'), /Servicio|Brave/i);
  assert.match(speechErrorMessage('not-allowed', 'es'), /Permiso/i);
  assert.match(speechErrorMessage('language-not-supported', 'es'), /español/i);
  assert.match(speechErrorMessage('weird-code', 'es'), /reconocimiento/i);
  assert.equal(speechErrorMessage('aborted', 'es'), '');
  assert.equal(preferredRadioLang(null, 'es-MX'), 'es');
  assert.equal(preferredRadioLang(null, 'en-US'), 'en');
  assert.equal(preferredRadioLang('en', 'es-ES'), 'en', 'saved choice wins');
  assert.equal(preferredRadioLang('es', 'en-US'), 'es', 'saved choice wins');
  assert.equal(preferredRadioLang('fr', 'en-GB'), 'en');
}

console.log('OpenTower voice-diagnostics checks passed');

// Speech recognition event parsing (interim/final, resultIndex, empty events).
{
  const { transcriptsFromSpeechEvent } = await import('../src/voice.js');
  const interim = Object.assign([{ transcript: 'N123' }], { isFinal: false });
  const final = Object.assign([{ transcript: ' taxi to runway 27' }], { isFinal: true });
  assert.deepEqual(
    transcriptsFromSpeechEvent({ resultIndex: 0, results: [interim, final] }),
    { interim: 'N123', final: 'taxi to runway 27' },
  );
  const ignored = Object.assign([{ transcript: 'old final' }], { isFinal: true });
  assert.deepEqual(
    transcriptsFromSpeechEvent({ resultIndex: 1, results: [ignored, final] }),
    { interim: '', final: 'taxi to runway 27' },
  );
  assert.deepEqual(transcriptsFromSpeechEvent(undefined), { interim: '', final: '' });
}

console.log('OpenTower speech-event checks passed');
