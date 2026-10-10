import type { AiContext } from '../ai/AiContext';
import type { Character } from '../entities/Character';
import type { Stimulus } from './Senses';
import type { Case } from './Suspects';
import type { Rng } from '../core/rng';
import { ESCALATION } from '../config/escalation';
import { FACTIONS } from '../config/factions';
import { whereOf } from '../world/places';
import { fmt } from './Radio';
import { CitizenBrain } from '../ai/brains/CitizenBrain';

/** Ступень квартала: 0 — обычно, 1 — усиленный патруль, 2 — проверки всех, 3 — комендантский час. */
export type Tier = 0 | 1 | 2 | 3;

/**
 * Квартал помнит (config/escalation.ts): страх района у жителей (Senses — каждый раздражитель в зоне) и внимание ВС
 * (Suspects — известные ВС преступления). Ступени ВС по кварталу растут от одиночного случая к серии и спадают,
 * когда тихо: усиленный патруль (вызовы по рации — прочёсывание квартала), проверки всех (CID чаще, посты у
 * выходов), серия по городу — код жёлтый (держится, пока серия) и комендантский час в квартале (штраф на улице,
 * жители — по домам). Жители обходят страшные кварталы, лавки там закрываются, робкие переезжают. Своя
 * случайность (rng.fork).
 */
export class Escalation {
  enabled = true;
  private readonly fear: Float32Array;
  private readonly fearAt: Float32Array;
  private readonly heat: Float32Array;
  private readonly heatAt: Float32Array;
  readonly tier: Uint8Array;
  private readonly curfewSince: Float32Array;
  private readonly patrolAt: Float32Array;
  /** Когда квартал стал страшным для дома (переезд). */
  private readonly dangerSince: Float32Array;
  /** Известные ВС убийства: время и зона. */
  private readonly kills: { t: number; zone: number }[] = [];
  /** Сколько убийств дела уже учтено (новые — в серию). */
  private readonly counted = new WeakMap<Case, number>();
  /** Дела, по которым уже учтено нападение (без убийства). */
  private readonly assaulted = new WeakSet<Case>();
  private readonly rng: Rng;
  private timer = 0;
  private moveAt = 0;
  /** Кварталы, которых жители избегают: кэш объединения с базовым набором (версия меняется при пересчёте). */
  private feared = new Set<number>();
  private version = 0;
  private readonly avoidCache = new WeakMap<ReadonlySet<number>, { v: number; set: ReadonlySet<number> }>();
  /** Код жёлтый держится, пока по городу серия. */
  serial = false;
  readonly stats = { notes: 0, tierUps: 0, patrols: 0, moves: 0, serial: 0, curfews: 0 };

  constructor(private readonly ctx: AiContext) {
    const n = Math.max(1, ctx.map.zones.length);
    this.fear = new Float32Array(n);
    this.fearAt = new Float32Array(n);
    this.heat = new Float32Array(n);
    this.heatAt = new Float32Array(n);
    this.tier = new Uint8Array(n);
    this.curfewSince = new Float32Array(n).fill(-1);
    this.patrolAt = new Float32Array(n).fill(-1e9);
    this.dangerSince = new Float32Array(n).fill(-1);
    this.rng = ctx.rng.fork(0xe5ca1);
  }

  private get now(): number {
    return this.ctx.law.now;
  }

  private zoneAt(x: number, y: number): number {
    return this.ctx.map.zoneAtWorld(x, y)?.id ?? -1;
  }

  /** Страх района сейчас (лениво спадает). */
  zoneFear(z: number): number {
    if (z < 0 || z >= this.fear.length || this.fear[z] <= 0) return 0;
    return this.fear[z] * 0.5 ** ((this.now - this.fearAt[z]) / ESCALATION.fear.halfLife);
  }

  /** Внимание ВС к кварталу сейчас. */
  zoneHeat(z: number): number {
    if (z < 0 || z >= this.heat.length || this.heat[z] <= 0) return 0;
    return this.heat[z] * 0.5 ** ((this.now - this.heatAt[z]) / ESCALATION.heat.halfLife);
  }

  fearAtPoint(x: number, y: number): number {
    return this.zoneFear(this.zoneAt(x, y));
  }

  private addFear(z: number, v: number): void {
    if (z < 0 || z >= this.fear.length || v <= 0) return;
    this.fear[z] = Math.min(ESCALATION.fear.max, this.zoneFear(z) + v);
    this.fearAt[z] = this.now;
  }

  private addHeat(z: number, v: number): void {
    if (z < 0 || z >= this.heat.length || v <= 0) return;
    this.heat[z] = this.zoneHeat(z) + v;
    this.heatAt[z] = this.now;
  }

  // ───────────────────────────── события ─────────────────────────────

  /** Раздражитель (Senses): квартал запоминает страх. Пересказы крика — почти не в счёт. */
  note(s: Stimulus): void {
    if (!this.enabled || !this.ctx.war.inCity(s.x, s.y)) return;
    const F = ESCALATION.fear as unknown as Record<string, number>;
    const v = (F[s.kind] ?? 0) * (s.hop > 0 ? 0.3 : 1);
    if (v <= 0) return;
    this.stats.notes++;
    this.addFear(this.zoneAt(s.x, s.y), v);
  }

  /** ВС узнал о преступлении (донос, видел сам, экспертиза): внимание к кварталу, учёт убийств серии. */
  caseKnown(cs: Case, _first: boolean): void {
    if (!this.enabled) return;
    const H = ESCALATION.heat;
    const before = this.counted.get(cs) ?? 0;
    const fresh = cs.kills - before;
    const assault = this.assaulted.has(cs);
    if (fresh > 0) {
      this.counted.set(cs, cs.kills);
      for (let i = 0; i < fresh; i++) this.kills.push({ t: this.now, zone: cs.zone });
      // Нападение того же дела уже учтено — убийство добавляет только разницу.
      const already = assault && before === 0 ? H.assault : 0;
      this.addHeat(cs.zone, H.murder * fresh - already + (cs.kills >= 2 ? H.serial : 0));
    } else if (before === 0 && !assault && cs.kind === 'assault') {
      this.assaulted.add(cs);
      this.addHeat(cs.zone, H.assault);
    }
    this.timer = 0;
  }

  // ───────────────────────────── ступени ─────────────────────────────

  update(dt: number): void {
    if (!this.enabled) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = ESCALATION.every;
    const now = this.now;
    const T = ESCALATION.tiers;
    while (this.kills.length && now - this.kills[0].t > T.window) this.kills.shift();
    const cityKills = this.kills.length;
    this.serial = cityKills >= T.serialKills;
    // Кварталы, которых избегают.
    const feared = new Set<number>();
    let anyCurfew = false;
    for (let z = 0; z < this.tier.length; z++) {
      const f = this.zoneFear(z);
      if (f >= ESCALATION.avoid) feared.add(z);
      if (f >= ESCALATION.move.at) {
        if (this.dangerSince[z] < 0) this.dangerSince[z] = now;
      } else this.dangerSince[z] = -1;
      const h = this.zoneHeat(z);
      if (h <= 0.5 && this.tier[z] === 0) continue;
      const zk = this.kills.reduce((n, k) => n + (k.zone === z ? 1 : 0), 0);
      let t: 0 | 1 | 2 | 3 = 0;
      if (h >= T.patrol) t = 1;
      if (h >= T.lockdown || zk >= T.zoneKills) t = 2;
      if ((this.serial && zk >= 1) || h >= T.curfew) t = 3;
      if (t !== this.tier[z]) this.setTier(z, t as Tier);
      if (t === 3) anyCurfew = true;
      if (t >= 1 && now - this.patrolAt[z] >= ESCALATION.patrol.every) {
        this.patrolAt[z] = now;
        this.patrol(z, t as Tier);
      }
    }
    if (!sameSet(feared, this.feared)) {
      this.feared = feared;
      this.version++;
    }
    // Серия — код жёлтый (держит WarSystem.holdYellow, пока серия идёт).
    if ((this.serial || anyCurfew) && this.ctx.war.code === 'green') {
      this.stats.serial++;
      const k = this.kills[this.kills.length - 1];
      const z = k ? k.zone : 0;
      const p = this.zonePoint(z);
      if (p) this.ctx.war.raiseAlarm(p.x, p.y, 'серия убийств', true, { kind: 'serial', radio: false });
    }
    if (now >= this.moveAt) {
      this.moveAt = now + ESCALATION.move.every;
      this.moveOut();
    }
  }

  private setTier(z: number, t: Tier): void {
    const prev = this.tier[z] as Tier;
    this.tier[z] = t;
    const zone = this.ctx.map.zones[z];
    if (!zone) return;
    const L = ESCALATION.lines;
    const vars = { zone: zone.name, where: whereOf(zone), what: t >= 3 ? 'серия убийств' : t === 2 ? 'убийства в квартале' : 'нападение' };
    if (t > prev) {
      this.stats.tierUps++;
      if (t === 3) {
        this.curfewSince[z] = this.now;
        this.stats.curfews++;
      }
      const text = fmt(L.up[t - 1], vars);
      this.ctx.radio?.announce(text, 3);
      this.ctx.talk?.event(t === 3 ? 'serial' : 'district', this.zonePoint(z)?.x ?? 0, this.zonePoint(z)?.y ?? 0, { what: vars.what, big: t >= 2, radius: 900 });
      if (this.ctx.player && this.zoneAt(this.ctx.player.x, this.ctx.player.y) === z) {
        this.ctx.bus.emit('announce', { text: `${zone.name}: ${ESCALATION.labels[t]}` });
      }
    } else {
      if (t < 3) this.curfewSince[z] = -1;
      if (t === 0) this.ctx.radio?.announce(fmt(this.rng.pick(L.down), vars), 1);
    }
  }

  /** Усиленный патруль: юниты по рации — прочесать квартал (ступень 2 — у выходов). */
  private patrol(z: number, t: Tier): void {
    const p = this.zonePoint(z);
    if (!p) return;
    this.stats.patrols++;
    const units = ESCALATION.patrol.units[t];
    this.ctx.radio?.report('district', p.x, p.y, { what: ESCALATION.labels[t], units });
  }

  /** Случайная точка квартала (проходимая). */
  zonePoint(z: number): { x: number; y: number } | null {
    const list = this.ctx.nav.anchorsByZone.get(z);
    if (!list || !list.length) return null;
    const a = this.rng.pick(list);
    return { x: this.ctx.nav.worldX(a), y: this.ctx.nav.worldY(a) };
  }

  /** Переезд: робкий одинокий житель из страшного квартала съезжает в свободное жильё подальше. */
  private moveOut(): void {
    const { ctx } = this;
    const M = ESCALATION.move;
    const now = this.now;
    const housing = ctx.housing;
    if (!housing) return;
    for (const c of ctx.entities.list) {
      if (!c.alive || c.isPlayer || c.family >= 0 || c.gang >= 0 || c.home < 0 || !(c.brain instanceof CitizenBrain) || c.faction !== 'citizen') continue;
      const d = housing.of(c);
      if (!d) continue;
      const z = this.zoneAt(d.at.x, d.at.y);
      if (z < 0 || this.dangerSince[z] < 0 || now - this.dangerSince[z] < M.after) continue;
      if ((ctx.relations?.persona(c).brave ?? 0.5) > M.maxBrave) continue;
      const nd = housing.pick(housing.prefsOf(c), null, (o) => this.zoneFear(this.zoneAt(o.at.x, o.at.y)) < ESCALATION.avoid && Math.hypot(o.at.x - d.at.x, o.at.y - d.at.y) > 500);
      if (!nd) return;
      housing.evict(c);
      housing.settle([c], nd);
      this.stats.moves++;
      const zone = ctx.map.zones[z];
      ctx.law.log(fmt(this.rng.pick(ESCALATION.lines.move), { who: c.name, where: whereOf(zone ?? null) }), 'world');
      return;
    }
  }

  // ───────────────────────────── запросы ─────────────────────────────

  /** Ступень квартала в точке. */
  tierAt(x: number, y: number): Tier {
    const z = this.zoneAt(x, y);
    return z >= 0 && z < this.tier.length ? (this.tier[z] as Tier) : 0;
  }

  /** Множитель плановых проверок CID в точке. */
  checkMul(x: number, y: number): number {
    return this.enabled ? ESCALATION.checkMul[this.tierAt(x, y)] : 1;
  }

  /** Комендантский час в квартале действует (после отсрочки) в этой точке. */
  curfewAt(x: number, y: number): boolean {
    const z = this.zoneAt(x, y);
    return this.enabled && z >= 0 && this.tier[z] === 3 && this.curfewSince[z] >= 0 && this.now - this.curfewSince[z] > ESCALATION.curfewGrace;
  }

  /** Житель должен сидеть дома: комендантский час в квартале, где он сейчас или где его дом. */
  curfewFor(c: Character): boolean {
    if (!this.enabled || FACTIONS[c.faction].authority) return false;
    if (this.tierAt(c.x, c.y) === 3) return true;
    const d = this.ctx.housing?.of(c);
    return !!d && this.tierAt(d.at.x, d.at.y) === 3;
  }

  /** Нарушает ли комендантский час квартала (ВС — штраф и «по домам»). */
  curfewViolation(c: Character): boolean {
    return this.curfewAt(c.x, c.y) && c.alive && !FACTIONS[c.faction].authority && c.law.phase === 'none' && this.ctx.war.outdoors(c);
  }

  /** Избегаемые зоны: базовый набор плюс страшные кварталы (кэш — не новый Set на каждый путь). */
  avoidFor(base: ReadonlySet<number>): ReadonlySet<number> {
    if (!this.enabled || !this.feared.size) return base;
    const c = this.avoidCache.get(base);
    if (c && c.v === this.version) return c.set;
    const set = new Set(base);
    for (const z of this.feared) set.add(z);
    this.avoidCache.set(base, { v: this.version, set });
    return set;
  }

  /** Страшно ли в квартале точки: 0 — нет, 1 — неспокойно, 2 — опасно. */
  dread(x: number, y: number): 0 | 1 | 2 {
    const f = this.fearAtPoint(x, y);
    return f >= ESCALATION.fear.danger ? 2 : f >= ESCALATION.fear.uneasy ? 1 : 0;
  }

  /** Подпись квартала для игрока (баннер зоны, карта): режим ВС или «неспокойно/опасно». */
  label(z: number): string {
    if (!this.enabled || z < 0 || z >= this.tier.length) return '';
    const t = this.tier[z];
    if (t > 0) return ESCALATION.labels[t];
    const f = this.zoneFear(z);
    return f >= ESCALATION.fear.danger ? ESCALATION.fearLabels.danger : f >= ESCALATION.fear.uneasy ? ESCALATION.fearLabels.uneasy : '';
  }

  /** Держать ли код жёлтый (серия убийств идёт). */
  get holdYellow(): boolean {
    return this.enabled && this.serial;
  }
}

function sameSet(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}
