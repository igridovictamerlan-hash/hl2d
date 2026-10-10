import type { AiContext } from '../ai/AiContext';
import type { Character } from '../entities/Character';
import { CpBrain } from '../ai/brains/CpBrain';
import { RADIO, type IncidentKind } from '../config/radio';
import { FACTIONS } from '../config/factions';
import { WEAPONS } from '../config/items';
import { isFemaleName } from '../config/names';
import { Rng } from '../core/rng';
import { whereOf } from '../world/places';
import { lineOfSight } from '../world/visibility';
import { apparentFaction, displayName } from '../entities/cover';
import type { Front, DPoint } from './WarSystem';

/** Вызов по рации у юнита: куда ехать, до какого времени, бегом ли. */
export interface RadioCall {
  id: number;
  x: number;
  y: number;
  until: number;
  urgent: boolean;
  prio: number;
}

/** Происшествие в эфире: от доклада до отбоя. */
export interface Incident {
  id: number;
  kind: IncidentKind;
  prio: number;
  x: number;
  y: number;
  what: string;
  where: string;
  zone: string;
  opened: number;
  /** Последний новый сигнал (обновление, слияние). */
  signal: number;
  updated: number;
  reporter: Character | null;
  suspect: Character | null;
  /** Пострадавший юнит (или его тело). */
  victim: { name: string } | null;
  /** Приметы со слов свидетелей (Suspects) и куда ушёл — вместо «всевидящего» описания живого подозреваемого. */
  desc?: string;
  dirText?: string;
  /** Кого послали (вызов у них — RadioCall с id происшествия). */
  responders: Character[];
  /** Сколько всего посылали (и игрока). */
  sent: number;
  arrived: Set<Character>;
  /** Первый прибывший уже доложил «на месте». */
  onScene: boolean;
  contact: boolean;
  escalations: number;
  lastEscalate: number;
  /** С какого времени на месте тихо. */
  quietSince: number;
  redispatched: boolean;
  closed: boolean;
  closedAt: number;
  /** Чем кончилось: clear / arrested / killed / timeout / lost / quiet (без лишних слов). */
  result: string;
}

/** Передача в эфире (для звука рации, интерфейса и тестов). */
export interface Transmission {
  seq: number;
  at: number;
  /** null — Надзор. */
  from: Character | null;
  text: string;
  x: number;
  y: number;
}

type Vars = Record<string, string | number>;
/** Подстановки сразу или в момент выхода в эфир (направление беглеца, кто уже едет). */
type VarsSrc = Vars | (() => Vars);

interface Queued {
  /** Не раньше (с) и когда поставлен в очередь. */
  ready: number;
  pushed: number;
  from: Character | null;
  tpl: string;
  vars: VarsSrc;
  /** Над кем показать слова Надзора (адресаты). */
  to: Character[];
  /** Где это (для слушателей Надзора рядом и для «слышно игроку»). */
  x: number;
  y: number;
  prio: number;
  /** В журнал всем (иначе — игроку из силового блока или если рядом). */
  log: boolean;
}

/** Где рация не работает на вызовы: фронт и подземелье — у них своя связь (WarSystem, подполье). */
const OFF_NET = new Set(['checkpoint', 'outlands', 'wasteland', 'rebel_camp', 'sewer', 'rebel_base', 'black_market']);

/** Подставить {ключи} в шаблон; начало фразы и предложения — с заглавной. */
export function fmt(t: string, vars: Record<string, string | number>): string {
  const s = t.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)).replace(/([.!?]\s+)([а-яё])/g, (_m, p: string, ch: string) => p + ch.toUpperCase());
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Позывные списком: «ВС-1234», «ВС-1234 и ВС-5521», «ВС-1, ВС-2 и ВС-3». */
export function callsigns(list: readonly Character[]): string {
  const n = list.map((c) => c.name);
  if (n.length <= 1) return n[0] ?? '';
  return `${n.slice(0, -1).join(', ')} и ${n[n.length - 1]}`;
}

/** Короткое имя КПП для эфира: «КПП «Запад»». */
export function frontName(f: Pick<Front, 'name'>): string {
  return f.name.replace(/^Пограничный\s+/, '');
}

/**
 * Рация силового блока: происшествия в городе, вызовы Надзора и выезд ближайших, доклады юнитов, перекличка.
 * Реплики — облачком над головой (Character.say с видом 'radio' / 'dispatch'), в журнал — игроку из силового
 * блока всё, остальным — вызовы и то, что сказано рядом. Случайность — своя (rng.fork): эфир не сбивает
 * общую случайность мира.
 */
export class Radio {
  readonly incidents: Incident[] = [];
  readonly feed: Transmission[] = [];
  /** Выключить (тесты, режим «отряд на отряд»). */
  enabled = true;
  readonly stats = {
    incidents: 0, dispatched: 0, arrived: 0, escalations: 0, closed: 0, timeouts: 0, lines: 0,
    checkIns: 0, rollCalls: 0, contacts: 0, merged: 0, byKind: {} as Record<string, number>,
  };
  private readonly rng: Rng;
  private queue: Queued[] = [];
  /** Эфир занят до (с): одна частота — реплики по очереди. */
  private busyUntil = -1e9;
  private seq = 0;
  private nextId = 1;
  private tickLeft = 0;
  private lastCheckIn = -1e9;
  private nextRollCall: number;
  private nextInfo: number;
  private lastChase = -1e9;
  private lastBrawl = -1e9;
  private lastArrest = -1e9;
  private readonly lastContact = new WeakMap<Character, number>();
  private readonly downSeen = new WeakSet<Character>();
  private readonly frontAt = new Map<number, number>();
  private readonly frontHot = new Map<number, boolean>();

  constructor(private readonly ctx: AiContext) {
    this.rng = ctx.rng.fork(0x7ad10);
    const now = ctx.law.now;
    this.nextRollCall = now + this.rng.range(RADIO.routine.rollCall[0], RADIO.routine.rollCall[1]);
    this.nextInfo = now + this.rng.range(RADIO.routine.info[0], RADIO.routine.info[1]);
    ctx.combat.deathListeners.push((c, killer) => this.onDeath(c, killer));
    ctx.law.onFlee = (h, t) => this.chase(h, t);
    ctx.law.onLost = (h, t) => this.chaseLost(h, t);
    ctx.law.onArrest = (h, t, fled) => this.arrested(h, t, fled);
  }

  private get now(): number {
    return this.ctx.law.now;
  }

  /** Сколько реплик ждёт эфира. */
  get queued(): number {
    return this.queue.length;
  }

  /** Открытые происшествия. */
  get open(): Incident[] {
    return this.incidents.filter((i) => !i.closed);
  }

  /** Вызов у юнита (или у ведущего его группы). */
  static callOf(c: Character): RadioCall | null {
    const b = c.brain;
    return b instanceof CpBrain ? b.call : null;
  }

  // ───────────────────────────── происшествия ─────────────────────────────

  /**
   * Происшествие: доклад заметившего (если есть), вызов Надзора с местом и теми, кого послали, их
   * подтверждения. Рядом с открытым — то же самое (обновление). null — не в городе, рация выключена или
   * красный код (тогда вся сеть на обороне Управы).
   */
  report(kind: IncidentKind, x: number, y: number, o: ReportOpts = {}): Incident | null {
    const { ctx } = this;
    if (!this.enabled || !this.onNet(x, y) || ctx.war?.code === 'red') return null;
    const def = RADIO.kinds[kind];
    const now = this.now;
    const reporter = o.reporter && o.reporter.alive && !o.reporter.downed && FACTIONS[o.reporter.faction].authority ? o.reporter : null;
    const near = this.nearOpen(x, y);
    if (near) {
      this.merge(near, kind, x, y, { ...o, reporter });
      return near;
    }
    const open = this.open;
    if (open.length >= RADIO.incident.maxOpen) {
      // Эфир забит: мелкое — мимо, важное вытесняет самое мелкое.
      const low = open.reduce((a, b) => (b.prio < a.prio ? b : a));
      if (low.prio >= def.prio) return null;
      this.finish(low, 'quiet');
    }
    const zone = ctx.map.zoneAtWorld(x, y);
    const inc: Incident = {
      id: this.nextId++, kind, prio: def.prio, x, y, what: o.what ?? '', where: whereOf(zone), zone: zone?.name ?? 'город',
      opened: now, signal: now, updated: now, reporter, suspect: o.suspect ?? null, victim: o.victim ?? null, desc: o.desc, dirText: o.dirText,
      responders: [], sent: 0, arrived: new Set(), onScene: false, contact: kind === 'contact', escalations: 0, lastEscalate: -1e9,
      quietSince: now, redispatched: false, closed: false, closedAt: 0, result: '',
    };
    this.incidents.push(inc);
    this.stats.incidents++;
    this.stats.byKind[kind] = (this.stats.byKind[kind] ?? 0) + 1;
    if (reporter && def.report.length) this.say(reporter, this.pick(def.report), () => this.vars(inc, reporter), def.prio, true, RADIO.reportDelay);
    const units = o.units ?? def.units;
    if (units > 0) this.dispatch(inc, units, def.urgent, 'dispatch');
    else {
      // Без выезда (драка): Надзор только отвечает доложившему.
      if (def.dispatch.length) this.nadzor(this.pick(def.dispatch), () => this.vars(inc, reporter), reporter ? [reporter] : [], inc, def.prio, true, RADIO.reply);
      this.finish(inc, 'quiet');
    }
    if (kind === 'contact') this.stats.contacts++;
    ctx.talk?.incident(inc);
    // Чистка: закрытые старше пары минут не нужны.
    if (this.incidents.length > 40) {
      const keep = this.incidents.filter((i) => !i.closed || now - i.closedAt < 120);
      this.incidents.length = 0;
      this.incidents.push(...keep);
    }
    return inc;
  }

  /** Новый сигнал рядом с открытым происшествием: важнее — повышение и ещё юниты; иначе — обновление. */
  private merge(inc: Incident, kind: IncidentKind, x: number, y: number, o: ReportOpts): void {
    const def = RADIO.kinds[kind];
    const now = this.now;
    this.stats.merged++;
    if (o.suspect) inc.suspect = o.suspect;
    if (o.desc) inc.desc = o.desc;
    if (o.dirText) inc.dirText = o.dirText;
    if (o.victim && !inc.victim) inc.victim = o.victim;
    inc.signal = now;
    if (kind === 'unitDown' || kind === 'attack' || kind === 'contact' || kind === 'gunfire') inc.quietSince = now;
    if (def.prio > inc.prio) {
      inc.kind = kind;
      inc.prio = def.prio;
      inc.x = x;
      inc.y = y;
      if (o.what) inc.what = o.what;
      inc.updated = now;
      const r = o.reporter;
      if (r && def.report.length) this.say(r, this.pick(def.report), () => this.vars(inc, r), def.prio, true, RADIO.reportDelay);
      const more = Math.max(1, def.units - inc.responders.length);
      this.dispatch(inc, more, def.urgent, 'dispatch');
      return;
    }
    if (now - inc.updated >= RADIO.incident.updateEvery) {
      inc.updated = now;
      if (o.what) inc.what = o.what;
      const r = o.reporter ?? null;
      if (r && def.report.length) this.say(r, this.pick(def.report), () => this.vars(inc, r), def.prio, true, RADIO.reportDelay);
      if (inc.what) this.nadzor(this.pick(RADIO.lines.update), () => this.vars(inc, r), inc.responders, inc, def.prio, true, RADIO.reply);
    }
    // Ранен или убит юнит, юнит атакован — подмога.
    if (kind === 'unitDown' || kind === 'attack' || kind === 'contact') this.escalate(inc);
  }

  /** Вызов Надзора: ближайшие свободные юниты (и игрок из силового блока рядом), их подтверждения. */
  private dispatch(inc: Incident, n: number, urgent: boolean, mode: 'dispatch' | 'escalate'): Character[] {
    const def = RADIO.kinds[inc.kind];
    const units = this.pickUnits(inc, n, inc.prio);
    for (const u of units) this.assign(u, inc, urgent);
    inc.responders.push(...units);
    inc.sent += units.length;
    this.stats.dispatched += units.length;
    // Доложивший (не погоня — он и так бежит) тоже идёт разбираться, молча: он на месте.
    const rb = inc.reporter?.brain;
    if (mode === 'dispatch' && inc.kind !== 'fugitive' && inc.reporter && rb instanceof CpBrain && rb.canRespond(inc.prio)) {
      this.assign(inc.reporter, inc, urgent);
      if (!inc.responders.includes(inc.reporter)) inc.responders.push(inc.reporter);
      inc.arrived.add(inc.reporter);
    }
    const p = this.playerUnit(inc);
    const named = units.length ? units : p ? [p] : [];
    const vars = (): Vars => this.vars(inc, inc.reporter, named);
    let tpl: string;
    if (mode === 'escalate') tpl = this.pick(RADIO.lines.escalate);
    else if (!units.length && !p) tpl = this.pick(RADIO.lines.noUnits);
    else if (inc.reporter) {
      // «Принято, ВС-1234.» спереди — без второго «Принято» и «Надзор —» в самом вызове.
      tpl = `${this.pick(RADIO.lines.ackReporter)} ${this.pick(def.dispatch).replace(/^(Надзор\s*[—:-]\s*|Принято[.,!]\s*)/, '')}`;
    } else tpl = this.pick(def.dispatch);
    const to = [...(inc.reporter ? [inc.reporter] : []), ...units];
    this.nadzor(tpl, vars, to, inc, inc.prio, true, inc.reporter ? RADIO.reply : [0.2, 0.5]);
    if (p) {
      this.nadzor(this.pick(RADIO.lines.player), () => ({ ...vars(), unit: p.name }), [p], inc, inc.prio, true, [0.3, 0.6]);
      inc.sent++;
      this.ctx.bus.emit('radio:call', { x: inc.x, y: inc.y, where: inc.where });
    }
    for (const u of units) {
      const acks = def.ack ?? (urgent ? RADIO.lines.ackUrgent : RADIO.lines.ack);
      this.say(u, this.pick(acks), () => ({ ...this.vars(inc, u), eta: this.eta(u, inc) }), inc.prio, false, RADIO.stagger);
    }
    return units;
  }

  /** Подмога: ещё юниты бегом (не чаще RADIO.escalate.every, не больше times раз). */
  private escalate(inc: Incident): void {
    const E = RADIO.escalate;
    const now = this.now;
    if (inc.closed || inc.escalations >= E.times || now - inc.lastEscalate < E.every) return;
    inc.escalations++;
    inc.lastEscalate = now;
    this.stats.escalations++;
    for (const r of inc.responders) {
      const call = Radio.callOf(r);
      if (call && call.id === inc.id) call.urgent = true;
    }
    this.dispatch(inc, E.units, true, 'escalate');
  }

  /** Свободные юниты ближе RADIO.incident.seek, ближние первыми. */
  private pickUnits(inc: Incident, n: number, prio: number): Character[] {
    if (n <= 0) return [];
    const cands: { c: Character; d: number }[] = [];
    for (const c of this.ctx.entities.list) {
      if (c.faction !== 'cp' || !c.alive || c.isPlayer || c.downed || c === inc.reporter || inc.responders.includes(c)) continue;
      const b = c.brain;
      if (!(b instanceof CpBrain) || !b.canRespond(prio) || !this.onNet(c.x, c.y)) continue;
      const d = Math.hypot(c.x - inc.x, c.y - inc.y);
      if (d <= RADIO.incident.seek) cands.push({ c, d });
    }
    cands.sort((a, b) => a.d - b.d);
    return cands.slice(0, n).map((e) => e.c);
  }

  /** Дать юниту вызов (с прежнего вызова — снять). */
  private assign(u: Character, inc: Incident, urgent: boolean): void {
    const b = u.brain as CpBrain;
    if (b.call && b.call.id !== inc.id) {
      const old = this.incidents.find((i) => i.id === b.call!.id);
      if (old) old.responders = old.responders.filter((c) => c !== u);
    }
    b.call = { id: inc.id, x: inc.x, y: inc.y, until: this.now + RADIO.incident.callTime, urgent, prio: inc.prio };
  }

  /** Игрок из силового блока рядом с происшествием — Надзор зовёт и его. */
  private playerUnit(inc: Incident): Character | null {
    const p = this.ctx.player;
    if (!p || !p.alive || p.faction !== 'cp' || p.cadet || RADIO.kinds[inc.kind].units === 0) return null;
    if (this.ctx.map.levelAt(p.x, p.y) !== 'city') return null;
    return Math.hypot(p.x - inc.x, p.y - inc.y) < RADIO.player ? p : null;
  }

  /** Отбой происшествия: снять вызовы. */
  private finish(inc: Incident, result: string): void {
    if (inc.closed) return;
    inc.closed = true;
    inc.closedAt = this.now;
    inc.result = result;
    this.stats.closed++;
    if (result === 'timeout') this.stats.timeouts++;
    for (const c of this.ctx.entities.list) {
      const b = c.brain;
      if (b instanceof CpBrain && b.call?.id === inc.id) b.call = null;
    }
  }

  /** Открытое происшествие ближе RADIO.incident.merge. */
  private nearOpen(x: number, y: number): Incident | null {
    let best: Incident | null = null;
    let bd: number = RADIO.incident.merge;
    for (const i of this.incidents) {
      if (i.closed) continue;
      const d = Math.hypot(i.x - x, i.y - y);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  /** В городе и на сети (не фронт, не подземелье). */
  private onNet(x: number, y: number): boolean {
    if (this.ctx.map.levelAt(x, y) !== 'city') return false;
    const k = this.ctx.map.zoneAtWorld(x, y)?.kind;
    return !k || !OFF_NET.has(k);
  }

  /** Юнит ведёт бой (в бою или только что стрелял по цели). */
  private fighting(c: Character): boolean {
    const b = c.brain;
    if (!(b instanceof CpBrain) || !c.alive || c.downed) return false;
    return b.fsm.current === 'fight' || (!!b.gunner.target?.alive && this.ctx.combat.now - c.lastFired < 3);
  }

  // ───────────────────────────── тик ─────────────────────────────

  update(dt: number): void {
    if (!this.enabled) return;
    this.flush();
    this.tickLeft -= dt;
    if (this.tickLeft > 0) return;
    this.tickLeft = RADIO.tick;
    // КПП ожил (у ворот стреляют) — гарнизон докладывает.
    const war = this.ctx.war;
    if (war) {
      for (const f of war.fronts) {
        const hot = war.active(f);
        if (hot && !this.frontHot.get(f.index)) this.front('active', f);
        this.frontHot.set(f.index, hot);
      }
    }
    this.scanUnits();
    for (const inc of this.incidents) if (!inc.closed) this.watch(inc);
    this.routine();
  }

  /** Юниты в городе: упал — «потеря биосигнала»; в бою без вызова — «контакт». */
  private scanUnits(): void {
    const now = this.now;
    if (this.ctx.war?.code === 'red') return;
    for (const c of this.ctx.entities.list) {
      if (c.faction !== 'cp' || !c.alive || c.isPlayer || !(c.brain instanceof CpBrain)) continue;
      if (c.downed) {
        if (!this.downSeen.has(c) && this.onNet(c.x, c.y)) {
          this.downSeen.add(c);
          const w = this.witness(c);
          this.report('unitDown', c.x, c.y, { reporter: w, victim: c, suspect: c.lastAttacker, what: `ранен ${c.name}` });
        }
        continue;
      }
      if (this.downSeen.has(c)) this.downSeen.delete(c);
      if (!this.fighting(c) || !this.onNet(c.x, c.y)) continue;
      if (now - (this.lastContact.get(c) ?? -1e9) < RADIO.contact.every) continue;
      this.lastContact.set(c, now);
      const inc = this.nearOpen(c.x, c.y);
      if (inc) {
        if (!inc.contact) this.contact(inc, c);
        continue;
      }
      this.report('contact', c.x, c.y, { reporter: c, suspect: (c.brain as CpBrain).gunner.target, what: 'перестрелка' });
    }
  }

  /** Боеспособный свой рядом с упавшим, который его видит. */
  private witness(c: Character): Character | null {
    let best: Character | null = null;
    let bd = 420;
    for (const o of this.ctx.entities.list) {
      if (o === c || o.faction !== 'cp' || !o.alive || o.downed || o.isPlayer) continue;
      const d = Math.hypot(o.x - c.x, o.y - c.y);
      if (d < bd && lineOfSight(this.ctx.map, o.x, o.y, c.x, c.y)) {
        bd = d;
        best = o;
      }
    }
    return best;
  }

  /** Погиб юнит в городе: Надзор теряет биосигнал (свидетели не нужны). */
  private onDeath(c: Character, killer: Character | null): void {
    if (!this.enabled || c.faction !== 'cp' || !this.onNet(c.x, c.y)) return;
    this.report('unitDown', c.x, c.y, { victim: c, suspect: killer, what: `потеря биосигнала ${c.name}` });
  }

  /** Вызванный юнит вступил в бой: «контакт» и подмога. */
  private contact(inc: Incident, c: Character): void {
    inc.contact = true;
    inc.quietSince = this.now;
    this.say(c, this.pick(RADIO.lines.contact), this.vars(inc, c), 3, true, RADIO.reportDelay);
    this.escalate(inc);
  }

  /** Как идут дела на происшествии: прибытие, бой, итог, таймер. */
  private watch(inc: Incident): void {
    const now = this.now;
    const R = RADIO.incident;
    const lost = inc.responders.some((c) => !c.alive);
    inc.responders = inc.responders.filter((c) => c.alive && Radio.callOf(c)?.id === inc.id);
    if (inc.kind === 'fugitive') this.trackFugitive(inc);
    // Все, кого послали, выбыли — Надзор шлёт ещё (один раз).
    if (lost && !inc.responders.length && !inc.redispatched) {
      inc.redispatched = true;
      const units = this.pickUnits(inc, RADIO.kinds[inc.kind].units, inc.prio);
      for (const u of units) this.assign(u, inc, true);
      inc.responders.push(...units);
      this.nadzor(this.pick(RADIO.lines.lostUnits), this.vars(inc, null, units), units, inc, 3, true, [0.3, 0.6]);
      for (const u of units) this.say(u, this.pick(RADIO.lines.ackUrgent), { ...this.vars(inc, u), eta: this.eta(u, inc) }, 3, false, RADIO.stagger);
    }
    for (const c of inc.responders) {
      if (inc.arrived.has(c) || Math.hypot(c.x - inc.x, c.y - inc.y) > R.arrive) continue;
      inc.arrived.add(c);
      this.stats.arrived++;
      if (!inc.onScene && c !== inc.reporter) {
        inc.onScene = true;
        inc.quietSince = Math.max(inc.quietSince, now);
        const lines = RADIO.kinds[inc.kind].onScene ?? RADIO.lines.onScene;
        this.say(c, this.pick(lines), this.vars(inc, c), inc.prio, false);
      }
    }
    // Бой рядом с местом: кто-то из вызванных или любой юнит в радиусе слияния.
    let fighter: Character | null = null;
    for (const c of inc.responders) if (this.fighting(c)) fighter = c;
    if (!fighter) {
      for (const c of this.ctx.entities.near(inc.x, inc.y, R.merge, nearBuf)) {
        if (c.faction === 'cp' && this.fighting(c)) {
          fighter = c;
          break;
        }
      }
    }
    if (fighter) {
      inc.quietSince = now;
      if (!inc.contact && inc.responders.includes(fighter)) this.contact(inc, fighter);
    }
    const s = inc.suspect;
    const done = !!s && (!s.alive || s.law.phase === 'cuffed' || s.law.phase === 'entering' || s.law.phase === 'jailed');
    const calm = now - inc.quietSince;
    if (inc.arrived.size > 0 && (calm > R.calm || (done && calm > 4))) {
      this.close(inc, !s ? 'clear' : !s.alive ? 'killed' : done ? 'arrested' : 'clear');
      return;
    }
    if (now - Math.max(inc.opened, inc.signal) > R.maxTime && calm > 8) {
      if (inc.sent > 0) this.nadzor(this.pick(RADIO.lines.timeout), this.vars(inc, null), inc.responders, inc, inc.prio, true, [0.2, 0.4]);
      this.finish(inc, 'timeout');
    }
  }

  /** Беглец: точка вызова — за ним (с упреждением), перехватчики идут следом. */
  private trackFugitive(inc: Incident): void {
    const s = inc.suspect;
    if (!s || !s.alive || s.law.phase !== 'fleeing') return;
    const sp = Math.hypot(s.vx, s.vy);
    const k = sp > 1 ? RADIO.chase.ahead / sp : 0;
    inc.x = s.x + s.vx * k * 0.5;
    inc.y = s.y + s.vy * k * 0.5;
    for (const c of inc.responders) {
      const call = Radio.callOf(c);
      if (call && call.id === inc.id) {
        call.x = inc.x;
        call.y = inc.y;
      }
    }
  }

  /** Итог на месте: доклад первого прибывшего и отбой Надзора. */
  private close(inc: Incident, result: 'clear' | 'arrested' | 'killed'): void {
    const c = [...inc.arrived].find((u) => u.alive && !u.downed) ?? inc.responders.find((u) => u.alive && !u.downed) ?? null;
    if (c) {
      const lines = result === 'killed' ? RADIO.lines.killed : result === 'arrested' ? RADIO.lines.arrested : RADIO.lines.clear;
      this.say(c, this.pick(lines), this.vars(inc, c), inc.prio, false);
      this.nadzor(this.pick(RADIO.lines.close), this.vars(inc, c), [c], inc, inc.prio, false, RADIO.reply);
    }
    this.finish(inc, result);
  }

  // ───────────────────────────── погоня, задержание, драка ─────────────────────────────

  /** Нарушитель побежал от юнита: доклад с приметами и направлением, перехват. */
  chase(handler: Character, target: Character): void {
    const now = this.now;
    if (!this.enabled || handler.isPlayer || now - this.lastChase < RADIO.chase.every || !this.onNet(target.x, target.y)) return;
    this.lastChase = now;
    this.report('fugitive', target.x, target.y, { reporter: handler, suspect: target, what: 'беглец' });
  }

  /** Юнит упустил беглеца: ориентировка в розыск. */
  chaseLost(handler: Character, target: Character): void {
    if (!this.enabled || handler.isPlayer || !handler.alive) return;
    const inc = this.incidents.find((i) => !i.closed && i.kind === 'fugitive' && i.suspect === target);
    const vars = { ...this.vars(inc ?? this.pseudo(target), handler), suspect: this.describe(target) };
    this.say(handler, this.pick(RADIO.lines.chaseLost), vars, 2, true, RADIO.reportDelay);
    this.nadzor(this.pick(RADIO.lines.chaseLostReply), vars, [handler], null, 2, true, RADIO.reply, target);
    if (inc) this.finish(inc, 'lost');
  }

  /** Задержание: беглеца поймали — «взяли бегуна»; иначе изредка «веду в КПЗ». */
  arrested(handler: Character, target: Character, fled: boolean): void {
    // Слух о задержании: видевшие и родня.
    this.ctx.talk?.event('arrest', target.x, target.y, { who: displayName(target), kinOf: target });
    if (!this.enabled || handler.isPlayer || !handler.alive || handler.faction !== 'cp') return;
    const now = this.now;
    const inc = this.incidents.find((i) => !i.closed && i.suspect === target);
    const vars = this.vars(inc ?? this.pseudo(target), handler);
    if (inc?.kind === 'fugitive' || (fled && now - this.lastArrest >= RADIO.arrest.every)) {
      this.lastArrest = now;
      this.say(handler, this.pick(RADIO.lines.chaseCaught), vars, 2, false, RADIO.reportDelay);
      this.nadzor(this.pick(RADIO.lines.chaseCaughtReply), vars, [handler], null, 1, false, RADIO.reply, handler);
      if (inc) this.finish(inc, 'arrested');
      return;
    }
    if (inc || now - this.lastArrest < RADIO.arrest.every || !this.rng.chance(RADIO.arrest.chance)) return;
    this.lastArrest = now;
    const prison = target.faction === 'rebel';
    this.say(handler, this.pick(prison ? RADIO.lines.arrestPrison : RADIO.lines.arrest), vars, 1, false, RADIO.reportDelay);
    this.nadzor(this.pick(RADIO.lines.arrestReply), vars, [handler], null, 0, false, RADIO.reply, handler);
  }

  /** Юнит разнимает драку. */
  brawl(cp: Character, target: Character): void {
    const now = this.now;
    if (!this.enabled || cp.isPlayer || now - this.lastBrawl < RADIO.brawl.every) return;
    this.lastBrawl = now;
    this.report('brawl', target.x, target.y, { reporter: cp, suspect: target, what: 'драка' });
  }

  /** Место преступления: Надзор посылает следователя, медика или офицера — тот подтверждает. */
  scene(role: 'investigate' | 'examine' | 'guard', u: Character, x: number, y: number): void {
    if (!this.enabled || u.isPlayer || !u.alive || u.faction !== 'cp') return;
    const inc = this.pseudo(null, x, y);
    const lines = role === 'investigate' ? RADIO.lines.sceneInvestigator : role === 'examine' ? RADIO.lines.sceneMedic : RADIO.lines.sceneOfficer;
    const vars = { ...this.vars(inc, u), eta: this.eta(u, inc) };
    this.nadzor(this.pick(lines), vars, [u], null, 1, false, [0.3, 0.8], u);
    this.say(u, this.pick(RADIO.lines.sceneAck), vars, 1, false, RADIO.stagger);
  }

  // ───────────────────────────── фронт и коды ─────────────────────────────

  /**
   * Фронт: юнит гарнизона КПП докладывает, Надзор отвечает. Захват точки, прорыв и отбитая точка — всегда,
   * остальное — не чаще RADIO.front.every на КПП.
   */
  front(event: 'active' | 'capture' | 'lost' | 'breach' | 'retake' | 'ota', f: Front, pt: DPoint | null = null): void {
    // О прорыве и потерянной точке узнаёт весь город.
    if (event === 'breach' || event === 'lost') this.ctx.talk?.event(event === 'breach' ? 'breach' : 'capture', f.apron.x, f.apron.y, { front: frontName(f), big: true });
    if (!this.enabled) return;
    const now = this.now;
    const key = f.index;
    const major = event === 'capture' || event === 'lost' || event === 'breach' || event === 'retake';
    if (!major && now - (this.frontAt.get(key) ?? -1e9) < RADIO.front.every) return;
    this.frontAt.set(key, now);
    const F = RADIO.frontLines;
    const at = pt?.center ?? f.apron;
    const unit = this.frontUnit(f, at.x, at.y);
    const vars: Record<string, string> = { front: frontName(f), point: pt?.name ?? '', unit: unit?.name ?? '' };
    // Сводку фронта WarSystem и так пишет в журнал — переговоры туда только игроку из силового блока или рядом.
    const say = (lines: readonly string[]): void => {
      if (unit) this.say(unit, this.pick(lines), vars, 3, false);
    };
    const nad = (lines: readonly string[]): void => this.nadzor(this.pick(lines), vars, unit ? [unit] : [], { x: at.x, y: at.y }, 3, false, unit ? RADIO.reply : [0.2, 0.5]);
    if (event === 'active') {
      say(F.activeUnit);
      nad(F.activeReply);
    } else if (event === 'capture') {
      say(F.captureUnit);
      nad(F.captureReply);
    } else if (event === 'lost') nad(F.pointLost);
    else if (event === 'breach') nad(F.breach);
    else if (event === 'retake') {
      say(F.retakeUnit);
      nad(F.retakeReply);
    } else nad(F.otaOut);
  }

  /** Объявление Надзора на всю сеть (режим квартала, серия): строка в эфир и в журнал. */
  announce(text: string, prio: number): void {
    if (!this.enabled) {
      this.ctx.law.log(text, 'radio');
      return;
    }
    const p = this.ctx.player;
    this.nadzor(text, {}, [], p ? { x: p.x, y: p.y } : null, prio, true, [0.2, 0.5]);
  }

  /** Код тревоги сменился — вся сеть. */
  code(code: 'green' | 'yellow' | 'red' | 'nexus'): void {
    const p0 = this.ctx.player;
    if (code !== 'green') this.ctx.talk?.event(code === 'nexus' ? 'storm' : code, p0?.x ?? 0, p0?.y ?? 0, { big: true });
    if (!this.enabled) return;
    const F = RADIO.frontLines;
    const lines = code === 'green' ? F.green : code === 'yellow' ? F.yellow : code === 'red' ? F.red : F.nexus;
    const p = this.ctx.player;
    this.nadzor(this.pick(lines), {}, [], p ? { x: p.x, y: p.y } : null, 3, true, [0.2, 0.4]);
  }

  /** Юнит гарнизона КПП ближе всех к точке (жив и на ногах). */
  private frontUnit(f: Front, x: number, y: number): Character | null {
    let best: Character | null = null;
    let bd = Infinity;
    for (const c of this.ctx.entities.list) {
      const b = c.brain;
      if (c.faction !== 'cp' || !c.alive || c.downed || c.isPlayer || !(b instanceof CpBrain) || b.front !== f.index) continue;
      const d = Math.hypot(c.x - x, c.y - y);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  // ───────────────────────────── плановое ─────────────────────────────

  /** Пост сам выходит на связь (живой пост): доклад по делу и «принято». false — эфир занят. */
  checkIn(c: Character): boolean {
    const now = this.now;
    if (!this.enabled || c.isPlayer || now - this.lastCheckIn < RADIO.routine.checkIn || this.queue.length > 2) return false;
    this.lastCheckIn = now;
    this.stats.checkIns++;
    this.say(c, this.status(c), {}, 0, false);
    this.nadzor(this.statusAck(c), this.vars(this.pseudo(null, c.x, c.y), c), [c], null, 0, false, RADIO.reply, c);
    return true;
  }

  /** Перекличка и сводки Надзора по расписанию. */
  private routine(): void {
    const now = this.now;
    if (this.queue.length > 2 || this.ctx.war?.code === 'red') return;
    if (now >= this.nextRollCall) {
      this.nextRollCall = now + this.rng.range(RADIO.routine.rollCall[0], RADIO.routine.rollCall[1]);
      const list = this.ctx.entities.list.filter((c) => c.faction === 'cp' && c.alive && !c.downed && !c.isPlayer && c.brain instanceof CpBrain && !this.fighting(c));
      if (list.length) {
        const c = this.rng.pick(list);
        this.stats.rollCalls++;
        this.nadzor(this.pick(RADIO.routineLines.rollCall), { unit: c.name }, [c], null, 0, false, [0.1, 0.3], c);
        this.say(c, this.status(c), {}, 0, false, RADIO.reply);
        this.nadzor(this.statusAck(c), this.vars(this.pseudo(null, c.x, c.y), c), [c], null, 0, false, RADIO.reply, c);
      }
      return;
    }
    if (now >= this.nextInfo) {
      this.nextInfo = now + this.rng.range(RADIO.routine.info[0], RADIO.routine.info[1]);
      const info = this.info();
      if (info) this.nadzor(info.text, info.vars, [], null, 0, true, [0.1, 0.3]);
    }
  }

  /** Сводка по обстановке: розыск, ночь, раздача, фронт, вакансии, вызовы за смену. */
  private info(): { text: string; vars: Record<string, string | number> } | null {
    const { ctx } = this;
    const R = RADIO.routineLines;
    const opts: { text: string; vars: Record<string, string | number> }[] = [];
    const wanted = ctx.entities.list.filter((c) => c.alive && c.law.wanted && !FACTIONS[c.faction].authority).length;
    if (wanted >= 2) opts.push({ text: this.pick(R.infoWanted), vars: { n: wanted } });
    if (ctx.routine?.night) opts.push({ text: this.pick(R.infoNight), vars: {} });
    if (ctx.economy.open) opts.push({ text: this.pick(R.infoRations), vars: {} });
    const hot = ctx.war?.fronts.find((f) => ctx.war.active(f));
    if (hot) opts.push({ text: this.pick(R.infoFront), vars: { front: frontName(hot) } });
    const vac = ctx.staffing?.vacancies().length ?? 0;
    if (vac >= 3) opts.push({ text: this.pick(R.infoVacancy), vars: { n: vac } });
    if (this.stats.incidents >= 5) opts.push({ text: this.pick(R.infoIncidents), vars: { n: this.stats.incidents } });
    if (!opts.length) opts.push({ text: this.pick(R.infoQuiet), vars: {} });
    return this.rng.pick(opts);
  }

  /** Что юнит ответит на «доложите обстановку» — по тому, чем он занят. */
  status(c: Character): string {
    const S = RADIO.routineLines.status;
    const b = c.brain as CpBrain;
    const zone = this.ctx.map.zoneAtWorld(c.x, c.y);
    const vars: Record<string, string | number> = { unit: c.name, where: whereOf(zone), zone: zone?.name ?? 'город', n: b.squad + 1 };
    const cur = b.fsm.current;
    let lines: readonly string[];
    if (b.front >= 0) {
      const f = this.ctx.war?.fronts[b.front];
      vars.front = f ? frontName(f) : 'КПП';
      lines = f && this.ctx.war.active(f) ? S.frontHot : S.front;
    } else if (cur === 'fight') lines = S.fight;
    else if (cur === 'chase') lines = S.chase;
    else if (cur === 'escort') lines = S.escort;
    else if (cur === 'check' || cur === 'approach') lines = S.check;
    else if (cur === 'scene' || cur === 'scan') lines = S.scene;
    else if (cur === 'resupply') lines = S.resupply;
    else if (cur === 'convoy' || b.duty === 'convoy') lines = S.convoy;
    else if (cur === 'formation') lines = S.formation;
    else if (cur === 'medic' || cur === 'heal') lines = S.medic;
    else if (cur === 'hunt') lines = S.hunt;
    else if (b.duty === 'sentry' || b.duty === 'jailer' || b.duty === 'qm') lines = S.guard;
    else if (b.guardPost) {
      const busy = this.ctx.entities.near(c.x, c.y, 160, nearBuf).filter((o) => o.alive && !FACTIONS[o.faction].authority).length >= 4;
      lines = this.ctx.routine?.night ? S.postNight : busy ? S.postBusy : S.post;
    } else if (b.duty === 'squad' && b.lead) lines = S.squad;
    else if (cur === 'duty') lines = S.duty;
    else if (cur === 'patrol' || cur === 'patrol-again') lines = S.patrol;
    else lines = S.other;
    return fmt(this.pick(lines), vars);
  }

  /** «Принято» Надзора — с поправкой на обстановку (ночь, код жёлтый, недавний вызов рядом). */
  private statusAck(c: Character): string {
    const R = RADIO.routineLines;
    const recent = this.incidents.find((i) => this.now - i.opened < 240 && Math.hypot(i.x - c.x, i.y - c.y) < 1200);
    if (recent && this.rng.chance(0.5)) return fmt(this.pick(R.statusAckRecent), { unit: c.name, where: recent.where });
    if (this.ctx.war?.code === 'yellow' && this.rng.chance(0.5)) return fmt(this.pick(R.statusAckYellow), { unit: c.name });
    if (this.ctx.routine?.night && this.rng.chance(0.4)) return fmt(this.pick(R.statusAckNight), { unit: c.name });
    return fmt(this.pick(R.statusAck), { unit: c.name });
  }

  // ───────────────────────────── эфир ─────────────────────────────

  /** Реплика юнита в эфир (очередь). */
  private say(from: Character, tpl: string, vars: VarsSrc, prio: number, log: boolean, delay: readonly [number, number] = [0, 0]): void {
    this.push({ ready: this.now + this.rng.range(delay[0], delay[1]), pushed: this.now, from, tpl, vars, to: [], x: from.x, y: from.y, prio, log });
  }

  /** Надзор в эфир: показать над адресатами (to), слушателями рядом и игроком из силового блока. */
  private nadzor(tpl: string, vars: VarsSrc, to: Character[], at: { x: number; y: number } | null, prio: number, log: boolean, delay: readonly [number, number] = [0, 0], unit: Character | null = null): void {
    const p = at ?? to[0] ?? this.ctx.player ?? { x: 0, y: 0 };
    const src: VarsSrc = unit ? () => {
      const v = typeof vars === 'function' ? vars() : vars;
      return 'unit' in v ? v : { ...v, unit: unit.name };
    } : vars;
    this.push({ ready: this.now + this.rng.range(delay[0], delay[1]), pushed: this.now, from: null, tpl, vars: src, to: to.filter(Boolean), x: p.x, y: p.y, prio, log });
  }

  /** В очередь; очередь длинная — выпадает самое неважное (из равных — самое старое). */
  private push(m: Queued): void {
    this.queue.push(m);
    while (this.queue.length > RADIO.maxQueue) {
      let k = 0;
      for (let i = 1; i < this.queue.length; i++) if (this.queue[i].prio < this.queue[k].prio) k = i;
      this.queue.splice(k, 1);
    }
  }

  private duration(text: string): number {
    const S = RADIO.show;
    return Math.min(S.max, S.base + S.perChar * text.length);
  }

  /**
   * Одна частота: следующая реплика — когда эфир свободен и ей пора, строго по порядку (доклад → вызов →
   * подтверждения). Залежавшаяся мелочь (дольше RADIO.stale с) выпадает — новости уже не новость.
   */
  private flush(): void {
    const now = this.now;
    const S = RADIO.stale;
    while (this.queue.length) {
      const m = this.queue[0];
      if (now - m.pushed > (m.prio >= 3 ? S.urgent : m.prio === 0 ? S.routine : S.normal)) {
        this.queue.shift();
        continue;
      }
      if (now < this.busyUntil || m.ready > now) return;
      this.queue.shift();
      const text = fmt(m.tpl, typeof m.vars === 'function' ? m.vars() : m.vars);
      if (this.air(m, text)) this.busyUntil = now + Math.min(RADIO.show.max, this.duration(text)) * RADIO.slot + RADIO.gap;
    }
  }

  /** Выход в эфир: облачко над говорящим (или над слушателями Надзора), журнал. false — промолчал. */
  private air(m: Queued, text: string): boolean {
    const { ctx } = this;
    const now = this.now;
    const dur = this.duration(text);
    const p = ctx.player;
    const cpPlayer = !!p && p.alive && FACTIONS[p.faction].authority && !p.cadet;
    let x = m.x;
    let y = m.y;
    if (m.from) {
      // Мёртвые и лежащие молчат.
      if (!m.from.alive || m.from.downed) return false;
      m.from.say(text, now, dur, 'radio');
      x = m.from.x;
      y = m.from.y;
    } else {
      const shown: Character[] = [];
      for (const c of m.to) {
        if (shown.length >= RADIO.listeners.max) break;
        if (c.alive && !c.downed && !shown.includes(c)) shown.push(c);
      }
      // Игрок из силового блока слышит важное (и что адресовано ему).
      if (cpPlayer && p && !shown.includes(p) && m.prio >= 2) shown.push(p);
      // Остальным — из рации юнита рядом с игроком (как полицейская рация в GTA).
      if (p && !cpPlayer) {
        const l = this.listener(p.x, p.y);
        if (l && !shown.includes(l)) shown.push(l);
      }
      for (const c of shown) c.say(text, now, dur, 'dispatch');
    }
    this.stats.lines++;
    const t: Transmission = { seq: ++this.seq, at: now, from: m.from, text, x, y };
    this.feed.push(t);
    if (this.feed.length > RADIO.feedMax) this.feed.splice(0, this.feed.length - RADIO.feedMax);
    const near = !!p && (m.from ? Math.hypot(m.from.x - p.x, m.from.y - p.y) < RADIO.hear : !!this.listener(p.x, p.y));
    if (m.log || cpPlayer || near) {
      const who = m.from ? m.from.name : 'Надзор';
      ctx.law.log(text.includes(who) ? text : `${who}: ${text}`, 'radio');
    }
    return true;
  }

  /** Юнит силового блока рядом с точкой (его рацию слышно), видимый игроку. */
  private listener(x: number, y: number): Character | null {
    let best: Character | null = null;
    let bd: number = RADIO.listeners.radius;
    for (const c of this.ctx.entities.near(x, y, bd, nearBuf)) {
      if (c.faction !== 'cp' || !c.alive || c.downed || c.isPlayer || !c.visible) continue;
      const d = Math.hypot(c.x - x, c.y - y);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  // ───────────────────────────── слова ─────────────────────────────

  private pick<T>(list: readonly T[]): T {
    return this.rng.pick(list);
  }

  /** Подстановки для происшествия. */
  private vars(inc: Incident | PseudoIncident, unit: Character | null, units: readonly Character[] = 'responders' in inc ? inc.responders : []): Record<string, string | number> {
    const def = 'kind' in inc ? RADIO.kinds[inc.kind] : null;
    const v: Record<string, string | number> = {
      where: inc.where, zone: inc.zone, what: inc.what || 'происшествие', code: def?.code ?? 'код 10',
      units: callsigns(units) || 'ближайшие', by: inc.reporter?.name ?? 'пост', suspect: inc.desc || this.describe(inc.suspect),
      victim: inc.victim?.name ?? 'юнит', dir: inc.dirText || this.dirOf(inc.suspect), ahead: this.aheadOf(inc.suspect, inc.where),
    };
    if (unit) v.unit = unit.name;
    return v;
  }

  /** «Происшествие» без происшествия — для слов о месте (погоня, задержание, место преступления). */
  private pseudo(c: Character | null, x = c?.x ?? 0, y = c?.y ?? 0): PseudoIncident {
    const zone = this.ctx.map.zoneAtWorld(x, y);
    return { x, y, where: whereOf(zone), zone: zone?.name ?? 'город', what: '', reporter: null, suspect: c, victim: null };
  }

  /** Приметы: кто на вид, чем вооружён, в розыске ли. */
  describe(c: Character | null): string {
    const S = RADIO.suspect;
    if (!c) return S.unknown;
    const female = isFemaleName(displayName(c));
    const gang = !c.disguised ? this.ctx.gangs?.of(c) : null;
    const fac = apparentFaction(c);
    const pair = gang ? S.bandit : fac === 'citizen' ? S.citizen : fac === 'cwu' ? S.cwu : fac === 'vort' ? S.vort : fac === 'rebel' ? S.rebel : S.other;
    let s = pair[female ? 1 : 0].replace('{gang}', gang?.def.name ?? '');
    const w = c.weapon ? WEAPONS[c.weapon] : null;
    if (w && w.class !== 'melee') s += (female ? S.armedF : S.armed).replace('{weapon}', S.weapons[w.class] ?? w.name);
    if (c.law.wanted) s += S.wanted;
    return s;
  }

  /** Куда бежит: сторона света по скорости. */
  private dirOf(c: Character | null): string {
    if (!c || Math.hypot(c.vx, c.vy) < 10) return 'дворами';
    const a = Math.atan2(c.vy, c.vx);
    const k = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
    return RADIO.dirs[k];
  }

  /** Где перехватить: место впереди беглеца. */
  private aheadOf(c: Character | null, fallback: string): string {
    if (!c) return fallback;
    const sp = Math.hypot(c.vx, c.vy);
    if (sp < 10) return fallback;
    const x = c.x + (c.vx / sp) * RADIO.chase.ahead;
    const y = c.y + (c.vy / sp) * RADIO.chase.ahead;
    return whereOf(this.ctx.map.zoneAtWorld(x, y));
  }

  /** «Буду через…» по расстоянию. */
  private eta(u: Character, at: { x: number; y: number }): string {
    const E = RADIO.eta;
    const L = RADIO.etaLines;
    const t = Math.hypot(u.x - at.x, u.y - at.y) / RADIO.speedGuess;
    if (t < E.near) return this.pick(L.near);
    if (t < E.half) return this.pick(L.half);
    if (t < E.minute) return this.pick(L.minute);
    return fmt(this.pick(L.far), { n: Math.max(2, Math.round(t / 60)) }).toLowerCase();
  }
}

/** Параметры доклада: что, кто доложил (только Протекторат), подозреваемый, пострадавший, приметы со слов свидетелей. */
export interface ReportOpts {
  what?: string;
  reporter?: Character | null;
  suspect?: Character | null;
  victim?: { name: string } | null;
  desc?: string;
  dirText?: string;
  /** Сколько юнитов слать (иначе — по виду происшествия). */
  units?: number;
}

interface PseudoIncident {
  x: number;
  y: number;
  where: string;
  zone: string;
  what: string;
  reporter: Character | null;
  suspect: Character | null;
  victim: { name: string } | null;
  desc?: string;
  dirText?: string;
}

const nearBuf: Character[] = [];
