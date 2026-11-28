// OpenTower - approach (TRACON) radar renderer.
//
// Canvas-only: reads a TraconEngine and draws the radar scope. The engine in
// `tracon.js` stays completely free of DOM and canvas code.

import { ScopeRenderer } from './scope-renderer.js';

const NM = 1852;
const RAD = Math.PI / 180;
const TR_WORLD = { x: 22 * NM, y: 22 * NM };
const TR_COLORS = {
  bg: '#060a10',
  grid: 'rgba(90,120,150,0.10)',
  gridStrong: 'rgba(90,120,150,0.18)',
  text: '#b9c7d6',
  dim: '#6c7f93',
  green: '#3cf07a',
  amber: '#ffc23d',
  red: '#ff5b5b',
  cyan: '#54d7ff',
  white: '#eef4fa',
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const pad2 = (n) => String(n).padStart(2, '0');
const pad3 = (n) => String(Math.round(n)).padStart(3, '0');

/**
 * Canvas renderer for the approach radar scope.
 *
 * Owns drawing only. Uses the shared {@link ScopeRenderer} projection with a
 * centred origin and `y` growing upward (north up), unlike the tower scope.
 */
export class TraconRenderer extends ScopeRenderer {
  constructor(canvas) {
    super(canvas, { world: TR_WORLD, pad: 20, yUp: true });
  }

  draw() {
    if (!this.engine) return;
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssW, this.cssH);
    ctx.fillStyle = TR_COLORS.bg;
    ctx.fillRect(0, 0, this.cssW, this.cssH);

    this.drawGrid();
    this.drawAirspace();
    this.drawAircraft();
    this.drawHud();
  }

  drawGrid() {
    const ctx = this.ctx;
    for (let d = -20; d <= 20; d += 5) {
      const x = d * NM;
      const y = d * NM;
      ctx.strokeStyle = d % 10 === 0 ? TR_COLORS.gridStrong : TR_COLORS.grid;
      ctx.beginPath();
      ctx.moveTo(this.sx(x), this.sy(-TR_WORLD.y));
      ctx.lineTo(this.sx(x), this.sy(TR_WORLD.y));
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(this.sx(-TR_WORLD.x), this.sy(y));
      ctx.lineTo(this.sx(TR_WORLD.x), this.sy(y));
      ctx.stroke();
    }
    for (let r = 5; r <= 20; r += 5) {
      ctx.beginPath();
      ctx.arc(this.sx(0), this.sy(0), r * NM * this.scale, 0, Math.PI * 2);
      ctx.strokeStyle = TR_COLORS.gridStrong;
      ctx.stroke();
      ctx.fillStyle = TR_COLORS.dim;
      ctx.font = '9px ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`${r}`, this.sx(r * NM * 0.7071) + 4, this.sy(r * NM * 0.7071) - 4);
    }
  }

  drawAirspace() {
    const ctx = this.ctx;
    const geo = this.engine.geo;
    // Runway.
    ctx.strokeStyle = TR_COLORS.white;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(this.sx(-850), this.sy(0));
    ctx.lineTo(this.sx(850), this.sy(0));
    ctx.stroke();
    ctx.fillStyle = TR_COLORS.dim;
    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${this.engine.lang === 'es' ? 'PISTA' : 'RWY'} ${geo.runway}`, this.sx(0), this.sy(0) + 16);

    // Final approach course extends outward from the threshold (opposite the landing heading).
    const courseHdg = geo.courseHeading;
    const fx = Math.sin(courseHdg * RAD);
    const fy = Math.cos(courseHdg * RAD);
    ctx.strokeStyle = 'rgba(60,240,122,0.45)';
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(this.sx(geo.thresholdX), this.sy(0));
    ctx.lineTo(this.sx(geo.thresholdX + fx * 10 * NM), this.sy(fy * 10 * NM));
    ctx.stroke();
    ctx.setLineDash([]);

    // Fixes.
    const fixes = [
      { name: 'COPPER', x: 8 * NM, y: 8 * NM },
      { name: 'SUN', x: 10 * NM, y: -2 * NM },
      { name: 'RIDGE', x: 2 * NM, y: 10 * NM },
      { name: 'MESA', x: -8 * NM, y: -8 * NM },
    ];
    for (const fix of fixes) {
      ctx.strokeStyle = TR_COLORS.dim;
      ctx.lineWidth = 1;
      ctx.save();
      ctx.translate(this.sx(fix.x), this.sy(fix.y));
      ctx.rotate(Math.PI / 4);
      ctx.strokeRect(-4, -4, 8, 8);
      ctx.restore();
      ctx.fillStyle = TR_COLORS.dim;
      ctx.font = '9px ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(fix.name, this.sx(fix.x) + 8, this.sy(fix.y) + 3);
    }
  }

  drawAircraft() {
    const ctx = this.ctx;
    for (const ac of this.engine.scopeAircraft()) {
      const p = this.clampedPos(ac);
      const off = Math.abs(p.x - this.sx(ac.x)) > 1 || Math.abs(p.y - this.sy(ac.y)) > 1;
      const selected = ac.id === this.selectedId;
      const color = selected
        ? TR_COLORS.white
        : ac.phase === 'goAround'
          ? TR_COLORS.red
          : ac.kind === 'arrival'
            ? TR_COLORS.amber
            : TR_COLORS.cyan;

      if (off) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(ac.hdg * RAD);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(10, 0);
        ctx.lineTo(-7, 6);
        ctx.lineTo(-7, -6);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = color;
        ctx.font = '10px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(ac.callsign, p.x, p.y - 12);
        continue;
      }

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(ac.hdg * RAD);
      ctx.fillStyle = color;
      const size = ac.wake === 'H' || ac.wake === 'J' ? 8 : 6;
      ctx.beginPath();
      ctx.moveTo(size + 2, 0);
      ctx.lineTo(-size, size * 0.8);
      ctx.lineTo(-size * 0.4, 0);
      ctx.lineTo(-size, -size * 0.8);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      if (selected) {
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 16, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (ac.conflict) {
        ctx.strokeStyle = TR_COLORS.red;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 19, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 1;
      }

      const line2 = `${ac.type.code} ${Math.round(ac.alt)}ft ${Math.round(ac.speed)}kt`;
      const tag = ac.assignedHdg != null || ac.assignedAlt != null
        ? `${pad3(ac.assignedHdg ?? ac.hdg)} / ${Math.round(ac.assignedAlt ?? ac.alt)}`
        : ac.phase.toUpperCase();
      if (this.compact) {
        ctx.fillStyle = 'rgba(5,8,13,0.78)';
        ctx.fillRect(p.x + 7, p.y - 10, 96, 18);
        ctx.textAlign = 'left';
        ctx.font = 'bold 9px ui-monospace, monospace';
        ctx.fillStyle = color;
        ctx.fillText(ac.callsign, p.x + 9, p.y - 3);
        ctx.font = '8px ui-monospace, monospace';
        ctx.fillStyle = TR_COLORS.dim;
        ctx.fillText(`${Math.round(ac.alt)}ft ${tag}`, p.x + 9, p.y + 6);
      } else {
        ctx.fillStyle = 'rgba(5,8,13,0.72)';
        ctx.fillRect(p.x + 10, p.y - 13, 118, 24);
        ctx.textAlign = 'left';
        ctx.font = 'bold 11px ui-monospace, monospace';
        ctx.fillStyle = color;
        ctx.fillText(ac.callsign, p.x + 13, p.y - 3);
        ctx.font = '10px ui-monospace, monospace';
        ctx.fillStyle = TR_COLORS.dim;
        ctx.fillText(line2, p.x + 13, p.y + 9);
        ctx.fillStyle = TR_COLORS.dim;
        ctx.fillText(tag, p.x + 13, p.y + 20);
      }
    }
  }

  drawHud() {
    const ctx = this.ctx;
    const compact = this.compact;
    ctx.textAlign = 'right';
    ctx.font = compact ? 'bold 9px ui-monospace, monospace' : 'bold 11px ui-monospace, monospace';
    ctx.fillStyle = TR_COLORS.green;
    ctx.fillText(
      this.engine.lang === 'es'
        ? `APP ${this.engine.appFreq} · PISTA ${this.engine.geo.runway}`
        : `APP ${this.engine.appFreq} · RWY ${this.engine.geo.runway}`,
      this.cssW - 12,
      compact ? 18 : 22,
    );
    ctx.fillStyle = TR_COLORS.dim;
    ctx.font = compact ? '8px ui-monospace, monospace' : '10px ui-monospace, monospace';
    ctx.fillText(
      compact
        ? `${pad3(this.engine.wind.dir)}/${pad2(this.engine.wind.speed)} A${this.engine.atis}`
        : `${this.engine.lang === 'es' ? 'VIENTO' : 'WIND'} ${pad3(this.engine.wind.dir)}/${pad2(this.engine.wind.speed)} · ATIS ${this.engine.atis}`,
      this.cssW - 12,
      compact ? 30 : 38,
    );
    ctx.textAlign = 'left';
    ctx.font = compact ? '8px ui-monospace, monospace' : '10px ui-monospace, monospace';
    ctx.fillText('5/10/15/20 NM', 14, this.cssH - 12);
  }
}
