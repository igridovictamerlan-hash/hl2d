import type { Character } from '../entities/Character';
import type { AiContext } from '../ai/AiContext';
import { CRIME } from '../config/crime';
import { FACTIONS } from '../config/factions';
import { CpBrain } from '../ai/brains/CpBrain';
import { angleDiff } from './CombatSystem';

const near: Character[] = [];
const DEG = Math.PI / 180;

/**
 * Кражи: карманная (вор за спиной у прохожего) и взлом раздатчика рационов (вор с отмычкой, пока
 * окно закрыто). После кражи вор «засвечен» CRIME.seenFor с — ГО, который его увидит, задержит за
 * кражу (LawSystem.observe → 'theft'). Жертва может заметить и закричать — ближайший ГО идёт на крик.
 */
export class CrimeSystem {
  /** Счётчики (тесты, отладка). */
  stats = { pickpockets: 0, stolen: 0, hacks: 0, cries: 0 };

  constructor(private readonly ctx: AiContext) {}

  /** Стоит ли вор за спиной у жертвы и рядом. */
  behind(thief: Character, victim: Character): boolean {
    const P = CRIME.pickpocket;
    if (Math.hypot(victim.x - thief.x, victim.y - thief.y) > P.reach) return false;
    const toThief = Math.atan2(thief.y - victim.y, thief.x - victim.x);
    return Math.abs(angleDiff(toThief, victim.facing)) > P.behindDeg * DEG;
  }

  /** Можно ли обокрасть: не власть, не вортигонт, не в разбирательстве, есть деньги. */
  victimOk(thief: Character, v: Character): boolean {
    return v !== thief && v.alive && !FACTIONS[v.faction].authority && v.faction !== 'vort' && v.law.phase === 'none' && v.money > 0;
  }

  /** Карманная кража (после выдержки CRIME.pickpocket.time). Возвращает, сколько украдено. */
  pickpocket(thief: Character, victim: Character): number {
    const P = CRIME.pickpocket;
    const rng = this.ctx.rng;
    if (!this.victimOk(thief, victim)) return 0;
    const mul = thief.profession === 'thief' ? P.thiefMul : 1;
    const amount = Math.min(victim.money, Math.round(rng.range(P.amount[0], P.amount[1]) * mul));
    victim.money -= amount;
    thief.money += amount;
    this.stats.pickpockets++;
    this.stats.stolen += amount;
    this.flag(thief);
    if (thief.isPlayer) this.ctx.bus.emit('log', { text: `Вы вытащили у прохожего ${amount} токенов. Не попадитесь ГО на глаза ${CRIME.seenFor} с.`, kind: 'world' });
    if (victim.isPlayer) this.ctx.bus.emit('log', { text: `У вас вытащили ${amount} токенов!`, kind: 'law' });
    else if (rng.chance(P.noticeChance)) this.cry(victim, thief);
    return amount;
  }

  /** Взлом раздатчика рационов: забрать до CRIME.hack.rations со склада будки; отмычка может сломаться. */
  hackDispenser(thief: Character): number {
    const eco = this.ctx.economy;
    const H = CRIME.hack;
    if (eco.open || !thief.inventory.has('lockpick')) return 0;
    const n = Math.min(eco.rationStock, H.rations);
    eco.rationStock -= n;
    if (n > 0) thief.inventory.add('ration', n);
    if (this.ctx.rng.chance(H.lockpickBreak)) thief.inventory.remove('lockpick', 1);
    this.stats.hacks++;
    this.flag(thief);
    this.ctx.bus.emit('log', { text: 'ГСР: раздатчик рационов взломан! Недостача на складе будки.', kind: 'world' });
    return n;
  }

  /** «Засветился»: ГО, увидевший вора в ближайшие секунды, задержит его. */
  private flag(thief: Character): void {
    thief.law.crimeUntil = this.ctx.law.now + CRIME.seenFor;
  }

  /** Жертва кричит «Держи вора!» — ближайший свободный патрульный идёт разбираться. */
  cry(victim: Character, thief: Character): void {
    const now = this.ctx.law.now;
    victim.say(this.ctx.rng.pick(['Держи вора!', 'Эй! Мой кошелёк!', 'Вор! Помогите!']), now, 2.5);
    this.stats.cries++;
    for (const o of this.ctx.entities.near(victim.x, victim.y, CRIME.pickpocket.cryRange, near)) {
      if (!(o.brain instanceof CpBrain) || o.brain.target || o.brain.guardPost || !o.alive) continue;
      if (thief.law.phase !== 'none') return;
      thief.law.crimeUntil = now + CRIME.seenFor;
      o.brain.engage(thief, 'theft');
      return;
    }
  }
}
