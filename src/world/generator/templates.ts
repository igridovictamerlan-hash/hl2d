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
 * Пограничный КПП (каноническая ориентация: пустошь на западе, город на востоке).
 * Длинный коридор 4 тайла с шахматными укрытиями — место «коридорной рубки»;
 * ворота с обеих сторон, бункеры ГО сверху и снизу с дверями в коридор.
 */
export const CHECKPOINT_TEMPLATE: readonly string[] = [
  'MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM',
  'MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM',
  'ooooooMM,,,,,,,,,,#,,,,,,,,,MMMMMMMM',
  'ooooooMM,,,,,,,,,,#,,,,,,,,,MMMMMMMM',
  'ooBoooMM,,,,,,,,,,#,,,,,,,,,MMMMMMMM',
  'ooBoooMM,,,,,,,,,,#,,,,,,,,,MMMMMMMM',
  'ooooooMM,,,,,,,,,,#,,,,,,,,,MMMMMMMM',
  'ooooooMM####dd#########dd####MMMMMMM',
  'ooBoooggkkkBkkkkkkkBkkkkkPkkggkkkkkk',
  'ooBoooggkkkBkkkkkkkBkkkkkkkkggkkkkkk',
  'ooooooggkkkkkkkBkkkkkkkBkkkkggkkkkkk',
  'ooooooggkkkkkkkBkkkkkkkBkPkkggkkkkkk',
  'ooooooMM###dd###########dd##MMMMMMMM',
  'oooBooMM,,,,,,,,,,#,,,,,,,,,MMMMMMMM',
  'oooBooMM,,,,,,,,,,#,,,,,,,,,MMMMMMMM',
  'ooooooMM,,,,,,,,,,#,,,,,,,,,MMMMMMMM',
  'ooooooMM,,,,,,,,,,#,,,,,,,,,MMMMMMMM',
  'ooooooMM,,,,,,,,,,#,,,,,,,,,MMMMMMMM',
  'MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM',
  'MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM',
];

/** Зеркало по горизонтали (КПП на восточном конце проспекта). */
export function mirrorTemplate(rows: readonly string[]): string[] {
  return rows.map((r) => [...r].reverse().join(''));
}
