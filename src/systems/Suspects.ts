import type { AiContext } from '../ai/AiContext';
import type { Character } from '../entities/Character';
import type { Corpse } from './CombatSystem';
import type { Rng } from '../core/rng';
import type { Stimulus } from './Senses';
import { civilian } from './Senses';
import { SUSPECTS } from '../config/suspects';
import { SENSES } from '../config/senses';
import { RADIO } from '../config/radio';
import { WEAPONS, ITEMS, type WeaponClass } from '../config/items';
import { FACTIONS, cpHas } from '../config/factions';
import { LOYALTY } from '../config/loyalty';
import { apparentFaction, displayName } from '../entities/cover';
import { lineOfSight } from '../world/visibility';
import { whereOf } from '../world/places';
import { CitizenBrain } from '../ai/brains/CitizenBrain';
import { CpBrain } from '../ai/brains/CpBrain';
import { fmt } from './Radio';
import { female, phrase } from './phrases';
import type { IncidentKind } from '../config/radio';
import type { Dwelling } from './Housing';

/** Кто на вид: сторона по одежде (лоялист — в светло-фиолетовом), банда — по повязке. */
export type Side = 'citizen' | 'loyalist' | 'cwu' | 'vort' | 'gang' | 'rebel' | 'cp' | 'other';

/** Приметы: что запомнил свидетель (или что видно сейчас). */
export interface Look {
  side: Side;
  female: boolean;
  /** Верхняя одежда: надетое (куртка, бронежилет) или форма профессии. */
  torso: string;
  /** Головной убор: надетое или «без». */
  head: string;
  /** Повязка (банда, семья) — цвет. */
  band: string;
  weapon: WeaponClass | null;
  bloody: boolean;
}

type Feature = keyof Look;
const FEATURES: readonly Feature[] = ['side', 'female', 'torso', 'head', 'band', 'weapon', 'bloody'];

/** Показание свидетеля. */
export interface Statement {
  by: number;
  name: string;
  at: number;
  look: Look;
  /** Насколько точно (издалека — хуже). */
  rel: number;
  /** Знал в лицо — назвал по имени. */
  named: boolean;
  lie: boolean;
  /** Куда ушёл (угол) — если видел. */
  dir: number | null;
}

/** Свидетель дела: что видел, решил ли и что. */
interface Witness {
  c: Character;
  seen: Look;
  named: boolean;
  rel: number;
  dir: number | null;
  told: boolean;
  /** report — донесёт, lie — соврёт, silent — промолчит. */
  will: 'report' | 'lie' | 'silent';
}

/** Дело: одно лицо, одна серия (новые преступления в течение SUSPECTS.merge — туда же). */
export interface Case {
  id: number;
  kind: 'murder' | 'assault';
  /** Первое и последнее преступление: время (закона), место, зона. */
  first: number;
  at: number;
  x: number;
  y: number;
  zone: number;
  /** Кто (правда — ВС её не знает, пока не установит) и что он сделал. */
  actor: Character;
  actorPid: number;
  kills: number;
  wounds: number;
  victims: string[];
  /** Чем (вид оружия на момент преступления; экспертиза знает точно). */
  weapon: WeaponClass | null;
  witnesses: Map<number, Witness>;
  statements: Statement[];
  /** ВС знает о деле; личность установлена (розыск); виновник видел сам ВС (огонь на поражение). */
  known: boolean;
  named: boolean;
  seenByCp: boolean;
  /** Ориентировка: сведённые приметы и уверенность по каждому признаку. */
  desc: Look | null;
  conf: Partial<Record<Feature, number>>;
  /** Последнее известное ВС место и куда ушёл. */
  lastX: number;
  lastY: number;
  dir: number | null;
  closed: boolean;
  /** Кого уже проверяли и отпустили по этому делу. */
  cleared: Set<number>;
}

/** Донос, который свидетель несёт ВС (CitizenBrain.tip). */
export interface Tip {
  case: Case | null;
  corpse: Corpse | null;
  until: number;
  /** Можно окликнуть издалека (только по горячим следам). */
  shout: boolean;
  at: number;
}

/** Дверь поквартирного обхода: жилище, куда стучат, и якорь у его двери снаружи. */
interface Door {
  d: Dwelling;
  x: number;
  y: number;
  a: number;
}

/**
 * Поквартирный обход убийства: один юнит идёт по домам вокруг места (вызов с отрицательным номером — через
 * рацию CpBrain), стучит, опрашивает тех, кто дома. wait — ждёт свободного юнита, go — идёт к двери, knock —
 * стучит, answer — ему отвечают (и записывают).
 */
interface Canvass {
  id: number;
  cs: Case;
  callId: number;
  doors: Door[];
  i: number;
  unit: Character | null;
  phase: 'wait' | 'go' | 'knock' | 'answer';
  /** Не раньше; не дольше (юнита нет); следующая попытка найти юнита; когда начался обход. */
  start: number;
  expire: number;
  nextTry: number;
  began: number;
  /** С какого времени идёт к этой двери; когда сменится стадия; с какого времени занят другим (-1 — нет); неудачи пути. */
  since: number;
  at: number;
  stallSince: number;
  fails: number;
  failAt: number;
  reassigned: number;
  told: number;
  /** Ответная реплика сотрудника (после слов жителей) и когда её сказать. */
  line: string | null;
  lineAt: number;
}

/** Состояния юнита, при которых обход продолжается (остальные — бой, конвой, служба — обход срывают). */
const CANVASS_OK: ReadonlySet<string> = new Set(['hunt', 'patrol', 'patrol-again', 'post', 'follow', 'approach', 'check']);
/** Свободен для обхода (следователь): не на службе и не в деле. */
const CANVASS_FREE: ReadonlySet<string> = new Set(['patrol', 'patrol-again', 'post', 'hunt', 'follow']);

/**
 * Дела о преступлениях (config/suspects.ts): Senses сообщает о насилии на глазах — заводится дело, свидетели
 * запоминают приметы (по своему положению и характеру) и решают: донести, соврать или промолчать (бандиты и воры
 * не доносят). Донос — ногами: свидетель идёт к ВС (CitizenBrain 'report'), сотрудник передаёт в эфир с
 * приметами и направлением; знали в лицо — розыск по имени. ВС видел сам — огонь на поражение. Патрули ищут по
 * ориентировке (recognize), при проверке — улики (кровь, нож того же вида); доказано — в тюрьму. Об убийстве, которое
 * стало известно ВС, юнит идёт по домам вокруг места (поквартирный обход) и расспрашивает тех, кто дома.
 */
export class Suspects {
  enabled = true;
  readonly cases: Case[] = [];
  private nextId = 1;
  private readonly rng: Rng;
  private readonly lastCheck = new WeakMap<Character, number>();
  private readonly heardAt = new WeakMap<Character, number>();
  /** Крики, на которые уже кто-то идёт. */
  private readonly screams: { x: number; y: number; t: number }[] = [];
  readonly stats = { cases: 0, witnesses: 0, reports: 0, lies: 0, silent: 0, delivered: 0, named: 0, cpSaw: 0, recognized: 0, charged: 0, released: 0, forensic: 0, bodies: 0, canvass: 0, knocks: 0, canvassTold: 0 };
  /** Поквартирные обходы в работе. */
  readonly canvasses: Canvass[] = [];
  private readonly canvassed = new Set<number>();
  private readonly entries = new Map<number, Door | null>();
  private nextCanvass = 1;
  private canvassScan = 0;

  constructor(private readonly ctx: AiContext) {
    this.rng = ctx.rng.fork(0x5005ec);
  }

  private get now(): number {
    return this.ctx.law.now;
  }

  // ───────────────────────────── приметы ─────────────────────────────

  /** Как человек выглядит сейчас. */
  lookOf(c: Character): Look {
    const fac = apparentFaction(c);
    const gang = !c.disguised ? this.ctx.gangs?.of(c) ?? null : null;
    const fam = !c.disguised ? this.ctx.families?.of(c) ?? null : null;
    const side: Side =
      gang ? 'gang'
      : fac === 'citizen' ? (c.faction === 'citizen' && !c.disguised && c.loyalty >= LOYALTY.uniform.min ? 'loyalist' : 'citizen')
      : fac === 'cwu' ? 'cwu'
      : fac === 'vort' ? 'vort'
      : fac === 'rebel' ? 'rebel'
      : fac === 'cp' ? 'cp'
      : 'other';
    const prof = c.disguised ? c.cover?.profession ?? null : c.profession;
    const w = c.weapon ? WEAPONS[c.weapon] : null;
    return {
      side,
      female: female(c),
      torso: c.gear.torso ?? `form:${prof ?? fac}`,
      head: c.gear.head ?? 'none',
      band: gang?.def.color ?? fam?.color ?? '',
      weapon: w && w.class !== 'melee' ? w.class : null,
      bloody: c.bloodyUntil > this.now,
    };
  }

  /** Сходство приметы (с учётом уверенности по признакам) и того, кто перед глазами: 0..1. */
  similarity(desc: Look, conf: Partial<Record<Feature, number>>, o: Look): number {
    const W = SUSPECTS.weights;
    let s = 0;
    let max = 0;
    for (const f of FEATURES) {
      const w = (W as Record<string, number>)[f === 'female' ? 'sex' : f] ?? 0;
      const k = conf[f] ?? 0;
      if (k <= 0) continue;
      // Нож не в руках и кровь отстирана — признак «не совпал», но и не опровергает: вдвое слабее.
      const soft = (f === 'weapon' && o.weapon === null) || (f === 'bloody' && !o.bloody);
      max += w * k * (soft ? 0.5 : 1);
      if (desc[f] === o[f]) s += w * k * (soft ? 0.5 : 1);
    }
    return max > 0 ? s / max : 0;
  }

  /** Словами: «мужчина, горожанин, в куртке, с ножом, в крови» — только то, в чём уверены. */
  describe(cs: Case): string {
    const d = cs.desc;
    const S = RADIO.suspect;
    if (!d) return cs.named ? displayName(cs.actor) : S.unknown;
    const k = cs.conf;
    const parts: string[] = [];
    const sideWord: Record<Side, readonly [string, string]> = {
      citizen: S.citizen, loyalist: ['лоялист в фиолетовом', 'лоялистка в фиолетовом'], cwu: S.cwu, vort: S.vort,
      gang: S.bandit, rebel: S.rebel, cp: ['в форме ВС', 'в форме ВС'], other: S.other,
    };
    const fem = (k.female ?? 0) >= 0.5 && d.female;
    const gangName = d.side === 'gang' && cs.actor.gang >= 0 ? this.ctx.gangs?.gangs[cs.actor.gang]?.def.name ?? '' : '';
    if ((k.side ?? 0) >= 0.4) parts.push(sideWord[d.side][fem ? 1 : 0].replace('{gang}', gangName));
    else parts.push(fem ? 'женщина' : (k.female ?? 0) >= 0.5 ? 'мужчина' : 'неизвестный');
    if ((k.torso ?? 0) >= 0.5 && !d.torso.startsWith('form:')) parts.push(`в ${ITEMS[d.torso as keyof typeof ITEMS]?.gear?.worn ?? 'куртке'}`);
    if ((k.head ?? 0) >= 0.5 && d.head !== 'none') parts.push(`в ${ITEMS[d.head as keyof typeof ITEMS]?.gear?.worn ?? 'шапке'}`);
    if ((k.weapon ?? 0) >= 0.4 && d.weapon) parts.push(`при ${fem ? 'ней' : 'нём'} ${S.weapons[d.weapon] ?? 'оружие'}`);
    if ((k.bloody ?? 0) >= 0.4 && d.bloody) parts.push('одежда в крови');
    if (cs.named) parts.push(`опознан${fem ? 'а' : ''}: ${displayName(cs.actor)}`);
    return parts.join(', ');
  }

  /** Сторона света по углу. */
  dirWord(a: number | null): string {
    if (a === null) return 'дворами';
    const k = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
    return RADIO.dirs[k];
  }

  // ───────────────────────────── дела ─────────────────────────────

  /** Открытое дело на этого человека (серия) или null. */
  caseOf(c: Character): Case | null {
    for (let i = this.cases.length - 1; i >= 0; i--) {
      const cs = this.cases[i];
      if (!cs.closed && cs.actorPid === c.pid) return cs;
    }
    return null;
  }

  /** Известное ВС дело на этого человека. */
  knownCaseOf(c: Character): Case | null {
    const cs = this.caseOf(c);
    return cs && cs.known ? cs : null;
  }

  /**
   * Насилие на глазах (или без свидетелей — убийство): завести дело или дописать в открытое (серия). Только в
   * городе, виновник не из Протектората, пострадавший — не сотрудник Протектората (это — нападение, WarSystem).
   */
  crime(s: Stimulus): Case | null {
    const a = s.actor;
    const v = s.victim;
    if (!this.enabled || !a || !v || a === v) return null;
    if (FACTIONS[v.faction].authority) return null;
    // Стычка армии с кем-то в городе при штурме — война, не уголовщина.
    if (a.faction === 'rebel' && !a.disguised && v.faction === 'rebel') return null;
    const w = a.weapon ? WEAPONS[a.weapon] : null;
    return this.open(a, s.kind === 'kill', s.kind !== 'downed', s.x, s.y, v.name, w ? w.class : null);
  }

  /** Завести дело или дописать в открытое (серия): только в городе, виновник — не Протекторат. */
  private open(a: Character, kill: boolean, wound: boolean, x: number, y: number, victim: string, weapon: WeaponClass | null): Case | null {
    const { ctx } = this;
    if (FACTIONS[a.faction].authority) return null;
    if (!ctx.war.inCity(x, y) || !ctx.war.inCity(a.x, a.y)) return null;
    const now = this.now;
    let cs = this.caseOf(a);
    if (cs && now - cs.at > SUSPECTS.merge) cs = null;
    const zone = ctx.map.zoneAtWorld(x, y)?.id ?? -1;
    if (!cs) {
      cs = {
        id: this.nextId++, kind: kill ? 'murder' : 'assault', first: now, at: now, x, y, zone, actor: a, actorPid: a.pid,
        kills: 0, wounds: 0, victims: [], weapon, witnesses: new Map(), statements: [], known: false, named: false, seenByCp: false,
        desc: null, conf: {}, lastX: x, lastY: y, dir: null, closed: false, cleared: new Set(),
      };
      this.cases.push(cs);
      this.stats.cases++;
      if (this.cases.length > 80) this.cases.splice(0, this.cases.length - 80);
    }
    cs.at = now;
    cs.x = x;
    cs.y = y;
    cs.zone = zone;
    if (weapon && weapon !== 'melee') cs.weapon = weapon;
    if (kill) {
      cs.kind = 'murder';
      cs.kills++;
      if (!cs.victims.includes(victim)) cs.victims.push(victim);
    } else if (wound) cs.wounds++;
    return cs;
  }

  /**
   * Свидетели преступления (Senses): запомнили приметы и решают, что делать. ВС видно поблизости — окликнуть
   * сразу; иначе донос подождёт, пока свидетель не придёт в себя (CitizenBrain).
   */
  witnessed(cs: Case | null, s: Stimulus, seen: readonly Character[]): void {
    if (!cs || !s.actor) return;
    const a = s.actor;
    const now = this.now;
    const rel = this.ctx.relations;
    const look = this.lookOf(a);
    const W = SENSES.witness;
    for (const o of seen) {
      if (!o.alive || o.isPlayer) continue;
      const old = cs.witnesses.get(o.pid);
      const d = Math.hypot(o.x - a.x, o.y - a.y);
      const r = d <= SUSPECTS.far ? 1 : Math.max(SUSPECTS.farRel, 1 - (d - SUSPECTS.far) / 400);
      if (old) {
        old.seen = look;
        old.rel = Math.max(old.rel, r);
        continue;
      }
      const named = !!rel?.enabled && !a.disguised && rel.knows(o, a);
      const wt: Witness = { c: o, seen: look, named, rel: r, dir: null, told: false, will: this.decide(o, a, s.victim) };
      cs.witnesses.set(o.pid, wt);
      this.stats.witnesses++;
      if (wt.will === 'silent') {
        this.stats.silent++;
        continue;
      }
      if (wt.will === 'lie') this.stats.lies++;
      this.stats.reports++;
      const tip: Tip = { case: cs, corpse: null, until: now + W.pending, shout: true, at: now };
      // ВС рядом и видно — крикнуть «Стража! Убивают!» сразу (страх тут не помеха — так кричат от страха).
      const cp = this.cpInSight(o, W.shout);
      if (cp && o.brain instanceof CitizenBrain) {
        o.say(phrase(this.rng, o, SENSES.lines.shoutCp), now, 2);
        this.deliver(o, cp, tip, true);
        continue;
      }
      if (o.brain instanceof CitizenBrain) o.brain.queueReport(tip);
    }
  }

  /** Улица своих не сдаёт: бандиты, воры, отбросы, подполье и повстанцы. */
  private closedMouth(o: Character): boolean {
    return o.gang >= 0 || o.faction === 'rebel' || o.profession === 'thief' || o.profession === 'bandit' || o.profession === 'outcast' || o.disguised;
  }

  /** Решение свидетеля: донести, соврать, промолчать (config/senses SENSES.witness). */
  private decide(o: Character, a: Character, victim: Character | null): Witness['will'] {
    const W = SENSES.witness;
    // Улица своих не сдаёт: бандиты, воры, отбросы, подполье и повстанцы — молчат.
    if (this.closedMouth(o)) return 'silent';
    const rel = this.ctx.relations;
    let p = W.base + Math.max(-30, Math.min(100, o.loyalty)) * W.loyalty;
    if (rel?.enabled) {
      const per = rel.persona(o);
      p += W.kind * (per.kind - 0.5) + W.brave * (per.brave - 0.5);
      if (victim && rel.loved(o, victim)) p += W.victimLoved;
      if (rel.loved(o, a)) p += W.actorFriend;
    }
    if (a.gang >= 0) p += W.actorGang;
    if (this.rng.chance(Math.max(0, Math.min(0.97, p)))) return 'report';
    return o.loyalty < W.lowLoyalty && this.rng.chance(W.lie) ? 'lie' : 'silent';
  }

  /** Сотрудник Протектората в прямой видимости ближе r (свободный, не в бою). */
  private cpInSight(o: Character, r: number): Character | null {
    let best: Character | null = null;
    let bd = r;
    for (const c of this.ctx.entities.near(o.x, o.y, r, nearBuf)) {
      if (!(c.brain instanceof CpBrain) || !c.alive || c.downed || c.cadet || c.isPlayer) continue;
      const d = Math.hypot(c.x - o.x, c.y - o.y);
      if (d < bd && lineOfSight(this.ctx.map, o.x, o.y, c.x, c.y)) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  /** К кому нести донос: ближайший сотрудник ВС (не в бою, не курсант) не дальше SENSES.witness.seek. */
  reportTarget(o: Character, _tip: Tip): Character | null {
    const W = SENSES.witness;
    let best: Character | null = null;
    let bd: number = W.seek;
    const level = this.ctx.map.levelAt(o.x, o.y);
    for (const c of this.ctx.entities.near(o.x, o.y, W.seek, nearBuf)) {
      const b = c.brain;
      if (!(b instanceof CpBrain) || !c.alive || c.downed || c.cadet || c.isPlayer || c.law.phase !== 'none') continue;
      if (b.fsm.current === 'fight' || b.fsm.current === 'retreat' || this.ctx.map.levelAt(c.x, c.y) !== level || !this.ctx.war.inCity(c.x, c.y)) continue;
      const d = Math.hypot(c.x - o.x, c.y - o.y);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  /** Что свидетель говорит сотруднику (приметы своими словами). */
  reportLine(o: Character, tip: Tip): string {
    const cs = tip.case;
    if (!cs) {
      const where = tip.corpse ? whereOf(this.ctx.map.zoneAtWorld(tip.corpse.x, tip.corpse.y)) : 'там';
      return fmt(phrase(this.rng, o, SENSES.lines.reportBody), { where });
    }
    const w = cs.witnesses.get(o.pid);
    const st = w ? this.statementOf(cs, w) : null;
    const desc = st ? this.lookWords(st.look, st.named ? displayName(cs.actor) : '') : 'не разглядел';
    return fmt(phrase(this.rng, o, SENSES.lines.report), { desc, dir: this.dirWord(st?.dir ?? null) });
  }

  /** Приметы словами без уверенности (для слов свидетеля). */
  private lookWords(l: Look, name: string): string {
    const S = RADIO.suspect;
    const side: Record<Side, readonly [string, string]> = {
      citizen: S.citizen, loyalist: ['лоялист в фиолетовом', 'лоялистка в фиолетовом'], cwu: S.cwu, vort: S.vort,
      gang: ['бандит', 'бандитка'], rebel: S.rebel, cp: ['в форме ВС', 'в форме ВС'], other: S.other,
    };
    const p: string[] = [name || side[l.side][l.female ? 1 : 0].replace(' «{gang}»', '').replace('{gang}', '')];
    if (!l.torso.startsWith('form:')) p.push(`в ${(ITEMS[l.torso as keyof typeof ITEMS]?.name ?? 'куртке').toLowerCase()}`);
    if (l.head !== 'none') p.push(`в ${(ITEMS[l.head as keyof typeof ITEMS]?.name ?? 'шапке').toLowerCase()}`);
    if (l.weapon) p.push(`с оружием — ${S.weapons[l.weapon] ?? 'ствол'}`);
    if (l.bloody) p.push('весь в крови');
    return p.join(', ');
  }

  /** Показание свидетеля (соврал — приметы подменены). */
  private statementOf(cs: Case, w: Witness): Statement {
    let look = { ...w.seen };
    const lie = w.will === 'lie';
    if (lie) {
      const r = this.rng;
      const sides: Side[] = ['citizen', 'cwu', 'vort', 'gang', 'loyalist'];
      if (r.chance(SUSPECTS.lieSwap)) look.side = r.pick(sides);
      if (r.chance(SUSPECTS.lieSwap)) look.female = !look.female;
      if (r.chance(SUSPECTS.lieSwap)) look.head = look.head === 'none' ? 'helmet' : 'none';
      if (r.chance(SUSPECTS.lieSwap)) look.torso = look.torso.startsWith('form:') ? 'vest' : 'form:citizen';
      if (r.chance(SUSPECTS.lieSwap)) look.weapon = look.weapon ? null : 'pistol';
    } else look = this.blur(look, w.rel);
    // Куда ушёл: видел — по ходу виновника сейчас (или к нему от места).
    const a = cs.actor;
    const dir = a.alive && Math.hypot(a.vx, a.vy) > 20 ? Math.atan2(a.vy, a.vx) : a.alive ? Math.atan2(a.y - cs.y, a.x - cs.x) : null;
    return { by: w.c.pid, name: displayName(w.c), at: this.now, look, rel: lie ? 0.6 : w.rel, named: w.named && !lie, lie, dir: lie ? (dir === null ? null : dir + Math.PI) : dir };
  }

  /** Издалека — часть признаков путается. */
  private blur(l: Look, rel: number): Look {
    if (rel >= 0.95) return l;
    const r = this.rng;
    const out = { ...l };
    if (!r.chance(rel)) out.head = 'none';
    if (!r.chance(rel)) out.band = '';
    if (!r.chance(rel)) out.bloody = false;
    return out;
  }

  /**
   * Донос дошёл до ВС: показание в дело, приметы — в ориентировку, сотрудник передаёт в эфир (с приметами и
   * направлением), знали в лицо — розыск по имени. Квартал на заметке у ВС (эскалация).
   */
  deliver(o: Character, cp: Character, tip: Tip, shouted: boolean): void {
    const { ctx } = this;
    const now = this.now;
    this.stats.delivered++;
    if (!shouted) cp.say(phrase(this.rng, cp, SENSES.lines.cpThanks, o), now, 2);
    const cs = tip.case;
    if (!cs) {
      if (tip.corpse) {
        this.stats.bodies++;
        ctx.war.bodyReported(tip.corpse, cp);
      }
      return;
    }
    const w = cs.witnesses.get(o.pid);
    if (!w || w.told) return;
    w.told = true;
    const st = this.statementOf(cs, w);
    cs.statements.push(st);
    this.merge(cs);
    if (st.dir !== null) cs.dir = st.dir;
    cs.lastX = cs.x;
    cs.lastY = cs.y;
    const first = !cs.known;
    cs.known = true;
    if (st.named && !cs.named) this.identify(cs, cp, `показания ${st.name}`);
    this.radio(cs, cp, first);
    ctx.escalation?.caseKnown(cs, first);
    // Сотрудник, которому рассказали, идёт сам (если свободен) — по рации его и пошлют.
  }

  /** Свести приметы: по каждому признаку — самое частое значение (с весом точности), уверенность — доля. */
  private merge(cs: Case): void {
    const st = cs.statements;
    if (!st.length) return;
    const desc: Record<string, unknown> = {};
    const conf: Partial<Record<Feature, number>> = {};
    for (const f of FEATURES) {
      const votes = new Map<string, number>();
      let total = 0;
      for (const s of st) {
        const k = String(s.look[f]);
        const w = s.rel;
        votes.set(k, (votes.get(k) ?? 0) + w);
        total += w;
      }
      let best = '';
      let bv = -1;
      for (const [k, v] of votes) if (v > bv) {
        bv = v;
        best = k;
      }
      const sample = st.find((s) => String(s.look[f]) === best)!;
      desc[f] = sample.look[f];
      // Один свидетель — полуверие; несколько согласных — уверенность.
      conf[f] = (bv / Math.max(total, 1e-6)) * Math.min(1, 0.55 + 0.2 * (st.length - 1)) * (sample.lie ? 0.6 : 1);
    }
    // Экспертиза знает орудие точно.
    if (cs.conf.weapon !== undefined && (cs.conf.weapon ?? 0) > (conf.weapon ?? 0)) {
      conf.weapon = cs.conf.weapon;
      desc.weapon = cs.desc?.weapon ?? desc.weapon;
    }
    cs.desc = desc as unknown as Look;
    cs.conf = conf;
  }

  /** Личность установлена: розыск по имени (CID), ориентировка в эфир. */
  identify(cs: Case, by: Character | null, how: string): void {
    if (cs.named) return;
    cs.named = true;
    cs.known = true;
    this.stats.named++;
    const a = cs.actor;
    if (a.alive) {
      a.law.wanted = true;
      this.ctx.war.operatives.add(a);
      this.ctx.war.lastKnown.set(a, { x: cs.lastX, y: cs.lastY });
    }
    const line = fmt(this.rng.pick(SUSPECTS.lines.named), { name: displayName(a), cid: a.cid });
    this.ctx.law.log(`${line} (${how})`, 'radio');
    if (a.isPlayer) this.ctx.bus.emit('announce', { text: 'Вас опознали — розыск' });
    this.ctx.talk?.event('wanted', cs.x, cs.y, { who: displayName(a), big: true });
    void by;
  }

  /** В эфир: убийство или нападение, с приметами и направлением (первое — вызов, дальше — обновление). */
  private radio(cs: Case, cp: Character, first: boolean): void {
    const kind: IncidentKind = cs.kind === 'murder' ? (cs.kills >= 2 ? 'serial' : 'murder') : 'stabbing';
    const what = cs.kind === 'murder' ? (cs.kills >= 2 ? `убийства (${cs.kills})` : 'убийство') : 'нападение с оружием';
    this.ctx.war.raiseAlarm(cs.x, cs.y, what, false, {
      kind, reporter: cp, suspect: cs.named ? cs.actor : null, victim: cs.victims.length ? { name: cs.victims[cs.victims.length - 1] } : null,
      desc: this.describe(cs), dirText: this.dirWord(cs.dir), sweep: this.sweepPoint(cs),
    });
    void first;
  }

  /** Где искать: последнее место + по направлению (свидетель видел, куда ушёл). */
  sweepPoint(cs: Case): { x: number; y: number } {
    if (cs.dir === null) return { x: cs.lastX, y: cs.lastY };
    const ahead = 220;
    const x = cs.lastX + Math.cos(cs.dir) * ahead;
    const y = cs.lastY + Math.sin(cs.dir) * ahead;
    const a = this.ctx.nav.nearestWalkable(x, y, 6);
    return a >= 0 ? { x: this.ctx.nav.worldX(a), y: this.ctx.nav.worldY(a) } : { x: cs.lastX, y: cs.lastY };
  }

  /**
   * ВС видел насилие своими глазами: виновник — вооружённый враг (огонь на поражение, розыск), тревога в эфир.
   * Ножом при сотруднике — та же стрельба, что и стволом.
   */
  cpSaw(cs: Case | null, cp: Character, s: Stimulus): void {
    const a = s.actor;
    if (!cs || !a || !a.alive || a.law.phase !== 'none') return;
    if (!this.ctx.law.canSee(cp, a) && Math.hypot(cp.x - s.x, cp.y - s.y) > 120) return;
    const now = this.now;
    const fresh = !cs.seenByCp;
    cs.seenByCp = true;
    cs.known = true;
    cs.lastX = a.x;
    cs.lastY = a.y;
    // Огонь на поражение — ранил или убил при сотруднике.
    a.hostile = true;
    a.law.wanted = true;
    this.ctx.war.operatives.add(a);
    this.ctx.war.lastKnown.set(a, { x: a.x, y: a.y });
    if (!cs.named) {
      cs.named = true;
      this.stats.named++;
    }
    if (!fresh) {
      // Тот же человек на глазах у ВС добил — дело стало убийством: обновить эфир и учесть в квартале и серии.
      if (s.kind === 'kill') {
        this.radio(cs, cp, false);
        this.ctx.escalation?.caseKnown(cs, false);
      }
      return;
    }
    this.stats.cpSaw++;
    cp.say(phrase(this.rng, cp, s.kind === 'kill' ? SUSPECTS.lines.cpSawKill : SUSPECTS.lines.cpSawHit), now, 2);
    if (a.isPlayer) this.ctx.bus.emit('log', { text: 'ВС видели, как вы напали, — огонь без предупреждения.', kind: 'law' });
    this.desc(cs, this.lookOf(a), 1);
    this.radio(cs, cp, true);
    this.ctx.escalation?.caseKnown(cs, true);
  }

  /** Приметы с полной уверенностью (видел сотрудник, установлено). */
  private desc(cs: Case, look: Look, conf: number): void {
    cs.desc = look;
    for (const f of FEATURES) cs.conf[f] = Math.max(cs.conf[f] ?? 0, conf);
  }

  /** ВС услышал крик: свободный юнит идёт проверить (не чаще SUSPECTS.scream.every на юнит). */
  cpHeard(cp: Character, s: Stimulus): void {
    const now = this.now;
    if (now - (this.heardAt.get(cp) ?? -1e9) < SUSPECTS.scream.every) return;
    this.heardAt.set(cp, now);
    const b = cp.brain;
    if (!(b instanceof CpBrain) || !this.ctx.war.inCity(s.x, s.y)) return;
    // На одни крики идёт один юнит (кто первым услышал) и тот, кого пошлёт Надзор, а не все патрули квартала.
    const S = SUSPECTS.scream;
    if (this.screams.some((e) => now - e.t < S.every && Math.hypot(e.x - s.src.x, e.y - s.src.y) < S.area)) return;
    this.screams.push({ x: s.src.x, y: s.src.y, t: now });
    if (this.screams.length > 16) this.screams.shift();
    b.hearScream(s.src.x, s.src.y);
    this.ctx.radio?.report('screams', s.x, s.y, { reporter: cp, what: 'крики о помощи' });
  }

  /** Житель нашёл тело: донести ли (лоялисты — почти всегда; бандиты — нет). */
  bodyFound(finder: Character, k: Corpse): void {
    if (!(finder.brain instanceof CitizenBrain) || finder.gang >= 0 || finder.faction === 'rebel') return;
    const p = SENSES.witness.base + 0.25 + Math.max(0, finder.loyalty) * SENSES.witness.loyalty;
    if (!this.rng.chance(Math.min(0.95, p))) return;
    // Если это тело — по делу (убийство на глазах), донос о деле важнее; иначе — о теле.
    const cs = k.killer ? this.caseOf(k.killer) : null;
    const tip: Tip = { case: null, corpse: k, until: this.now + SENSES.witness.pending, shout: true, at: this.now };
    if (cs && cs.witnesses.has(finder.pid)) return;
    const cp = this.cpInSight(finder, SENSES.witness.shout);
    if (cp) {
      this.deliver(finder, cp, tip, true);
      return;
    }
    finder.brain.queueReport(tip);
  }

  /**
   * Экспертиза у тела (следователь): отпечатки — у зарегистрированного (CID) виновника личность; иначе — орудие.
   * Молчавшие свидетели рядом рассказывают следователю с шансом. true — личность установлена; false — дело
   * есть, виновник не установлен; null — дела нет (нет виновника, война, Протекторат, не в городе).
   */
  forensic(k: Corpse, by: Character): boolean | null {
    const killer = k.killer;
    if (!killer) return null;
    this.stats.forensic++;
    let cs = this.caseOf(killer);
    if (!cs) cs = this.open(killer, true, true, k.x, k.y, k.name, k.weapon ?? null);
    // Не по делу (война, Протекторат) — дела нет.
    if (!cs) return null;
    cs.known = true;
    const F = SUSPECTS.forensic;
    const cls = k.weapon ?? cs.weapon;
    const chance = cls === 'blade' || cls === 'melee' || cls === null ? F.blade : cls === 'pistol' || cls === 'rifle' || cls === 'smg' || cls === 'shotgun' || cls === 'sniper' ? F.gun : F.other;
    // Орудие экспертиза знает точно.
    if (cls && cls !== 'melee') {
      if (!cs.desc) cs.desc = { ...this.lookOf(killer), side: 'citizen', torso: 'form:citizen', head: 'none', band: '', bloody: false };
      cs.desc.weapon = cls;
      cs.conf.weapon = Math.max(cs.conf.weapon ?? 0, 0.9);
    }
    // Опрос: молчавшие рядом — с шансом расскажут следователю.
    for (const wt of cs.witnesses.values()) {
      if (wt.told || !wt.c.alive || wt.will === 'silent' && !this.rng.chance(SUSPECTS.interview.talk)) continue;
      if (Math.hypot(wt.c.x - k.x, wt.c.y - k.y) > SUSPECTS.interview.radius) continue;
      wt.told = true;
      cs.statements.push(this.statementOf(cs, wt));
      if (wt.named && wt.will !== 'lie') this.identify(cs, by, `опрос свидетеля ${displayName(wt.c)}`);
    }
    this.merge(cs);
    if (!cs.named && killer.law.hasCid && !killer.disguised && this.rng.chance(chance)) {
      this.identify(cs, by, 'экспертиза: отпечатки');
      return true;
    }
    return cs.named;
  }

  // ───────────────────────────── опознание и проверка ─────────────────────────────

  /**
   * Патрульный видит человека: подходит ли под ориентировку известного дела (или узнан в лицо — розыск по имени).
   * Возвращает дело, если стоит остановить и проверить.
   */
  recognize(cp: Character, o: Character): Case | null {
    if (!this.enabled || o.law.phase !== 'none' || FACTIONS[o.faction].authority || !o.alive || o.downed) return null;
    const now = this.now;
    if (now - (this.lastCheck.get(o) ?? -1e9) < SUSPECTS.recognize.recheck) return null;
    const d = Math.hypot(o.x - cp.x, o.y - cp.y);
    const R = SUSPECTS.recognize;
    if (d > R.reach) return null;
    let best: Case | null = null;
    let bs = 0;
    const look = this.lookOf(o);
    for (const cs of this.cases) {
      if (cs.closed || !cs.known || cs.cleared.has(o.pid)) continue;
      if (now - cs.at > SUSPECTS.memory) {
        cs.closed = true;
        continue;
      }
      // Опознан по имени — узнают в лицо вблизи.
      if (cs.named && cs.actorPid === o.pid && d <= R.face) {
        best = cs;
        bs = 1;
        break;
      }
      if (!cs.desc) continue;
      let sim = this.similarity(cs.desc, cs.conf, look);
      if (look.weapon && look.weapon === cs.desc.weapon) sim += R.armedBonus;
      if (look.bloody) sim += R.bloodyBonus;
      if (sim > bs) {
        bs = sim;
        best = cs;
      }
    }
    if (!best || bs < R.engage) return null;
    this.lastCheck.set(o, now);
    this.stats.recognized++;
    return best;
  }

  /**
   * Проверка документов подозреваемого (LawSystem.judge): доказано — 'murder' / 'assault' (тюрьма), иначе null (и
   * его больше не дёргают по этому делу). Доказательства: личность установлена, кровь на одежде, оружие того же
   * вида при сходстве примет.
   */
  charge(t: Character): 'murder' | 'assault' | null {
    if (!this.enabled) return null;
    const cs = this.caseOf(t);
    const now = this.now;
    if (cs && cs.known) {
      const look = this.lookOf(t);
      const sim = cs.desc ? this.similarity(cs.desc, cs.conf, look) : 0;
      const weapon = !!cs.desc?.weapon && t.inventory.slots.some((s) => WEAPONS[s.id as keyof typeof WEAPONS]?.class === cs.desc!.weapon);
      const proof = cs.named || t.bloodyUntil > now || (weapon && sim >= SUSPECTS.evidence.weaponMatch);
      if (proof) {
        this.stats.charged++;
        cs.named = true;
        return cs.kind;
      }
    }
    // Не доказано — отпустить; по известным делам его больше не останавливают.
    for (const c of this.cases) if (c.known && !c.closed) c.cleared.add(t.pid);
    this.stats.released++;
    return null;
  }

  /** Виновник задержан или погиб — дело закрыто. */
  close(c: Character): void {
    for (const cs of this.cases) if (!cs.closed && cs.actorPid === c.pid) cs.closed = true;
  }

  /** Строка для игрока: ищут ли его и как (HUD). */
  playerStatus(p: Character): string | null {
    const cs = this.knownCaseOf(p);
    if (!cs) return null;
    if (cs.seenByCp || cs.named) return 'Вас знают в лицо — розыск';
    const d = this.describe(cs);
    return `Вас ищут по приметам: ${d}`;
  }

  update(): void {
    const now = this.now;
    for (const cs of this.cases) {
      if (cs.closed) continue;
      const a = cs.actor;
      if (!a.alive || now - cs.at > SUSPECTS.memory || a.law.phase === 'jailed') cs.closed = true;
    }
    if (this.enabled) this.updateCanvass(now);
    void civilian;
  }

  // ───────────────────────────── поквартирный обход ─────────────────────────────

  /**
   * Ход обходов: раз в canvass.scan с — известные ВС убийства без обхода получают его (где бы дело ни стало
   * известным: донос, глаза сотрудника, экспертиза, опознание); остальное — каждый тик, лёгкое.
   */
  private updateCanvass(now: number): void {
    const C = SUSPECTS.canvass;
    if (now >= this.canvassScan) {
      this.canvassScan = now + C.scan;
      for (const cs of this.cases) if (cs.kind === 'murder' && cs.known && !cs.closed && !this.canvassed.has(cs.id)) this.scheduleCanvass(cs, now);
    }
    for (let i = this.canvasses.length - 1; i >= 0; i--) if (this.stepCanvass(this.canvasses[i], now)) this.canvasses.splice(i, 1);
  }

  /** Обход по делу (один раз): двери вокруг места, ближние первыми. */
  private scheduleCanvass(cs: Case, now: number): void {
    const C = SUSPECTS.canvass;
    this.canvassed.add(cs.id);
    const doors = this.canvassDoors(cs);
    if (!doors.length) return;
    const id = this.nextCanvass++;
    this.canvasses.push({
      id, cs, callId: -(1000 + id), doors, i: 0, unit: null, phase: 'wait', start: now + C.delay, expire: now + C.delay + C.wait, nextTry: 0, began: -1,
      since: 0, at: 0, stallSince: -1, fails: 0, failAt: -1e9, reassigned: 0, told: 0, line: null, lineAt: 0,
    });
  }

  /** Двери жилищ не дальше radius от места (не явки и не хаты — там не обход, а облава): цепочка от ближней. */
  private canvassDoors(cs: Case): Door[] {
    const C = SUSPECTS.canvass;
    const housing = this.ctx.housing;
    if (!housing) return [];
    const cand: { d: Dwelling; dist: number }[] = [];
    for (const d of housing.dwellings) {
      if (d.reserved) continue;
      const dist = Math.hypot(d.at.x - cs.x, d.at.y - cs.y);
      if (dist <= C.radius) cand.push({ d, dist });
    }
    cand.sort((a, b) => a.dist - b.dist);
    const pool: Door[] = [];
    const used = new Set<number>();
    for (const { d } of cand) {
      const e = this.entryOf(d);
      if (!e || used.has(e.a) || Math.hypot(e.x - cs.x, e.y - cs.y) > C.radius * 1.3) continue;
      used.add(e.a);
      pool.push(e);
      if (pool.length >= C.doors) break;
    }
    // Порядок обхода: ближняя к месту, дальше — ближняя к только что опрошенной.
    const out: Door[] = [];
    let px = cs.x;
    let py = cs.y;
    while (pool.length) {
      let bi = 0;
      for (let k = 1; k < pool.length; k++) if (Math.hypot(pool[k].x - px, pool[k].y - py) < Math.hypot(pool[bi].x - px, pool[bi].y - py)) bi = k;
      const [e] = pool.splice(bi, 1);
      out.push(e);
      px = e.x;
      py = e.y;
    }
    return out;
  }

  /** Где стучат в жилище: первый якорь снаружи комнаты по ходу от её места (волной по якорям); кэш. */
  private entryOf(d: Dwelling): Door | null {
    const hit = this.entries.get(d.id);
    if (hit !== undefined) return hit;
    const { nav, housing } = this.ctx;
    let out: Door | null = null;
    const start = nav.nearestWalkable(d.at.x, d.at.y, 1);
    if (start >= 0 && nav.level[start] === 0) {
      const seen = new Set<number>([start]);
      let front = [start];
      for (let step = 0; step < SUSPECTS.canvass.entryDepth && !out && front.length; step++) {
        const next: number[] = [];
        for (const i of front) {
          const ax = nav.ax(i);
          const ay = nav.ay(i);
          for (let k = 0; k < 4 && !out; k++) {
            const bx = ax + (k === 0 ? 1 : k === 1 ? -1 : 0);
            const by = ay + (k === 2 ? 1 : k === 3 ? -1 : 0);
            if (!nav.isWalkable(bx, by)) continue;
            const j = by * nav.w + bx;
            if (seen.has(j)) continue;
            seen.add(j);
            const x = nav.worldX(j);
            const y = nav.worldY(j);
            if (!housing.inside(d, { x, y })) out = { d, x, y, a: j };
            else next.push(j);
          }
        }
        front = next;
      }
    }
    this.entries.set(d.id, out);
    return out;
  }

  /** Строка в журнал — игроку из силового блока или тому, кто рядом. */
  private announce(text: string, x: number, y: number): void {
    const p = this.ctx.player;
    if (p && (p.faction === 'cp' || Math.hypot(p.x - x, p.y - y) < SUSPECTS.canvass.hear)) this.ctx.law.log(text, 'radio');
  }

  /** Свободен ли сотрудник для обхода: не на посту, не в службе, не в деле и не занят вызовом не ниже по важности. */
  private canvassFree(b: CpBrain, now: number): boolean {
    if (b.guardPost || b.medicStation || b.rally || b.raidPost || b.formation || b.ward || b.scene || b.front >= 0 || b.target) return false;
    if (b.duty && b.duty !== 'squad') return false;
    if (b.call && now < b.call.until && b.call.prio >= SUSPECTS.canvass.prio) return false;
    return CANVASS_FREE.has(b.fsm.current);
  }

  /** Юнит для обхода: следователь (ему от места ближе или дальше — не так важно), иначе свободный патрульный. */
  private canvassUnit(cv: Canvass, now: number): Character | null {
    const C = SUSPECTS.canvass;
    const door = cv.doors[cv.i];
    let best: Character | null = null;
    let bs = Infinity;
    for (const c of this.ctx.entities.list) {
      const b = c.brain;
      if (!(b instanceof CpBrain) || c.faction !== 'cp' || !c.alive || c.isPlayer || c.downed || c.cadet) continue;
      if (!(cpHas(c, 'investigate') ? this.canvassFree(b, now) : b.canRespond(C.prio))) continue;
      if (!this.ctx.war.inCity(c.x, c.y) || this.ctx.map.levelAt(c.x, c.y) !== 'city') continue;
      const d = Math.hypot(c.x - door.x, c.y - door.y);
      if (d > C.seek) continue;
      const score = d - (cpHas(c, 'investigate') ? C.investigatorBonus : 0);
      if (score < bs) {
        bs = score;
        best = c;
      }
    }
    return best;
  }

  /** Конец обхода: вызов у юнита снять (если ещё наш). */
  private endCanvass(cv: Canvass): true {
    const b = cv.unit?.brain;
    if (b instanceof CpBrain && b.call?.id === cv.callId) b.call = null;
    cv.unit = null;
    return true;
  }

  /** Юнит выбыл или его забрали: другому (не больше reassign раз), иначе отбой. */
  private lostCanvass(cv: Canvass, now: number): boolean {
    const C = SUSPECTS.canvass;
    const b = cv.unit?.brain;
    if (b instanceof CpBrain && b.call?.id === cv.callId) b.call = null;
    cv.unit = null;
    if (cv.reassigned >= C.reassign) return true;
    cv.reassigned++;
    cv.phase = 'wait';
    cv.nextTry = now + C.retry;
    cv.expire = now + C.wait;
    cv.stallSince = -1;
    return false;
  }

  /** Шаг обхода; true — обход кончился. */
  private stepCanvass(cv: Canvass, now: number): boolean {
    const C = SUSPECTS.canvass;
    const { ctx } = this;
    if (cv.cs.closed || ctx.war.code === 'red') return this.endCanvass(cv);
    if (cv.phase === 'wait') {
      if (now < cv.start || now < cv.nextTry) return false;
      if (now > cv.expire) return this.endCanvass(cv);
      cv.nextTry = now + C.retry;
      if (this.canvasses.filter((o) => o.unit).length >= C.active) return false;
      const u = this.canvassUnit(cv, now);
      if (!u) return false;
      const first = cv.began < 0;
      const door = cv.doors[cv.i];
      (u.brain as CpBrain).call = { id: cv.callId, x: door.x, y: door.y, until: now + C.callTime, urgent: false, prio: C.prio };
      cv.unit = u;
      cv.phase = 'go';
      cv.since = now;
      cv.fails = 0;
      cv.stallSince = -1;
      if (first) {
        cv.began = now;
        this.stats.canvass++;
        this.announce(`Поквартирный обход: ${whereOf(ctx.map.zoneAtWorld(cv.cs.x, cv.cs.y))}.`, cv.cs.x, cv.cs.y);
      }
      return false;
    }
    const u = cv.unit;
    const b = u?.brain;
    if (!u || !u.alive || u.downed || !(b instanceof CpBrain) || b.call?.id !== cv.callId || !CANVASS_OK.has(b.fsm.current)) return this.lostCanvass(cv, now);
    if (now - cv.began > C.maxTime) return this.endCanvass(cv);
    const st = b.fsm.current;
    // Занят другим (проверка документов, ждёт перехода в «прочёсывание») — не дольше lostAfter.
    if (st === 'hunt') cv.stallSince = -1;
    else if (cv.stallSince < 0) cv.stallSince = now;
    else if (now - cv.stallSince > C.lostAfter) return this.lostCanvass(cv, now);
    const door = cv.doors[cv.i];
    b.call.until = now + C.callTime;
    const dist = Math.hypot(u.x - door.x, u.y - door.y);
    if (cv.phase === 'go') {
      if (cv.fails >= 2 || now - cv.since > C.goMax) return this.nextDoor(cv, b, now);
      if (st === 'hunt') this.steer(cv, b, u, door, dist, now);
      if (st === 'hunt' && dist <= C.reach) {
        cv.phase = 'knock';
        cv.at = now + C.knock;
        this.stats.knocks++;
        u.say(phrase(this.rng, u, C.lines.knock), now, C.knock);
      }
      return false;
    }
    if (st === 'hunt') this.steer(cv, b, u, door, dist, now);
    if (cv.line && now >= cv.lineAt) {
      u.say(cv.line, now, 2.4);
      cv.line = null;
    }
    if (now < cv.at) return false;
    if (cv.phase === 'knock') {
      this.interview(cv, u, door, now);
      cv.phase = 'answer';
      cv.at = now + C.answer;
      return false;
    }
    return this.nextDoor(cv, b, now);
  }

  private nextDoor(cv: Canvass, b: CpBrain, now: number): boolean {
    cv.i++;
    if (cv.i >= cv.doors.length) return this.endCanvass(cv);
    const door = cv.doors[cv.i];
    cv.phase = 'go';
    cv.since = now;
    cv.fails = 0;
    cv.line = null;
    if (b.call) {
      b.call.x = door.x;
      b.call.y = door.y;
    }
    return false;
  }

  /**
   * Привести юнита к двери: он в «прочёсывании» по вызову, но его случайные точки нам не нужны — шлём прямо к
   * двери (huntSpot — чтобы прочёсывание считало, что он на месте), у двери чужую цель отменяем — стоит.
   */
  private steer(cv: Canvass, b: CpBrain, u: Character, door: Door, dist: number, now: number): void {
    const m = b.mover;
    b.huntSpot = door.a;
    if (dist <= SUSPECTS.canvass.hold) {
      if (m.goal >= 0 && m.goal !== door.a) m.stop();
      return;
    }
    if (m.goal === door.a && m.status !== 'failed' && m.status !== 'idle') return;
    if (m.goal === door.a && m.status === 'failed' && now - cv.failAt > 1.5) {
      cv.failAt = now;
      cv.fails++;
    }
    m.goTo(u, this.ctx, door.a);
  }

  /** Живые у этой двери: в комнате жилища или (свои) не дальше inside px от неё. */
  private residents(d: Dwelling, except: Character): Character[] {
    const { ctx } = this;
    const ts = ctx.map.tileSize;
    const pad = SUSPECTS.canvass.inside;
    const r = d.room;
    const out: Character[] = [];
    const cx = (r.x + r.w / 2) * ts;
    const cy = (r.y + r.h / 2) * ts;
    for (const c of ctx.entities.near(cx, cy, Math.max(r.w, r.h) * ts * 0.75 + pad, nearBuf)) {
      if (c === except || !c.alive || c.downed || c.isPlayer || c.asleep || FACTIONS[c.faction].authority) continue;
      const near = c.x >= r.x * ts - pad && c.y >= r.y * ts - pad && c.x < (r.x + r.w) * ts + pad && c.y < (r.y + r.h) * ts + pad;
      if (ctx.housing.inside(d, c) || (c.home === d.id && near)) out.push(c);
    }
    return out;
  }

  /** Открыли дверь: расспросить тех, кто дома. */
  private interview(cv: Canvass, cp: Character, door: Door, now: number): void {
    const C = SUSPECTS.canvass;
    const people = this.residents(door.d, cp);
    if (!people.length) {
      cv.line = phrase(this.rng, cp, C.lines.nobody);
      cv.lineAt = now + 1.2;
      return;
    }
    let told = false;
    for (const r of people) {
      const w = cv.cs.witnesses.get(r.pid);
      if (!w) {
        r.say(phrase(this.rng, r, C.lines.nothing), now, 2.6);
        continue;
      }
      if (w.told) {
        r.say(phrase(this.rng, r, C.lines.already), now, 2.6);
        continue;
      }
      if (!this.rng.chance(this.closedMouth(r) ? C.hardTalk : C.talk)) {
        r.say(phrase(this.rng, r, C.lines.deny), now, 2.6);
        continue;
      }
      w.told = true;
      const st = this.statementOf(cv.cs, w);
      cv.cs.statements.push(st);
      this.merge(cv.cs);
      if (st.dir !== null) cv.cs.dir = st.dir;
      this.stats.canvassTold++;
      cv.told++;
      told = true;
      r.say(fmt(phrase(this.rng, r, SENSES.lines.report), { desc: this.lookWords(st.look, st.named ? displayName(cv.cs.actor) : ''), dir: this.dirWord(st.dir) }), now, 3.4);
      if (w.named && w.will !== 'lie' && !cv.cs.named) this.identify(cv.cs, cp, `поквартирный обход: ${st.name}`);
    }
    if (told) {
      cv.line = phrase(this.rng, cp, C.lines.thanks);
      cv.lineAt = now + 1.8;
    }
  }
}

const nearBuf: Character[] = [];
