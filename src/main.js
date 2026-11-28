/**
 * OpenTower composition root.
 *
 * The only job of this module is to wire concrete engine and renderer
 * implementations into the browser app. All UI orchestration lives in
 * `ui.js`; simulation rules live in the engine modules.
 */

import { SimEngine } from './engine.js';
import { Renderer } from './render.js';
import { TraconEngine } from './tracon.js';
import { TraconRenderer } from './tracon-renderer.js';
import { createApp } from './ui.js';

createApp({
  document,
  window,
  createEngine: (mode, options) => (mode === 'tracon' ? new TraconEngine(options) : new SimEngine(options)),
  createRenderer: (mode, canvas) => (mode === 'tracon' ? new TraconRenderer(canvas) : new Renderer(canvas)),
});
