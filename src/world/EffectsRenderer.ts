import type { View } from '../core/Camera';
import type { CombatSystem } from '../systems/CombatSystem';
import type { EconomySystem } from '../systems/EconomySystem';
import type { Character } from '../entities/Character';
import type { WarSystem } from '../systems/WarSystem';
import type { GameMap } from './GameMap';
import { colorsOf } from '../config/factions';
import { RENDER } from '../config/render';
import { COMBAT } from '../config/combat';

/**
 * Эффекты мира: тела погибших, поломки (щитки), места в очереди за рационом, трассеры и
 * попадания, красная тревога и «ранен» по краям экрана.
 */
export class EffectsRenderer {
  drawGround(ctx: CanvasRenderingContext2D, v: View, combat: CombatSystem, economy: EconomySystem, now: number, map?: GameMap, cache?: { x: number; y: number } | null): void {
    const s = v.scale;
    const E = RENDER.effects;
    const onScreen = (x: number, y: number, m: number) => x > -m && y > -m && x < v.width + m && y < v.height + m;
    // Люки: в городе — крышка, в канализации — лестница и свет сверху.
    if (map) {
      for (const h of map.hatches) {
        const cx = (h.city.x - v.left) * s;
        const cy = (h.city.y - v.top) * s;
        if (onScreen(cx, cy, 20)) {
          ctx.fillStyle = E.hatchCover;
          ctx.beginPath();
          ctx.arc(cx, cy, 9 * s, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = E.hatchRim;
          ctx.lineWidth = Math.max(1, 1.2 * s);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(cx - 5 * s, cy - 3 * s); ctx.lineTo(cx + 5 * s, cy - 3 * s);
          ctx.moveTo(cx - 6 * s, cy); ctx.lineTo(cx + 6 * s, cy);
          ctx.moveTo(cx - 5 * s, cy + 3 * s); ctx.lineTo(cx + 5 * s, cy + 3 * s);
          ctx.stroke();
        }
        const sx = (h.sewer.x - v.left) * s;
        const sy = (h.sewer.y - v.top) * s;
        if (onScreen(sx, sy, 40)) {
          const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, 34 * s);
          g.addColorStop(0, E.hatchLight);
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g;
          ctx.fillRect(sx - 34 * s, sy - 34 * s, 68 * s, 68 * s);
          ctx.strokeStyle = E.hatchLadder;
          ctx.lineWidth = Math.max(1, 1.5 * s);
          ctx.beginPath();
          ctx.moveTo(sx - 5 * s, sy - 9 * s); ctx.lineTo(sx - 5 * s, sy + 9 * s);
          ctx.moveTo(sx + 5 * s, sy - 9 * s); ctx.lineTo(sx + 5 * s, sy + 9 * s);
          for (let k = -6; k <= 6; k += 4) {
            ctx.moveTo(sx - 5 * s, sy + k * s);
            ctx.lineTo(sx + 5 * s, sy + k * s);
          }
          ctx.stroke();
        }
      }
    }
    // Тайник сопротивления.
    if (cache) {
      const x = (cache.x - v.left) * s;
      const y = (cache.y - v.top) * s;
      if (onScreen(x, y, 20)) {
        ctx.fillStyle = E.cache;
        ctx.fillRect(x - 7 * s, y - 5 * s, 14 * s, 10 * s);
        ctx.fillStyle = E.loot;
        ctx.fillRect(x - 1 * s, y - 5 * s, 2 * s, 10 * s);
      }
    }
    // Места очереди — пока открыта раздача.
    if (economy.open) {
      ctx.fillStyle = E.queueMark;
      for (let i = 0; i < 9; i++) {
        const q = economy.queueSlot(i);
        ctx.fillRect((q.x - v.left) * s - 5 * s, (q.y - v.top) * s - 1 * s, 10 * s, 2 * s);
      }
    }
    // Щитки: целый — серый, сломанный — мигает. Узлы Альянса — панель с огоньком / искрами.
    for (const r of economy.repairs) {
      const x = (r.x - v.left) * s;
      const y = (r.y - v.top) * s;
      if (x < -20 || y < -20 || x > v.width + 20 || y > v.height + 20) continue;
      if (r.kind === 'node') {
        ctx.fillStyle = E.node;
        ctx.fillRect(x - 6 * s, y - 6 * s, 12 * s, 12 * s);
        ctx.fillStyle = r.broken ? E.nodeDead : E.nodeLight;
        ctx.fillRect(x - 3 * s, y - 3 * s, 6 * s, 6 * s);
        if (r.broken && Math.floor(now * 7 + r.index) % 3 === 0) {
          ctx.fillStyle = E.nodeSpark;
          ctx.fillRect(x + (((now * 37) % 8) - 4) * s, y - 8 * s, 2 * s, 2 * s);
          ctx.fillRect(x - (((now * 23) % 8) - 4) * s, y + 6 * s, 2 * s, 2 * s);
        }
        if (r.worker && r.broken) {
          ctx.fillStyle = E.progress;
          ctx.fillRect(x - 8 * s, y - 10 * s, 16 * s * Math.min(1, r.progress / 5), 2 * s);
        }
        continue;
      }
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
      const state = f.capture ? ` · капт ${f.capture.rebelKills}:${f.capture.cpKills}` : f.owner === 'rebels' ? ' · захвачен' : fight ? ' · бой' : '';
      const label = `${f.name.replace('Пограничный ', '')} · ${meters} м${state}`;
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

  /** Полоска прогресса действия над игроком (люк, саботаж, ремонт). */
  drawProgress(ctx: CanvasRenderingContext2D, v: View, p: Character, t: number | null): void {
    if (t === null) return;
    const s = v.scale;
    const x = (p.x - v.left) * s;
    const y = (p.y - v.top) * s - (p.radius + 8) * s;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x - 15 * s, y - 2 * s, 30 * s, 4 * s);
    ctx.fillStyle = RENDER.effects.progress;
    ctx.fillRect(x - 14 * s, y - 1 * s, 28 * s * Math.max(0, Math.min(1, t)), 2 * s);
  }

  /** Красный код — пульсирующая кромка; ранен — красная виньетка. */
  drawAlert(ctx: CanvasRenderingContext2D, v: View, code: 'green' | 'yellow' | 'red', now: number, player: Character): void {
    const hurt = player.alive ? 1 - player.health / player.maxHealth : 1;
    const red = code === 'red';
    // Жёлтый код — едва заметная янтарная кромка.
    if (code === 'yellow') {
      const g = ctx.createRadialGradient(v.width / 2, v.height / 2, Math.min(v.width, v.height) * 0.4, v.width / 2, v.height / 2, Math.hypot(v.width, v.height) / 2);
      g.addColorStop(0, 'rgba(230,170,30,0)');
      g.addColorStop(1, `rgba(230,170,30,${(0.1 + 0.04 * Math.sin(now * 3)).toFixed(3)})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, v.width, v.height);
    }
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
