import { TOUCH } from '../config/touch';
import { cpHas } from '../config/factions';
import type { Character } from '../entities/Character';

/**
 * Положение стика: направление (единичное; 0,0 — в мёртвой зоне), сила 0..1 и «вытяг» far — сдвиг пальца в
 * радиусах без ограничения (палец ушёл за край).
 */
export interface Stick {
  x: number;
  y: number;
  mag: number;
  far: number;
}

/** Стик по сдвигу пальца от центра (px): сила — доля радиуса, в мёртвой зоне — ноль. */
export function stickOf(dx: number, dy: number, radius: number, dead: number): Stick {
  const d = Math.hypot(dx, dy);
  const far = d / radius;
  const mag = Math.min(1, far);
  if (mag <= dead || d === 0) return { x: 0, y: 0, mag: 0, far: 0 };
  return { x: dx / d, y: dy / d, mag, far };
}

/**
 * Шаг стиком: направление, бег и множитель скорости (чуть тронул — медленный шаг). Бег — только если палец
 * увели далеко за край (TOUCH.move.run радиусов): бег в городе — нарушение, случайно бежать нельзя.
 */
export function moveOf(s: Stick): { x: number; y: number; run: boolean; k: number } {
  const M = TOUCH.move;
  if (s.mag === 0) return { x: 0, y: 0, run: false, k: 0 };
  return { x: s.x, y: s.y, run: s.far >= M.run, k: s.mag < M.slow ? M.slowSpeed : 1 };
}

/** Точка прицела в мире: от игрока по направлению стика, дальше — чем сильнее отклонён. */
export function aimPoint(px: number, py: number, s: Stick): { x: number; y: number } {
  const A = TOUCH.aim;
  const t = Math.max(0, (s.mag - A.dead) / (1 - A.dead));
  const d = A.min + (A.max - A.min) * t;
  return { x: px + s.x * d, y: py + s.y * d };
}

/**
 * Спуск стика прицела: дотянул до кольца — выстрел (pressed), автомат — держит спуск (down), полуавтомат и
 * удар — повтор каждые TOUCH.aim.repeat с, пока держите у края.
 */
export class Trigger {
  private was = false;
  private next = 0;

  update(pulled: boolean, now: number): { down: boolean; pressed: boolean } {
    let pressed = false;
    if (pulled && (!this.was || now >= this.next)) {
      pressed = true;
      this.next = now + TOUCH.aim.repeat;
    }
    this.was = pulled;
    return { down: pulled, pressed };
  }

  reset(): void {
    this.was = false;
    this.next = 0;
  }
}

/**
 * Ролевые кнопки (F — действие роли, G — умение): подпись, если у персонажа есть такое действие,
 * иначе null (кнопка спрятана).
 */
export function roleButtons(c: Character): { f: string | null; g: string | null } {
  const f = c.faction === 'cp' && !c.cadet ? 'CID' : null;
  let g: string | null = null;
  if (c.profession === 'cwu_medic' || c.profession === 'rebel_medic') g = 'Лечить';
  else if (c.profession === 'rebel_leader' && c.faction === 'rebel') g = 'Клич';
  else if (c.profession === 'spec_agent' && c.faction === 'rebel') g = 'Бунт';
  else if (c.profession === 'partisan') g = c.disguised ? 'Снять личину' : 'Личина';
  else if (c.faction === 'cp') g = cpHas(c, 'drone') ? 'Сканер' : cpHas(c, 'medic') ? 'Лечить' : cpHas(c, 'barrier') ? 'Блок' : null;
  return { f, g };
}
