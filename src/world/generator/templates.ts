/**
 * ASCII-шаблоны зданий. Каноническая ориентация — ворота внизу (к магистрали на юге).
 * Легенда:
 *   M — стена Альянса      # — внутренняя стена    , — пол внутри здания
 *   c — пол камеры КПЗ     D — дверь камеры         d — дверь
 *   : — двор (плитка)      g — ворота               F — стойка дежурного (пол + точка интереса)
 *   k — бетонный пол КПП   B — бетонный блок-укрытие  P — пост ГО (бетон + точка интереса)
 *   o — пустошь за городом (B на пустоши — обломки-укрытия для отрядов повстанцев)
 * Проходимые клетки на краю шаблона — выходы: генератор прокапывает от них проход наружу.
 */
export const NEXUS_TEMPLATE: readonly string[] = [
  'MMMMMMMMMMMMMMMMMMMMMMMMMMMMMM',
  'Mcccc#cccc#cccc#cccc#,,,,,,,,M',
  'Mcccc#cccc#cccc#cccc#,,,,,,,,M',
  'Mcccc#cccc#cccc#cccc#,,,,,,,,M',
  'Mcccc#cccc#cccc#cccc#,,,,,,,,M',
  'M#DD###DD###DD###DD#####dd###M',
  'M,,,,,,,,,,,,,,,,,,,,,,,,,,,,M',
  'd,,,,,,,,,,,,,,,,,,,,,,,,,,,,d',
  'd,,,,,,,,,,,,,,,,,,,,,,,,,,,,d',
  'M####################dd######M',
  'M:::::::::::::::#,,,,,,,,,,,,M',
  'M:::::::::::::::#,,,,,,,,,,,,M',
  'M:::::::::::::::#,,,,,F,,,,,,M',
  'M:::::::::::::::d,,,,,,,,,,,,M',
  'M:::::::::::::::d,,,,,,,,,,,,M',
  'M:::::::::::::::#,,,,,,,,,,,,M',
  'M:::::::::::::::#,,,,,,,,,,,,M',
  'M:::::::::::::::#,,,,,,,,,,,,M',
  'M:::::::::::::::####dd#######M',
  'M:::::::::::::::#,,,,,,,,,,,,M',
  'M:::::::::::::::#,,,,,,,,,,,,M',
  'M:::::::::::::::#,,,,,,,,,,,,M',
  'M:::::::::::::::#,,,,,,,,,,,,M',
  'M:::::::::::::::#,,,,,,,,,,,,M',
  'M:::::::::::::::#,,,,,,,,,,,,M',
  'MMMMMggggggMMMMMMMMMMMddMMMMMM',
];

export function rotateTemplate(rows: readonly string[], rot: 0 | 180): string[] {
  if (rot === 0) return [...rows];
  return [...rows].reverse().map((r) => [...r].reverse().join(''));
}

/**
 * Пограничный КПП (каноническая ориентация: пустошь на западе, город на востоке) — как «война на D»
 * на UnionRP: два отдельных укреплённых двора, соединённых двумя проходами, как в CS.
 *  - пустошь 14 тайлов с завалами-укрытиями (B) — «ничейная земля», где собираются повстанцы;
 *  - внешний КПП (D3 / D5): двор за внешними воротами (g), блоки-укрытия, 2 поста (P), бункер ГО;
 *  - шорт — прямой короткий проход 3 тайла от внешнего двора к внутреннему;
 *  - лонг — длинный обход поверху: из внешнего двора на север, на восток, вниз во внутренний двор;
 *  - внутренний КПП (D4 / D6): двор с 3 постами, бункером и внутренними воротами к проспекту.
 * Ряды CHECKPOINT_AXIS_ROW-2 … +1 — ворота и ось (совпадает с серединой проспекта).
 * Зоны частей — checkpointSection (двор, шорт, лонг).
 */
export const CHECKPOINT_TEMPLATE: readonly string[] = [
  'MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM',
  'MMMMMMMMMMMMMMMMMMMMMMkkkkkkkBkkkkkkkkkkkkkkkkkMMMMMMMMM',
  'ooooooooooooooMMMMMMMMkkkkkkkkkkkkkkkkkkkkkkkkkMMMMMMMMM',
  'ooooooooooooooMMMMMMMMkkkkkkkkkkkkBkkkkkBkkkkkkMMMMMMMMM',
  'ooBBooooooooooMMMMMMMMkkkMMMMMMMMMMMMMMMMMMMkkkMMMMMMMMM',
  'ooooooooooBoooMMMMMMMMkkkMMMMMMMMMMMMMMMMMMMkkkMMMMMMMMM',
  'oooooooooooBooMMkkkkkkkkkkkkMMMMMMMMMMkkkkkkkkkkkkkkMMMM',
  'ooooooBoooooooMMkkkkkkkkkkkkMMMMMMMMMMkkkkkkkBkkkkkkMMMM',
  'ooooooBoooooooMMkkkkkkkkkBkkMMMMMMMMMMkkkkkkkPkkkBkkMMMM',
  'ooooooooooooooMMkkBBPkkkkkkkMMMMMMMMMMkkkBkkkkkkkkkkMMMM',
  'ooBooooooooBooMMkkkkkkkkkkkkMMMMMMMMMMkkkBkkkkkkPkkkMMMM',
  'ooBooooooooBooggkkkkkkkkkkkkkkkkkkkkkkkkkkPkkkkBkkkkggkk',
  'ooooooooooooooggkkkkkkBkkkkkkkkkkkkkkkkkkkkkkkkBkkkkggkk',
  'ooooooooBoooooggkkkkkkBkkkkkkkkkBkkkkkkkkkkkkkkkkkkkggkk',
  'ooooooooBoooooggkkBkkkkPkkkkMMMMMMMMMMkkkkkkkkkkkkkkggkk',
  'ooooooooooooooMMkkkkkkkkkkkkMMMMMMMMMMkkkBBkkkkkkkkkMMMM',
  'ooooBooooooBooMMkkkkkkkkBBkkMMMMMMMMMMkkkkkkkkkkkkkkMMMM',
  'ooooBooooooBooMM###dd#kkkkkkMMMMMMMMMMkkkkkkk##dd###MMMM',
  'ooooooooooooooMM,,,,,,kkkkkkMMMMMMMMMMkkkkkkk,,,,,,,MMMM',
  'ooooooooooooooMM,,,,,,kkkkkkMMMMMMMMMMkkkkkkk,,,,,,,MMMM',
  'ooBBooooooooooMM,,,,,,kkkkkkMMMMMMMMMMkkkkkkk,,,,,,,MMMM',
  'oooooooooBooooMM,,,,,,kkkkkkMMMMMMMMMMkkkkkkk,,,,,,,MMMM',
  'ooooooooooooooMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM',
  'ooooooooooooooMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM',
  'MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM',
];

/** Ряд шаблона КПП, совпадающий с серединой проспекта. */
export const CHECKPOINT_AXIS_ROW = 13;

/** Часть КПП по координатам шаблона в канонической ориентации (у зеркального — x отражён). */
export type CheckpointSection = 'outer' | 'short' | 'long' | 'inner';
export function checkpointSection(x: number, y: number): CheckpointSection {
  if (y <= 4) return 'long';
  if (x <= 29) return 'outer';
  if (x <= 37) return 'short';
  return 'inner';
}

/** Зеркало по горизонтали (КПП на восточном конце проспекта). */
export function mirrorTemplate(rows: readonly string[]): string[] {
  return rows.map((r) => [...r].reverse().join(''));
}
