import { describe, expect, it } from 'vitest';
import { lookCatalog } from '../src/dev/pixelLooks';
import { resolve } from '../src/entities/pixel/pixelSpec';
import { bodyOffset, frameGrid, newFrame, unitX, unitY, upperShift, HandRecorder, type PixelFrame } from '../src/entities/pixel/pixelPawn';
import { isPixelStyle, loadPawnStyle, pawnStyle, setPawnStyle } from '../src/entities/pixel/pawnStyle';
import { PIXEL } from '../src/config/pixelPawns';
import { drawHandProps } from '../src/entities/poses';
import type { Grid } from '../src/entities/pixel/grid';
import type { Character } from '../src/entities/Character';
import type { PawnDir } from '../src/entities/PawnRenderer';

/** Верхняя и нижняя занятые строки сетки (в координатах силуэта). */
function rows(g: Grid): [number, number] {
  let top = Infinity;
  let bottom = -Infinity;
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (g.px(x, y)) { top = Math.min(top, y - g.oy); bottom = Math.max(bottom, y - g.oy); }
  return [top, bottom];
}
const frame = (dir: PawnDir, extra: Partial<PixelFrame> = {}): PixelFrame => ({ ...newFrame(), dir, ...extra });

describe('пиксельные пешки', () => {
  const catalog = lookCatalog();

  it('каталог: все стороны, профессии и комплекты ателье', () => {
    expect(catalog.length).toBeGreaterThan(55);
  });

  it('внешность разбирается для всех: цвета заданы, у формы — шлемы и броня', () => {
    for (const e of catalog) {
      const p = resolve(e.look);
      for (const c of [p.skin, p.hair, p.top, p.pants, p.boots, p.hand, p.sleeve]) expect(c, `${e.title}`).toMatch(/^(#|rgb)/);
    }
    const by = (t: string) => resolve(catalog.find((e) => e.title === t)!.look);
    expect(by('Патрульный').head).toBe('flak');
    expect(by('Патрульный').face).toBe('gas');
    expect(by('Патрульный').armor).toBe('flak');
    expect(by('LGN.ALPHA').head).toBe('marine');
    expect(by('LGN.ALPHA').bigPads).toBe(true);
    expect(by('Ветеран').head).toBe('mich');
    expect(by('Поднадзорный').number).not.toBeNull();
    expect(by('Поднадзорный').beacon).not.toBeNull();
    expect(by('Н1 Ватник').head).toBe('ushanka');
    expect(by('Н1 Ватник').outer).toBe('quilted');
    expect(by('Медик ТС').cross).not.toBeNull();
    expect(by('Повар ТС').head).toBe('chef');
  });

  it('каждая пешка рисуется со всех сторон, стоя, в шаге, на бегу, присев и сидя — подошвы на земле', () => {
    const legs: PixelFrame['legs'][] = ['stand', 'walk', 'run', 'crouch', 'sit'];
    for (const e of catalog) {
      for (const dir of ['S', 'E', 'N', 'W'] as PawnDir[]) {
        for (const l of legs) {
          const g = frameGrid(e.look, frame(dir, { legs: l, frame: 3 }));
          const [top, bottom] = rows(g);
          expect(Number.isFinite(top), `${e.title} ${dir} ${l}`).toBe(true);
          // Подошвы — у земли (контур на строку ниже), выше головы — не дальше высокой шляпы.
          expect(bottom, `${e.title} ${dir} ${l}`).toBeGreaterThanOrEqual(PIXEL.ground - 2);
          expect(bottom, `${e.title} ${dir} ${l}`).toBeLessThanOrEqual(PIXEL.ground);
          expect(top, `${e.title} ${dir} ${l}`).toBeGreaterThanOrEqual(-PIXEL.grid.oy + 1);
        }
      }
    }
  });

  it('присел — голова ниже; запад — зеркало востока; в траншее — по пояс', () => {
    const look = catalog.find((e) => e.title === 'Солдат')!.look;
    expect(upperShift('crouch', 0)).toBe(4);
    expect(rows(frameGrid(look, frame('S', { legs: 'crouch' })))[0]).toBeGreaterThan(rows(frameGrid(look, frame('S')))[0]);
    // Стоя на выдохе (кадр 1) — корпус на пиксель ниже.
    expect(rows(frameGrid(look, frame('S', { frame: 1 })))[0]).toBe(rows(frameGrid(look, frame('S')))[0] + 1);
    const e = frameGrid(look, frame('E', { legs: 'walk', frame: 2 }));
    const w = frameGrid(look, frame('W', { legs: 'walk', frame: 2 }));
    const axis = 2 * (PIXEL.cx + e.ox);
    let same = 0;
    let total = 0;
    for (let y = 0; y < e.h; y++) for (let x = 0; x < e.w; x++) {
      if (!e.px(x, y)) continue;
      total++;
      if (w.px(axis - x, y)) same++;
    }
    expect(same).toBe(total);
    expect(rows(frameGrid(look, frame('S', { cut: PIXEL.trenchCut })))[1]).toBeLessThanOrEqual(PIXEL.trenchCut + 1);
  });

  it('шаг: ноги в кадрах разные, подскок на проходе ноги — плавно, без скачков больше пикселя', () => {
    const look = catalog[0].look;
    const a = frameGrid(look, frame('E', { legs: 'walk', frame: 0 }));
    const b = frameGrid(look, frame('E', { legs: 'walk', frame: 2 }));
    expect(a.c.join()).not.toBe(b.c.join());
    // Проход ноги (фаза 0) — корпус выше, чем на шаге (фаза ¼); бег — выше и с выносом вперёд.
    expect(bodyOffset('walk', 0)[1]).toBeLessThan(bodyOffset('walk', 0.25)[1]);
    expect(bodyOffset('run', 0)[1]).toBeLessThan(bodyOffset('walk', 0)[1]);
    expect(bodyOffset('run', 0.3)[0]).toBeGreaterThan(0);
    // Подъём меняется плавно: на 1/64 цикла — меньше десятой пикселя силуэта.
    for (let t = 0; t < 1; t += 1 / 64) {
      const d = Math.abs(bodyOffset('run', t + 1 / 64)[1] - bodyOffset('run', t)[1]);
      expect(d).toBeLessThan(0.2);
    }
    // Кадров на цикл бега — не меньше, чем шага (ноги не прыгают через позы).
    expect(PIXEL.runFrames).toBeGreaterThanOrEqual(PIXEL.walkFrames);
  });

  it('руки к делу: запись поз фасолины — сигарета у рта, рука от плеча', () => {
    const c = { id: 7, pid: 7, smoking: true, seated: '', speech: null, weapon: null } as unknown as Character;
    const R = new HandRecorder();
    let found = false;
    for (let t = 0; t < 7 && !found; t += 0.05) {
      R.reset();
      drawHandProps(R.ctx, c, catalog[0].look, 0, 0, 1, 'S', t);
      const f = newFrame();
      R.into(f);
      expect(f.hands.length).toBe(1);
      expect(f.sticks.length).toBe(1);
      if (f.hands[0].y < 13) found = true;
    }
    expect(found).toBe(true);
    // Рука с сигаретой — своя, рука той стороны опущена не рисуется: в кадре на одну «кисть» меньше в опущенных.
    expect(unitY(-10.5)).toBeCloseTo(8);
    expect(unitX(0)).toBe(PIXEL.cx);
  });

  it('стиль: по умолчанию — пиксельные, переключается и без браузера не падает', () => {
    expect(loadPawnStyle()).toBe(PIXEL.defaultStyle);
    setPawnStyle('bean');
    expect(isPixelStyle()).toBe(false);
    setPawnStyle('pixel');
    expect(pawnStyle()).toBe('pixel');
  });
});
