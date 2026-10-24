/** Описание системы — docs/economy.md. */
import type { Character } from '../entities/Character';
import type { AiContext } from '../ai/AiContext';
import type { Vec2 } from '../core/math';
import type { ItemId } from '../config/items';
import { LABOR } from '../config/labor';
import { LOYALTY } from '../config/loyalty';
import { FACTIONS } from '../config/factions';
import { T } from '../world/tiles';
import { adjustLoyalty } from './Loyalty';
import { createCharacter } from '../entities/factory';
import { poiWorld } from './Population';
import { CrematorBrain } from '../ai/brains/CrematorBrain';

/** Куча мусора на улице. */
export interface TrashPile {
  id: number;
  x: number;
  y: number;
  /** Кто сейчас убирает (NPC-уборщик бронирует кучу). */
  worker: Character | null;
  /** В ней уже рылись. */
  searched: boolean;
  /** Прогресс уборки, с. */
  progress: number;
  /** Форма (для отрисовки). */
  seed: number;
}

/**
 * Работы профессий: доставка коробок рационов со склада штаба ТС (товар с барж — systems/Port) к будке
 * раздачи (курьер пополняет склад будки — без него раздача встаёт), мусор на улицах (уборщик и поднадзорные
 * убирают за плату, отбросы и воры роются), лечение у медика ТС за плату.
 */
export class LaborSystem {
  /** Куда курьер сдаёт коробки (у будки раздачи, в стороне от очереди). */
  readonly boothDrop: Vec2;
  readonly trash: TrashPile[] = [];
  private trashTimer: number;
  private nextTrashId = 1;
  private time = 0;
  private lastEmptyNotice = -1e9;
  /** Счётчики (тесты, отладка). */
  stats = { delivered: 0, cleaned: 0, searched: 0, healed: 0, paperwork: 0 };
  /** Столы канцелярии Управы (бумажная работа лоялистов) и кто за каким сидит. */
  readonly desks: { x: number; y: number; who: Character | null }[] = [];
  /** Санитар (синтет, сжигает тела) и когда выпустить следующего из Управы. */
  /** Санитары на улицах; сколько их (LABOR.cremator.count × множитель населения — Population). */
  readonly cremators: Character[] = [];
  crematorCount: number = LABOR.cremator.count;
  private crematorAt = 0;

  /** Первый живой санитар (для тестов и подсказок). */
  get cremator(): Character | null {
    return this.cremators.find((c) => c.alive) ?? null;
  }

  constructor(private readonly ctx: AiContext) {
    const { map, nav, rng } = ctx;
    const ts = map.tileSize;
    for (const d of map.poisOf('clerk_desk')) {
      // Место за столом — клетка под ним (стол нарисован на тайле POI и чуть ниже).
      const a = nav.nearestWalkable((d.x + 0.5) * ts, (d.y + 1.5) * ts, 2);
      if (a >= 0) this.desks.push({ x: nav.worldX(a), y: nav.worldY(a), who: null });
    }
    // Место сдачи коробок — сбоку от окна раздачи (перпендикулярно очереди).
    const eco = ctx.economy;
    const side = { x: -eco.queueDir.y, y: eco.queueDir.x };
    const d = nav.nearestWalkable(eco.window.x + side.x * 40 + eco.queueDir.x * 20, eco.window.y + side.y * 40 + eco.queueDir.y * 20, 5);
    this.boothDrop = d >= 0 ? { x: nav.worldX(d), y: nav.worldY(d) } : { ...eco.window };
    this.trashTimer = rng.range(LABOR.trash.every[0], LABOR.trash.every[1]);
    for (let k = 0; k < LABOR.trash.start; k++) this.spawnTrash();
  }

  get now(): number {
    return this.time;
  }

  // ——— Доставка к будке раздачи ———

  /** Курьер сдаёт коробку у будки: рационы на склад будки, оплата. */
  deliverBox(c: Character): boolean {
    const eco = this.ctx.economy;
    if (!c.carrying || (c.load.some((r) => r.item === 'ration') && eco.rationStock >= LABOR.booth.maxStock)) return false;
    c.carrying = false;
    // Рационы — в будку (что не влезло — обратно на склад ТС), прочее из коробки — тоже на склад.
    const port = this.ctx.supply;
    for (const cr of c.load) {
      const put = cr.item === 'ration' ? Math.min(cr.qty, LABOR.booth.maxStock - eco.rationStock) : 0;
      eco.rationStock += put;
      if (cr.qty > put) port.giveBack(cr.item, cr.qty - put);
    }
    c.load = [];
    this.stats.delivered++;
    c.money += LABOR.booth.pay;
    eco.markWorked(c);
    adjustLoyalty(c, LOYALTY.points.cwuWork, 'работа ТС', this.ctx.bus);
    if (c.isPlayer) this.say(`Коробка сдана: на складе будки ${eco.rationStock} рационов. +${LABOR.booth.pay} токенов`);
    return true;
  }

  /** Нужна ли доставка (в будке есть место под коробку и на складе ТС есть рационы). */
  get deliveryNeeded(): boolean {
    return this.ctx.supply.count('ration') > 0 && this.ctx.economy.rationStock + LABOR.booth.boxRations <= LABOR.booth.maxStock;
  }

  /** Коробка рационов для будки: сколько влезет, не больше boxRations. */
  boothBox(): { item: 'ration'; qty: number }[] {
    const room = LABOR.booth.maxStock - this.ctx.economy.rationStock;
    return [{ item: 'ration', qty: Math.max(1, Math.min(LABOR.booth.boxRations, room)) }];
  }

  /** Сообщение: рационы на складе будки кончились (не чаще emptyNoticeEvery). */
  noticeEmpty(): void {
    if (this.time - this.lastEmptyNotice < LABOR.emptyNoticeEvery) return;
    this.lastEmptyNotice = this.time;
    this.ctx.bus.emit('log', { text: 'ТС: в будке раздачи кончились рационы — курьеры, несите коробки со склада штаба ТС!', kind: 'world' });
  }

  // ——— Мусор ———

  private spawnTrash(): void {
    const { map, nav, rng } = this.ctx;
    const ts = map.tileSize;
    const kinds = new Set(['residential', 'avenue', 'plaza', 'industrial']);
    for (let tries = 0; tries < 60; tries++) {
      const a = rng.pick(nav.walkable);
      const tx = nav.ax(a) + 1;
      const ty = nav.ay(a) + 1;
      const t = map.tileAt(tx, ty);
      if (t !== T.FLOOR && t !== T.STREET && t !== T.PLAZA) continue;
      if (!kinds.has(map.zoneAtTile(tx, ty)?.kind ?? '') || map.levelAt(tx * ts, ty * ts) !== 'city') continue;
      const x = nav.worldX(a) + rng.range(-5, 5);
      const y = nav.worldY(a) + rng.range(-5, 5);
      if (this.trash.some((p) => Math.hypot(p.x - x, p.y - y) < LABOR.trash.spacing * ts)) continue;
      this.trash.push({ id: this.nextTrashId++, x, y, worker: null, searched: false, progress: 0, seed: rng.int(0, 1e9) });
      return;
    }
  }

  /** Ближайшая куча (свободная для уборки, если free). */
  nearestTrash(x: number, y: number, free = false, maxD = Infinity): TrashPile | null {
    let best: TrashPile | null = null;
    let bestD = maxD;
    for (const p of this.trash) {
      if (free && p.worker) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  /** Уборка: вызывать каждый тик, пока рядом. true — убрано. */
  cleanStep(c: Character, pile: TrashPile, dt: number): boolean {
    if (!this.trash.includes(pile)) return true;
    pile.worker = c;
    pile.progress += dt;
    if (c.faction === 'cwu') this.ctx.economy.markWorked(c);
    if (pile.progress < LABOR.trash.cleanTime) return false;
    this.trash.splice(this.trash.indexOf(pile), 1);
    this.stats.cleaned++;
    c.money += LABOR.trash.pay;
    if (c.faction === 'cwu') adjustLoyalty(c, LOYALTY.points.cwuWork, 'уборка улиц', this.ctx.bus);
    if (c.isPlayer) this.say(`Мусор убран. +${LABOR.trash.pay} токенов`);
    return true;
  }

  /** Порыться в куче: находка по весам (отброс общества находит чаще). */
  search(c: Character, pile: TrashPile): ItemId | null {
    if (pile.searched) return null;
    pile.searched = true;
    this.stats.searched++;
    const L = LABOR.trash;
    const chance = c.profession === 'outcast' ? L.outcastFindChance : L.findChance;
    if (!this.ctx.rng.chance(chance)) return null;
    const total = L.loot.reduce((s, [, w]) => s + w, 0);
    let r = this.ctx.rng.range(0, total);
    for (const [id, w] of L.loot) {
      if ((r -= w) <= 0) {
        const qty = id === 'ammo_pistol' ? 6 : 1;
        return c.inventory.add(id, qty) > 0 ? id : null;
      }
    }
    return null;
  }

  // ——— Медик ТС ———

  /**
   * Медик ТС лечит пациента: гражданин платит (нет денег — не лечит), сотрудники Протектората —
   * бесплатно. Возвращает текст ошибки или null.
   */
  treat(medic: Character, patient: Character): string | null {
    const M = LABOR.medic;
    if (!patient.alive || (patient.health >= patient.maxHealth && patient.bleed <= 0)) return 'Лечить некого.';
    const free = FACTIONS[patient.faction].authority;
    if (!free && patient.money < M.fee) return `${patient.name}: нет ${M.fee} токенов на лечение.`;
    if (!medic.inventory.remove('bandage', 1) && !medic.inventory.remove('medkit', 1)) return 'Нет бинтов и аптечек.';
    this.ctx.combat.heal(patient, M.heal);
    this.ctx.relations?.event('help', medic, patient);
    if (!free) {
      patient.money -= M.fee;
      medic.money += M.fee;
    }
    this.ctx.economy.markWorked(medic);
    this.stats.healed++;
    return null;
  }

  private say(text: string): void {
    this.ctx.bus.emit('log', { text, kind: 'world' });
  }

  /**
   * Санитары выходят из Управы по одному (через LABOR.cremator.stagger с), пока их меньше count; погиб —
   * замена через respawn с.
   */
  private ensureCremator(): void {
    const L = LABOR.cremator;
    for (let i = this.cremators.length - 1; i >= 0; i--) {
      if (this.cremators[i].alive) continue;
      this.cremators.splice(i, 1);
      this.crematorAt = Math.max(this.crematorAt, this.time + L.respawn);
    }
    if (this.cremators.length >= this.crematorCount || this.time < this.crematorAt || this.ctx.war.code === 'red') return;
    const gate = poiWorld(this.ctx, 'nexus_gate');
    if (!gate) return;
    const a = this.ctx.nav.nearestWalkable(gate.x, gate.y, 6);
    if (a < 0) return;
    const c = createCharacter(this.ctx.entities, this.ctx.rng, 'ota', this.ctx.nav.worldX(a), this.ctx.nav.worldY(a));
    c.name = `Санитар-${this.ctx.rng.int(10, 99)}`;
    c.profession = 'cremator';
    c.inventory.clear();
    c.brain = new CrematorBrain(c, this.ctx);
    this.cremators.push(c);
    this.crematorAt = this.time + L.stagger;
  }

  update(dt: number): void {
    this.time += dt;
    this.ensureCremator();
    this.trashTimer -= dt;
    if (this.trashTimer <= 0) {
      this.trashTimer = this.ctx.rng.range(LABOR.trash.every[0], LABOR.trash.every[1]);
      if (this.trash.length < LABOR.trash.max) this.spawnTrash();
    }
    for (const p of this.trash) {
      if (p.worker && (!p.worker.alive || Math.hypot(p.worker.x - p.x, p.worker.y - p.y) > 40)) {
        p.worker = null;
      }
    }
    // Курьер погиб или задержан с коробкой — коробка пропала.
  }

  /** Занять свободный стол канцелярии (или null). */
  claimDesk(c: Character): { x: number; y: number } | null {
    // Занят — только если сидящий жив и всё ещё на бумажной работе (прервали — стол свободен).
    const busy = (who: Character | null) => !!who && who !== c && who.alive && (who.isPlayer || (who.brain as { job?: { kind?: string } | null } | null)?.job?.kind === 'paper');
    const d = this.desks.find((k) => !busy(k.who));
    if (!d) return null;
    d.who = c;
    return d;
  }

  releaseDesk(c: Character): void {
    for (const d of this.desks) if (d.who === c) d.who = null;
  }

  /** Отработал очередной отрезок бумажной работы: оплата и лояльность. */
  payPaperwork(c: Character): void {
    const P = LABOR.paperwork;
    c.money += P.pay;
    adjustLoyalty(c, P.loyalty, 'бумажная работа для Администрации', c.isPlayer ? this.ctx.bus : undefined);
    this.stats.paperwork++;
  }
}
