import type { FactionId } from './factions';

/**
 * Профессии (по мотивам HL2RP-сервера UnionRP, City-17). У фракции — список профессий; у персонажа —
 * одна (Character.profession). Профессия даёт набор предметов (kit), работу и особые умения
 * (perks — текст для меню выбора роли). Ранги ВС и повстанцев и отряды ВС — отдельно (factions.ts).
 */
export type ProfessionId =
  // Граждане.
  | 'citizen'
  | 'thief'
  | 'outcast'
  | 'bandit'
  | 'gang_boss'
  | 'fugitive'
  // ТС.
  | 'cook'
  | 'packer'
  | 'courier'
  | 'janitor'
  | 'cwu_medic'
  | 'cwu_head'
  | 'loader'
  | 'armorer'
  | 'vendor'
  | 'canteen_cook'
  // Сопротивление.
  | 'rebel_recruit'
  | 'rebel_soldier'
  | 'rebel_medic'
  | 'pyro'
  | 'partisan'
  | 'spec_agent'
  | 'rebel_leader'
  | 'veteran'
  | 'demolitionist'
  // HYDRA — спецотряд сопротивления.
  | 'commando'
  | 'hydra_sergeant'
  | 'hydra_rct'
  | 'hydra_sniper'
  // Поднадзорные.
  | 'vort_slave'
  // Синтеты Протектората.
  | 'cremator'
  | 'ota_alpha'
  | 'ota_king';

export interface ProfessionDef {
  id: ProfessionId;
  faction: FactionId;
  name: string;
  desc: string;
  /** Набор предметов (KITS); без него — набор фракции. */
  kit?: string;
  /** Что умеет (строки для меню). */
  perks: string[];
  /** Можно выбрать игроку. */
  selectable: boolean;
}

export const PROFESSIONS: Record<ProfessionId, ProfessionDef> = {
  citizen: {
    id: 'citizen', faction: 'citizen', name: 'Гражданин', selectable: true,
    desc: 'Живёт по правилам Протектората: очереди, рационы, проверки документов.',
    perks: ['Лояльность растёт — привилегии лоялиста (бег без нарушения, очередь впереди)', 'Доверенный лоялист: /охрана — два юнита ВС сопровождают'],
  },
  thief: {
    id: 'thief', faction: 'citizen', name: 'Вор', kit: 'thief', selectable: true,
    desc: 'Кражи со взломом и карманные кражи. Попадётесь ВС на глаза — арест.',
    perks: ['E за спиной у прохожего — вытащить токены (увидит ВС — погоня)', 'E у окна раздачи, когда оно закрыто, — взломать раздатчик рационов', 'Добыча больше обычной'],
  },
  outcast: {
    id: 'outcast', faction: 'citizen', name: 'Отброс общества', kit: 'outcast', selectable: true,
    desc: 'Живёт на улице, роется в мусоре. Лояльности у Протектората нет.',
    perks: ['E у кучи мусора — порыться: чаще находит полезное', 'Может носить оружие для самозащиты (если поймают — проблемы)'],
  },
  cook: {
    id: 'cook', faction: 'cwu', name: 'Повар ТС', kit: 'cwu_cook', selectable: true,
    desc: 'Раздаёт рационы у будки на площади и торгует едой за прилавком магазина.',
    perks: ['E у окна раздачи — встать на выдачу (оплата за рацион)', 'E у прилавка магазина — работать продавцом', 'Рационы берутся со склада будки — его пополняют курьеры'],
  },
  packer: {
    id: 'packer', faction: 'cwu', name: 'Фасовщик ТС', kit: 'cwu', selectable: true,
    desc: 'Собирает рационы в цехе штаба ТС у главного проспекта.',
    perks: ['E у конвейера цеха — собрать коробку рационов (оплата за коробку)'],
  },
  courier: {
    id: 'courier', faction: 'cwu', name: 'Курьер ТС', kit: 'cwu', selectable: true,
    desc: 'Носит коробки рационов со склада штаба ТС к будке раздачи.',
    perks: ['E у склада цеха — взять коробку', 'E у будки раздачи — сдать (оплата за доставку)'],
  },
  janitor: {
    id: 'janitor', faction: 'cwu', name: 'Уборщик ТС', kit: 'cwu', selectable: true,
    desc: 'Убирает мусор на улицах и чинит щитки в переулках.',
    perks: ['E у кучи мусора — убрать (оплата)', 'E у поломки — починить (нужен набор инструментов)'],
  },
  cwu_head: {
    id: 'cwu_head', faction: 'cwu', name: 'Глава ТС', kit: 'cwu_head', selectable: false,
    desc: 'Руководит штабом ТС: принимает граждан на работу, отчитывается перед инспектором SU.',
    perks: ['Сидит в кабинете штаба, выходит к стойке найма', 'Зарплата выше, чем у рабочих'],
  },
  cwu_medic: {
    id: 'cwu_medic', faction: 'cwu', name: 'Медик ТС', kit: 'cwu_medic', selectable: true,
    desc: 'Лечит граждан за токены, сотрудников ВС — бесплатно.',
    perks: ['G — вылечить того, кто перед вами (гражданин платит)', 'Аптечки в наборе, пополняются у прилавка магазина'],
  },
  loader: {
    id: 'loader', faction: 'cwu', name: 'Грузчик склада ТС', kit: 'cwu', selectable: true,
    desc: 'Работает на складе Протектората на окраине: разгружает контейнер с корабля ГЭС и грузит ящики для гарнизонов КПП.',
    perks: ['E у ящика на площадке — взять, E в зале склада — сдать (оплата за ящик)', 'E в зале — ящик для КПП, E на площадке — поставить на борт', 'E у маяка площадки — починить'],
  },
  armorer: {
    id: 'armorer', faction: 'cwu', name: 'Оружейник ТС', kit: 'cwu', selectable: true,
    desc: 'Чинит и чистит стволы Протектората за верстаком склада; находит брак в патронах.',
    perks: ['E у верстака склада — работать (оплата за ствол)', 'Находит порченые патроны раньше, чем их выдадут'],
  },
  vendor: {
    id: 'vendor', faction: 'cwu', name: 'Продавец ТС', kit: 'cwu', selectable: false,
    desc: 'Стоит за прилавком лавки или кафе на проспекте; товар привозят курьеры из штаба ТС.',
    perks: ['Без продавца лавка закрыта', 'Живёт неподалёку от своей лавки'],
  },
  canteen_cook: {
    id: 'canteen_cook', faction: 'cwu', name: 'Повар столовой ТС', kit: 'cwu_cook', selectable: false,
    desc: 'Варит суп в общей столовой проспекта и наливает голодным горожанам без пайка.',
    perks: ['Суп — из коробок штаба ТС', 'Без повара — только свой паёк'],
  },
  rebel_recruit: {
    id: 'rebel_recruit', faction: 'rebel', name: 'Новобранец', kit: 'rebel_recruit', selectable: true,
    desc: 'Только пришёл в лагерь: 75 HP, пистолет.',
    perks: ['Пистолет и бинт', 'Идёт на КПП вместе с армией'],
  },
  rebel_soldier: {
    id: 'rebel_soldier', faction: 'rebel', name: 'Солдат', kit: 'rebel_soldier', selectable: true,
    desc: 'Выходит на захваты КПП: 90 HP, пистолет и MP7.',
    perks: ['Трофейный MP7, пистолет, граната'],
  },
  rebel_medic: {
    id: 'rebel_medic', faction: 'rebel', name: 'Ветеран-медик', kit: 'rebel_medic', selectable: true,
    desc: 'Лечит всех нуждающихся (своих и мирных), на рожон не лезет: 100 HP.',
    perks: ['G — вылечить раненого перед собой', 'NPC-медики сами идут к раненым и держатся позади штурма'],
  },
  pyro: {
    id: 'pyro', faction: 'rebel', name: 'Пиротехник', kit: 'rebel_pyro', selectable: true,
    desc: 'Зажигательные гранаты и болты поджигают врагов: 130 HP.',
    perks: ['Гранаты оставляют огонь, горящие получают урон', 'Арбалет поджигает цель'],
  },
  partisan: {
    id: 'partisan', faction: 'rebel', name: 'Партизан', kit: 'rebel_partisan', selectable: true,
    desc: 'Подпольщик под видом гражданина или рабочего ТС. Раздаёт оружие бандитам — чтобы чужими руками бить ВС.',
    perks: ['G — маскировка: ВС не узнаёт вас в лицо (оружие в руках выдаёт)', 'E перед бандитом — отдать ему ствол (он пойдёт на ВС)', 'Пойманного партизана ведут в тюрьму Протектората — сидит, пока свои не отобьют'],
  },
  spec_agent: {
    id: 'spec_agent', faction: 'rebel', name: 'Спецагент', kit: 'spec_agent', selectable: true,
    desc: 'Один на сервер: переодевается в форму убитых стражников, убивает Коменданта и высших чинов, устраивает диверсии в Управе и бунты.',
    perks: ['E у тела ВС — переодеться в убитого (в легионера не переодеться)', 'E у двери камеры КПЗ — взломать (все сбегают)', 'G — поднять бунт среди горожан рядом'],
  },
  vort_slave: {
    id: 'vort_slave', faction: 'vort', name: 'Поднадзорный', kit: 'vort', selectable: true,
    desc: 'Под надзором Протектората: серая роба с номером, ошейник-маячок, убирает улицы.',
    perks: ['E у кучи мусора — убрать (оплата)', 'Протекторат не проверяет документы у поднадзорных'],
  },
  bandit: {
    id: 'bandit', faction: 'citizen', name: 'Бандит', kit: 'bandit', selectable: true,
    desc: 'Боец банды: свой район, общага и общак, авторитет над головой. Грабит в подворотнях, враждует с чужими, бьёт по ВС.',
    perks: ['Вступаете в банду (свой район на карте, общага — ваш дом)', 'E у общака в общаге — ствол получше; ящик с конвоя — в общак', 'E перед прохожим в переулке — «гоп-стоп»', 'Чужие бойцы на районе — стычка: стреляют без предупреждения', 'Барыга у запретной зоны — чёрный рынок'],
  },
  gang_boss: {
    id: 'gang_boss', faction: 'citizen', name: 'Авторитет', kit: 'gang_boss', selectable: false,
    desc: 'Держит банду и район: сидит в общаге у общака, посылает бойцов за данью, на налёты, на ВС и конвои.',
    perks: ['Общак банды — в общей комнате общаги', 'Погиб — банда без главаря, пока не вернётся'],
  },
  fugitive: {
    id: 'fugitive', faction: 'citizen', name: 'Беглец', kit: 'fugitive', selectable: true,
    desc: 'Сбежал из-под надзора: без CID и в розыске. Прячется, ждёт прорыва КПП, чтобы уйти к своим.',
    perks: ['Проверка CID — арест: не попадайтесь ВС', 'КПП прорван — первым бежит к повстанцам'],
  },
  rebel_leader: {
    id: 'rebel_leader', faction: 'rebel', name: 'Глава восстания', kit: 'rebel_leader', selectable: true,
    desc: 'Патрик — один на всё сопротивление: 250 HP, броня как у Легиона и красный берет. Выбирает КПП и ведёт армию.',
    perks: ['Повышенное здоровье', 'G — клич: бойцы рядом идут за вами на штурм', 'Армия идёт на тот КПП, к которому идёте вы'],
  },
  veteran: {
    id: 'veteran', faction: 'rebel', name: 'Ветеран', kit: 'rebel_veteran', selectable: true,
    desc: 'Опытный боец: 110 HP, MP7 и пистолет, держит фланг на отвлекающем КПП.',
    perks: ['MP7, пистолет, гранаты', 'Ведёт отвлекающую группу на второй КПП'],
  },
  demolitionist: {
    id: 'demolitionist', faction: 'rebel', name: 'Подрывник', kit: 'rebel_demo', selectable: true,
    desc: 'Гранаты для штурма: выкуривает часовых из-за блоков. 130 HP.',
    perks: ['Много гранат (T — к курсору)', 'Бросает гранаты чаще и дальше'],
  },
  commando: {
    id: 'commando', faction: 'rebel', name: 'Коммандос «Грозы»', kit: 'commando', selectable: true,
    desc: 'Один на сервер: 200 HP, элитная броня, держится при Патрике — прямой ответ Легиону.',
    perks: ['Импульсная винтовка, пистолет, много гранат', 'Идёт рядом с главой на штурм точек'],
  },
  hydra_sergeant: {
    id: 'hydra_sergeant', faction: 'rebel', name: 'Сержант «Грозы»', kit: 'hydra_sergeant', selectable: true,
    desc: 'Сержант спецотряда «Гроза»: 170 HP.',
    perks: ['Импульсная винтовка и два пистолета', 'Противогаз и бронежилет'],
  },
  hydra_rct: {
    id: 'hydra_rct', faction: 'rebel', name: 'RCT «Грозы»', kit: 'hydra_rct', selectable: true,
    desc: 'Рекрут спецотряда «Гроза»: 150 HP.',
    perks: ['MP7 и пистолет', 'Гранат больше, чем у простых бойцов'],
  },
  hydra_sniper: {
    id: 'hydra_sniper', faction: 'rebel', name: 'Снайпер «Грозы»', kit: 'hydra_sniper', selectable: true,
    desc: 'Снайпер спецотряда «Гроза»: 110 HP. Снайперская винтовка появится после обновления боевой системы.',
    perks: ['Пока — только пистолет'],
  },
  ota_alpha: {
    id: 'ota_alpha', faction: 'ota', name: 'LGN.ALPHA', selectable: false,
    desc: 'Легионер: импульсная винтовка, пистолет, гранаты. Воюет только на КПП.',
    perks: [],
  },
  ota_king: {
    id: 'ota_king', faction: 'ota', name: 'LGN.PRAETOR', selectable: false,
    desc: 'Претор Легиона: руководит всем отрядом, ведёт контрудары на КПП.',
    perks: [],
  },
  cremator: {
    id: 'cremator', faction: 'ota', name: 'Санитар', selectable: false,
    desc: 'Санитарная служба Протектората: ищет тела на улицах и сжигает их.',
    perks: [],
  },
};

/** Профессия по умолчанию для фракции (NPC и игрок без выбора). */
export const DEFAULT_PROFESSION: Partial<Record<FactionId, ProfessionId>> = {
  citizen: 'citizen',
  cwu: 'janitor',
  rebel: 'rebel_soldier',
  ota: 'ota_alpha',
  vort: 'vort_slave',
};

export function professionsOf(faction: FactionId, onlySelectable = false): ProfessionDef[] {
  return Object.values(PROFESSIONS).filter((p) => p.faction === faction && (!onlySelectable || p.selectable));
}
