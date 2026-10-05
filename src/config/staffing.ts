import type { CpUnitId } from './factions';

/**
 * Штатное расписание силового блока (systems/Staffing.ts): ВС не возрождаются — у каждого юнита своя
 * должность (пост, группа, КПП…). Погиб — должность свободна; через wait с её занимает лучший из младших
 * (from — из каких юнитов берут, по порядку предпочтения) по баллам: заслуги (merit) + выслуга (минуты
 * службы × perMinute). Нужно не меньше minScore[юнит]; никто не дотянул за actingAfter с — назначают
 * лучшего «временно исполняющим». Должность RCT занимает выпускник академии (резерв), иначе пустует.
 */
export const STAFFING = {
  /** Как часто разбирать вакансии (с) и сколько ждёт приказ о назначении. */
  every: 4,
  wait: 20,
  actingAfter: 90,
  /** Выслуга: баллов за минуту службы. */
  perMinute: 1,
  /** Из каких юнитов повышают на должность (по порядку предпочтения). */
  from: {
    rct: [],
    pcu3: ['rct'],
    pcu2: ['pcu3'],
    pcu1: ['pcu2'],
    ofc: ['pcu1'],
    instr: ['pcu1', 'pcu2'],
    su3: ['pcu2', 'pcu3'],
    su2: ['su3', 'pcu2'],
    su1: ['su3', 'pcu1'],
    guard: ['su3', 'pcu2'],
    qm: ['pcu2', 'pcu3'],
    insp: ['su1', 'ofc', 'guard'],
    epu: ['insp', 'ofc'],
    cdt: [],
  } as Record<CpUnitId, readonly CpUnitId[]>,
  /** Сколько баллов нужно для должности. */
  minScore: { rct: 0, pcu3: 6, pcu2: 12, pcu1: 20, ofc: 32, instr: 20, su3: 14, su2: 16, su1: 20, guard: 16, qm: 10, insp: 40, epu: 60, cdt: 0 } as Record<CpUnitId, number>,
  /** Заслуги прошлых лет у начального состава (по юниту): случайно в пределах. */
  startMerit: { rct: [0, 4], pcu3: [4, 12], pcu2: [10, 20], pcu1: [16, 28], ofc: [26, 40], instr: [18, 30], su3: [10, 22], su2: [12, 24], su1: [16, 28], guard: [12, 24], qm: [8, 16], insp: [34, 50], epu: [50, 70], cdt: [0, 0] } as Record<CpUnitId, readonly [number, number]>,
  /** За что даются и снимаются баллы. */
  merit: {
    check: 0.3,
    fine: 1,
    arrest: 2,
    caught: 2,
    killHostile: 3,
    killInnocent: -6,
    investigate: 2,
    revive: 1,
    convoy: 1,
    formation: 0.3,
  },
  /** Повышают только того, кто сейчас не занят делом (состояние мозга). */
  freeStates: ['patrol', 'patrol-again', 'post', 'guard', 'follow', 'duty', 'hunt'] as readonly string[],
  /** Важность должности при равном уровне командования: виды ролей по порядку. */
  kindOrder: ['epu', 'inspector', 'warden', 'officer', 'instructor', 'guard', 'medic', 'squad', 'qm', 'depot', 'jailer', 'convoy', 'bodyguard', 'tech', 'gate', 'post', 'patrol'] as readonly string[],
} as const;
