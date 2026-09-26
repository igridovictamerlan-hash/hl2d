export type FactionId = 'citizen' | 'cp' | 'cwu' | 'rebel' | 'ota' | 'admin' | 'vort';

/** Ранг внутри фракции: у ГО и повстанцев цвет кружка зависит от ранга. */
export interface RankDef {
  id: string;
  name: string;
  /** Короткое обозначение в подписи. */
  short: string;
  color: string;
  outline: string;
}

export interface FactionDef {
  id: FactionId;
  /** Название роли над кружком. */
  role: string;
  plural: string;
  color: string;
  outline: string;
  /** Цвет подписи роли. */
  label: string;
  /** Кто кому уступает дорогу в узком проходе: больше — главнее. */
  yieldPriority: number;
  /** Представитель власти: проверяет, не проверяется. */
  authority: boolean;
  /** Можно выбрать в меню ролей. */
  selectable: boolean;
  /** Описание в меню ролей. */
  description: string;
  ranks?: readonly RankDef[];
}

/**
 * Гражданская оборона — звания как на сервере (C17.MPF.RCT … C17.CMD.DVL): от светло-голубого
 * рекрута до тёмно-синего командира дивизиона. Цвет — полосы на броне и шлеме.
 */
const CP_RANKS: readonly RankDef[] = [
  { id: 'rct', name: 'Рекрут (MPF.RCT)', short: 'RCT', color: '#a9dcff', outline: '#4f86ad' },
  { id: 'pcu3', name: 'Юнит PCU.03', short: 'PCU.03', color: '#84c5fb', outline: '#3d73a2' },
  { id: 'pcu2', name: 'Юнит PCU.02', short: 'PCU.02', color: '#62acf3', outline: '#2f6396' },
  { id: 'pcu1', name: 'Юнит PCU.01', short: 'PCU.01', color: '#4290e6', outline: '#23548c' },
  { id: 'ofc', name: 'Офицер (MPF.OFC)', short: 'OFC', color: '#2e73d2', outline: '#19437d' },
  { id: 'insp', name: 'Инспектор (MPF.INSP)', short: 'INSP', color: '#2159b8', outline: '#123368' },
  { id: 'epu', name: 'Командование (CMD.EPU)', short: 'EPU', color: '#19429a', outline: '#0b2356' },
  { id: 'dvl', name: 'Командир дивизиона (CMD.DVL)', short: 'DVL', color: '#12307c', outline: '#071843' },
];

/** Повстанцы: от оранжевого новобранца до жёлто-золотого командира. */
const REBEL_RANKS: readonly RankDef[] = [
  { id: 'recruit', name: 'Новобранец', short: 'Новобранец', color: '#d4561c', outline: '#6e2708' },
  { id: 'fighter', name: 'Боец', short: 'Боец', color: '#e5712a', outline: '#7a3710' },
  { id: 'veteran', name: 'Ветеран', short: 'Ветеран', color: '#ee8e30', outline: '#7d4812' },
  { id: 'sergeant', name: 'Сержант', short: 'Сержант', color: '#f3ac36', outline: '#7f5a14' },
  { id: 'commander', name: 'Командир', short: 'Командир', color: '#f7cb40', outline: '#7d6515' },
];

export const FACTIONS: Record<FactionId, FactionDef> = {
  citizen: {
    id: 'citizen', role: 'Гражданин', plural: 'Граждане',
    color: '#9a9ea4', outline: '#4a4d52', label: '#b9bdc2', yieldPriority: 1, authority: false, selectable: true,
    description: 'Живёт по правилам Альянса: очереди, работа, проверки документов.',
  },
  cwu: {
    id: 'cwu', role: 'ГСР', plural: 'Гражданский союз рабочих',
    color: '#e6dc6e', outline: '#6f6a1f', label: '#efe79a', yieldPriority: 2, authority: false, selectable: true,
    description: 'Гражданский союз рабочих: завод рационов, доставка, раздача, уборка улиц, медпомощь.',
  },
  rebel: {
    id: 'rebel', role: 'Повстанец', plural: 'Повстанцы',
    color: REBEL_RANKS[0].color, outline: REBEL_RANKS[0].outline, label: '#f5a860', yieldPriority: 1,
    authority: false, selectable: true,
    description: 'В розыске: при проверке CID арест. Прячьтесь от патрулей ГО.',
    ranks: REBEL_RANKS,
  },
  cp: {
    id: 'cp', role: 'ГО', plural: 'Гражданская оборона',
    color: CP_RANKS[0].color, outline: CP_RANKS[0].outline, label: '#9cc9f5', yieldPriority: 4,
    authority: true, selectable: true,
    description: 'Патрули, проверка CID (F), штрафы и аресты, конвой в КПЗ Нексуса.',
    ranks: CP_RANKS,
  },
  ota: {
    id: 'ota', role: 'OTA', plural: 'Солдаты Альянса',
    color: '#1a2554', outline: '#060b20', label: '#7d8fd0', yieldPriority: 5, authority: true, selectable: false,
    description: 'Вызываются при серьёзных беспорядках (этап 4).',
  },
  vort: {
    id: 'vort', role: 'Вортигонт', plural: 'Вортигонты',
    color: '#7f9a62', outline: '#34442a', label: '#a9c98a', yieldPriority: 0, authority: false, selectable: true,
    description: 'Порабощённая раса: в ошейниках, убирают улицы города. Документы не проверяют.',
  },
  admin: {
    id: 'admin', role: 'Администратор', plural: 'Администрация',
    color: '#f2f2f2', outline: '#8a8a8a', label: '#ffffff', yieldPriority: 6, authority: true, selectable: false,
    description: 'Один на город. Объявляет комендантский час и тревоги (этап 4).',
  },
};

/** Специализации (спецотряды) ГО. */
export type DivisionId = 'union' | 'grid' | 'helix' | 'jury' | 'tech';

export interface DivisionDef {
  id: DivisionId;
  short: string;
  name: string;
  desc: string;
  color: string;
}

/**
 * Отряды ГО (по мотивам спецюнитов сервера): MPF — патрульные, GRID — гарнизон КПП, MEDIC (SU.MEDIC) —
 * медики, OBS (MPF.OBS) — наблюдатели-дознаватели (сканируют тела, ищут убийцу), TECH (SU.TECH) —
 * техники со сканером. id сохранены с прошлых версий (сохранения).
 */
export const CP_DIVISIONS: Record<DivisionId, DivisionDef> = {
  union: { id: 'union', short: 'MPF', name: 'Патрульный отряд', color: '#9cc9f5', desc: 'Патрули и проверки CID в городе. Быстрее бегает.' },
  grid: { id: 'grid', short: 'GRID', name: 'Пограничный отряд', color: '#8fd6b0', desc: 'Держит КПП. MP7, G — поставить бетонный блок-укрытие.' },
  helix: { id: 'helix', short: 'MEDIC', name: 'Медицинский отряд (SU.MEDIC)', color: '#f08a8a', desc: 'G — вылечить сотрудника Альянса перед собой. Аптечки в наборе.' },
  jury: { id: 'jury', short: 'OBS', name: 'Наблюдатель (MPF.OBS)', color: '#d7b6f5', desc: 'E у тела — сканировать и найти убийцу (он в розыске). Проверка CID быстрее, штрафы выше.' },
  tech: { id: 'tech', short: 'TECH', name: 'Техник (SU.TECH)', color: '#f0c070', desc: 'G — запустить сканер: летает по городу, засекает повстанцев и нарушителей для Надзора.' },
};

export function rankOf(faction: FactionId, rank: number): RankDef | null {
  const ranks = FACTIONS[faction].ranks;
  return ranks ? ranks[Math.max(0, Math.min(ranks.length - 1, rank))] : null;
}

/** Цвет кружка с учётом ранга. */
export function colorsOf(faction: FactionId, rank: number): { color: string; outline: string } {
  const r = rankOf(faction, rank);
  const f = FACTIONS[faction];
  return r ? { color: r.color, outline: r.outline } : { color: f.color, outline: f.outline };
}
