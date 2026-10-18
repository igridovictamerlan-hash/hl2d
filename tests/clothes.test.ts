import { describe, expect, it } from 'vitest';
import { CLOTHES } from '../src/config/clothes';
import { bootColor, drawPawn, type PawnDir, type PawnLook } from '../src/entities/PawnRenderer';

/** Холст-заглушка: считает вызовы рисования, свойства принимает молча. */
function fakeCtx(): { ctx: CanvasRenderingContext2D; calls: Map<string, number> } {
  const calls = new Map<string, number>();
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get(target, key) {
      if (key in target) return target[key];
      return (..._args: unknown[]) => { calls.set(String(key), (calls.get(String(key)) ?? 0) + 1); };
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

const DIRS: PawnDir[] = ['S', 'N', 'E', 'W'];

describe('одежда по достатку', () => {
  it('у каждого достатка по шесть комплектов, коды не повторяются', () => {
    for (const tier of ['poor', 'middle', 'rich'] as const) {
      expect(CLOTHES.sets.filter((s) => s.look.tier === tier)).toHaveLength(6);
    }
    expect(new Set(CLOTHES.sets.map((s) => s.code)).size).toBe(CLOTHES.sets.length);
  });

  it('каждый комплект рисуется со всех сторон, save/restore парные', () => {
    for (const set of CLOTHES.sets) {
      for (const dir of DIRS) {
        const { ctx, calls } = fakeCtx();
        const look: PawnLook = { faction: 'citizen', rank: 0, color: '#6a6f75', seed: set.seed, clothes: set.look };
        expect(() => drawPawn(ctx, look, 0, 0, 2, dir), `${set.code} ${dir}`).not.toThrow();
        expect(calls.get('save'), `${set.code} ${dir}`).toBe(calls.get('restore'));
        expect(calls.get('fill') ?? 0).toBeGreaterThan(5);
      }
    }
  });

  it('обувь — из комплекта, без комплекта — по фракции', () => {
    const set = CLOTHES.sets[0];
    expect(bootColor({ faction: 'citizen', clothes: set.look })).toBe(set.look.boots);
    expect(bootColor({ faction: 'citizen' })).not.toBe(set.look.boots);
  });
});
