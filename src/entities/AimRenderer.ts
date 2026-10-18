import type { Character } from './Character';
import type { View } from '../core/Camera';
import type { GameMap } from '../world/GameMap';
import type { CombatSystem } from '../systems/CombatSystem';
import { castRay } from '../world/visibility';
import { FACTIONS } from '../config/factions';
import { RENDER } from '../config/render';
import { WEAPONS, type WeaponDef } from '../config/items';
import { lerp } from '../core/math';
import { MELEE_LOOK, type MeleeStyle } from '../config/melee';
import { GUARD_ARC } from './meleePose';

const DEG = Math.PI / 180;
const dist: number[] = [];
/** Цвета следов ударов и дуг — строки один раз, не на кадр. */
const TRAIL_RGB: Record<MeleeStyle, string> = {
  fists: `rgb(${MELEE_LOOK.trail.color.fists})`,
  baton: `rgb(${MELEE_LOOK.trail.color.baton})`,
  blade: `rgb(${MELEE_LOOK.trail.color.blade})`,
};
const REACH_RGB = `rgb(${MELEE_LOOK.reach})`;
const GUARD_RGB = `rgb(${MELEE_LOOK.guard})`;

/**
 * Конус прицела как в Foxhole: из персонажа выходит треугольник разброса (полуугол — текущий
 * разброс оружия: сужается при прицеливании, расширяется от движения и отдачи), на предельной
 * дальности — дуга. Заливка обрезается стенами лучами DDA: видно, куда реально долетят пули.
 * Штрихами — дальность полного урона. Во время перезарядки дуга серая и заполняется по мере готовности.
 * У игрока конус виден всегда (от бедра — бледный), у NPC — только когда он ведёт цель.
 */
export class AimRenderer {
  /** Конусы NPC (до тумана войны: вне обзора игрока они притушены туманом); блок в драке — дуга-щит. */
  drawNpcCones(ctx: CanvasRenderingContext2D, v: View, map: GameMap, combat: CombatSystem, list: readonly Character[], alpha: number, showAll: boolean): void {
    for (const c of list) {
      if (c.isPlayer || !c.alive || (!c.visible && !showAll)) continue;
      if (c.melee.block) this.guardArc(ctx, v, c, alpha, 0.35);
      if (!c.aiming || !c.weapon) continue;
      const w = WEAPONS[c.weapon];
      if (w.mode === 'melee') continue;
      this.cone(ctx, v, map, combat, c, w, alpha, false);
    }
  }

  /** Конус игрока (после тумана — всегда отчётливо); холодное оружие и кулаки — дуга следующего удара. */
  drawPlayerCone(ctx: CanvasRenderingContext2D, v: View, map: GameMap, combat: CombatSystem, p: Character, alpha: number): void {
    if (!p.alive || p.brain) return;
    const w = p.weapon ? WEAPONS[p.weapon] : null;
    if (!w || w.mode === 'melee') return this.meleeReach(ctx, v, combat, p, alpha);
    this.cone(ctx, v, map, combat, p, w, alpha, true);
  }

  /**
   * Следы ударов (config/melee MELEE_LOOK.trail): у дуги — серп по краю взмаха, толщина растёт к
   * острию; у выпада — клин от корпуса к кончику. Тянутся за sweep с, гаснут за fade с (хвост догоняет).
   */
  drawSwings(ctx: CanvasRenderingContext2D, v: View, combat: CombatSystem, alpha: number, showAll: boolean): void {
    const s = v.scale;
    const L = MELEE_LOOK.trail;
    for (const sw of combat.melee.swings) {
      const c = sw.by;
      if (!c.visible && !showAll) continue;
      const age = sw.life - sw.t;
      const head = Math.min(1, age / L.sweep);
      const tail = age <= L.sweep ? 0 : Math.min(1, (age - L.sweep) / L.fade);
      if (head - tail < 0.02) continue;
      const x = (lerp(c.prevX, c.x, alpha) - v.left) * s;
      const y = (lerp(c.prevY, c.y, alpha) - v.top) * s;
      const w = L.width[sw.style] * (sw.heavy ? 1.45 : 1) * s;
      const R = sw.reach * s;
      ctx.globalAlpha = (sw.hit ? L.hitAlpha : L.alpha) * (1 - tail * 0.5);
      ctx.fillStyle = TRAIL_RGB[sw.style];
      ctx.beginPath();
      if (sw.motion === 'slash') {
        const a0 = sw.ang - sw.side * sw.half;
        const span = 2 * sw.half * sw.side;
        const n = L.segments;
        for (let i = 0; i <= n; i++) {
          const a = a0 + span * (tail + ((head - tail) * i) / n);
          if (i) ctx.lineTo(x + Math.cos(a) * R, y + Math.sin(a) * R);
          else ctx.moveTo(x + Math.cos(a) * R, y + Math.sin(a) * R);
        }
        for (let i = n; i >= 0; i--) {
          const k = i / n;
          const a = a0 + span * (tail + (head - tail) * k);
          const r = R - w * Math.pow(k, 0.7);
          ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
        }
      } else {
        const base = c.radius * 0.6;
        const r0 = (base + (sw.stop - base) * tail) * s;
        const r1 = (base + (sw.stop - base) * head) * s;
        const rb = r1 - Math.min(r1 - r0, w * 1.6);
        const cs = Math.cos(sw.ang);
        const sn = Math.sin(sw.ang);
        const hw = w * 0.5;
        ctx.moveTo(x + cs * r0, y + sn * r0);
        ctx.lineTo(x + cs * rb - sn * hw, y + sn * rb + cs * hw);
        ctx.lineTo(x + cs * r1, y + sn * r1);
        ctx.lineTo(x + cs * rb + sn * hw, y + sn * rb - cs * hw);
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /** Блок поднят — дуга-щит перед корпусом (полуугол блока). */
  private guardArc(ctx: CanvasRenderingContext2D, v: View, c: Character, alpha: number, a: number): void {
    const s = v.scale;
    const x = (lerp(c.prevX, c.x, alpha) - v.left) * s;
    const y = (lerp(c.prevY, c.y, alpha) - v.top) * s;
    ctx.strokeStyle = GUARD_RGB;
    ctx.globalAlpha = a;
    ctx.lineWidth = Math.max(1.5, 2.2 * s);
    ctx.beginPath();
    ctx.arc(x, y, (c.radius + 5) * s, c.facing - GUARD_ARC, c.facing + GUARD_ARC);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /**
   * Холодное оружие и кулаки (кулаки — только в стойке): дуга дальности и ширины следующего удара серии
   * (тяжёлый — толще), пока удар не готов — бледная; в блоке — дуга-щит.
   */
  private meleeReach(ctx: CanvasRenderingContext2D, v: View, combat: CombatSystem, c: Character, alpha: number): void {
    const style = combat.melee.styleOf(c);
    const m = c.melee;
    if (!style || (style === 'fists' && !m.engaged && !m.block)) return;
    if (m.block) return this.guardArc(ctx, v, c, alpha, 0.6);
    const s = v.scale;
    const x = (lerp(c.prevX, c.x, alpha) - v.left) * s;
    const y = (lerp(c.prevY, c.y, alpha) - v.top) * s;
    const strike = combat.melee.nextStrike(c, style);
    const half = strike.arc * DEG;
    const r = combat.melee.reachOf(c, style) * s;
    ctx.strokeStyle = REACH_RGB;
    ctx.globalAlpha = combat.melee.ready(c) ? MELEE_LOOK.reachAlpha : MELEE_LOOK.reachAlpha * 0.4;
    ctx.lineWidth = Math.max(1, (strike.heavy ? 2.2 : 1.3) * s);
    ctx.beginPath();
    ctx.arc(x, y, r, c.facing - half, c.facing + half);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private cone(ctx: CanvasRenderingContext2D, v: View, map: GameMap, combat: CombatSystem, c: Character, w: WeaponDef, alpha: number, player: boolean): void {
    const A = RENDER.aim;
    const s = v.scale;
    const wx = lerp(c.prevX, c.x, alpha);
    const wy = lerp(c.prevY, c.y, alpha);
    const range = w.range;
    // Конус за пределами экрана целиком — не рисуем.
    if (wx + range < v.left || wx - range > v.left + v.width / s || wy + range < v.top || wy - range > v.top + v.height / s) return;
    const half = Math.max(0.2, combat.spreadOf(c, w)) * DEG;
    const dir = c.facing;
    const x = (wx - v.left) * s;
    const y = (wy - v.top) * s;
    const rgb = player ? A.player : FACTIONS[c.faction].authority ? A.combine : c.faction === 'rebel' ? A.rebel : A.neutral;
    const aimK = player ? c.aim : 0;

    // Заливка: лучи по сектору, каждый — до первой стены.
    const n = Math.min(A.maxRays, Math.max(4, Math.ceil((2 * half) / (A.rayStepDeg * DEG))));
    dist.length = n + 1;
    for (let k = 0; k <= n; k++) {
      const a = dir - half + (2 * half * k) / n;
      dist[k] = castRay(map, wx, wy, Math.cos(a), Math.sin(a), range);
    }
    ctx.fillStyle = `rgba(${rgb},${player ? lerp(A.fillHip, A.fillAim, aimK) : A.fillNpc})`;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k <= n; k++) {
      const a = dir - half + (2 * half * k) / n;
      ctx.lineTo(x + Math.cos(a) * dist[k] * s, y + Math.sin(a) * dist[k] * s);
    }
    ctx.closePath();
    ctx.fill();

    // Стороны треугольника — от края кружка до дальности (сквозь стены — как контур).
    const r0 = (c.radius + 2) * s;
    const R = range * s;
    ctx.strokeStyle = `rgba(${rgb},${player ? lerp(A.edgeHip, A.edgeAim, aimK) : A.edgeNpc})`;
    ctx.lineWidth = Math.max(1, s);
    ctx.beginPath();
    for (const a of [dir - half, dir + half]) {
      ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
      ctx.lineTo(x + Math.cos(a) * R, y + Math.sin(a) * R);
    }
    ctx.stroke();

    // Дальность полного урона — штрихами (у дробовика и ПП заметно ближе предельной).
    if (w.effectiveRange < range * 0.95) {
      ctx.setLineDash([3 * s, 4 * s]);
      ctx.beginPath();
      ctx.arc(x, y, w.effectiveRange * s, dir - half, dir + half);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Дуга на предельной дальности; при перезарядке — серая, заполняется по мере готовности.
    const reloading = combat.reloading(c);
    const steady = player && c.aim > 0.98 && c.recoil < 0.3;
    const arcA = player ? A.arc : A.arcNpc;
    ctx.lineWidth = Math.max(1.5, (player ? 2.2 : 1.4) * s);
    ctx.lineCap = 'round';
    if (reloading) {
      const t = w.perRound ? 0.5 : 1 - (c.reloadUntil - combat.now) / w.reload;
      ctx.strokeStyle = `rgba(${A.reload},${arcA * 0.5})`;
      ctx.beginPath();
      ctx.arc(x, y, R, dir - half, dir + half);
      ctx.stroke();
      ctx.strokeStyle = `rgba(${A.reload},${arcA})`;
      ctx.beginPath();
      ctx.arc(x, y, R, dir - half, dir - half + 2 * half * Math.max(0, Math.min(1, t)));
      ctx.stroke();
    } else {
      ctx.strokeStyle = `rgba(${steady ? A.steady : rgb},${arcA})`;
      ctx.beginPath();
      ctx.arc(x, y, R, dir - half, dir + half);
      ctx.stroke();
      // Засечки на концах дуги — как у Foxhole.
      const tick = 5 * s;
      ctx.beginPath();
      for (const a of [dir - half, dir + half]) {
        ctx.moveTo(x + Math.cos(a) * (R - tick), y + Math.sin(a) * (R - tick));
        ctx.lineTo(x + Math.cos(a) * (R + tick), y + Math.sin(a) * (R + tick));
      }
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }
}
