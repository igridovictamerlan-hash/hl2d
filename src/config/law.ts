/** Законы Верхнеречье и работа ВС. Время — секунды, расстояния — px, деньги — токены. */
/** Статья розыска (LAW.wanted.charges). */
export type WantedCharge = 'flight' | 'informed' | 'fraud' | 'theft' | 'riot' | 'assault' | 'escape' | 'sabotage' | 'fugitive' | 'murder' | 'attackCp' | 'rebel';

/**
 * Паспорта вместо CID (systems/Passports.ts). Отметка о работе: jobs — слова, citizenJobs — профессии горожан, что пишут
 * в паспорт (бандит и вор — «без постоянной работы»). without — профессии без своего паспорта (беглец). coverJobs —
 * кем записан пропавший без вести (паспорт NPC-подпольщика). photo — шанс, что на проверке опознают чужое фото (не
 * подпольщик: у тех PARTISANS.checkReveal); у поддельного (fake_cid) — forgedCatch. take — сколько секунд отбирать
 * паспорт у жертвы (руки вверх, без сознания, тяжело ранен) и на каком расстоянии (reach px).
 */
export const PASSPORT = {
  jobs: { none: 'без постоянной работы', cwu: 'Трудовой союз', worker: 'рабочий', vort: 'поднадзорный · принудительные работы' },
  citizenJobs: [] as readonly string[],
  without: ['fugitive'] as readonly string[],
  coverJobs: ['citizen', 'citizen', 'janitor', 'packer', 'courier', 'cook'] as readonly string[],
  photo: 0.35,
  forgedCatch: 0.1,
  take: { time: 2, reach: 40 },
  lines: {
    caught: 'Патруль: «Фото не ваше». Паспорт изъят — задержаны за подлог.',
    none: 'Паспорта у вас нет: заберите чужой — у жертвы (руки вверх, без сознания) или с тела.',
    taken: 'Вы забрали паспорт: {name}, {job}.',
    swapped: 'Вы взяли паспорт: {name}, {job}. Прежний оставили.',
    victim: ['Отдай… только не стреляй.', 'Это мои документы!', 'Как я без паспорта…'],
  },
} as const;

export const LAW = {
  /**
   * Оружие в городе: стрелявший ближе firedWithin с назад (бандит, стычка банд) — уже не нарушитель, а
   * вооружённый враг (hostile, розыск, тревога — ВС открывает огонь); ствол в руках без стрельбы — приказ и
   * тревога патрулям квартала (не чаще alarmEvery с на человека). Патрульный, услышавший выстрел не
   * Протектората ближе hear px в городе, поднимает тревогу (не чаще shotAlarmEvery с).
   */
  armed: { firedWithin: 6, alarmEvery: 30, hear: 520, shotAlarmEvery: 20 },
  /**
   * Прочёсывание по тревоге (состояние hunt ВС): не толпой в одну точку — каждый берёт свою точку в
   * radius якорей вокруг последнего известного места, не ближе spacing px к точкам других, стоит там
   * pause с, оглядываясь, и идёт к следующей; место сместилось дальше moved px — всё заново.
   */
  hunt: { radius: [3, 14] as const, spacing: 48, pause: [1, 3] as const, moved: 120 },
  /** Конвой: задержанный отстал дальше — конвоир останавливается и ждёт его (px). */
  escortWait: 110,
  /** Быстрее этого — «бег», нарушение, если видит ВС. */
  runSpeed: 125,
  /** Как часто ВС осматривается. */
  scanInterval: 0.3,
  /** Шанс «на всякий случай» проверить документы у замеченного гражданина за один осмотр. */
  randomCheckChance: 0.035,
  /** Код жёлтый (тревога в городе): плановые проверки документов во столько раз чаще. */
  alarmCheckMul: 2.5,
  /** На пограничном КПП проверяют почти всех. */
  checkpointCheckChance: 0.5,
  /**
   * Блок-пост на стене Верхнего города (POI border_check): часовые (RCT, дежурные SU.03) проверяют на его площади каждого
   * с шансом check за осмотр, одного — не чаще recheck с; при проверке — досмотр вещей: свёрток подполья находят всегда,
   * стволы, патроны и гранаты из рюкзака изымают (нарушение 'weapon'), у подпольщика под личиной — с шансом findHidden.
   */
  border: { check: 0.5, recheck: 120, findHidden: 0.3, lines: { found: 'Досмотр на КПП: изъято оружие.', parcel: 'Досмотр на КПП: свёрток нашли.' } },
  /** Не проверять одного и того же чаще. */
  recheckCooldown: 90,
  /** Отсидевшего (выпущен из КПЗ с документами) не проверяют ещё столько секунд — иначе снова задерживали. */
  releasedGrace: 240,

  /** С какого расстояния ВС говорит с задержанным и проверяет. */
  talkDistance: 40,
  checkTime: 1.6,
  /** Игрок, которому приказали стоять, может сдвинуться не дальше — иначе «сопротивление». */
  complyRadius: 40,
  /** Сколько даётся игроку, чтобы остановиться. */
  complyGrace: 0.8,

  /** Штрафы. zone_curfew — комендантский час в квартале (район, а не весь город): штраф и «по домам», не арест. */
  fines: { running: 5, restricted: 15, insult: 12, fight: 15, zone_curfew: 15 },
  /**
   * Комендантский час в квартале: пойманного повторно в течение zoneCurfewRepeat с после штрафа за него же не штрафуют,
   * а задерживают (штраф «по домам» не подействовал).
   */
  zoneCurfewRepeat: 300,
  /** За что арест (иначе штраф). */
  arrestFor: ['restricted', 'no_cid', 'wanted', 'resisting', 'rebel', 'weapon', 'curfew', 'theft', 'riot', 'contraband', 'forgery', 'murder', 'assault'] as readonly string[],
  /** Дознаватели JURY: проверка быстрее, штраф больше. */
  juryCheckMul: 0.5,
  juryFineMul: 2,

  /**
   * Розыск по статьям (LawSystem.declare): у каждой — степень level (1 — мелкое, 2 — тяжкое, 3 — особо тяжкое; беглый —
   * мелкое, но бессрочно),
   * срок ориентировки term с с последнего «засвета» (объявили, опознали; пока враг Протектората — hostile — или в
   * руках ВС, срок не идёт; Infinity — бессрочно), срок заключения jail с (1-я степень — КПЗ, выше — тюрьма; повстанцам
   * в тюрьме — бессрочно, игроку — не больше playerJail). Новая статья тяжелее прежней — заменяет её. ВС узнаёт
   * разыскиваемого в лицо ближе face[level − 1] px (на виду; в личине — нет) и задерживает.
   */
  wanted: {
    charges: {
      flight: { level: 1, name: 'неподчинение ВС', term: 240, jail: 40 },
      informed: { level: 1, name: 'по доносу', term: 240, jail: 40 },
      fraud: { level: 1, name: 'подделка документов', term: 300, jail: 60 },
      theft: { level: 1, name: 'кража', term: 300, jail: 60 },
      riot: { level: 1, name: 'беспорядки', term: 300, jail: 60 },
      assault: { level: 2, name: 'вооружённое нападение', term: 480, jail: 240 },
      escape: { level: 2, name: 'побег из-под стражи', term: 600, jail: 300 },
      sabotage: { level: 2, name: 'диверсия', term: 600, jail: 300 },
      fugitive: { level: 1, name: 'беглый, без документов', term: Infinity, jail: 60 },
      murder: { level: 3, name: 'убийство', term: 900, jail: 600 },
      attackCp: { level: 3, name: 'нападение на Протекторат', term: 900, jail: 600 },
      rebel: { level: 3, name: 'участие в сопротивлении', term: 900, jail: 600 },
    } satisfies Record<WantedCharge, { level: 1 | 2 | 3; name: string; term: number; jail: number }>,
    face: [100, 150, 210] as const,
    playerJail: 300,
    /**
     * Явка с повинной (игрок, E у стойки дежурного Управы): 1-я степень — штраф fine и розыск снят; выше — арест
     * (ВС не дальше reach px от стойки), срок × jailMul.
     */
    surrender: { fine: 20, jailMul: 0.5, reach: 520 },
    /**
     * Горожане узнают разыскиваемого (не ниже level, без личины) ближе r px на виду: лояльный (от loyalty, не друг ему) с
     * шансом chance зовёт ВС, если тот виден (Senses.callCp, не чаще SENSES.armed.call.every на человека); раз в every с.
     */
    inform: { level: 2, r: 200, loyalty: 10, chance: 0.5, every: 3 },
  },
  chaseLoseTime: 6,
  catchDistance: 30,
  cpWalkSpeed: 78,
  cpRunSpeed: 150,
  /** Подкрепление с ГЭС: до поста дальше этого (px) — бегом. */
  cpRunToPost: 200,
  /**
   * Пост «занят», если ближе стольких px: точка поста — не центр якоря 2×2 (до 16 px), и при 12 px
   * часовой у стены топтался на месте, не дойдя до точки.
   */
  postArrive: 18,
  /** Посты ВС на узких местах. */
  postTime: [8, 25] as const,
  postChance: 0.4,
  patrolDistance: [15, 55] as const,

  jailTime: { player: 40, npc: 35 },
  /** Выбитая дверь камеры не запирается brokenDoor с. */
  brokenDoor: 60,
  /**
   * Тюрьма Протектората (повстанцы: армия и подполье): в камере до perCell мест через spacing px; NPC сидит
   * бессрочно — пока не освободят свои, игрок — playerTime с (оружие не вернут). Ворота — gateOut тайлов
   * за стеной двора.
   */
  prison: { cell: { max: 4, spacing: 30 }, playerTime: 180, gateOut: 3 },
  /** Общая камера КПЗ (граждане, ТС, партизаны): мест не больше max, между местами spacing px. */
  commonCell: { max: 10, spacing: 34 },

  npc: {
    noCidChance: 0.08,
    wantedChance: 0.04,
    /**
     * Шанс, что NPC побежит, когда ВС приказал стоять: fleeChance — есть что скрывать (в розыске, без
     * CID, только что украл, ствол в руках, бунт), fleeCalm — документы в порядке. Отсидевший получает
     * документы и розыск снят — бежит редко (раньше «беглеца» задерживали каждую минуту по кругу).
     * Неблагонадёжный (лояльность ниже 0) — × lowLoyaltyMul. Грузчик и оружейник склада на службе — не бегут.
     */
    fleeChance: { citizen: 0.5, cwu: 0.3, rebel: 0.8, thief: 0.6, bandit: 0.6, gang_boss: 0.6, fugitive: 0.85, loader: 0, armorer: 0 } as Record<string, number>,
    fleeCalm: { citizen: 0.02, cwu: 0.01, rebel: 0.8, thief: 0.06, bandit: 0.08, gang_boss: 0.05, fugitive: 0.05, outcast: 0.04, loader: 0, armorer: 0 } as Record<string, number>,
    lowLoyaltyMul: 2,
    /** Шанс нарушить при выборе новой цели: зайти в запретную зону / побежать. */
    trespassChance: { citizen: 0.03, cwu: 0.01, rebel: 0.12 } as Record<string, number>,
    runChance: { citizen: 0.06, cwu: 0.03, rebel: 0.15 } as Record<string, number>,
  },
} as const;

export type Violation =
  | 'running'
  | 'restricted'
  | 'no_cid'
  | 'wanted'
  | 'resisting'
  | 'routine'
  | 'rebel'
  | 'weapon'
  | 'curfew'
  | 'insult'
  | 'theft'
  | 'riot'
  | 'contraband'
  | 'fight'
  | 'forgery'
  /** Убийство и нападение с оружием — по делу (Suspects): арест, в тюрьму Протектората. */
  | 'murder'
  | 'assault'
  /** Причина проверки (не нарушение): опознание по ориентировке. Не наказуемо — отпускают, если дело не доказано. */
  | 'suspect'
  /** Комендантский час в квартале (Escalation): штраф и «по домам», не арест. */
  | 'zone_curfew';

export const VIOLATION_NAMES: Record<Violation, string> = {
  running: 'бег',
  restricted: 'нахождение в запретной зоне',
  no_cid: 'нет паспорта',
  wanted: 'розыск',
  resisting: 'неподчинение',
  routine: 'плановая проверка',
  rebel: 'участие в сопротивлении',
  weapon: 'ношение оружия',
  curfew: 'нарушение комендантского часа',
  insult: 'оскорбление сотрудника ВС',
  theft: 'кража',
  riot: 'участие в беспорядках',
  contraband: 'контрабанда',
  fight: 'драка на улице',
  forgery: 'подложные документы',
  murder: 'убийство',
  assault: 'нападение с оружием',
  suspect: 'проверка по ориентировке',
  zone_curfew: 'комендантский час в квартале',
};
