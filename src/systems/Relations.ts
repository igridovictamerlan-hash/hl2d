import type { AiContext } from '../ai/AiContext';
import type { Character } from '../entities/Character';
import { Rng } from '../core/rng';
import { FACTIONS } from '../config/factions';
import { ITEMS, WEAPONS, type ItemId } from '../config/items';
import { ECONOMY } from '../config/economy';
import { RELATIONS, moodLabel, type EventKind, type Habit, type MemKind, type ThoughtKind } from '../config/relations';
import { CitizenBrain } from '../ai/brains/CitizenBrain';
import { lineOfSight } from '../world/visibility';
import { displayName } from '../entities/cover';
import { personaFor, personaText, unit, type Persona } from './Persona';
import { adjustLoyalty } from './Loyalty';
import { fmt } from './Radio';
import { freshTemplate, gendered, remember } from './phrases';

/** Происхождение связи (флаги): задают «базу», к которой со временем возвращается мнение. */
export const BOND = { KIN: 1, HOUSE: 2, WORK: 4, GANG: 8, COMRADE: 16, NEIGHBOR: 32, FRIEND: 64, FEUD: 128 } as const;

/** Что запомнилось об одном человеке: вид, когда, сколько мнения это стоило. */
export interface Memory {
  kind: MemKind;
  at: number;
  w: number;
}

/** Как один человек (владелец) знает и ценит другого (b): мнение −100..100 и знакомство 0..100. */
export interface Bond {
  b: number;
  opinion: number;
  fam: number;
  /** Последний раз, когда что-то случилось между ними / последний пересмотр остывания. */
  at: number;
  dec: number;
  flags: number;
  mem: Memory[];
}

/** «Мысль» — недавнее событие, влияющее на настроение, пока не остыло. */
export interface Thought {
  kind: ThoughtKind;
  at: number;
  until: number;
  v: number;
  /** С кем связана (номер человека) или -1. */
  with: number;
}

export type Tier = 'stranger' | 'acquaintance' | 'friend' | 'close' | 'rival' | 'enemy';

/** Душевное состояние: мысли, потребность в общении, горе. */
interface Psyche {
  thoughts: Thought[];
  social: number;
  at: number;
  mood: number;
  moodAt: number;
  /** Горюет до этого времени, по кому, кто убил (для забывчивости после возрождения). */
  grief: number;
  griefFor: string;
  diedBy: number;
  /** Не раньше этого — снова пожаловаться на одиночество. */
  lonelyAt: number;
  /** Просил еду у игрока: до какого времени и кто. */
  askUntil: number;
}

/** Сведения о человеке для интерфейса (подпись под курсором, панель знакомых). */
export interface PersonInfo {
  pid: number;
  name: string;
  role: string;
  alive: boolean;
  tier: Tier;
  kin: boolean;
  opinion: number;
  fam: number;
  mood: number;
  moodName: string;
  moodColor: string;
  tags: string;
  hobby: string;
  /** Главная причина настроения («избили», «погиб друг»). */
  because: string;
  /** Что помнит (самое памятное): «помощь · 3 мин назад». */
  memory: string;
}

const near: Character[] = [];
const wbuf: Character[] = [];
const sbuf: Character[] = [];

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const civil = (c: Character): boolean => c.faction === 'citizen' || c.faction === 'cwu' || c.faction === 'vort';
/** Ключ отката: вид (0..), от кого, к кому — числа раздельных диапазонов, ключи разных видов не пересекаются. */
const gk = (kind: number, a: number, b = 0): number => kind * 1e12 + a * 1e6 + b;

/** Имя без фамилии: «Мария Зайцева» → «Мария». */
export function first(c: Character): string {
  return displayName(c).split(' ')[0];
}

/**
 * Живые люди: память отношений, характер и настроение (config/relations.ts).
 *
 * — **Связи** (`Bond`): у каждого — мнение о другом (−100..100) и знакомство (0..100), что запомнилось
 *   (драка, помощь, кража…), откуда связь (родня, общага, работа, банда, товарищи) — оно задаёт «базу» мнения;
 *   обиды остывают (злопамятные — медленнее), дружба держится дольше. Знакомство → приятель → близкий друг,
 *   недруг → враг. Связи привязаны к номеру человека (`Character.pid`), а не к телу: возродившийся житель — тот же.
 * — **События** (`event`): разговор, ссора, удар, оскорбление, выстрел, кража, помощь, угощение, арест, штраф,
 *   гибель — у каждого свои последствия для адресата, виновника и свидетелей, мысли и воспоминания.
 * — **Настроение** (`mood`): характер + голод + одиночество + недавние мысли; влияет на ссоры, разговоры, реплики.
 * — **Жизнь на улице** (`update` → `scan`): знакомым — приветствие по имени, друзья останавливаются поболтать,
 *   недругов встречают взглядом, стычкой или уходят; обида ведёт к мести, близкие вступаются в драке,
 *   делятся хлебом с голодным, горюют по погибшему.
 * — **Игрок** — тот же человек: помнит и его помнят (`interact` — E перед человеком; панель знакомых — K).
 * Своя случайность (`rng.fork`) — общая случайность мира не сдвигается. Сохраняется (`serialize`/`restore`).
 */
export class Relations {
  /** Выключить (тесты, «отряд на отряд»): событий и встреч нет. */
  enabled = true;
  /** Встречи на улице (приветствия, стычки, помощь) — отдельно: в части тестов выключены. */
  social = true;
  /** Темы отношений в беседах (знакомство, друзья, слухи о людях) — отдельно: тесты разговоров их отключают. */
  topics = true;
  readonly stats = {
    events: 0, bonds: 0, greets: 0, glares: 0, intros: 0, chats: 0, confronts: 0, revenges: 0, avoids: 0, defends: 0,
    shares: 0, asks: 0, mourns: 0, gossips: 0, forgives: 0, rebuffs: 0, talks: 0, gifts: 0, tiers: 0,
  };
  private readonly rng: Rng;
  private readonly bonds = new Map<number, Map<number, Bond>>();
  private readonly psyches = new Map<number, Psyche>();
  private readonly personas = new Map<number, Persona>();
  private readonly byPid = new Map<number, Character>();
  private readonly names = new Map<number, string>();
  /** Откаты: на пару и вид события / приветствия / стычки / слуха. */
  private readonly cool = new Map<number, number>();
  private readonly later: { at: number; fn: () => void }[] = [];
  private readonly talkAt = new Map<number, number>();
  private debt = 0;
  private cursor = 0;
  /** Свидетели последней гибели (кто видел убийцу) — для горя и мести. */
  private seenKill: Character[] = [];

  constructor(private readonly ctx: AiContext) {
    this.rng = ctx.rng.fork(0x4e1a7);
    const combat = ctx.combat;
    const prevPunch = combat.onPunch;
    combat.onPunch = (t, a) => {
      prevPunch(t, a);
      this.onPunch(t, a);
    };
    const prevDamage = combat.onDamage;
    combat.onDamage = (t, a, killed) => {
      prevDamage(t, a, killed);
      this.onDamage(t, a, killed);
    };
    const prevRevive = combat.onRevive;
    combat.onRevive = (h, t) => {
      prevRevive(h, t);
      this.event('revive', h, t);
    };
    combat.deathListeners.push((c, killer) => this.onDeath(c, killer));
    const law = ctx.law;
    const prevVerdict = law.onVerdict;
    law.onVerdict = (h, t, kind) => {
      prevVerdict?.(h, t, kind);
      this.onVerdict(h, t, kind);
    };
  }

  private get now(): number {
    return this.ctx.law.now;
  }

  // ───────────────────────────── люди ─────────────────────────────

  /** Записать человека (возрождённый — под тем же номером) и забыть обстоятельства прошлой смерти. */
  register(c: Character, respawned = false): void {
    this.byPid.set(c.pid, c);
    this.names.set(c.pid, displayName(c));
    if (respawned) this.onRespawn(c);
  }

  /** Человек по номеру: последнее тело (может быть мёртвым, пока не возродился). */
  person(pid: number): Character | null {
    const c = this.byPid.get(pid);
    if (c && c.pid === pid) return c;
    for (const o of this.ctx.entities.list) {
      if (o.pid === pid) {
        this.byPid.set(pid, o);
        return o;
      }
    }
    return null;
  }

  nameOf(pid: number): string {
    const c = this.byPid.get(pid);
    return (c && c.pid === pid ? displayName(c) : this.names.get(pid)) ?? 'кто-то';
  }

  /** Характер человека (стабильный: по номеру, стороне и профессии на первый запрос). */
  persona(c: Character): Persona {
    let p = this.personas.get(c.pid);
    if (!p) this.personas.set(c.pid, (p = personaFor(c.pid, c.faction, c.profession)));
    return p;
  }

  private personaP(pid: number): Persona {
    const known = this.personas.get(pid);
    if (known) return known;
    const c = this.person(pid);
    return c ? this.persona(c) : personaFor(pid, 'citizen', null);
  }

  /** Множитель веса занятия по привычкам человека (config/street.ts weights). */
  habit(c: Character, h: Habit): number {
    return this.enabled ? this.persona(c).habit[h] : 1;
  }

  // ───────────────────────────── связи ─────────────────────────────

  private base(flags: number): number {
    const B = RELATIONS.bond.base;
    let v = 0;
    if (flags & BOND.KIN) v += B.kin;
    if (flags & BOND.HOUSE) v += B.house;
    if (flags & BOND.WORK) v += B.work;
    if (flags & BOND.GANG) v += B.gang;
    if (flags & BOND.COMRADE) v += B.comrade;
    if (flags & BOND.NEIGHBOR) v += B.neighbor;
    if (flags & BOND.FRIEND) v += B.friend;
    if (flags & BOND.FEUD) v += B.feud;
    return clamp(v, -B.max, B.max);
  }

  /** Остывание: мнение возвращается к базе (обида — со скоростью по злопамятности), старые воспоминания стираются. */
  private settle(owner: number, bd: Bond): void {
    const now = this.now;
    if (now - bd.dec < RELATIONS.bond.decayEvery) return;
    const dt = now - bd.dec;
    bd.dec = now;
    const base = this.base(bd.flags);
    const diff = bd.opinion - base;
    if (Math.abs(diff) < 0.05) bd.opinion = base;
    else {
      const H = RELATIONS.bond.halfLife;
      const g = this.personaP(owner).grudge;
      const half = diff > 0 ? H.good : H.bad * (H.grudgeLo + (H.grudgeHi - H.grudgeLo) * g);
      bd.opinion = base + diff * Math.pow(0.5, dt / half);
    }
    const M = RELATIONS.bond.memories;
    for (let i = bd.mem.length - 1; i >= 0; i--) {
      const m = bd.mem[i];
      if (now - m.at > (RELATIONS.memories[m.kind].sign >= 0 ? M.ttlGood : M.ttlBad)) bd.mem.splice(i, 1);
    }
  }

  /** Связь a → b (как a знает b) или null. */
  bond(a: Character, b: Character): Bond | null {
    return this.bondP(a.pid, b.pid);
  }

  private bondP(a: number, b: number): Bond | null {
    const bd = this.bonds.get(a)?.get(b);
    if (!bd) return null;
    this.settle(a, bd);
    return bd;
  }

  /** Связь (создать, если нет). */
  private make(a: number, b: number, flags = 0): Bond {
    let row = this.bonds.get(a);
    if (!row) this.bonds.set(a, (row = new Map()));
    let bd = row.get(b);
    if (!bd) {
      if (row.size >= RELATIONS.bond.max) this.evict(row);
      bd = { b, opinion: this.base(flags), fam: 0, at: this.now, dec: this.now, flags, mem: [] };
      row.set(b, bd);
      this.stats.bonds++;
    } else bd.flags |= flags;
    return bd;
  }

  /** Забыть самого малозначимого (родню, банду и товарищей — в последнюю очередь). */
  private evict(row: Map<number, Bond>): void {
    let worst = -1;
    let worstScore = Infinity;
    const now = this.now;
    for (const [k, bd] of row) {
      const keep = bd.flags & (BOND.KIN | BOND.GANG | BOND.COMRADE | BOND.HOUSE | BOND.FRIEND | BOND.FEUD) ? 400 : 0;
      const score = keep + bd.fam * 0.6 + Math.abs(bd.opinion - this.base(bd.flags)) * 0.8 + (now - bd.at < 300 ? 20 : 0) + bd.mem.length * 4;
      if (score < worstScore) {
        worstScore = score;
        worst = k;
      }
    }
    if (worst >= 0) row.delete(worst);
  }

  /** Задать связь a → b (и обратную — both): мнение, знакомство, происхождение. Заселение и тесты. */
  link(a: Character, b: Character, opinion: number, fam: number, flags = 0, both = true): void {
    for (const [x, y] of both ? [[a, b], [b, a]] : [[a, b]]) {
      const bd = this.make(x.pid, y.pid, flags);
      bd.opinion = clamp(opinion, -100, 100);
      bd.fam = clamp(fam, 0, 100);
      bd.at = bd.dec = this.now;
      this.names.set(y.pid, displayName(y));
    }
  }

  tierOf(bd: Bond | null): Tier {
    const K = RELATIONS.bond;
    if (!bd || bd.fam < K.known) return 'stranger';
    const T = K.tiers;
    if (bd.opinion <= T.enemy.opinion) return 'enemy';
    if (bd.opinion <= T.rival.opinion) return 'rival';
    if (bd.opinion >= T.close.opinion && bd.fam >= T.close.fam) return 'close';
    if (bd.opinion >= T.friend.opinion && bd.fam >= T.friend.fam) return 'friend';
    return 'acquaintance';
  }

  /** Как a относится к b (уровень знакомства). */
  tier(a: Character, b: Character): Tier {
    return this.tierOf(this.bondP(a.pid, b.pid));
  }

  /** Мнение a о b (0 — нет связи). */
  opinion(a: Character, b: Character): number {
    return this.bondP(a.pid, b.pid)?.opinion ?? 0;
  }

  private opinionP(a: number, b: number): number {
    return this.bondP(a, b)?.opinion ?? 0;
  }

  /** Знает ли a в лицо b (знакомство не меньше порога). */
  knows(a: Character, b: Character): boolean {
    return (this.bondP(a.pid, b.pid)?.fam ?? 0) >= RELATIONS.bond.known;
  }

  /** Родня ли (флаг связи). */
  isKin(a: Character, b: Character): boolean {
    return ((this.bonds.get(a.pid)?.get(b.pid)?.flags ?? 0) & BOND.KIN) !== 0 || (a.family >= 0 && a.family === b.family);
  }

  /** Друг или родня (мнение от порога дружбы): близкие, которых можно просить и которые вступятся. */
  loved(a: Character, b: Character): boolean {
    const bd = this.bondP(a.pid, b.pid);
    if (!bd) return a.family >= 0 && a.family === b.family;
    return bd.opinion >= RELATIONS.loved.opinion && bd.fam >= RELATIONS.bond.known;
  }

  /** Живые друзья и родня (или недруги, если hostile) на одном уровне карты. */
  circle(a: Character, kind: 'friends' | 'rivals', withKin = true): Character[] {
    const out: Character[] = [];
    const row = this.bonds.get(a.pid);
    if (!row) return out;
    const level = this.ctx.map.levelAt(a.x, a.y);
    for (const [pid, bd] of row) {
      this.settle(a.pid, bd);
      const t = this.tierOf(bd);
      const kin = withKin && (bd.flags & BOND.KIN) !== 0 && bd.opinion >= 0 && bd.fam >= RELATIONS.bond.known;
      const ok = kind === 'friends' ? t === 'friend' || t === 'close' || kin : t === 'rival' || t === 'enemy';
      if (!ok) continue;
      const c = this.person(pid);
      if (c && c.alive && !c.downed && this.ctx.map.levelAt(c.x, c.y) === level) out.push(c);
    }
    return out;
  }

  // ───────────────────────────── воспоминания и мысли ─────────────────────────────

  private remember(bd: Bond, kind: MemKind, w: number): void {
    const M = RELATIONS.bond.memories;
    const now = this.now;
    const same = bd.mem.find((m) => m.kind === kind);
    if (same) {
      same.at = now;
      same.w = Math.abs(w) > Math.abs(same.w) ? w : same.w;
      return;
    }
    bd.mem.push({ kind, at: now, w });
    if (bd.mem.length > M.per) {
      // Забывается самое слабое и давнее.
      let k = 0;
      for (let i = 1; i < bd.mem.length; i++) if (Math.abs(bd.mem[i].w) + (bd.mem[i].at - now) * 0.01 < Math.abs(bd.mem[k].w) + (bd.mem[k].at - now) * 0.01) k = i;
      bd.mem.splice(k, 1);
    }
  }

  /** Самое памятное в связи: самая сильная обида или самое тёплое. */
  private notable(bd: Bond, wantBad: boolean): Memory | null {
    let best: Memory | null = null;
    for (const m of bd.mem) {
      const sign = RELATIONS.memories[m.kind].sign;
      if (sign === 0 || (wantBad ? sign >= 0 : sign <= 0)) continue;
      if (!best || Math.abs(m.w) > Math.abs(best.w)) best = m;
    }
    return best;
  }

  private psy(pid: number): Psyche {
    let ps = this.psyches.get(pid);
    if (!ps) {
      const S = RELATIONS.social;
      ps = { thoughts: [], social: S.start[0] + unit(pid, 60) * (S.start[1] - S.start[0]), at: this.now, mood: 0, moodAt: -1e9, grief: 0, griefFor: '', diedBy: -1, lonelyAt: 0, askUntil: 0 };
      this.psyches.set(pid, ps);
    }
    const now = this.now;
    const dt = now - ps.at;
    if (dt > 0.5) {
      ps.at = now;
      ps.social = Math.max(0, ps.social - dt * RELATIONS.social.decay);
      for (let i = ps.thoughts.length - 1; i >= 0; i--) if (ps.thoughts[i].until < now) ps.thoughts.splice(i, 1);
    }
    return ps;
  }

  /** Подумал о чём-то (мысль влияет на настроение, пока не остынет). */
  think(c: Character, kind: ThoughtKind, withPid = -1): void {
    const T = RELATIONS.thoughts[kind];
    const ps = this.psy(c.pid);
    const now = this.now;
    const same = ps.thoughts.filter((t) => t.kind === kind);
    const dup = same.find((t) => t.with === withPid);
    if (dup) {
      dup.at = now;
      dup.until = now + T.time;
      ps.moodAt = -1e9;
      return;
    }
    if (same.length >= T.stack) ps.thoughts.splice(ps.thoughts.indexOf(same[0]), 1);
    ps.thoughts.push({ kind, at: now, until: now + T.time, v: T.v, with: withPid });
    if (ps.thoughts.length > 24) ps.thoughts.shift();
    ps.moodAt = -1e9;
  }

  /** Недавние мысли (для подписи: что сейчас на душе). */
  thoughtsOf(c: Character): readonly Thought[] {
    return this.psy(c.pid).thoughts;
  }

  /** Настроение −100..100: характер, голод, тревога, одиночество и недавние мысли. */
  mood(c: Character): number {
    const ps = this.psy(c.pid);
    const now = this.now;
    if (now - ps.moodAt < 1) return ps.mood;
    const M = RELATIONS.mood;
    const per = this.persona(c);
    let m = (per.kind - per.temper) * M.base + M.baseline;
    if (c.hunger < M.hungerBelow) m -= (M.hungerBelow - c.hunger) * M.hungerMul;
    if (c.hunger < M.starving) m -= M.starvingExtra;
    if (!FACTIONS[c.faction].authority) {
      const code = this.ctx.war?.code;
      if (code === 'yellow') m += M.codes.yellow;
      else if (code === 'red') m += M.codes.red;
    }
    if (c.law.wanted && !FACTIONS[c.faction].authority) m += M.wanted;
    if (c.law.phase === 'jailed' || c.law.phase === 'entering') m += M.jailed;
    m += (ps.social - 50) * M.socialMul;
    for (const t of ps.thoughts) {
      const left = t.until - now;
      const life = RELATIONS.thoughts[t.kind].time;
      m += t.v * Math.min(1, left / (life * 0.4));
    }
    // Мягкий потолок: беда накапливается, но одна за другой давит всё слабее (иначе у бандитов вечное «−100»).
    const soft = RELATIONS.mood.soft;
    const mag = Math.abs(m);
    if (mag > soft.from) m = Math.sign(m) * (soft.from + (mag - soft.from) * soft.mul);
    ps.mood = clamp(m, -100, 100);
    ps.moodAt = now;
    return ps.mood;
  }

  /** Главная причина настроения словами (самая сильная мысль) или '' . */
  because(c: Character): string {
    const ps = this.psy(c.pid);
    let best: Thought | null = null;
    for (const t of ps.thoughts) if (!best || Math.abs(t.v) > Math.abs(best.v)) best = t;
    if (c.hunger < RELATIONS.mood.starving && (!best || best.v > -20)) return 'голод';
    if (ps.social < RELATIONS.social.lonely && (!best || Math.abs(best.v) < 8)) return 'одиночество';
    return best ? RELATIONS.thoughts[best.kind].text : '';
  }

  /** Сколько ещё горюет (с); 0 — нет. */
  mourning(c: Character): number {
    if (!this.enabled) return 0;
    const ps = this.psyches.get(c.pid);
    return ps && ps.grief > this.now ? ps.grief - this.now : 0;
  }

  /** Тянет к людям: потребность в общении упала ниже порога. */
  lonely(c: Character): boolean {
    return this.enabled && this.psy(c.pid).social < RELATIONS.social.lonely;
  }

  /** Общение удовлетворено на amount (разговор, приветствие, встреча с близким). */
  private sociable(c: Character, amount: number): void {
    const ps = this.psy(c.pid);
    ps.social = Math.min(100, ps.social + amount);
    ps.moodAt = -1e9;
  }

  // ───────────────────────────── события ─────────────────────────────

  /** Применить к связи owner → other: мнение (с учётом характера), знакомство, воспоминание, мысль. */
  private apply(owner: Character, other: Character, delta: number, fam: number, mem: MemKind | undefined, thought: ThoughtKind | undefined, flags = 0): void {
    const per = this.persona(owner);
    const s = delta < 0 ? 0.8 + 0.5 * per.grudge : 0.8 + 0.5 * per.trust;
    const bd = this.make(owner.pid, other.pid, flags);
    this.settle(owner.pid, bd);
    const before = this.tierOf(bd);
    bd.opinion = clamp(bd.opinion + delta * s, -100, 100);
    bd.fam = Math.min(100, bd.fam + fam);
    bd.at = this.now;
    this.names.set(other.pid, displayName(other));
    if (mem) this.remember(bd, mem, delta * s);
    if (thought) this.think(owner, thought, other.pid);
    const after = this.tierOf(bd);
    if (after !== before) this.tierChanged(owner, other, before, after);
  }

  /** Игрок следит за переменами: знакомство, дружба, затаённая обида — строка в журнал. */
  private tierChanged(owner: Character, other: Character, before: Tier, after: Tier): void {
    this.stats.tiers++;
    if (!other.isPlayer || owner.isPlayer) return;
    const L = RELATIONS.dialog.log;
    const who = displayName(owner);
    if (before === 'stranger') this.ctx.bus.emit('log', { text: fmt(L.intro, { who }), kind: 'world' });
    else if (after === 'friend' || after === 'close') this.ctx.bus.emit('log', { text: fmt(L.tier, { who, tier: RELATIONS.tiers[after] }), kind: 'world' });
    else if (after === 'rival' || after === 'enemy') this.ctx.bus.emit('log', { text: fmt(L.tier, { who, tier: RELATIONS.tiers[after] }), kind: 'world' });
  }

  /**
   * Событие: actor сделал что-то с target (или для всех вокруг). Мнение target о actor меняется на E.target,
   * actor о target — на E.actor, свидетелей — на E.witness (сильнее, если пострадал их близкий). Одно и то же
   * не чаще раза в cooldown на пару.
   */
  event(kind: EventKind, actor: Character, target: Character | null, o: { silent?: boolean } = {}): void {
    if (!this.enabled || actor === target || !actor.alive) return;
    const E = RELATIONS.events[kind];
    const k = gk(100 + EVENT_INDEX[kind], actor.pid, target ? target.pid : 0);
    const now = this.now;
    if (now < (this.cool.get(k) ?? 0)) return;
    this.cool.set(k, now + E.cooldown);
    if (this.cool.size > 4000) this.pruneCool();
    this.stats.events++;
    if (target) {
      this.apply(target, actor, E.target, E.fam, E.memT, E.thoughtT);
      this.apply(actor, target, E.actor, E.fam, E.memA, E.thoughtA);
    }
    // Свидетели: пострадавший-то им дорог? Не из-за участников войны: пули ВС по повстанцам — не событие для жителей.
    if (!o.silent && (E.witness !== 0 || E.thoughtW || E.memW) && (civil(actor) || (target && civil(target)))) this.witnessed(kind, E, actor, target);
  }

  private pruneCool(): void {
    const now = this.now;
    for (const [k, t] of this.cool) if (t < now) this.cool.delete(k);
  }

  /** Свидетели рядом с местом события: их мнение о виновнике и мысли. */
  private witnessed(kind: EventKind, E: (typeof RELATIONS.events)[EventKind], actor: Character, target: Character | null): Character[] {
    const W = RELATIONS.witness;
    const ref = target ?? actor;
    const out: Character[] = [];
    for (const o of this.ctx.entities.near(ref.x, ref.y, W.radius, wbuf)) {
      if (o === actor || o === target || !o.alive || o.downed || o.isPlayer) continue;
      if (o.faction === 'vort' || !lineOfSight(this.ctx.map, o.x, o.y, ref.x, ref.y)) continue;
      out.push(o);
      if (out.length >= W.max) break;
    }
    for (const o of out) {
      let d = E.witness;
      if (d !== 0 && target) {
        // Пострадавший — свой: возмущены сильнее; виновник — свой: смягчают.
        const forVictim = Math.max(0, this.opinionP(o.pid, target.pid));
        const forActor = Math.max(0, this.opinionP(o.pid, actor.pid));
        d *= (0.6 + (forVictim / 100) * 1.4) * (1 - forActor / 150);
      }
      this.apply(o, actor, d, E.fam * 0.5, E.memW, E.thoughtW);
      if (target && E.thoughtW === 'sawFight' && this.loved(o, target)) this.think(o, 'friendHurt', target.pid);
    }
    if (kind === 'kill') this.seenKill = out;
    return out;
  }

  /** Знакомство без события (встреча, представились): оба знают друг друга. */
  introduce(a: Character, b: Character): void {
    if (!this.enabled) return;
    const bd = this.bondP(a.pid, b.pid);
    if (bd && bd.fam >= RELATIONS.bond.known) return;
    this.event('intro', a, b);
    this.stats.intros++;
  }

  // ───────────────────────────── подписки на бой, закон, смерть ─────────────────────────────

  private onPunch(t: Character, a: Character): void {
    if (!this.enabled) return;
    this.event('hit', a, t);
    this.rally(t, a);
  }

  private onDamage(t: Character, a: Character | null, killed: boolean): void {
    if (!this.enabled || !a || a === t || killed) return;
    // Удар кулаком уже учтён (onPunch); здесь — оружие и ранения.
    if (!a.weapon) return;
    const cls = WEAPONS[a.weapon].class;
    this.event(cls === 'melee' || cls === 'blade' ? 'hit' : 'shoot', a, t);
    this.rally(t, a);
  }

  private onVerdict(handler: Character, target: Character, kind: 'arrest' | 'fine' | 'ok'): void {
    if (!this.enabled || kind === 'ok') return;
    if (kind === 'fine') return this.event('fine', handler, target);
    this.event('arrest', handler, target);
    // Близкие арестованного — в беде и не в восторге от стражи.
    const R = RELATIONS.loved;
    for (const [pid, row] of this.bonds) {
      const bd = row.get(target.pid);
      if (!bd || pid === handler.pid) continue;
      this.settle(pid, bd);
      if (bd.opinion < R.opinion && !(bd.flags & BOND.KIN)) continue;
      const o = this.person(pid);
      if (!o || !o.alive || o.isPlayer || FACTIONS[o.faction].authority) continue;
      const kin = (bd.flags & BOND.KIN) !== 0;
      // Родня узнаёт сразу, остальные — кто был рядом.
      if (!kin && Math.hypot(o.x - target.x, o.y - target.y) > RELATIONS.witness.radius * 2) continue;
      this.think(o, 'friendArrested', target.pid);
      this.apply(o, handler, R.arrestOpinion, 1, 'arrestedMine', undefined);
      adjustLoyalty(o, R.loyaltyArrest, 'арест близкого');
    }
  }

  /**
   * Гибель: убийство на глазах — свидетели запоминают убийцу; близкие погибшего горюют (родные — дольше), а те,
   * кто видел убийцу, не забудут. Поддерживает возрождение: после смерти человек забудет, кто его убил.
   */
  private onDeath(c: Character, killer: Character | null): void {
    if (!this.enabled) return;
    const ps = this.psy(c.pid);
    ps.diedBy = killer && killer !== c ? killer.pid : -1;
    if (killer && killer !== c) this.event('kill', killer, c);
    else this.seenKill = [];
    const R = RELATIONS.loved;
    const now = this.now;
    for (const [pid, row] of this.bonds) {
      const bd = row.get(c.pid);
      if (!bd || pid === c.pid) continue;
      this.settle(pid, bd);
      const kin = (bd.flags & BOND.KIN) !== 0;
      if (!kin && bd.opinion < R.opinion) continue;
      const o = this.person(pid);
      if (!o || !o.alive || (FACTIONS[o.faction].authority && !kin)) continue;
      this.think(o, kin ? 'kinDied' : 'friendDied', c.pid);
      const mine = this.psy(pid);
      mine.grief = Math.max(mine.grief, now + R.mournTime * (kin ? 1.6 : 1));
      mine.griefFor = displayName(c);
      this.stats.mourns++;
      // Видел убийцу — не простит (и на него падает «убил моего»).
      if (killer && killer !== c && (this.seenKill.includes(o) || o === killer)) {
        if (o !== killer) this.apply(o, killer, R.killOpinion, 6, 'killedMine', undefined);
        if (killer.faction === 'cp' || killer.faction === 'ota') adjustLoyalty(o, R.loyaltyKill, 'гибель близкого');
      }
    }
  }

  /** Возрождение: человек забывает обстоятельства смерти (кто убил), настроение с нуля. */
  private onRespawn(c: Character): void {
    const ps = this.psy(c.pid);
    const killer = ps.diedBy;
    ps.thoughts.length = 0;
    ps.grief = 0;
    ps.moodAt = -1e9;
    ps.social = Math.max(ps.social, 45);
    ps.diedBy = -1;
    if (killer < 0) return;
    const bd = this.bonds.get(c.pid)?.get(killer);
    if (!bd) return;
    bd.mem = bd.mem.filter((m) => m.kind !== 'beat' && m.kind !== 'shot' && m.kind !== 'brawled' && m.kind !== 'sawKill');
    bd.opinion = Math.max(bd.opinion, this.base(bd.flags) - 8);
  }

  // ───────────────────────────── вступиться, помочь ─────────────────────────────

  /**
   * Ударили/ранили кого-то: близкие рядом вступаются — в драке на кулаках бросаются на обидчика, при
   * оружии робкие уходят. Не чаще раза в allies.every с на человека.
   */
  private rally(victim: Character, attacker: Character): void {
    if (!this.social || !civil(victim) || FACTIONS[attacker.faction].authority) return;
    const A = RELATIONS.allies;
    const brawls = this.ctx.brawls;
    const fists = !attacker.weapon;
    const now = this.now;
    // Не больше одного заступника на пострадавшего за раз и не на толпу (иначе драки разрастаются цепочкой); банды
    // выручают своих по-своему (Brawls.backup).
    const vk = gk(8, victim.pid);
    if (now < (this.cool.get(vk) ?? 0) || victim.gang >= 0 || attacker.gang >= 0 || (brawls?.list.filter((b) => b.a === attacker || b.b === attacker).length ?? 0) >= A.maxOnAttacker) return;
    for (const o of this.ctx.entities.near(victim.x, victim.y, A.radius, near)) {
      if (o === victim || o === attacker || o.isPlayer || !o.alive || o.downed || o.gang >= 0 || !(o.brain instanceof CitizenBrain)) continue;
      const k = gk(1, o.pid);
      if (now < (this.cool.get(k) ?? 0)) continue;
      const like = this.opinionP(o.pid, victim.pid) + (this.isKin(o, victim) ? 20 : 0);
      if (like < A.opinion || !lineOfSight(this.ctx.map, o.x, o.y, victim.x, victim.y)) continue;
      this.cool.set(k, now + A.every);
      const per = this.persona(o);
      if (fists) {
        if (brawls && !brawls.fighting(o) && brawls.canBrawl(o) && brawls.canBrawl(attacker) && this.rng.chance(A.defendChance * per.brave * (0.5 + Math.min(1, like / 80)))) {
          o.say(fmt(this.pick(o, RELATIONS.lines.defend), { bname: first(victim) }), now, 2);
          if (brawls.start(o, attacker, true)) {
            this.cool.set(vk, now + A.perVictim);
            this.stats.defends++;
            this.event('defend', o, victim);
            this.defer(1.1, () => victim.alive && victim.say(this.pick(victim, RELATIONS.lines.defended, o), this.now, 2));
          }
        }
      } else if (per.brave < RELATIONS.scan.fleeBelow) o.brain.fleeFrom(attacker);
    }
  }

  /** Накормить голодного близкого (родня, друг): отдать еду. */
  shareFood(giver: Character, taker: Character): boolean {
    const id = this.spareFood(giver);
    if (!id) return false;
    if (taker.inventory.add(id, 1) < 1) return false;
    giver.inventory.remove(id, 1);
    const now = this.now;
    giver.say(fmt(this.pick(giver, RELATIONS.lines.give, taker), { bname: first(taker) }), now, 2.4);
    this.defer(1.4, () => taker.alive && taker.say(fmt(this.pick(taker, RELATIONS.lines.thanks, giver), { bname: first(giver) }), this.now, 2.4));
    this.event('feed', giver, taker);
    this.stats.shares++;
    return true;
  }

  /** Лишняя еда у человека (предпочтительно подешевле), если сам сыт. */
  spareFood(c: Character): ItemId | null {
    if (c.hunger < RELATIONS.allies.fedAbove) return null;
    let best: ItemId | null = null;
    for (const s of c.inventory.slots) {
      const f = ITEMS[s.id].food;
      if (!f || (s.id === 'ration' && s.qty < 2 && c.faction !== 'rebel')) continue;
      if (!best || f < (ITEMS[best].food ?? 0)) best = s.id;
    }
    return best;
  }

  // ───────────────────────────── отложенные реплики ─────────────────────────────

  private defer(delay: number, fn: () => void): void {
    this.later.push({ at: this.now + delay, fn });
  }

  /** Фраза без повторов с подстановкой рода (говорящий c, собеседник to). */
  private pick(c: Character, list: readonly string[], to: Character | null = null): string {
    const tpl = freshTemplate(this.rng, c, list);
    remember(c, tpl);
    return gendered(tpl, c, to);
  }

  // ───────────────────────────── встречи на ходу ─────────────────────────────

  /** Раз в тик: пересмотр нескольких людей (каждого — раз в scan.every с) и отложенные реплики. */
  update(dt: number): void {
    if (!this.enabled) return;
    const now = this.now;
    for (let i = this.later.length - 1; i >= 0; i--) {
      if (this.later[i].at <= now) {
        const fn = this.later[i].fn;
        this.later.splice(i, 1);
        fn();
      }
    }
    if (!this.social) return;
    const list = this.ctx.entities.list;
    if (!list.length) return;
    const S = RELATIONS.scan;
    this.debt += (list.length * dt) / S.every;
    let n = Math.min(Math.floor(this.debt), S.maxPerFrame);
    this.debt = Math.min(this.debt - n, 4);
    while (n-- > 0) {
      this.cursor = (this.cursor + 1) % list.length;
      this.scan(list[this.cursor]);
    }
  }

  /** Есть ли ВС поблизости (при них недруги не лезут драться). */
  private copsNear(x: number, y: number, r: number): boolean {
    for (const o of this.ctx.entities.near(x, y, r, sbuf)) if (o.alive && o.faction === 'cp' && !o.isPlayer) return true;
    return false;
  }

  private scan(c: Character): void {
    if (!c.alive || c.downed || c.isPlayer || !(c.brain instanceof CitizenBrain) || c.law.phase !== 'none' || c.asleep) return;
    const b = c.brain;
    const st = b.fsm.current;
    const now = this.now;
    const ps = this.psy(c.pid);
    const S = RELATIONS.social;
    // Горюющий иногда говорит о своём; одинокий — вздыхает.
    if (ps.grief > now && this.rng.chance(0.12) && !(c.speech && c.speech.until > now)) {
      c.say(fmt(this.pick(c, RELATIONS.lines.mourn), { who: ps.griefFor || 'близкого' }), now, 2.8);
    } else if (ps.social < S.lonely && now > ps.lonelyAt && (st === 'walk' || st === 'idle') && this.rng.chance(0.2)) {
      ps.lonelyAt = now + 150;
      c.say(this.pick(c, RELATIONS.lines.lonely), now, 2.4);
    }
    if (this.hungryFriend(c, b, st)) return;
    if (st !== 'walk' && st !== 'idle') return;
    // Настроение слышно: мрачный бурчит, довольный напевает (редко и не поверх другой реплики).
    if (!(c.speech && c.speech.until > now) && this.rng.chance(RELATIONS.scan.moodLine)) {
      const m = this.mood(c);
      if (m <= RELATIONS.talk.moodLow) c.say(this.pick(c, RELATIONS.lines.moodLow), now, 2.6);
      else if (m >= RELATIONS.talk.moodHigh) c.say(this.pick(c, RELATIONS.lines.moodHigh), now, 2.6);
    }
    this.meetings(c, b);
  }

  /**
   * Голодный без еды: рядом близкий с лишней едой — делится; нет рядом — идёт к нему (родня и друзья не дальше
   * allies.askSeek).
   */
  private hungryFriend(c: Character, b: CitizenBrain, st: string): boolean {
    const A = RELATIONS.allies;
    if (c.hunger >= A.hungerBelow || this.ctx.economy.hasFood(c) || c.faction === 'vort') return false;
    const now = this.now;
    const circle = this.circle(c, 'friends');
    if (!circle.length) return false;
    let giver: Character | null = null;
    let best = Infinity;
    for (const o of circle) {
      if (o.isPlayer || !this.spareFood(o)) continue;
      const d = Math.hypot(o.x - c.x, o.y - c.y);
      if (d < best) {
        best = d;
        giver = o;
      }
    }
    if (!giver) return false;
    if (best <= A.shareReach && lineOfSight(this.ctx.map, c.x, c.y, giver.x, giver.y)) {
      // Попросил — и ему дали.
      const k = gk(2, c.pid, giver.pid);
      if (now < (this.cool.get(k) ?? 0)) return false;
      this.cool.set(k, now + 40);
      c.say(fmt(this.pick(c, RELATIONS.lines.ask, giver), { bname: first(giver) }), now, 2.4);
      this.stats.asks++;
      this.defer(1.6, () => c.alive && giver.alive && this.shareFood(giver, c));
      return true;
    }
    // Идти за хлебом к близкому — через разговор (CHAT ведёт к собеседнику).
    if (best <= A.askSeek && (st === 'walk' || st === 'idle') && now > (this.cool.get(gk(3, c.pid)) ?? 0) && this.rng.chance(A.askChance)) {
      this.cool.set(gk(3, c.pid), now + 60);
      return b.chatWith(giver, true);
    }
    return false;
  }

  /**
   * Встречи: кого-то из окружающих (в поле зрения, не дальше scan.range): недруг и враг — взгляд, стычка или
   * уход; кто обидел — месть; знакомый — приветствие по имени, друг останавливается поболтать.
   */
  private meetings(c: Character, b: CitizenBrain): void {
    const S = RELATIONS.scan;
    const law = this.ctx.law;
    let foe: Character | null = null;
    let foeBd: Bond | null = null;
    let pal: Character | null = null;
    let palBd: Bond | null = null;
    let palTier: Tier = 'stranger';
    let acq: Character | null = null;
    let acqBd: Bond | null = null;
    let seen = 0;
    for (const o of this.ctx.entities.near(c.x, c.y, S.range, near)) {
      if (o === c || !o.alive || o.downed || FACTIONS[o.faction].authority || o.faction === 'vort') continue;
      const bd = this.bondP(c.pid, o.pid);
      if (!bd || bd.fam < RELATIONS.bond.known) continue;
      if (++seen > 8 || !law.canSee(c, o)) continue;
      const t = this.tierOf(bd);
      if ((t === 'rival' || t === 'enemy') && (!foeBd || bd.opinion < foeBd.opinion)) {
        foe = o;
        foeBd = bd;
      } else if ((t === 'friend' || t === 'close' || (bd.flags & BOND.KIN && bd.opinion >= 0)) && (!palBd || bd.opinion > palBd.opinion)) {
        pal = o;
        palBd = bd;
        palTier = t;
      } else if (t === 'acquaintance' && (!acqBd || bd.fam > acqBd.fam)) {
        acq = o;
        acqBd = bd;
      }
    }
    if (foe && foeBd && this.foeMeeting(c, b, foe, foeBd)) return;
    if (pal && palBd && this.greet(c, b, pal, palBd, palTier)) return;
    if (acq && acqBd) this.greet(c, b, acq, acqBd, 'acquaintance');
    // Обидчик может быть и «просто знакомым» с давней обидой, но мнение уже ниже rival — ловит foeMeeting.
  }

  /** Недруг или враг на виду: взгляд, потом — стычка (если никого из ВС рядом) или уход (робкий / он сильнее). */
  private foeMeeting(c: Character, b: CitizenBrain, o: Character, bd: Bond): boolean {
    const S = RELATIONS.scan;
    const now = this.now;
    const per = this.persona(c);
    const ck = gk(4, c.pid, o.pid);
    if (now < (this.cool.get(ck) ?? 0)) return false;
    const brawls = this.ctx.brawls;
    const cops = this.copsNear(c.x, c.y, S.copsRange);
    const bad = this.notable(bd, true);
    const armed = !!o.weapon || (o.gang >= 0 && c.gang < 0) || o.faction === 'rebel';
    const d = Math.hypot(o.x - c.x, o.y - c.y);
    this.cool.set(ck, now + S.confront.cooldown * (0.6 + this.rng.next() * 0.8));
    // Месть: помнит обиду, злопамятный и вспыльчивый.
    if (!cops && !armed && bd.opinion <= S.revenge.opinion && bad && d < S.revenge.within && brawls && this.fightable(c, o)) {
      const p = S.revenge.chance * per.grudge * (0.4 + per.temper);
      if (this.rng.chance(p) && brawls.start(c, o)) {
        c.say(fmt(this.pick(c, RELATIONS.lines.revenge, o), { bname: first(o), why: RELATIONS.memories[bad.kind].acc }), now, 2.6);
        this.stats.revenges++;
        return true;
      }
    }
    // Взгляд исподлобья.
    if (d < S.range * 0.8 && this.rng.chance(S.glareChance)) {
      const list = bd.opinion <= RELATIONS.bond.tiers.enemy.opinion ? RELATIONS.lines.glare.enemy : RELATIONS.lines.glare.rival;
      c.say(fmt(this.pick(c, list, o), { bname: first(o) }), now, 2.4);
      this.stats.glares++;
    }
    // Стычка.
    if (!cops && !armed && bd.opinion <= S.confront.opinion && brawls && this.fightable(c, o) && this.rng.chance(S.confront.chance * (0.4 + per.temper))) {
      if (brawls.start(c, o)) {
        this.defer(0.3, () => c.say(fmt(this.pick(c, RELATIONS.lines.confront, o), { bname: first(o) }), this.now, 2.4));
        this.stats.confronts++;
        return true;
      }
    }
    // Робкий уходит от врага (или того, с кем опасно связываться).
    if ((per.brave < S.fleeBelow || armed) && d < 200) {
      const goal = b.goalAwayFrom(o.x, o.y);
      if (goal >= 0) {
        c.say(this.pick(c, RELATIONS.lines.avoid), now, 2);
        b.mover.goTo(c, this.ctx, goal);
        if (b.fsm.current !== 'walk') b.fsm.change('walk');
        this.stats.avoids++;
        return true;
      }
    }
    return false;
  }

  private fightable(a: Character, o: Character): boolean {
    const br = this.ctx.brawls;
    return !!br && br.canBrawl(a) && br.canBrawl(o) && !br.fighting(a) && !br.fighting(o);
  }

  /** Приветствие знакомого по имени; друг, встретившись, останавливается поболтать. true — что-то сделали. */
  private greet(c: Character, b: CitizenBrain, o: Character, bd: Bond, tier: Tier): boolean {
    const S = RELATIONS.scan;
    const now = this.now;
    const per = this.persona(c);
    const k = gk(5, c.pid, o.pid);
    if (now < (this.cool.get(k) ?? 0)) return false;
    const m = this.mood(c);
    const p = S.greetChance * (0.4 + per.social) * (m < -28 ? 0.5 : 1);
    // Не поздоровался — присмотрится к знакомому снова через полминуты; поздоровался — до следующей встречи долго.
    if (!this.rng.chance(p)) {
      this.cool.set(k, now + 25);
      return false;
    }
    this.cool.set(k, now + S.greetCooldown * (0.7 + this.rng.next() * 0.6));
    const kin = (bd.flags & BOND.KIN) !== 0;
    const G = RELATIONS.lines.greet;
    const list = kin ? G.kin : tier === 'close' ? G.close : tier === 'friend' ? G.friend : G.acquaintance;
    const near2 = tier === 'close' || tier === 'friend' || kin;
    c.say(fmt(this.pick(c, list, o), { bname: first(o) }), now, 2.4);
    this.event('greet', c, o);
    this.stats.greets++;
    this.sociable(c, RELATIONS.social.gain.greet + (near2 ? RELATIONS.social.gain.close : 0));
    this.sociable(o, RELATIONS.social.gain.greet);
    if (!o.isPlayer && this.rng.chance(S.replyChance)) {
      const rl = near2 ? G.reply.close : G.reply.acquaintance;
      this.defer(0.9, () => o.alive && !o.downed && o.say(fmt(this.pick(o, rl, c), { aname: first(c) }), this.now, 2.2));
    }
    // Друг останавливается поболтать.
    if (near2 && !o.isPlayer && this.rng.chance(S.chatChance * per.social) && o.brain instanceof CitizenBrain) b.chatWith(o);
    return true;
  }

  /** Недруг подошёл: «не будет разговаривать» — отказ и грубость (CitizenBrain.startChat). */
  willTalk(o: Character, who: Character): boolean {
    if (!this.enabled) return true;
    const bd = this.bondP(o.pid, who.pid);
    const t = this.tierOf(bd);
    if (t === 'rival' || t === 'enemy') return false;
    const T = RELATIONS.talk;
    if (t === 'stranger' && this.mood(o) < T.moodBelow && this.rng.chance(T.strangerRefuse)) return false;
    return true;
  }

  /** Отказал в разговоре: резкая реплика, осадок. */
  rebuff(o: Character, who: Character): void {
    if (!this.enabled) return;
    this.stats.rebuffs++;
    o.say(this.pick(o, RELATIONS.lines.rebuff, who), this.now, 2);
    this.event('snub', o, who);
  }

  /** Вес стычки между a и b (ссора после беседы, задира): друзья — почти не ссорятся, недруги — чаще, плохое настроение подталкивает. */
  quarrelMul(a: Character, b: Character): number {
    if (!this.enabled) return 1;
    let m = 1;
    const ta = this.tier(a, b);
    const tb = this.tier(b, a);
    if (ta === 'friend' || ta === 'close' || this.isKin(a, b)) m *= 0.15;
    else if (ta === 'rival' || ta === 'enemy' || tb === 'rival' || tb === 'enemy') m *= 3;
    const mood = Math.min(this.mood(a), this.mood(b));
    m *= mood < -30 ? 1.6 : mood > 30 ? 0.6 : 1;
    return m * (0.5 + this.persona(a).temper);
  }

  /** Заводила: стоит ли a задирать o (не друзей и родню). */
  mayBully(a: Character, o: Character): boolean {
    if (!this.enabled) return true;
    if (this.isKin(a, o)) return false;
    const t = this.tier(a, o);
    if (t === 'friend' || t === 'close') return false;
    return t === 'acquaintance' ? this.rng.chance(0.15) : true;
  }

  /** Темп ходьбы: мрачный плетётся, довольный шагает бодрее, вспыльчивый торопится (множитель к скорости шага). */
  paceMul(c: Character): number {
    if (!this.enabled) return 1;
    const m = this.mood(c);
    const mood = m <= -28 ? 0.92 : m >= 30 ? 1.05 : 1;
    return clamp(mood * (0.96 + this.persona(c).temper * 0.08), 0.85, 1.1);
  }

  /** Цена у продавца: друзьям — скидка, недоброжелателям — надбавка (множитель; config trade). */
  priceMul(vendor: Character, buyer: Character): number {
    if (!this.enabled) return 1;
    const T = RELATIONS.trade;
    const t = this.tier(vendor, buyer);
    return t === 'close' ? T.close : t === 'friend' ? T.friend : t === 'rival' ? T.rival : 1;
  }

  /** Продаст ли продавец: врагу — нет. */
  willServe(vendor: Character, buyer: Character): boolean {
    return !this.enabled || this.tier(vendor, buyer) !== 'enemy';
  }

  /** Продавец отказал: реплика, осадок. */
  refuseService(vendor: Character, buyer: Character): void {
    vendor.say(this.pick(vendor, RELATIONS.lines.refuse, buyer), this.now, 2.4);
    this.stats.rebuffs++;
  }

  /** Покупка у знакомого продавца: он запоминает постоянного покупателя; скидку отмечает вслух. */
  traded(vendor: Character, buyer: Character, mul: number): void {
    this.event('greet', buyer, vendor);
    if (mul < 1 && !(vendor.speech && vendor.speech.until > this.now)) vendor.say(fmt(this.pick(vendor, RELATIONS.lines.discount, buyer), { bname: first(buyer) }), this.now, 2.4);
  }

  /** Насколько долго бежит от стрельбы: робкие — дольше, храбрые — быстрее берут себя в руки. Множитель к времени паники. */
  panicMul(c: Character): number {
    return this.enabled ? 1.35 - this.persona(c).brave * 0.7 : 1;
  }

  /** Как отвечает на удар: храбрые и вспыльчивые — дерутся, робкие — бегут. Множитель к BRAWL.fightBack. */
  fightBackMul(t: Character, a: Character): number {
    if (!this.enabled) return 1;
    const per = this.persona(t);
    const tier = this.tier(t, a);
    const grudge = tier === 'rival' || tier === 'enemy' ? 1.25 : 1;
    return clamp(0.55 + per.brave * 0.7 + per.temper * 0.3, 0.3, 1.4) * grudge;
  }

  /** Как реагирует на оскорбление: вспыльчивый — быстрее, сытый и довольный — спокойнее. Множитель к BRAWL.insult.anger. */
  angerMul(target: Character, by: Character): number {
    if (!this.enabled) return 1;
    const per = this.persona(target);
    const m = this.mood(target);
    const t = this.tier(target, by);
    const rel = t === 'friend' || t === 'close' ? 0.4 : t === 'rival' || t === 'enemy' ? 1.5 : 1;
    return clamp((0.5 + per.temper) * (m < -30 ? 1.4 : m > 30 ? 0.7 : 1) * rel, 0.2, 2);
  }

  // ───────────────────────────── беседа ─────────────────────────────

  /** Беседа окончена (Talk): приятная — сближает, ссора — нет; тема определяет последствия. */
  chatDone(a: Character, b: Character, topic: string, progress: number): void {
    if (!this.enabled || progress < 0.5) return;
    const near2 = this.tier(a, b);
    const kin = this.isKin(a, b);
    if (topic === 'intro') {
      this.event('intro', a, b);
      this.stats.intros++;
    } else if (topic === 'argue') this.event('argue', a, b);
    else this.event('talk', a, b);
    this.stats.chats++;
    const G = RELATIONS.social.gain;
    // Спор не радует: общения хватает, но настроения он не прибавляет.
    this.sociable(a, topic === 'argue' ? G.talk * 0.4 : G.talk);
    this.sociable(b, topic === 'argue' ? G.talk * 0.4 : G.talk);
    const close = near2 === 'friend' || near2 === 'close' || kin;
    if (topic !== 'argue') for (const c of [a, b]) this.think(c, close ? 'chatFriend' : 'chat', (c === a ? b : a).pid);
    if (topic === 'comfort') {
      this.think(a, 'comforted', b.pid);
      this.event('gift', b, a);
    } else if (topic === 'apology') {
      this.event('forgive', a, b);
      this.stats.forgives++;
    }
  }

  /** Что запомнилось в связи a → b: «помощь» / «ссору» (acc — винительный падеж для «забудем …»). */
  why(a: Character, b: Character, bad: boolean, acc = false): string {
    const bd = this.bondP(a.pid, b.pid);
    const m = bd ? this.notable(bd, bad) : null;
    if (!m) return bad ? 'обиду' : 'помощь';
    return acc ? RELATIONS.memories[m.kind].acc : RELATIONS.memories[m.kind].nom;
  }

  /** Принял ли b извинения a: зависит от обиды, злопамятности и отзывчивости. */
  apologyAccepted(a: Character, b: Character): boolean {
    const per = this.persona(b);
    const bd = this.bondP(b.pid, a.pid);
    const deep = bd ? bd.opinion : 0;
    return this.rng.chance(RELATIONS.talk.apology.accept * (1.15 - per.grudge * 0.7) * (deep > -50 ? 1 : 0.4) * (0.7 + per.kind * 0.6));
  }

  /** Разговор начался: голодному — делятся, друзья радуются встрече. */
  chatBegan(a: Character, b: Character): void {
    if (!this.enabled) return;
    const A = RELATIONS.allies;
    if (a.hunger < A.hungerBelow && !this.ctx.economy.hasFood(a) && this.loved(b, a) && this.spareFood(b)) this.shareFood(b, a);
    else if (b.hunger < A.hungerBelow && !this.ctx.economy.hasFood(b) && this.loved(a, b) && this.spareFood(a)) this.shareFood(a, b);
  }

  /** Номера тем отношений для беседы a с b (Talk.dialogue): знакомство, друзья, благодарность, поддержка, извинение, слухи, настроение. */
  topicIds(a: Character, b: Character): string[] {
    if (!this.enabled) return [];
    const T = RELATIONS.talk;
    const out: string[] = [];
    const bdA = this.bondP(a.pid, b.pid);
    const tier = this.tierOf(bdA);
    const mA = this.mood(a);
    if (tier === 'stranger') out.push('intro');
    if (tier === 'friend' || tier === 'close') out.push('friendAsk');
    if (bdA && this.notable(bdA, false) && tier !== 'stranger') out.push('thanks');
    if (mA <= T.moodLow && (tier === 'friend' || tier === 'close' || this.isKin(a, b))) out.push('comfort');
    else if (mA <= T.moodLow) out.push('moodLow');
    else if (mA >= T.moodHigh) out.push('moodHigh');
    if (bdA && bdA.opinion <= T.apology.opinion + 40 && bdA.opinion >= T.apology.opinion - 18 && tier !== 'stranger' && tier !== 'enemy' && this.persona(a).grudge < T.apology.grudgeMax && this.notable(bdA, true)) out.push('apology');
    if (tier !== 'stranger' && this.gossipFor(a, b)) out.push('gossip');
    return out;
  }

  topicWeight(id: string): number {
    const W = RELATIONS.talk.weights;
    switch (id) {
      case 'intro': return W.intro;
      case 'friendAsk': return W.friend;
      case 'thanks': return W.thanks;
      case 'comfort': return W.comfort;
      case 'moodLow': return W.moodLow;
      case 'moodHigh': return W.moodHigh;
      case 'apology': return RELATIONS.talk.apology.w;
      case 'gossip': return RELATIONS.talk.gossip.w;
      default: return 1;
    }
  }

  /** О ком a расскажет b: у a о нём сильное мнение, b его знает хуже или иначе. */
  gossipFor(a: Character, b: Character): { c: Character; good: boolean } | null {
    const G = RELATIONS.talk.gossip;
    const row = this.bonds.get(a.pid);
    if (!row) return null;
    const now = this.now;
    let best: { c: Character; good: boolean; score: number } | null = null;
    for (const [pid, bd] of row) {
      if (pid === b.pid || pid === a.pid || bd.fam < G.minFam || Math.abs(bd.opinion - this.base(bd.flags)) < G.minOpinion) continue;
      if (now < (this.cool.get(gk(6, a.pid, pid)) ?? 0)) continue;
      const c = this.person(pid);
      if (!c || !c.alive) continue;
      // Тем интереснее, чем больше разница с мнением собеседника.
      const diff = Math.abs(bd.opinion - this.opinionP(b.pid, pid));
      const score = Math.abs(bd.opinion) + diff;
      if (!best || score > best.score) best = { c, good: bd.opinion > 0, score };
    }
    return best;
  }

  /** a рассказал b о c: b переубеждается — тем сильнее, чем больше доверяет a. Возвращает, согласен ли b. */
  gossip(a: Character, b: Character, c: Character, good: boolean): boolean {
    const G = RELATIONS.talk.gossip;
    this.cool.set(gk(6, a.pid, c.pid), this.now + G.cooldown);
    const mine = this.opinionP(a.pid, c.pid);
    const theirs = this.opinionP(b.pid, c.pid);
    const trust = clamp(this.opinionP(b.pid, a.pid) / 60, 0.1, 1.2) * (0.5 + this.persona(b).trust);
    const shift = (mine - theirs) * G.shift * trust;
    this.apply(b, c, shift, 3, good ? 'heardGood' : 'heardBad', undefined);
    this.stats.gossips++;
    return Math.sign(theirs) === Math.sign(mine) || Math.abs(theirs) < 8;
  }

  // ───────────────────────────── игрок ─────────────────────────────

  /** Игрок поздоровался вслух (ChatSystem): отвечает ближайший прохожий — теплее, если знаком. */
  greetReply(npc: Character, p: Character): string {
    const bd = this.bondP(npc.pid, p.pid);
    const tier = this.tierOf(bd);
    const R = RELATIONS.dialog.reply;
    const list = tier === 'friend' || tier === 'close' ? R.friend : tier === 'rival' ? R.rival : tier === 'enemy' ? R.enemy : tier === 'acquaintance' ? R.known : R.stranger;
    this.event('greet', p, npc);
    this.sociable(npc, RELATIONS.social.gain.greet);
    return fmt(this.pick(npc, list, p), { bname: first(p), aname: first(npc) });
  }

  /**
   * E перед человеком: поговорить (знакомство, приятный разговор, новости, просьба), второй раз подряд — угостить
   * голодного, если есть чем. Возвращает строку для журнала.
   */
  interact(p: Character, npc: Character): string {
    const { ctx } = this;
    const now = this.now;
    const D = RELATIONS.dialog;
    const P = RELATIONS.player;
    const who = displayName(npc);
    if (!npc.alive || npc.downed) return '';
    const ps = this.psy(npc.pid);
    // Второй раз подряд — угостить, пока просит.
    if (ps.askUntil > now) return this.ctx.economy.hasFood(p) ? this.giveFood(p, npc) : D.log.nothing;
    if (FACTIONS[npc.faction].authority) {
      npc.say(fmt(this.pick(npc, D.reply.cp, p), { bname: first(p) }), now, 2.4);
      return '';
    }
    if (npc.asleep) return fmt(D.log.asleep, { who });
    const busy = npc.law.phase !== 'none' || (npc.brain instanceof CitizenBrain && ['brawl', 'panic', 'shelter', 'stopped', 'flee'].includes(npc.brain.fsm.current));
    if (busy) return fmt(D.log.busy, { who });
    const last = this.talkAt.get(npc.pid) ?? -1e9;
    if (now - last < P.cooldown) return fmt(D.log.cooldown, { who });
    this.talkAt.set(npc.pid, now);
    const bd = this.bondP(npc.pid, p.pid);
    const tier = this.tierOf(bd);
    const kin = this.isKin(npc, p);
    const known = tier !== 'stranger';
    p.say(fmt(this.pick(p, tier === 'friend' || tier === 'close' ? D.say.friend : known ? D.say.known : D.say.stranger, npc), { aname: first(p), bname: first(npc) }), now, 2.4);
    this.stats.talks++;
    // Недруг не хочет говорить.
    if (tier === 'rival' || tier === 'enemy') {
      this.defer(1, () => npc.alive && npc.say(fmt(this.pick(npc, tier === 'enemy' ? D.reply.enemy : D.reply.rival, p), { bname: first(p) }), this.now, 2.4));
      this.event('snub', npc, p);
      return '';
    }
    const m = this.mood(npc);
    const R = D.reply;
    let list: readonly string[];
    if (!known) list = R.intro;
    else if (kin) list = R.kin;
    else if (m <= RELATIONS.talk.moodLow) list = R.low;
    else if (m >= RELATIONS.talk.moodHigh && this.rng.chance(0.6)) list = R.high;
    else list = tier === 'friend' || tier === 'close' ? R.friend : R.known;
    this.defer(1.1, () => {
      if (!npc.alive) return;
      npc.say(fmt(this.pick(npc, list, p), { aname: first(npc), bname: first(p) }), this.now, 2.8);
      // Иногда добавит новость (слух, обстановка).
      if (known && this.rng.chance(0.4)) this.defer(2.8, () => npc.alive && npc.say(ctx.talk.remark(npc, 'street'), this.now, 3.2));
      // Голодный просит еду.
      else if (npc.hunger < P.askHungerBelow && !ctx.economy.hasFood(npc) && npc.faction !== 'vort') {
        this.defer(2.8, () => {
          if (!npc.alive) return;
          npc.say(this.pick(npc, D.ask, p), this.now, 3);
          ps.askUntil = this.now + P.giftWindow;
        });
      }
    });
    this.sociable(npc, RELATIONS.social.gain.talk * 0.7);
    this.introduce(npc, p);
    this.event('talk', p, npc);
    return '';
  }

  /** Угостить голодного едой из рюкзака игрока. */
  private giveFood(p: Character, npc: Character): string {
    const D = RELATIONS.dialog;
    const now = this.now;
    const who = displayName(npc);
    const ps = this.psy(npc.pid);
    let best: ItemId | null = null;
    for (const s of p.inventory.slots) {
      const f = ITEMS[s.id].food;
      if (f && (!best || f < (ITEMS[best].food ?? 0))) best = s.id;
    }
    if (!best) return D.log.nothing;
    if (npc.hunger > ECONOMY.hunger.max * 0.85) {
      npc.say(this.pick(npc, D.full, p), now, 2.4);
      return '';
    }
    p.inventory.remove(best, 1);
    npc.hunger = Math.min(ECONOMY.hunger.max, npc.hunger + (ITEMS[best].food ?? 0));
    ps.askUntil = 0;
    this.event('feed', p, npc);
    this.stats.gifts++;
    this.defer(0.6, () => npc.alive && npc.say(fmt(this.pick(npc, D.fed, p), { bname: first(p) }), this.now, 3));
    return fmt(D.log.fed, { who });
  }

  // ───────────────────────────── сведения для интерфейса ─────────────────────────────

  /** Что человек о ком-то помнит, словами: «помощь · 3 мин назад». */
  private memoryText(bd: Bond | null): string {
    if (!bd || !bd.mem.length) return '';
    const now = this.now;
    let best: Memory = bd.mem[0];
    for (const m of bd.mem) if (Math.abs(m.w) > Math.abs(best.w)) best = m;
    const ago = now - best.at;
    const t = ago < 60 ? 'только что' : ago < 3600 ? `${Math.round(ago / 60)} мин назад` : 'давно';
    return `${RELATIONS.memories[best.kind].nom} · ${t}`;
  }

  /** Сведения о человеке a и о том, как он относится к viewer (подпись под курсором, панель знакомых). */
  info(a: Character, viewer: Character | null): PersonInfo {
    const bd = viewer ? this.bondP(a.pid, viewer.pid) : null;
    const mood = this.mood(a);
    const lab = moodLabel(mood);
    const per = this.persona(a);
    return {
      pid: a.pid,
      name: displayName(a),
      role: FACTIONS[a.faction].role,
      alive: a.alive,
      tier: this.tierOf(bd),
      kin: !!viewer && this.isKin(a, viewer),
      opinion: Math.round(bd?.opinion ?? 0),
      fam: Math.round(bd?.fam ?? 0),
      mood: Math.round(mood),
      moodName: lab.name,
      moodColor: lab.color,
      tags: personaText(per),
      hobby: per.hobby,
      because: this.because(a),
      memory: this.memoryText(bd),
    };
  }

  /** Знакомые игрока: кто знает его (по убыванию значимости). */
  contacts(p: Character): PersonInfo[] {
    const out: { info: PersonInfo; score: number }[] = [];
    for (const [pid, row] of this.bonds) {
      if (pid === p.pid) continue;
      const bd = row.get(p.pid);
      if (!bd || bd.fam < RELATIONS.bond.known) continue;
      const c = this.person(pid);
      if (!c) continue;
      this.settle(pid, bd);
      out.push({ info: this.info(c, p), score: bd.fam + Math.abs(bd.opinion) * 1.2 + (this.now - bd.at < 120 ? 25 : 0) });
    }
    out.sort((x, y) => y.score - x.score);
    return out.slice(0, RELATIONS.contacts.max).map((x) => x.info);
  }

  /** Новая личность (игрок-ВС погиб и начал жить заново): о нём забывают, он забывает всех. */
  forget(pid: number): void {
    this.bonds.delete(pid);
    for (const row of this.bonds.values()) row.delete(pid);
    this.psyches.delete(pid);
    this.personas.delete(pid);
  }

  // ───────────────────────────── заселение связей ─────────────────────────────

  /**
   * Первичные связи города: семья, соседи по общежитию и кварталу, банды и их вражда, товарищи ВС и армии,
   * сослуживцы ТС, плюс у каждого жителя пара друзей и (у части) недруг. Детерминированно (свой поток rng).
   */
  seed(): void {
    if (!this.enabled) return;
    const { ctx } = this;
    const S = RELATIONS.seed;
    const rng = ctx.rng.fork(0x5eed1);
    const list = ctx.entities.list.filter((c) => c.alive && !c.isPlayer);
    for (const c of list) this.register(c);
    const pair = (a: Character, b: Character, flags: number, op: readonly [number, number], fam: readonly [number, number], mem?: MemKind): void => {
      for (const [x, y] of [[a, b], [b, a]] as const) {
        const bd = this.make(x.pid, y.pid, flags);
        bd.opinion = clamp(rng.range(op[0], op[1]), -100, 100);
        bd.fam = Math.max(bd.fam, rng.range(fam[0], fam[1]));
        if (mem) this.remember(bd, mem, bd.opinion);
      }
    };
    // Родня.
    const byFamily = new Map<number, Character[]>();
    for (const c of list) if (c.family >= 0) (byFamily.get(c.family) ?? byFamily.set(c.family, []).get(c.family)!).push(c);
    for (const members of byFamily.values()) for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) pair(members[i], members[j], BOND.KIN, S.kin.opinion, S.kin.fam);
    // Соседи: одно общежитие и ближайшие дома.
    const H = ctx.housing;
    const residents = list.filter((c) => civil(c) && c.home >= 0 && H?.dwellings[c.home]);
    const byBuilding = new Map<number, Character[]>();
    for (const c of residents) {
      const d = H!.dwellings[c.home];
      if (d.building >= 0) (byBuilding.get(d.building) ?? byBuilding.set(d.building, []).get(d.building)!).push(c);
    }
    for (const group of byBuilding.values()) {
      for (const c of group) {
        const others = rng.shuffle(group.filter((o) => o !== c && (o.family !== c.family || o.family < 0))).slice(0, S.neighbor.per);
        for (const o of others) if (!this.bondP(c.pid, o.pid)) pair(c, o, BOND.NEIGHBOR | BOND.HOUSE, S.neighbor.opinion, S.neighbor.fam);
      }
    }
    for (const c of residents) {
      const d = H!.dwellings[c.home];
      const close = residents.filter((o) => o !== c && o.family !== c.family && Math.hypot(H!.dwellings[o.home].at.x - d.at.x, H!.dwellings[o.home].at.y - d.at.y) < S.neighbor.radius && !this.bondP(c.pid, o.pid));
      for (const o of rng.shuffle(close).slice(0, 2)) pair(c, o, BOND.NEIGHBOR, S.neighbor.opinion, S.neighbor.fam);
    }
    // Банды: свои — братва, чужие — давняя вражда.
    const gangs = ctx.gangs?.gangs ?? [];
    for (const g of gangs) {
      const members = ctx.gangs.members(g);
      for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) pair(members[i], members[j], BOND.GANG, S.gang.opinion, S.gang.fam);
    }
    for (let i = 0; i < gangs.length; i++) {
      for (let j = i + 1; j < gangs.length; j++) {
        const a = ctx.gangs.members(gangs[i]);
        const b = ctx.gangs.members(gangs[j]);
        for (const x of a) for (const y of rng.shuffle([...b]).slice(0, S.gangFeud.per)) pair(x, y, BOND.FEUD, S.gangFeud.opinion, S.gangFeud.fam, 'brawled');
      }
    }
    // Сослуживцы ТС (по профессии и один штаб), товарищи ВС по группе, армия, подполье.
    const cwu = list.filter((c) => c.faction === 'cwu');
    for (const c of cwu) {
      const mates = rng.shuffle(cwu.filter((o) => o !== c && (o.profession === c.profession || o.profession === 'cwu_head' || c.profession === 'cwu_head')));
      for (const o of mates.slice(0, S.work.per)) if (!this.bondP(c.pid, o.pid)) pair(c, o, BOND.WORK, S.work.opinion, S.work.fam);
    }
    const bySquad = new Map<number, Character[]>();
    for (const c of list) if (c.faction === 'cp' && c.role?.squad !== undefined) (bySquad.get(c.role.squad) ?? bySquad.set(c.role.squad, []).get(c.role.squad)!).push(c);
    for (const g of bySquad.values()) for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) pair(g[i], g[j], BOND.COMRADE, S.comrade.opinion, S.comrade.fam);
    for (const kind of [['army', 'leader', 'hydra'], ['partisan', 'agent'], ['ota']] as const) {
      const unit = list.filter((c) => (kind as readonly string[]).includes(c.role?.kind ?? ''));
      for (const c of unit) for (const o of rng.shuffle(unit.filter((x) => x !== c)).slice(0, S.comrade.per)) if (!this.bondP(c.pid, o.pid)) pair(c, o, BOND.COMRADE, S.comrade.opinion, S.comrade.fam);
    }
    // Друзья и недруги жителей: из тех, кто живёт неподалёку (или работает рядом).
    const folk = list.filter((c) => (c.faction === 'citizen' || c.faction === 'cwu') && c.gang < 0 && c.profession !== 'fugitive');
    for (const c of folk) {
      const pos = this.homePos(c);
      const around = (r: number): Character[] => folk.filter((o) => o !== c && o.family !== c.family && Math.hypot(this.homePos(o).x - pos.x, this.homePos(o).y - pos.y) < r);
      const friends = rng.shuffle(around(S.friends.radius).filter((o) => !this.bondP(c.pid, o.pid)));
      const want = rng.int(S.friends.count[0], S.friends.count[1]);
      for (const o of friends.slice(0, want)) pair(c, o, BOND.FRIEND, S.friends.opinion, S.friends.fam);
      if (rng.chance(S.rival.chance)) {
        const foes = rng.shuffle(around(S.rival.radius).filter((o) => !this.bondP(c.pid, o.pid)));
        if (foes[0]) pair(c, foes[0], BOND.FEUD, S.rival.opinion, S.rival.fam, rng.chance(0.5) ? 'argued' : 'brawled');
      }
    }
  }

  /** Соседи игрока: у жителя с домом — пара знакомых по общежитию и кварталу (как у всех в городе), здороваются с первой минуты. */
  seedPlayer(p: Character): void {
    if (!this.enabled) return;
    const H = this.ctx.housing;
    const d = p.home >= 0 ? H?.dwellings[p.home] : null;
    if (!H || !d) return;
    const S = RELATIONS.seed.neighbor;
    const rng = this.ctx.rng.fork(0x91a7e + p.pid);
    const pool = this.ctx.entities.list.filter((o) => o !== p && !o.isPlayer && o.alive && civil(o) && o.home >= 0 && !!H.dwellings[o.home] && Math.hypot(H.dwellings[o.home].at.x - d.at.x, H.dwellings[o.home].at.y - d.at.y) < S.radius && !this.bondP(o.pid, p.pid));
    for (const o of rng.shuffle(pool).slice(0, 3)) this.link(p, o, rng.range(S.opinion[0], S.opinion[1]), rng.range(S.fam[0], S.fam[1]), BOND.NEIGHBOR);
  }

  /** Где человек живёт (для подбора соседей): дом, иначе где стоит. */
  private homePos(c: Character): { x: number; y: number } {
    const d = c.home >= 0 ? this.ctx.housing?.dwellings[c.home] : null;
    return d ? d.at : c;
  }

  // ───────────────────────────── сохранение ─────────────────────────────

  /** Связи и душевное состояние для сохранения (возраст воспоминаний — в секундах: время игры при загрузке с нуля). */
  serialize(): SocialSave {
    const K = RELATIONS.save;
    const now = this.now;
    const bonds: SocialSave['bonds'] = [];
    const pids = new Set<number>();
    for (const [a, row] of this.bonds) {
      for (const [b, bd] of row) {
        if (bd.fam < K.minFam && !bd.mem.length) continue;
        if (bonds.length >= K.max) break;
        this.settle(a, bd);
        const mem = bd.mem.slice(-K.memories).map((m) => [m.kind, Math.max(0, Math.round(now - m.at)), Math.round(m.w)] as [MemKind, number, number]);
        bonds.push([a, b, Math.round(bd.opinion * 10) / 10, Math.round(bd.fam), bd.flags, mem]);
        pids.add(a);
        pids.add(b);
      }
    }
    const names: [number, string][] = [];
    for (const pid of pids) names.push([pid, this.nameOf(pid)]);
    const social: [number, number][] = [];
    for (const [pid, ps] of this.psyches) if (pids.has(pid)) social.push([pid, Math.round(ps.social)]);
    return { v: 1, names, bonds, social };
  }

  /** Вернуть связи из сохранения: только для людей, которые есть сейчас и с теми же именами. */
  restore(d: SocialSave | null | undefined): void {
    if (!d || d.v !== 1 || !Array.isArray(d.bonds)) return;
    const names = new Map(d.names);
    const ok = new Map<number, boolean>();
    const same = (pid: number): boolean => {
      let r = ok.get(pid);
      if (r === undefined) {
        const c = this.person(pid);
        const was = names.get(pid);
        r = !!c && !!was && (c.isPlayer || displayName(c) === was);
        ok.set(pid, r);
      }
      return r;
    };
    const now = this.now;
    for (const row of d.bonds) {
      if (!Array.isArray(row) || row.length < 5) continue;
      const [a, b, opinion, fam, flags, mem] = row;
      if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(opinion) || !Number.isFinite(fam)) continue;
      if (!same(a) || !same(b)) continue;
      const bd = this.make(a, b, flags);
      bd.opinion = clamp(opinion, -100, 100);
      bd.fam = clamp(fam, 0, 100);
      bd.flags |= flags;
      bd.mem = [];
      for (const m of Array.isArray(mem) ? mem : []) {
        if (!Array.isArray(m) || !(m[0] in RELATIONS.memories) || !Number.isFinite(m[1]) || !Number.isFinite(m[2])) continue;
        bd.mem.push({ kind: m[0], at: now - m[1], w: m[2] });
      }
    }
    for (const row of Array.isArray(d.social) ? d.social : []) {
      if (Array.isArray(row) && Number.isFinite(row[0]) && Number.isFinite(row[1]) && same(row[0])) this.psy(row[0]).social = clamp(row[1], 0, 100);
    }
  }
}

/** Сохранённые связи (SaveData.social): [от кого, к кому, мнение, знакомство, флаги, воспоминания [вид, возраст с, вес]]. */
export interface SocialSave {
  v: 1;
  names: [number, string][];
  bonds: [number, number, number, number, number, [MemKind, number, number][]][];
  social: [number, number][];
}

const EVENT_INDEX = Object.fromEntries((Object.keys(RELATIONS.events) as EventKind[]).map((k, i) => [k, i])) as Record<EventKind, number>;
