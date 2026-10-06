import type { AiContext } from '../ai/AiContext';
import type { Character } from '../entities/Character';
import { TALK, type Attitude, type ByAtt, type NewsDef, type TalkSetting, type TopicDef, type TopicLines } from '../config/talk';
import { STREET } from '../config/street';
import { FAMILIES } from '../config/families';
import { SECURITY } from '../config/security';
import { LOYALTY } from '../config/loyalty';
import { ECONOMY } from '../config/economy';
import { PROFESSIONS } from '../config/professions';
import { RADIO } from '../config/radio';
import { RELATIONS } from '../config/relations';
import { FACTIONS } from '../config/factions';
import { Rng } from '../core/rng';
import { whereOf } from '../world/places';
import { displayName } from '../entities/cover';
import { fmt, frontName, callsigns, type Incident } from './Radio';
import { freshTemplate, gendered, recentPhrases, remember, saidBy } from './phrases';

/** Слух: что, где, когда, о ком. */
export interface News {
  id: number;
  kind: string;
  x: number;
  y: number;
  where: string;
  at: number;
  who: string;
  gang: string;
  front: string;
  what: string;
  big: boolean;
  /** Чья семья пострадала (-1 — ничья). */
  family: number;
}

/** Реплика беседы: 0 — начавший (A), 1 — собеседник (B). */
export interface TalkLine {
  who: 0 | 1;
  text: string;
}

interface Convo {
  a: Character;
  b: Character;
  lines: TalkLine[];
  i: number;
  next: number;
  setting: TalkSetting;
  /** Тема беседы (для отношений: знакомство, ссора, извинение…). */
  topic: string;
}

/** Где к беседе подмешиваются темы отношений (знакомство, друзья, слухи о людях, настроение). */
const RELATION_SETTINGS: ReadonlySet<TalkSetting> = new Set<TalkSetting>(['street', 'bench', 'barrel', 'canteen', 'smoke', 'walk', 'family']);

/** Сменщик имени: «Мария Зайцева» → «Мария», «ВС-1234» → «ВС-1234». */
export function firstName(c: Character): string {
  return displayName(c).split(' ')[0];
}

/** Запасной список по отношению: нет своего — ближайшее по духу, потом общий. */
const FALLBACK: Record<Attitude, Attitude[]> = {
  loyal: ['neutral'],
  neutral: [],
  grumble: ['neutral'],
  tough: ['grumble', 'neutral'],
  cp: ['loyal', 'neutral'],
  rebel: ['grumble', 'neutral'],
};

/**
 * Разговоры жителей: слухи (кто что видел — тот и рассказывает, слух расходится), темы по обстановке и
 * отношению собеседников, беседы по ролям (ВС на посту, лагерь, курсанты, банда), память без повторов.
 * Беседу ведёт сама система (converse → update): реплики по очереди, пока стоят рядом. Своя случайность —
 * общая случайность мира от разговоров не сдвигается.
 */
export class Talk {
  readonly news: News[] = [];
  readonly stats = { convos: 0, lines: 0, news: 0, told: 0, remarks: 0, done: 0, cut: 0, stopped: 0, topics: {} as Record<string, number> };
  /** Выключить (тесты): беседы не идут, реплики — из старых списков. */
  enabled = true;
  private readonly rng: Rng;
  private nextId = 1;
  private readonly known = new WeakMap<Character, News[]>();
  private readonly topicMem = new WeakMap<Character, { id: string; with: number; at: number }[]>();
  private readonly convos: Convo[] = [];
  /** Тема последней собранной беседы (dialogue → converse). */
  private lastTopic = 'small';

  constructor(private readonly ctx: AiContext) {
    this.rng = ctx.rng.fork(0x7a1c);
    ctx.combat.deathListeners.push((c, killer) => this.onDeath(c, killer));
  }

  private get now(): number {
    return this.ctx.law.now;
  }

  // ───────────────────────────── слухи ─────────────────────────────

  /** Происшествие из эфира — свидетели знают (выстрелы слышно дальше). */
  incident(inc: Incident): News | null {
    const kind = RADIO.kinds[inc.kind].rumor;
    const loud = inc.kind === 'shots' || inc.kind === 'gunfire' || inc.kind === 'contact' || inc.kind === 'attack' || inc.kind === 'gang' || inc.kind === 'convoy';
    const gang = inc.suspect ? this.ctx.gangs?.of(inc.suspect)?.def.name ?? '' : '';
    return this.event(kind, inc.x, inc.y, { who: inc.victim?.name ?? '', what: inc.what, gang, radius: loud ? TALK.news.hear : TALK.news.witness, cp: true });
  }

  /**
   * Новость: kind — вид (TALK.newsTopics), о ком (who), банда, КПП. Узнают: свидетели в radius, вся сеть ВС
   * (cp — по рации), родня (kinOf), все в городе (big).
   */
  event(kind: string, x: number, y: number, o: { who?: string; what?: string; gang?: string; front?: string; big?: boolean; radius?: number; cp?: boolean; kinOf?: Character | null; rebels?: boolean } = {}): News | null {
    if (!TALK.newsTopics[kind]) return null;
    const { ctx } = this;
    const zone = ctx.map.zoneAtWorld(x, y);
    const n: News = {
      id: this.nextId++, kind, x, y, where: whereOf(zone), at: this.now, who: o.who ?? '', gang: o.gang ?? '', front: o.front ?? '',
      what: o.what ?? '', big: !!o.big, family: o.kinOf?.family ?? -1,
    };
    this.news.push(n);
    if (this.news.length > TALK.news.max) this.news.splice(0, this.news.length - TALK.news.max);
    this.stats.news++;
    const r = o.radius ?? TALK.news.witness;
    const level = ctx.map.levelAt(x, y);
    for (const c of ctx.entities.list) {
      if (!c.alive || c.isPlayer) continue;
      const auth = FACTIONS[c.faction].authority;
      const near = Math.hypot(c.x - x, c.y - y) < r && ctx.map.levelAt(c.x, c.y) === level;
      const kin = !!o.kinOf && c.family >= 0 && c.family === o.kinOf.family && c !== o.kinOf;
      const net = !!o.cp && auth;
      const camp = !!o.rebels && c.faction === 'rebel';
      if (o.big || near || kin || net || camp) this.learn(c, n);
    }
    return n;
  }

  /** Узнал новость (своих — не больше TALK.news.perPerson, старые забываются). */
  learn(c: Character, n: News): void {
    let list = this.known.get(c);
    if (!list) this.known.set(c, (list = []));
    if (list.includes(n)) return;
    list.push(n);
    if (list.length > TALK.news.perPerson) list.shift();
  }

  knows(c: Character, n: News): boolean {
    return !!this.known.get(c)?.includes(n);
  }

  /** Свежие новости, которые знает c. */
  knownBy(c: Character): News[] {
    const now = this.now;
    return (this.known.get(c) ?? []).filter((n) => now - n.at < TALK.news.ttl);
  }

  /** Гибель: убитый горожанин — слух о теле (родня знает сразу); погибший повстанец — весь лагерь. */
  private onDeath(c: Character, killer: Character | null): void {
    if (!this.enabled) return;
    if (c.faction === 'rebel' && !c.disguised) {
      this.event('rebelDeath', c.x, c.y, { who: c.name, rebels: true, radius: 0 });
      return;
    }
    if ((c.faction === 'citizen' || c.faction === 'cwu') && killer && killer !== c) this.event('body', c.x, c.y, { who: c.name, kinOf: c });
  }

  // ───────────────────────────── отношение ─────────────────────────────

  /** Как человек смотрит на жизнь (от этого — ответы). */
  attitude(c: Character): Attitude {
    if (c.faction === 'cp' || c.faction === 'ota' || c.faction === 'admin') return 'cp';
    if (c.faction === 'rebel' && !c.disguised) return 'rebel';
    if (c.disguised) return 'grumble';
    if (this.ctx.gangs?.of(c) || c.profession === 'bandit' || c.profession === 'thief' || c.profession === 'gang_boss') return 'tough';
    if (c.faction === 'vort') return 'grumble';
    if (c.loyalty >= LOYALTY.uniform.min) return 'loyal';
    if (c.loyalty < 0) return 'grumble';
    return 'neutral';
  }

  private listFor(by: ByAtt, att: Attitude): readonly string[] {
    const own = by[att];
    if (own?.length) return own;
    for (const f of FALLBACK[att]) {
      const l = by[f];
      if (l?.length) return l;
    }
    return by.any ?? [];
  }

  // ───────────────────────────── выбор слов ─────────────────────────────

  /**
   * Строка без повторов, с подстановками и родом: {сказал|сказала} — по говорящему c, [слышал|слышала] — по
   * собеседнику to.
   */
  private line(c: Character, list: readonly string[], vars: Record<string, string | number>, to: Character | null = null): string | null {
    if (!list.length) return null;
    const tpl = freshTemplate(this.rng, c, list);
    remember(c, tpl);
    return fmt(gendered(tpl, c, to), vars);
  }

  /** «Когда» по возрасту новости. */
  private ago(n: News): string {
    const d = this.now - n.at;
    const A = TALK.ago;
    const L = TALK.agoLines;
    return d < A.now ? L.now : d < A.recent ? L.recent : d < A.today ? L.today : L.old;
  }

  private vars(a: Character, b: Character | null, n: News | null = null): Record<string, string | number> {
    const v: Record<string, string | number> = {
      aname: firstName(a), bname: b ? firstName(b) : '', where: n?.where ?? whereOf(this.ctx.map.zoneAtWorld(a.x, a.y)),
      ago: n ? this.ago(n) : '', who: n?.who || 'кто-то', what: n?.what || 'происшествие', gang: n?.gang || this.gangName(a), rival: this.rivalName(a),
      front: n?.front || this.frontName(), job: this.job(a), n: 0, units: 'патрули', kin: '',
    };
    return v;
  }

  private gangName(c: Character): string {
    return this.ctx.gangs?.of(c)?.def.name ?? this.ctx.gangs?.gangs[0]?.def.name ?? 'банда';
  }

  private rivalName(c: Character): string {
    const g = this.ctx.gangs;
    const mine = g?.of(c);
    const other = g?.gangs.find((x) => x !== mine);
    return other?.def.name ?? 'чужие';
  }

  private frontName(): string {
    const war = this.ctx.war;
    const f = war?.fronts.find((x) => war.active(x)) ?? war?.fronts[war.command?.target ?? 0] ?? war?.fronts[0];
    return f ? frontName(f) : 'КПП';
  }

  private job(c: Character): string {
    const p = c.profession ? PROFESSIONS[c.profession] : null;
    return p ? p.name.toLowerCase() : 'рабочий';
  }

  // ───────────────────────────── беседа ─────────────────────────────

  /** Тема с этим собеседником была недавно. */
  private recentTopic(a: Character, b: Character, id: string): boolean {
    const now = this.now;
    const m = this.topicMem.get(a);
    return !!m?.some((t) => t.id === id && (t.with === b.id || id.startsWith('news:')) && now - t.at < TALK.memory.topicCooldown);
  }

  private markTopic(a: Character, b: Character, id: string): void {
    for (const c of [a, b]) {
      let m = this.topicMem.get(c);
      if (!m) this.topicMem.set(c, (m = []));
      m.push({ id, with: c === a ? b.id : a.id, at: this.now });
      if (m.length > TALK.memory.topics) m.shift();
    }
    this.stats.topics[id.startsWith('news:') ? `news:${id.split(':')[2]}` : id] = (this.stats.topics[id.startsWith('news:') ? `news:${id.split(':')[2]}` : id] ?? 0) + 1;
  }

  /**
   * Беседа двоих на одну тему (2–4 реплики): слух, который знает A (B узнаёт), тема по обстановке или
   * обычная пара вопрос — ответ. Повтор темы с тем же собеседником — редко.
   */
  dialogue(a: Character, b: Character, setting: TalkSetting): TalkLine[] {
    const W = TALK.weights;
    const cands: { id: string; w: number; build: () => TalkLine[] | null }[] = [];
    const attA = this.attitude(a);
    const attB = this.attitude(b);
    // Слухи.
    if (setting !== 'cards') {
      for (const n of this.knownBy(a)) {
        const def = TALK.newsTopics[n.kind];
        if (!def) continue;
        const id = `news:${n.id}:${n.kind}`;
        if (this.recentTopic(a, b, id)) continue;
        const fresh = 1 - (this.now - n.at) / TALK.news.ttl;
        const w = W.news * (TALK.newsWeight[n.kind] ?? 1) * (n.big ? W.bigNews : 1) * (this.knows(b, n) ? W.knownMul : 1) * (0.4 + fresh);
        cands.push({ id, w, build: () => this.buildNews(a, b, attA, attB, n, def) });
      }
    }
    // Темы места.
    for (const id of TALK.settings[setting] ?? []) {
      const w0 = this.topicWeight(id, a, b, attA, attB);
      if (w0 <= 0) continue;
      const w = w0 * (this.recentTopic(a, b, id) ? W.repeatMul : 1);
      cands.push({ id, w, build: () => this.buildTopic(id, a, b, attA, attB) });
    }
    // Отношения: знакомство, друзья, благодарность, поддержка, извинение, слухи о людях, настроение.
    const rel = this.ctx.relations;
    if (rel?.enabled && rel.topics && RELATION_SETTINGS.has(setting)) {
      for (const id of rel.topicIds(a, b)) {
        const w = rel.topicWeight(id) * (this.recentTopic(a, b, id) ? W.repeatMul : 1);
        cands.push({ id, w, build: () => this.buildRelation(id, a, b) });
      }
    }
    let total = 0;
    for (const c of cands) total += c.w;
    for (let tries = 0; tries < 4 && cands.length; tries++) {
      let r = this.rng.next() * total;
      let k = 0;
      for (; k < cands.length - 1; k++) {
        r -= cands[k].w;
        if (r <= 0) break;
      }
      const c = cands[k];
      // Тема запоминается до сборки: сборка может её поправить (извинение отвергли).
      this.lastTopic = c.id.startsWith('news:') ? 'news' : c.id;
      const lines = c.build();
      if (lines && lines.length >= 2) {
        this.markTopic(a, b, c.id);
        return lines;
      }
      total -= c.w;
      cands.splice(k, 1);
    }
    this.lastTopic = 'small';
    return this.buildPair(a, b, setting === 'family' ? FAMILIES.dialogues : setting === 'post' ? SECURITY.lines.postTalk : STREET.dialogues, 'small');
  }

  /** Беседа по отношениям (config/relations.ts topics): знакомство, друзья, благодарность, поддержка, извинение, слух о человеке, настроение. */
  private buildRelation(id: string, a: Character, b: Character): TalkLine[] | null {
    const rel = this.ctx.relations;
    const out: TalkLine[] = [];
    const vars = this.vars(a, b);
    const say = (who: 0 | 1, list: readonly string[] | undefined): boolean => {
      if (!list?.length) return false;
      const text = this.line(who === 0 ? a : b, list, vars, who === 0 ? b : a);
      if (!text) return false;
      out.push({ who, text });
      return true;
    };
    const maybe = (who: 0 | 1, list: readonly string[] | undefined): void => {
      if (this.rng.chance(TALK.backChance)) say(who, list);
    };
    if (id === 'gossip') {
      const g = rel.gossipFor(a, b);
      if (!g) return null;
      const def = RELATIONS.topics[g.good ? 'gossipGood' : 'gossipBad'];
      vars.who = displayName(g.c);
      const agreed = rel.gossip(a, b, g.c, g.good);
      if (!say(0, def.open) || !say(1, agreed ? def.agree : def.differ)) return null;
      maybe(0, def.back);
      return out;
    }
    const def = RELATIONS.topics[id];
    if (!def) return null;
    if (id === 'thanks') vars.why = rel.why(a, b, false);
    if (id === 'apology') vars.why = rel.why(a, b, true, true);
    if (id === 'apology') {
      const ok = rel.apologyAccepted(a, b);
      if (!say(0, def.open) || !say(1, ok ? def.accept : def.refuse)) return null;
      if (ok) maybe(0, def.back);
      // Принято — chatDone увидит тему и помирит; отказ — тема остаётся «apology-отказ», без последствий.
      if (!ok) this.lastTopic = 'apology-refused';
      return out;
    }
    if (!say(0, def.open) || !say(1, def.reply)) return null;
    maybe(0, def.back);
    return out;
  }

  /** Вес темы по обстановке (0 — не к месту). */
  private topicWeight(id: string, a: Character, b: Character, attA: Attitude, attB: Attitude): number {
    const { ctx } = this;
    const t = TALK.topics[id];
    const base = t?.w ?? 1;
    const war = ctx.war;
    const phase = ctx.routine?.enabled ? ctx.routine.phaseOf(a) : null;
    const hungry = a.hunger < ECONOMY.hunger.max * 0.35;
    switch (id) {
      case 'hungry':
      case 'cpHunger':
        return hungry ? base : 0;
      case 'rations':
        return ctx.economy.open ? base : 0;
      case 'yellow':
      case 'cpYellow':
        return war?.code === 'yellow' ? base : 0;
      case 'night':
      case 'cpNight':
        return phase === 'night' || ctx.routine?.night ? base : 0;
      case 'morning':
      case 'wakeUp':
        return phase === 'morning' ? base : 0;
      case 'evening':
        return phase === 'evening' ? base : 0;
      case 'kpp':
      case 'cpKpp':
        return war?.fronts.some((f) => war.active(f)) ? base : 0;
      case 'patrolNear':
        return this.patrolNear(a) ? base : 0;
      case 'work':
        return a.faction === 'cwu' ? base : 0;
      case 'jobless':
        return a.faction === 'citizen' && (!a.profession || a.profession === 'citizen') && attA !== 'loyal' && attA !== 'tough' ? base : 0;
      case 'money':
        return a.money < 5 ? base : 0;
      case 'argue':
        return (attA === 'loyal' && attB === 'grumble') || (attA === 'grumble' && attB === 'loyal') ? base : 0;
      case 'complain':
        return attA === 'grumble' && attB === 'grumble' ? base : 0;
      case 'praise':
        return attA === 'loyal' && attB === 'loyal' ? base : 0;
      case 'turf':
        return attA !== 'tough' && this.turfOf(a) ? base : 0;
      case 'gangBiz':
        return attA === 'tough' && attB === 'tough' && !!ctx.gangs?.of(a) && ctx.gangs.of(a) === ctx.gangs.of(b) ? base : 0;
      case 'family':
        return a.family >= 0 && a.family === b.family && (this.kinOf(a, b) || this.kinLoss(a)) ? 3 : 0;
      case 'familySmall':
        return a.family >= 0 && a.family === b.family ? 1 : 0;
      case 'small':
      case 'cpSmall':
      case 'campSmall':
        return TALK.weights.pairs;
      case 'cpRadio':
        return this.lastIncident(a) ? TALK.cpRadio.w : 0;
      case 'cpLoss':
        return this.knownBy(a).some((n) => n.kind === 'officerDown') ? base : 0;
      case 'cpStaff':
        return (ctx.staffing?.vacancies().length ?? 0) >= 3 ? base : 0;
      case 'cpShift':
      case 'cpPeople':
        return base;
      case 'cpGangs':
        return ctx.gangs?.gangs.length ? base * 0.6 : 0;
      case 'campOffensive':
        return base;
      case 'campPrison':
        return this.jailedRebels() > 0 ? base : 0;
      case 'campHurt':
        return a.health < a.maxHealth * 0.7 ? base : 0;
      case 'cadetExam':
      case 'cadetDrill':
      case 'cadetFuture':
      case 'cadetHome':
        return base;
      default:
        return t ? base : 0;
    }
  }

  /** Стража рядом (видна обоим — говорят тише). */
  private patrolNear(a: Character): boolean {
    for (const o of this.ctx.entities.near(a.x, a.y, 200, nearBuf)) if (o.alive && o.faction === 'cp' && !o.isPlayer) return true;
    return false;
  }

  /** Район банды, где стоит c (имя банды) или null. */
  private turfOf(c: Character): string | null {
    const g = this.ctx.gangs;
    if (!g) return null;
    for (const gang of g.gangs) if (g.inTurf(gang, c.x, c.y)) return gang.def.name;
    return null;
  }

  /** Родственник для разговора (живой, не A и не B). */
  private kinOf(a: Character, b: Character): Character | null {
    const kin = this.ctx.families?.kin(a).filter((m) => m !== b) ?? [];
    return kin.length ? kin[a.id % kin.length] : null;
  }

  /** Слух о гибели кого-то из семьи c (который знает c). */
  private kinLoss(c: Character): News | null {
    if (c.family < 0) return null;
    return this.knownBy(c).find((n) => n.kind === 'body' && n.family === c.family) ?? null;
  }

  /** Сколько повстанцев сидит в тюрьме. */
  private jailedRebels(): number {
    return this.ctx.law.imprisoned().filter((c) => c.faction === 'rebel').length;
  }

  /** Последний вызов по рации рядом с юнитом (за 5 минут). */
  private lastIncident(a: Character): Incident | null {
    const list = this.ctx.radio?.incidents ?? [];
    for (let i = list.length - 1; i >= 0; i--) {
      const inc = list[i];
      if (this.now - inc.opened < 300 && Math.hypot(inc.x - a.x, inc.y - a.y) < 2600) return inc;
    }
    return null;
  }

  private buildNews(a: Character, b: Character, attA: Attitude, attB: Attitude, n: News, def: NewsDef): TalkLine[] | null {
    const vars = this.vars(a, b, n);
    const knew = this.knows(b, n);
    const C = TALK.cpNews;
    const part = (by: ByAtt, att: Attitude, cp: readonly string[]): readonly string[] => (att === 'cp' && !by.cp?.length ? cp : this.listFor(by, att));
    const l0 = this.line(a, this.listFor(def.open, attA), vars, b);
    const l1 = this.line(b, knew ? part(def.knew, attB, C.knew) : part(def.reply, attB, C.reply), vars, a);
    if (!l0 || !l1) return null;
    const out: TalkLine[] = [{ who: 0, text: l0 }, { who: 1, text: l1 }];
    if (def.back && this.rng.chance(TALK.backChance)) {
      const l2 = this.line(a, part(def.back, attA, C.back), vars, b);
      if (l2) out.push({ who: 0, text: l2 });
    }
    // Узнал — теперь расскажет другим.
    if (!knew) {
      this.learn(b, n);
      this.stats.told++;
    }
    return out;
  }

  private buildTopic(id: string, a: Character, b: Character, attA: Attitude, attB: Attitude): TalkLine[] | null {
    if (id === 'small') return this.buildPair(a, b, STREET.dialogues, id);
    if (id === 'familySmall') return this.buildPair(a, b, FAMILIES.dialogues, id);
    if (id === 'cpSmall') return this.buildPair(a, b, SECURITY.lines.postTalk, id);
    if (id === 'family') return this.buildFamily(a, b);
    if (id === 'cpRadio') return this.buildCpRadio(a, b);
    const def: TopicDef | undefined = TALK.topics[id];
    if (!def) return null;
    // Варианты «вопрос — свои ответы»: не тот же, что недавно говорил A.
    let t: TopicLines = def;
    if (def.variants?.length) {
      const mine = saidBy(a);
      const ok = def.variants.filter((v) => !this.listFor(v.open, attA).some((l) => mine.includes(l)));
      t = this.rng.pick(ok.length ? ok : def.variants);
    }
    const vars = this.vars(a, b);
    if (id === 'turf') vars.gang = this.turfOf(a) ?? vars.gang;
    if (id === 'cpStaff') vars.n = this.ctx.staffing?.vacancies().length ?? 0;
    if (id === 'campPrison') vars.n = this.jailedRebels();
    if (id === 'cpLoss') {
      const n = this.knownBy(a).filter((x) => x.kind === 'officerDown').pop();
      if (n) {
        vars.who = n.who || 'наш';
        vars.where = n.where;
      }
    }
    const l0 = this.line(a, this.listFor(t.open, attA), vars, b);
    const l1 = this.line(b, this.listFor(t.reply, attB), vars, a);
    if (!l0 || !l1) return null;
    const out: TalkLine[] = [{ who: 0, text: l0 }, { who: 1, text: l1 }];
    const back = t.backTo ? this.listFor(t.backTo, attB) : t.back ? this.listFor(t.back, attA) : null;
    if (back?.length && this.rng.chance(TALK.backChance)) {
      const l2 = this.line(a, back, vars, b);
      if (l2) out.push({ who: 0, text: l2 });
      if (l2 && t.end && this.rng.chance(TALK.endChance)) {
        const l3 = this.line(b, this.listFor(t.end, attB), vars, a);
        if (l3) out.push({ who: 1, text: l3 });
      }
    }
    return out;
  }

  /** Пара «вопрос — ответ» из старых списков — без повторов у обоих. */
  private buildPair(a: Character, b: Character, pairs: readonly (readonly [string, string])[], id: string): TalkLine[] {
    const mine = saidBy(a);
    const rec = recentPhrases();
    const ok = pairs.filter((p) => !mine.includes(p[0]) && !rec.includes(p[0]));
    const p = this.rng.pick(ok.length ? ok : pairs);
    remember(a, p[0]);
    remember(b, p[1]);
    this.markTopic(a, b, id);
    const vars = this.vars(a, b);
    return [{ who: 0, text: fmt(gendered(p[0], a, b), vars) }, { who: 1, text: fmt(gendered(p[1], b, a), vars) }];
  }

  /** Родня: что с ней на самом деле (погибла — по слуху, который знает B). */
  private buildFamily(a: Character, b: Character): TalkLine[] | null {
    const F = TALK.family;
    const loss = this.kinLoss(b);
    const k = this.kinOf(a, b);
    if (!k && !loss) return null;
    const vars = { ...this.vars(a, b), kin: loss ? loss.who.split(' ')[0] : firstName(k!) };
    if (loss) {
      const l0 = this.line(a, F.open, vars, b);
      const l1 = this.line(b, F.dead, vars, a);
      const l2 = this.line(a, F.backBad, vars, b);
      return l0 && l1 && l2 ? [{ who: 0, text: l0 }, { who: 1, text: l1 }, { who: 0, text: l2 }] : null;
    }
    if (!k) return null;
    const state = !k.alive ? F.dead
      : k.law.phase === 'jailed' || k.law.phase === 'entering' || k.law.phase === 'cuffed' ? F.jailed
      : k.law.wanted ? F.wanted
      : k.cadet ? F.cadet
      : k.faction === 'cwu' ? F.cwu
      : F.fine;
    const bad = state !== F.fine && state !== F.cwu && state !== F.cadet;
    const l0 = this.line(a, F.open, vars, b);
    const l1 = this.line(b, state, vars, a);
    if (!l0 || !l1) return null;
    const l2 = this.line(a, bad ? F.backBad : F.backFine, vars, b);
    return l2 ? [{ who: 0, text: l0 }, { who: 1, text: l1 }, { who: 0, text: l2 }] : [{ who: 0, text: l0 }, { who: 1, text: l1 }];
  }

  /** ВС о последнем вызове по рации: чем кончилось. */
  private buildCpRadio(a: Character, b: Character): TalkLine[] | null {
    const inc = this.lastIncident(a);
    if (!inc) return null;
    const R = TALK.cpRadio;
    const vars = { ...this.vars(a, b), where: inc.where, what: inc.what || RADIO.kinds[inc.kind].code, units: callsigns(inc.responders) || 'патрули' };
    const reply = !inc.closed ? R.running : inc.result === 'killed' ? R.killed : inc.result === 'arrested' ? R.arrested : R.clear;
    const l0 = this.line(a, R.open, vars, b);
    const l1 = this.line(b, reply, vars, a);
    if (!l0 || !l1) return null;
    const l2 = this.rng.chance(TALK.backChance) ? this.line(a, R.back, vars, b) : null;
    return l2 ? [{ who: 0, text: l0 }, { who: 1, text: l1 }, { who: 0, text: l2 }] : [{ who: 0, text: l0 }, { who: 1, text: l1 }];
  }

  /**
   * Реплика одного (у бочки, на скамейке, на ходу, на перекуре…): иногда — слух, который знает; иногда — по
   * обстановке (голод, ночь, код, бой на КПП, розыск, своё отношение); иначе — из реплик занятия. Без повторов.
   */
  remark(c: Character, setting: TalkSetting, base: readonly string[] = []): string {
    this.stats.remarks++;
    const R = TALK.remarks;
    const att = this.attitude(c);
    if (setting === 'listen') return this.line(c, this.listFor(TALK.listen, att), this.vars(c, null)) ?? '…';
    if (setting === 'notice') {
      const w = this.ctx.entities.list.find((o) => o.alive && o.law.wanted && !FACTIONS[o.faction].authority && o !== c && hashPick(o.id, c.id));
      if (w && this.rng.chance(TALK.noticeWantedChance)) return this.line(c, TALK.noticeWanted, { ...this.vars(c, null), who: displayName(w) }) ?? '';
    }
    if (setting !== 'cards' && this.rng.chance(R.news)) {
      const known = this.knownBy(c);
      if (known.length) {
        const n = known[known.length - 1 - this.rng.int(0, Math.min(2, known.length - 1))];
        const def = TALK.newsTopics[n.kind];
        const t = def ? this.line(c, def.remark, this.vars(c, null, n)) : null;
        if (t) return t;
      }
    }
    if (setting !== 'cards' && this.rng.chance(R.context)) {
      const t = this.contextLine(c, att, setting);
      if (t) return t;
    }
    const pool = base.length ? base : setting === 'cp' ? TALK.context.cp : STREET.benchLines;
    return this.line(c, pool, this.vars(c, null)) ?? pool[0];
  }

  /** Реплика по обстановке. */
  private contextLine(c: Character, att: Attitude, setting: TalkSetting): string | null {
    const { ctx } = this;
    const C = TALK.context;
    const opts: (readonly string[])[] = [];
    const war = ctx.war;
    if (att === 'cp') {
      if (ctx.routine?.night) opts.push(C.cpNight);
      if (war?.code === 'yellow') opts.push(C.cpYellow);
      const inc = this.lastIncident(c);
      if (inc) return this.line(c, C.cpRecent, { ...this.vars(c, null), where: inc.where, what: inc.what || 'вызова' });
      opts.push(C.cp);
    } else {
      // Настроение и одиночество: слова в тон тому, что на душе (config/relations.ts).
      const rel = ctx.relations;
      if (rel?.enabled) {
        const m = rel.mood(c);
        if (m <= RELATIONS.talk.moodLow) opts.push(RELATIONS.lines.moodLow);
        else if (m >= RELATIONS.talk.moodHigh) opts.push(RELATIONS.lines.moodHigh);
        if (rel.lonely(c)) opts.push(RELATIONS.lines.lonely);
      }
      if (c.hunger < ECONOMY.hunger.max * 0.35) opts.push(C.hungry);
      const ph = ctx.routine?.enabled ? ctx.routine.phaseOf(c) : null;
      if (ph === 'night') opts.push(C.night);
      if (ph === 'morning') opts.push(C.morning);
      if (ph === 'evening') opts.push(C.evening);
      if (war?.code === 'yellow') opts.push(C.yellow);
      if (war?.fronts.some((f) => war.active(f))) opts.push(C.kpp);
      if (c.law.wanted) opts.push(C.wanted);
      if (att === 'loyal') opts.push(C.loyal);
      if (att === 'grumble') opts.push(C.grumble);
      if (att === 'tough') opts.push(C.tough);
      if (c.faction === 'cwu' && setting !== 'barrel') opts.push(C.cwu);
    }
    if (!opts.length) return null;
    return this.line(c, this.rng.pick(opts), this.vars(c, null));
  }

  // ───────────────────────────── ведение беседы ─────────────────────────────

  /**
   * Можно ли уйти (время занятия until вышло): тему договаривают, но не дольше TALK.pace.linger с сверху.
   */
  mayLeave(c: Character, until: number): boolean {
    return !this.busy(c) || this.now > until + TALK.pace.linger;
  }

  /** Ведут ли c беседу сейчас. */
  busy(c: Character): boolean {
    return this.convos.some((v) => v.a === c || v.b === c);
  }

  /** Начать беседу на одну тему (false — кто-то уже говорит или выключено). */
  converse(a: Character, b: Character, setting: TalkSetting): boolean {
    if (!this.enabled || a === b || !a.alive || !b.alive || this.busy(a) || this.busy(b)) return false;
    const lines = this.dialogue(a, b, setting);
    if (lines.length < 2) return false;
    this.convos.push({ a, b, lines, i: 0, next: this.now + TALK.pace.first, setting, topic: this.lastTopic });
    this.stats.convos++;
    return true;
  }

  /**
   * Заговорить с кем-то рядом (стоит, не занят беседой, подходит по ok) — с шансом TALK.group.perSec в
   * секунду: лагерь у костра, курсанты на обеде.
   */
  chatNear(self: Character, setting: TalkSetting, dt: number, ok: (o: Character) => boolean): boolean {
    const G = TALK.group;
    if (!this.enabled || this.busy(self) || !this.rng.chance(G.perSec * dt)) return false;
    for (const o of this.ctx.entities.near(self.x, self.y, G.reach, nearBuf)) {
      if (o === self || !o.alive || o.isPlayer || o.downed || o.moveSpeed > 10 || this.busy(o) || !ok(o)) continue;
      return this.converse(self, o, setting);
    }
    return false;
  }

  /** Прервать беседу (ВС, стрельба, ушёл). */
  stop(c: Character): void {
    for (let i = this.convos.length - 1; i >= 0; i--) {
      const v = this.convos[i];
      if (v.a === c || v.b === c) {
        this.convos.splice(i, 1);
        this.stats.stopped++;
        this.ctx.relations?.chatDone(v.a, v.b, v.topic, v.i / Math.max(1, v.lines.length));
      }
    }
  }

  /** Реплики бесед по очереди; разошлись дальше maxDist или кто-то упал — беседа кончилась. */
  update(): void {
    const now = this.now;
    const P = TALK.pace;
    for (let i = this.convos.length - 1; i >= 0; i--) {
      const v = this.convos[i];
      if (!v.a.alive || !v.b.alive || v.a.downed || v.b.downed || Math.hypot(v.a.x - v.b.x, v.a.y - v.b.y) > (P.far[v.setting] ?? P.maxDist)) {
        this.convos.splice(i, 1);
        this.stats.cut++;
        this.ctx.relations?.chatDone(v.a, v.b, v.topic, v.i / Math.max(1, v.lines.length));
        continue;
      }
      if (now < v.next) continue;
      if (v.i >= v.lines.length) {
        this.convos.splice(i, 1);
        this.stats.done++;
        this.ctx.relations?.chatDone(v.a, v.b, v.topic, 1);
        continue;
      }
      const l = v.lines[v.i++];
      const who = l.who === 0 ? v.a : v.b;
      const other = l.who === 0 ? v.b : v.a;
      // Рация важнее: говорящего по рации не перебивают — реплика чуть позже.
      if (who.speech && who.speech.kind !== 'say' && who.speech.until > now) {
        v.i--;
        v.next = now + 0.5;
        continue;
      }
      const show = Math.min(P.show[1], Math.max(P.show[0], P.base + P.perChar * l.text.length));
      who.say(l.text, now, show);
      // Собеседник молчит, пока ему отвечают.
      if (other.speech && other.speech.kind === 'say') other.speech.until = Math.min(other.speech.until, now);
      this.stats.lines++;
      v.next = now + Math.min(P.max, Math.max(P.min, P.base + P.perChar * l.text.length));
    }
  }
}

/** Детерминированный выбор «знакомого лица» на доске — свой у каждого читающего. */
function hashPick(a: number, b: number): boolean {
  return ((a * 7919 + b * 104729) >>> 0) % 3 === 0;
}

const nearBuf: Character[] = [];
