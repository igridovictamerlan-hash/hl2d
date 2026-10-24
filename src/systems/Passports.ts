import type { Character, Passport } from '../entities/Character';
import type { ProfessionId } from '../config/professions';
import { PROFESSIONS } from '../config/professions';
import { PASSPORT } from '../config/law';
import { Rng } from '../core/rng';
import { randomName } from '../entities/factory';

/**
 * Паспорта вместо CID: у каждого горожанина, рабочего ТС и поднадзорного — свой (номер, имя, место работы). Власти
 * (ВС, Легион, Комендант), армия сопротивления и беглец — без паспорта. У подпольщиков (партизан, спецагент) своего
 * нет: игрок забирает чужой у жертвы или с тела (InsurgencySystem.takePassport, takeIdentity); NPC-подпольщик
 * появляется с паспортом пропавшего без вести (stolenPassport). Отметка о работе меняется вместе с профессией (stampJob).
 */

/** Отметка о работе по стороне и профессии (бандит, вор, отброс — «без постоянной работы»). */
export function jobLine(faction: string, profession: ProfessionId | null): string {
  if (faction === 'vort') return PASSPORT.jobs.vort;
  const p = profession ? PROFESSIONS[profession] : null;
  if (faction === 'cwu') return `${PASSPORT.jobs.cwu} · ${p?.name ?? PASSPORT.jobs.worker}`;
  if (p && PASSPORT.citizenJobs.includes(p.id)) return p.name;
  return PASSPORT.jobs.none;
}

/** Кому паспорт положен (власти, армия, подполье, беглец — без своего). */
export function ownsPassport(c: Character): boolean {
  if (c.faction !== 'citizen' && c.faction !== 'cwu' && c.faction !== 'vort') return false;
  return !PASSPORT.without.includes(c.profession ?? '');
}

/** Выдать свой паспорт (или убрать, если не положен). Подпольщику — паспорт пропавшего (NPC) или ничего (игрок). */
export function issuePassport(c: Character): void {
  if (c.faction === 'rebel' && (c.profession === 'partisan' || c.profession === 'spec_agent')) {
    c.passport = c.isPlayer ? null : stolenPassport(c.pid);
    return;
  }
  if (!ownsPassport(c)) {
    c.passport = null;
    return;
  }
  c.passport = {
    no: c.cid,
    name: c.name,
    job: jobLine(c.faction, c.profession),
    faction: c.faction === 'cwu' ? 'cwu' : 'citizen',
    profession: c.profession,
    owner: c.pid,
  };
}

/** Новая работа (приняли в ТС, уволили) — отметка в своём паспорте; у чужого — нет. */
export function stampJob(c: Character): void {
  const p = c.passport;
  if (!p || p.owner !== c.pid) return;
  p.job = jobLine(c.faction, c.profession);
  p.faction = c.faction === 'cwu' ? 'cwu' : 'citizen';
  p.profession = c.profession;
}

/**
 * Паспорт пропавшего без вести (у NPC-подпольщика): своя случайность от зерна — общая случайность мира не сдвигается.
 * Работа — из PASSPORT.coverJobs (горожанин или рабочий ТС).
 */
export function stolenPassport(seed: number): Passport {
  const rng = new Rng((Math.imul(seed ^ 0x2c1b3c6d, 2654435761) >>> 0) || 1);
  const name = randomName(rng);
  const prof = rng.pick(PASSPORT.coverJobs) as ProfessionId;
  const faction = PROFESSIONS[prof].faction === 'cwu' ? 'cwu' : 'citizen';
  return { no: String(rng.int(10000, 99999)), name, job: jobLine(faction, prof), faction, profession: prof, owner: -1 };
}

/** Предъявленный паспорт чужой (не на него выдан и не поддельный на его имя). */
export function foreignPassport(c: Character): boolean {
  const p = c.passport;
  return !!p && !p.forged && p.owner !== c.pid;
}

/** Строка паспорта для интерфейса: «№ 12345 · Иван Петров · Повар ТС». */
export function passportLine(p: Passport): string {
  return `№ ${p.no} · ${p.name} · ${p.job}`;
}
