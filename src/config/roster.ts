import type { ProfessionId } from './professions';

/**
 * Постоянный состав мира — как игроки на сервере: персонажей столько, сколько задано, новых не
 * появляется. Погибший через respawn[вид] секунд появляется снова на спавне своей стороны
 * (ГО и OTA — в Цитадели у ворот Нексуса, армия сопротивления — в лагере в пустоши, партизаны —
 * в схроне в канализации, жители — в жилых кварталах) и возвращается к своему делу.
 */
export const ROSTER = {
  /** Армия сопротивления в лагере: глава, ветераны, солдаты, пиротехник, подрывник. */
  army: [
    ['rebel_leader', 1],
    ['veteran', 4],
    ['rebel_soldier', 6],
    ['pyro', 1],
    ['demolitionist', 1],
  ] as [ProfessionId, number][],
  /** Спецотряд HYDRA (снаряжение как у SAS): помогает главе штурмовать точки. */
  hydra: [
    ['hydra_captain', 1],
    ['hydra_officer', 2],
    ['hydra_soldier', 3],
  ] as [ProfessionId, number][],
  /** Партизаны в схроне под городом (ходят люками). */
  partisans: 3,
  /** Резерв OTA в Цитадели: элита и солдаты (часть — с дробовиками). */
  ota: [
    ['ota_elite', 2],
    ['ota_soldier', 4],
  ] as [ProfessionId, number][],
  otaShotgunChance: 0.25,
  /** Через сколько секунд погибший возвращается (по виду роли). */
  respawn: {
    citizen: 35,
    cwu: 35,
    vort: 40,
    patrol: 25,
    guard: 20,
    /** RCT проходной КПП (возвращаются и во время капта: проходная — не часть точки D). */
    gate: 20,
    medic: 25,
    ota: 45,
    army: 25,
    leader: 50,
    hydra: 35,
    partisan: 40,
    trader: 60,
  },
  /** Здоровье по профессии (остальным — CHARACTER.maxHealth). */
  hp: {
    rebel_leader: 250,
    veteran: 140,
    demolitionist: 110,
    hydra_captain: 170,
    hydra_officer: 150,
    hydra_soldier: 140,
    ota_elite: 160,
  } as Partial<Record<ProfessionId, number>>,
  /** Ранг по профессии (цвет формы). */
  rank: {
    rebel_leader: 4,
    veteran: 3,
    demolitionist: 2,
    pyro: 1,
    hydra_captain: 4,
    hydra_officer: 3,
    hydra_soldier: 2,
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
  rally: { time: 12, radius: 340, cooldown: 35, speedMul: 1.1 },
  campHeal: 6,
  campMags: 4,
  readyHealth: 0.85,
  /** По тропе через пустошь армия идёт быстрым шагом: доля скорости бега. */
  trailSpeed: 0.7,
  /** HYDRA держится не дальше этого от главы (px). */
  escortRange: 90,
} as const;
