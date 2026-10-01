/** Законы Сити-17 и работа ГО. Время — секунды, расстояния — px, деньги — токены. */
export const LAW = {
  /**
   * Оружие в городе: стрелявший ближе firedWithin с назад (бандит, стычка банд) — уже не нарушитель, а
   * вооружённый враг (hostile, розыск, тревога — ГО открывает огонь); ствол в руках без стрельбы — приказ и
   * тревога патрулям квартала (не чаще alarmEvery с на человека). Патрульный, услышавший выстрел не
   * Альянса ближе hear px в городе, поднимает тревогу (не чаще shotAlarmEvery с).
   */
  armed: { firedWithin: 6, alarmEvery: 30, hear: 520, shotAlarmEvery: 20 },
  /**
   * Прочёсывание по тревоге (состояние hunt ГО): не толпой в одну точку — каждый берёт свою точку в
   * radius якорей вокруг последнего известного места, не ближе spacing px к точкам других, стоит там
   * pause с, оглядываясь, и идёт к следующей; место сместилось дальше moved px — всё заново.
   */
  hunt: { radius: [3, 14] as const, spacing: 48, pause: [1, 3] as const, moved: 120 },
  /** Конвой: задержанный отстал дальше — конвоир останавливается и ждёт его (px). */
  escortWait: 110,
  /** Быстрее этого — «бег», нарушение, если видит ГО. */
  runSpeed: 125,
  /** Как часто ГО осматривается. */
  scanInterval: 0.3,
  /** Шанс «на всякий случай» проверить CID у замеченного гражданина за один осмотр. */
  randomCheckChance: 0.035,
  /** Код жёлтый (тревога в городе): плановые проверки CID во столько раз чаще. */
  alarmCheckMul: 2.5,
  /** На пограничном КПП проверяют почти всех. */
  checkpointCheckChance: 0.5,
  /** Не проверять одного и того же чаще. */
  recheckCooldown: 90,

  /** С какого расстояния ГО говорит с задержанным и проверяет. */
  talkDistance: 40,
  checkTime: 1.6,
  /** Игрок, которому приказали стоять, может сдвинуться не дальше — иначе «сопротивление». */
  complyRadius: 40,
  /** Сколько даётся игроку, чтобы остановиться. */
  complyGrace: 0.8,

  fines: { running: 5, restricted: 15, insult: 12 },
  /** За что арест (иначе штраф). */
  arrestFor: ['restricted', 'no_cid', 'wanted', 'resisting', 'rebel', 'weapon', 'curfew', 'theft', 'riot', 'contraband'] as readonly string[],
  /** Дознаватели JURY: проверка быстрее, штраф больше. */
  juryCheckMul: 0.5,
  juryFineMul: 2,

  chaseLoseTime: 6,
  catchDistance: 30,
  cpWalkSpeed: 78,
  cpRunSpeed: 150,
  /** Подкрепление из Цитадели: до поста дальше этого (px) — бегом. */
  cpRunToPost: 200,
  /** Посты ГО на узких местах. */
  postTime: [8, 25] as const,
  postChance: 0.4,
  patrolDistance: [15, 55] as const,

  jailTime: { player: 40, npc: 35 },
  /** Выбитая дверь камеры не запирается brokenDoor с. */
  brokenDoor: 60,
  /**
   * Тюрьма Альянса (повстанцы: армия и подполье): в камере до perCell мест через spacing px; NPC сидит
   * бессрочно — пока не освободят свои, игрок — playerTime с (оружие не вернут). Ворота — gateOut тайлов
   * за стеной двора.
   */
  prison: { cell: { max: 4, spacing: 30 }, playerTime: 180, gateOut: 3 },
  /** Общая камера КПЗ (граждане, ГСР, партизаны): мест не больше max, между местами spacing px. */
  commonCell: { max: 10, spacing: 34 },

  npc: {
    noCidChance: 0.08,
    wantedChance: 0.04,
    /** Шанс, что NPC побежит, когда ГО приказал стоять. */
    // Грузчик и оружейник склада на службе, с документами — не бегут.
    fleeChance: { citizen: 0.12, cwu: 0.05, rebel: 0.8, thief: 0.3, bandit: 0.3, fugitive: 0.85, loader: 0, armorer: 0 } as Record<string, number>,
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
  | 'contraband';

export const VIOLATION_NAMES: Record<Violation, string> = {
  running: 'бег',
  restricted: 'нахождение в запретной зоне',
  no_cid: 'отсутствие CID',
  wanted: 'розыск',
  resisting: 'неподчинение',
  routine: 'плановая проверка',
  rebel: 'участие в сопротивлении',
  weapon: 'ношение оружия',
  curfew: 'нарушение комендантского часа',
  insult: 'оскорбление сотрудника ГО',
  theft: 'кража',
  riot: 'участие в беспорядках',
  contraband: 'контрабанда',
};
