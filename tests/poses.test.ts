import { describe, it, expect } from 'vitest';
import { animOf, smokeCycle } from '../src/entities/poses';
import { PAWN } from '../src/config/pawns';
import { Character } from '../src/entities/Character';

function pawn(id = 1): Character {
  return new Character({ id, faction: 'citizen', name: 'Т', cid: '1', x: 0, y: 0 });
}

describe('бытовые анимации пешек', () => {
  it('идущая пешка — без добавок', () => {
    const c = pawn();
    c.asleep = true;
    const a = animOf(c, 3, true, false);
    expect(a.kind).toBe('stand');
    expect(a.squash).toBe(1);
    expect(a.feet).toBe(true);
  });

  it('спящий лежит: ниже ростом, ступней нет, дышит', () => {
    const c = pawn();
    c.asleep = true;
    const sizes = new Set<number>();
    for (let t = 0; t < 4; t += 0.2) {
      const a = animOf(c, t, false, false);
      expect(a.kind).toBe('sleep');
      expect(a.feet).toBe(false);
      expect(a.squash).toBeLessThan(1);
      sizes.add(Math.round(a.squash * 1e4));
    }
    expect(sizes.size).toBeGreaterThan(3);
  });

  it('сидящий садится и прячет ступни', () => {
    const c = pawn();
    c.seated = 'eat';
    const a = animOf(c, 1, false, false);
    expect(a.kind).toBe('sit');
    expect(a.drop).toBe(PAWN.anim.sit.drop);
    expect(a.feet).toBe(false);
  });

  it('стоящий без дела переносит вес, а целящийся и присевший — нет', () => {
    const c = pawn();
    let swing = 0;
    for (let t = 0; t < 6; t += 0.25) swing = Math.max(swing, Math.abs(animOf(c, t, false, false).lean));
    expect(swing).toBeGreaterThan(0.01);
    expect(swing).toBeLessThanOrEqual(PAWN.anim.idle.lean + 1e-9);
    expect(animOf(c, 1, false, true).lean).toBe(0);
    c.crouch = true;
    expect(animOf(c, 1, false, false).lean).toBe(0);
  });

  it('фазы у пешек разные — толпа не дышит в такт', () => {
    const a = animOf(pawn(1), 2, false, false).lean;
    const b = animOf(pawn(2), 2, false, false).lean;
    expect(a).not.toBeCloseTo(b, 5);
  });

  it('перекур: рука поднимается ко рту, потом выдох, и снова вниз', () => {
    const c = pawn();
    const out = { raise: 0, exhale: -1 };
    let up = 0;
    let exhaled = false;
    for (let t = 0; t < PAWN.anim.smoke.period * 2; t += 0.05) {
      smokeCycle(c, t, out);
      expect(out.raise).toBeGreaterThanOrEqual(0);
      expect(out.raise).toBeLessThanOrEqual(1);
      up = Math.max(up, out.raise);
      if (out.exhale >= 0) {
        exhaled = true;
        expect(out.exhale).toBeLessThanOrEqual(1);
      }
    }
    expect(up).toBe(1);
    expect(exhaled).toBe(true);
  });
});
