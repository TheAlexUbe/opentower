// OpenTower - shared canvas projection and hit-testing for both scopes.
//
// The tower scope uses a top-left origin with y growing downward, while the
// approach scope is north-up with y growing upward. Keeping the projection in
// one place prevents the two renderers from drifting apart.

/**
 * Base class for canvas scope renderers.
 *
 * Owns the canvas backing store, world-to-screen projection and aircraft
 * hit-testing. Subclasses only draw. The simulation engine is read-only here.
 */
export class ScopeRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{world?: {x: number, y: number}, pad?: number, yUp?: boolean}} [options]
   */
  constructor(canvas, { world = { x: 1, y: 1 }, pad = 20, yUp = false } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.engine = null;
    this.selectedId = null;
    this.world = world;
    this.pad = pad;
    this.yUp = yUp;
    this.scale = 1;
    this.ox = 0;
    this.oy = 0;
    this.dpr = 1;
    this.cssW = 0;
    this.cssH = 0;
  }

  /**
   * Attach the simulation engine whose aircraft are drawn.
   *
   * @param {object|null} engine - A SimEngine/TraconEngine instance or null.
   */
  setEngine(engine) {
    this.engine = engine;
  }

  /**
   * Recompute the canvas backing store and world-to-screen projection.
   * Call after the canvas CSS size changes.
   */
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cssW = Math.max(320, rect.width);
    this.cssH = Math.max(260, rect.height);
    this.canvas.width = Math.round(this.cssW * this.dpr);
    this.canvas.height = Math.round(this.cssH * this.dpr);
    const usableW = this.cssW - this.pad * 2;
    const usableH = this.cssH - this.pad * 2;
    this.scale = Math.min(usableW / (this.world.x * 2), usableH / (this.world.y * 2));
    this.ox = this.cssW / 2;
    this.oy = this.cssH / 2;
  }

  sx(x) {
    return this.ox + x * this.scale;
  }

  sy(y) {
    return this.yUp ? this.oy - y * this.scale : this.oy + y * this.scale;
  }

  toWorld(px, py) {
    return {
      x: (px - this.ox) / this.scale,
      y: (this.yUp ? -1 : 1) * ((py - this.oy) / this.scale),
    };
  }

  clampedPos(ac) {
    const m = 18;
    return {
      x: Math.max(m, Math.min(this.cssW - m, this.sx(ac.x))),
      y: Math.max(m, Math.min(this.cssH - m, this.sy(ac.y))),
    };
  }

  /**
   * Hit-test the visible aircraft at a canvas position.
   *
   * @param {number} px - Canvas x in CSS pixels.
   * @param {number} py - Canvas y in CSS pixels.
   * @param {number} [radius=26] - Maximum pick distance in CSS pixels.
   * @returns {object|null} The nearest aircraft within radius, or null.
   */
  pick(px, py, radius = 26) {
    if (!this.engine) return null;
    let best = null;
    let bestD = radius;
    for (const ac of this.engine.activeAircraft()) {
      const p = this.clampedPos(ac);
      const d = Math.hypot(p.x - px, p.y - py);
      if (d < bestD) {
        bestD = d;
        best = ac;
      }
    }
    return best;
  }
}
