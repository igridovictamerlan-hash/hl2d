/**
 * ASCII-шаблоны зданий. Каноническая ориентация — ворота внизу (к магистрали на юге).
 * Легенда:
 *   M — стена Альянса      # — внутренняя стена    , — пол внутри здания
 *   c — пол камеры КПЗ     D — дверь камеры         d — дверь
 *   : — двор (плитка)      g — ворота               F — стойка дежурного (пол + точка интереса)
 *   k — бетонный пол КПП   B — бетонный блок-укрытие  P — пост ГО (бетон + точка интереса)
 *   o — пустошь за городом (B на пустоши — обломки-укрытия для отрядов повстанцев)
 *   T — терминал кодов тревоги в кабинете Администратора (пол + точка интереса)
 *   b — нары казармы ГО, w — стол канцелярии (лоялисты), q — место OTA (пол + точка интереса)
 * Проходимые клетки на краю шаблона — выходы: генератор прокапывает от них проход наружу.
 */
export const NEXUS_TEMPLATE: readonly string[] = [
  'MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM',
  'Mcccc#cccc#cccc#cccc#cccc#cccc#ccccM',
  'Mcccc#cccc#cccc#cccc#cccc#cccc#ccccM',
  'Mcccc#cccc#cccc#cccc#cccc#cccc#ccccM',
  'Mcccc#cccc#cccc#cccc#cccc#cccc#ccccM',
  'M#DD###DD###DD###DD###DD###DD###DD#M',
  'M,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,M',
  'd,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,d',
  'd,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,d',
  'M################dd################M',
  'M################,,#,,,,,,,,,,,,,,,M',
  'M:::::::::::::::#,,d,,,,,,,F,,,,,,,M',
  'M:::::::::::::::#,,d,,,,,,,,,,,,,,TM',
  'M:::::::::::::::d,,#,,,,,,,,,,,,,,,M',
  'M:::::::::::::::d,,################M',
  'M:::::::::::::::#,,#,,w,,,w,,,w,,,,M',
  'M:::::::::::::::#,,d,,,,,,,,,,,,,,,M',
  'M:::::::::::::::#,,d,,w,,,w,,,w,,,,M',
  'M:::::::::::::::#,,#,,,,,,,,,,,,,,,M',
  'M:::::::::::::::#,,################M',
  'M:::::::::::::::#,,#,b,,b,,b,,b,,b,M',
  'M:::::::::::::::#,,d,,,,,,,,,,,,,,,M',
  'M:::::::::::::::#,,d,,,,,,,,,,,,,,,M',
  'M:::::::::::::::#,,#,b,,b,,b,,b,,b,M',
  'M:::::::::::::::#,,################M',
  'M:::::::::::::::#,,#,,q,,,q,,,q,,,,M',
  'M:::::::::::::::#,,d,,,,,,,,,,,,,,,M',
  'M:::::::::::::::#,,d,,,,,,,,,,,,,,,M',
  'M:::::::::::::::#,,#,,q,,,q,,,q,,,,M',
  'MMMMMggggggMMMMMMddMMMMMMMMMMMMMMMMM',
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
 *  - внутренний КПП (D4 / D6): двор с 3 постами, бункером и внутренними воротами;
 *  - проходная (x ≥ CHECKPOINT_GATEHOUSE_X) между внутренними воротами и проспектом: стена-«зигзаг»
 *    на оси перекрывает прямую видимость и прострел из двора в город, со стороны проспекта — дверь
 *    (закрыта, если рядом никого, — не пропускает ни взгляд, ни пулю), 2 поста RCT (R).
 * Ряды CHECKPOINT_AXIS_ROW-2 … +1 — ворота и ось (совпадает с серединой проспекта).
 * Зоны частей — checkpointSection (двор, шорт, лонг, проходная).
 */
export const CHECKPOINT_TEMPLATE: readonly string[] = [
  'MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM',
  'MMMMMMMMMMMMMMMMMMMMMMkkkkkkkBkkkkkkkkkkkkkkkkkMMMMMMMMMMMMMMMMMMM',
  'ooooooooooooooMMMMMMMMkkkkkkkkkkkkkkkkkkkkkkkkkMMMMMMMMMMMMMMMMMMM',
  'ooooooooooooooMMMMMMMMkkkkkkkkkkkkBkkkkkBkkkkkkMMMMMMMMMMMMMMMMMMM',
  'ooBBooooooooooMMMMMMMMkkkMMMMMMMMMMMMMMMMMMMkkkMMMMMMMMMMMMMMMMMMM',
  'ooooooooooBoooMMMMMMMMkkkMMMMMMMMMMMMMMMMMMMkkkMMMMMMMMMMMMMMMMMMM',
  'oooooooooooBooMMkkkkkkkkkkkkMMMMMMMMMMkkkkkkkkkkkkkkMMkkkkkkkkkMMM',
  'ooooooBoooooooMMkkkkkkkkkkkkMMMMMMMMMMkkkkkkkBkkkkkkMMkkkkkkRkkMMM',
  'ooooooBoooooooMMkkkkkkkkkBkkMMMMMMMMMMkkkkkkkPkkkBkkMMkkkkkkkkkMMM',
  'ooooooooooooooMMkkBBPkkkkkkkMMMMMMMMMMkkkBkkkkkkkkkkMMkkkkkkkkkMMM',
  'ooBooooooooBooMMkkkkkkkkkkkkMMMMMMMMMMkkkBkkkkkkPkkkMMkkkMMMkkkMMM',
  'ooBooooooooBooggkkkkkkkkkkkkkkkkkkkkkkkkkkPkkkkBkkkkggkkkMMMkkkdkk',
  'ooooooooooooooggkkkkkkBkkkkkkkkkkkkkkkkkkkkkkkkBkkkkggkkkMMMkkkdkk',
  'ooooooooBoooooggkkkkkkBkkkkkkkkkBkkkkkkkkkkkkkkkkkkkggkkkMMMkkkdkk',
  'ooooooooBoooooggkkBkkkkPkkkkMMMMMMMMMMkkkkkkkkkkkkkkggkkkMMMkkkdkk',
  'ooooooooooooooMMkkkkkkkkkkkkMMMMMMMMMMkkkBBkkkkkkkkkMMkkkkkkkkkMMM',
  'ooooBooooooBooMMkkkkkkkkBBkkMMMMMMMMMMkkkkkkkkkkkkkkMMkkkkkkkkkMMM',
  'ooooBooooooBooMM###dd#kkkkkkMMMMMMMMMMkkkkkkk##dd###MMkkkkkkRkkMMM',
  'ooooooooooooooMM,,,,,,kkkkkkMMMMMMMMMMkkkkkkk,,,,,,,MMkkkkkkkkkMMM',
  'ooooooooooooooMM,,,,,,kkkkkkMMMMMMMMMMkkkkkkk,,,,,,,MMMMMMMMMMMMMM',
  'ooBBooooooooooMM,,,,,,kkkkkkMMMMMMMMMMkkkkkkk,,,,,,,MMMMMMMMMMMMMM',
  'oooooooooBooooMM,,,,,,kkkkkkMMMMMMMMMMkkkkkkk,,,,,,,MMMMMMMMMMMMMM',
  'ooooooooooooooMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM',
  'ooooooooooooooMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM',
  'MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM',
];

/** Ряд шаблона КПП, совпадающий с серединой проспекта. */
export const CHECKPOINT_AXIS_ROW = 13;

/** Часть КПП по координатам шаблона в канонической ориентации (у зеркального — x отражён). */
export type CheckpointSection = 'outer' | 'short' | 'long' | 'inner' | 'gatehouse';
/** Первый столбец проходной в шаблоне КПП. */
export const CHECKPOINT_GATEHOUSE_X = 54;
export function checkpointSection(x: number, y: number): CheckpointSection {
  if (x >= CHECKPOINT_GATEHOUSE_X) return 'gatehouse';
  if (y <= 4) return 'long';
  if (x <= 29) return 'outer';
  if (x <= 37) return 'short';
  return 'inner';
}

/** Зеркало по горизонтали (КПП на восточном конце проспекта). */
export function mirrorTemplate(rows: readonly string[]): string[] {
  return rows.map((r) => [...r].reverse().join(''));
}
