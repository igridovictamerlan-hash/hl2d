import type { Input } from './Input';
import type { Camera } from './Camera';
import type { EventBus } from './EventBus';
import type { Character } from '../entities/Character';
import type { StreetShop } from '../systems/StreetShops';
import type { AiContext } from '../ai/AiContext';
import type { CheckChoice } from '../ui/CheckPanel';
import type { AlertCode } from '../systems/WarSystem';
import { WAR } from '../config/war';
import { CHARACTER } from '../config/entities';
import { LAW } from '../config/law';
import { FACTIONS, cpHas, cpUnit } from '../config/factions';
import { poiWorld, cpKit } from '../systems/Population';
import { WEAPONS, KITS, ITEMS } from '../config/items';
import { UNDERGROUND, INSURGENCY, PARTISANS } from '../config/underground';
import type { Cell } from '../systems/LawSystem';
import { PRISON } from '../config/prison';
import { ECONOMY } from '../config/economy';
import { COMBAT, HITS, MINE } from '../config/combat';
import { DOWNED } from '../config/tactics';
import type { RepairSpot } from '../systems/EconomySystem';
import type { TrashPile } from '../systems/LaborSystem';
import { GRENADE_KINDS, isMedic, type Corpse } from '../systems/CombatSystem';
import { LABOR } from '../config/labor';
import { CWU_HQ } from '../config/cwuHq';
import { CRIME } from '../config/crime';
import { CP_UNITS } from '../config/cpUnits';
import { ARSENAL } from '../config/arsenal';
import { ARBAT } from '../config/arbat';
import { GANGS } from '../config/gangs';
import { isQuartermaster, type DepotAct, type Slot } from '../systems/Arsenal';
import { coverAuthority } from '../entities/cover';
import type { WeaponWheel } from '../ui/WeaponWheel';
import { HUD } from '../config/hud';

const near: Character[] = [];

/** Дистанция взаимодействия (E, F), px. */
const REACH = 48;

/**
 * Управление игроком: движение и взгляд, E — терминал найма, F — действие роли
 * (у ВС: проверить документы у того, кто перед вами), 1/2/3 — решение по проверке.
 * Если игрок задержан (у него временно есть мозг PrisonerBrain), ввод движения игнорируется.
 */
export class PlayerController {
  /** Идёт проверка документов, начатая игроком-ВС. */
  private check: { target: Character; until: number } | null = null;
  /** Чинит ли игрок (ТС) поломку. */
  private repairing: RepairSpot | null = null;
  /** Лезет по люку: сколько осталось и куда. */
  private climbing: { left: number; to: { x: number; y: number }; down: boolean } | null = null;
  /** Саботирует узел Протектората (повстанец). */
  private sabotaging: { spot: RepairSpot; progress: number } | null = null;
  /** Работа у места (фасовка на заводе) и действие с таймером (уборка, поиск в мусоре, взлом, кража). */
  private packing = false;
  private task: { kind: 'clean' | 'search' | 'hack' | 'pick' | 'rob' | 'scan' | 'paper' | 'dress' | 'break' | 'armory' | 'depot' | 'beacon' | 'bench' | 'check' | 'requisition'; x: number; y: number; left: number; total: number; pile?: TrashPile; victim?: Character; corpse?: Corpse; cell?: Cell; act?: DepotAct; slot?: Slot } | null = null;
  /** Откат бунта у игрока-спецагента (G). */
  private riotCooldown = 0;
  private healCooldown = 0;

  constructor(
    private readonly input: Input,
    private readonly camera: Camera,
    private readonly bus: EventBus,
    private readonly hooks: {
      openRoleMenu(): void;
      menuOpen(): boolean;
      openShop(kind: 'cwu' | 'black' | 'street', street?: StreetShop): void;
      toggleInventory(): void;
      placeBarrier(): string | null;
      checkPanelTarget(): Character | null;
      closeCheckPanel(choice: CheckChoice): void;
      openCodePanel(): void;
      codePanelOpen(): boolean;
      chooseCode(code: AlertCode): void;
      closeCodePanel(): void;
      /** Колесо оружия (B1) и замедление мира, пока оно открыто. */
      wheel: WeaponWheel;
      setSlow(on: boolean): void;
      /** Метка на карте (адрес поручения). */
      setMarker(x: number, y: number): void;
    },
  ) {}

  /** Сколько зажата Q, с (-1 — не зажата): коротко — следующее оружие, дольше — колесо. */
  private qHeld = -1;

  /** Закрыть колесо без выбора (умер, упал, открылось меню). */
  private dropWheel(): void {
    this.qHeld = -1;
    if (!this.hooks.wheel.open) return;
    this.hooks.wheel.close();
    this.hooks.setSlow(false);
  }

  reset(): void {
    this.check = null;
    this.repairing = null;
    this.climbing = null;
    this.sabotaging = null;
    this.packing = false;
    this.task = null;
  }

  /** Прогресс текущего действия (люк, саботаж, ремонт) 0..1 — полоска над игроком; null — нет. */
  get progress(): number | null {
    if (this.climbing) return 1 - this.climbing.left / UNDERGROUND.climbTime;
    if (this.task) return 1 - this.task.left / this.task.total;
    if (this.packing && this.laborRef) return this.laborRef.packProgress(this.playerRef!);
    if (this.sabotaging) return this.sabotaging.progress / INSURGENCY.sabotageTime;
    if (this.repairing) return this.repairing.progress / ECONOMY.repairs.time;
    // Перевязка и растяжка — полоска по времени боя.
    const p = this.playerRef;
    const combat = this.combatRef;
    if (p && combat) {
      if (p.reviveUntil > combat.now) {
        const total = p.reviveArrest ? DOWNED.cuffTime : DOWNED.reviveTime * (isMedic(p) ? DOWNED.medicMul : 1);
        return 1 - (p.reviveUntil - combat.now) / total;
      }
      if (p.plantUntil > combat.now) return 1 - (p.plantUntil - combat.now) / MINE.plantTime;
      if (p.bandageUntil > combat.now) return 1 - (p.bandageUntil - combat.now) / HITS.bandageTime;
    }
    return null;
  }

  private say(text: string, kind: 'system' | 'world' | 'law' = 'system'): void {
    this.bus.emit('log', { text, kind });
  }

  private laborRef: AiContext['labor'] | null = null;
  private combatRef: AiContext['combat'] | null = null;
  private playerRef: Character | null = null;

  update(p: Character, ctx: AiContext, dt: number): void {
    const i = this.input;
    this.laborRef = ctx.labor;
    this.playerRef = p;
    this.combatRef = ctx.combat;
    const law = p.law;
    this.healCooldown -= dt;
    this.riotCooldown -= dt;
    if (!p.alive || p.downed) this.dropWheel();
    if (!p.alive) {
      p.wantX = p.wantY = 0;
      return;
    }
    // Поручение просрочено — посылку забирают.
    const late = ctx.errands?.update(p);
    if (late) this.say(late, 'world');
    // Тяжело ранен: ползёт (скорость режет бой), ничего не может; E — не ждать помощи.
    if (p.downed) {
      this.reset();
      p.aiming = false;
      p.crouch = false;
      let mx = (i.isDown('right') ? 1 : 0) - (i.isDown('left') ? 1 : 0);
      let my = (i.isDown('down') ? 1 : 0) - (i.isDown('up') ? 1 : 0);
      const len = Math.hypot(mx, my);
      if (len > 0) {
        mx /= len;
        my /= len;
      }
      p.wantX = mx * CHARACTER.walkSpeed;
      p.wantY = my * CHARACTER.walkSpeed;
      if (len > 0) p.facing = Math.atan2(my, mx);
      if (i.wasPressed('interact')) ctx.combat.kill(p, p.lastAttacker, 'не дождался помощи');
      if (i.wasPressed('inventory')) this.hooks.toggleInventory();
      return;
    }
    // Люк: стоит на месте, по истечении — у парного люка на другом уровне.
    if (this.climbing) {
      p.wantX = p.wantY = 0;
      this.climbing.left -= dt;
      if (this.climbing.left > 0) return;
      const { to, down } = this.climbing;
      this.climbing = null;
      ctx.underground.climb(p, to);
      const zone = ctx.map.zoneAtWorld(p.x, p.y)?.name ?? '';
      this.say(down ? 'Вы спустились в канализацию. E у лестницы — наверх.' : `Вы вылезли из люка — ${zone}.`, 'world');
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
      // C — присесть; побежал — встал.
      if (i.wasPressed('crouch')) p.crouch = !p.crouch;
      const run = i.isDown('run') && len > 0 && !p.aiming;
      if (run) p.crouch = false;
      const speed = p.aiming ? CHARACTER.walkSpeed * aw!.aimMove : run ? CHARACTER.runSpeed : CHARACTER.walkSpeed;
      p.wantX = mx * speed;
      p.wantY = my * speed;
      // Пока открыто колесо оружия, мышь выбирает сектор, а не взгляд.
      if (i.mouseInside && !this.hooks.wheel.open) {
        const m = this.camera.screenToWorld(i.mouseX, i.mouseY);
        p.facing = Math.atan2(m.y - p.y, m.x - p.x);
      } else if (len > 0 && !i.mouseInside) p.facing = Math.atan2(my, mx);
    }
    if (i.wasPressed('inventory')) this.hooks.toggleInventory();
    if (this.hooks.menuOpen() || p.brain) {
      this.dropWheel();
      return;
    }

    // Смена оружия: Q коротко — следующее (после последнего — убрать), зажать — колесо оружия
    // (мир замедлен, мышь — сектор, колесо мыши — ствол в секторе, отпустить — взять); H — убрать.
    const wheel = this.hooks.wheel;
    if (i.isDown('nextWeapon')) {
      this.qHeld = this.qHeld < 0 ? 0 : this.qHeld + dt;
      if (!wheel.open && this.qHeld >= HUD.wheel.hold) {
        wheel.show(p, ctx.combat);
        this.hooks.setSlow(true);
      }
    } else if (this.qHeld >= 0) {
      this.qHeld = -1;
      if (wheel.open) {
        this.hooks.setSlow(false);
        this.applyWheel(p, ctx, wheel.close());
      } else this.cycleWeapon(p, ctx);
    }
    if (wheel.open) {
      wheel.aim(i.mouseX - i.width / 2, i.mouseY - i.height / 2);
      if (i.wheel) wheel.scroll(i.wheel);
    }
    if (i.wasPressed('holster') && p.weapon) {
      ctx.combat.equip(p, null);
      this.say('Оружие убрано.');
    }
    // Без оружия в руках — кулаки (ЛКМ).
    if (!p.weapon && i.mouseInside && !wheel.open && i.mousePressed) {
      const m = this.camera.screenToWorld(i.mouseX, i.mouseY);
      ctx.combat.punch(p, m.x, m.y);
    }
    // Оскорбить того, кто перед вами (O): может начаться драка, ВС потребует документы.
    if (i.wasPressed('insult') && ctx.brawls) {
      const t = ctx.brawls.targetFor(p);
      if (!t) this.say('Рядом никого — оскорблять некого.');
      else {
        const msg = ctx.brawls.insult(p, t);
        if (msg) this.say(msg, 'world');
      }
    }
    // Стрельба: автомат — пока зажата кнопка, остальное — по клику; дубинка — удар.
    const w = p.weapon ? WEAPONS[p.weapon] : null;
    if (w && i.mouseInside && !wheel.open && (w.mode === 'auto' ? i.mouseDown : i.mousePressed)) {
      const m = this.camera.screenToWorld(i.mouseX, i.mouseY);
      if (w.ammo && p.mag <= 0 && !ctx.combat.reloading(p)) {
        if (!ctx.combat.reload(p) && i.mousePressed) this.say('Нет патронов.');
      } else ctx.combat.fire(p, m.x, m.y);
    }
    if (i.wasPressed('grenadeKind')) {
      // Следующая граната из тех, что есть.
      const have = GRENADE_KINDS.filter((g) => p.inventory.has(g));
      if (!have.length) this.say('Гранат нет.');
      else {
        p.grenadeKind = have[(have.indexOf(p.grenadeKind) + 1) % have.length];
        this.say(`Граната: ${ITEMS[p.grenadeKind].name} (${p.inventory.count(p.grenadeKind)}).`);
      }
    }
    if (i.wasPressed('grenade')) {
      if (!GRENADE_KINDS.some((g) => p.inventory.has(g))) this.say('Гранат нет.');
      else if (i.mouseInside) {
        const m = this.camera.screenToWorld(i.mouseX, i.mouseY);
        ctx.combat.throwGrenade(p, m.x, m.y);
      }
    }
    if (i.wasPressed('mine')) {
      const k = ctx.combat.mineKindOf(p);
      if (!k) this.say('Нечем минировать: нужна осколочная или зажигательная граната.');
      else if (!ctx.combat.startPlant(p, k)) this.say('Сейчас не получится — руки заняты.');
      else this.say(`Ставите растяжку (${ITEMS[k].name.toLowerCase()})… не двигайтесь.`);
    }
    if (i.wasPressed('bandage')) {
      if (ctx.combat.bandaging(p)) this.say('Уже перевязываетесь.');
      else if (!ctx.combat.hasDressing(p)) this.say('Нет бинтов и аптечек.');
      else if (!ctx.combat.startBandage(p)) this.say('Перевязывать нечего.');
      else this.say(p.bleed > 0 ? 'Перевязываетесь…' : 'Обрабатываете раны…');
    }
    if (i.wasPressed('reload') && w?.ammo && !ctx.combat.reload(p) && ctx.combat.reserveAmmo(p) <= 0 && p.mag < w.magazine) this.say('Нет запасных патронов.');
    if (i.wasPressed('drag')) this.drag(p, ctx);
    if (i.wasPressed('interact') && !this.rescue(p, ctx)) this.interact(p, ctx);
    if (i.wasPressed('roleAction')) this.roleAction(p, ctx);
    if (i.wasPressed('special')) this.special(p, ctx);
    if (this.sabotaging) {
      const sb = this.sabotaging;
      if (Math.hypot(sb.spot.x - p.x, sb.spot.y - p.y) > 36 || sb.spot.broken) {
        this.sabotaging = null;
        if (!sb.spot.broken) this.say('Саботаж прерван — отошли слишком далеко.');
      } else if ((sb.progress += dt) >= INSURGENCY.sabotageTime) {
        this.sabotaging = null;
        ctx.economy.sabotage(sb.spot, p);
        p.money += INSURGENCY.sabotageReward;
        this.say(`Узел Протектората выведен из строя. Сопротивление платит: +${INSURGENCY.sabotageReward} токенов. Уходите!`, 'world');
      }
    }
    if (this.packing) {
      const f = ctx.labor.stations.find((st) => st.who === p) ?? ctx.labor.factory;
      if (!f || Math.hypot(f.x - p.x, f.y - p.y) > 40) {
        this.packing = false;
        ctx.labor.stopPacking(p);
        ctx.labor.releaseStation(p);
        this.say('Фасовка прервана — отошли от конвейера.');
      } else ctx.labor.packStep(p, dt);
    }
    if (this.task) this.updateTask(p, ctx, dt);
    if (this.repairing) {
      const r = this.repairing;
      if (Math.hypot(r.x - p.x, r.y - p.y) > 36) {
        this.repairing = null;
        this.say('Ремонт прерван — отошли слишком далеко.');
      } else if (ctx.economy.repairStep(p, r, dt)) this.repairing = null;
    }
    // Терминал кодов тревоги: 1 — жёлтый, 2 — красный, 3 — отбой; отошёл — закрыт.
    if (this.hooks.codePanelOpen()) {
      const term = poiWorld(ctx, 'code_terminal');
      if (!term || Math.hypot(term.x - p.x, term.y - p.y) > WAR.terminal.reach + 16) this.hooks.closeCodePanel();
      else if (i.wasPressed('choice1')) this.hooks.chooseCode('yellow');
      else if (i.wasPressed('choice2')) this.hooks.chooseCode('red');
      else if (i.wasPressed('choice3')) this.hooks.chooseCode('green');
    } else if (this.hooks.checkPanelTarget()) {
      if (i.wasPressed('choice1')) this.hooks.closeCheckPanel('release');
      else if (i.wasPressed('choice2')) this.hooks.closeCheckPanel('fine');
      else if (i.wasPressed('choice3')) this.hooks.closeCheckPanel('arrest');
    }
    this.updateCheck(p, ctx);
    // Игрок-ВС догнал беглеца — задержание.
    if (FACTIONS[p.faction].authority) {
      for (const o of ctx.entities.near(p.x, p.y, LAW.catchDistance, near)) {
        if (o !== p && o.law.handler === p && o.law.phase === 'fleeing') ctx.law.arrest(p, o, 'resisting');
      }
    }
  }

  /** Ближайший лежащий тяжелораненый в досягаемости (кроме себя) или null. */
  private downedNear(p: Character, ctx: AiContext): Character | null {
    let best: Character | null = null;
    let bestD: number = DOWNED.reach + p.radius;
    for (const o of ctx.entities.near(p.x, p.y, bestD, near)) {
      const d = Math.hypot(o.x - p.x, o.y - p.y);
      if (o !== p && o.alive && o.downed && d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  /**
   * E у лежащего: своего — поднять (нужен бинт или аптечка), врага Протектората (игрок-ВС) —
   * стабилизировать и задержать. true — действие начато или объяснено (дальше E не идёт).
   */
  private rescue(p: Character, ctx: AiContext): boolean {
    const t = this.downedNear(p, ctx);
    if (!t) return false;
    const combat = ctx.combat;
    if (p.reviving === t) return true;
    if (combat.canRevive(p, t, true)) {
      combat.startRevive(p, t, true);
      this.say(`Стабилизируете ${t.name} для задержания…`);
      return true;
    }
    if (combat.isHostile(p, t)) return false;
    if (!combat.hasDressing(p)) {
      this.say('Чтобы поднять раненого, нужен бинт или аптечка. X — оттащить.');
      return true;
    }
    if (combat.startRevive(p, t)) this.say(`Поднимаете ${t.name}… не отходите.`);
    else this.say('Его уже поднимают.');
    return true;
  }

  /** X: тащить ближайшего лежащего / отпустить. */
  private drag(p: Character, ctx: AiContext): void {
    if (p.dragging) {
      ctx.combat.stopDrag(p);
      return this.say('Отпустили раненого.');
    }
    const t = this.downedNear(p, ctx);
    if (!t) return this.say('Рядом нет раненых, которых можно тащить.');
    if (ctx.combat.startDrag(p, t)) this.say(`Тащите ${t.name}. X — отпустить.`);
    else this.say('Сейчас не получится.');
  }

  /** Выбор в колесе оружия: взять ствол, выбрать гранату для T или убрать оружие. */
  private applyWheel(p: Character, ctx: AiContext, c: ReturnType<WeaponWheel['close']>): void {
    if (!c) return;
    if (c.kind === 'grenade') {
      p.grenadeKind = c.id;
      return this.say(`Граната: ${ITEMS[c.id].name} (${p.inventory.count(c.id)}). T — бросить.`);
    }
    const id = c.kind === 'weapon' ? c.id : null;
    if (id === p.weapon) return;
    ctx.combat.equip(p, id);
    this.say(id ? `В руках: ${WEAPONS[id].name}.` : 'Оружие убрано.');
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
    // Канцелярия Управы: лоялист садится за свободный стол — бумажная работа для Коменданта.
    const paperDesk = ctx.labor.desks.find((k) => Math.hypot(k.x - p.x, k.y - p.y) < LABOR.paperwork.reach);
    if (paperDesk) {
      if (p.faction !== 'citizen' || p.loyalty < LABOR.paperwork.minLoyalty) return this.say(`Бумажная работа — только для лоялистов (лояльность от ${LABOR.paperwork.minLoyalty}).`);
      if (!ctx.labor.claimDesk(p)) return this.say('Все столы заняты.');
      const T = LABOR.paperwork.workTime;
      this.task = { kind: 'paper', x: paperDesk.x, y: paperDesk.y, left: T, total: T };
      return this.say('Разбираете бумаги для Администрации…');
    }
    // Терминал кодов тревоги в кабинете Коменданта.
    if (d(poiWorld(ctx, 'code_terminal')) < WAR.terminal.reach) {
      if (!ctx.war.canSetCode(p)) return this.say('Терминал Администрации: доступ только Коменданту и старшим офицерам ВС (с OFC).');
      return this.hooks.openCodePanel();
    }
    // Поручение: у дома получателя — сдать посылку; у доски объявлений — взять новое.
    if (ctx.errands) {
      const done = ctx.errands.deliver(p);
      if (done) return this.say(done, 'world');
      const board = ctx.errands.canTake(p) ? ctx.errands.boardAt(p) : null;
      if (board) {
        const msg = ctx.errands.take(p, board);
        const a = ctx.errands.active;
        if (a && msg.indexOf(a.name) >= 0) this.hooks.setMarker(a.to.at.x, a.to.at.y);
        return this.say(msg, 'world');
      }
    }
    // Курьер ТС с коробкой — сдать товар в лавку, ларёк или столовую проспекта.
    if (p.faction === 'cwu' && p.carrying && ctx.shops) {
      const t = ctx.shops.dropAt(p, REACH + 8);
      if (t) {
        ctx.shops.deliver(p, t);
        return this.say(`Коробка из штаба ТС сдана${'shop' in t ? ` в «${t.shop.name}»: товара ${t.shop.goods}/${t.shop.cap}` : ` в столовую: супа ${ctx.shops.soup}/${ctx.shops.soupCap}`}. +${ARBAT.supply.pay} токенов`);
      }
    }
    if (d(ctx.insurgency.market) < REACH + 8) {
      if (ctx.fence?.present && !ctx.fence.open) return this.say('Хата барыги: хозяина нет — зайдите позже.');
      return this.hooks.openShop('black');
    }
    // Бандит у общака своей банды: взять ствол получше (что есть в общаке).
    const gang = ctx.gangs?.of(p);
    if (gang && d(gang.hq) < REACH + 10) {
      const gun = GANGS.arms.find((id) => gang.stash.has(id) && !p.inventory.has(id));
      if (gun) {
        gang.stash.remove(gun, 1);
        p.inventory.add(gun, 1);
        eco.refillAmmo(p, 2);
        return this.say(`Из общака «${gang.def.name}»: ${ITEMS[gun].name} и пара магазинов.`);
      }
      const items = gang.stash.slots.map((s) => `${ITEMS[s.id].name}${s.qty > 1 ? ` ×${s.qty}` : ''}`).join(', ');
      return this.say(`Общак «${gang.def.name}»: ${gang.bank} ток.${items ? ` · ${items}` : ''}. Лучше вашего ствола нет.`);
    }
    // Лавки (и магазин ТС), кафе и ларьки проспекта; раздача и стол общей столовой — суп и обед.
    const street = ctx.shops?.shopAt(p, REACH + 8);
    if (street) {
      if (!street.stock.length) return this.say(`${street.name}: сегодня только поглазеть — товара нет.`);
      const why = ctx.shops.refusal(street);
      if (why === 'closed') return this.say(`${street.name}: закрыто — продавца нет за прилавком.`);
      if (why === 'empty') return this.say(`${street.name}: полки пусты — ждут коробку из штаба ТС.`);
      return this.hooks.openShop('street', street);
    }
    if (d(eco.shopCounter) < REACH + 8) return this.hooks.openShop('cwu');
    const serve = ctx.shops?.serveSpot;
    if (serve && d(serve) < REACH && !p.soupBowl) {
      if (!ctx.shops.takeSoup(p)) return this.say(ctx.shops.kitchenOpen ? 'Общая столовая: суп кончился — ждут коробку из штаба ТС.' : 'Общая столовая: повара у котла нет.');
      return this.say('Повар налил миску супа. Садитесь за стол (E у свободного места).');
    }
    const seat = ctx.shops?.seats.find((s) => !s.taken && Math.hypot(s.x - p.x, s.y - p.y) < REACH * 0.6);
    if (seat) {
      if (!p.soupBowl && !ctx.shops.foodOf(p)) return this.say('Общая столовая: нечего есть — возьмите суп у раздачи или приходите с пайком.');
      ctx.shops.eat(p);
      return this.say(`Пообедали за столом общей столовой. Сытость: ${Math.round(p.hunger)}.`);
    }
    // Своя явка (подпольщик): E в комнате — спрятать добычу в тайник, нечего прятать — взять оттуда.
    const home = ctx.housing?.of(p);
    if (home?.stash && ctx.housing.inside(home, p)) {
      const n = ctx.insurgency.stashLoot(p);
      if (n) return this.say(`Добыча спрятана в тайник явки: ${n} шт.`);
      const got: string[] = [];
      for (const s of [...home.stash.slots]) {
        const k = p.inventory.add(s.id, s.qty);
        if (k > 0) {
          home.stash.remove(s.id, k);
          got.push(`${ITEMS[s.id].name}${k > 1 ? ` ×${k}` : ''}`);
        }
      }
      return this.say(got.length ? `Из тайника явки: ${got.join(', ')}.` : 'Тайник явки пуст — несите сюда краденое со склада и с конвоев.');
    }
    // Люк: спуститься / подняться.
    const hatch = ctx.underground.hatchNear(p.x, p.y);
    if (hatch && !ctx.underground.canUse(p)) return this.say('Люк заварен. Ходы под городом знают только партизаны.');
    if (hatch) {
      const down = ctx.map.levelAt(p.x, p.y) === 'city';
      this.climbing = { left: UNDERGROUND.climbTime, to: hatch.to, down };
      return this.say(down ? 'Спускаетесь в люк…' : 'Поднимаетесь по лестнице…');
    }
    // Тайник сопротивления: патроны к своим стволам.
    if (d(ctx.insurgency.cache) < REACH + 8) {
      if (p.faction !== 'rebel') return this.say('Ящики сопротивления. Вам тут ничего не положено.');
      const n = eco.refillAmmo(p, INSURGENCY.cacheMags);
      return this.say(n > 0 ? `Тайник: +${n} патронов.` : 'Тайник: патронов вам хватает.', 'world');
    }
    // Прорванный КПП: гражданин (или ТС) в коридоре может примкнуть к повстанцам.
    const front = ctx.war.frontAt(p.x, p.y);
    if (front && front.owner === 'rebels' && (p.faction === 'citizen' || p.faction === 'cwu') && ctx.war.pointAt(front, p.x, p.y) >= 0) {
      ctx.war.defect(p, front);
      return this.say('Вы примкнули к сопротивлению! Оружие выдали — держите КПП.', 'world');
    }
    const corpse = ctx.combat.corpseNear(p.x, p.y, REACH);
    // Любой повстанец в тюрьме Протектората: выбить дверь камеры, где сидят свои.
    if (p.faction === 'rebel' && p.law.phase === 'none') {
      const jail = ctx.law.cells.find((c) => c.prison && ctx.law.occupants(c).length > 0 && d({ x: c.frontX, y: c.frontY }) < REACH + 8);
      if (jail) {
        const T = PRISON.assault.breakTime;
        this.task = { kind: 'break', x: p.x, y: p.y, left: T, total: T, cell: jail };
        return this.say('Выбиваете дверь камеры тюрьмы…', 'world');
      }
      // Оружейная тюрьмы: заперта — выбить дверь; у стоек — взять ствол, магазины, гранату; изъятое — своё.
      const P = ctx.prison;
      if (P?.present) {
        const A = PRISON.armory;
        if (P.armoryLocked && P.armoryFront && d(P.armoryFront) < A.reach && !P.inArmory(p.x, p.y)) {
          this.task = { kind: 'armory', x: p.x, y: p.y, left: A.breakTime, total: A.breakTime };
          return this.say('Выбиваете дверь оружейной тюрьмы…', 'world');
        }
        if (P.armorySpot && P.inArmory(p.x, p.y) && d(P.armorySpot) < A.useReach + 24) {
          const got = P.takeArms(p);
          return this.say(got ? `Оружейная тюрьмы: ${got}.` : 'Оружейная пуста — стойки голые.', 'world');
        }
        if (P.evidenceSpot && d(P.evidenceSpot) < A.useReach + 24) {
          return this.say(P.takeEvidence(p) ? 'Комната изъятого: вы забрали своё.' : 'Комната изъятого: вашего здесь нет.', 'world');
        }
      }
    }
    // Спецагент: форма с убитого ВС (в OTA не переодеться), взлом камеры КПЗ.
    if (p.faction === 'rebel' && p.profession === 'spec_agent') {
      const A = PARTISANS.agent;
      if (corpse && corpse.faction === 'cp' && !corpse.stripped) {
        this.task = { kind: 'dress', x: corpse.x, y: corpse.y, left: A.dress, total: A.dress, corpse };
        return this.say(`Снимаете форму с тела: ${corpse.name}…`, 'world');
      }
      const cell = ctx.law.cells.find((c) => !c.prison && ctx.law.occupants(c).length > 0 && (d({ x: c.frontX, y: c.frontY }) < REACH + 8 || d(c) < REACH + 8));
      if (cell) {
        this.task = { kind: 'break', x: p.x, y: p.y, left: A.breakTime, total: A.breakTime, cell };
        return this.say('Выбиваете дверь камеры…', 'world');
      }
    }
    // Партизан: передать ствол бандиту — пусть ВС получит своё чужими руками.
    if (p.faction === 'rebel' && p.profession === 'partisan') {
      const b = this.facingTarget(p, ctx, PARTISANS.arm.reach + 8, (o) => ctx.insurgency.armable(o));
      if (b) {
        ctx.insurgency.armBandit(p, b);
        return this.say(`Вы передали ствол бандиту ${b.name}. Он пойдёт на ВС.`, 'world');
      }
    }
    // Наблюдатель OBS сначала сканирует тело (найти убийцу), потом можно обыскать.
    if (corpse && cpHas(p, 'investigate') && !corpse.scanned) {
      const T = CP_UNITS.obs.scanTime;
      this.task = { kind: 'scan', x: corpse.x, y: corpse.y, left: T, total: T, corpse };
      return this.say('Сканирование тела…', 'world');
    }
    if (corpse && ctx.war.scenes.sealed(corpse, p)) return this.say('Место преступления оцеплено — тело не обыскать.');
    if (corpse) {
      const n = ctx.combat.loot(p, corpse);
      return this.say(n > 0 ? `Обыскали тело: ${corpse.name}.` : 'Инвентарь полон.');
    }
    // Бандит: гоп-стоп лицом к лицу в подворотне, со стволом в руках.
    if (p.profession === 'bandit') {
      const victim = this.facingTarget(p, ctx, CRIME.rob.reach, (o) => ctx.crime.victimOk(p, o));
      if (victim) {
        if (!ctx.crime.robOk(p, victim)) return this.say('Не здесь — только в подворотне, подальше от проспектов.');
        if (!p.weapon && p.inventory.has('rebel_pistol')) ctx.combat.equip(p, 'rebel_pistol');
        if (!p.weapon) return this.say('Без ствола никто не отдаст — возьмите оружие в руки.');
        this.task = { kind: 'rob', x: victim.x, y: victim.y, left: CRIME.rob.time, total: CRIME.rob.time, victim };
        p.say('Гони токены!', ctx.law.now, 2);
        return this.say('Гоп-стоп… держите ствол, пока не отдаст.', 'world');
      }
    }
    // Вор (и отброс): карманная кража — встать за спиной; вор с отмычкой — взлом раздатчика.
    if (p.profession === 'thief' || p.profession === 'outcast') {
      const victim = this.facingTarget(p, ctx, CRIME.pickpocket.reach, (o) => ctx.crime.victimOk(p, o));
      if (victim) {
        if (!ctx.crime.behind(p, victim)) return this.say('Зайдите со спины — иначе заметит.');
        this.task = { kind: 'pick', x: victim.x, y: victim.y, left: CRIME.pickpocket.time, total: CRIME.pickpocket.time, victim };
        return this.say('Тянетесь к карману…', 'world');
      }
      if (p.profession === 'thief' && !eco.open && d(eco.window) < REACH + 8) {
        if (!p.inventory.has('lockpick')) return this.say('Нужна отмычка (чёрный рынок).');
        this.task = { kind: 'hack', x: eco.window.x, y: eco.window.y, left: CRIME.hack.time, total: CRIME.hack.time };
        return this.say(`Взламываете раздатчик… ${CRIME.hack.time} с. Если увидит ВС — арест.`, 'world');
      }
    }
    // Склад Протектората на окраине: выдача ВС, работа грузчиков и оружейника, диверсии подполья.
    if (ctx.arsenal?.present && ctx.map.zoneAtWorld(p.x, p.y)?.kind === 'arsenal' && this.arsenal(p, ctx)) return;
    // Пункт боепитания в проходной КПП и в Управе.
    if (this.kppPoint(p, ctx)) return;
    // Ящик, брошенный конвоем ВС (засада): повстанцу или бандиту — забрать себе.
    if ((p.faction === 'rebel' || p.profession === 'bandit') && ctx.arsenal?.present && ctx.arsenal.looseOutside.some((c) => d(c) < REACH + 6)) {
      const g = ctx.gangs?.of(p);
      if (g && ctx.gangs.lootToStash(g, p, REACH + 6)) return this.say(`Ящик с конвоя — в общак «${g.def.name}».`, 'world');
      if (ctx.insurgency.lootCrate(p, REACH + 6)) return this.say('Ящик с конвоя — ваш: патроны или гранаты в подсумок.', 'world');
    }
    // Штаб ТС: гражданин у стойки найма — устроиться (глава оформляет туда, где не хватает рук).
    const hq = ctx.cwuHq;
    if (hq?.present && p.faction === 'citizen' && (d(hq.counter) < REACH + 12 || d(hq.applicantSpot) < REACH + 12)) {
      const head = hq.head;
      if (!head) return this.say('Главы ТС нет на месте — приходите позже.');
      const prof = hq.vacancy();
      if (!prof) return this.say(`Глава ТС: «${ctx.rng.pick(CWU_HQ.lines.noVacancy)}»`, 'world');
      hq.hire(p, prof, head);
      return;
    }
    // Работы ТС: цех штаба, доставка коробок.
    const labor = ctx.labor;
    const station = labor.nearestStation(p.x, p.y);
    if (p.profession === 'packer' && station && d(station) < REACH) {
      if (!this.packing && station.who && station.who !== p) return this.say('У этого конвейера уже работают — займите соседний.');
      this.packing = !this.packing;
      if (this.packing) station.who = p;
      else {
        labor.stopPacking(p);
        labor.releaseStation(p);
      }
      return this.say(this.packing ? `Вы у конвейера: собираете коробки рационов (${LABOR.factory.packTime} с каждая). E — закончить.` : 'Фасовка окончена.', 'world');
    }
    if (p.profession === 'courier') {
      if (!p.carrying && d(labor.factoryStore) < REACH) {
        return this.say(labor.takeBox(p) ? 'Вы взяли коробку рационов. Несите к будке раздачи на площади.' : 'На складе завода нет коробок — нужен фасовщик.', 'world');
      }
      if (p.carrying && (d(labor.boothDrop) < REACH + 10 || d(eco.window) < REACH + 10)) {
        if (!labor.deliverBox(p)) this.say('Склад будки полон — подождите раздачи.');
        return;
      }
    }
    // Мусор: уборщик и поднадзорный убирают, остальные роются.
    const pile = labor.nearestTrash(p.x, p.y, false, REACH);
    if (pile) {
      if (p.profession === 'janitor' || p.faction === 'vort') {
        this.task = { kind: 'clean', x: pile.x, y: pile.y, left: LABOR.trash.cleanTime, total: LABOR.trash.cleanTime, pile };
        return this.say('Убираете мусор…', 'world');
      }
      if (pile.searched) return this.say('Здесь уже рылись.');
      this.task = { kind: 'search', x: pile.x, y: pile.y, left: LABOR.trash.searchTime, total: LABOR.trash.searchTime, pile };
      return this.say('Роетесь в мусоре…', 'world');
    }
    // Повстанец: саботаж узла Протектората.
    const node = eco.nodes.find((r) => !r.broken && d(r) < REACH);
    if (node && p.faction === 'rebel') {
      this.sabotaging = { spot: node, progress: 0 };
      return this.say(`Саботаж узла… не отходите ${INSURGENCY.sabotageTime} с. ВС рядом быть не должно.`, 'world');
    }
    // ТС: встать на выдачу / выдать следующему (это работа повара).
    if (p.faction === 'cwu' && p.profession !== 'cook' && eco.open && d(eco.dispenserSpot) < REACH) {
      return this.say('Рационы выдают повара ТС. Ваша работа — в описании профессии (меню роли).');
    }
    if (p.faction === 'cwu' && eco.open && d(eco.dispenserSpot) < REACH) {
      if (eco.dispenser !== p) {
        if (!eco.claimDispenser(p)) return this.say('На выдаче уже стоит работник.');
        return this.say('Вы на выдаче рационов. E — выдать следующему в очереди.', 'world');
      }
      const served = eco.serveNext(p);
      return this.say(served ? `Выдано: ${served.name}. +2 токена · на складе ${eco.rationStock}` : eco.rationStock <= 0 ? 'Склад будки пуст — ждите курьера с завода.' : 'Очередь пуста или первый ещё не подошёл.', 'world');
    }
    if (p.faction === 'cwu' && (p.profession === 'janitor' || p.profession === 'packer')) {
      const spot = eco.repairs.find((r) => r.broken && d(r) < REACH);
      if (spot) {
        if (!p.inventory.has('toolkit')) return this.say('Нужен набор инструментов (есть в магазине ТС).');
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
    // ВС: у стойки дежурного Управы — только медицина; патроны и гранаты — на складе Протектората.
    const desk = poiWorld(ctx, 'nexus_desk');
    if (p.faction === 'cp' && d(desk) < REACH * 1.5) {
      for (const [id, qty] of KITS[cpKit(p.rank)] ?? []) {
        if (ITEMS[id].kind === 'medical' && p.inventory.count(id) < qty) p.inventory.add(id, qty - p.inventory.count(id));
      }
      return this.say(ctx.arsenal?.present ? 'Аптечка пополнена. Патроны и гранаты — на складе Протектората, у окна выдачи.' : 'Аптечка пополнена.', 'world');
    }
    this.say('Рядом нечего использовать. E работает у терминала, прилавков, люков, окна раздачи, завода, мусора, поломок, узлов Протектората и тел.');
  }

  /**
   * E на складе Протектората. ВС — окно выдачи (кладовщик — справка у стола); грузчик — взять ящик (крыльцо,
   * стеллаж) и поставить (в ячейку, на расходный стеллаж), маяк; оружейник — ствол из ящика на ремонт,
   * верстак, стойка, проверка ящика патронов; повстанец — маяк, заряд, брак, кража; спецагент в форме —
   * «по наряду». true — обработано.
   */
  private arsenal(p: Character, ctx: AiContext): boolean {
    const A = ctx.arsenal;
    const d = (q: { x: number; y: number } | null) => (q ? Math.hypot(q.x - p.x, q.y - p.y) : Infinity);
    const R = ARSENAL.issue.reach + 8;
    // Спецагент в форме Протектората у окна — гранаты «по наряду».
    if (p.faction === 'rebel' && p.profession === 'spec_agent' && coverAuthority(p) && d(A.window) < R) {
      this.task = { kind: 'requisition', x: p.x, y: p.y, left: ARSENAL.issue.every, total: ARSENAL.issue.every };
      this.say('Кладовщику: «Наряд на гранаты, подпись Надзора»…', 'world');
      return true;
    }
    if (p.faction === 'cp') {
      if (isQuartermaster(p) && d(A.desk) < ARSENAL.issue.deskReach + 12) {
        const st = A.stock;
        this.say(`Стол кладовщика: выдача идёт, пока вы на месте. Запасы — патроны ${st.ammo} ящ., гранаты ${st.grenades} ящ., стволы ${st.weapons} (+${st.parts} в консервации).`, 'world');
        return true;
      }
      if (d(A.window) < R) {
        const why = A.issue(p);
        this.say(why ? `Окно выдачи: ${why}` : 'Окно выдачи: получено, распишитесь в описи.', 'world');
        return true;
      }
    }
    if (p.profession === 'loader' && p.faction === 'cwu') {
      if (A.cargo(p)) {
        this.say(A.playerPut(p, REACH), 'world');
        return true;
      }
      if (A.beaconBroken && d(A.beacon) < R) {
        const T = ARSENAL.beacon.repair - A.beaconProgress;
        this.task = { kind: 'beacon', x: p.x, y: p.y, left: T, total: ARSENAL.beacon.repair };
        this.say('Чините маяк крыльца…', 'world');
        return true;
      }
      const took = A.playerTake(p, REACH);
      if (took) {
        this.say(took, 'world');
        return true;
      }
    }
    if (p.profession === 'armorer' && p.faction === 'cwu') {
      const gun = A.cargo(p);
      if (gun?.kind === 'gun' && gun.broken) {
        if (d(A.benchSpot) < R) {
          const T = ARSENAL.armorer.repair;
          this.task = { kind: 'bench', x: p.x, y: p.y, left: T, total: T };
          this.say('За верстаком: снять смазку, проверить затвор, собрать…', 'world');
        } else this.say('Ствол в консервации — к верстаку.');
        return true;
      }
      if (gun?.kind === 'gun') {
        this.say(A.playerRackGun(p, REACH) ? `Ствол на стойке. +${ARSENAL.armorer.pay} токенов за работу.` : 'Нужна свободная стойка в зале.', 'world');
        return true;
      }
      if (A.playerTakeGun(p, REACH)) {
        this.say('Взяли ствол из ящика — к верстаку.', 'world');
        return true;
      }
      const slot = A.slotNear(p.x, p.y, REACH, (q) => q.area === 'hall' && !!q.crate && !q.crate.checked);
      if (slot) {
        const T = ARSENAL.armorer.check;
        this.task = { kind: 'check', x: p.x, y: p.y, left: T, total: T, slot };
        this.say('Проверяете ящик патронов…', 'world');
        return true;
      }
    }
    if (p.faction === 'rebel') {
      let act: DepotAct | null = null;
      const crate = A.slotNear(p.x, p.y, REACH, (q) => !!q.crate && q.area !== 'rack' && q.crate.kind !== 'gun') ?? null;
      const loose = A.crates.find((c) => Math.hypot(c.x - p.x, c.y - p.y) < REACH);
      if (!A.beaconBroken && d(A.beacon) < R) act = 'beacon';
      else if (d(A.bombSpot) < R && p.inventory.has('grenade') && !A.bomb) act = 'bomb';
      else if ((crate?.crate?.kind === 'ammo' && !crate.crate.tainted) || (loose?.kind === 'ammo' && !loose.tainted)) act = 'taint';
      else if (crate || loose) act = 'steal';
      if (act) {
        const T = A.sabotageTime(act);
        this.task = { kind: 'depot', x: p.x, y: p.y, left: T, total: T, act };
        this.say({ steal: 'Уносите ящик…', taint: 'Подмешиваете брак в патроны…', bomb: `Закладываете заряд у двери зала (взрыв через ${ARSENAL.bomb.fuse} с)…`, beacon: 'Портите маяк крыльца…' }[act], 'world');
        return true;
      }
    }
    return false;
  }

  /** E у пункта боепитания КПП: часовой пополняется, грузчик сдаёт ящик. true — обработано. */
  private kppPoint(p: Character, ctx: AiContext): boolean {
    const A = ctx.arsenal;
    const point = A?.present ? A.points.find((q) => Math.hypot(q.x - p.x, q.y - p.y) < ARSENAL.kpp.reach + 12) : null;
    if (!point) return false;
    if (p.profession === 'loader' && A.cargo(p)) {
      this.say(A.playerPut(p, REACH), 'world');
      return true;
    }
    if (p.faction === 'cp' || p.faction === 'ota') {
      const why = A.drawAtPoint(p, point.front);
      this.say(why ? `Пункт боепитания: ${why}` : `Пункт боепитания: магазины и гранаты получены (осталось ${point.kits} компл.).`, 'world');
      return true;
    }
    this.say(`Пункт боепитания КПП: ${point.kits} компл. патронов, ${point.grenades} гранат.`);
    return true;
  }

  /** Действие с таймером: отошли — прервано; время вышло — результат. */
  private updateTask(p: Character, ctx: AiContext, dt: number): void {
    const t = this.task!;
    const at = t.victim ?? t;
    if (Math.hypot(at.x - p.x, at.y - p.y) > (t.kind === 'pick' || t.kind === 'rob' ? 50 : 34)) {
      this.task = null;
      if (t.kind === 'clean' && t.pile?.worker === p) t.pile.worker = null;
      if (t.kind === 'paper') ctx.labor.releaseDesk(p);
      return this.say('Прервано — отошли слишком далеко.');
    }
    if (t.kind === 'clean') {
      if (ctx.labor.cleanStep(p, t.pile!, dt)) this.task = null;
      else t.left = LABOR.trash.cleanTime - t.pile!.progress;
      return;
    }
    if ((t.left -= dt) > 0) return;
    this.task = null;
    if (t.kind === 'search') {
      const got = ctx.labor.search(p, t.pile!);
      return this.say(got ? `Нашли в мусоре: ${ITEMS[got].name}.` : 'Ничего полезного.', 'world');
    }
    this.finishTask(p, ctx, t);
  }

  /** Завершение особых действий (кража, взлом, сканирование) — задают профессии. */
  private finishTask(p: Character, ctx: AiContext, t: NonNullable<PlayerController['task']>): void {
    if (t.kind === 'rob' && t.victim) {
      if (ctx.crime.rob(p, t.victim) <= 0) this.say('У него ни гроша.');
      return;
    }
    if (t.kind === 'pick' && t.victim) {
      if (!ctx.crime.behind(p, t.victim)) return this.say('Жертва обернулась — кража сорвалась.');
      if (ctx.crime.pickpocket(p, t.victim) <= 0) this.say('Карманы пусты.');
      return;
    }
    if (t.kind === 'scan' && t.corpse) {
      return this.say(ctx.crime.investigate(t.corpse, p), 'law');
    }
    if (t.kind === 'paper') {
      ctx.labor.payPaperwork(p);
      ctx.labor.releaseDesk(p);
      return this.say(`Отчёт сдан: +${LABOR.paperwork.pay} токенов.`, 'world');
    }
    if (t.kind === 'dress' && t.corpse) {
      if (t.corpse.stripped) return this.say('С тела уже сняли форму.');
      ctx.insurgency.dressAs(p, t.corpse);
      return this.say(`Вы в форме: ${t.corpse.name}. Для ВС — свой; выдаст только убийство.`, 'world');
    }
    if (t.kind === 'break' && t.cell) {
      const n = ctx.insurgency.jailbreak(p, t.cell);
      return this.say(n > 0 ? `Камера вскрыта: сбежали ${n}. Уходите!` : 'В камере уже никого.', 'world');
    }
    if (t.kind === 'armory') {
      if (!ctx.prison.armoryLocked) return this.say('Дверь оружейной уже открыта.');
      ctx.prison.breakArmory(p);
      return this.say('Дверь оружейной выбита — стволы на стойках (E).', 'world');
    }
    if (t.kind === 'depot' && t.act) {
      const ok = ctx.arsenal.doSabotage(p, t.act);
      return this.say(ok ? { steal: 'Ящик ваш — уходите, пока не хватились.', taint: 'Брак в ящике — у ВС будут осечки.', bomb: 'Заряд заложен — уходите!', beacon: 'Маяк не работает — борт не сядет.' }[t.act] : 'Не вышло — уже нечего.', 'world');
    }
    if (t.kind === 'beacon') {
      ctx.arsenal.repairBeacon(p, ARSENAL.beacon.repair);
      return this.say('Маяк крыльца работает.', 'world');
    }
    if (t.kind === 'bench') {
      ctx.arsenal.playerFinishRepair(p);
      return this.say('Ствол расконсервирован и собран — повесьте на свободную стойку в зале.', 'world');
    }
    if (t.kind === 'check' && t.slot) {
      const bad = ctx.arsenal.playerCheck(p, t.slot);
      return this.say(bad ? 'Брак! Ящик списан — кто-то копался в патронах.' : `Партия в порядке. +${ARSENAL.armorer.checkPay} токенов.`, 'world');
    }
    if (t.kind === 'requisition') {
      const n = ctx.arsenal.requisition(p);
      return this.say(n > 0 ? `Кладовщик выдал гранат: ${n}. Записал — не кража.` : 'Кладовщик: «Гранат нет» (или выдача закрыта).', 'world');
    }
    if (t.kind === 'hack') {
      const n = ctx.crime.hackDispenser(p);
      return this.say(n > 0 ? `Раздатчик вскрыт: +${n} рационов. Уходите!` : 'Склад будки пуст — взлом впустую.', 'world');
    }
  }

  /** Тот, кто перед игроком (ближе и в секторе взгляда), с фильтром. */
  private facingTarget(p: Character, ctx: AiContext, range: number, ok: (o: Character) => boolean): Character | null {
    let best: Character | null = null;
    let bestScore = Infinity;
    for (const o of ctx.entities.near(p.x, p.y, range + 12, near)) {
      if (o === p || !o.alive || !ok(o)) continue;
      const d = Math.hypot(o.x - p.x, o.y - p.y);
      let a = Math.atan2(o.y - p.y, o.x - p.x) - p.facing;
      while (a > Math.PI) a -= Math.PI * 2;
      while (a < -Math.PI) a += Math.PI * 2;
      const score = d + Math.abs(a) * 30;
      if (d <= range + 12 && Math.abs(a) < 1.3 && score < bestScore) {
        bestScore = score;
        best = o;
      }
    }
    return best;
  }

  /** G: умение профессии или отряда ВС. */
  private special(p: Character, ctx: AiContext): void {
    // Медик ТС: лечит за плату (гражданин платит, ВС — бесплатно).
    if (p.profession === 'cwu_medic') {
      if (this.healCooldown > 0) return;
      const t = this.facingTarget(p, ctx, LABOR.medic.range, (o) => (o.health < o.maxHealth || o.bleed > 0) && o.faction !== 'rebel');
      if (!t) return this.say('Перед вами некого лечить.');
      const err = ctx.labor.treat(p, t);
      if (err) return this.say(err);
      this.healCooldown = LABOR.medic.cooldown;
      return this.say(FACTIONS[t.faction].authority ? `Вы подлечили сотрудника: ${t.name}.` : `Вы подлечили: ${t.name}. +${LABOR.medic.fee} токенов`, 'world');
    }
    // Медик сопротивления: лечит своих бесплатно.
    if (p.profession === 'rebel_medic') {
      if (this.healCooldown > 0) return;
      const t = this.facingTarget(p, ctx, COMBAT.healRange, (o) => o.faction === 'rebel' && (o.health < o.maxHealth || o.bleed > 0));
      const target = t ?? (p.health < p.maxHealth ? p : null);
      if (!target) return this.say('Некого лечить рядом.');
      if (!p.inventory.remove('bandage', 1) && !p.inventory.remove('medkit', 1)) return this.say('Нет бинтов и аптечек — пополните у тайника или на рынке.');
      ctx.combat.heal(target, COMBAT.healAmount);
      this.healCooldown = COMBAT.healCooldown;
      return this.say(target === p ? 'Вы перевязались.' : `Вы подлечили: ${target.name}.`, 'world');
    }
    // Глава восстания: клич — бойцы рядом идут за вами на штурм.
    if (p.profession === 'rebel_leader' && p.faction === 'rebel') {
      const err = ctx.war.command.shout(p);
      return this.say(err ?? 'Клич! Бойцы рядом идут за вами.', err ? 'system' : 'world');
    }
    // Спецагент: бунт — горожане вокруг выходят на улицу (откат).
    if (p.profession === 'spec_agent' && p.faction === 'rebel') {
      if (this.riotCooldown > 0) return this.say(`Бунт готовится… ещё ${Math.ceil(this.riotCooldown)} с.`);
      if (ctx.map.levelAt(p.x, p.y) !== 'city') return this.say('Бунт — в городе, среди горожан.');
      const n = ctx.insurgency.startRiot(p, p.x, p.y);
      if (n <= 0) return this.say('Рядом некого поднять — нужны горожане (не лоялисты).');
      this.riotCooldown = PARTISANS.riot.cooldown;
      return this.say(`Бунт! Поднялись ${n} горожан. ВС будет занято ими.`, 'world');
    }
    // Партизан: маскировка под гражданина или ТС (без оружия в руках).
    if (p.profession === 'partisan') {
      if (p.disguised) {
        p.disguised = false;
        p.cover = null;
        return this.say('Маскировка снята.', 'world');
      }
      if (p.weapon) return this.say('Уберите оружие (H), чтобы надеть маскировку.');
      if (ctx.combat.now - p.lastHurt < 10 || p.hostile) return this.say('Вас только что видели в бою — маскировка не поможет.');
      ctx.insurgency.giveCover(p);
      return this.say(`Вы в маскировке: для ВС вы ${p.cover?.faction === 'cwu' ? 'рабочий ТС' : 'обычный гражданин'}. Выдаст только убийство; проверка CID — может, со стволом в руках ВС остановит.`, 'world');
    }
    if (p.faction !== 'cp') return this.say('Умение (G) есть у ВС и у некоторых профессий (медики, партизан).');
    // SU.02 в городе (не у раненых) — сканер; иначе — лечение.
    if (cpHas(p, 'drone') && ctx.map.zoneAtWorld(p.x, p.y)?.kind !== 'checkpoint' && !ctx.scanners.of(p)) {
      const err = ctx.scanners.deploy(p);
      if (!err) return this.say(`Сканер запущен: облетает кварталы вокруг вас ${CP_UNITS.scanner.life} с и засекает повстанцев, вооружённых и разыскиваемых.`, 'world');
    }
    if (cpHas(p, 'medic')) {
      if (this.healCooldown > 0) return;
      let best: Character | null = null;
      for (const o of ctx.entities.near(p.x, p.y, COMBAT.healRange + 12, near)) {
        if (o !== p && o.alive && (o.health < o.maxHealth || o.bleed > 0) && (!best || o.health < best.health)) best = o;
      }
      const target = best ?? (p.health < p.maxHealth ? p : null);
      if (!target || !ctx.combat.heal(target, COMBAT.healAmount)) return this.say('Некого лечить рядом.');
      this.healCooldown = COMBAT.healCooldown;
      return this.say(target === p ? 'Вы перевязались.' : `Вы подлечили: ${target.name}.`, 'world');
    }
    if (cpHas(p, 'barrier')) {
      const err = this.hooks.placeBarrier();
      return this.say(err ?? 'Бетонный блок установлен (не больше трёх).', err ? 'system' : 'world');
    }
    this.say(cpUnit(p.rank).desc);
  }

  /** F: у ВС — проверка документов у ближайшего, кто перед игроком. */
  private roleAction(p: Character, ctx: AiContext): void {
    if (p.faction !== 'cp') {
      this.bus.emit('log', { text: 'Действие роли (F) пока есть только у ВС: проверка CID.', kind: 'system' });
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
    this.check = { target: best, until: ctx.law.now + LAW.checkTime * (cpHas(p, 'investigate') ? LAW.juryCheckMul : 1) };
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

  /** Решение игрока-ВС по проверке. */
  resolve(p: Character, target: Character, choice: CheckChoice, ctx: AiContext): void {
    if (target.law.handler !== p) return;
    const verdict = ctx.law.judge(target);
    if (choice === 'arrest') ctx.law.apply(p, target, { kind: 'arrest', reason: verdict.reason, fine: 0 });
    else if (choice === 'fine') ctx.law.apply(p, target, { kind: 'fine', reason: verdict.reason, fine: verdict.fine || LAW.fines.running });
    else ctx.law.apply(p, target, { kind: 'ok', reason: verdict.reason, fine: 0 });
    if (choice === 'arrest') this.bus.emit('log', { text: 'Отведите задержанного к свободной камере КПЗ в Управе — он идёт за вами.', kind: 'system' });
  }
}
