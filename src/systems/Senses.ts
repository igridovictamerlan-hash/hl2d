import type { AiContext } from '../ai/AiContext';
import type { Character } from '../entities/Character';
import type { Rng } from '../core/rng';
import type { Corpse } from './CombatSystem';
import { SENSES, type StimDef, type StimKind } from '../config/senses';
import { WEAPONS } from '../config/items';
import { FACTIONS } from '../config/factions';
import { lineOfSight } from '../world/visibility';
import { Gunner } from '../ai/Gunner';
import { CitizenBrain } from '../ai/brains/CitizenBrain';
import { CpBrain } from '../ai/brains/CpBrain';
import { phrase } from './phrases';

/**
 * Раздражитель: где, что, кто виновник и кто пострадал. src — откуда исходит угроза (крик и бегущие передают
 * направление настоящей опасности, а не точку, где кричали); hop — сколько раз передан (заражение паникой).
 */
export interface Stimulus {
  kind: StimKind;
  x: number;
  y: number;
  actor: Character | null;
  victim: Character | null;
  src: { x: number; y: number };
  hop: number;
  power: number;
  /** Радиус, если не по умолчанию (выстрел — по слышимости ствола). */
  r: number;
  corpse: Corpse | null;
}

/** Кто чего боится: последний источник (не пугает чаще SENSES.fear.repeat). */
interface Last {
  actor: Character | null;
  kind: StimKind;
  t: number;
}

const buf: Character[] = [];

/** Мирные: те, кого пугает и кто может быть свидетелем (горожане, ТС, поднадзорные, бандиты и воры). */
export function civilian(c: Character): boolean {
  return c.faction === 'citizen' || c.faction === 'cwu' || c.faction === 'vort';
}

/**
 * Восприятие и страх (config/senses.ts). Источники: бой (ранения, убийства, выстрелы, взрывы — CombatSystem),
 * сами жители (крик, бегство — заражение паникой), периодический обход (тела, люди со стволом в руках,
 * бегущие). Каждый раздражитель обрабатывается один раз: жители в его радиусе чувствуют его по-своему
 * (храбрость, близкий пострадал, видно или только слышно), свидетели преступления передаются в Suspects
 * (донос), ВС на глазах у которого убили — тоже. Страх хранится на Character (fear, fearAt, fearX/Y) и спадает
 * лениво (fearOf). Своя случайность (rng.fork) — общая случайность мира не сдвигается.
 */
export class Senses {
  enabled = true;
  readonly rng: Rng;
  private readonly queue: Stimulus[] = [];
  /** Уже услышанные выстрелы (у выстрелов одного тика одинаковое время — курсор по времени пропускал бы их). */
  private readonly heard = new WeakSet<object>();
  /** Раненый кричит и пугает не чаще, чем раз в hurtEvery с (горение бьёт 60 раз в секунду). */
  private readonly hurtAt = new WeakMap<Character, number>();
  private readonly last = new WeakMap<Character, Last>();
  private readonly emitted = new WeakMap<Character, { scream: number; runner: number; armed: number }>();
  private bodyTimer = 0;
  private scanIndex = 0;
  readonly stats = { stimuli: 0, felt: 0, panics: 0, hides: 0, screams: 0, bodies: 0, gawks: 0, grieves: 0, witnessed: 0, cpSaw: 0 };

  constructor(private readonly ctx: AiContext) {
    this.rng = ctx.rng.fork(0x5e45e);
    const combat = ctx.combat;
    const prev = combat.onDamage;
    combat.onDamage = (t, a, killed) => {
      prev(t, a, killed);
      this.onDamage(t, a, killed);
    };
    combat.deathListeners.push((c, killer) => this.onDeath(c, killer));
  }

  private get now(): number {
    return this.ctx.law.now;
  }

  // ───────────────────────────── страх ─────────────────────────────

  /** Страх сейчас (0..100): спадает линейно с момента последнего испуга. */
  fearOf(c: Character): number {
    if (c.fear <= 0) return 0;
    const f = c.fear - SENSES.fear.decay * Math.max(0, this.now - c.fearAt);
    return f > 0 ? f : 0;
  }

  /** Порог: 0 — спокоен, 1 — насторожился, 2 — испуган, 3 — паника. */
  tier(c: Character): 0 | 1 | 2 | 3 {
    const f = this.fearOf(c);
    const F = SENSES.fear;
    return f >= F.panic ? 3 : f >= F.scared ? 2 : f >= F.alert ? 1 : 0;
  }

  /** Множитель страха по характеру: храбрый пугается меньше. */
  private braveMul(c: Character): number {
    const b = this.ctx.relations ? this.ctx.relations.persona(c).brave : 0.5;
    const [lo, hi] = SENSES.fear.braveMul;
    return lo + (hi - lo) * b;
  }

  /** Добавить страх (с направлением на угрозу). */
  frighten(c: Character, amount: number, src: { x: number; y: number }, by: Character | null, hop: number): void {
    if (amount <= 0) return;
    const cur = this.fearOf(c);
    const next = Math.min(SENSES.fear.max, cur + amount);
    // Направление — от самого сильного недавнего испуга (свежий крик не уводит от настоящей угрозы).
    if (amount >= cur * 0.35 || cur < SENSES.fear.alert) {
      c.fearX = src.x;
      c.fearY = src.y;
      c.fearHop = hop;
      if (by) c.fearBy = by;
    }
    c.fear = next;
    c.fearAt = this.now;
    this.stats.felt++;
  }

  // ───────────────────────────── источники ─────────────────────────────

  /** Раздражитель в очередь (обработается в update этого же тика). */
  emit(
    kind: StimKind,
    x: number,
    y: number,
    o: { actor?: Character | null; victim?: Character | null; src?: { x: number; y: number }; hop?: number; power?: number; r?: number; corpse?: Corpse | null } = {},
  ): void {
    if (!this.enabled) return;
    const def: StimDef = SENSES.kinds[kind];
    this.queue.push({
      kind, x, y,
      actor: o.actor ?? null,
      victim: o.victim ?? null,
      src: o.src ?? { x, y },
      hop: o.hop ?? 0,
      power: o.power ?? 1,
      r: o.r ?? def.r,
      corpse: o.corpse ?? null,
    });
  }

  /** Крик (житель в панике, раненый): пугает соседей, передаёт направление угрозы. Не чаще screamCooldown. */
  scream(c: Character, line = true): boolean {
    const now = this.now;
    const e = this.timers(c);
    if (now - e.scream < SENSES.contagion.screamCooldown) return false;
    e.scream = now;
    const hop = c.fearHop + 1;
    if (line && !(c.speech && c.speech.until > now)) c.say(phrase(this.rng, c, SENSES.lines.scream), now, 1.6);
    this.stats.screams++;
    if (hop > SENSES.contagion.hops) return true;
    this.emit('scream', c.x, c.y, { actor: null, src: { x: c.fearX || c.x, y: c.fearY || c.y }, hop, power: SENSES.contagion.decay ** hop });
    return true;
  }

  private timers(c: Character): { scream: number; runner: number; armed: number } {
    let e = this.emitted.get(c);
    if (!e) this.emitted.set(c, (e = { scream: -1e9, runner: -1e9, armed: -1e9 }));
    return e;
  }

  private onDamage(t: Character, a: Character | null, killed: boolean): void {
    if (!this.enabled || !a || a === t || killed || !t.alive) return;
    // Кулаки — драка (Brawls: зеваки), не повод для паники.
    if (!a.weapon) return;
    const now = this.now;
    if (now - (this.hurtAt.get(t) ?? -1e9) < 0.7) return;
    this.hurtAt.set(t, now);
    const cls = WEAPONS[a.weapon].class;
    a.lastViolent = this.ctx.combat.now;
    const blade = cls === 'blade' || cls === 'melee';
    if (blade && Math.hypot(a.x - t.x, a.y - t.y) < 60) a.bloodyUntil = now + 600;
    const kind: StimKind = t.downed ? 'downed' : blade ? 'stab' : 'hit';
    this.emit(kind, t.x, t.y, { actor: a, victim: t, src: { x: a.x, y: a.y } });
    // Раненый кричит (если может) — это слышно и за углом.
    if (!t.downed && !t.isPlayer && civilian(t)) {
      t.fearX = a.x;
      t.fearY = a.y;
      t.fearHop = 0;
      this.scream(t);
    }
  }

  private onDeath(c: Character, killer: Character | null): void {
    if (!this.enabled || !killer || killer === c) return;
    killer.lastViolent = this.ctx.combat.now;
    const corpse = this.ctx.combat.corpses[this.ctx.combat.corpses.length - 1] ?? null;
    this.emit('kill', c.x, c.y, { actor: killer, victim: c, src: { x: killer.x, y: killer.y }, corpse: corpse && corpse.pid === c.pid ? corpse : null });
  }

  /** Новые выстрелы и взрывы (combat.shots) — звуки. Учебные стрельбы в тире не в счёт. */
  private pollShots(): void {
    const shots = this.ctx.combat.shots;
    for (let i = shots.length - 1; i >= 0; i--) {
      const s = shots[i];
      if (this.heard.has(s)) break;
      this.heard.add(s);
      if (s.shooter?.cadet) continue;
      if (s.weapon === 'smoke') continue;
      const blast = s.weapon === 'blast';
      const def = SENSES.kinds[blast ? 'blast' : 'shot'];
      const r = Math.min(def.r, s.noise);
      if (r < 40) continue;
      this.emit(blast ? 'blast' : 'shot', s.x, s.y, { actor: s.shooter, r });
    }
  }

  // ───────────────────────────── обработка ─────────────────────────────

  update(dt: number): void {
    if (!this.enabled) {
      this.queue.length = 0;
      return;
    }
    this.pollShots();
    this.patrol();
    // Сначала то, что случилось на глазах (свидетели убийства записаны в дело), потом — кто нашёл тела.
    this.drain();
    this.bodyTimer -= dt;
    if (this.bodyTimer <= 0) {
      this.bodyTimer = SENSES.body.every;
      this.bodies();
      this.drain();
    }
  }

  /** Новые раздражители (крик в панике, тело) могут добавиться по ходу — обработать и их, но не бесконечно. */
  private drain(): void {
    for (let n = 0; n < 200 && this.queue.length; n++) this.process(this.queue.shift()!);
  }

  private process(s: Stimulus): void {
    const { ctx } = this;
    const def: StimDef = SENSES.kinds[s.kind];
    this.stats.stimuli++;
    const level = ctx.map.levelAt(s.x, s.y);
    const now = this.now;
    const crime = !!def.crime && !!s.actor;
    // Дело заводится раз на раздражитель (даже без свидетелей — убийство остаётся делом), свидетели дописываются.
    const cs = crime ? ctx.suspects?.crime(s) ?? null : null;
    const seen: Character[] = [];
    for (const o of ctx.entities.near(s.x, s.y, s.r, buf)) {
      if (!o.alive || o.downed || o.isPlayer || o === s.actor) continue;
      if (o === s.victim && s.kind !== 'scream') continue;
      const d = Math.hypot(o.x - s.x, o.y - s.y);
      if (d > s.r || ctx.map.levelAt(o.x, o.y) !== level) continue;
      const los = lineOfSight(ctx.map, o.x, o.y, s.x, s.y);
      let k: number;
      if (def.visual) {
        if (!los) continue;
        if (d > SENSES.close && !Gunner.inView(o, s.x, s.y)) continue;
        k = 1;
      } else k = los ? 1 : def.wall ?? 0;
      if (k <= 0) continue;
      // ВС: преступление на глазах — свой разговор (Suspects), бояться им не положено.
      if (o.brain instanceof CpBrain) {
        if (crime && def.visual) {
          this.stats.cpSaw++;
          ctx.suspects?.cpSaw(cs, o, s);
        } else if (s.kind === 'scream' && s.hop <= 1) ctx.suspects?.cpHeard(o, s);
        continue;
      }
      if (!(o.brain instanceof CitizenBrain) || !civilian(o)) continue;
      // Тот же источник не пугает чаще repeat с (очередь из автомата — один испуг, а не тридцать).
      const L = this.last.get(o);
      if (L && L.actor === s.actor && L.kind === s.kind && s.actor && now - L.t < SENSES.fear.repeat) continue;
      this.last.set(o, { actor: s.actor, kind: s.kind, t: now });
      const fall = 1 - (1 - SENSES.edge) * (d / s.r);
      let amount = def.fear * s.power * fall * k * this.braveMul(o);
      const rel = ctx.relations;
      if (s.victim && rel?.enabled && rel.loved(o, s.victim)) amount *= SENSES.fear.lovedMul;
      this.frighten(o, amount, s.src, s.actor, s.hop);
      if (crime && def.visual) seen.push(o);
      if (s.kind === 'body' && s.corpse) o.brain.sawBody(s.corpse);
    }
    if (seen.length && s.actor) {
      this.stats.witnessed += seen.length;
      ctx.suspects?.witnessed(cs, s, seen);
    }
    // Квартал запоминает (страх района, эскалация ВС).
    ctx.escalation?.note(s);
  }

  /**
   * Обход по кругу (не больше perFrame за тик): человек со стволом в руках пугает прохожих, бегущий в панике —
   * тоже (заражение). Никто не проверяется чаще, чем раз в несколько секунд.
   */
  private patrol(): void {
    const list = this.ctx.entities.list;
    if (!list.length) return;
    const now = this.now;
    const C = SENSES.contagion;
    for (let n = 0; n < SENSES.perFrame; n++) {
      if (this.scanIndex >= list.length) this.scanIndex = 0;
      const c = list[this.scanIndex++];
      if (!c.alive || c.downed) continue;
      const e = this.timers(c);
      // Бегущий в панике: соседи пугаются, не видя причины (направление — от настоящей угрозы).
      if (c.brain instanceof CitizenBrain && c.brain.fsm.current === 'panic' && c.moveSpeed > 60 && now - e.runner >= C.runnerEvery && c.fearHop < C.hops) {
        e.runner = now;
        this.emit('runner', c.x, c.y, { actor: c, src: { x: c.fearX, y: c.fearY }, hop: c.fearHop + 1, power: C.decay ** (c.fearHop + 1) });
      }
      // Ствол в руках на улице (не сотрудник Протектората, не на фронте): прохожие сторонятся.
      if (c.weapon && !FACTIONS[c.faction].authority && now - e.armed >= SENSES.armed.every && this.ctx.war.inCity(c.x, c.y)) {
        const cls = WEAPONS[c.weapon].class;
        if (cls !== 'melee') {
          e.armed = now;
          const bloody = c.bloodyUntil > now;
          this.emit('armed', c.x, c.y, { actor: c, src: { x: c.x, y: c.y }, power: bloody ? SENSES.armed.bloodyMul : 1 });
        }
      }
    }
  }

  /**
   * Тела: житель видит свежее неосмотренное тело — первый нашедший кричит («Убили!»), это тело — раздражитель для
   * всех, кто видит (страх; любопытные встанут поглазеть, близкие — горевать). Найденное тело — повод донести.
   */
  private bodies(): void {
    const { ctx } = this;
    const B = SENSES.body;
    const ct = ctx.combat.now;
    for (const k of ctx.combat.corpses) {
      if (k.found || k.covered || k.burning !== undefined || ct - k.t > B.fresh) continue;
      if (ctx.map.levelAt(k.x, k.y) !== 'city') continue;
      let finder: Character | null = null;
      let best: number = B.see;
      for (const o of ctx.entities.near(k.x, k.y, B.see, buf)) {
        if (!o.alive || o.downed || o.isPlayer || !(o.brain instanceof CitizenBrain) || !civilian(o)) continue;
        // Убийца «не находит» своё тело.
        if (o === k.killer) continue;
        const d = Math.hypot(o.x - k.x, o.y - k.y);
        if (d >= best || !lineOfSight(ctx.map, o.x, o.y, k.x, k.y)) continue;
        if (d > SENSES.close * 2 && !Gunner.inView(o, k.x, k.y)) continue;
        best = d;
        finder = o;
      }
      if (!finder) continue;
      k.found = true;
      k.foundBy = finder.pid;
      this.stats.bodies++;
      const now = this.now;
      finder.say(phrase(this.rng, finder, SENSES.lines.body), now, 2.6);
      finder.fearX = k.x;
      finder.fearY = k.y;
      finder.fearHop = 0;
      this.emit('body', k.x, k.y, { src: { x: k.x, y: k.y }, corpse: k });
      this.scream(finder, false);
      ctx.suspects?.bodyFound(finder, k);
    }
  }
}
