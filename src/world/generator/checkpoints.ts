import { Rng, hash2 } from '../../core/rng';
import { GENERATOR, type CheckpointType } from '../../config/generator';
import {
  CHECKPOINT_TEMPLATE,
  CHECKPOINT_AXIS_ROW,
  CHECKPOINT_OUTLANDS_W,
  checkpointSection,
  mirrorTemplate,
  TRENCHES_TEMPLATE,
  SUBURB_TEMPLATE,
  PASS_TEMPLATE,
} from './templates';

/**
 * Типы пограничных КПП. У каждого — шаблон (прямоугольник в канонической ориентации: пустошь на западе,
 * город на востоке, ось на ряду axisRow совпадает с серединой проспекта) и карта частей — какая клетка к
 * какой части КПП относится. Контракт частей, на котором держится «война на D» (WarSystem.buildFronts):
 *   o — внешний двор (точка D3 / D5, 2 поста P): повстанцы берут его первым;
 *   s — шорт, l — лонг: два пути от внешней точки к внутренней (шорт ближе к оси);
 *   i — внутренний двор (D4 / D6, 3 поста) вместе с внутренними воротами g;
 *   g — проходная (2 поста RCT R, зигзаг, дверь на проспект — оттуда нет ни прямой видимости, ни прострела);
 *   - — пустошь за внешними воротами (зона outlands: лагерь-завалы, откуда расходится армия).
 * Внешние ворота g — группа ближе всех к пустоши, внутренние — дальше всех.
 */
export type SectionChar = 'o' | 's' | 'l' | 'i' | 'g' | '-';

export interface CheckpointDef {
  type: CheckpointType;
  /** Как называется для игрока. */
  name: string;
  rows: readonly string[];
  /** Часть КПП на каждую клетку шаблона: строки той же длины и высоты, что rows. */
  sections: readonly string[];
  /** Ряд шаблона, совпадающий с серединой проспекта. */
  axisRow: number;
  /** Ширина полосы пустоши слева. */
  outlandsW: number;
  w: number;
  h: number;
}

/** Прямоугольник части: символ, x0, y0, x1, y1 (включительно); рисуются по порядку — поздний поверх раннего. */
type SectionRect = readonly [SectionChar, number, number, number, number];

function paintSections(w: number, h: number, rects: readonly SectionRect[]): string[] {
  const grid = Array.from({ length: h }, () => Array<string>(w).fill('-'));
  for (const [c, x0, y0, x1, y1] of rects) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) grid[y][x] = c;
  }
  return grid.map((r) => r.join(''));
}

function define(type: CheckpointType, name: string, rows: readonly string[], axisRow: number, outlandsW: number, sections: readonly string[]): CheckpointDef {
  const w = rows[0].length;
  const h = rows.length;
  if (rows.some((r) => r.length !== w)) throw new Error(`КПП ${type}: ряды шаблона разной длины`);
  if (sections.length !== h || sections.some((r) => r.length !== w)) throw new Error(`КПП ${type}: карта частей не совпадает с шаблоном`);
  return { type, name, rows, sections, axisRow, outlandsW, w, h };
}

const classicSections = CHECKPOINT_TEMPLATE.map((r, y) => Array.from(r, (_, x) => (x < CHECKPOINT_OUTLANDS_W ? '-' : sectionChar(checkpointSection(x, y)))).join(''));

function sectionChar(s: ReturnType<typeof checkpointSection>): SectionChar {
  return s === 'outer' ? 'o' : s === 'short' ? 's' : s === 'long' ? 'l' : s === 'inner' ? 'i' : 'g';
}

export const CHECKPOINTS: Readonly<Record<CheckpointType, CheckpointDef>> = {
  classic: define('classic', 'Классический КПП', CHECKPOINT_TEMPLATE, CHECKPOINT_AXIS_ROW, CHECKPOINT_OUTLANDS_W, classicSections),
  // Внешняя точка — траншея Протектората и две передовые позиции в ничейной земле; шорт — дорога через руины,
  // лонг — фланговый коридор вдоль северной стены; внутренняя точка — вторая траншея с бункером.
  trenches: define('trenches', 'Ничейная полоса', TRENCHES_TEMPLATE, CHECKPOINT_AXIS_ROW, 10, paintSections(72, 27, [
    ['o', 10, 0, 38, 26],
    ['l', 39, 0, 47, 9],
    ['s', 39, 10, 47, 26],
    ['i', 48, 0, 59, 26],
    ['g', 60, 0, 71, 26],
  ])),
  // Внешняя точка — северные руины и перекрёсток; шорт — улица; лонг — подвальный коридор вдоль южной кромки;
  // внутренняя точка — южные дома и заграждение у ворот.
  suburb: define('suburb', 'Разбитый пригород', SUBURB_TEMPLATE, CHECKPOINT_AXIS_ROW, 14, paintSections(66, 27, [
    ['o', 14, 0, 27, 26],
    ['s', 28, 0, 39, 16],
    ['i', 40, 0, 53, 16],
    ['i', 28, 17, 53, 22],
    ['l', 24, 23, 53, 26],
    ['l', 50, 17, 51, 22],
    ['g', 54, 0, 65, 26],
  ])),
  // Внешняя точка — западная часть долины с уступами; шорт — мост через пропасть; лонг — тоннель в северной
  // скале (стволы входа и выхода по 2 тайла); внутренняя точка — восточная часть долины с бункером.
  pass: define('pass', 'Горный перевал', PASS_TEMPLATE, CHECKPOINT_AXIS_ROW, 14, paintSections(66, 27, [
    ['o', 14, 0, 27, 26],
    ['s', 28, 0, 35, 26],
    ['i', 36, 0, 53, 26],
    ['g', 54, 0, 65, 26],
    ['l', 16, 0, 47, 3],
    ['l', 18, 4, 19, 8],
    ['l', 46, 4, 47, 8],
  ])),
};

/** Шаблон и карта частей для КПП с учётом зеркала (восточный конец проспекта). */
export function checkpointRows(def: CheckpointDef, mirror: boolean): { rows: string[]; sections: string[] } {
  return mirror
    ? { rows: mirrorTemplate(def.rows), sections: mirrorTemplate(def.sections) }
    : { rows: [...def.rows], sections: [...def.sections] };
}

/**
 * Типы двух КПП карты — [западный, восточный]. Из GENERATOR.checkpoints.types отдельным потоком случайности
 * (seed карты, не зависит от попытки и не сдвигает остальной генератор), разные; forceTypes — как задано.
 */
export function pickCheckpointTypes(seed: number): [CheckpointType, CheckpointType] {
  const C = GENERATOR.checkpoints;
  const forced = C.forceTypes;
  if (forced && forced.length) return [forced[0], forced[Math.min(1, forced.length - 1)]];
  const pool = new Rng(hash2(seed, 0xc9c9, 14)).shuffle([...C.types]);
  return [pool[0] ?? 'classic', pool[1] ?? pool[0] ?? 'classic'];
}

/** Для тестов и отладки: задать типы КПП [запад, восток] (один элемент — для обоих) или снять принуждение (null). */
export function setForcedCheckpointTypes(types: readonly CheckpointType[] | null): void {
  (GENERATOR.checkpoints as { forceTypes: readonly CheckpointType[] | null }).forceTypes = types;
}
