import type { Input } from './Input';
import type { Camera } from './Camera';
import type { EventBus } from './EventBus';
import type { Character } from '../entities/Character';
import type { AiContext } from '../ai/AiContext';
import type { CheckChoice } from '../ui/CheckPanel';
import { CHARACTER } from '../config/entities';
import { LAW } from '../config/law';
import { FACTIONS } from '../config/factions';
import { poiWorld, equipKit, cpKit } from '../systems/Population';
import { WEAPONS } from '../config/items';
import { COMBAT } from '../config/combat';
import type { RepairSpot } from '../systems/EconomySystem';

const near: Character[] = [];

/** Дистанция взаимодействия (E, F), px. */
const REACH = 48;

/**
 * Управление игроком: движение и взгляд, E — терминал найма, F — действие роли
 * (у ГО: проверить документы у того, кто перед вами), 1/2/3 — решение по проверке.
 * Если игрок задержан (у него временно есть мозг PrisonerBrain), ввод движения игнорируется.
 */
export class PlayerController {
  /** Идёт проверка документов, начатая игроком-ГО. */
  private check: { target: Character; until: number } | null = null;
  /** Чинит ли игрок (ГСР) поломку. */
  private repairing: RepairSpot | null = null;
  private healCooldown = 0;

  constructor(
    private readonly input: Input,
    private readonly camera: Camera,
    private readonly bus: EventBus,
    private readonly hooks: {
      openRoleMenu(): void;
      menuOpen(): boolean;
      openShop(): void;
      toggleInventory(): void;
      placeBarrier(): string | null;
      checkPanelTarget(): Character | null;
      closeCheckPanel(choice: CheckChoice): void;
    },
  ) {}

  reset(): void {
    this.check = null;
    this.repairing = null;
  }

  private say(text: string, kind: 'system' | 'world' | 'law' = 'system'): void {
    this.bus.emit('log', { text, kind });
  }

  update(p: Character, ctx: AiContext, dt: number): void {
    const i = this.input;
    const law = p.law;
    this.healCooldown -= dt;
    if (!p.alive) {
      p.wantX = p.wantY = 0;
      return;
    }
    const locked = !!p.brain || law.phase === 'checking' || this.hooks.menuOpen();
    if (locked) {
      if (!p.brain) p.wantX = p.wantY = 0;
      p.aiming = false;
    } else {
      let mx = (i.isDown('right') ? 1 : 0) - (i.isDown('left') ? 1 : 0);
      let my = (i.isDown('down') ? 1 : 0) - (i.isDown('up') ? 1 : 0);
      const len = Math.hypot(mx, my);
      if (len > 0) {
        mx /= len;
        my /= len;
      }
      // Прицеливание (ПКМ): медленный шаг, бег невозможен; конус сужается.
      const aw = p.weapon ? WEAPONS[p.weapon] : null;
      p.aiming = i.aimDown && !!aw && aw.mode !== 'melee';
      const speed = p.aiming ? CHARACTER.walkSpeed * aw!.aimMove : i.isDown('run') ? CHARACTER.runSpeed : CHARACTER.walkSpeed;
      p.wantX = mx * speed;
      p.wantY = my * speed;
      if (i.mouseInside) {
        const m = this.camera.screenToWorld(i.mouseX, i.mouseY);
        p.facing = Math.atan2(m.y - p.y, m.x - p.x);
      } else if (len > 0) p.facing = Math.atan2(my, mx);
    }
    if (i.wasPressed('inventory')) this.hooks.toggleInventory();
    if (this.hooks.menuOpen() || p.brain) return;

    // Смена оружия: Q — следующее (после последнего — убрать), H — убрать.
    if (i.wasPressed('nextWeapon')) this.cycleWeapon(p, ctx);
    if (i.wasPressed('holster') && p.weapon) {
      ctx.combat.equip(p, null);
      this.say('Оружие убрано.');
    }
    // Стрельба: автомат — пока зажата кнопка, остальное — по клику; дубинка — удар.
    const w = p.weapon ? WEAPONS[p.weapon] : null;
    if (w && i.mouseInside && (w.mode === 'auto' ? i.mouseDown : i.mousePressed)) {
      const m = this.camera.screenToWorld(i.mouseX, i.mouseY);
      if (w.ammo && p.mag <= 0 && !ctx.combat.reloading(p)) {
        if (!ctx.combat.reload(p) && i.mousePressed) this.say('Нет патронов.');
      } else ctx.combat.fire(p, m.x, m.y);
    }
    if (i.wasPressed('reload') && w?.ammo && !ctx.combat.reload(p) && ctx.combat.reserveAmmo(p) <= 0 && p.mag < w.magazine) this.say('Нет запасных патронов.');
    if (i.wasPressed('interact')) this.interact(p, ctx);
    if (i.wasPressed('roleAction')) this.roleAction(p, ctx);
    if (i.wasPressed('special')) this.special(p, ctx);
    if (this.repairing) {
      const r = this.repairing;
      if (Math.hypot(r.x - p.x, r.y - p.y) > 36) {
        this.repairing = null;
        this.say('Ремонт прерван — отошли слишком далеко.');
      } else if (ctx.economy.repairStep(p, r, dt)) this.repairing = null;
    }
    if (this.hooks.checkPanelTarget()) {
      if (i.wasPressed('choice1')) this.hooks.closeCheckPanel('release');
      else if (i.wasPressed('choice2')) this.hooks.closeCheckPanel('fine');
      else if (i.wasPressed('choice3')) this.hooks.closeCheckPanel('arrest');
    }
    this.updateCheck(p, ctx);
    // Игрок-ГО догнал беглеца — задержание.
    if (FACTIONS[p.faction].authority) {
      for (const o of ctx.entities.near(p.x, p.y, LAW.catchDistance, near)) {
        if (o !== p && o.law.handler === p && o.law.phase === 'fleeing') ctx.law.arrest(p, o, 'resisting');
      }
    }
  }

  /** Q: следующее оружие из инвентаря; после последнего — убрать. */
  private cycleWeapon(p: Character, ctx: AiContext): void {
    const list = ctx.combat.weaponsOf(p);
    if (list.length === 0) return this.say('Оружия нет.');
    const k = p.weapon ? list.indexOf(p.weapon) : -1;
    const next = k + 1 < list.length ? list[k + 1] : null;
    ctx.combat.equip(p, next);
    this.say(next ? `В руках: ${WEAPONS[next].name}.` : 'Оружие убрано.');
  }

  /** E: взаимодействие с ближайшим — терминал, магазин, тело, раздача, ремонт, оружейная. */
  private interact(p: Character, ctx: AiContext): void {
    const eco = ctx.economy;
    const d = (q: { x: number; y: number } | null) => (q ? Math.hypot(q.x - p.x, q.y - p.y) : Infinity);
    const terminal = poiWorld(ctx, 'recruit_terminal');
    if (d(terminal) < REACH) return this.hooks.openRoleMenu();
    if (d(eco.shopCounter) < REACH + 8) return this.hooks.openShop();
    const corpse = ctx.combat.corpseNear(p.x, p.y, REACH);
    if (corpse) {
      const n = ctx.combat.loot(p, corpse);
      return this.say(n > 0 ? `Обыскали тело: ${corpse.name}.` : 'Инвентарь полон.');
    }
    // ГСР: встать на выдачу / выдать следующему.
    if (p.faction === 'cwu' && eco.open && d(eco.dispenserSpot) < REACH) {
      if (eco.dispenser !== p) {
        if (!eco.claimDispenser(p)) return this.say('На выдаче уже стоит работник.');
        return this.say('Вы на выдаче рационов. E — выдать следующему в очереди.', 'world');
      }
      const served = eco.serveNext(p);
      return this.say(served ? `Выдано: ${served.name}. +2 токена` : 'Очередь пуста или первый ещё не подошёл.', 'world');
    }
    if (p.faction === 'cwu') {
      const spot = eco.repairs.find((r) => r.broken && d(r) < REACH);
      if (spot) {
        if (!p.inventory.has('toolkit')) return this.say('Нужен набор инструментов (есть в магазине ГСР).');
        this.repairing = spot;
        return this.say('Ремонт… не отходите 5 секунд.', 'world');
      }
    }
    // Очередь за рационом.
    if (eco.open && d(eco.window) < 200 && p.faction !== 'cp') {
      if (eco.hasBeenServed(p)) return this.say('Вы уже получили рацион в эту раздачу.');
      const n = eco.joinQueue(p);
      return this.say(n >= 0 ? `Вы в очереди за рационом: ${n + 1}-й. Подойдите к отметке у окна.` : 'Очередь заполнена — подождите.', 'world');
    }
    // ГО: пополнить боекомплект у стойки дежурного.
    const desk = poiWorld(ctx, 'nexus_desk');
    if (p.faction === 'cp' && d(desk) < REACH * 1.5) {
      const weapon = p.weapon;
      equipKit(p, cpKit(p.division), ctx);
      if (weapon) ctx.combat.equip(p, weapon);
      return this.say('Боекомплект пополнен.', 'world');
    }
    this.say('Рядом нечего использовать. E работает у терминала найма, прилавка ГСР, окна раздачи, поломок и тел.');
  }

  /** G: умение специализации ГО. */
  private special(p: Character, ctx: AiContext): void {
    if (p.faction !== 'cp') return this.say('Умение (G) есть у ГО: HELIX лечит, GRID ставит бетонный блок.');
    if (p.division === 'helix') {
      if (this.healCooldown > 0) return;
      let best: Character | null = null;
      for (const o of ctx.entities.near(p.x, p.y, COMBAT.healRange + 12, near)) {
        if (o !== p && o.alive && o.health < o.maxHealth && (!best || o.health < best.health)) best = o;
      }
      const target = best ?? (p.health < p.maxHealth ? p : null);
      if (!target || !ctx.combat.heal(target, COMBAT.healAmount)) return this.say('Некого лечить рядом.');
      this.healCooldown = COMBAT.healCooldown;
      return this.say(target === p ? 'Вы перевязались.' : `Вы подлечили: ${target.name}.`, 'world');
    }
    if (p.division === 'grid') {
      const err = this.hooks.placeBarrier();
      return this.say(err ?? 'Бетонный блок установлен (не больше трёх).', err ? 'system' : 'world');
    }
    this.say(p.division === 'jury' ? 'JURY: проверки CID идут быстрее, штрафы выше (F).' : 'UNION: патруль, проверки CID (F).');
  }

  /** F: у ГО — проверка документов у ближайшего, кто перед игроком. */
  private roleAction(p: Character, ctx: AiContext): void {
    if (p.faction !== 'cp') {
      this.bus.emit('log', { text: 'Действие роли (F) пока есть только у ГО: проверка CID.', kind: 'system' });
      return;
    }
    if (this.check || this.hooks.checkPanelTarget()) return;
    let best: Character | null = null;
    let bestScore = Infinity;
    for (const o of ctx.entities.near(p.x, p.y, REACH + 12, near)) {
      if (o === p || FACTIONS[o.faction].authority || o.law.phase !== 'none') continue;
      const d = Math.hypot(o.x - p.x, o.y - p.y);
      let a = Math.atan2(o.y - p.y, o.x - p.x) - p.facing;
      while (a > Math.PI) a -= Math.PI * 2;
      while (a < -Math.PI) a += Math.PI * 2;
      const score = d + Math.abs(a) * 30;
      if (Math.abs(a) < 1.2 && score < bestScore) {
        bestScore = score;
        best = o;
      }
    }
    if (!best) {
      this.bus.emit('log', { text: 'Перед вами некого проверять — подойдите ближе и посмотрите на человека.', kind: 'system' });
      return;
    }
    ctx.law.order(p, best, 'routine');
    if (best.law.phase === 'fleeing') {
      this.bus.emit('log', { text: `${best.name} убегает! Догоните, чтобы задержать.`, kind: 'law' });
      return;
    }
    ctx.law.beginCheck(p, best);
    this.check = { target: best, until: ctx.law.now + LAW.checkTime * (p.division === 'jury' ? LAW.juryCheckMul : 1) };
  }

  private updateCheck(p: Character, ctx: AiContext): void {
    const c = this.check;
    if (!c) return;
    if (c.target.law.handler !== p || c.target.law.phase !== 'checking') {
      this.check = null;
      return;
    }
    if (ctx.law.now < c.until) return;
    this.check = null;
    this.bus.emit('law:checkResult', { target: c.target, verdict: ctx.law.judge(c.target) });
  }

  /** Решение игрока-ГО по проверке. */
  resolve(p: Character, target: Character, choice: CheckChoice, ctx: AiContext): void {
    if (target.law.handler !== p) return;
    const verdict = ctx.law.judge(target);
    if (choice === 'arrest') ctx.law.apply(p, target, { kind: 'arrest', reason: verdict.reason, fine: 0 });
    else if (choice === 'fine') ctx.law.apply(p, target, { kind: 'fine', reason: verdict.reason, fine: verdict.fine || LAW.fines.running });
    else ctx.law.apply(p, target, { kind: 'ok', reason: verdict.reason, fine: 0 });
    if (choice === 'arrest') this.bus.emit('log', { text: 'Отведите задержанного к свободной камере КПЗ в Нексусе — он идёт за вами.', kind: 'system' });
  }
}
