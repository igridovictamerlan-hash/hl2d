import type { ProfessionId } from './professions';

/**
 * Постоянный состав мира — как игроки на сервере: персонажей столько, сколько задано, новых не
 * появляется. Погибший через respawn[вид] секунд появляется снова на спавне своей стороны
 * (ГО и OTA — в Цитадели у ворот Нексуса, армия сопротивления — в лагере в пустоши, партизаны —
 * в схроне в канализации, жители — в жилых кварталах) и возвращается к своему делу.
 */
export const ROSTER = {
  /**
   * Армия сопротивления в лагере (юниты и HP — config/factions.ts, REBEL_RANKS): глава Патрик,
   * ветераны, ветераны-медики, солдаты, новобранцы, пиротехник, подрывник.
   */
  army: [
    ['rebel_leader', 1],
    ['veteran', 3],
    ['rebel_medic', 2],
    ['rebel_soldier', 6],
    ['rebel_recruit', 4],
    ['pyro', 1],
    ['demolitionist', 1],
  ] as [ProfessionId, number][],
  /** Имя главы восстания (NPC). */
  leaderName: 'Патрик',
  /** Спецотряд HYDRA (красные ники): коммандос (один на сервер), сержанты, RCT, снайпер — при главе. */
  hydra: [
    ['commando', 1],
    ['hydra_sergeant', 2],
    ['hydra_rct', 3],
    ['hydra_sniper', 1],
  ] as [ProfessionId, number][],
  /** Партизаны в схроне под городом (ходят люками): подпольщики и спецагент. */
  partisans: 2,
  agents: 1,
  /** OTA: командир OTA.KING и бойцы OTA.ALPHA (часть — с дробовиками). Воюют только на КПП. */
  ota: [
    ['ota_king', 1],
    ['ota_alpha', 5],
  ] as [ProfessionId, number][],
  /**
   * Силовой блок города (юниты — config/factions.ts). RCT.PCU на постах: у проходных КПП
   * (Front.gatePosts), у ворот Нексуса (nexusPosts) и в людных местах (publicPosts). Патрульные
   * группы (squads): ведущий PCU.02 или PCU.01 и squadFollowers PCU.03 за ним; следователи SU.01
   * (investigators) ходят с группами. Офицеры PCU.OFC — построения на плацу. SU.02-техники в
   * городе (technicians, сканер). Инспекторы SU.INSP, охрана SU.GUARD (меньше, чем целей), CMD.EPU.
   */
  cp: {
    nexusPosts: 2,
    publicPosts: 4,
    squads: 3,
    squadFollowers: 2,
    investigators: 3,
    officers: 2,
    technicians: 1,
    inspectors: 2,
    guards: 4,
    epu: 1,
  },
  otaShotgunChance: 0.25,
  /**
   * Через сколько секунд погибший возвращается (по виду роли). ГО и OTA — долго: иначе гарнизон
   * КПП восполняется быстрее, чем повстанцы успевают закрепиться, и КПП не прорвать.
   */
  respawn: {
    citizen: 35,
    cwu: 35,
    vort: 40,
    patrol: 60,
    guard: 60,
    /** RCT проходной КПП (возвращаются и во время капта: проходная — не часть точки D). */
    gate: 60,
    medic: 60,
    post: 60,
    squad: 60,
    tech: 60,
    officer: 120,
    inspector: 150,
    bodyguard: 90,
    epu: 240,
    ota: 90,
    army: 25,
    leader: 50,
    hydra: 35,
    /** Подполье возвращается долго: потеря партизана — ощутимый удар по сопротивлению. */
    partisan: 300,
    /** Спецагент — ещё дольше: он один на сервер. */
    agent: 600,
    trader: 60,
    /** Кладовщик склада SU.QM и охрана склада SU.GUARD (из казармы Нексуса, с набором со склада). */
    qm: 120,
    depot: 60,
  },
  /** Здоровье по профессии (ГО — по юниту, сопротивление — REBEL_RANKS; остальным — CHARACTER.maxHealth). */
  hp: {
    ota_alpha: 150,
    ota_king: 220,
  } as Partial<Record<ProfessionId, number>>,
} as const;

/**
 * Командование сопротивления (RebelCommand): глава выбирает КПП, большинство армии идёт туда,
 * diversion бойцов — отвлекать на второй КПП. Клич главы (rally): бойцы в радиусе radius идут за
 * ним time секунд (для штурма), перезарядка cooldown. Лагерь: раненые отходят туда и лечатся
 * campHeal ед./с, пополняют патроны; выходят снова, подлечившись до readyHealth.
 */
export const COMMAND = {
  /** Первый выход армии из лагеря через… */
  firstMarch: 4,
  diversion: 3,
  /** Неудачных каптов подряд — и глава пересматривает цель. */
  retargetAfterFails: 2,
  /** spread — идут за главой врассыпную: радиус от spread[0] px, шаг spread[1] px (4 кольца). */
  rally: { time: 12, radius: 340, cooldown: 35, speedMul: 1.1, spread: [36, 22] as const },
  campHeal: 6,
  campMags: 4,
  readyHealth: 0.85,
  /** По тропе через пустошь армия идёт быстрым шагом: доля скорости бега. */
  trailSpeed: 0.7,
  /** HYDRA держится не дальше этого от главы (px). */
  escortRange: 90,
} as const;
