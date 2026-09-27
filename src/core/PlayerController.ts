import type { Input } from './Input';
import type { Camera } from './Camera';
import type { EventBus } from './EventBus';
import type { Character } from '../entities/Character';
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
import { ECONOMY } from '../config/economy';
import { COMBAT, HITS, MINE } from '../config/combat';
import type { RepairSpot } from '../systems/EconomySystem';
import type { TrashPile } from '../systems/LaborSystem';
import { GRENADE_KINDS, type Corpse } from '../systems/CombatSystem';
import { LABOR } from '../config/labor';
import { CWU_HQ } from '../config/cwuHq';
import { CRIME } from '../config/crime';
import { CP_UNITS } from '../config/cpUnits';

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
  /** Лезет по люку: сколько осталось и куда. */
  private climbing: { left: number; to: { x: number; y: number }; down: boolean } | null = null;
  /** Саботирует узел Альянса (повстанец). */
  private sabotaging: { spot: RepairSpot; progress: number } | null = null;
  /** Работа у места (фасовка на заводе) и действие с таймером (уборка, поиск в мусоре, взлом, кража). */
  private packing = false;
  private task: { kind: 'clean' | 'search' | 'hack' | 'pick' | 'rob' | 'scan' | 'paper' | 'dress' | 'dressOta' | 'break'; x: number; y: number; left: number; total: number; pile?: TrashPile; victim?: Character; corpse?: Corpse; cell?: Cell } | null = null;
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
      openShop(kind: 'cwu' | 'black'): void;
      toggleInventory(): void;
      placeBarrier(): string | null;
      checkPanelTarget(): Character | null;
      closeCheckPanel(choice: CheckChoice): void;
      openCodePanel(): void;
      codePanelOpen(): boolean;
      chooseCode(code: AlertCode): void;
      closeCodePanel(): void;
    },
  ) {}

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
    if (!p.alive) {
      p.wantX = p.wantY = 0;
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
    if (i.wasPressed('interact')) this.interact(p, ctx);
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
        this.say(`Узел Альянса выведен из строя. Сопротивление платит: +${INSURGENCY.sabotageReward} токенов. Уходите!`, 'world');
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
    // Канцелярия Нексуса: лоялист садится за свободный стол — бумажная работа для Администратора.
    const paperDesk = ctx.labor.desks.find((k) => Math.hypot(k.x - p.x, k.y - p.y) < LABOR.paperwork.reach);
    if (paperDesk) {
      if (p.faction !== 'citizen' || p.loyalty < LABOR.paperwork.minLoyalty) return this.say(`Бумажная работа — только для лоялистов (лояльность от ${LABOR.paperwork.minLoyalty}).`);
      if (!ctx.labor.claimDesk(p)) return this.say('Все столы заняты.');
      const T = LABOR.paperwork.workTime;
      this.task = { kind: 'paper', x: paperDesk.x, y: paperDesk.y, left: T, total: T };
      return this.say('Разбираете бумаги для Администрации…');
    }
    // Терминал кодов тревоги в кабинете Администратора.
    if (d(poiWorld(ctx, 'code_terminal')) < WAR.terminal.reach) {
      if (!ctx.war.canSetCode(p)) return this.say('Терминал Администрации: доступ только Администратору и старшим офицерам ГО (с OFC).');
      return this.hooks.openCodePanel();
    }
    if (d(eco.shopCounter) < REACH + 8) return this.hooks.openShop('cwu');
    if (d(ctx.insurgency.market) < REACH + 8) return this.hooks.openShop('black');
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
    // Прорванный КПП: гражданин (или ГСР) в коридоре может примкнуть к повстанцам.
    const front = ctx.war.frontAt(p.x, p.y);
    if (front && front.owner === 'rebels' && (p.faction === 'citizen' || p.faction === 'cwu') && ctx.war.pointAt(front, p.x, p.y) >= 0) {
      ctx.war.defect(p, front);
      return this.say('Вы примкнули к сопротивлению! Оружие выдали — держите КПП.', 'world');
    }
    const corpse = ctx.combat.corpseNear(p.x, p.y, REACH);
    // Спецагент: форма с убитого сотрудника Альянса, OTA из шкафа казармы, взлом камеры или клетки.
    if (p.faction === 'rebel' && p.profession === 'spec_agent') {
      const A = PARTISANS.agent;
      if (corpse && (corpse.faction === 'cp' || corpse.faction === 'ota') && !corpse.stripped) {
        this.task = { kind: 'dress', x: corpse.x, y: corpse.y, left: A.dress, total: A.dress, corpse };
        return this.say(`Снимаете форму с тела: ${corpse.name}…`, 'world');
      }
      const locker = ctx.map.poisOf('ota_spot').map((_, k) => poiWorld(ctx, 'ota_spot', k)).find((q) => d(q) < REACH + 8);
      if (locker) {
        this.task = { kind: 'dressOta', x: locker.x, y: locker.y, left: A.dress, total: A.dress };
        return this.say('Шкаф OTA: переодеваетесь…', 'world');
      }
      const cell = ctx.law.cells.find((c) => ctx.law.occupants(c).length > 0 && (d({ x: c.frontX, y: c.frontY }) < REACH + 8 || d(c) < REACH + 8));
      if (cell) {
        this.task = { kind: 'break', x: p.x, y: p.y, left: A.breakTime, total: A.breakTime, cell };
        return this.say(cell.cage ? 'Вскрываете клетку…' : 'Выбиваете дверь камеры…', 'world');
      }
    }
    // Партизан: передать ствол бандиту — пусть ГО получит своё чужими руками.
    if (p.faction === 'rebel' && p.profession === 'partisan') {
      const b = this.facingTarget(p, ctx, PARTISANS.arm.reach + 8, (o) => ctx.insurgency.armable(o));
      if (b) {
        ctx.insurgency.armBandit(p, b);
        return this.say(`Вы передали ствол бандиту ${b.name}. Он пойдёт на ГО.`, 'world');
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
        return this.say(`Взламываете раздатчик… ${CRIME.hack.time} с. Если увидит ГО — арест.`, 'world');
      }
    }
    // Штаб ГСР: гражданин у стойки найма — устроиться (глава оформляет туда, где не хватает рук).
    const hq = ctx.cwuHq;
    if (hq?.present && p.faction === 'citizen' && (d(hq.counter) < REACH + 12 || d(hq.applicantSpot) < REACH + 12)) {
      const head = hq.head;
      if (!head) return this.say('Главы ГСР нет на месте — приходите позже.');
      const prof = hq.vacancy();
      if (!prof) return this.say(`Глава ГСР: «${ctx.rng.pick(CWU_HQ.lines.noVacancy)}»`, 'world');
      hq.hire(p, prof, head);
      return;
    }
    // Работы ГСР: цех штаба, доставка коробок.
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
    // Мусор: уборщик и вортигонт убирают, остальные роются.
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
    // Повстанец: саботаж узла Альянса.
    const node = eco.nodes.find((r) => !r.broken && d(r) < REACH);
    if (node && p.faction === 'rebel') {
      this.sabotaging = { spot: node, progress: 0 };
      return this.say(`Саботаж узла… не отходите ${INSURGENCY.sabotageTime} с. ГО рядом быть не должно.`, 'world');
    }
    // ГСР: встать на выдачу / выдать следующему (это работа повара).
    if (p.faction === 'cwu' && p.profession !== 'cook' && eco.open && d(eco.dispenserSpot) < REACH) {
      return this.say('Рационы выдают повара ГСР. Ваша работа — в описании профессии (меню роли).');
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
      // Выдать недостающее из табельного набора и пополнить патроны; свои вещи не трогаем.
      for (const [id, qty] of KITS[cpKit(p.rank)] ?? []) {
        if (ITEMS[id].kind === 'weapon' && !p.inventory.has(id)) p.inventory.add(id, 1);
        else if (ITEMS[id].kind === 'medical' && p.inventory.count(id) < qty) p.inventory.add(id, qty - p.inventory.count(id));
      }
      eco.refillAmmo(p, 3);
      return this.say('Боекомплект пополнен.', 'world');
    }
    this.say('Рядом нечего использовать. E работает у терминала, прилавков, люков, окна раздачи, завода, мусора, поломок, узлов Альянса и тел.');
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
      return this.say(`Вы в форме: ${t.corpse.name}. Для ГО — свой; выдаст только убийство.`, 'world');
    }
    if (t.kind === 'dressOta') {
      ctx.insurgency.dressAsOta(p);
      return this.say('Вы в броне OTA. Для ГО — свой; выдаст только убийство.', 'world');
    }
    if (t.kind === 'break' && t.cell) {
      const n = ctx.insurgency.jailbreak(p, t.cell);
      return this.say(n > 0 ? `Камера вскрыта: сбежали ${n}. Уходите!` : 'В камере уже никого.', 'world');
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

  /** G: умение профессии или отряда ГО. */
  private special(p: Character, ctx: AiContext): void {
    // Медик ГСР: лечит за плату (гражданин платит, ГО — бесплатно).
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
      return this.say(`Бунт! Поднялись ${n} горожан. ГО будет занято ими.`, 'world');
    }
    // Партизан: маскировка под гражданина или ГСР (без оружия в руках).
    if (p.profession === 'partisan') {
      if (p.disguised) {
        p.disguised = false;
        p.cover = null;
        return this.say('Маскировка снята.', 'world');
      }
      if (p.weapon) return this.say('Уберите оружие (H), чтобы надеть маскировку.');
      if (ctx.combat.now - p.lastHurt < 10 || p.hostile) return this.say('Вас только что видели в бою — маскировка не поможет.');
      ctx.insurgency.giveCover(p);
      return this.say(`Вы в маскировке: для ГО вы ${p.cover?.faction === 'cwu' ? 'рабочий ГСР' : 'обычный гражданин'}. Выдаст только убийство; проверка CID — может, со стволом в руках ГО остановит.`, 'world');
    }
    if (p.faction !== 'cp') return this.say('Умение (G) есть у ГО и у некоторых профессий (медики, партизан).');
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
