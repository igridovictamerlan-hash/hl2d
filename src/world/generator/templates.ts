/**
 * ASCII-шаблоны зданий. Каноническая ориентация — ворота внизу (к магистрали на юге).
 * Легенда:
 *   M — стена Альянса      # — внутренняя стена    , — пол внутри здания
 *   c — пол камеры КПЗ     D — дверь камеры         d — дверь
 *   C — пол общей камеры (граждане и партизаны, много мест)
 *   : — двор (плитка)      g — ворота               F — стойка дежурного (пол + точка интереса)
 *   k — бетонный пол КПП   B — бетонный блок-укрытие  P — пост ГО (бетон + точка интереса)
 *   o — пустошь за городом (B на пустоши — обломки-укрытия для отрядов повстанцев)
 *   T — терминал кодов тревоги в кабинете Администратора (пол + точка интереса)
 *   b — нары казармы ГО, w — стол канцелярии (лоялисты), q — место OTA (пол + точка интереса)
 *   Z — клетка для пойманных партизан в кабинете Администратора (левый верхний тайл якоря 2×2)
 *   r — пол жилой комнаты (POI home), m — пол общей комнаты / гостиной, x — стол (POI dorm_table)
 *   v — сад, h — живая изгородь, t — дерево в саду (сад + POI tree)
 *   Штаб ГСР: p — цех фасовки, y — конвейер (POI ration_line), u — склад коробок (POI cwu_store),
 *   l — комната отдыха, n — столовая, e — кабинет главы ГСР, H — его стол (POI cwu_head_desk),
 *   a — приёмная, J — стойка найма (POI cwu_hire)
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
  'M,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,M',
  'M###############,,,,###############M',
  'MCCCCCCCCCCCCCC#,,,,#,,,,,,,,,,Z,Z,M',
  'MCCCCCCCCCCCCCC#,,,,d,,,,,,,F,,,,,,M',
  'MCCCCCCCCCCCCCCD,,,,d,,,,,,,,,,,,,TM',
  'MCCCCCCCCCCCCCCD,,,,###############M',
  'MCCCCCCCCCCCCCC#,,,,#,,w,,,w,,,w,,,M',
  'MCCCCCCCCCCCCCC#,,,,d,,,,,,,,,,,,,,M',
  'M###############,,,,d,,w,,,w,,,w,,,M',
  'M::::::::::::::#,,,,#,,,,,,,,,,,,,,M',
  'M::::::::::::::#,,,,###############M',
  'M::::::::::::::#,,,,#,b,,b,,b,,b,,bM',
  'M::::::::::::::#,,,,d,,,,,,,,,,,,,,M',
  'M::::::::::::::d,,,,d,,,,,,,,,,,,,,M',
  'M::::::::::::::d,,,,#,b,,b,,b,,b,,bM',
  'M::::::::::::::#,,,,###############M',
  'M::::::::::::::#,,,,#,,q,,,q,,,q,,,M',
  'M::::::::::::::#,,,,d,,,,,,,,,,,,,,M',
  'M::::::::::::::#,,,,d,,,,,,,,,,,,,,M',
  'M::::::::::::::#,,,,#,,q,,,q,,,q,,,M',
  'MMMMMggggggMMMMMMddMMMMMMMMMMMMMMMMM',
];

/**
 * Общежитие для граждан (каноническая ориентация — вход внизу): планировка как в Нексусе —
 * Т-образный коридор (поперечный в 3 тайла с выходами по бокам и «ножка» к входу), по сторонам
 * комнаты r (POI home — каждая комната для одной семьи), общая комната m со столом x (карты).
 */
export const DORM_TEMPLATE: readonly string[] = [
  '#####################',
  '#rrrr#rrrr#rrrr#rrrr#',
  '#rrrr#rrrr#rrrr#rrrr#',
  '#rrrr#rrrr#rrrr#rrrr#',
  '##dd###dd###dd###dd##',
  '#,,,,,,,,,,,,,,,,,,,#',
  'd,,,,,,,,,,,,,,,,,,,d',
  'd,,,,,,,,,,,,,,,,,,,d',
  '###dd####,,,####dd###',
  '#rrrrrrr#,,,#rrrrrrr#',
  '#rrrrrrr#,,,#rrrrrrr#',
  '#rrrrrrr#,,,#rrrrrrr#',
  '#########,,,#########',
  '#mmmmmmm#,,,#rrrrrrr#',
  '#mmmxmmmd,,,drrrrrrr#',
  '#mmmmmmmd,,,drrrrrrr#',
  '#########ddd#########',
];

/**
 * Штаб ГСР (вход внизу, у главного проспекта): Т-образный коридор, как в Нексусе, но меньше —
 * поперечный в 3 тайла с выходами по бокам и «ножка» ко входу. Сверху цех фасовки рационов с
 * тремя конвейерами и складом коробок, комната отдыха и кабинет главы ГСР; по сторонам ножки —
 * приёмная со стойкой найма (сюда граждане приходят устраиваться) и столовая.
 */
export const CWU_HQ_TEMPLATE: readonly string[] = [
  '#########################',
  '#pypppyppppyp#lllll#eeee#',
  '#pppppppppppp#lllll#eeHe#',
  '#pppppppppppp#lllll#eeee#',
  '#pppppppppppp#lllll#eeee#',
  '#ppppppppppup#lllll#eeee#',
  '#####dd########dd####dd##',
  '#,,,,,,,,,,,,,,,,,,,,,,,#',
  'd,,,,,,,,,,,,,,,,,,,,,,,d',
  'd,,,,,,,,,,,,,,,,,,,,,,,d',
  '###########,,,###########',
  '#aaaaaaaaa#,,,#nnnnnnnnn#',
  '#aaaaJaaaad,,,dnnnnnnnnn#',
  '#aaaaaaaaad,,,dnnnnnnnnn#',
  '#aaaaaaaaa#,,,#nnnnnnnnn#',
  '#aaaaaaaaa#,,,#nnnnnnnnn#',
  '###########ddd###########',
];

/**
 * Особняк богатого лоялиста (вход внизу): живая изгородь h, сад v с деревьями t, дом — спальня r
 * (POI home) и гостиная m (POI villa_living: ковёр, диван), парадная дверь в сад, калитка в изгороди.
 */
export const VILLA_TEMPLATE: readonly string[] = [
  'hhhhhhhhhhhhhhhh',
  'hvvvvvtvvvvtvvvh',
  'hvvvvvvvvvvvvvvh',
  'hvv##########vvh',
  'hvv#rrr#mmmm#vvh',
  'hvv#rrrdmmmm#vvh',
  'hvv#rrrdmmmm#vvh',
  'hvv#rrr#mmmm#vvh',
  'hvv######dd##vvh',
  'hvvvvvvvvvvvvvvh',
  'hvtvvvvvvvvvvvvh',
  'hvvvvvvvvvvvvtvh',
  'hvvvvvvvvvvvvvvh',
  'hhhhhhvvvvhhhhhh',
];

/**
 * Шаблон со входом (канонически внизу) в сторону face: S — как есть, N — поворот на 180°,
 * W — по часовой стрелке, E — против часовой.
 */
export function faceTemplate(rows: readonly string[], face: 'N' | 'S' | 'E' | 'W'): string[] {
  const h = rows.length;
  const w = rows[0].length;
  if (face === 'S') return [...rows];
  if (face === 'N') return rotateTemplate(rows, 180);
  const out: string[] = [];
  if (face === 'W') for (let x = 0; x < w; x++) out.push(Array.from({ length: h }, (_, y) => rows[h - 1 - y][x]).join(''));
  else for (let x = w - 1; x >= 0; x--) out.push(Array.from({ length: h }, (_, y) => rows[y][x]).join(''));
  return out;
}

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
