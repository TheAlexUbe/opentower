// OpenTower - canvas scope renderer.
import { AIRPORT } from './config.js';
import { FINAL_INSET_RANGE_M, finalApproachDistance, inFinalInset } from './airport.js';
import { ScopeRenderer } from './scope-renderer.js';

const WORLD = { x: 1350, y: 820 };
const PAD = 26;

const COLORS = {
  bg: '#060a10',
  grid: 'rgba(90,120,150,0.10)',
  gridStrong: 'rgba(90,120,150,0.18)',
  runway: '#1b2431',
  runwayEdge: '#5d7086',
  runwayMark: '#d7e1ea',
  taxi: '#232f3d',
  taxiEdge: '#3d5166',
  taxiMark: '#c9a227',
  gate: '#2b3a4b',
  gateEdge: '#5b7691',
  text: '#b9c7d6',
  dim: '#6c7f93',
  green: '#3cf07a',
  amber: '#ffc23d',
  red: '#ff5b5b',
  cyan: '#54d7ff',
  white: '#eef4fa',
};

/**
 * Canvas renderer for the Tower/Ground scope.
 *
 * Owns projection and drawing only. Simulation state is read from the
 * `SimEngine` passed to {@link Renderer#setEngine}; the renderer never mutates
 * it. Uses a top-left origin with `y` growing downward.
 */
export class Renderer extends ScopeRenderer {
  constructor(canvas) {
    super(canvas, { world: WORLD, pad: PAD, yUp: false });
  }

  /** Draw one full frame of the tower scope. No-op without an engine. */
  draw() {
    if (!this.engine) return;
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssW, this.cssH);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, this.cssW, this.cssH);

    this.drawGrid();
    this.drawAirport();
    this.drawRunwayStatus();
    this.drawAircraft();
    this.drawFinalInset();
    this.drawScale();
    this.drawHud();
  }

  drawGrid() {
    const ctx = this.ctx;
    const step = 200;
    ctx.lineWidth = 1;
    for (let x = -WORLD.x; x <= WORLD.x; x += step) {
      ctx.strokeStyle = x % 1000 === 0 ? COLORS.gridStrong : COLORS.grid;
      ctx.beginPath();
      ctx.moveTo(this.sx(x), this.sy(-WORLD.y));
      ctx.lineTo(this.sx(x), this.sy(WORLD.y));
      ctx.stroke();
    }
    for (let y = -WORLD.y; y <= WORLD.y; y += step) {
      ctx.strokeStyle = y % 1000 === 0 ? COLORS.gridStrong : COLORS.grid;
      ctx.beginPath();
      ctx.moveTo(this.sx(-WORLD.x), this.sy(y));
      ctx.lineTo(this.sx(WORLD.x), this.sy(y));
      ctx.stroke();
    }
    const cx = this.sx(0);
    const cy = this.sy(0);
    ctx.strokeStyle = 'rgba(90,120,150,0.16)';
    for (const r of [400, 800, 1200]) {
      ctx.beginPath();
      ctx.arc(cx, cy, r * this.scale, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  drawAirport() {
    const ctx = this.ctx;
    const s = this.scale;
    const compact = this.compact;

    // Apron / terminal block.
    ctx.fillStyle = '#0d141d';
    ctx.strokeStyle = '#233140';
    ctx.lineWidth = 1;
    const apron = { x1: -320, y1: 150, x2: 320, y2: 340 };
    ctx.beginPath();
    ctx.rect(this.sx(apron.x1), this.sy(apron.y1), (apron.x2 - apron.x1) * s, (apron.y2 - apron.y1) * s);
    ctx.fill();
    ctx.stroke();

    // FBO ramp (east) and west ramp.
    ctx.beginPath();
    ctx.rect(this.sx(460), this.sy(160), 240 * s, 120 * s);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.rect(this.sx(-720), this.sy(160), 280 * s, 120 * s);
    ctx.fill();
    ctx.stroke();

    // North ramp beyond inactive runway 12/30.
    ctx.beginPath();
    ctx.rect(this.sx(AIRPORT.northRamp.x1), this.sy(AIRPORT.northRamp.y1), (AIRPORT.northRamp.x2 - AIRPORT.northRamp.x1) * s, (AIRPORT.northRamp.y2 - AIRPORT.northRamp.y1) * s);
    ctx.fill();
    ctx.stroke();

    // Taxiway Alpha: a two-lane surface (departures north, arrivals south).
    ctx.strokeStyle = COLORS.taxi;
    ctx.lineWidth = Math.max(16, 44 * s);
    ctx.beginPath();
    ctx.moveTo(this.sx(-800), this.sy(AIRPORT.alphaY));
    ctx.lineTo(this.sx(800), this.sy(AIRPORT.alphaY));
    ctx.stroke();
    ctx.strokeStyle = COLORS.taxiMark;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 7]);
    for (const lane of [AIRPORT.alphaDepY, AIRPORT.alphaArrY]) {
      ctx.beginPath();
      ctx.moveTo(this.sx(-800), this.sy(lane));
      ctx.lineTo(this.sx(800), this.sy(lane));
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Connectors.
    for (const c of AIRPORT.connectors) {
      ctx.strokeStyle = COLORS.taxi;
      ctx.lineWidth = Math.max(7, 16 * s);
      ctx.beginPath();
      ctx.moveTo(this.sx(c.x), this.sy(0));
      ctx.lineTo(this.sx(c.x), this.sy(AIRPORT.alphaArrY));
      ctx.stroke();
      ctx.strokeStyle = COLORS.dim;
      ctx.lineWidth = 1;
      if (!compact) {
        ctx.fillStyle = COLORS.dim;
        ctx.font = '10px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(c.id, this.sx(c.x), this.sy(AIRPORT.alphaArrY) + 18);
      }
    }

    // Taxiway Bravo, crossing inactive runway 12/30 to the north ramp.
    ctx.strokeStyle = COLORS.taxi;
    ctx.lineWidth = Math.max(7, 14 * s);
    ctx.beginPath();
    ctx.moveTo(this.sx(AIRPORT.crossing.x), this.sy(-660));
    ctx.lineTo(this.sx(AIRPORT.crossing.x), this.sy(AIRPORT.alphaArrY));
    ctx.stroke();
    if (!compact) {
      ctx.fillStyle = COLORS.dim;
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.fillText('BRAVO', this.sx(AIRPORT.crossing.x) + 10, this.sy(-560));
    }

    // Gate spurs and gates.
    for (const gate of AIRPORT.gates) {
      ctx.strokeStyle = COLORS.taxi;
      ctx.lineWidth = Math.max(5, 10 * s);
      ctx.beginPath();
      if (gate.y < -100) ctx.moveTo(this.sx(AIRPORT.crossing.x), this.sy(gate.y));
      else ctx.moveTo(this.sx(gate.x), this.sy(AIRPORT.alphaArrY));
      ctx.lineTo(this.sx(gate.x), this.sy(gate.y));
      ctx.stroke();
      ctx.fillStyle = COLORS.gate;
      ctx.strokeStyle = COLORS.gateEdge;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.rect(this.sx(gate.x) - 9, this.sy(gate.y) - 9, 18, 18);
      ctx.fill();
      ctx.stroke();
      if (!compact) {
        ctx.fillStyle = COLORS.dim;
        ctx.font = '9px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(gate.id, this.sx(gate.x), this.sy(gate.y) + 22);
      }
    }

    // Inactive crossing runway 12/30 (north of the main field).
    const r2 = AIRPORT.secondaryRunway;
    const rdx = r2.to.x - r2.from.x;
    const rdy = r2.to.y - r2.from.y;
    const rlen = Math.hypot(rdx, rdy);
    const rang = Math.atan2(rdy, rdx);
    ctx.save();
    ctx.translate(this.sx((r2.from.x + r2.to.x) / 2), this.sy((r2.from.y + r2.to.y) / 2));
    ctx.rotate(rang);
    ctx.fillStyle = '#141c26';
    ctx.strokeStyle = '#40566c';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.rect((-rlen / 2) * s, (-r2.width / 2) * s, rlen * s, r2.width * s);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = '#6b7f93';
    ctx.setLineDash([8, 8]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-rlen / 2 * s + 10, 0);
    ctx.lineTo(rlen / 2 * s - 10, 0);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = COLORS.dim;
    ctx.font = 'bold 10px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('12', (-rlen / 2 + 30) * s, (-r2.width / 2 - 6) * s);
    ctx.fillText('30', (rlen / 2 - 30) * s, (-r2.width / 2 - 6) * s);
    ctx.restore();

    // Crossing hold-short lines on Bravo.
    const cz = AIRPORT.crossing;
    ctx.strokeStyle = '#e8f0f7';
    ctx.lineWidth = 2;
    for (const hy of [cz.southHoldY, cz.northHoldY]) {
      ctx.beginPath();
      ctx.moveTo(this.sx(cz.x - 22), this.sy(hy));
      ctx.lineTo(this.sx(cz.x + 22), this.sy(hy));
      ctx.stroke();
    }
    ctx.fillStyle = COLORS.dim;
    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(this.engine.lang === 'es' ? 'ESPERA 12' : 'HOLD 12', this.sx(cz.x + 28), this.sy(cz.southHoldY + 4));

    // Runway.
    const halfW = AIRPORT.runway.width / 2;
    ctx.fillStyle = COLORS.runway;
    ctx.strokeStyle = COLORS.runwayEdge;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.rect(this.sx(-850), this.sy(-halfW), 1700 * s, AIRPORT.runway.width * s);
    ctx.fill();
    ctx.stroke();

    // Centreline.
    ctx.strokeStyle = COLORS.runwayMark;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([12, 10]);
    ctx.beginPath();
    ctx.moveTo(this.sx(-820), this.sy(0));
    ctx.lineTo(this.sx(820), this.sy(0));
    ctx.stroke();
    ctx.setLineDash([]);

    // Threshold stripes (simple, both ends).
    ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      const off = -halfW + 3 + i * (AIRPORT.runway.width / 7);
      ctx.beginPath();
      ctx.moveTo(this.sx(-833), this.sy(off));
      ctx.lineTo(this.sx(-800), this.sy(off));
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(this.sx(833), this.sy(off));
      ctx.lineTo(this.sx(800), this.sy(off));
      ctx.stroke();
    }

    // Runway numbers.
    ctx.fillStyle = COLORS.text;
    ctx.font = `bold ${Math.max(11, Math.round(16 * s))}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.save();
    ctx.translate(this.sx(-780), this.sy(-halfW - 14));
    ctx.fillText(AIRPORT.runway.low, 0, 0);
    ctx.restore();
    ctx.save();
    ctx.translate(this.sx(780), this.sy(-halfW - 14));
    ctx.fillText(AIRPORT.runway.high, 0, 0);
    ctx.restore();

    // Labels are in the header/HUD; keep the scope free of overlapping text.
  }

  drawRunwayStatus() {
    if (!this.engine.runwayOccupied()) return;
    const ctx = this.ctx;
    const halfW = AIRPORT.runway.width / 2;
    ctx.fillStyle = 'rgba(255,70,70,0.16)';
    ctx.fillRect(this.sx(-850), this.sy(-halfW), 1700 * this.scale, AIRPORT.runway.width * this.scale);
    ctx.strokeStyle = 'rgba(255,90,90,0.8)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(this.sx(-850), this.sy(-halfW), 1700 * this.scale, AIRPORT.runway.width * this.scale);
  }

  drawAircraft() {
    const ctx = this.ctx;
    for (const ac of this.engine.activeAircraft()) {
      const p = this.clampedPos(ac);
      const off = Math.abs(p.x - this.sx(ac.x)) > 1 || Math.abs(p.y - this.sy(ac.y)) > 1;
      const selected = ac.id === this.selectedId;
      const color = selected
        ? COLORS.white
        : ac.phase === 'final' || ac.phase === 'goAround'
          ? COLORS.amber
          : ac.kind === 'departure'
            ? COLORS.cyan
            : COLORS.green;

      if (off) {
        // Off-scope inbound: edge arrow.
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(ac.heading);
        ctx.fillStyle = COLORS.amber;
        ctx.beginPath();
        ctx.moveTo(10, 0);
        ctx.lineTo(-7, 6);
        ctx.lineTo(-7, -6);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = COLORS.amber;
        ctx.font = '10px ui-monospace, monospace';
        const leftEdge = p.x < 60;
        const rightEdge = p.x > this.cssW - 60;
        ctx.textAlign = leftEdge ? 'left' : rightEdge ? 'right' : 'center';
        const tx = leftEdge ? p.x + 8 : rightEdge ? p.x - 8 : p.x;
        ctx.fillText(`${ac.callsign} ${this.engine.lang === 'es' ? 'ENTRANDO' : 'INBOUND'}`, tx, p.y - 14);
        continue;
      }

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(ac.heading);
      ctx.fillStyle = color;
      const size = ac.wake === 'H' || ac.wake === 'J' ? 8 : 6;
      ctx.beginPath();
      ctx.moveTo(size + 2, 0);
      ctx.lineTo(-size, size * 0.8);
      ctx.lineTo(-size * 0.4, 0);
      ctx.lineTo(-size, -size * 0.8);
      ctx.closePath();
      ctx.fill();
      if (ac.wake === 'H' || ac.wake === 'J') {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(0, 0, size + 5, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();

      if (selected) {
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 16, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (ac.conflict) {
        ctx.strokeStyle = COLORS.red;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, this.compact ? 14 : 18, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Data block. Phones get a smaller tag so targets stay distinguishable.
      const status = this.statusFor(ac);
      const line2 = ac.phase === 'final' || ac.phase === 'goAround' || ac.phase === 'airborne'
        ? `${ac.type.code} ${Math.round(ac.alt)}ft ${Math.round(ac.speed / 0.514444)}kt`
        : `${ac.type.code} ${status}`;
      if (this.compact) {
        const compactTag = ac.phase === 'final' || ac.phase === 'goAround' || ac.phase === 'airborne'
          ? `${ac.type.code} ${Math.round(ac.alt)}ft`
          : status;
        ctx.fillStyle = 'rgba(5,8,13,0.78)';
        ctx.fillRect(p.x + 7, p.y - 10, 94, 18);
        ctx.textAlign = 'left';
        ctx.font = 'bold 9px ui-monospace, monospace';
        ctx.fillStyle = selected ? COLORS.white : color;
        ctx.fillText(ac.callsign, p.x + 9, p.y - 3);
        ctx.font = '8px ui-monospace, monospace';
        ctx.fillStyle = COLORS.dim;
        ctx.fillText(compactTag, p.x + 9, p.y + 6);
      } else {
        ctx.fillStyle = 'rgba(5,8,13,0.72)';
        ctx.fillRect(p.x + 10, p.y - 13, 132, 24);
        ctx.textAlign = 'left';
        ctx.font = 'bold 11px ui-monospace, monospace';
        ctx.fillStyle = selected ? COLORS.white : color;
        ctx.fillText(ac.callsign, p.x + 13, p.y - 3);
        ctx.font = '10px ui-monospace, monospace';
        ctx.fillStyle = COLORS.dim;
        ctx.fillText(line2, p.x + 13, p.y + 9);
      }
    }
  }

  statusFor(ac) {
    switch (ac.phase) {
      case 'parked': return 'at gate';
      case 'taxi': return 'taxiing';
      case 'holding': return 'holding short';
      case 'crossing': return 'hold runway 12';
      case 'lineup': return 'lining up';
      case 'lined_up': return 'lined up';
      case 'takeoff': return 'rolling';
      case 'final': return ac.clearedLand ? 'cleared to land' : 'inbound';
      case 'rollout': return 'landing roll';
      case 'abort': return 'aborting';
      case 'aborted': return 'stopped';
      case 'abortTaxi': return 'taxi clear';
      case 'goAround': return 'going around';
      case 'ground': return 'awaiting taxi';
      case 'taxiRamp': return 'taxi to ramp';
      default: return ac.phase;
    }
  }

  drawFinalInset() {
    if (!this.engine) return;
    const geo = this.engine.geo;
    const arrivals = this.engine.activeAircraft().filter((a) => inFinalInset(a, geo));
    if (!arrivals.length) return;
    if (this.compact) {
      const ctx = this.ctx;
      const nearest = Math.min(...arrivals.map((a) => finalApproachDistance(a, geo))) / 1852;
      ctx.fillStyle = COLORS.amber;
      ctx.font = '9px ui-monospace, monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`FINAL ${geo.runway} · ${nearest.toFixed(1)} NM${arrivals.length > 1 ? ` +${arrivals.length - 1}` : ''}`, this.cssW - 12, this.cssH - 38);
      return;
    }
    const ctx = this.ctx;
    const w = 226;
    const h = 150;
    const x = this.cssW - w - 16;
    const y = this.cssH - h - 54;
    const totalNm = FINAL_INSET_RANGE_M / 1852;
    ctx.save();
    ctx.fillStyle = 'rgba(5,10,16,0.86)';
    ctx.strokeStyle = '#22384a';
    ctx.lineWidth = 1;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = COLORS.dim;
    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`FINAL ${geo.runway} · 0–${totalNm} NM`, x + 10, y + 14);

    const top = y + 24;
    const bottom = y + h - 18;
    const cx = x + w / 2;
    for (let nm = 1; nm <= totalNm; nm++) {
      const yy = bottom - (nm / totalNm) * (bottom - top);
      ctx.strokeStyle = 'rgba(90,120,150,0.18)';
      ctx.beginPath();
      ctx.moveTo(cx - 60, yy);
      ctx.lineTo(cx + 60, yy);
      ctx.stroke();
      ctx.fillStyle = COLORS.dim;
      ctx.fillText(String(nm), cx + 64, yy + 3);
    }
    ctx.strokeStyle = 'rgba(60,240,122,0.5)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(cx, top);
    ctx.lineTo(cx, bottom);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = COLORS.white;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cx - 40, bottom);
    ctx.lineTo(cx + 40, bottom);
    ctx.stroke();
    ctx.lineWidth = 1;

    const gaY = bottom - (1500 / 1852 / totalNm) * (bottom - top);
    ctx.strokeStyle = COLORS.amber;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x + 8, gaY);
    ctx.lineTo(x + w - 8, gaY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = COLORS.amber;
    ctx.fillText('GA', x + w - 24, gaY - 4);

    for (const ac of arrivals) {
      const nm = finalApproachDistance(ac, geo) / 1852;
      const yy = bottom - (Math.min(totalNm, nm) / totalNm) * (bottom - top);
      const xx = cx + Math.max(-55, Math.min(55, (ac.y / 1852) * 34));
      ctx.fillStyle = ac.clearedLand ? COLORS.green : COLORS.amber;
      ctx.beginPath();
      ctx.arc(xx, yy, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = ac.clearedLand ? COLORS.green : COLORS.amber;
      ctx.textAlign = 'left';
      ctx.fillText(ac.callsign, Math.min(x + w - 62, xx + 7), yy + 3);
    }
    ctx.restore();
  }

  drawScale() {
    const ctx = this.ctx;
    const x1 = 18;
    const y1 = this.cssH - 22;
    const len = 500 * this.scale;
    ctx.strokeStyle = COLORS.dim;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 + len, y1);
    ctx.moveTo(x1, y1 - 4);
    ctx.lineTo(x1, y1 + 4);
    ctx.moveTo(x1 + len, y1 - 4);
    ctx.lineTo(x1 + len, y1 + 4);
    ctx.stroke();
    ctx.fillStyle = COLORS.dim;
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText('500 m', x1, y1 - 8);
  }

  drawHud() {
    const ctx = this.ctx;
    const g = this.engine.geo;
    const es = this.engine.lang === 'es';
    const compact = this.compact;
    ctx.textAlign = 'right';
    ctx.font = compact ? 'bold 9px ui-monospace, monospace' : 'bold 11px ui-monospace, monospace';
    ctx.fillStyle = this.engine.runwayOccupied() ? COLORS.red : COLORS.green;
    ctx.fillText(
      this.engine.runwayOccupied()
        ? (es ? `PISTA ${g.runway} OCUPADA` : `RWY ${g.runway} OCCUPIED`)
        : (es ? `PISTA ${g.runway} LIBRE` : `RWY ${g.runway} CLEAR`),
      this.cssW - 12,
      compact ? 18 : 22,
    );
    ctx.fillStyle = COLORS.dim;
    ctx.font = compact ? '8px ui-monospace, monospace' : '10px ui-monospace, monospace';
    ctx.fillText(
      compact
        ? `${String(this.engine.wind.dir).padStart(3, '0')}/${this.engine.wind.speed} A${this.engine.atis}`
        : `${es ? 'VIENTO' : 'WIND'} ${String(this.engine.wind.dir).padStart(3, '0')} / ${this.engine.wind.speed}KT · ATIS ${this.engine.atis}`,
      this.cssW - 12,
      compact ? 30 : 38,
    );
    const wakeLeft = 120 - (this.engine.t - this.engine.lastHeavy.t);
    if (wakeLeft > 0 && wakeLeft <= 120) {
      ctx.fillStyle = COLORS.amber;
      ctx.font = compact ? '8px ui-monospace, monospace' : '10px ui-monospace, monospace';
      ctx.fillText(
        `${es ? 'ESTELA' : 'WAKE'} ${Math.ceil(wakeLeft)}s`,
        this.cssW - 12,
        compact ? 42 : 54,
      );
    }
  }
}
