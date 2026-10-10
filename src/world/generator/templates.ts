/**
 * ASCII-шаблоны зданий. Каноническая ориентация — ворота внизу (к магистрали на юге).
 * Легенда:
 *   M — стена Протектората      # — внутренняя стена    , — пол внутри здания
 *   c — пол камеры КПЗ     D — дверь камеры         d — дверь
 *   C — пол общей камеры (граждане и партизаны, много мест)
 *   : — двор (плитка)      g — ворота               F — стойка дежурного (пол + точка интереса)
 *   k — бетонный пол КПП   B — бетонный блок-укрытие  P — пост ВС (бетон + точка интереса)
 *   o — пустошь за городом (B на пустоши — обломки-укрытия для отрядов повстанцев)
 *   T — терминал кодов тревоги в кабинете Коменданта (пол + точка интереса)
 *   b — нары казармы ВС, w — стол канцелярии (лоялисты), q — место OTA (пол + точка интереса)
 *   Z — клетка для пойманных партизан в кабинете Коменданта (левый верхний тайл якоря 2×2)
 *   r — пол жилой комнаты (POI home), m — пол общей комнаты / гостиной, x — стол (POI dorm_table)
 *   v — сад, h — живая изгородь, t — дерево в саду (сад + POI tree)
 *   Штаб ТС: p — цех фасовки, y — конвейер (POI ration_line), u — склад коробок (POI cwu_store),
 *   l — комната отдыха, n — столовая, e — кабинет главы ТС, H — его стол (POI cwu_head_desk),
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
 * Общежитие для граждан (каноническая ориентация — вход внизу): планировка как в Управе —
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
 * Штаб ТС (вход внизу, у главного проспекта): Т-образный коридор, как в Управе, но меньше —
 * поперечный в 3 тайла с выходами по бокам и «ножка» ко входу. Сверху цех фасовки рационов с
 * тремя конвейерами и складом коробок, комната отдыха и кабинет главы ТС; по сторонам ножки —
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
 * Склад Протектората (каноническая ориентация — вход внизу): здание 32×27 и перед ним большое квадратное
 * крыльцо 14×14 за стеной Протектората (всё вместе 32×42 — чуть меньше Управы с двором). Вход один: проём в
 * ограде крыльца и дверь D в здание. Проходы везде не уже 2 тайлов — всё достижимо пешкой 2×2.
 *  s — зал хранения: S стойки для стволов вдоль стен, A стеллажи с ящиками патронов (три блока, между
 *      ними проходы); j — гранатный отсек за запертой дверью L (3 тайла), G — полки с ящиками гранат;
 *  N — мастерская оружейника: O верстак, U ящики со стволами в консервации;
 *  , — коридоры; 1 — бытовка грузчиков, 2 — стол; f — выдача: W окно в коридор, K стол кладовщика,
 *      5 — расходный стеллаж выдачи; e — контора, I — стол описи; z — караулка (экипаж конвоя), V — койки;
 *  Y — крыльцо (посадочная площадка): X места сброса, Q маяк, 4 мачты прожекторов, E посты охраны
 *      (по бокам двери и проёма — не в проходе); # — застройка по бокам от крыльца.
 */
export const ARSENAL_TEMPLATE: readonly string[] = [
  'MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM',
  'MSSSSSSSSSSSSSSSSSSSSMjjGGGGGGGM',
  'MssssssssssssssssssssLjjjjjjjjjM',
  'MssssssssssssssssssssLjjjjjjjjjM',
  'MssAAAAssAAAAssAAAAssLjjjjjjjjjM',
  'MssAAAAssAAAAssAAAAssMjjGGGGGjjM',
  'MssssssssssssssssssssMMMMMMMMMMM',
  'MssssssssssssssssssssMNNOOOUUNNM',
  'MssAAAAssAAAAssAAAAssMNNNNNNNNNM',
  'MssAAAAssAAAAssAAAAssMNNNNNNNNNM',
  'MssssssssssssssssssssMNNNNNNNNNM',
  'MSssssssssssssssssssSMNNNNNNNNNM',
  'MMMMMMMMMddddMMMMMMMMMMMMddMMMMM',
  'M,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,M',
  'M,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,M',
  'M,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,M',
  'MddMMMMMMMMMMM,,,,MMMMMMMddMMMMM',
  'M111222222111M,,,,WKfffffff5555M',
  'M111111111111M,,,,WKfffffffffffM',
  'M111111111111M,,,,MffffffffffffM',
  'M111111111111M,,,,MffffffffffffM',
  'MMMMMMMMMMMMMM,,,,MMMMMMMMMMMMMM',
  'MzzVzzVzzVzzzM,,,,MeeeeeeeIIeeeM',
  'Mzzzzzzzzzzzzd,,,,deeeeeeeeeeeeM',
  'Mzzzzzzzzzzzzd,,,,deeeeeeeeeeeeM',
  'MzzzzzzzzzzzzM,,,,MeeeeeeeeeeeeM',
  'MMMMMMMMMMMMMMDDDDMMMMMMMMMMMMMM',
  '########M4YYEYYYYYYEYY4M########',
  '########MYYYYYYYYYYYYYYM########',
  '########MYYYYYYYYYYYYYYM########',
  '########MYYXYYXYYXYYXYYM########',
  '########MYYYYYYYYYYYYYYM########',
  '########MYYYYYYYQYYYYYYM########',
  '########MYYYYYYYYYYYYYYM########',
  '########MYYYYYYYYYYYYYYM########',
  '########MYYXYYXYYXYYXYYM########',
  '########MYYYYYYYYYYYYYYM########',
  '########MYYYYYYYYYYYYYYM########',
  '########MYYYYYYYYYYYYYYM########',
  '########MYYYYYYYYYYYYYYM########',
  '########M4YEYYYYYYYYEY4M########',
  '########MMMMMYYYYYYMMMMM########',
];

/**
 * Академия ВС (каноническая ориентация — вход внизу), 34×33: здесь лоялисты учатся на рекрутов.
 * Вход один — через вахту: снаружи вестибюль в (туда пускают всех), турникет т в ограждении ь, за ним
 * вахта В с постами я (вахтёры проверяют пропуск) и стойкой дежурного Я; дальше плац п (бетон: строевая,
 * построения; ф — флагшток, б — полоса препятствий), из него — коридор , к тиру и кабинету.
 *  и — тир: ш — мишени у дальней стены, ч — огневой рубеж (стойка), ж — места стрелков (3 полосы);
 *  э — кабинет начальника курса, Э — его стол, щ — шкафы; л — класс: Д — доска на стене, Л — место
 *  преподавателя, з — парты (места курсантов за ними); г — кубрик: ц — двухъярусная койка (2×2, Ц — её
 *  остальные тайлы), щ — шкафчики; ы — столовая курсантов, Ы — столы.
 */
export const ACADEMY_TEMPLATE: readonly string[] = [
  'MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM',
  'MшиииииииииииичжиииииMэээээээээээM',
  'MииииииииииииичииииииMэээээээээээM',
  'MшиииииииииииичжиииииMээээЭЭЭээээM',
  'MииииииииииииичииииииMэээээээээээM',
  'MшиииииииииииичжиииииMээээээээээщM',
  'MииииииииииииичииииииMээээээээээщM',
  'MииииииииииииииииииииMээээээээээщM',
  'MииииииииииииииииииииMээээээээээщM',
  'MMMMMMMMMMMMMMMMMMddMMMMddMMMMMMMM',
  'M,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,M',
  'M,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,M',
  'M,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,M',
  'MMДДДДДMMddMMMMMMMMMddMMMMMMMMMMMM',
  'MллллЛллллллMпппфппппппппппппппппM',
  'MлллллллллллMппппппппппппппппппппM',
  'MззззззззлллMпппппппппппппппббпппM',
  'MлллллллллллMппппппппппппппппппппM',
  'MлллллллллллMппппппппппппппппппппM',
  'MззззззззлллMпппппппппппппппббпппM',
  'MлллллллллллMппппппппппппппппппппM',
  'MлллллллллллMппппппппппппппппппппM',
  'MMMMMMMMMMMMMпппппппппппппппббпппM',
  'MцЦгггцЦггггMппппппппппппппппппппM',
  'MЦЦгггЦЦггггdппппппппппппппппппппM',
  'MцЦгггцЦггггdппппппппппппппппппппM',
  'MЦЦгггЦЦггггMMMMddMMMMMMMMddMMMMMM',
  'MцЦгггцЦггггMыыыыыыыыMВяВВВВВВяВВM',
  'MЦЦгггЦЦггггMыыыыыыыыMВВВВВВВВВВВM',
  'MцЦгггггггггMыыЫЫЫЫыыMььььтттЯЯЯЯM',
  'MЦЦгггггггггMыыыыыыыыMвввввввввввM',
  'MщщгггггггггMыыыыыыыыMвввввввввввM',
  'MMMMMMMMMMMMMMMMMMMMMMMMMMDDDMMMMM',
];

/**
 * Тюрьма Протектората (каноническая ориентация — вход внизу), 22×45 — режимный объект. От ворот внутрь:
 * двор-площадка для корабля, приёмная, служебный коридор, шлюз между двумя решётками, блок камер.
 * Задержанных повстанцев держат здесь бессрочно, пока их не освободят свои.
 *  6 — 8 камер (двери d в коридор, до LAW.prison.cell.max мест: нары, унитаз); , — коридор; 7 — посты охраны
 *  (в коридоре блока и за стойкой приёмной); D — решётки шлюза и дверь корпуса;
 *  < — шлюз: из него дверь / в оружейную ( (стойки [ со стволами, стеллажи ] с патронами и гранатами —
 *  запас тюрьмы, пополняют конвои склада) и дверь в допросную $ (стол ~);
 *  0 — караулка (^ койки, * стол, | шкафчики); 9 — кабинет начальника, % — его стол;
 *  @ — приёмная: { стойка оформления, } — место задержанного перед ней, ; — скамья; & — изъятое, = — стеллажи;
 *  8 — двор-площадка (бетон): + — посты, ? — посадочные маяки, ! — мачты прожекторов, > — места сброса груза;
 *  проём в ограде внизу — ворота.
 */
export const PRISON_TEMPLATE: readonly string[] = [
  'MMMMMMMMMMMMMMMMMMMMMM',
  'M6666666M,7,,M6666666M',
  'M6666666d,,,,d6666666M',
  'M6666666d,,,,d6666666M',
  'M6666666M,,,,M6666666M',
  'MMMMMMMMM,,,,MMMMMMMMM',
  'M6666666M,,,,M6666666M',
  'M6666666d,,,,d6666666M',
  'M6666666d,,,,d6666666M',
  'M6666666M,,,,M6666666M',
  'MMMMMMMMM,,7,MMMMMMMMM',
  'M6666666M,,,,M6666666M',
  'M6666666d,,,,d6666666M',
  'M6666666d,,,,d6666666M',
  'M6666666M,,,,M6666666M',
  'MMMMMMMMM,,,,MMMMMMMMM',
  'M6666666M,,,,M6666666M',
  'M6666666d,,,,d6666666M',
  'M6666666d,,,,d6666666M',
  'M6666666M,,,,M6666666M',
  'MMMMMMMMMDDDDMMMMMMMMM',
  'M[[[[[[[M<<<<M$$~~$$$M',
  'M]((((((/<<<<d$$$$$$$M',
  'M]((((((/<<<<d$$$$$$$M',
  'M]](((((M<<<<M$$$$$$$M',
  'MMMMMMMMMDDDDMMMMMMMMM',
  'M^^0000|M,,,,M999%%99M',
  'M0000000d,,,,d9999999M',
  'M0000000d,,,,d9999999M',
  'M||**000M,,,,M9999999M',
  'MMMMMMMMM,,,,MMMMMMMMM',
  'M@@@{@@;;;@@@@M&&&&&=M',
  'M@7@{@}@@@@@@@M&&&&&=M',
  'M@@@@@@@@@@@@@d&&&&&=M',
  'M@@@@@@@@@@@@@d&&&&&=M',
  'M@@@@@@@@@@@@@M&&&&&=M',
  'MMMMMMMMMDDDDMMMMMMMMM',
  'M!888+8888888888+888!M',
  'M88>88888888888888>88M',
  'M88888888888888888888M',
  'M8888?8888888888?8888M',
  'M88888888888888888888M',
  'M88>88888888888888>88M',
  'M!888+8888888888+888!M',
  'MMMMMMMM888888MMMMMMMM',
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
 *  - внешний КПП (D3 / D5): двор за внешними воротами (g), блоки-укрытия, 2 поста (P), бункер ВС;
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
  'MMMMMMMMMMMMMMMMMMMMMMkkkkkkkkkkkkkkkkkkkkkkkkkMMMMMMMMMMMMMMMMMMM',
  'ooooooooooooooMMMMMMMMkkkkkkkkkkkkkkkkkkkkkkkkkMMMMMMMMMMMMMMMMMMM',
  'ooooooooooooooMMMMMMMMkkkkkkkkkkkkkkkkkkkkkkkkkMMMMMMMMMMMMMMMMMMM',
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
/** Ширина полосы пустоши в шаблоне КПП (столбцы 0…13 — пустошь с завалами). */
export const CHECKPOINT_OUTLANDS_W = 14;
/** Первый столбец проходной в шаблоне КПП. */
export const CHECKPOINT_GATEHOUSE_X = 54;
export function checkpointSection(x: number, y: number): CheckpointSection {
  if (x >= CHECKPOINT_GATEHOUSE_X) return 'gatehouse';
  if (y <= 4) return 'long';
  if (x <= 29) return 'outer';
  if (x <= 37) return 'short';
  return 'inner';
}

/**
 * Остальные типы КПП (generator/checkpoints.ts). Каждый шаблон — прямоугольник в той же ориентации
 * (пустошь на западе, город на востоке) и по тому же контракту, что и CHECKPOINT_TEMPLATE: полоса пустоши
 * `o` с лагерем-завалами слева; внешние ворота `g` (2×4 тайла на оси) → внешняя точка (2 поста `P`) → шорт и
 * лонг → внутренняя точка (3 поста `P` или `` ` ``) → внутренние ворота `g` → проходная с зигзагом и дверью `d` на
 * проспект и двумя постами RCT `R`. Проходная у всех типов одна — столбцы CHECKPOINT_STRIP_X…65 классического
 * шаблона (composeCheckpoint приставляет её к левой части, выровняв ось с ряда axisRow); так «нет ни прямой
 * видимости, ни прострела из внутреннего двора в город» выполняется для любой левой части.
 * Какая клетка к какой части КПП относится — карты частей в checkpoints.ts (по прямоугольникам).
 * Символы, которых нет в легенде выше (только в этих шаблонах):
 *   .  — открытая земля (WASTE; не `o`: по `o` считается середина пустоши — выход повстанцев);
 *   _  — траншея (TRENCH, проходима), ` — траншея с постом (checkpoint_post);
 *   "  — пропасть (CHASM: не пройти, но видно и простреливается);
 *   Ж  — скала (ROCK);  # — руины и стены бункеров (в зонах КПП вне бункеров рисуются как руины);
 *   k  — бетон/щебень (пол руин, мост, тоннель, уступы), , — пол бункера (медик ВС уходит туда на лечение).
 * Проходы везде не уже 2 тайлов (якорь 2×2), проломы в руинах — по 2 тайла, бруствер и валуны (B) не оставляют
 * карманов уже двух тайлов — тест связности требует ноль недостижимых тайлов.
 */

/**
 * «Ничейная полоса» (траншеи): 72×27, ось — ряд 13. Траншея повстанцев (зигзаг в полосе пустоши) и траншея
 * Протектората (x 34…38) смотрят друг на друга через ~31 тайл ничейной земли с воронками и обломками (B),
 * заграждением из колючей проволоки (x 11, с проходами и воротами) и двумя передовыми позициями из мешков с
 * постами P — это внешняя точка. За траншеей Протектората — руины: дорога по оси (шорт) и фланговый лонг
 * вдоль северной стены через пролом, комната-карман с юга. Внутренняя точка — вторая, короткая траншея с тремя
 * постами и бункер с дверью перед внутренними воротами.
 */
export const TRENCHES_LEFT: readonly string[] = [
  'MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM',
  'ooo__ooooo.B........................__...##..##...........',
  'ooo__ooooo.B........................__...##..##...........',
  'ooo__Boooo.B................BBB....B__....................',
  'ooo__Boooo....BB.............B.....B__.............__.....',
  'ooo__ooooo.....B....................__............B`_.....',
  'ooo__ooooo.B........BBBB..........____.####kk###..B__.....',
  'ooo____ooo.B........BP............____.####kk###...__.....',
  'ooo____ooo.B........B..........BBB__...####kk###...____...',
  'ooooo__Boo.B........BBBB.......BBB__...####kk###...____...',
  'ooooo__Boo....B...................__.................__...',
  'ooooo__ooogg......................__................B__...',
  'ooooo__ooogg.....BB...........BB..____...BB.........B`_...',
  'ooooo__ooogg.....BB...............____...............__...',
  'ooo____ooogg........................__.......BB......__...',
  'ooo____ooo.........................B__...............__...',
  'ooo__ooooo.B.......................B__.............____...',
  'ooo__Boooo.B...................BB...__.###kk####...____...',
  'ooo__Boooo.B...........BBBB....BB...__.##kkkkkk#..._`.....',
  'ooo__ooooo.B...BB......BP.........____.##kkkkkk#..........',
  'ooo__ooooo....B........B..........____.##kkBBkk#..##dd##..',
  'ooo____ooo.............BBBB.......__...##kkBBkk#..#,,,,#..',
  'ooo____Boo.B................BBB..B__...##kkkkkk#..#,,,,#..',
  'ooooo__Boo.B.....................B__...##kkkkkk#..#,,,,#..',
  'ooooo__ooo.B......................__...##kkkkkk#..#,,,,#..',
  'ooooo__ooo.B......................__...#########..######..',
  'MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM',
];   

/**
 * «Разбитый пригород»: 66×27, ось — ряд 13. Улица (дорога под огнём) идёт через руины: на западе заслон из
 * мешков и шикана у ворот, на востоке — заграждение перед внутренними воротами. Северный квартал руин
 * (дома-скорлупы с проломами в 2 тайла, поперечный переулок) и перекрёсток — внешняя точка (2 поста). Шорт —
 * сама улица. Лонг — подвальный коридор (бетон) вдоль южной кромки: вход со стебля у перекрёстка, выход
 * у заграждения. Внутренняя точка — южные дома и заграждение (3 поста), уцелевший дом с дверью — бункер.
 */
export const SUBURB_LEFT: readonly string[] = [
  'MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM',
  'ooooooooooooooMM########....########################',
  'ooooooooooooooMM#kkkkkk#..P.#kkkkkkkkkk##kkkkkkkkkk#',
  'ooooooooooooooMM#kPkkkk#....#kkkkkkkkkk##kkkkkkkkkk#',
  'ooBBooooooooooMM#kkkkkkk....kkkkkkkkkkk##kkkkkkkkkk#',
  'ooooooooooBoooMM#kkBBkkk....kkkkkBBkkkk##kkkBBkkkkk#',
  'oooooooooooBooMM#kkkkkk#....#kkkkkkkkkk##kkkkkkkkkk#',
  'ooooooBoooooooMM#kkkkkk#B...#kkkkkkkkkk##kkkkkkkkkk#',
  'ooooooBoooooooMM#kkkkkk#B...#kkkkkkkkkk##kkkkkkkkkk#',
  'ooooooooooooooMM####kk##....####kk##########kk######',
  'ooBooooooooBooMM...B............................B...',
  'ooBooooooooBoogg................................B...',
  'oooooooooooooogg.............BB.....B...............',
  'ooooooooBooooogg......B.............B............P..',
  'ooooooooBooooogg......B.............................',
  'ooooooooooooooMM...B............................B...',
  'ooooBooooooBooMM...B............................B...',
  'ooooBooooooBooMM####kkkk##########kk###dd#####kk##kk',
  'ooooooooooooooMM####kkkk########kkkkk#,,,,,#kkkkk#kk',
  'ooooooooooooooMM####kkkk########kPkkk#,,,,,#kkkkk#kk',
  'ooBBooooooooooMM####kkkk########kkkkk#,,,,,#kkkkk#kk',
  'oooooooooBooooMM####kkkk########Bkkkk#,,,,,#BkkPk#kk',
  'ooooooooooooooMM####kkkk##########################kk',
  'ooooooooooooooMM####kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk',
  'ooooooooooooooMM####kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk',
  'ooooooooooooooMM####kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk',
  'MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM',
];  

/**
 * «Горный перевал»: 66×27, ось — ряд 13. Долина между скалами (Ж); северные и южные уступы со ступенями
 * в 2 тайла — снайперские позиции (P). Поперёк долины — пропасть (CHASM, видно и простреливается насквозь)
 * с единственным мостом шириной 4 тайла (шорт); у восточного конца моста — мешки с постом и бункер в скале.
 * Лонг — старый тоннель (бетон) в северной скале: стволы входа и выхода по 2 тайла.
 */
export const PASS_LEFT: readonly string[] = [
  'MMMMMMMMMMMMMMЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖ',
  'ooooooooooooooЖЖЖЖkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkЖЖЖЖ',
  'ooooooooooooooЖЖЖЖkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkЖЖЖЖ',
  'ooooooooooooooЖЖЖЖkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkЖЖЖЖ',
  'ooBBooooooooooЖЖЖЖkkЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖkkЖЖЖЖ',
  'ooooooooooBoooЖЖЖЖkkЖЖkkkkkPkЖЖЖЖЖЖЖЖkkkkkPkЖЖkkЖЖЖЖ',
  'oooooooooooBooЖЖЖЖkkЖЖkkkkkkkЖЖЖЖЖЖЖЖkkkkkkkЖЖkkЖЖЖЖ',
  'ooooooBoooooooЖЖЖЖkkЖЖkkkkkkkЖЖЖЖЖЖЖЖkkkkkkkЖЖkkЖЖЖЖ',
  'ooooooBoooooooЖЖЖЖkkЖЖkkЖЖЖЖЖЖЖЖЖЖЖЖЖkkЖЖЖЖЖЖЖkkЖЖЖЖ',
  'ooooooooooooooЖЖ..............""""..B...............',
  'ooBooooooooBooЖЖ..............""""..BP..............',
  'ooBooooooooBoogg..........BB..kkkk.............BB...',
  'oooooooooooooogg......B.......kkkk......BB..........',
  'ooooooooBooooogg......B.......kkkk..................',
  'ooooooooBooooogg..............kkkk..................',
  'ooooooooooooooЖЖ...B..........""""..B...............',
  'ooooBooooooBooЖЖ...B.....BB...""""..B.......BB......',
  'ooooBooooooBooЖЖ..............""""..................',
  'ooooooooooooooЖЖ..............""""..................',
  'ooooooooooooooЖЖЖЖЖkkЖЖЖЖЖЖЖЖЖЖЖЖЖ###dd###ЖЖЖЖЖЖЖkkЖ',
  'ooBBooooooooooЖЖЖЖЖkkЖЖЖЖЖЖЖЖЖЖЖЖЖ#,,,,,,#ЖЖЖЖЖЖЖkkЖ',
  'oooooooooBooooЖЖЖЖЖkkkkkPkЖЖЖЖЖЖЖЖ#,,,,,,#ЖЖkPkkkkkЖ',
  'ooooooooooooooЖЖЖЖЖkkkkkkkЖЖЖЖЖЖЖЖ#,,,,,,#ЖЖkkkkkkkЖ',
  'ooooooooooooooЖЖЖЖЖkkkkkkkЖЖЖЖЖЖЖЖ#,,,,,,#ЖЖkkkkkkkЖ',
  'ooooooooooooooЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖ#,,,,,,#ЖЖЖЖЖЖЖЖЖЖ',
  'ooooooooooooooЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖ########ЖЖЖЖЖЖЖЖЖЖ',
  'MMMMMMMMMMMMMMЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖЖ',
];

/** Первый столбец общей для всех типов части классического шаблона: внутренние ворота и проходная. */
export const CHECKPOINT_STRIP_X = 52;

/**
 * Левая часть (пустошь … двор перед внутренними воротами, оканчивается перед столбцом внутренних ворот)
 * + проходная классики, выровненная по оси: ряд axisRow левой части = CHECKPOINT_AXIS_ROW шаблона.
 */
export function composeCheckpoint(left: readonly string[], axisRow: number): string[] {
  const off = axisRow - CHECKPOINT_AXIS_ROW;
  const strip = CHECKPOINT_TEMPLATE.map((r) => r.slice(CHECKPOINT_STRIP_X));
  const blank = 'M'.repeat(strip[0].length);
  return left.map((r, y) => r + (strip[y - off] ?? blank));
}

export const TRENCHES_TEMPLATE: readonly string[] = composeCheckpoint(TRENCHES_LEFT, CHECKPOINT_AXIS_ROW);
export const SUBURB_TEMPLATE: readonly string[] = composeCheckpoint(SUBURB_LEFT, CHECKPOINT_AXIS_ROW);
export const PASS_TEMPLATE: readonly string[] = composeCheckpoint(PASS_LEFT, CHECKPOINT_AXIS_ROW);

/** Зеркало по горизонтали (КПП на восточном конце проспекта). */
export function mirrorTemplate(rows: readonly string[]): string[] {
  return rows.map((r) => [...r].reverse().join(''));
}
