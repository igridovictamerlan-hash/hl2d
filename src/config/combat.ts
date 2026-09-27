/** Зоны попадания (хитбоксы). */
export type HitZone = 'head' | 'torso' | 'arm' | 'leg';

/**
 * Броня по зонам: какую долю урона держит шлем (head) и жилет (torso), 0..1. Пуля с бронебойностью
 * pierce снимает эту долю защиты: держит armor × (1 − pierce). Руки и ноги не защищены.
 */
export interface ArmorProfile {
  head: number;
  torso: number;
}

/**
 * Попадания: зона выбирается по весам (прицелившийся чаще попадает в голову — headAim), урон × mul
 * зоны; голова без шлема — смерть от любого огнестрела. Каждое ранение кровоточит: bleed[зона] HP/с
 * на единицу урона, пока не перевяжут (бинт, аптечка, медик); всё кровотечение — не больше bleedMax.
 * Нога — хромает (limp: множитель скорости, limpTime с), рука — конус шире (armSpread) armTime с.
 * Броня: ARMOR (по юнитам и профессиям). Взрыв бьёт без зон, жилет держит blastVest своей доли.
 */
export const HITS = {
  weights: { head: 0.1, torso: 0.47, arm: 0.2, leg: 0.23 } as Record<HitZone, number>,
  /** + к весу головы при полном прицеливании. */
  headAim: 0.06,
  mul: { head: 2.5, torso: 1, arm: 0.55, leg: 0.65 } as Record<HitZone, number>,
  bleed: { head: 0.03, torso: 0.022, arm: 0.012, leg: 0.016 } as Record<HitZone, number>,
  bleedMax: 4,
  limp: 0.65,
  limpTime: 40,
  armSpread: 1.6,
  armTime: 40,
  blastVest: 0.5,
  /** Перевязка: столько секунд стоит на месте (B у игрока; NPC — сами, когда давно не попадали). */
  bandageTime: 2.2,
  /** Ранен в голову без шлема — надпись в журнал. */
  headshotLine: 'в голову',
} as const;

/** Защита по фракциям, юнитам силового блока и профессиям (у кого нет — без брони). */
export const ARMOR = {
  none: { head: 0, torso: 0 },
  /** Силовой блок по юниту (config/factions CP_RANKS.unit). */
  cp: {
    rct: { head: 0.3, torso: 0 },
    pcu3: { head: 0.35, torso: 0.4 },
    pcu2: { head: 0.35, torso: 0.4 },
    pcu1: { head: 0.35, torso: 0.45 },
    ofc: { head: 0.2, torso: 0.45 },
    su3: { head: 0.45, torso: 0.5 },
    su2: { head: 0.45, torso: 0.5 },
    su1: { head: 0.4, torso: 0.45 },
    guard: { head: 0.45, torso: 0.5 },
    insp: { head: 0.4, torso: 0.5 },
    epu: { head: 0.7, torso: 0.65 },
  } as Record<string, ArmorProfile>,
  /** Профессии: OTA и армия сопротивления (Патрик в берете — голова открыта). */
  profession: {
    ota_alpha: { head: 0.7, torso: 0.65 },
    ota_king: { head: 0.75, torso: 0.7 },
    rebel_soldier: { head: 0.35, torso: 0.3 },
    pyro: { head: 0.35, torso: 0.35 },
    demolitionist: { head: 0.35, torso: 0.4 },
    veteran: { head: 0.45, torso: 0.5 },
    rebel_medic: { head: 0.45, torso: 0.45 },
    rebel_leader: { head: 0, torso: 0.6 },
    hydra_rct: { head: 0.5, torso: 0.5 },
    hydra_sergeant: { head: 0.5, torso: 0.55 },
    hydra_sniper: { head: 0.45, torso: 0.4 },
    commando: { head: 0.55, torso: 0.6 },
    cremator: { head: 0.3, torso: 0.3 },
  } as Partial<Record<string, ArmorProfile>>,
} as const;

/** Бой. Урон — единицы здоровья, время — секунды, расстояния — px. */
export const COMBAT = {
  /** Шанс, что пуля остановится о бетонный блок-укрытие. */
  barrierStopChance: 0.45,
  /** Свой блок рядом со стрелком не мешает стрелять поверх. */
  ownCoverDistance: 26,
  /** Бег: штраф разброса сверх ходьбы (moveSpread оружия × (1 + (v/ходьба − 1) × это)). */
  runSpreadMul: 2,
  /** Разброс не шире (градусы, полуугол). */
  maxSpread: 25,
  /** Прицеливание: при ходьбе копится с этим множителем; без ПКМ / на бегу — теряется (доля в секунду). */
  aimWhileMoving: 0.5,
  aimLoss: 2.5,
  aimLossRun: 5,
  /** Предел шанса, что блок остановит пулю (с учётом пробития оружия). */
  barrierMaxStop: 0.9,
  /** Оглушённый дубинкой двигается медленнее во столько раз и теряет прицел. */
  stunSpeedMul: 0.4,
  /** Раненый (доля здоровья) отходит. */
  woundedFraction: 0.35,
  /** Медик сопротивления идёт лечить тех, у кого здоровья меньше этой доли. */
  medicBelow: 0.75,
  /** NPC перевязывается сам (бинт, аптечка), если в него не попадали столько секунд. */
  selfHealCalm: 2,
  /** Во время перевязки — медленнее во столько раз. */
  bandageSpeedMul: 0.3,
  /** Увод ствола возвращается на линию прицела: × recovery оружия (градусов/с). */
  kickReturn: 1.4,
  /** Сколько лежит тело. */
  corpseTime: 90,
  /** Игрок возрождается через… */
  respawnDelay: 6,
  /** Регенерация, если давно не ранили. */
  regenDelay: 12,
  regenPerSec: 0.5,
  /** Регенерация только до этой доли здоровья. */
  regenCap: 0.6,
  /** Сколько видны трассеры и вспышки; вспышка взрыва. */
  blastTime: 0.6,
  /**
   * Следы на земле: гильзы у стрелка, кровь за раненым (с шансом), выбоины у стен (с шансом),
   * копоть от взрыва; время жизни, с; всего не больше max (старые уходят).
   */
  decals: {
    max: 450,
    casingTime: 25,
    bloodTime: 70,
    bloodChance: 0.6,
    chipTime: 30,
    chipChance: 0.3,
    scorchTime: 120,
    /** Капли крови за раненым: шанс в секунду на 1 HP/с кровотечения. */
    bleedDrip: 1.2,
  },
  /** Пули: сколько тянется светящийся хвост (доля пути за тик × это) и сколько видна вспышка у ствола. */
  trail: 0.022,
  flashTime: 0.06,
  impactTime: 0.35,
  swingTime: 0.18,
  /** Слышимость выстрела: NPC в радиусе реагируют. */
  hearing: 360,
  /** Медик HELIX лечит за раз и перезаряжается. */
  healAmount: 25,
  healCooldown: 2.5,
  healRange: 36,
  /**
   * ИИ: задержка реакции, очередь, пауза между очередями; разброс NPC чуть шире, чем у игрока (spreadMul);
   * стреляет, только когда полуширина конуса у цели ≤ радиус цели × fireWidth (или прицел уже полный);
   * не стреляет дальше effectiveRange × maxRangeMul (дробовик в упор, а не через всю пустошь);
   * ГО убирает огнестрел и берёт дубинку через holsterAfter секунд без боя.
   */
  ai: {
    reaction: [0.25, 0.6] as const,
    burst: [2, 5] as const,
    burstPause: [0.5, 1.4] as const,
    spreadMul: 1.15,
    fireWidth: 2.5,
    maxRangeMul: 2.6,
    holsterAfter: 12,
    /**
     * Глаз на спине нет: цель замечают только в угле обзора (VISION.npcFovDeg) или вплотную.
     * Ранили или услышал выстрел — через реакцию (hurtReaction/hearReaction, с) поворачивается
     * в примерную сторону стрелка (ошибка — alertError × расстояние) и смотрит туда alertTime с.
     * Выстрел своего — смотрит туда же, куда он стреляет (на allyAimPoint px вперёд).
     */
    hurtReaction: [0.4, 0.9] as const,
    hearReaction: [0.5, 1.2] as const,
    alertError: 0.3,
    alertTime: 4,
    allyAimPoint: 220,
  },
} as const;

/**
 * Граната (предмет grenade; игрок — T, NPC — Gunner): летит к точке броска (стену не перелетает,
 * бетонный блок — перелетает), взрывается через fuse с от броска. Урон по кругу radius — от damage в
 * центре до damage × edge на краю; стена закрывает целиком, бетонный блок ослабляет (× barrierMul).
 */
export const GRENADE = {
  speed: 280,
  minThrow: 40,
  maxThrow: 250,
  fuse: 2.3,
  radius: 88,
  damage: 115,
  edge: 0.2,
  barrierMul: 0.35,
  /** Слышимость взрыва (px) и тряска экрана игрока ближе shakeRange. */
  noise: 2000,
  shakeRange: 420,
  /** Между бросками одного персонажа не меньше… */
  cooldown: 1.2,
  /**
   * ИИ: бросает, если цель в minDist..maxDist и прячется за укрытием (блок/угол — не видно или
   * блок на линии) или цели кучкуются (≥ 2 врага в радиусе взрыва); не чаще cooldown с,
   * шанс chance на каждую проверку (раз в check с); своих в радиусе взрыва у точки — не бросает.
   * Подрывник (demolitionist): в demoMul раз чаще бросает и короче перерыв; бросает и в одного.
   */
  ai: { minDist: 90, maxDist: 240, cooldown: [9, 16] as const, check: 1, chance: 0.35, demoMul: 3 },
  /** NPC, заметивший гранату ближе radius + fleeMargin, убегает от неё. */
  fleeMargin: 36,
  /**
   * Дымовая: через fuse с — облако радиуса radius px (растёт за grow с), держится time с; тайлы в
   * облаке непрозрачны для взгляда (туман, обзор NPC), но не для пуль. ИИ бросает дым, когда ранен
   * (ниже hurtBelow здоровья) и враг видит его дальше minDist, — между собой и врагом (на доле at пути).
   */
  smoke: { fuse: 1.2, radius: 64, grow: 1.5, time: 16, hurtBelow: 0.6, minDist: 140, at: 0.45, cooldown: [14, 24] as const },
  /** Зажигательная: пламя радиуса radius px на time с (горят по FIRE), вспышка — урон damage в центре. */
  fire: { fuse: 1.8, radius: 58, time: 9, damage: 25 },
  /**
   * Осколки: frags штук разлетаются от взрыва (видны; урон уже в damage), шрапнель ранит и за
   * радиусом — не дальше fragReach × radius с шансом fragChance (по ногам и рукам, кровотечение).
   */
  frags: 22,
  fragReach: 1.6,
  fragChance: 0.35,
  fragDamage: 18,
} as const;

/**
 * РПГ: ракета летит WEAPONS.rpg.speed px/с и взрывается о стену или первого на пути (не ближе
 * arm px от стрелка — иначе не взводится и просто падает); взрыв — как граната × blastMul.
 * ИИ стреляет из РПГ по цели не ближе minDist (своих у точки нет), если за укрытием или врагов
 * кучка ≥ crowd; не чаще cooldown с.
 */
export const ROCKET = {
  arm: 60,
  minDist: 170,
  crowd: 2,
  cooldown: [8, 14] as const,
  /** Дымный след: частица каждые trailEvery с полёта. */
  trailEvery: 0.02,
} as const;

/**
 * Огонь пиротехника: его граната оставляет пламя (радиус × zoneRadiusMul, zoneTime с), болт арбалета
 * поджигает цель. Горящий получает dps урона в секунду burnTime с (стоя в пламени — горит дальше).
 */
export const FIRE = {
  zoneTime: 7,
  zoneRadiusMul: 0.6,
  burnTime: 3,
  dps: 9,
  boltBurn: 4,
} as const;
