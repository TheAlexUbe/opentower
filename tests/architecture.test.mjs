import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ScopeRenderer } from '../src/scope-renderer.js';
import { Renderer } from '../src/render.js';
import { TraconRenderer } from '../src/tracon-renderer.js';

const read = (name) => fs.readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');

// The simulation engines must remain usable in Node with no browser globals.
for (const file of ['tracon.js', 'engine.js']) {
  const source = read(file);
  for (const forbidden of ['document.', 'window.', 'getContext(', 'getBoundingClientRect(']) {
    assert.equal(source.includes(forbidden), false, `${file} must stay DOM-free (found ${forbidden})`);
  }
}

// Both renderers share one projection implementation instead of copying it.
for (const method of ['setEngine', 'resize', 'sx', 'sy', 'toWorld', 'clampedPos', 'pick']) {
  assert.equal(typeof ScopeRenderer.prototype[method], 'function', `ScopeRenderer implements ${method}`);
  assert.equal(Object.hasOwn(Renderer.prototype, method), false, `Renderer inherits ${method}`);
  assert.equal(Object.hasOwn(TraconRenderer.prototype, method), false, `TraconRenderer inherits ${method}`);
}
assert.ok(new Renderer({ getContext: () => ({}) }) instanceof ScopeRenderer);
assert.ok(new TraconRenderer({ getContext: () => ({}) }) instanceof ScopeRenderer);

// Same base, opposite vertical axes.
const canvas = { getContext: () => ({}) };
const tower = new Renderer(canvas);
tower.scale = 2;
tower.ox = 100;
tower.oy = 50;
const approach = new TraconRenderer(canvas);
approach.scale = 2;
approach.ox = 100;
approach.oy = 50;
assert.equal(tower.sy(10), 70, 'tower y grows downward');
assert.equal(approach.sy(10), 30, 'approach y grows upward (north up)');
assert.deepEqual(tower.toWorld(100, 70), { x: 0, y: 10 });
assert.deepEqual(approach.toWorld(100, 30), { x: 0, y: 10 });

// main.js is a composition root, not a second UI module.
const mainSource = read('main.js');
assert.ok(mainSource.split('\n').length < 40, 'main.js stays a thin composition root');
assert.match(mainSource, /createApp\(\{/);
assert.match(mainSource, /createEngine:/);
assert.match(mainSource, /createRenderer:/);
assert.equal(mainSource.includes('addEventListener'), false);
assert.equal(mainSource.includes('document.querySelector'), false);

// UI orchestration is isolated from concrete engines/renderers.
const uiSource = read('ui.js');
assert.match(uiSource, /export function createApp/);
for (const concrete of ["from './engine.js'", "from './render.js'", "from './tracon.js'", "from './tracon-renderer.js'"]) {
  assert.equal(uiSource.includes(concrete), false, `ui.js must not import ${concrete}`);
}
assert.match(read('voice.js'), /export class VoiceController/);
assert.match(read('i18n.js'), /export function applyLanguage/);

console.log('OpenTower architecture checks passed');
