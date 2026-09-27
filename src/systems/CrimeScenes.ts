import type { AiContext } from '../ai/AiContext';
import type { Character } from '../entities/Character';
import type { Vec2 } from '../core/math';
import type { Corpse } from './CombatSystem';
import { CRIME } from '../config/crime';
import { FACTIONS, CP_UNIT } from '../config/factions';
import { WEAPONS } from '../config/items';
import { CpBrain } from '../ai/brains/CpBrain';
import { lineOfSight } from '../world/visibility';

/** Место преступления: тело ГО в городе, оцепленное лентой на конусах. */
export interface CrimeScene {
  corpse: Corpse;
  x: number;
  y: number;
  /** Радиус оцепления, px. */
  r: number;
  /** Конусы по кругу и отрезки ленты между ними (стена между конусами — ленты нет). */
  cones: Vec2[];
  tape: [number, number][];
  since: number;
  /** Тело осмотрено следователем — оцепление снимут через CRIME.scene.holdAfter с. */
  investigatedAt: number;
  investigator: Character | null;
  officer: Character | null;
  closed: boolean;
}

/**
 * Места преступления (CRIME.scene): Альянс нашёл тело убитого ГО в городе — улицу вокруг
 * перекрывают лентой на конусах, туда едут следователь SU.01 (осмотр тела, убийца — в розыск) и
 * офицер PCU.OFC или инспектор SU.INSP (охраняет оцепление). За ленту не пускают никого, кроме
 * сотрудников Альянса (выталкивает), тело не обыскать — оружие ГО бандитам не достанется. Снимают
 * через holdAfter с после осмотра (или maxTime с, или тело увезли).
 */
export class CrimeScenes {
  readonly list: CrimeScene[] = [];
  readonly stats = { opened: 0, investigated: 0 };
  private time = 0;

  constructor(private readonly ctx: AiContext) {}

  /** Оцепление вокруг тела (если его ещё нет). */
  open(corpse: Corpse): CrimeScene | null {
    const S = CRIME.scene;
    if (this.list.some((s) => !s.closed && (s.corpse === corpse || Math.hypot(s.x - corpse.x, s.y - corpse.y) < s.r))) return null;
    const { map } = this.ctx;
    const cones: Vec2[] = [];
    for (let k = 0; k < S.cones; k++) {
      const a = (k / S.cones) * Math.PI * 2;
      const x = corpse.x + Math.cos(a) * S.radius;
      const y = corpse.y + Math.sin(a) * S.radius;
      // Конус — на полу, лента не проходит сквозь стены.
      if (!map.isSolid(Math.floor(x / map.tileSize), Math.floor(y / map.tileSize)) && lineOfSight(map, corpse.x, corpse.y, x, y)) cones.push({ x, y });
      else cones.push({ x: NaN, y: NaN });
    }
    const tape: [number, number][] = [];
    for (let k = 0; k < cones.length; k++) {
      const a = cones[k];
      const b = cones[(k + 1) % cones.length];
      if (Number.isNaN(a.x) || Number.isNaN(b.x) || !lineOfSight(map, a.x, a.y, b.x, b.y)) continue;
      tape.push([k, (k + 1) % cones.length]);
    }
    const s: CrimeScene = { corpse, x: corpse.x, y: corpse.y, r: S.radius, cones, tape, since: this.time, investigatedAt: -1, investigator: null, officer: null, closed: false };
    this.list.push(s);
    this.stats.opened++;
    this.dispatch(s);
    const zone = map.zoneAtWorld(s.x, s.y)?.name ?? 'город';
    this.ctx.law.log(`Надзор: место преступления — ${zone}. Улица оцеплена; на осмотр — следователь SU и офицер.`, 'radio');
    return s;
  }

  /** Свободный ГО нужного вида, ближайший к месту. */
  private nearest(s: CrimeScene, ok: (c: Character, b: CpBrain) => boolean): Character | null {
    let best: Character | null = null;
    let bestD: number = CRIME.scene.seek;
    for (const c of this.ctx.entities.list) {
      const b = c.brain;
      if (!c.alive || c.isPlayer || !(b instanceof CpBrain) || b.scene || b.guardPost || b.medicStation) continue;
      const st = b.fsm.current;
      if (st === 'fight' || st === 'escort' || st === 'retreat' || st === 'check' || st === 'chase') continue;
      if (this.ctx.map.levelAt(c.x, c.y) !== 'city' || !ok(c, b)) continue;
      const d = Math.hypot(c.x - s.x, c.y - s.y);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  /** Отправить следователя SU.01 и офицера (PCU.OFC или SU.INSP). */
  private dispatch(s: CrimeScene): void {
    const inv = this.nearest(s, (c) => c.rank === CP_UNIT.su1);
    if (inv) {
      s.investigator = inv;
      (inv.brain as CpBrain).assignScene(s, 'investigate');
    }
    const ofc = this.nearest(s, (c) => c.rank === CP_UNIT.ofc || c.rank === CP_UNIT.insp);
    if (ofc) {
      s.officer = ofc;
      (ofc.brain as CpBrain).assignScene(s, 'guard');
    }
  }

  /** Следователь осмотрел тело. */
  investigated(s: CrimeScene): void {
    if (s.investigatedAt >= 0) return;
    s.investigatedAt = this.time;
    this.stats.investigated++;
  }

  /** Тело под оцеплением — обыскать его может только сотрудник Альянса. */
  sealed(corpse: Corpse, who: Character | null = null): boolean {
    if (who && FACTIONS[who.faction].authority) return false;
    return this.list.some((s) => !s.closed && s.corpse === corpse);
  }

  /** Тело под оцеплением (крематору ждать, пока его не снимут). */
  awaiting(corpse: Corpse): boolean {
    return this.list.some((s) => !s.closed && s.corpse === corpse);
  }

  /** Точка внутри какого-нибудь оцепления. */
  inside(x: number, y: number): CrimeScene | null {
    for (const s of this.list) if (!s.closed && Math.hypot(x - s.x, y - s.y) < s.r) return s;
    return null;
  }

  /** Есть ли у тела оружие (бандитам есть что брать). */
  static armed(corpse: Corpse): boolean {
    return corpse.loot.some((st) => st.id in WEAPONS && st.qty > 0);
  }

  /** Снять все оцепления (красный код: не до следствия). */
  closeAll(): void {
    for (const s of this.list) if (!s.closed) this.close(s);
  }

  private close(s: CrimeScene): void {
    s.closed = true;
    for (const c of [s.investigator, s.officer]) (c?.brain as CpBrain | null)?.releaseScene(s);
    this.ctx.law.log(`Надзор: оцепление снято — ${this.ctx.map.zoneAtWorld(s.x, s.y)?.name ?? 'город'}.`, 'radio');
  }

  update(dt: number): void {
    this.time += dt;
    const S = CRIME.scene;
    const { combat, entities } = this.ctx;
    for (const s of this.list) {
      if (s.closed) continue;
      const gone = !combat.corpses.includes(s.corpse);
      // Пока стоит оцепление, тело не исчезает само.
      if (!gone) s.corpse.until = Math.max(s.corpse.until, combat.now + 5);
      const done = s.investigatedAt >= 0 && this.time - s.investigatedAt >= S.holdAfter;
      if (gone || done || this.time - s.since >= S.maxTime) {
        this.close(s);
        continue;
      }
      // Погиб или занят другим — прислать замену.
      if (s.investigatedAt < 0 && (!s.investigator?.alive || (s.investigator.brain as CpBrain | null)?.scene !== s)) {
        s.investigator = null;
        const inv = this.nearest(s, (c) => c.rank === CP_UNIT.su1);
        if (inv) {
          s.investigator = inv;
          (inv.brain as CpBrain).assignScene(s, 'investigate');
        }
      }
      // За ленту — только Альянс: остальных выталкивает к краю оцепления.
      for (const c of entities.near(s.x, s.y, s.r + c0, near)) {
        // Лента держит мирных (горожане, ГСР, вортигонты); вооружённых повстанцев она не остановит.
        if (!c.alive || !CORDONED.has(c.faction) || c.law.phase !== 'none') continue;
        const dx = c.x - s.x;
        const dy = c.y - s.y;
        const d = Math.hypot(dx, dy) || 1;
        const edge = s.r + c.radius;
        if (d >= edge) continue;
        const nx = s.x + (dx / d) * edge;
        const ny = s.y + (dy / d) * edge;
        const ts = this.ctx.map.tileSize;
        if (this.ctx.map.isSolid(Math.floor(nx / ts), Math.floor(ny / ts))) continue;
        c.x = nx;
        c.y = ny;
      }
    }
    for (let i = this.list.length - 1; i >= 0; i--) if (this.list[i].closed) this.list.splice(i, 1);
  }
}

/** Запас на радиус персонажа при поиске тех, кто зашёл за ленту. */
const c0 = 16;
const near: Character[] = [];
/** Кого оцепление не пускает внутрь. */
const CORDONED: ReadonlySet<string> = new Set(['citizen', 'cwu', 'vort']);
