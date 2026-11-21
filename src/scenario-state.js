// OpenTower - pure scenario/UI state helpers.
import { DIFFICULTIES } from './config.js';

/**
 * Effective settings for the selected scenario.
 * A scripted scenario locks the values it defines; Free shift uses the
 * player's last free-shift choices.
 */
export function effectiveScenarioSettings(scenario, free = {}) {
  const baseline = {
    duration: 600,
    difficulty: 'calm',
    ...free,
  };
  const duration = scenario?.duration ?? baseline.duration;
  const difficulty = scenario?.difficulty ?? baseline.difficulty;
  return {
    duration,
    difficulty: DIFFICULTIES[difficulty] ? difficulty : 'calm',
    durationLocked: scenario?.duration != null,
    difficultyLocked: scenario?.difficulty != null,
  };
}

/** Best scores are tracked per scenario and effective difficulty. */
export function bestScoreKey(scenarioId, difficultyId) {
  return `opentower.best.${scenarioId}.${difficultyId}`;
}
