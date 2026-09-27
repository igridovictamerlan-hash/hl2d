import type { AiContext } from '../ai/AiContext';
import type { Character } from '../entities/Character';
import type { Vec2 } from '../core/math';
import { CWU_HQ } from '../config/cwuHq';
import { PROFESSIONS, type ProfessionId } from '../config/professions';
import { KITS } from '../config/items';
import { adjustLoyalty } from './Loyalty';

/**
 * Штаб ГСР у главного проспекта. Приёмная: граждане приходят устраиваться — встают в очередь у
 * стойки найма, глава ГСР выходит к стойке и оформляет (hire.time с): берут туда, где рабочих
 * меньше всего не хватает (hire.needs), мест нет — отказ. Устроившийся становится рабочим ГСР (роль
 * меняется — возрождается уже рабочим). Места перерыва рабочих — комната отдыха и столовая.
 * Инспектор SU.INSP, дойдя до главы, требует отчёт — глава отчитывается.
 */
export class CwuHqSystem {
  /** Есть ли штаб на карте (старые карты — без него). */
  readonly present: boolean;
  /** Стол главы в кабинете (где он сидит). */
  readonly desk: Vec2 | null;
  /** Место главы у стойки найма и место соискателя напротив. */
  readonly counter: Vec2 | null;
  readonly applicantSpot: Vec2 | null;
  /** Куда уходят на перерыв (комната отдыха и столовая) и где обходит глава (цех, отдых). */
  readonly restSpots: Vec2[] = [];
  readonly roundSpots: Vec2[] = [];
  /** Очередь соискателей (первый — у стойки). */
  readonly queue: Character[] = [];
  private progress = 0;
  private lastInspection = -1e9;
  /** Граждан при заселении (город не пустеет: hire.minCitizenShare). */
  citizensAtStart = 0;
  stats = { applied: 0, hired: 0, rejected: 0, inspections: 0 };

  constructor(private readonly ctx: AiContext) {
    const { map, nav } = ctx;
    const ts = map.tileSize;
    const spot = (x: number, y: number, r = 3): Vec2 | null => {
      const a = nav.nearestWalkable(x, y, r);
      return a >= 0 ? { x: nav.worldX(a), y: nav.worldY(a) } : null;
    };
    const head = map.poisOf('cwu_head_desk')[0];
    const hire = map.poisOf('cwu_hire')[0];
    this.present = !!(head && hire);
    // Стол нарисован на тайле точки, стул — клеткой ниже: там и сидят.
    this.desk = head ? spot((head.x + 0.5) * ts, (head.y + 1.5) * ts) : null;
    this.counter = hire ? spot((hire.x + 0.5) * ts, (hire.y + 1.5) * ts) : null;
    this.applicantSpot = this.counter ? spot(this.counter.x, this.counter.y + CWU_HQ.hire.reach + 4) : null;
    const inRoom = (type: 'cwu_lounge' | 'cwu_canteen' | 'cwu_production', out: Vec2[]) => {
      for (const r of map.poisOf(type)) {
        for (let k = 0; k < 4; k++) {
          const p = spot((r.x + (0.2 + 0.2 * k) * r.w!) * ts, (r.y + (k % 2 ? 0.35 : 0.65) * r.h!) * ts, 2);
          if (p) out.push(p);
        }
      }
    };
    inRoom('cwu_lounge', this.restSpots);
    inRoom('cwu_canteen', this.restSpots);
    inRoom('cwu_production', this.roundSpots);
    inRoom('cwu_lounge', this.roundSpots);
  }

  /** Глава ГСР (живой) или null. */
  get head(): Character | null {
    for (const c of this.ctx.entities.list) if (c.alive && c.profession === 'cwu_head') return c;
    return null;
  }

  /** Есть ли вакансия (и кем возьмут). */
  vacancy(): ProfessionId | null {
    const H = CWU_HQ.hire;
    let workers = 0;
    let citizens = 0;
    const count: Partial<Record<ProfessionId, number>> = {};
    for (const c of this.ctx.entities.list) {
      if (!c.alive) continue;
      if (c.faction === 'citizen') citizens++;
      if (c.faction !== 'cwu' || !c.profession) continue;
      workers++;
      count[c.profession] = (count[c.profession] ?? 0) + 1;
    }
    if (workers >= H.maxWorkers || citizens <= this.citizensAtStart * H.minCitizenShare) return null;
    let best: ProfessionId | null = null;
    let bestGap = 0;
    for (const [prof, need] of Object.entries(H.needs) as [ProfessionId, number][]) {
      const gap = need - (count[prof] ?? 0);
      if (gap > bestGap) {
        bestGap = gap;
        best = prof;
      }
    }
    return best;
  }

  /** Встать в очередь к стойке найма. false — очередь полна или штаба нет. */
  apply(c: Character): boolean {
    if (!this.present) return false;
    if (this.queue.includes(c)) return true;
    if (this.queue.length >= CWU_HQ.hire.queueMax) return false;
    this.queue.push(c);
    this.stats.applied++;
    return true;
  }

  leave(c: Character): void {
    const i = this.queue.indexOf(c);
    if (i < 0) return;
    this.queue.splice(i, 1);
    if (i === 0) this.progress = 0;
  }

  /** Где стоять соискателю: первый — напротив стойки, остальные — за ним. */
  queueSpot(c: Character): Vec2 | null {
    const i = this.queue.indexOf(c);
    const a = this.applicantSpot;
    const b = this.counter;
    if (i < 0 || !a || !b) return null;
    const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const k = CWU_HQ.hire.queueGap * i;
    const p = { x: a.x + ((a.x - b.x) / d) * k, y: a.y + ((a.y - b.y) / d) * k };
    const n = this.ctx.nav.nearestWalkable(p.x, p.y, 3);
    return n >= 0 ? { x: this.ctx.nav.worldX(n), y: this.ctx.nav.worldY(n) } : a;
  }

  /** Глава у стойки (оформляет). */
  headAtCounter(head: Character | null = this.head): boolean {
    return !!head && !!this.counter && Math.hypot(head.x - this.counter.x, head.y - this.counter.y) < CWU_HQ.hire.reach;
  }

  update(dt: number): void {
    if (!this.present) return;
    const { ctx } = this;
    const H = CWU_HQ.hire;
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const c = this.queue[i];
      if (!c.alive || c.faction !== 'citizen' || c.law.phase !== 'none') this.leave(c);
    }
    const head = this.head;
    const first = this.queue[0];
    const a = this.applicantSpot;
    if (first && a && this.headAtCounter(head) && Math.hypot(first.x - a.x, first.y - a.y) < H.reach) {
      if (this.progress === 0) first.say(ctx.rng.pick(CWU_HQ.lines.apply), ctx.law.now, 3);
      this.progress += dt;
      if (this.progress >= H.time) {
        this.progress = 0;
        this.queue.shift();
        const prof = this.vacancy();
        if (prof) this.hire(first, prof, head!);
        else {
          this.stats.rejected++;
          head!.say(ctx.rng.pick(CWU_HQ.lines.noVacancy), ctx.law.now, 3);
          if (first.isPlayer) ctx.law.log('Глава ГСР: мест нет, приходите позже.', 'world');
        }
      }
    }
    // Инспектор SU.INSP у главы — отчёт.
    const I = CWU_HQ.inspection;
    if (head && ctx.law.now - this.lastInspection > I.every) {
      for (const o of ctx.entities.near(head.x, head.y, I.reach, near)) {
        const b = o.brain as { duty?: string } | null;
        if (!o.alive || o.faction !== 'cp' || b?.duty !== 'inspector') continue;
        this.lastInspection = ctx.law.now;
        this.stats.inspections++;
        o.say(ctx.rng.pick(CWU_HQ.lines.inspect), ctx.law.now, 3);
        head.say(ctx.rng.pick(CWU_HQ.lines.headReply), ctx.law.now + 1.5, 3);
        ctx.law.log(`${o.name} инспектирует штаб ГСР: ${head.name} отчитывается о выработке.`, 'radio');
        break;
      }
    }
  }

  /** Оформить гражданина рабочим ГСР (NPC и игрок): форма, набор, роль, лояльность. */
  hire(c: Character, prof: ProfessionId, head: Character | null): void {
    const { ctx } = this;
    ctx.economy.leaveQueue(c);
    c.faction = 'cwu';
    c.profession = prof;
    c.rank = 0;
    c.division = null;
    const kit = PROFESSIONS[prof].kit ?? 'cwu';
    for (const [id, qty] of KITS[kit] ?? []) c.inventory.add(id, qty);
    if (c.role) c.role = { ...c.role, kind: 'cwu', faction: 'cwu', profession: prof, division: null, rank: 0, kit, name: c.name, family: undefined };
    adjustLoyalty(c, CWU_HQ.hire.loyalty, 'устройство в ГСР', ctx.bus);
    this.stats.hired++;
    head?.say(ctx.rng.pick(CWU_HQ.lines.hired), ctx.law.now, 3);
    ctx.law.log(`Штаб ГСР: ${c.isPlayer ? 'вы приняты' : `${c.name} принят(а)`} на работу — ${PROFESSIONS[prof].name}.`, c.isPlayer ? 'world' : 'radio');
    if (c.isPlayer) ctx.bus.emit('hired', { who: c, profession: prof });
  }
}

const near: Character[] = [];
