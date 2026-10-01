/**
 * Распорядок дня (systems/Routine.ts + CitizenBrain): часы суток (LIGHTING.dayLength) управляют жизнью
 * горожан — ночью спят дома, утром очередь и работа, днём дела по городу, вечером досуг. Часы — 0..24,
 * у каждого жителя свой сдвиг (жаворонок/сова). Время — секунды игры.
 */
export const ROUTINE = {
  /** Выключено в безголовых тестах (simHarness) — там свой тест распорядка. */
  enabled: true,
  /** Фазы по часам: [начало, конец). Ночь — с night[0] до night[1] через полночь. */
  hours: { morning: 6, day: 9, evening: 18, night: 23 },
  /** Сдвиг распорядка жителя, ч: от −shift до +shift (по id, детерминированно). */
  shift: 0.75,
  /** Спать ложатся с bed ч (со сдвигом), встают в wake ч. Совы (доля owls) — на owlLate ч позже. */
  bed: 22.5,
  wake: 6.2,
  owls: 0.14,
  owlLate: 3,
  /** Воры и бандиты живут ночью: спят с hustlerBed до hustlerWake. */
  hustlerBed: 7,
  hustlerWake: 13,
  /** Рабочие смены ГСР (со сдвигом): продавцы, повара, фасовщики, курьеры, уборщики, глава. */
  shift9to5: { from: 7, to: 20 },
  /** Профессии со сменами; грузчики и оружейник склада работают круглые сутки (склад не спит). */
  shifted: ['vendor', 'canteen_cook', 'packer', 'courier', 'janitor', 'cwu_head', 'cwu_medic'] as const,
  /** Доля решений, отданных занятиям, по фазам (остальное — прогулка по делам). */
  activity: { morning: 0.7, day: 0.75, evening: 0.85, night: 0.6 },
  /** Множители весов уличных занятий по фазам (нет в списке — 1). */
  weights: {
    morning: { shopping: 0.7, barrel: 0.5, cards: 0.2, bench: 0.6, home: 0.3, notice: 1.6, smoke: 1.4 },
    day: { shopping: 1.8, barrel: 0.4, cards: 0.3, bench: 1, home: 0.6, notice: 1.5, family: 1.2 },
    evening: { shopping: 0.9, barrel: 1.8, cards: 2, bench: 1.3, chat: 1.3, family: 1.4, smoke: 1.2 },
    night: { shopping: 0, barrel: 2.2, cards: 1.5, bench: 0.3, chat: 0.8, notice: 0.2 },
  } as Record<'morning' | 'day' | 'evening' | 'night', Partial<Record<'shopping' | 'chat' | 'barrel' | 'home' | 'bench' | 'family' | 'cards' | 'smoke' | 'notice', number>>>,
  /**
   * Прогулка «по делам» вместо случайной точки: с шансом purpose житель идёт к цели — лавке, доске
   * объявлений, площади, дому родни или к себе (не дальше reach px).
   */
  purpose: 0.65,
  reach: 2400,
  /** Раздача рационов — только днём: с rations[0] до rations[1] ч. */
  rations: [6.5, 21] as const,
  /** Ночью воры выходят чаще, банды — на дела чаще (интервал × opsMul). */
  night: { thiefMul: 2.2, robMul: 1.8, opsMul: 0.6, checkMul: 3 },
  lines: {
    bed: ['Всё, домой — спать.', 'Поздно уже, пора.', 'Завтра опять очередь… спать.', 'Ноги не держат. Домой.'],
    wake: ['Утро… опять.', 'Надо успеть к раздаче.', 'Ещё один день.', 'Встаём, встаём.'],
    work: ['На смену.', 'Опаздываю на смену!', 'Пора за работу.'],
    off: ['Смена кончилась. Наконец-то.', 'Всё, на сегодня хватит.'],
    night: ['Ночью тут лучше не шататься.', 'Тихо как… не к добру.', 'Патруль бы не встретить.'],
  },
} as const;

export type DayPhase = 'morning' | 'day' | 'evening' | 'night';
