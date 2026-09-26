/** Законы Сити-17 и работа ГО. Время — секунды, расстояния — px, деньги — токены. */
export const LAW = {
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
  arrestFor: ['restricted', 'no_cid', 'wanted', 'resisting', 'rebel', 'weapon', 'curfew', 'theft'] as readonly string[],
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

  npc: {
    noCidChance: 0.08,
    wantedChance: 0.04,
    /** Шанс, что NPC побежит, когда ГО приказал стоять. */
    fleeChance: { citizen: 0.12, cwu: 0.05, rebel: 0.8, thief: 0.6, bandit: 0.55, fugitive: 0.85 } as Record<string, number>,
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
  | 'theft';

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
};
