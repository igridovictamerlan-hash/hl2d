import type { Character } from '../entities/Character';
import type { AiContext } from '../ai/AiContext';
import type { Vec2 } from '../core/math';
import type { ItemId } from '../config/items';
import { LABOR } from '../config/labor';
import { LOYALTY } from '../config/loyalty';
import { FACTIONS } from '../config/factions';
import { T } from '../world/tiles';
import { adjustLoyalty } from './Loyalty';

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
 * Работы профессий: завод рационов (фасовщик собирает коробки), доставка коробок к будке раздачи
 * (курьер пополняет склад будки — без него раздача встаёт), мусор на улицах (уборщик и вортигонты
 * убирают за плату, отбросы и воры роются), лечение у медика ГСР за плату.
 */
export class LaborSystem {
  /** Конвейер завода (где фасуют) и склад завода (откуда берут коробки). */
  readonly factory: Vec2 | null;
  readonly factoryStore: Vec2 | null;
  /** Куда курьер сдаёт коробки (у будки раздачи, в стороне от очереди). */
  readonly boothDrop: Vec2;
  boxes: number = LABOR.factory.startBoxes;
  readonly trash: TrashPile[] = [];
  /** Кто фасует прямо сейчас и прогресс коробки (у каждого свой). */
  private packing = new Map<Character, number>();
  private trashTimer: number;
  private nextTrashId = 1;
  private time = 0;
  private lastEmptyNotice = -1e9;
  /** Счётчики (тесты, отладка). */
  stats = { packed: 0, delivered: 0, cleaned: 0, searched: 0, healed: 0 };

  constructor(private readonly ctx: AiContext) {
    const { map, nav, rng } = ctx;
    const ts = map.tileSize;
    const yard = map.poisOf('industrial_yard')[0];
    if (yard) {
      const a = nav.nearestWalkable((yard.x + 0.5) * ts, (yard.y + 0.5) * ts, 6);
      this.factory = a >= 0 ? { x: nav.worldX(a), y: nav.worldY(a) } : null;
      const b = this.factory ? nav.nearestWalkable(this.factory.x + 40, this.factory.y + 8, 6) : -1;
      this.factoryStore = b >= 0 ? { x: nav.worldX(b), y: nav.worldY(b) } : this.factory;
    } else {
      this.factory = this.factoryStore = null;
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

  // ——— Завод и доставка ———

  /** Фасовщик у конвейера: вызывать каждый тик работы. true — собрал коробку. */
  packStep(c: Character, dt: number): boolean {
    if (!this.factory || this.boxes >= LABOR.factory.maxBoxes) return false;
    const p = (this.packing.get(c) ?? 0) + dt;
    this.ctx.economy.markWorked(c);
    if (p < LABOR.factory.packTime) {
      this.packing.set(c, p);
      return false;
    }
    this.packing.set(c, 0);
    this.boxes++;
    this.stats.packed++;
    c.money += LABOR.factory.pay;
    adjustLoyalty(c, LOYALTY.points.cwuWork, 'работа ГСР', this.ctx.bus);
    if (c.isPlayer) this.say(`Коробка рационов собрана (на складе завода: ${this.boxes}). +${LABOR.factory.pay} токенов`);
    return true;
  }

  /** Прогресс фасовки персонажа 0..1 (полоска игрока). */
  packProgress(c: Character): number {
    return (this.packing.get(c) ?? 0) / LABOR.factory.packTime;
  }

  stopPacking(c: Character): void {
    this.packing.delete(c);
  }

  /** Курьер берёт коробку со склада завода. */
  takeBox(c: Character): boolean {
    if (c.carrying || this.boxes <= 0) return false;
    this.boxes--;
    c.carrying = true;
    return true;
  }

  /** Курьер сдаёт коробку у будки: рационы на склад будки, оплата. */
  deliverBox(c: Character): boolean {
    const eco = this.ctx.economy;
    if (!c.carrying || eco.rationStock >= LABOR.booth.maxStock) return false;
    c.carrying = false;
    eco.rationStock = Math.min(LABOR.booth.maxStock, eco.rationStock + LABOR.factory.boxRations);
    this.stats.delivered++;
    c.money += LABOR.booth.pay;
    eco.markWorked(c);
    adjustLoyalty(c, LOYALTY.points.cwuWork, 'работа ГСР', this.ctx.bus);
    if (c.isPlayer) this.say(`Коробка сдана: на складе будки ${eco.rationStock} рационов. +${LABOR.booth.pay} токенов`);
    return true;
  }

  /** Нужна ли доставка (на складе будки есть место и на заводе есть коробки). */
  get deliveryNeeded(): boolean {
    return this.boxes > 0 && this.ctx.economy.rationStock + LABOR.factory.boxRations <= LABOR.booth.maxStock;
  }

  /** Сообщение: рационы на складе будки кончились (не чаще emptyNoticeEvery). */
  noticeEmpty(): void {
    if (this.time - this.lastEmptyNotice < LABOR.emptyNoticeEvery) return;
    this.lastEmptyNotice = this.time;
    this.ctx.bus.emit('log', { text: 'ГСР: на складе будки кончились рационы — курьеры, доставьте коробки с завода!', kind: 'world' });
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

  // ——— Медик ГСР ———

  /**
   * Медик ГСР лечит пациента: гражданин платит (нет денег — не лечит), сотрудники Альянса —
   * бесплатно. Возвращает текст ошибки или null.
   */
  treat(medic: Character, patient: Character): string | null {
    const M = LABOR.medic;
    if (!patient.alive || patient.health >= patient.maxHealth) return 'Лечить некого.';
    const free = FACTIONS[patient.faction].authority;
    if (!free && patient.money < M.fee) return `${patient.name}: нет ${M.fee} токенов на лечение.`;
    if (!medic.inventory.remove('bandage', 1) && !medic.inventory.remove('medkit', 1)) return 'Нет бинтов и аптечек.';
    this.ctx.combat.heal(patient, M.heal);
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

  update(dt: number): void {
    this.time += dt;
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
    for (const c of this.packing.keys()) if (!c.alive || !this.factory || Math.hypot(c.x - this.factory.x, c.y - this.factory.y) > 48) this.packing.delete(c);
    // Курьер погиб или задержан с коробкой — коробка пропала.
  }
}
