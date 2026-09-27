import type { ProfessionId } from './professions';

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

/** Юниты силового блока: PCU — городская полиция, SU — спецотряд, CMD — командование. */
export type CpUnitId = 'rct' | 'pcu3' | 'pcu2' | 'pcu1' | 'ofc' | 'su3' | 'su2' | 'su1' | 'guard' | 'insp' | 'epu';

/**
 * Умения юнита: investigate — сканирует тела и находит убийц, проверка CID быстрее, штрафы выше;
 * medic — лечит своих (G у игрока); drone — запускает сканер; barrier — ставит бетонный блок (G).
 */
export type CpSkill = 'investigate' | 'medic' | 'drone' | 'barrier';

export interface CpUnitDef extends RankDef {
  unit: CpUnitId;
  group: DivisionId;
  hp: number;
  kit: string;
  /** Уровень командования: кто кому отдаёт указания; с OFC (4) — терминал кодов тревоги. */
  command: number;
  skills: readonly CpSkill[];
  desc: string;
}

/**
 * Силовой блок города — юниты как на сервере. Номер в списке — Character.rank у фракции cp:
 *  PCU (городская полиция): RCT.PCU — рекрут на посту у входов в КПП, Нексус и в людных местах;
 *  PCU.03 — патруль; PCU.02 — ведёт патруль; PCU.01 (сержант) — ведёт патруль, MP7;
 *  PCU.OFC — офицер: построения на плацу Нексуса, надзор за полицией (их 2–3).
 *  SU (спецотряд): SU.03 — спецназ на КПП; SU.02 — медик и техник (КПП, сканер в городе);
 *  SU.01 — следователь с патрулями (сканирует тела, ищет убийц); SU.GUARD — охрана инспекторов,
 *  Администратора и лоялистов (охраняют по очереди); SU.INSP — инспектор (2 на город).
 *  CMD.EPU — глава силового блока: с Администратором, из Нексуса — только с охраной.
 */
const CP_RANKS: readonly CpUnitDef[] = [
  { id: 'rct', unit: 'rct', name: 'Рекрут (RCT.PCU)', short: 'RCT.PCU', color: '#a9dcff', outline: '#4f86ad', group: 'pcu', hp: 75, kit: 'cp', command: 0, skills: [], desc: 'Стоит на посту у входов в КПП и Нексус, в людных местах; дубинка и пистолет.' },
  { id: 'pcu3', unit: 'pcu3', name: 'Юнит PCU.03', short: 'PCU.03', color: '#84c5fb', outline: '#3d73a2', group: 'pcu', hp: 90, kit: 'cp', command: 1, skills: [], desc: 'Патрульный: проверки CID, штрафы, аресты. Пистолет.' },
  { id: 'pcu2', unit: 'pcu2', name: 'Юнит PCU.02', short: 'PCU.02', color: '#62acf3', outline: '#2f6396', group: 'pcu', hp: 100, kit: 'cp', command: 2, skills: [], desc: 'Ведёт патрульную группу, указания младшим. Пистолет.' },
  { id: 'pcu1', unit: 'pcu1', name: 'Сержант (PCU.01)', short: 'PCU.01', color: '#4290e6', outline: '#23548c', group: 'pcu', hp: 110, kit: 'cp_sgt', command: 3, skills: [], desc: 'Сержант: ведёт группу, указания всем ниже. MP7 и пистолет.' },
  { id: 'ofc', unit: 'ofc', name: 'Офицер (PCU.OFC)', short: 'PCU.OFC', color: '#2e73d2', outline: '#19437d', group: 'pcu', hp: 150, kit: 'cp_sgt', command: 4, skills: [], desc: 'Построения на плацу Нексуса, надзор за всей городской полицией. Терминал кодов.' },
  { id: 'su3', unit: 'su3', name: 'Спецназ (SU.03)', short: 'SU.03', color: '#5fc4b0', outline: '#27685c', group: 'su', hp: 120, kit: 'cp_su', command: 2, skills: ['barrier'], desc: 'Держит КПП вместе с OTA. MP7 и пистолет, G — бетонный блок.' },
  { id: 'su2', unit: 'su2', name: 'Медик-техник (SU.02)', short: 'SU.02', color: '#48b4d0', outline: '#1f5f70', group: 'su', hp: 125, kit: 'cp_su_medic', command: 2, skills: ['medic', 'drone'], desc: 'Лечит своих на КПП (G), запускает сканер (G в городе). MP7 и пистолет.' },
  { id: 'su1', unit: 'su1', name: 'Следователь (SU.01)', short: 'SU.01', color: '#a08ae0', outline: '#4d3f7d', group: 'su', hp: 115, kit: 'cp', command: 3, skills: ['investigate'], desc: 'Ходит с патрулями, сканирует тела (E) и находит убийц. Проверка CID быстрее.' },
  { id: 'guard', unit: 'guard', name: 'Охрана (SU.GUARD)', short: 'SU.GUARD', color: '#3f9c86', outline: '#1d4d42', group: 'su', hp: 140, kit: 'cp_guard', command: 2, skills: [], desc: 'Охраняет инспекторов, Администратора, EPU и лоялистов — по очереди. MP7.' },
  { id: 'insp', unit: 'insp', name: 'Инспектор (SU.INSP)', short: 'SU.INSP', color: '#2f7fa0', outline: '#143c4d', group: 'su', hp: 140, kit: 'cp_guard', command: 5, skills: ['investigate'], desc: 'Надзор за SU и работой ГСР, указания офицерам. Всегда с охраной.' },
  { id: 'epu', unit: 'epu', name: 'Глава силового блока (CMD.EPU)', short: 'CMD.EPU', color: '#d9b24a', outline: '#6e5516', group: 'cmd', hp: 200, kit: 'cp_guard', command: 6, skills: [], desc: 'Командует всеми. Сидит с Администратором, из Нексуса — только с охраной.' },
];

/** Номер юнита (Character.rank) по id. */
export const CP_UNIT = Object.fromEntries(CP_RANKS.map((r, k) => [r.unit, k])) as Record<CpUnitId, number>;

/** Описание юнита ГО по рангу. */
export function cpUnit(rank: number): CpUnitDef {
  return CP_RANKS[Math.max(0, Math.min(CP_RANKS.length - 1, rank))];
}

/** Есть ли у персонажа умение юнита ГО. */
export function cpHas(c: { faction: FactionId; rank: number }, skill: CpSkill): boolean {
  return c.faction === 'cp' && cpUnit(c.rank).skills.includes(skill);
}

/** Юнит ГО такого id? */
export function isCpUnit(c: { faction: FactionId; rank: number }, unit: CpUnitId): boolean {
  return c.faction === 'cp' && cpUnit(c.rank).unit === unit;
}

/** Юниты сопротивления: армия (жёлтые ники), глава и спецотряд HYDRA (красные), партизаны. */
export type RebelUnitId =
  | 'recruit' | 'soldier' | 'veteran' | 'medic' | 'demo' | 'pyro' | 'leader'
  | 'hydra_rct' | 'hydra_sergeant' | 'hydra_sniper' | 'commando'
  | 'partisan' | 'agent';

export interface RebelUnitDef extends RankDef {
  unit: RebelUnitId;
  profession: ProfessionId;
  hp: number;
  /** Спецотряд HYDRA и глава — красный ник. */
  elite: boolean;
  desc: string;
}

const YELLOW = { color: '#f2d34a', outline: '#6e5a10' };
const RED = { color: '#ff5a48', outline: '#6e1a12' };

/**
 * Сопротивление — юниты как на сервере. Номер в списке — Character.rank у фракции rebel (по
 * профессии, rebelUnitOf): армия — новобранец 75 HP (пистолет), солдат 90 (пистолет, MP7), ветеран
 * 110 (MP7, пистолет), ветеран-медик 100 (лечит всех нуждающихся, на рожон не лезет), подрывник и
 * пиротехник 130; глава восстания Патрик 250 (броня как у OTA, без шлема, красный берет).
 * HYDRA (красные ники): RCT 150 (MP7, пистолет, гранат больше), сержант 170 (энерговинтовка,
 * пистолеты), снайпер 110 (оружие — после обновления боевой системы), коммандос 200 (один на
 * сервер, при Патрике — ответ OTA). Партизаны (2) и спецагент (1) — под личиной, ники скрыты.
 */
export const REBEL_RANKS: readonly RebelUnitDef[] = [
  { id: 'recruit', unit: 'recruit', profession: 'rebel_recruit', name: 'Новобранец', short: 'Новобранец', hp: 75, elite: false, ...YELLOW, desc: 'Пистолет. Учится воевать.' },
  { id: 'soldier', unit: 'soldier', profession: 'rebel_soldier', name: 'Солдат', short: 'Солдат', hp: 90, elite: false, ...YELLOW, desc: 'Пистолет и MP7.' },
  { id: 'veteran', unit: 'veteran', profession: 'veteran', name: 'Ветеран', short: 'Ветеран', hp: 110, elite: false, ...YELLOW, desc: 'MP7 и пистолет, опыт.' },
  { id: 'medic', unit: 'medic', profession: 'rebel_medic', name: 'Ветеран-медик', short: 'Медик', hp: 100, elite: false, ...YELLOW, desc: 'Лечит всех нуждающихся, на рожон не лезет.' },
  { id: 'demo', unit: 'demo', profession: 'demolitionist', name: 'Подрывник', short: 'Подрывник', hp: 130, elite: false, ...YELLOW, desc: 'Много гранат.' },
  { id: 'pyro', unit: 'pyro', profession: 'pyro', name: 'Пиротехник', short: 'Пиро', hp: 130, elite: false, ...YELLOW, desc: 'Огонь: поджигающие гранаты и болты.' },
  { id: 'leader', unit: 'leader', profession: 'rebel_leader', name: 'Глава восстания', short: 'Глава', hp: 250, elite: true, ...RED, desc: 'Патрик: броня как у OTA, красный берет.' },
  { id: 'hydra_rct', unit: 'hydra_rct', profession: 'hydra_rct', name: 'RCT HYDRA', short: 'RCT HYDRA', hp: 150, elite: true, ...RED, desc: 'MP7, пистолет, гранат больше, чем у бойцов.' },
  { id: 'hydra_sergeant', unit: 'hydra_sergeant', profession: 'hydra_sergeant', name: 'Сержант HYDRA', short: 'Сержант HYDRA', hp: 170, elite: true, ...RED, desc: 'Энерговинтовка и пистолеты.' },
  { id: 'hydra_sniper', unit: 'hydra_sniper', profession: 'hydra_sniper', name: 'Снайпер HYDRA', short: 'Снайпер HYDRA', hp: 110, elite: true, ...RED, desc: 'Пока с пистолетом: винтовка — после обновления боевой системы.' },
  { id: 'commando', unit: 'commando', profession: 'commando', name: 'Коммандос HYDRA', short: 'Коммандос', hp: 200, elite: true, ...RED, desc: 'Один на сервер: при Патрике, ответ OTA.' },
  { id: 'partisan', unit: 'partisan', profession: 'partisan', name: 'Партизан', short: 'Партизан', hp: 100, elite: false, ...YELLOW, desc: 'Под видом гражданина или ГСР.' },
  { id: 'agent', unit: 'agent', profession: 'spec_agent', name: 'Спецагент', short: 'Спецагент', hp: 120, elite: false, ...YELLOW, desc: 'Переодевается в убитых и OTA.' },
];

/** Номер юнита сопротивления по id. */
export const REBEL_UNIT = Object.fromEntries(REBEL_RANKS.map((r, k) => [r.unit, k])) as Record<RebelUnitId, number>;

/** Юнит сопротивления по профессии (ранг = номер юнита); не армейская профессия — null. */
export function rebelUnitOf(profession: ProfessionId | null | undefined): { rank: number; def: RebelUnitDef } | null {
  const k = REBEL_RANKS.findIndex((r) => r.profession === profession);
  return k >= 0 ? { rank: k, def: REBEL_RANKS[k] } : null;
}

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
    color: YELLOW.color, outline: YELLOW.outline, label: YELLOW.color, yieldPriority: 1,
    authority: false, selectable: true,
    description: 'В розыске: при проверке CID арест. Прячьтесь от патрулей ГО.',
    ranks: REBEL_RANKS,
  },
  cp: {
    id: 'cp', role: 'ГО', plural: 'Гражданская оборона',
    color: CP_RANKS[0].color, outline: CP_RANKS[0].outline, label: '#9cc9f5', yieldPriority: 4,
    authority: true, selectable: true,
    description: 'Силовой блок: городская полиция PCU, спецотряд SU, командование CMD.',
    ranks: CP_RANKS,
  },
  ota: {
    id: 'ota', role: 'OTA', plural: 'Сверхчеловеческий отряд',
    color: '#1a2554', outline: '#060b20', label: '#7d8fd0', yieldPriority: 5, authority: true, selectable: false,
    description: 'OTA.ALPHA и командир OTA.KING: воюют только на КПП, по городу не ходят.',
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

/** Группы силового блока (Character.division у ГО — по юниту). */
export type DivisionId = 'pcu' | 'su' | 'cmd';

export interface DivisionDef {
  id: DivisionId;
  short: string;
  name: string;
  desc: string;
  color: string;
}

export const CP_DIVISIONS: Record<DivisionId, DivisionDef> = {
  pcu: { id: 'pcu', short: 'PCU', name: 'Городская полиция (PCU)', color: '#9cc9f5', desc: 'Посты, патрули, проверки CID, аресты. На бойню у КПП почти не ходит.' },
  su: { id: 'su', short: 'SU', name: 'Спецотряд (SU)', color: '#8fd6c0', desc: 'Спецназ и медики на КПП, следователи, охрана, инспекторы.' },
  cmd: { id: 'cmd', short: 'CMD', name: 'Командование (CMD)', color: '#e0c070', desc: 'Глава силового блока города.' },
};

/** Группа юнита ГО по рангу. */
export function cpGroup(rank: number): DivisionId {
  return cpUnit(rank).group;
}

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
