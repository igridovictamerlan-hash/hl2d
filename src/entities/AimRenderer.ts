import type { Character } from './Character';
import type { View } from '../core/Camera';
import type { GameMap } from '../world/GameMap';
import type { CombatSystem } from '../systems/CombatSystem';
import { castRay } from '../world/visibility';
import { FACTIONS } from '../config/factions';
import { RENDER } from '../config/render';
import { WEAPONS, type WeaponDef } from '../config/items';
import { lerp } from '../core/math';

const DEG = Math.PI / 180;
const dist: number[] = [];

/**
 * Конус прицела как в Foxhole: из персонажа выходит треугольник разброса (полуугол — текущий
 * разброс оружия: сужается при прицеливании, расширяется от движения и отдачи), на предельной
 * дальности — дуга. Заливка обрезается стенами лучами DDA: видно, куда реально долетят пули.
 * Штрихами — дальность полного урона. Во время перезарядки дуга серая и заполняется по мере готовности.
 * У игрока конус виден всегда (от бедра — бледный), у NPC — только когда он ведёт цель.
 */
export class AimRenderer {
  /** Конусы NPC (до тумана войны: вне обзора игрока они притушены туманом). */
  drawNpcCones(ctx: CanvasRenderingContext2D, v: View, map: GameMap, combat: CombatSystem, list: readonly Character[], alpha: number, showAll: boolean): void {
    for (const c of list) {
      if (c.isPlayer || !c.alive || !c.aiming || !c.weapon || (!c.visible && !showAll)) continue;
      const w = WEAPONS[c.weapon];
      if (w.mode === 'melee') continue;
      this.cone(ctx, v, map, combat, c, w, alpha, false);
    }
  }

  /** Конус игрока (после тумана — всегда отчётливо). */
  drawPlayerCone(ctx: CanvasRenderingContext2D, v: View, map: GameMap, combat: CombatSystem, p: Character, alpha: number): void {
    if (!p.alive || !p.weapon || p.brain) return;
    const w = WEAPONS[p.weapon];
    if (w.mode === 'melee') return this.meleeReach(ctx, v, p, w, alpha);
    this.cone(ctx, v, map, combat, p, w, alpha, true);
  }

  /** Взмахи дубинкой. */
  drawSwings(ctx: CanvasRenderingContext2D, v: View, combat: CombatSystem): void {
    const s = v.scale;
    const T = RENDER.tracers;
    for (const sw of combat.swings) {
      const x = (sw.x - v.left) * s;
      const y = (sw.y - v.top) * s;
      ctx.globalAlpha = Math.min(1, sw.t / 0.18);
      ctx.fillStyle = sw.hit ? T.swingHit : T.swing;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y, sw.reach * s, sw.ang - sw.half, sw.ang + sw.half);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private meleeReach(ctx: CanvasRenderingContext2D, v: View, c: Character, w: WeaponDef, alpha: number): void {
    const s = v.scale;
    const x = (lerp(c.prevX, c.x, alpha) - v.left) * s;
    const y = (lerp(c.prevY, c.y, alpha) - v.top) * s;
    const half = w.spreadHip * DEG;
    const r = (c.radius + w.range) * s;
    ctx.strokeStyle = `rgba(${RENDER.aim.player},0.45)`;
    ctx.lineWidth = Math.max(1, 1.3 * s);
    ctx.beginPath();
    ctx.arc(x, y, r, c.facing - half, c.facing + half);
    ctx.stroke();
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
