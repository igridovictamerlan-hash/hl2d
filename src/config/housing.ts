/**
 * Жильё (systems/Housing.ts): у каждого жителя свой дом — комната в доме на проспекте (Арбат), на
 * улице, в общежитии, в особняке или дом в квартале. Время — секунды, расстояния — px.
 */
export type DwellingKind = 'arbat' | 'street' | 'dorm' | 'villa' | 'house';

export const HOUSING = {
  /**
   * Куда селят (по порядку; в своём виде — ближе к месту работы, если оно есть). Семьи — половина
   * на Арбат (familyArbat), половина в общежития; одиночки и ТС — на проспект; воры, бандиты,
   * отбросы и поднадзорные — в дома кварталов; подполье — явки подальше от Управы.
   */
  prefs: {
    family: ['arbat', 'dorm', 'street', 'house'],
    familyDorm: ['dorm', 'arbat', 'street', 'house'],
    single: ['arbat', 'street', 'dorm', 'house'],
    cwu: ['arbat', 'street', 'dorm', 'house'],
    hustler: ['house', 'street', 'dorm', 'arbat'],
    vort: ['house', 'street', 'dorm', 'arbat'],
    underground: ['house', 'dorm', 'street'],
  } as Record<string, readonly DwellingKind[]>,
  familyArbat: 0.5,
  /** В начале у себя дома — эта доля жителей (выходят на улицу из своих дверей). */
  startHome: 0.35,
  /**
   * Домой — хотя бы раз в every с (первый раз — через first с; если дом не дальше seek px); дома stay с, с шансом sleepChance —
   * поспать на кровати sleep с. Реплики — lines.
   */
  visit: { every: [220, 420] as const, first: [60, 420] as const, seek: 2600 },
  stay: [14, 30] as const,
  sleepChance: 0.35,
  sleep: [35, 60] as const,
  lines: {
    home: ['Дома…', 'Наконец-то.', 'Хоть тут тихо.', 'Надо прибраться.'],
    sleep: ['Хр-р…', 'Зз-з…'],
    leave: ['Ну, пора.', 'Пойду пройдусь.', 'Дела не ждут.'],
  },
  /**
   * Явки подполья: у каждого партизана и спецагента своя комната (не ближе fromNexus px к воротам
   * Управы); тайник — stash ячеек. Добычу (оружие, патроны, гранаты) несут туда; берут оттуда
   * стволы для бандитов и засад. Подполье — туда передохнуть (rest с) после дела.
   */
  safe: { fromNexus: 1100, stash: 16, rest: [12, 25] as const },
} as const;
