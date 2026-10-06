import type { AiContext } from '../ai/AiContext';
import type { Character } from '../entities/Character';
import { CitizenBrain } from '../ai/brains/CitizenBrain';
import { CpBrain } from '../ai/brains/CpBrain';
import { BRAWL } from '../config/brawl';
import { FACTIONS } from '../config/factions';
import { inCustody } from './CombatSystem';
import { lineOfSight } from '../world/visibility';

export interface Brawl {
  a: Character;
  b: Character;
  until: number;
}

interface Vendetta {
  gang: number;
  foe: Character;
  until: number;
}

const near: Character[] = [];

/**
 * Уличные драки на кулаках и «братва» банд: ссора после разговора или задира, ответ на удар кулаком,
 * оскорбление (игрок — O), зеваки. Бандита ударили или ранили — бойцы его банды рядом впрягаются:
 * против безоружного — в драку, иначе вражда (`vendetta` → CombatSystem.isHostile, стреляют).
 * Драка кончается нокаутом, разошлись, вмешалась ВС (нарушение `fight`) или по времени.
 */
export class Brawls {
  readonly list: Brawl[] = [];
  readonly vendettas: Vendetta[] = [];
  /** Случайные драки (ссоры, задиры); в безголовых тестах выключены — свой тест. */
  enabled = true;
  readonly stats = { brawls: 0, kos: 0, insults: 0, backups: 0 };
  private nextRandom: number = BRAWL.every;
  private watchTick = 0;
  private readonly backupAt = new WeakMap<Character, number>();
  private readonly insultAt = new WeakMap<Character, number>();

  constructor(private readonly ctx: AiContext) {
    const combat = ctx.combat;
    combat.vendettaHostile = (a, b) => this.vendetta(a, b);
    combat.onPunch = (t, a) => this.punched(t, a);
    const prev = combat.onDamage;
    combat.onDamage = (t, a, killed) => {
      prev(t, a, killed);
      if (a && a.weapon) this.hurt(t, a);
    };
    ctx.law.fightCheck = (c) => this.fighting(c);
  }

  private get now(): number {
    return this.ctx.law.now;
  }

  opponentOf(c: Character): Character | null {
    for (const b of this.list) {
      if (b.a === c) return b.b;
      if (b.b === c) return b.a;
    }
    return null;
  }

  fighting(c: Character): boolean {
    return this.opponentOf(c) !== null;
  }

  /** Может ли драться: жив, на ногах, не сотрудник Протектората, не задержан; NPC — житель. */
  canBrawl(c: Character): boolean {
    if (!c.alive || !c.fit || FACTIONS[c.faction].authority || inCustody(c) || c.law.phase !== 'none') return false;
    return c.isPlayer || c.brain instanceof CitizenBrain;
  }

  /** Начать драку a против b (pile — b уже дерётся с другим: «навалились»). */
  start(a: Character, b: Character, pile = false): boolean {
    if (a === b || this.fighting(a) || (!pile && this.fighting(b)) || !this.canBrawl(a) || !this.canBrawl(b)) return false;
    const L = BRAWL.lines;
    this.list.push({ a, b, until: this.now + this.ctx.rng.range(BRAWL.time[0], BRAWL.time[1]) });
    for (const c of [a, b]) if (!c.isPlayer && c.brain instanceof CitizenBrain) c.brain.startBrawl();
    if (!a.isPlayer) a.say(this.ctx.rng.pick(L.start), this.now, 2);
    this.stats.brawls++;
    const p = this.ctx.player;
    if (p && (p === a || p === b || Math.hypot(p.x - a.x, p.y - a.y) < 600)) {
      this.ctx.bus.emit('log', { text: `Драка: ${a.isPlayer ? 'вы' : a.name} и ${b.isPlayer ? 'вы' : b.name}.`, kind: 'world' });
    }
    return true;
  }

  /** Вражда банды с обидчиком (для CombatSystem.isHostile). */
  private vendetta(a: Character, b: Character): boolean {
    if (!this.vendettas.length) return false;
    for (const v of this.vendettas) {
      if ((a.gang === v.gang && b === v.foe) || (b.gang === v.gang && a === v.foe)) return true;
    }
    return false;
  }

  /** Ударили кулаком: житель отвечает (или убегает), за бандита — братва. */
  private punched(t: Character, a: Character): void {
    if (!this.fighting(t) && !t.isPlayer && t.brain instanceof CitizenBrain && this.canBrawl(t) && this.canBrawl(a)) {
      if (t.gang >= 0 || this.ctx.rng.chance(BRAWL.fightBack)) this.start(t, a, true);
      else {
        t.say(this.ctx.rng.pick(BRAWL.lines.flee), this.now, 2);
        t.brain.fleeFrom(a);
      }
    }
    if (t.gang >= 0) this.backup(t, a, true);
  }

  /** Ранили из оружия: за бандита — братва (вражда). */
  private hurt(t: Character, a: Character): void {
    if (t.gang >= 0 && t.alive) this.backup(t, a, false);
  }

  /** Бойцы банды пострадавшего рядом впрягаются: кулаками — в драку, иначе — вражда с обидчиком. */
  backup(victim: Character, attacker: Character, fists: boolean): void {
    const g = this.ctx.gangs?.of(victim);
    if (!g || attacker.gang === victim.gang || !attacker.alive) return;
    const B = BRAWL.backup;
    const now = this.now;
    const unarmed = fists && !attacker.weapon && !FACTIONS[attacker.faction].authority;
    let n = 0;
    for (const m of this.ctx.gangs.members(g)) {
      if (m === victim || m.isPlayer || !m.fit || m.law.phase !== 'none') continue;
      if (Math.hypot(m.x - victim.x, m.y - victim.y) > B.radius) continue;
      if (now - (this.backupAt.get(m) ?? -1e9) < B.every) continue;
      this.backupAt.set(m, now);
      if (unarmed) {
        if (!this.fighting(m)) this.start(m, attacker, true);
      } else this.addVendetta(g.id, attacker);
      m.say(this.ctx.rng.pick(BRAWL.lines.backup), now, 2);
      n++;
    }
    if (!n) return;
    this.stats.backups++;
    if (attacker.isPlayer) this.ctx.bus.emit('log', { text: `«${g.def.name}» впрягаются за своего!`, kind: 'law' });
    else if (victim.isPlayer) this.ctx.bus.emit('log', { text: `Братва «${g.def.name}» впрягается за вас.`, kind: 'world' });
  }

  private addVendetta(gang: number, foe: Character): void {
    const until = this.now + BRAWL.backup.time;
    const v = this.vendettas.find((x) => x.gang === gang && x.foe === foe);
    if (v) v.until = until;
    else this.vendettas.push({ gang, foe, until });
  }

  /**
   * Оскорбить (игрок — O): ВС требует документы, бандит почти всегда бросается в драку (с братвой),
   * житель — с шансом (лоялисты реже), иначе огрызается.
   */
  insult(by: Character, target: Character): string {
    const { ctx } = this;
    const now = this.now;
    const L = BRAWL.lines;
    if (now - (this.insultAt.get(by) ?? -1e9) < BRAWL.insult.cooldown) return '';
    this.insultAt.set(by, now);
    by.say(ctx.rng.pick(L.insult), now, 2.5);
    this.stats.insults++;
    if (FACTIONS[target.faction].authority) {
      if (target.brain instanceof CpBrain && ctx.law.canSee(target, by) && by.law.phase === 'none') {
        target.say(ctx.rng.pick(L.cp), now, 2);
        target.brain.engage(by, 'insult');
        return `${target.name} требует документы.`;
      }
      return `${target.name} делает вид, что не слышит.`;
    }
    const brawler = target.brain instanceof CitizenBrain && this.canBrawl(target) && this.canBrawl(by);
    const anger = target.gang >= 0 ? BRAWL.insult.banditAnger : target.loyalty >= BRAWL.calmLoyalty ? BRAWL.insult.anger / 3 : BRAWL.insult.anger;
    if (brawler && ctx.rng.chance(anger) && this.start(target, by, true)) {
      if (target.gang >= 0) this.backup(target, by, true);
      return `${target.name} бросается на вас!`;
    }
    target.say(ctx.rng.pick(L.retort), now, 2);
    return '';
  }

  /** Цель оскорбления — тот, кто перед by ближе reach (в секторе взгляда). */
  targetFor(by: Character): Character | null {
    let best: Character | null = null;
    let bestD: number = BRAWL.insult.reach;
    for (const o of this.ctx.entities.near(by.x, by.y, BRAWL.insult.reach, near)) {
      if (o === by || !o.alive) continue;
      const d = Math.hypot(o.x - by.x, o.y - by.y);
      const ang = Math.atan2(o.y - by.y, o.x - by.x) - by.facing;
      if (Math.cos(ang) < 0.5 || d >= bestD) continue;
      bestD = d;
      best = o;
    }
    return best;
  }

  /** Ссора после разговора (CitizenBrain.endChat). */
  quarrel(a: Character, b: Character): void {
    if (!this.enabled || a.loyalty >= BRAWL.calmLoyalty || b.loyalty >= BRAWL.calmLoyalty || !this.ctx.rng.chance(BRAWL.chatChance)) return;
    this.start(a, b);
  }

  update(dt: number): void {
    const { ctx } = this;
    const now = this.now;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const b = this.list[i];
      const ko = ctx.combat.knockedOut(b.a) ? b.a : ctx.combat.knockedOut(b.b) ? b.b : null;
      const over =
        ko || now > b.until || !this.canBrawl(b.a) || !this.canBrawl(b.b) || Math.hypot(b.a.x - b.b.x, b.a.y - b.b.y) > BRAWL.lose;
      if (!over) continue;
      this.list.splice(i, 1);
      if (ko) {
        this.stats.kos++;
        ko.say(ctx.rng.pick(BRAWL.lines.ko), now, 2.5);
        if (ko.isPlayer) ctx.bus.emit('log', { text: 'Вас отправили в нокаут.', kind: 'world' });
      }
      for (const c of [b.a, b.b]) if (!this.fighting(c) && c.brain instanceof CitizenBrain && !c.isPlayer) c.brain.endBrawl(c === ko);
    }
    for (let i = this.vendettas.length - 1; i >= 0; i--) {
      const v = this.vendettas[i];
      if (now > v.until || !v.foe.alive || inCustody(v.foe)) this.vendettas.splice(i, 1);
    }
    // Зеваки: прохожие останавливаются поглазеть.
    if ((this.watchTick -= dt) <= 0 && this.list.length) {
      this.watchTick = 1;
      for (const b of this.list) {
        const x = (b.a.x + b.b.x) / 2;
        const y = (b.a.y + b.b.y) / 2;
        for (const o of ctx.entities.near(x, y, BRAWL.watch, near)) {
          if (o === b.a || o === b.b || o.isPlayer || !(o.brain instanceof CitizenBrain) || this.fighting(o)) continue;
          if (lineOfSight(ctx.map, o.x, o.y, x, y)) o.brain.watchFight(x, y);
        }
      }
    }
    // Задира: раз в every с — житель цепляется к прохожему рядом.
    if (!this.enabled || (this.nextRandom -= dt) > 0) return;
    this.nextRandom = BRAWL.every;
    if (ctx.war.code === 'red' || !ctx.rng.chance(BRAWL.randomChance)) return;
    // Задира — из тех, у кого рядом есть прохожий (раньше брали любого гуляющего и чаще всего зря).
    const pairs: [Character, Character][] = [];
    for (const a of ctx.entities.list) {
      if (a.isPlayer || a.faction !== 'citizen' || a.loyalty >= BRAWL.calmLoyalty || !(a.brain instanceof CitizenBrain) || a.brain.fsm.current !== 'walk' || !this.canBrawl(a)) continue;
      const o = this.markFor(a);
      if (o) pairs.push([a, o]);
    }
    if (!pairs.length) return;
    const [a, o] = ctx.rng.pick(pairs);
    this.start(a, o);
  }

  /** Прохожий, к которому задира a может прицепиться: житель рядом (seek px), на виду, не в драке. */
  private markFor(a: Character): Character | null {
    const { ctx } = this;
    for (const o of ctx.entities.near(a.x, a.y, BRAWL.seek, near)) {
      if (o === a || o.isPlayer || o.faction !== 'citizen' || !this.canBrawl(o) || this.fighting(o)) continue;
      if (lineOfSight(ctx.map, a.x, a.y, o.x, o.y)) return o;
    }
    return null;
  }
}
