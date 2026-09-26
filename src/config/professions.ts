import type { FactionId } from './factions';

/**
 * Профессии (по мотивам HL2RP-сервера UnionRP, City-17). У фракции — список профессий; у персонажа —
 * одна (Character.profession). Профессия даёт набор предметов (kit), работу и особые умения
 * (perks — текст для меню выбора роли). Ранги ГО и повстанцев и отряды ГО — отдельно (factions.ts).
 */
export type ProfessionId =
  // Граждане.
  | 'citizen'
  | 'thief'
  | 'outcast'
  // ГСР.
  | 'cook'
  | 'packer'
  | 'courier'
  | 'janitor'
  | 'cwu_medic'
  // Сопротивление.
  | 'rebel_soldier'
  | 'rebel_medic'
  | 'pyro'
  | 'partisan'
  // Вортигонты.
  | 'vort_slave'
  // Синтеты Альянса.
  | 'cremator';

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
    desc: 'Живёт по правилам Альянса: очереди, рационы, проверки документов.',
    perks: ['Лояльность растёт — привилегии лоялиста (бег без нарушения, очередь впереди)', 'Доверенный лоялист: /охрана — два юнита ГО сопровождают'],
  },
  thief: {
    id: 'thief', faction: 'citizen', name: 'Вор', kit: 'thief', selectable: true,
    desc: 'Кражи со взломом и карманные кражи. Попадётесь ГО на глаза — арест.',
    perks: ['E за спиной у прохожего — вытащить токены (увидит ГО — погоня)', 'E у окна раздачи, когда оно закрыто, — взломать раздатчик рационов', 'Добыча больше обычной'],
  },
  outcast: {
    id: 'outcast', faction: 'citizen', name: 'Отброс общества', kit: 'outcast', selectable: true,
    desc: 'Живёт на улице, роется в мусоре. Лояльности у Альянса нет.',
    perks: ['E у кучи мусора — порыться: чаще находит полезное', 'Может носить оружие для самозащиты (если поймают — проблемы)'],
  },
  cook: {
    id: 'cook', faction: 'cwu', name: 'Повар ГСР', kit: 'cwu_cook', selectable: true,
    desc: 'Раздаёт рационы у будки на площади и торгует едой за прилавком магазина.',
    perks: ['E у окна раздачи — встать на выдачу (оплата за рацион)', 'E у прилавка магазина — работать продавцом', 'Рационы берутся со склада будки — его пополняют курьеры'],
  },
  packer: {
    id: 'packer', faction: 'cwu', name: 'Фасовщик ГСР', kit: 'cwu', selectable: true,
    desc: 'Собирает рационы на заводе ГСР в промзоне.',
    perks: ['E у конвейера завода — собрать коробку рационов (оплата за коробку)'],
  },
  courier: {
    id: 'courier', faction: 'cwu', name: 'Курьер ГСР', kit: 'cwu', selectable: true,
    desc: 'Носит коробки рационов с завода к будке раздачи.',
    perks: ['E у склада завода — взять коробку', 'E у будки раздачи — сдать (оплата за доставку)'],
  },
  janitor: {
    id: 'janitor', faction: 'cwu', name: 'Уборщик ГСР', kit: 'cwu', selectable: true,
    desc: 'Убирает мусор на улицах и чинит щитки в переулках.',
    perks: ['E у кучи мусора — убрать (оплата)', 'E у поломки — починить (нужен набор инструментов)'],
  },
  cwu_medic: {
    id: 'cwu_medic', faction: 'cwu', name: 'Медик ГСР', kit: 'cwu_medic', selectable: true,
    desc: 'Лечит граждан за токены, сотрудников ГО — бесплатно.',
    perks: ['G — вылечить того, кто перед вами (гражданин платит)', 'Аптечки в наборе, пополняются у прилавка магазина'],
  },
  rebel_soldier: {
    id: 'rebel_soldier', faction: 'rebel', name: 'Солдат', selectable: true,
    desc: 'Выходит на захваты КПП, вылазки и засады.',
    perks: ['Автомат, пистолет, граната'],
  },
  rebel_medic: {
    id: 'rebel_medic', faction: 'rebel', name: 'Медик', kit: 'rebel_medic', selectable: true,
    desc: 'Лечит своих бесплатно, ходит с отрядами на захваты.',
    perks: ['G — вылечить повстанца перед собой', 'NPC-медики в отрядах сами лечат раненых'],
  },
  pyro: {
    id: 'pyro', faction: 'rebel', name: 'Пиротехник', kit: 'rebel_pyro', selectable: true,
    desc: 'Зажигательные гранаты и болты поджигают врагов.',
    perks: ['Гранаты оставляют огонь, горящие получают урон', 'Арбалет поджигает цель'],
  },
  partisan: {
    id: 'partisan', faction: 'rebel', name: 'Партизан', kit: 'rebel_partisan', selectable: true,
    desc: 'Выходит в город под видом гражданина.',
    perks: ['G — маскировка: ГО не узнаёт вас в лицо (оружие в руках выдаёт)', 'Проверка CID раскроет — вы в розыске', 'Тихий пистолет и отмычки'],
  },
  vort_slave: {
    id: 'vort_slave', faction: 'vort', name: 'Вортигонт [Раб]', kit: 'vort', selectable: true,
    desc: 'Порабощён Альянсом: в ошейнике, убирает улицы. Говорит с гражданами.',
    perks: ['E у кучи мусора — убрать (оплата)', 'Альянс не проверяет документы у вортигонтов'],
  },
  cremator: {
    id: 'cremator', faction: 'ota', name: 'Крематор', selectable: false,
    desc: 'Синтет Альянса: ищет тела на улицах и сжигает их.',
    perks: [],
  },
};

/** Профессия по умолчанию для фракции (NPC и игрок без выбора). */
export const DEFAULT_PROFESSION: Partial<Record<FactionId, ProfessionId>> = {
  citizen: 'citizen',
  cwu: 'janitor',
  rebel: 'rebel_soldier',
  vort: 'vort_slave',
};

export function professionsOf(faction: FactionId, onlySelectable = false): ProfessionDef[] {
  return Object.values(PROFESSIONS).filter((p) => p.faction === faction && (!onlySelectable || p.selectable));
}
