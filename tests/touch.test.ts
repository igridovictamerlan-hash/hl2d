import { describe, expect, test } from 'vitest';
import { stickOf, moveOf, aimPoint, Trigger, roleButtons } from '../src/core/touch';
import { TOUCH } from '../src/config/touch';
import { CP_UNIT } from '../src/config/factions';
import type { Character } from '../src/entities/Character';

describe('сенсорное управление', () => {
  test('стик: мёртвая зона, сила, направление', () => {
    const R = 60;
    expect(stickOf(3, 2, R, 0.15).mag).toBe(0);
    const s = stickOf(30, 0, R, 0.15);
    expect(s.mag).toBeCloseTo(0.5);
    expect(s.x).toBeCloseTo(1);
    expect(s.y).toBeCloseTo(0);
    // За краем — сила 1, направление единичное.
    const e = stickOf(-200, 200, R, 0.15);
    expect(e.mag).toBe(1);
    expect(Math.hypot(e.x, e.y)).toBeCloseTo(1);
  });

  test('шаг стиком: чуть тронул — медленно, до края — шаг, далеко за край — бег', () => {
    const M = TOUCH.move;
    const slow = moveOf(stickOf(M.radius * (M.slow - 0.1), 0, M.radius, M.dead));
    expect(slow.k).toBe(M.slowSpeed);
    expect(slow.run).toBe(false);
    const walk = moveOf(stickOf(M.radius * 0.8, 0, M.radius, M.dead));
    expect(walk.k).toBe(1);
    expect(walk.run).toBe(false);
    // Полный стик (палец у края) — ещё шаг: бег в городе — нарушение, случайно не побежать.
    expect(moveOf(stickOf(M.radius * 1.1, 0, M.radius, M.dead)).run).toBe(false);
    const run = moveOf(stickOf(0, -M.radius * (M.run + 0.1), M.radius, M.dead));
    expect(run.run).toBe(true);
    expect(run.y).toBeCloseTo(-1);
    expect(moveOf(stickOf(0, 0, M.radius, M.dead)).k).toBe(0);
  });

  test('точка прицела: от игрока по направлению стика, дальше — чем сильнее отклонён', () => {
    const A = TOUCH.aim;
    const near = aimPoint(100, 100, stickOf(A.radius * (A.dead + 0.01), 0, A.radius, A.dead));
    const far = aimPoint(100, 100, stickOf(A.radius, 0, A.radius, A.dead));
    expect(near.x - 100).toBeGreaterThanOrEqual(A.min);
    expect(near.x - 100).toBeLessThan(A.min + 10);
    expect(far.x - 100).toBeCloseTo(A.max);
    expect(far.y).toBeCloseTo(100);
  });

  test('спуск: выстрел при дотягивании, повтор у края, автомат держит', () => {
    const t = new Trigger();
    expect(t.update(false, 0).pressed).toBe(false);
    const first = t.update(true, 1);
    expect(first.pressed && first.down).toBe(true);
    expect(t.update(true, 1 + TOUCH.aim.repeat / 2).pressed).toBe(false);
    expect(t.update(true, 1 + TOUCH.aim.repeat * 1.01).pressed).toBe(true);
    expect(t.update(false, 2).down).toBe(false);
    // Отпустил и снова дотянул — сразу выстрел.
    expect(t.update(true, 2.01).pressed).toBe(true);
  });

  test('ролевые кнопки: ВС — проверка, медик — лечить, глава — клич, горожанин — нет', () => {
    const c = (o: Partial<Character>) => ({ faction: 'citizen', profession: 'citizen', rank: 0, cadet: null, disguised: false, ...o }) as unknown as Character;
    expect(roleButtons(c({ faction: 'cp', profession: null, rank: CP_UNIT.pcu3 })).f).toBe('CID');
    expect(roleButtons(c({ faction: 'cwu', profession: 'cwu_medic' })).g).toBe('Лечить');
    expect(roleButtons(c({ faction: 'rebel', profession: 'rebel_leader' })).g).toBe('Клич');
    const civ = roleButtons(c({}));
    expect(civ.f).toBeNull();
    expect(civ.g).toBeNull();
  });
});
