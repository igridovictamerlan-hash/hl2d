import type { CpUnitId } from './factions';
import type { ProfessionId } from './professions';

/**
 * Форма из отдельных вещей (рисунок — entities/pawnKit.ts, сборка — systems/Gear.kitOf). Каждая часть формы — свой
 * предмет снаряжения в своём слоте пешки: головной убор или шлем, лицо (противогаз), форменная рубаха, броня, шинель
 * или накидка, ранец. Части складываются в комплект `KitLook` и рисуются слоями поверх (или вместо) гражданской одежды:
 * за спиной → рубаха или гражданское → броня → шинель → нашивки и навесное → голова (маска, шлем, убор). Можно снять
 * любую часть, надеть чужую, носить с вещами из ателье (шарф, очки, шляпа вместо фуражки).
 * Так же собрана экипировка армии сопротивления и «Грозы» (REBEL_KITS): полевая форма или комбинезон, плитник или
 * разгрузка, шлем MICH (в чехле, с очками, с креплением ПНВ), кепи, берет, балаклава, противогаз S10, очки, рюкзак.
 */
export type KitHead = 'flak' | 'recon' | 'peaked' | 'cadet' | 'marine' | 'mich' | 'fieldcap' | 'beret';
export type KitArmor = 'flak' | 'recon' | 'marine' | 'plate' | 'chest';
export type KitFace = 'gas' | 's10' | 'balaclava' | 'goggles';

export interface KitLook {
  /** Форменная рубаха (комбинезон): цвет; нет — гражданское или своё тело. */
  shirt?: string;
  /** Полевая форма сопротивления (вместо рубахи): цвет и пятна камуфляжа (цвета через пробел). */
  fatigues?: string;
  camo?: string;
  /** Броня на корпус: стиль, цвет пластин, ремень. */
  armor?: KitArmor;
  armorColor?: string;
  belt?: string;
  /** Поверх брони: шинель (распахнутая, полы до колен) или плащ-накидка. */
  coat?: 'greatcoat' | 'cape';
  coatColor?: string;
  /** Головной убор формы и его цвет (у шлема спецотряда — оболочка, у силового — купол). */
  head?: KitHead;
  headColor?: string;
  face?: KitFace;
  /** Ранец (рюкзак) за спиной и его цвет. */
  pack?: boolean;
  packColor?: string;
  /** Шлем MICH: чехол в камуфляже формы, очки на шлеме (цвет линз), крепление ПНВ. */
  headCamo?: string;
  hgoggles?: string;
  nvg?: boolean;
  /** Маска: цвет балаклавы или противогаза S10, линзы, фильтр и его кольцо; очки пиротехника (цвет линз). */
  maskColor?: string;
  lens?: string;
  filter?: string;
  filterRing?: string;
  goggles?: string;
  /** Силовой шлем: визор, блик, глаза (цвет и число), полоса (вместо цвета ранга). */
  visor?: string;
  shine?: string;
  eye?: string;
  eyes?: number;
  trim?: string;
}

/** Слот пешки для части формы (как у снаряжения, `GearSlot`). */
export type KitSlot = 'head' | 'face' | 'hat' | 'top' | 'torso' | 'outer' | 'back';

export interface UniformPiece {
  name: string;
  desc: string;
  /** «в чём» для примет (предложный падеж). */
  worn: string;
  slot: KitSlot;
  price: number;
  /** Цвет иконки в инвентаре. */
  color: string;
  head?: number;
  torso?: number;
  capacity?: number;
  kit: Partial<KitLook>;
}

const MARINE = { visor: '#0d0f12', shine: '#e8c870', eye: '#ffcf4a', eyes: 1, trim: '#d9b24a' };

/** Части формы Внутренней стражи (id предмета — ключ; каска ВС — прежний `helmet_cp`). */
export const UNIFORM_PIECES = {
  helmet_cp: { name: 'Каска ВС', desc: 'Каска патрульной службы с полосой звания: снята с тела или выдана.', worn: 'каске ВС', slot: 'head', price: 45, color: '#4b5563', head: 0.35, kit: { head: 'flak' } },
  un_recon_helmet: { name: 'Шлем спецотряда', desc: 'Шлем с визором и гарнитурой поверх балаклавы.', worn: 'шлеме спецотряда', slot: 'head', price: 70, color: '#66717c', head: 0.45, kit: { head: 'recon', headColor: '#66717c' } },
  un_recon_helmet_guard: { name: 'Шлем охраны', desc: 'Тёмный шлем охраны с визором.', worn: 'шлеме охраны', slot: 'head', price: 70, color: '#4c5560', head: 0.45, kit: { head: 'recon', headColor: '#4c5560' } },
  un_recon_helmet_qm: { name: 'Шлем кладовщика', desc: 'Шлем спецотряда цвета хаки.', worn: 'шлеме спецотряда', slot: 'head', price: 60, color: '#55604f', head: 0.4, kit: { head: 'recon', headColor: '#55604f' } },
  un_marine_helmet: { name: 'Силовой шлем', desc: 'Закрытый шлем начальника стражи: визор, золотая полоса.', worn: 'силовом шлеме', slot: 'head', price: 160, color: '#26292e', head: 0.7, kit: { head: 'marine', headColor: '#26292e', ...MARINE } },
  un_peaked_cap: { name: 'Фуражка ВС', desc: 'Фуражка офицера: околыш цвета звания, кокарда.', worn: 'фуражке', slot: 'hat', price: 25, color: '#232a35', kit: { head: 'peaked' } },
  un_cadet_cap: { name: 'Пилотка курсанта', desc: 'Пилотка академии ВС.', worn: 'пилотке', slot: 'hat', price: 8, color: '#2c3f57', kit: { head: 'cadet', headColor: '#2c3f57' } },
  un_gasmask: { name: 'Противогаз ВС', desc: 'Резиновая маска с круглыми линзами и фильтром: лица не видно.', worn: 'противогазе', slot: 'face', price: 30, color: '#2a2e34', head: 0.2, kit: { face: 'gas' } },
  un_cp_shirt: { name: 'Форменная рубаха ВС', desc: 'Тёмная форма Внутренней стражи с ремнём.', worn: 'форме ВС', slot: 'top', price: 20, color: '#262c36', kit: { shirt: '#262c36', belt: '#1c2128' } },
  un_epu_suit: { name: 'Комбинезон начальника', desc: 'Чёрный комбинезон под силовую броню.', worn: 'чёрном комбинезоне', slot: 'top', price: 30, color: '#1b1d21', kit: { shirt: '#1b1d21', belt: '#141518' } },
  un_flak_vest: { name: 'Бронежилет ВС', desc: 'Стёганый бронежилет патрульной службы с высоким воротником.', worn: 'бронежилете ВС', slot: 'torso', price: 70, color: '#56606d', torso: 0.4, kit: { armor: 'flak', armorColor: '#56606d' } },
  un_flak_vest_ofc: { name: 'Офицерский бронежилет', desc: 'Тёмный стёганый бронежилет офицера.', worn: 'офицерском бронежилете', slot: 'torso', price: 85, color: '#3d4654', torso: 0.45, kit: { armor: 'flak', armorColor: '#3d4654' } },
  un_flak_vest_instr: { name: 'Бронежилет инструктора', desc: 'Стёганый бронежилет инструктора академии.', worn: 'бронежилете инструктора', slot: 'torso', price: 80, color: '#45505e', torso: 0.45, kit: { armor: 'flak', armorColor: '#45505e' } },
  un_recon_armor: { name: 'Броня спецотряда', desc: 'Сегментная броня: нагрудник, пластины живота, набедренники.', worn: 'броне спецотряда', slot: 'torso', price: 110, color: '#66717c', torso: 0.5, kit: { armor: 'recon', armorColor: '#66717c' } },
  un_recon_armor_guard: { name: 'Броня охраны', desc: 'Тёмная сегментная броня охраны.', worn: 'броне охраны', slot: 'torso', price: 110, color: '#4c5560', torso: 0.5, kit: { armor: 'recon', armorColor: '#4c5560' } },
  un_recon_armor_insp: { name: 'Броня инспектора', desc: 'Тёмная сегментная броня инспектора.', worn: 'броне инспектора', slot: 'torso', price: 110, color: '#3b434d', torso: 0.5, kit: { armor: 'recon', armorColor: '#3b434d' } },
  un_recon_armor_qm: { name: 'Броня кладовщика', desc: 'Сегментная броня цвета хаки.', worn: 'броне цвета хаки', slot: 'torso', price: 95, color: '#55604f', torso: 0.45, kit: { armor: 'recon', armorColor: '#55604f' } },
  un_marine_armor: { name: 'Силовая броня', desc: 'Кираса, горжет, большие наплечники с золотой полосой.', worn: 'силовой броне', slot: 'torso', price: 200, color: '#2b2e33', torso: 0.65, kit: { armor: 'marine', armorColor: '#2b2e33', ...MARINE } },
  un_greatcoat: { name: 'Шинель инспектора', desc: 'Длинная тёмная шинель: носят распахнутой поверх брони.', worn: 'шинели', slot: 'outer', price: 60, color: '#1f2328', kit: { coat: 'greatcoat', coatColor: '#1f2328' } },
  un_cape: { name: 'Плащ-накидка', desc: 'Красная накидка начальника стражи.', worn: 'красной накидке', slot: 'outer', price: 50, color: '#6e1414', kit: { coat: 'cape', coatColor: '#6e1414' } },
  // ——— Армия сопротивления и «Грозы» (армейский шлем, плитник и рюкзак — прежние предметы) ———
  rb_fatigues: { name: 'Полевая форма', desc: 'Оливковая полевая форма новобранца.', worn: 'полевой форме', slot: 'top', price: 25, color: '#5d6443', kit: { fatigues: '#5d6443', camo: '', belt: '#2c2a24' } },
  rb_fatigues_green: { name: 'Форма в камуфляже', desc: 'Полевая форма с зелёным камуфляжем.', worn: 'зелёном камуфляже', slot: 'top', price: 35, color: '#56603f', kit: { fatigues: '#56603f', camo: '#4a5336 #666f4c', belt: '#2c2a24' } },
  rb_fatigues_mc: { name: 'Камуфляж ветерана', desc: 'Песочный пятнистый камуфляж ветеранов.', worn: 'песочном камуфляже', slot: 'top', price: 45, color: '#8a7f5e', kit: { fatigues: '#8a7f5e', camo: '#6e6a45 #a8956a #5a4a34 #8f8a62', belt: '#2c2a24' } },
  rb_fatigues_grey: { name: 'Серый камуфляж', desc: 'Серо-оливковый камуфляж.', worn: 'сером камуфляже', slot: 'top', price: 35, color: '#5a5a48', kit: { fatigues: '#5a5a48', camo: '#4a4a3a #6a6852', belt: '#2c2a24' } },
  rb_coverall: { name: 'Комбинезон «Грозы»', desc: 'Тёмно-синий штурмовой комбинезон.', worn: 'тёмном комбинезоне', slot: 'top', price: 50, color: '#283241', kit: { fatigues: '#283241', camo: '', belt: '#2c2a24' } },
  rb_leader_suit: { name: 'Комбинезон главы', desc: 'Оливковый комбинезон под трофейную броню.', worn: 'оливковом комбинезоне', slot: 'top', price: 40, color: '#2e3228', kit: { fatigues: '#2e3228', camo: '', belt: '#2a2a22' } },
  plate_vest: { name: 'Плитник', desc: 'Бронежилет с пластинами и подсумками: крепче, но редкость.', worn: 'плитнике', slot: 'torso', price: 110, color: '#5d6b3a', torso: 0.55, kit: { armor: 'plate', armorColor: '#5d6b3a' } },
  rb_plate_mc: { name: 'Плитник в чехле', desc: 'Плитник в песочном чехле ветерана.', worn: 'плитнике в чехле', slot: 'torso', price: 110, color: '#7d6c4f', torso: 0.5, kit: { armor: 'plate', armorColor: '#7d6c4f' } },
  rb_plate_grey: { name: 'Серый плитник', desc: 'Серый тактический плитник «Грозы».', worn: 'сером плитнике', slot: 'torso', price: 120, color: '#484b45', torso: 0.55, kit: { armor: 'plate', armorColor: '#484b45' } },
  rb_chest_rig: { name: 'Разгрузка', desc: 'Подсумки поперёк груди, лямки крест-накрест: брони мало.', worn: 'разгрузке', slot: 'torso', price: 40, color: '#4a5234', torso: 0.3, kit: { armor: 'chest', armorColor: '#4a5234' } },
  rb_chest_rig_dark: { name: 'Тёмная разгрузка', desc: 'Тёмная разгрузка с подсумками.', worn: 'тёмной разгрузке', slot: 'torso', price: 40, color: '#3f423c', torso: 0.35, kit: { armor: 'chest', armorColor: '#3f423c' } },
  rb_leader_armor: { name: 'Трофейная броня', desc: 'Силовая броня Легиона, перекрашенная в олив, с красными полосами.', worn: 'трофейной броне', slot: 'torso', price: 200, color: '#6a6f52', torso: 0.6, kit: { armor: 'marine', armorColor: '#6a6f52', trim: '#b3261e' } },
  helmet: { name: 'Армейский шлем', desc: 'Шлем MICH армии сопротивления: держит часть пуль в голову.', worn: 'армейском шлеме', slot: 'head', price: 60, color: '#555e41', head: 0.45, kit: { head: 'mich', headColor: '#555e41' } },
  rb_helmet_mc: { name: 'Шлем в чехле', desc: 'Шлем в камуфляжном чехле, очки на лбу.', worn: 'шлеме в чехле', slot: 'head', price: 70, color: '#7d6c4f', head: 0.45, kit: { head: 'mich', headColor: '#7d6c4f', headCamo: '#6e6a45 #a8956a #5a4a34 #8f8a62', hgoggles: '#2e3a44' } },
  rb_helmet_nvg: { name: 'Шлем с креплением ПНВ', desc: 'Чёрный шлем «Грозы».', worn: 'чёрном шлеме', slot: 'head', price: 80, color: '#202225', head: 0.5, kit: { head: 'mich', headColor: '#202225', nvg: true } },
  rb_field_cap: { name: 'Кепи', desc: 'Полевое кепи новобранца.', worn: 'кепи', slot: 'hat', price: 8, color: '#4c5436', kit: { head: 'fieldcap', headColor: '#4c5436' } },
  rb_beret: { name: 'Красный берет', desc: 'Берет главы восстания.', worn: 'красном берете', slot: 'hat', price: 15, color: '#a31a1a', kit: { head: 'beret', headColor: '#a31a1a' } },
  rb_balaclava: { name: 'Балаклава', desc: 'Тёмная балаклава: видны только глаза.', worn: 'балаклаве', slot: 'face', price: 10, color: '#3a3a30', kit: { face: 'balaclava', maskColor: '#3a3a30' } },
  rb_s10: { name: 'Противогаз S10', desc: 'Резиновая маска с каплевидными линзами, фильтр сбоку.', worn: 'противогазе', slot: 'face', price: 40, color: '#17181a', head: 0.1, kit: { face: 's10', maskColor: '#17181a', lens: '#2c3a46', filter: '#232629', filterRing: '#4d86b8' } },
  rb_goggles: { name: 'Очки пиротехника', desc: 'Защитные очки с оранжевыми линзами.', worn: 'защитных очках', slot: 'face', price: 12, color: '#ff8a3a', kit: { face: 'goggles', goggles: '#ff8a3a' } },
  backpack: { name: 'Рюкзак', desc: 'Больше места: +4 ячейки инвентаря, пока надет.', worn: 'с рюкзаком', slot: 'back', price: 40, color: '#5a6238', capacity: 4, kit: { pack: true, packColor: '#5a6238' } },
  un_pack: { name: 'Ранец ВС', desc: 'Ранец спецотряда: +2 ячейки инвентаря.', worn: 'с ранцем', slot: 'back', price: 35, color: '#3a4048', capacity: 2, kit: { pack: true } },
} satisfies Record<string, UniformPiece>;

export type UniformId = keyof typeof UNIFORM_PIECES;

/**
 * Форма по юнитам: из каких частей она собрана (NPC носят её всегда; игроку выдаётся в слоты при назначении и
 * повышении). Опер в штатском (su1) — без формы: гражданское (PLAINCLOTHES). Нашивки, рация, фонарь и прочее
 * навесное — по юниту (PAWN.cpUnits.acc), их видно на любой форме ВС.
 */
export const CP_KITS: Record<CpUnitId, readonly UniformId[]> = {
  rct: ['un_cp_shirt', 'helmet_cp', 'un_gasmask'],
  pcu3: ['un_cp_shirt', 'helmet_cp', 'un_gasmask', 'un_flak_vest'],
  pcu2: ['un_cp_shirt', 'helmet_cp', 'un_gasmask', 'un_flak_vest'],
  pcu1: ['un_cp_shirt', 'helmet_cp', 'un_gasmask', 'un_flak_vest'],
  ofc: ['un_cp_shirt', 'un_peaked_cap', 'un_gasmask', 'un_flak_vest_ofc'],
  su3: ['un_cp_shirt', 'un_recon_helmet', 'un_recon_armor', 'un_pack'],
  su2: ['un_cp_shirt', 'un_recon_helmet', 'un_recon_armor', 'un_pack'],
  su1: [],
  guard: ['un_cp_shirt', 'un_recon_helmet_guard', 'un_recon_armor_guard'],
  insp: ['un_cp_shirt', 'un_peaked_cap', 'un_gasmask', 'un_recon_armor_insp', 'un_greatcoat'],
  epu: ['un_epu_suit', 'un_marine_helmet', 'un_marine_armor', 'un_cape'],
  qm: ['un_cp_shirt', 'un_recon_helmet_qm', 'un_recon_armor_qm'],
  cdt: ['un_cp_shirt', 'un_cadet_cap'],
  instr: ['un_cp_shirt', 'un_peaked_cap', 'un_gasmask', 'un_flak_vest_instr'],
};

/**
 * Экипировка армии сопротивления и «Грозы» по профессиям. Балаклава у ветеранов и медиков — у части бойцов по
 * внешности (rebelKit: PAWN.tactical.maskChance); нашивки, повязки, патронташ, рация и подсумки — по профессии
 * (PAWN.professionOutfits).
 */
export const REBEL_KITS: Partial<Record<ProfessionId, readonly UniformId[]>> = {
  rebel_recruit: ['rb_fatigues', 'rb_field_cap'],
  rebel_soldier: ['rb_fatigues_green', 'rb_chest_rig', 'helmet'],
  demolitionist: ['rb_fatigues_green', 'rb_chest_rig', 'helmet'],
  pyro: ['rb_fatigues_grey', 'rb_chest_rig_dark', 'helmet', 'rb_goggles'],
  veteran: ['rb_fatigues_mc', 'rb_plate_mc', 'rb_helmet_mc'],
  rebel_medic: ['rb_fatigues_mc', 'rb_plate_mc', 'rb_helmet_mc'],
  hydra_rct: ['rb_coverall', 'rb_plate_grey', 'rb_helmet_nvg', 'rb_s10'],
  hydra_sergeant: ['rb_coverall', 'rb_plate_grey', 'rb_helmet_nvg', 'rb_s10'],
  hydra_sniper: ['rb_coverall', 'rb_chest_rig_dark', 'rb_helmet_nvg', 'rb_s10'],
  commando: ['rb_coverall', 'rb_plate_grey', 'rb_helmet_nvg', 'rb_s10', 'backpack'],
  rebel_leader: ['rb_leader_suit', 'rb_leader_armor', 'rb_beret'],
};
/** Профессии, у которых часть бойцов в балаклаве. */
export const MAYBE_MASK: ReadonlySet<string> = new Set(['veteran', 'rebel_medic']);

/** Экипировка бойца по профессии (с балаклавой — по внешности, maskRoll в 0..1). */
export function rebelKitIds(prof: ProfessionId, maskRoll: number, maskChance: number): UniformId[] {
  const ids = [...(REBEL_KITS[prof] ?? [])];
  if (ids.length && MAYBE_MASK.has(prof) && maskRoll < maskChance) ids.push('rb_balaclava');
  return ids;
}

/** Комплект из частей формы (по порядку: позже — поверх). */
export function kitFrom(ids: readonly string[]): KitLook | null {
  let k: KitLook | null = null;
  for (const id of ids) {
    const p = (UNIFORM_PIECES as Record<string, UniformPiece>)[id];
    if (p) k = { ...(k ?? {}), ...p.kit };
  }
  return k;
}

const unitKits = new Map<CpUnitId, KitLook | null>();
/** Форма юнита целиком (кэш). */
export function unitKit(unit: CpUnitId): KitLook | null {
  if (!unitKits.has(unit)) unitKits.set(unit, kitFrom(CP_KITS[unit]));
  return unitKits.get(unit)!;
}
