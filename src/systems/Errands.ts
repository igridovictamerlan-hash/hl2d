import type { AiContext } from '../ai/AiContext';
import type { Character } from '../entities/Character';
import type { Dwelling } from './Housing';
import type { NoticeBoard } from './StreetLife';
import { ERRANDS } from '../config/errands';
import { adjustLoyalty } from './Loyalty';

export interface Errand {
  secret: boolean;
  to: Dwelling;
  name: string;
  zone: string;
  until: number;
}

const fill = (s: string, v: Record<string, string | number>): string => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''));

/**
 * Поручения у досок объявлений — игра за гражданского: отнести посылку жителю в другой конец города.
 * Тайная посылка подполья — контрабанда (предмет `parcel_x`): ГО находит её при проверке CID
 * (LawSystem.judge → `found`). Только для игрока.
 */
export class Errands {
  active: Errand | null = null;
  private nextAt = 0;
  readonly stats = { taken: 0, done: 0, secret: 0, failed: 0 };

  constructor(private readonly ctx: AiContext) {}

  canTake(p: Character): boolean {
    return (ERRANDS.factions as readonly string[]).includes(p.faction);
  }

  /** Доска объявлений рядом (для E). */
  boardAt(p: Character): NoticeBoard | null {
    const b = this.ctx.street?.boardNear(p);
    return b && Math.hypot(b.stand.x - p.x, b.stand.y - p.y) < ERRANDS.reach ? b : null;
  }

  /** Взять поручение у доски: текст для журнала (или отказ). */
  take(p: Character, board: NoticeBoard): string {
    const { ctx } = this;
    const now = ctx.law.now;
    if (!this.canTake(p)) return 'Объявления: «Требуются… граждане». Вам тут ничего не предложат.';
    if (this.active) return `У вас уже есть поручение: ${this.active.name} (${this.active.zone}).`;
    if (now < this.nextAt) return 'На доске пока ничего нового. Загляните позже.';
    const E = ERRANDS;
    const lowLoyal = p.loyalty < E.secret.lowLoyalty;
    const secret = ctx.rng.chance(lowLoyal ? E.secret.lowLoyaltyChance : E.secret.chance);
    const target = this.pickTarget(board, secret);
    if (!target) return 'Объявления старые, адресов не разобрать.';
    const item = secret ? 'parcel_x' : 'parcel';
    if (!p.inventory.add(item, 1)) return 'Посылку некуда положить — рюкзак полон.';
    this.active = { secret, to: target.d, name: target.name, zone: target.zone, until: now + E.time };
    this.stats.taken++;
    const lines = secret ? E.lines.secret : E.lines.parcel;
    return fill(ctx.rng.pick(lines), { name: target.name, zone: target.zone, min: Math.round(E.time / 60) });
  }

  private pickTarget(board: NoticeBoard, secret: boolean): { d: Dwelling; name: string; zone: string } | null {
    const { ctx } = this;
    const H = ctx.housing;
    if (!H) return null;
    // Жильцы по домам: кому нести (тайное — явкам подполья, если есть, или неблагонадёжным).
    const byHome = new Map<Dwelling, Character>();
    for (const c of ctx.entities.list) {
      if (c.isPlayer || !c.alive) continue;
      const d = H.of(c);
      if (!d || d.reserved) continue;
      if (secret ? !(d.stash || c.loyalty < ERRANDS.secret.lowLoyalty) : c.faction !== 'citizen' && c.faction !== 'cwu') continue;
      if (!byHome.has(d)) byHome.set(d, c);
    }
    const [lo, hi] = ERRANDS.dist;
    const ok = [...byHome.keys()].filter((d) => {
      const dd = Math.hypot(d.at.x - board.stand.x, d.at.y - board.stand.y);
      return dd >= lo && dd <= hi;
    });
    if (!ok.length) return null;
    const d = ctx.rng.pick(ok);
    const c = byHome.get(d)!;
    const zone = ctx.map.zoneAtWorld(d.at.x, d.at.y)?.name ?? 'город';
    return { d, name: c.name, zone };
  }

  /** Сдать посылку у дома получателя (E): текст или null — не здесь. */
  deliver(p: Character): string | null {
    const a = this.active;
    if (!a || Math.hypot(a.to.at.x - p.x, a.to.at.y - p.y) > ERRANDS.deliver) return null;
    const { ctx } = this;
    const item = a.secret ? 'parcel_x' : 'parcel';
    if (!p.inventory.has(item)) {
      this.active = null;
      return 'Посылки при вас нет — поручение сорвано.';
    }
    p.inventory.remove(item, 1);
    const E = ERRANDS;
    const [lo, hi] = a.secret ? E.secret.pay : E.parcel.pay;
    const pay = Math.round(ctx.rng.range(lo, hi));
    p.money += pay;
    if (!a.secret) adjustLoyalty(p, E.parcel.loyalty, 'поручение', ctx.bus);
    this.active = null;
    this.nextAt = ctx.law.now + E.cooldown;
    this.stats.done++;
    if (a.secret) this.stats.secret++;
    return fill(ctx.rng.pick(a.secret ? E.lines.doneSecret : E.lines.done), { name: a.name, pay });
  }

  /** Просрочка (раз в тик): посылку забирают, лояльность падает. */
  update(p: Character | null): string | null {
    const a = this.active;
    if (!a || !p || this.ctx.law.now < a.until) return null;
    p.inventory.remove(a.secret ? 'parcel_x' : 'parcel', 1);
    if (!a.secret) adjustLoyalty(p, -ERRANDS.late, 'просроченное поручение', this.ctx.bus);
    this.active = null;
    this.nextAt = this.ctx.law.now + ERRANDS.cooldown;
    this.stats.failed++;
    return ERRANDS.lines.late;
  }

  /** ГО нашли свёрток при проверке (LawSystem): поручение сорвано. */
  found(c: Character): void {
    if (!c.isPlayer || !this.active?.secret) return;
    this.active = null;
    this.nextAt = this.ctx.law.now + ERRANDS.cooldown;
    this.stats.failed++;
  }
}
