import { describe, it, expect } from 'vitest';
import { animOf, hurtFlash, isStriking, smokeCycle, strikeSweep } from '../src/entities/poses';
import { PAWN } from '../src/config/pawns';
import { Character } from '../src/entities/Character';
import { FISTS } from '../src/config/brawl';

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

  it('удар: корпус подаётся в сторону удара и возвращается, дубинка размахивается дугой', () => {
    const c = pawn();
    c.strikeAt = 10;
    c.strikeAng = 0;
    c.strikeKind = 'club';
    expect(isStriking(c, 9.9)).toBe(false);
    expect(isStriking(c, 10.1)).toBe(true);
    let far = 0;
    for (let t = 10; t < 10.3; t += 0.01) far = Math.max(far, animOf(c, t, false, false).dx);
    expect(far).toBeGreaterThan(1);
    expect(animOf(c, 10.5, false, false).dx).toBeCloseTo(0, 5);
    expect(strikeSweep(c, 10.01)).toBeLessThan(0);
    expect(strikeSweep(c, 10.29)).toBeGreaterThan(0);
    c.strikeKind = 'fist';
    expect(strikeSweep(c, 10.15)).toBe(0);
  });

  it('попадание отбрасывает от удара и затихает', () => {
    const c = pawn();
    c.lastHurt = 5;
    c.hurtAng = Math.PI;
    const hit = animOf(c, 5.01, false, false);
    expect(hit.dx).toBeLessThan(-1);
    expect(animOf(c, 5.5, false, false).dx).toBeCloseTo(0, 5);
  });

  it('бросок гранаты: откидывается назад, потом подаётся вперёд', () => {
    const c = pawn();
    c.throwAt = 2;
    c.throwAng = 0;
    const early = animOf(c, 2.18, false, false).lean;
    const late = animOf(c, 2.32, false, false).lean;
    expect(early).toBeLessThan(late);
    expect(Math.abs(animOf(c, 3, false, false).lean)).toBeLessThanOrEqual(PAWN.anim.idle.lean + 1e-9);
  });

  it('нокаут валит пешку, перевязка и подъём — присед', () => {
    const c = pawn();
    c.health = FISTS.floor;
    c.stunUntil = 9;
    const ko = animOf(c, 5, false, false);
    expect(ko.kind).toBe('ko');
    expect(ko.feet).toBe(false);
    const d = pawn(2);
    d.bandageUntil = 9;
    const busy = animOf(d, 5, false, false);
    expect(busy.kind).toBe('busy');
    expect(busy.squash).toBeLessThan(1);
    expect(animOf(d, 10, false, false).kind).toBe('stand');
  });

  it('вспышка попадания гаснет за время ранения', () => {
    const c = pawn();
    c.lastHurt = 1;
    expect(hurtFlash(c, 1.01)).toBeGreaterThan(0.2);
    expect(hurtFlash(c, 2)).toBe(0);
  });
});
