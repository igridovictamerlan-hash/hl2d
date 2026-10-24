// Превью генератора: карта по сидам в PNG (цвета мини-карты, рельеф скал, метки зданий) и проверка карты.
// Запуск из корня репозитория:
//   SEEDS=12345,7919 npx vitest run --config .claude/skills/map-preview/scripts/vitest.config.mjs map
// Переменные: SEEDS (12345), SCALE — пикселей на тайл (2), CROP="x,y,w,h" — участок в тайлах (с SCALE 6–8 — крупно),
// MARKS=0 — без меток, OUT (/tmp/hl2d-map). Результат: OUT/map_<сид>[_crop].png; в консоль — размер, попытка генератора,
// время, проверка (validateMap), метрики и легенда меток (то же — в OUT/report.txt).
import { test } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { generateCity, validateMap } from '../../../../src/world/generator/CityGenerator';
import { MINIMAP } from '../../../../src/config/minimap';
import { RENDER } from '../../../../src/config/render';
import * as relief from '../../../../src/world/relief';
import { writePng } from './png';

const env = process.env;
const OUT = (env.OUT ?? '/tmp/hl2d-map').replace(/\/?$/, '/');

/** Метки: тип POI → цвет (квадрат 7×7 пикселей в центре точки). */
const MARKS: [string, [number, number, number], string][] = [
  ['plaza_center', [255, 230, 0], 'площадь'],
  ['nexus_gate', [60, 140, 255], 'ворота Управы'],
  ['cwu_hq', [255, 140, 0], 'штаб ТС'],
  ['canteen', [255, 120, 200], 'столовая'],
  ['arsenal', [255, 255, 255], 'склад'],
  ['prison', [200, 80, 255], 'тюрьма'],
  ['academy', [0, 240, 240], 'академия'],
  ['restricted_gate', [255, 0, 0], 'ворота запретной зоны'],
  ['hatch', [0, 255, 0], 'люк'],
  ['checkpoint_type', [255, 60, 60], 'КПП'],
  ['dugout', [170, 120, 60], 'блиндаж'],
  ['rebel_camp', [255, 200, 0], 'лагерь'],
  ['border_post', [255, 40, 40], 'пост на границе районов'],
];

test('map', () => {
  mkdirSync(OUT, { recursive: true });
  const seeds = (env.SEEDS ?? '12345').split(',').map(Number);
  const S = Number(env.SCALE ?? 2);
  const crop = env.CROP ? env.CROP.split(',').map(Number) : null;
  const lines: string[] = [];
  for (const seed of seeds) {
    const t0 = performance.now();
    const map = generateCity(seed);
    const ms = Math.round(performance.now() - t0);
    const problems = validateMap(map);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const st: any = map.stats ?? {};
    lines.push(
      `${seed}: ${map.width}×${map.height}, попытка ${st.attempt ?? '?'}, ${ms} мс, застройка ${((st.buildingRatio ?? 0) * 100).toFixed(1)}%, прямая ${st.longestAlleyRun ?? '?'}, люков ${map.hatches?.length ?? '?'}` +
        (problems.length ? ` · ПРОБЛЕМЫ: ${problems.join('; ')}` : ' · проверка пройдена'),
    );
    // Рельеф скал (если есть в этой версии кода) — светлее с высотой, снег на гребнях.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rockRelief = (relief as any).rockRelief as ((t: Uint8Array, w: number, h: number, s: number) => Uint8Array) | undefined;
    const lv = rockRelief ? rockRelief(map.tiles, map.width, map.height, seed) : null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ridge: any = (RENDER.tiles as any).ridge;
    const [x0, y0, cw, ch] = crop ?? [0, 0, map.width, map.height];
    const W = cw * S;
    const H = ch * S;
    const rgb = new Uint8Array(W * H * 3);
    const put = (X: number, Y: number, c: readonly number[]) => {
      if (X < 0 || Y < 0 || X >= W || Y >= H) return;
      const k = (Y * W + X) * 3;
      rgb[k] = c[0];
      rgb[k + 1] = c[1];
      rgb[k + 2] = c[2];
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const districtAt = (map as any).districtAt as ((x: number, y: number) => string | null) | undefined;
    const tint: Record<string, number[]> = { slum: [40, -10, -20], upper: [-15, 25, 10] };
    for (let y = y0; y < y0 + ch; y++) {
      for (let x = x0; x < x0 + cw; x++) {
        if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
        const i = y * map.width + x;
        let [r, g, b] = (MINIMAP.tiles as Record<number, number[]>)[map.tiles[i]] ?? [255, 0, 255];
        const l = lv ? lv[i] : 255;
        if (l !== 255) {
          if (ridge && l >= ridge.snowLevel && MINIMAP.snow) [r, g, b] = MINIMAP.snow as unknown as number[];
          else {
            r += l * 7;
            g += l * 7;
            b += l * 8;
          }
        }
        const d = districtAt?.call(map, x, y);
        const t = d ? tint[d] : null;
        if (t) {
          r += t[0] * 0.6;
          g += t[1] * 0.6;
          b += t[2] * 0.6;
        }
        const c = [Math.max(0, Math.min(255, r)), Math.max(0, Math.min(255, g)), Math.max(0, Math.min(255, b))];
        for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) put((x - x0) * S + dx, (y - y0) * S + dy, c);
      }
    }
    if (env.MARKS !== '0') {
      for (const [type, col] of MARKS) {
        for (const p of map.poisOf(type as never)) {
          const cx = (p.x + ((p.w ?? 1) >> 1) - x0) * S;
          const cy = (p.y + ((p.h ?? 1) >> 1) - y0) * S;
          for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) put(cx + dx, cy + dy, col);
        }
      }
    }
    const file = `${OUT}map_${seed}${crop ? '_crop' : ''}.png`;
    writePng(file, W, H, rgb);
    lines.push(`   → ${file} (${W}×${H})`);
  }
  if (env.MARKS !== '0') lines.push(`метки: ${MARKS.map(([, c, name]) => `${name} rgb(${c.join(',')})`).join(', ')}`);
  writeFileSync(`${OUT}report.txt`, lines.join('\n') + '\n');
  console.log(lines.join('\n'));
});
