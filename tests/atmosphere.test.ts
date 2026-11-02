import { describe, expect, test } from 'vitest';
import { cycleNight, cycleQuality, defaultAtmo, effective, parseAtmo, preset, serializeAtmo, simplify, toggle } from '../src/world/atmosphere';
import { ATMOSPHERE, LIGHTING } from '../src/config/lighting';
import { dayState } from '../src/world/Lighting';
import { sunTint } from '../src/world/shadows';

describe('атмосфера: настройки', () => {
  test('по умолчанию — высокое качество, всё включено; прежний ключ «выкл» переносится', () => {
    const d = defaultAtmo();
    expect(d.on).toBe(true);
    expect(d.quality).toBe(ATMOSPHERE.defaultQuality);
    expect(parseAtmo(null).on).toBe(true);
    expect(parseAtmo(null, '0').on).toBe(false);
    expect(parseAtmo(null, '1').on).toBe(true);
    // Битое и чужое — по умолчанию, лишнее — мимо.
    expect(parseAtmo('{не json')).toEqual(d);
    expect(parseAtmo(JSON.stringify({ quality: 'ультра', night: 'полярная', glow: 'да' }))).toEqual(d);
  });

  test('сохранение и чтение — то же самое', () => {
    let s = defaultAtmo();
    s = cycleQuality(s);
    s = cycleNight(s);
    s = toggle(s, 'clouds');
    expect(parseAtmo(serializeAtmo(s))).toEqual(s);
  });

  test('качество по кругу выставляет пресет; эффект — свой выключатель', () => {
    let s = defaultAtmo();
    expect(s.quality).toBe('high');
    s = cycleQuality(s);
    expect(s.quality).toBe('medium');
    expect({ glow: s.glow, clouds: s.clouds, shadows: s.shadows, life: s.life, film: s.film }).toEqual(preset('medium'));
    s = cycleQuality(cycleQuality(s));
    expect(s.quality).toBe('high');
    s = toggle(s, 'glow');
    expect(s.glow).toBe(false);
    expect(s.quality).toBe('high');
    expect(cycleNight(cycleNight(cycleNight(s))).night).toBe(s.night);
  });

  test('слабая машина: качество на ступень ниже, на низком — дальше некуда', () => {
    const s = defaultAtmo();
    const a = simplify(s)!;
    expect(a.quality).toBe('medium');
    expect(a.auto).toBe(true);
    const b = simplify(a)!;
    expect(b.quality).toBe('low');
    expect(simplify(b)).toBeNull();
    expect(simplify({ ...s, on: false })).toBeNull();
    // Сами выбрали качество — снова не «снижено само».
    expect(cycleQuality(b).auto).toBe(false);
  });

  test('что рисуется: выключено главное — свет и частицы выкл, тени от солнца — по своему выключателю', () => {
    const s = defaultAtmo();
    const on = effective(s);
    expect(on.lighting && on.glow && on.haze && on.clouds && on.fireflies && on.grain && on.vignette).toBe(true);
    expect(on.lightScale).toBe(ATMOSPHERE.presets.high.lightScale);
    const off = effective(toggle(s, 'on'));
    expect(off.lighting || off.glow || off.clouds || off.smoke || off.grain || off.vignette || off.pawnShadows).toBe(false);
    expect(off.sunShadows).toBe(true);
    const low = effective(simplify(simplify(s)!)!);
    expect(low.lightScale).toBeLessThan(on.lightScale);
    expect(low.glow || low.clouds || low.grain).toBe(false);
    expect(effective({ ...s, night: 'bright' }).nightLift).toBeGreaterThan(0);
    expect(effective({ ...s, night: 'dark' }).nightLift).toBeLessThan(0);
  });
});

describe('палитра суток и тени', () => {
  test('добрая ночь: синяя, но читается; золотой час и синий час; тень не чёрная', () => {
    const night = dayState(0.95).ambient;
    // Ночь синяя (не серая), но не чёрная: самый тёмный канал — не ниже 90.
    expect(night[2]).toBeGreaterThan(night[0] + 50);
    expect(Math.min(...night)).toBeGreaterThan(90);
    // Перед закатом — тёплое золото, сразу после заката — сиреневые сумерки, фонари уже горят.
    const golden = dayState(0.72);
    expect(golden.ambient[0]).toBeGreaterThan(golden.ambient[2] + 80);
    const blue = dayState(0.81);
    expect(blue.ambient[2]).toBeGreaterThan(blue.ambient[1]);
    expect(blue.lamps).toBe(1);
    // Солнце садится в LIGHTING.sun.set — к этому часу ещё тепло.
    const set = dayState(LIGHTING.sun.set - 0.03);
    expect(set.ambient[0]).toBeGreaterThan(set.ambient[2]);
    // Тень днём — холодная синяя, у горизонта — сиреневая.
    const noon = sunTint(0.5);
    expect(noon[2]).toBeGreaterThan(noon[0]);
    const low = sunTint(0.03);
    expect(low[0]).toBeGreaterThan(noon[0]);
    expect(Math.max(...noon)).toBeGreaterThan(0);
  });
});
