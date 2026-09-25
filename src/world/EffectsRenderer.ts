import type { View } from '../core/Camera';
import type { CombatSystem } from '../systems/CombatSystem';
import type { EconomySystem } from '../systems/EconomySystem';
import type { Character } from '../entities/Character';
import type { WarSystem } from '../systems/WarSystem';
import { colorsOf } from '../config/factions';
import { RENDER } from '../config/render';
import { COMBAT } from '../config/combat';

/**
 * Эффекты мира: тела погибших, поломки (щитки), места в очереди за рационом, трассеры и
 * попадания, красная тревога и «ранен» по краям экрана.
 */
export class EffectsRenderer {
  drawGround(ctx: CanvasRenderingContext2D, v: View, combat: CombatSystem, economy: EconomySystem, now: number): void {
    const s = v.scale;
    const E = RENDER.effects;
    // Места очереди — пока открыта раздача.
    if (economy.open) {
      ctx.fillStyle = E.queueMark;
      for (let i = 0; i < 9; i++) {
        const q = economy.queueSlot(i);
        ctx.fillRect((q.x - v.left) * s - 5 * s, (q.y - v.top) * s - 1 * s, 10 * s, 2 * s);
      }
    }
    // Щитки: целый — серый, сломанный — мигает.
    for (const r of economy.repairs) {
      const x = (r.x - v.left) * s;
      const y = (r.y - v.top) * s;
      if (x < -20 || y < -20 || x > v.width + 20 || y > v.height + 20) continue;
      ctx.fillStyle = r.broken ? (Math.floor(now * 4) % 2 ? E.brokenA : E.brokenB) : E.fusebox;
      ctx.fillRect(x - 4 * s, y - 4 * s, 8 * s, 8 * s);
      if (r.worker && r.broken) {
        ctx.fillStyle = E.progress;
        ctx.fillRect(x - 8 * s, y - 9 * s, 16 * s * Math.min(1, r.progress / 5), 2 * s);
      }
    }
    // Тела.
    for (const c of combat.corpses) {
      const x = (c.x - v.left) * s;
      const y = (c.y - v.top) * s;
      if (x < -30 || y < -30 || x > v.width + 30 || y > v.height + 30) continue;
      const col = colorsOf(c.faction, c.rank);
      ctx.fillStyle = E.blood;
      ctx.beginPath();
      ctx.ellipse(x + 3 * s, y + 4 * s, 14 * s, 9 * s, 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = col.color;
      ctx.beginPath();
      ctx.arc(x, y, 11 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = E.corpseX;
      ctx.lineWidth = Math.max(1, 1.5 * s);
      ctx.beginPath();
      ctx.moveTo(x - 5 * s, y - 5 * s);
      ctx.lineTo(x + 5 * s, y + 5 * s);
      ctx.moveTo(x + 5 * s, y - 5 * s);
      ctx.lineTo(x - 5 * s, y + 5 * s);
      ctx.stroke();
      if (c.loot.length) {
        ctx.fillStyle = E.loot;
        ctx.fillRect(x + 8 * s, y - 10 * s, 3 * s, 3 * s);
      }
    }
  }

  drawShots(ctx: CanvasRenderingContext2D, v: View, combat: CombatSystem): void {
    const s = v.scale;
    const E = RENDER.effects;
    ctx.lineCap = 'round';
    const TR = RENDER.tracers;
    for (const t of combat.tracers) {
      ctx.globalAlpha = Math.min(1, t.t / COMBAT.tracerTime);
      ctx.strokeStyle = t.kind === 'rifle' ? TR.pulse : t.kind === 'crossbow' ? TR.bolt : t.combine ? E.tracerCombine : E.tracerRebel;
      ctx.lineWidth = Math.max(1, TR.width[t.kind] * s);
      ctx.beginPath();
      ctx.moveTo((t.x0 - v.left) * s, (t.y0 - v.top) * s);
      ctx.lineTo((t.x1 - v.left) * s, (t.y1 - v.top) * s);
      ctx.stroke();
      // Вспышка у ствола.
      ctx.fillStyle = E.flash;
      ctx.beginPath();
      ctx.arc((t.x0 - v.left) * s, (t.y0 - v.top) * s, 3 * s, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const im of combat.impacts) {
      ctx.globalAlpha = Math.min(1, im.t / COMBAT.impactTime);
      ctx.fillStyle = im.blood ? E.bloodHit : E.spark;
      ctx.beginPath();
      ctx.arc((im.x - v.left) * s, (im.y - v.top) * s, (im.blood ? 3 : 2) * s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Указатели на пограничные КПП у края экрана (если КПП не в кадре): стрелка, название,
   * расстояние; идёт бой — оранжевая мигающая надпись «бой».
   */
  drawFrontMarkers(ctx: CanvasRenderingContext2D, v: View, war: WarSystem, player: Character, dpr: number, now: number): void {
    const M = RENDER.frontMarker;
    const s = v.scale;
    const inset = M.inset * dpr;
    const cx = v.width / 2;
    const cy = v.height / 2;
    ctx.font = M.font.replace(/(\d+)px/, (_, n) => `${Number(n) * dpr}px`);
    ctx.textBaseline = 'middle';
    for (const f of war.fronts) {
      const sx = (f.innerGate.x - v.left) * s;
      const sy = (f.innerGate.y - v.top) * s;
      if (sx > inset && sy > inset && sx < v.width - inset && sy < v.height - inset) continue;
      // Точка на кромке экрана по направлению на КПП.
      const dx = sx - cx;
      const dy = sy - cy;
      const k = Math.min((cx - inset) / Math.max(1e-6, Math.abs(dx)), (cy - inset) / Math.max(1e-6, Math.abs(dy)));
      const x = cx + dx * k;
      const y = cy + dy * k;
      const ang = Math.atan2(dy, dx);
      const fight = war.active(f);
      const color = fight ? `rgba(${M.fight},${(0.65 + 0.35 * Math.sin(now * 8)).toFixed(3)})` : M.calm;
      ctx.fillStyle = color;
      ctx.beginPath();
      const a = 9 * dpr;
      ctx.moveTo(x + Math.cos(ang) * a, y + Math.sin(ang) * a);
      ctx.lineTo(x + Math.cos(ang + 2.5) * a, y + Math.sin(ang + 2.5) * a);
      ctx.lineTo(x + Math.cos(ang - 2.5) * a, y + Math.sin(ang - 2.5) * a);
      ctx.closePath();
      ctx.fill();
      const meters = Math.round((Math.hypot(f.innerGate.x - player.x, f.innerGate.y - player.y) / 16) * M.metersPerTile);
      const label = `${f.name.replace('Пограничный ', '')} · ${meters} м${fight ? ' · бой' : ''}`;
      const w = ctx.measureText(label).width;
      // Подпись — внутрь экрана от стрелки.
      const tx = Math.max(6 * dpr + w / 2, Math.min(v.width - 6 * dpr - w / 2, x - Math.cos(ang) * (w / 2 + 16 * dpr)));
      const ty = Math.max(10 * dpr, Math.min(v.height - 10 * dpr, y - Math.sin(ang) * 16 * dpr));
      ctx.textAlign = 'center';
      ctx.lineWidth = 3 * dpr;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.strokeText(label, tx, ty);
      ctx.fillText(label, tx, ty);
    }
    ctx.textBaseline = 'alphabetic';
  }

  /** Красный код — пульсирующая кромка; ранен — красная виньетка. */
  drawAlert(ctx: CanvasRenderingContext2D, v: View, red: boolean, now: number, player: Character): void {
    const hurt = player.alive ? 1 - player.health / player.maxHealth : 1;
    const pulse = red ? 0.12 + 0.1 * Math.sin(now * 4) : 0;
    const a = Math.max(pulse, hurt > 0.5 ? (hurt - 0.5) * 0.9 : 0);
    if (a <= 0.01) return;
    const g = ctx.createRadialGradient(v.width / 2, v.height / 2, Math.min(v.width, v.height) * 0.3, v.width / 2, v.height / 2, Math.hypot(v.width, v.height) / 2);
    g.addColorStop(0, 'rgba(200,20,20,0)');
    g.addColorStop(1, `rgba(200,20,20,${a.toFixed(3)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, v.width, v.height);
  }
}
