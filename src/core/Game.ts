import { EventBus } from './EventBus';
import { Camera, type View } from './Camera';
import { Input } from './Input';
import { TouchControls } from '../ui/TouchControls';
import { GameLoop } from './GameLoop';
import { Rng, randomSeed } from './rng';
import { PlayerController } from './PlayerController';
import { RENDER } from '../config/render';
import { SUPPRESS } from '../config/tactics';
import { VISION } from '../config/vision';
import { CHARACTER } from '../config/entities';
import { FACTIONS, CP_DIVISIONS, rankOf, type FactionId, cpGroup, cpUnit, rebelUnitOf, CP_UNIT } from '../config/factions';
import { hasLoyalty, loyaltyTier } from '../systems/Loyalty';
import { displayName } from '../entities/cover';
import type { IdCardInfo } from '../ui/GameMenu';
import type { GameMap, Level } from '../world/GameMap';
import { NavGrid } from '../world/NavGrid';
import type { Poi } from '../world/GameMap';
import { MapRenderer } from '../world/MapRenderer';
import { FogRenderer } from '../world/FogRenderer';
import { VisibilityPolygon, canSeeCircle } from '../world/visibility';
import { generateCity } from '../world/generator/CityGenerator';
import { EntityManager } from '../entities/EntityManager';
import type { Character } from '../entities/Character';
import { createCharacter, nameFor, randomName, resetCids } from '../entities/factory';
import { resetPhrases } from '../systems/phrases';
import { stepPhysics } from '../entities/physics';
import type { PawnLook } from '../entities/PawnRenderer';
import { EntityRenderer } from '../entities/EntityRenderer';
import { WeaponWheel } from '../ui/WeaponWheel';
import { HUD } from '../config/hud';
import { MINIMAP } from '../config/minimap';
import { Particles } from '../world/Particles';
import { SquadArena } from '../systems/SquadArena';
import { ARENA, type ArenaSide } from '../config/arena';
import { AimRenderer } from '../entities/AimRenderer';
import { PathService } from '../ai/PathService';
import { AnchorBfs } from '../ai/yieldSearch';
import type { AiContext } from '../ai/AiContext';
import { updateNpcs } from '../ai/NpcController';
import { ZoneSystem } from '../systems/ZoneSystem';
import { DoorSystem } from '../systems/DoorSystem';
import { LawSystem } from '../systems/LawSystem';
import { spawnPopulation, roleSpawn, poiWorld, equipKit, cpKit, workplaceOf } from '../systems/Population';
import { EconomySystem } from '../systems/EconomySystem';
import { CombatSystem } from '../systems/CombatSystem';
import { WarSystem, type AlertCode } from '../systems/WarSystem';
import { UndergroundSystem } from '../systems/UndergroundSystem';
import { InsurgencySystem } from '../systems/InsurgencySystem';
import { LaborSystem } from '../systems/LaborSystem';
import { CrimeSystem } from '../systems/CrimeSystem';
import { ScannerSystem } from '../systems/ScannerSystem';
import { RosterSystem, roleHp } from '../systems/Roster';
import { ElectionSystem } from '../systems/ElectionSystem';
import { FamilySystem } from '../systems/Families';
import { SecuritySystem } from '../systems/Security';
import { CwuHqSystem } from '../systems/CwuHq';
import { ArsenalSystem } from '../systems/Arsenal';
import { PrisonSystem } from '../systems/Prison';
import { AcademySystem } from '../systems/Academy';
import { Staffing } from '../systems/Staffing';
import { Access } from '../systems/Access';
import { Radio, type Transmission } from '../systems/Radio';
import { Talk } from '../systems/Talk';
import { Relations, type PersonInfo } from '../systems/Relations';
import { serviceHint } from '../systems/Staffing';
import { StreetShops } from '../systems/StreetShops';
import { Housing } from '../systems/Housing';
import { Fence } from '../systems/Fence';
import { Routine } from '../systems/Routine';
import { Errands } from '../systems/Errands';
import { Brawls } from '../systems/Brawls';
import { GangSystem } from '../systems/Gangs';
import { ArsenalRenderer } from '../world/ArsenalRenderer';
import { PrisonRenderer } from '../world/PrisonRenderer';
import { AcademyRenderer } from '../world/AcademyRenderer';
import { furnishMap, type Furniture } from '../world/furnish';
import { drawFurnitureList } from '../world/FurnitureRenderer';
import { StreetLifeSystem } from '../systems/StreetLife';
import { ChatSystem } from '../systems/ChatSystem';
import { LOYALTY } from '../config/loyalty';
import { SAVE } from '../config/save';
import { capturePlayer, parseSave, applyToPlayer, decodeBits, type SaveData } from '../systems/SaveGame';
import { EffectsRenderer } from '../world/EffectsRenderer';
import { ECONOMY } from '../config/economy';
import type { DivisionId } from '../config/factions';
import { PROFESSIONS, DEFAULT_PROFESSION, type ProfessionId } from '../config/professions';
import { ITEMS, type ItemId, type WeaponId, type GrenadeId, type GearId, type GearSlot } from '../config/items';
import { wear, takeOff } from '../systems/Gear';
import { T } from '../world/tiles';
import { UI } from '../ui/UI';
import type { CheckChoice } from '../ui/CheckPanel';
import { DebugOverlay } from '../ui/DebugOverlay';
import { Lighting, clockText, dayFraction } from '../world/Lighting';
import { Ambience } from '../world/Ambience';
import { COZY } from '../config/lighting';

export interface GameOptions {
  npcs: number;
}

/**
 * Корневой объект: владеет картой, сущностями, системами и циклом.
 * Порядок тика: ввод игрока → ИИ NPC (+ очередь A*) → двери → физика → закон →
 * видимость (туман войны) → камера → зоны → UI.
 */
export class Game {
  readonly bus = new EventBus();
  readonly camera = new Camera();
  readonly input: Input;
  /** Сенсорное управление (телефон): стики и кнопки поверх холста. */
  readonly touch: TouchControls;
  readonly entities = new EntityManager();
  readonly loop: GameLoop;
  readonly debug = new DebugOverlay();
  readonly ui: UI;
  map!: GameMap;
  nav!: NavGrid;
  player!: Character;
  doors!: DoorSystem;
  law!: LawSystem;
  economy!: EconomySystem;
  /** Жильё (для карты: свой дом игрока). */
  get housing(): Housing {
    return this.ai.housing;
  }

  /** Банды и барыга (для карты). */
  get gangs(): GangSystem {
    return this.ai.gangs;
  }

  get prison(): PrisonSystem | null {
    return this.ai?.prison ?? null;
  }

  get fence(): Fence {
    return this.ai.fence;
  }
  combat!: CombatSystem;
  war!: WarSystem;
  insurgency!: InsurgencySystem;
  labor!: LaborSystem;
  private chat!: ChatSystem;
  private ai!: AiContext;
  private mapRenderer!: MapRenderer;
  /** Мебель (дома, казарма, канцелярия, комната OTA) — точки интереса карты. */
  /** Деревья садов (POI) и обстановка комнат (furnishMap). */
  private trees: Poi[] = [];
  private furnishings: Furniture[] = [];
  private readonly ctx: CanvasRenderingContext2D;
  private readonly entityRenderer = new EntityRenderer();
  /** Колесо оружия (зажать Q). */
  private readonly wheel = new WeaponWheel();
  private readonly fog = new FogRenderer();
  private readonly effects = new EffectsRenderer();
  /** Свет и время суток, дымок из труб, пылинки, зерно (только картинка). */
  private readonly lighting = new Lighting();
  private readonly ambience = new Ambience();
  private readonly arsenalView = new ArsenalRenderer();
  private readonly prisonView = new PrisonRenderer();
  private readonly academyView = new AcademyRenderer();
  private readonly aim = new AimRenderer();
  /** Частицы боя, тряска экрана, маркер попадания (только отрисовка). */
  private readonly particles = new Particles();
  /** Бетонные блоки, поставленные игроком-GRID (самый старый убирается). */
  private placedBarriers: number[] = [];
  private readonly sight = new VisibilityPolygon(VISION.rays);
  private readonly zones: ZoneSystem;
  private readonly playerCtl: PlayerController;
  private rng = new Rng(randomSeed());
  private vignette: CanvasGradient | null = null;
  /** Тёмные края под огнём и красные — при тяжёлом ранении (градиенты один раз на размер экрана). */
  private pressVignette: CanvasGradient | null = null;
  private downVignette: CanvasGradient | null = null;
  /** Выбранная роль игрока (сохраняется при смене карты). */
  private role: { faction: FactionId; rank: number; division: DivisionId | null; profession?: ProfessionId | null } | null = null;
  /** Гражданское имя игрока (для ролей без позывного). */
  private civilName = '';
  time = 0;
  /** Сохранение, которое применить после генерации карты (продолжение игры). */
  private pendingSave: SaveData | null = null;
  private saveTimer: number = SAVE.interval;
  paused = false;
  /** Уровень, на котором игрок (для камеры и тумана). */
  private level: Level = 'city';

  constructor(
    private readonly canvas: HTMLCanvasElement,
    uiRoot: HTMLElement,
    private readonly opts: GameOptions,
  ) {
    // Атмосфера (свет, дымок, зерно) — как выбрал игрок в прошлый раз.
    try {
      const on = localStorage.getItem(COZY.storageKey) !== '0';
      this.lighting.enabled = this.ambience.enabled = on;
    } catch {
      /* по умолчанию включена */
    }
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.input = new Input(canvas);
    this.zones = new ZoneSystem(this.bus);
    this.ui = new UI(uiRoot, this.bus, this);
    this.playerCtl = new PlayerController(this.input, this.camera, this.bus, {
      openRoleMenu: () => this.ui.roles.open(false),
      menuOpen: () => this.ui.roles.isOpen,
      openShop: (kind, street) => this.ui.shop.open(kind, street ?? null),
      toggleInventory: () => this.ui.inventory.toggle(),
      placeBarrier: () => this.placeBarrier(),
      checkPanelTarget: () => this.ui.check.target,
      closeCheckPanel: (c) => this.ui.check.choose(c),
      openCodePanel: () => this.ui.code.open(),
      codePanelOpen: () => this.ui.code.isOpen,
      chooseCode: (c) => this.ui.code.choose(c),
      closeCodePanel: () => this.ui.code.close(),
      wheel: this.wheel,
      setSlow: (on) => (this.loop.timeScale = on ? HUD.wheel.slow : 1),
      setMarker: (x, y) => (this.ui.mapView.marker = { x, y, level: 'city' }),
    });
    this.touch = new TouchControls(uiRoot, {
      input: this.input,
      camera: this.camera,
      canvas,
      wheelOpen: () => this.wheel.open,
      escape: () => this.escape(),
      openChat: () => {
        if (this.ui.chat.isOpen || this.ui.roles.isOpen || this.ui.menu.isOpen) return;
        this.input.releaseAll();
        this.ui.chat.open('');
      },
      busy: () => this.ui.menu.isOpen || this.ui.roles.isOpen || this.ui.inventory.isOpen || this.ui.contacts.isOpen || this.ui.mapView.bigOpen || this.ui.shop.isOpen || this.ui.chat.isOpen,
      playing: () => !this.ui.menu.isOpen && !this.ui.roles.isOpen,
    });
    this.loop = new GameLoop(
      (dt) => this.update(dt),
      (a) => this.render(a),
    );
    window.addEventListener('resize', () => this.resize());
    // Надзор вызвал игрока из силового блока на происшествие — метка на карте.
    this.bus.on('radio:call', ({ x, y }) => {
      this.ui.mapView.marker = { x, y, level: 'city' };
    });
    // Игрок избран Комендантом — новая роль (сохраняется).
    this.bus.on('elected', ({ who }) => {
      if (who !== this.player) return;
      this.role = { faction: 'admin', rank: 0, division: null, profession: null };
      this.save();
    });
    // Победа восстания (Управа взят, Комендант мёртв): через паузу — новый город, роль прежняя.
    // Перезапуск — в начале следующего тика, не посреди обновления систем.
    this.bus.on('restart', () => {
      this.restartPending = true;
    });
    // Игрок примкнул к повстанцам у прорванного КПП — новая роль (сохраняется).
    this.bus.on('defected', ({ who }) => {
      if (who !== this.player) return;
      this.role = { faction: 'rebel', rank: 0, division: null, profession: 'rebel_soldier' };
      this.bus.emit('announce', { text: 'Вы примкнули к сопротивлению' });
      this.save();
    });
    // Служба ВС: повышение (Staffing), зачисление в академию и присяга (Academy) — роль игрока следом.
    this.bus.on('promoted', ({ rank, post }) => {
      if (!this.role || this.role.faction !== 'cp') return;
      this.role = { ...this.role, rank, division: cpGroup(rank) };
      this.bus.emit('announce', { text: `Приказ: вы — ${cpUnit(rank).short}` });
      this.bus.emit('log', { text: `Повышение: ${cpUnit(rank).name} — ${post}.`, kind: 'system' });
      this.save();
    });
    this.bus.on('enlisted', ({ who }) => {
      if (who !== this.player) return;
      this.role = { faction: 'cp', rank: CP_UNIT.cdt, division: 'pcu', profession: null };
      this.bus.emit('announce', { text: 'Вы зачислены курсантом Академии ВС' });
      this.bus.emit('log', { text: 'Академия: ходите на занятия по распорядку (строка вверху подскажет, где и что). Набрали баллы — экзамен, сдали — присяга и служба RCT.', kind: 'system' });
      this.save();
    });
    this.bus.on('graduated', ({ who, rank, name }) => {
      if (who !== this.player) return;
      this.role = { faction: 'cp', rank, division: cpGroup(rank), profession: null };
      this.bus.emit('announce', { text: `Присяга принята: ${cpUnit(rank).short} ${name}` });
      this.save();
    });
    // Игрока приняли в штабе ТС — рабочий ТС (сохраняется).
    this.bus.on('hired', ({ who, profession }) => {
      if (who !== this.player) return;
      this.role = { faction: 'cwu', rank: 0, division: null, profession };
      this.bus.emit('announce', { text: 'Вы приняты в ТС' });
      this.save();
    });
    // Esc: закрыть открытую панель или открыть меню паузы (перехват до остальных обработчиков).
    window.addEventListener('keydown', (e) => this.onEscape(e), true);
    // Сохранить при закрытии/сворачивании вкладки.
    window.addEventListener('beforeunload', () => this.save());
    document.addEventListener('visibilitychange', () => document.hidden && this.save());
    this.resize();
  }

  get fps(): number {
    return this.loop.fps;
  }

  get npcCount(): number {
    return this.entities.list.length - 1;
  }

  /** Новая карта по seed (или случайному). */
  regenerate(seed = randomSeed()): void {
    this.setMap(generateCity(seed), 'generated');
  }

  loadMap(map: GameMap): void {
    this.setMap(map, 'file');
  }

  private setMap(map: GameMap, source: 'generated' | 'file'): void {
    this.map = map;
    this.nav = new NavGrid(map);
    this.mapRenderer = new MapRenderer(map);
    this.trees = map.pois.filter((p) => p.type === 'tree');
    this.furnishings = furnishMap(map);
    this.rng = new Rng(map.seed ^ 0x51f15e);
    this.doors = new DoorSystem(map, this.nav);
    this.law = new LawSystem(map, this.nav, this.doors, this.entities, this.bus, this.rng);
    this.economy = new EconomySystem(map, this.entities, this.bus, this.rng);
    this.combat = new CombatSystem(map, this.entities, this.bus, this.rng, this.law);
    this.placedBarriers = [];
    this.ai = {
      map,
      nav: this.nav,
      paths: new PathService(map, this.nav),
      bfs: new AnchorBfs(this.nav),
      entities: this.entities,
      rng: this.rng,
      player: null,
      time: this.time,
      law: this.law,
      doors: this.doors,
      bus: this.bus,
      economy: this.economy,
      combat: this.combat,
      underground: new UndergroundSystem(map, this.nav, this.entities),
      war: null as unknown as WarSystem,
      insurgency: null as unknown as InsurgencySystem,
      labor: null as unknown as LaborSystem,
      crime: null as unknown as CrimeSystem,
      scanners: null as unknown as ScannerSystem,
      roster: null as unknown as RosterSystem,
      elections: null as unknown as ElectionSystem,
      street: null as unknown as StreetLifeSystem,
      families: null as unknown as FamilySystem,
      security: null as unknown as SecuritySystem,
      cwuHq: null as unknown as CwuHqSystem,
      arsenal: null as unknown as ArsenalSystem,
      prison: null as unknown as PrisonSystem,
      shops: null as unknown as StreetShops,
      housing: null as unknown as Housing,
      fence: null as unknown as Fence,
      gangs: null as unknown as GangSystem,
      routine: null as unknown as Routine,
      errands: null as unknown as Errands,
      brawls: null as unknown as Brawls,
      academy: null as unknown as AcademySystem,
      staffing: null as unknown as Staffing,
      access: null as unknown as Access,
      radio: null as unknown as Radio,
      talk: null as unknown as Talk,
      relations: null as unknown as Relations,
    };
    this.ai.routine = new Routine(this.ai);
    this.ai.errands = new Errands(this.ai);
    this.war = new WarSystem(this.ai);
    this.ai.war = this.war;
    this.insurgency = new InsurgencySystem(this.ai);
    this.ai.insurgency = this.insurgency;
    this.labor = new LaborSystem(this.ai);
    this.ai.labor = this.labor;
    this.ai.crime = new CrimeSystem(this.ai);
    this.ai.scanners = new ScannerSystem(this.ai);
    this.ai.roster = new RosterSystem(this.ai);
    this.ai.elections = new ElectionSystem(this.ai);
    this.ai.street = new StreetLifeSystem(this.ai);
    this.ai.families = new FamilySystem(this.ai);
    this.ai.security = new SecuritySystem(this.ai);
    this.ai.cwuHq = new CwuHqSystem(this.ai);
    this.ai.arsenal = new ArsenalSystem(this.ai);
    this.ai.prison = new PrisonSystem(this.ai);
    this.ai.shops = new StreetShops(this.ai);
    this.ai.housing = new Housing(this.ai);
    this.ai.fence = new Fence(this.ai);
    this.ai.gangs = new GangSystem(this.ai);
    this.ai.brawls = new Brawls(this.ai);
    this.ai.staffing = new Staffing(this.ai);
    this.ai.academy = new AcademySystem(this.ai);
    this.ai.access = new Access(this.ai);
    this.ai.talk = new Talk(this.ai);
    this.ai.relations = new Relations(this.ai);
    this.ai.radio = new Radio(this.ai);
    this.entityRenderer.relations = this.ai.relations;
    this.entityRenderer.families = this.ai.families;
    this.entityRenderer.gangs = this.ai.gangs;
    this.lighting.setWorld(map, this.ai.street.lamps, this.ai.street.barrels, this.economy.nodes);
    this.ambience.setWorld(this.mapRenderer.chimneyPoints());
    this.fireSpots = [...this.ai.street.barrels.map((b) => ({ x: b.x, y: b.y })), ...(['rebel_camp', 'rebel_base'] as const).map((t) => poiWorld(this.ai, t)).filter((q): q is { x: number; y: number } => q !== null)];
    this.economy.onEmpty = () => this.labor.noticeEmpty();
    // Раздача — только днём (распорядок), и не в комендантский час (WarSystem).
    const warPause = this.economy.paused;
    this.economy.paused = () => warPause() || !this.ai.routine.rationsHours();
    this.chat = new ChatSystem(this.ai);
    this.law.curfewCheck = (c) => this.war.curfewViolation(c);
    this.law.panicking = (c) => c.panicUntil > this.law.now;
    this.law.trespass = (c) => this.ai.access.trespassing(c);
    this.law.merit = (c, pts) => this.ai.staffing.merit(c, pts);
    this.law.onContraband = (c) => this.ai.errands.found(c);
    this.entities.clear();
    resetCids();
    resetPhrases();
    this.playerCtl.reset();
    this.ui.check.hide();
    const start = roleSpawn(this.ai, 'citizen');
    this.player = createCharacter(this.entities, this.rng, 'citizen', start.x, start.y, true);
    this.civilName = this.player.name;
    this.ai.player = this.player;
    this.ai.relations.register(this.player);
    spawnPopulation(this.ai, this.opts.npcs);
    const save = this.pendingSave && this.pendingSave.seed === map.seed && source === 'generated' ? this.pendingSave : null;
    this.pendingSave = null;
    this.ui.mapView.reset(map, save ? decodeBits(save.explored, map.width * map.height) : null, save?.hatches);
    if (save) this.restore(save);
    else if (this.role) this.applyRole(this.role.faction, this.role.rank, this.role.division, false, this.role.profession ?? null);
    else this.ui.roles.open(true);
    this.zones.reset();
    this.camera.snapTo(this.player.x, this.player.y);
    this.bus.emit('map:loaded', { seed: map.seed, stats: map.stats, source });
    if (source === 'generated') {
      // В песочнице (например, опубликованная страница) адрес менять нельзя — это не ошибка.
      try {
        const url = new URL(location.href);
        url.searchParams.set('seed', String(map.seed));
        url.searchParams.delete('map');
        history.replaceState(null, '', url);
      } catch {
        /* нет доступа к адресу */
      }
    }
  }

  /** Выбор роли из меню. */
  chooseRole(faction: FactionId, rank: number, division: DivisionId | null = null, profession: ProfessionId | null = null, name: string | null = null): void {
    // Имя из меню роли — для всех, кроме ВС (у ВС позывной назначается).
    if (name && faction !== 'cp') this.civilName = name.trim();
    const prof = profession && PROFESSIONS[profession]?.faction === faction ? profession : DEFAULT_PROFESSION[faction] ?? null;
    this.role = { faction, rank, division: faction === 'cp' ? cpGroup(rank) : division, profession: prof };
    this.applyRole(faction, rank, this.role.division, true, prof);
    this.save();
  }

  private applyRole(faction: FactionId, rank: number, division: DivisionId | null, announce: boolean, profession: ProfessionId | null = null): void {
    const p = this.player;
    const law = p.law;
    // Если сидел — освобождаем камеру.
    this.law.vacate(p);
    for (const o of this.entities.list) if (o.law.handler === p) this.law.clear(o);
    this.ui.check.hide();
    this.playerCtl.reset();
    this.economy.leaveQueue(p);
    this.economy.releaseDispenser(p);
    p.faction = faction;
    // У сопротивления юнит — по профессии (config/factions.ts, REBEL_RANKS).
    p.rank = faction === 'rebel' ? rebelUnitOf(profession)?.rank ?? 0 : rank;
    p.division = faction === 'cp' ? cpGroup(p.rank) : null;
    void division;
    p.profession = profession && PROFESSIONS[profession]?.faction === faction ? profession : DEFAULT_PROFESSION[faction] ?? null;
    p.disguised = false;
    p.cover = null;
    p.carrying = false;
    p.burnUntil = 0;
    p.alive = true;
    p.health = p.maxHealth;
    p.hunger = ECONOMY.hunger.max;
    p.hostile = false;
    p.panicUntil = 0;
    // Новая роль — лояльность с чистого листа (при возрождении сохраняется).
    if (announce) p.loyalty = faction === 'cwu' ? LOYALTY.playerStart.cwu : LOYALTY.playerStart.citizen;
    const profKit = p.profession ? PROFESSIONS[p.profession].kit : undefined;
    const kit = faction === 'cp' ? cpKit(p.rank) : profKit ?? faction;
    equipKit(p, kit, this.ai);
    // Жителям оружие на виду ни к чему; повстанец начинает в убежище — с оружием в руках (Q/H — убрать).
    if (faction !== 'cp' && faction !== 'rebel') this.combat.equip(p, null);
    // Партизан выходит в маскировке, без оружия в руках.
    const underground = p.profession === 'partisan' || p.profession === 'spec_agent';
    if (underground) this.combat.equip(p, null);
    // Курсант академии — под своим именем (позывной дают на присяге), остальные ВС — с позывным.
    const cadet = faction === 'cp' && p.rank === CP_UNIT.cdt;
    p.name = faction === 'cp' && !cadet ? nameFor(this.rng, 'cp') : this.civilName || randomName(this.rng);
    p.cadet = cadet ? { drill: 0, fitness: 0, theory: 0, fire: 0, accuracy: 0, shots: 0, hits: 0, since: this.law.now, passed: false, exams: 0 } : null;
    // Служба ВС — с нуля; прежняя должность (если игрок её занимал) свободна.
    this.ai.staffing?.vacate(p);
    p.merit = 0;
    p.serviceSince = this.law.now;
    p.money = CHARACTER.roleMoney[faction] ?? CHARACTER.startMoney;
    p.brain = null;
    Object.assign(law, {
      hasCid: true, wanted: faction === 'rebel' && !underground, phase: 'none', handler: null, reason: null,
      cell: -1, jailUntil: 0, savedBrain: null, lastCheck: this.law.now,
    });
    // Подпольщик и спецагент выходят под личиной горожанина или ТС.
    if (underground) this.insurgency.giveCover(p);
    const barracks = cadet ? this.ai.academy?.barracks : null;
    const spot = barracks ?? roleSpawn(this.ai, faction, p.profession);
    // Глава восстания один: выбрал игрок — NPC-глава становится ветераном.
    if (faction === 'rebel' && p.profession === 'rebel_leader') this.war.command.demoteNpcLeader();
    const hp = roleHp(faction, p.rank, p.profession);
    p.maxHealth = hp ?? CHARACTER.maxHealth;
    p.health = p.maxHealth;
    p.x = p.prevX = spot.x;
    p.y = p.prevY = spot.y;
    p.vx = p.vy = p.wantX = p.wantY = 0;
    this.camera.snapTo(p.x, p.y);
    // Свой дом (жителю) или явка с тайником (подпольщику) — кружок на карте (M).
    const H = this.ai.housing;
    if (H) {
      H.evict(p);
      // Бандит — в банду, где людей меньше (комната её общаги); остальные жители — свой дом.
      this.ai.gangs?.leave(p);
      const gang = p.profession === 'bandit' ? this.ai.gangs?.join(p) ?? null : null;
      if (gang && announce) this.bus.emit('log', { text: `Вы в банде «${gang.def.name}»: район — ${gang.quarter || 'у общаги'}, общак в общаге (E). Чужих на районе не терпят.`, kind: 'system' });
      const d = gang ? H.of(p) : faction === 'citizen' || faction === 'cwu' || faction === 'vort' || underground ? H.house(p, workplaceOf(this.ai, p)) : null;
      if (d && announce && !underground) this.ai.relations.seedPlayer(p);
      if (d && announce) this.bus.emit('log', { text: underground ? 'Ваша явка в городе отмечена на карте (M): E в комнате — спрятать добычу или взять из тайника.' : 'Ваш дом отмечен на карте (M) кружком.', kind: 'system' });
    }
    if (announce) {
      const r = rankOf(faction, rank);
      const div = p.division ? ` · ${CP_DIVISIONS[p.division].name}` : '';
      const pr = p.profession && p.profession !== DEFAULT_PROFESSION[faction] ? ` · ${PROFESSIONS[p.profession].name}` : '';
      this.bus.emit('log', { text: `Вы теперь: ${FACTIONS[faction].role}${r ? ` (${r.name})` : ''}${div}${pr} — ${p.name}`, kind: 'system' });
      if (p.profession) for (const t of PROFESSIONS[p.profession].perks) this.bus.emit('log', { text: `• ${t}`, kind: 'system' });
      this.bus.emit('log', { text: 'Жители запоминают, что вы делаете: E перед человеком — поговорить, K — знакомые. Добро помнят — обиды тоже.', kind: 'system' });
    }
  }

  private onEscape(e: KeyboardEvent): void {
    if (e.code !== 'Escape') return;
    this.escape(true);
  }

  /**
   * Esc (и кнопка ☰ на телефоне): закрыть открытую панель, иначе меню паузы. key — нажата клавиша: у меню
   * роли и большой карты свои обработчики Esc; с телефона их закрываем здесь.
   */
  escape(key = false): void {
    const ui = this.ui;
    if (!key) {
      if (ui.mapView.bigOpen) return ui.mapView.toggleBig(false);
      if (ui.roles.isOpen) return;
    }
    if (ui.chat.isOpen) return;
    if (ui.menu.isOpen) {
      ui.menu.back();
      return;
    }
    // Свои обработчики Esc у меню роли и большой карты.
    if (ui.roles.isOpen || ui.mapView.bigOpen || ui.check.target) return;
    if (ui.shop.isOpen) return ui.shop.close();
    if (ui.code.isOpen) return ui.code.close();
    if (ui.inventory.isOpen) return ui.inventory.toggle();
    if (ui.contacts.isOpen) return ui.contacts.toggle();
    this.input.releaseAll();
    ui.menu.open('pause');
  }

  /** Меню: идёт ли игра (есть роль), продолжить, сменить роль, звук. */
  canContinue(): boolean {
    return this.role !== null;
  }

  continueGame(): void {
    if (!this.role) this.ui.roles.open(true);
    this.canvas.focus();
  }

  changeRole(): void {
    this.ui.roles.open(!this.role);
  }

  toggleSound(): boolean {
    return this.ui.audio.toggle();
  }

  /** Кадров мало (слабая машина) — сколько секунд подряд; атмосфера упрощается (COZY.autoLite). */
  private slowFor = 0;

  private autoLite(dt: number): void {
    if (!this.lighting.enabled || this.lighting.lite) return;
    const A = COZY.autoLite;
    this.slowFor = this.fps > 0 && this.fps < A.fps ? this.slowFor + dt : 0;
    if (this.slowFor < A.after) return;
    this.lighting.lite = this.ambience.lite = true;
    this.bus.emit('log', { text: 'Атмосфера упрощена под эту машину (без зерна и свечения). Полная или выкл — Esc → «Атмосфера».', kind: 'system' });
  }

  /** Атмосфера (свет и время суток, дымок, зерно): вкл/выкл — для слабых машин; помнится в браузере. */
  toggleLighting(): boolean {
    const on = !this.lighting.enabled;
    this.lighting.enabled = this.ambience.enabled = on;
    // Снова включили — снова полная (упростится сама, если не тянет).
    this.lighting.lite = this.ambience.lite = false;
    this.slowFor = 0;
    try {
      localStorage.setItem(COZY.storageKey, on ? '1' : '0');
    } catch {
      /* не запомним — не страшно */
    }
    return on;
  }

  get lightingOn(): boolean {
    return this.lighting.enabled;
  }

  get lightingLite(): boolean {
    return this.lighting.lite;
  }

  /** Где горит огонь (бочки, костёр лагеря, светильники убежища) — треск рядом в звуковом фоне. */
  fireSpots: { x: number; y: number }[] = [];

  get darkness(): number {
    return this.lighting.darkness(this.time);
  }

  /** Строка HUD о городе: поручение с доски (адрес и срок), ночью — предупреждение гражданским. */
  get cityHint(): string {
    const ai = this.ai;
    if (!ai?.errands || !this.player) return '';
    const out: string[] = [];
    const a = ai.errands.active;
    if (a) {
      const left = Math.max(0, Math.ceil(a.until - this.law.now));
      out.push(`Поручение${a.secret ? ' (тайное — не попадитесь на проверке)' : ''}: ${a.name}, ${a.zone} · ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`);
    }
    if (ai.routine.night && ai.errands.canTake(this.player)) out.push('Ночь: на улицах проверяют чаще, на районах банд грабят');
    const p = this.player;
    const cadet = ai.academy?.hint(p);
    if (cadet) out.push(cadet.text);
    else if (p.faction === 'cp' && ai.staffing) out.push(serviceHint(p, ai.staffing));
    return out.join('\n');
  }

  /** Склад Протектората (для строки HUD). */
  get radioFeed(): readonly Transmission[] {
    return this.ai?.radio?.feed ?? [];
  }

  get arsenal(): ArsenalSystem | null {
    return this.ai?.arsenal ?? null;
  }

  /** Часы и время суток для HUD: «19:40 · вечер». */
  get clock(): string {
    return `${clockText(dayFraction(this.time))} · ${this.lighting.day(this.time).name}`;
  }

  get soundMuted(): boolean {
    return this.ui.audio.muted;
  }

  /** Прочитать сохранение из браузера (null — нет или повреждено). */
  static readSave(): SaveData | null {
    try {
      return parseSave(localStorage.getItem(SAVE.key));
    } catch {
      return null;
    }
  }

  /** Продолжить сохранённую игру: та же карта, та же роль и вещи. */
  resume(save: SaveData): void {
    this.pendingSave = save;
    this.regenerate(save.seed);
  }

  /** Сохранить сейчас (если роль выбрана и игрок жив; в «отряд на отряд» — нет). */
  save(): boolean {
    if (!this.role || !this.player?.alive || this.arena) return false;
    const data = capturePlayer(this.player, this.map.seed, this.role, this.civilName, { explored: this.ui.mapView.explored, hatches: this.ui.mapView.hatches }, Date.now(), this.ai.relations.serialize());
    try {
      localStorage.setItem(SAVE.key, JSON.stringify(data));
      return true;
    } catch {
      return false;
    }
  }

  /** Новая игра: стереть сохранение, новый город, выбор роли. */
  newGame(): void {
    try {
      localStorage.removeItem(SAVE.key);
    } catch {
      /* нет хранилища */
    }
    this.role = null;
    this.civilName = '';
    this.regenerate();
  }

  private restore(save: SaveData): void {
    this.role = { ...save.role };
    this.civilName = save.civilName || this.civilName;
    this.applyRole(save.role.faction, save.role.rank, save.role.division, false, save.role.profession ?? null);
    applyToPlayer(this.player, save);
    // Знакомства и память отношений — тем же людям (карта та же, имена сверяются).
    this.ai.relations.restore(save.social);
    const p = this.player;
    // Позиция — если там можно стоять (карта та же).
    if (save.pos) {
      const a = this.nav.nearestWalkable(save.pos.x, save.pos.y, 2);
      if (a >= 0) {
        p.x = p.prevX = this.nav.worldX(a);
        p.y = p.prevY = this.nav.worldY(a);
      }
    }
    const when = new Date(save.savedAt).toLocaleString('ru-RU');
    this.bus.emit('log', { text: `Игра продолжена (сохранение от ${when}). Новая игра — у терминала найма или в меню роли.`, kind: 'system' });
  }

  /** Меню роли: имя, под которым игрок живёт в городе (у ВС — гражданское имя до службы). */
  currentName(): string {
    return this.civilName || (this.player && this.player.faction !== 'cp' ? this.player.name : '');
  }

  suggestName(): string {
    return randomName(this.rng);
  }

  /** Удостоверение в меню: как игрока видит проверяющий (под личиной — личина); роли нет — бланк. */
  idCard(): IdCardInfo | null {
    const p = this.player;
    if (!this.role || !p) return null;
    const cover = p.disguised ? p.cover : null;
    const faction = cover?.faction ?? p.faction;
    const rank = cover ? cover.rank : p.rank;
    const prof = cover ? cover.profession : p.profession;
    let detail = '';
    if (faction === 'cp') detail = cpUnit(rank).name;
    else if (faction === 'rebel') detail = rebelUnitOf(prof)?.def.name ?? '';
    else if (prof && prof !== DEFAULT_PROFESSION[faction]) detail = PROFESSIONS[prof].name;
    const tier = hasLoyalty(p) ? loyaltyTier(p) : null;
    return {
      name: displayName(p),
      cid: p.cid,
      role: FACTIONS[faction].role,
      detail,
      loyalty: tier ? { name: tier.name, color: tier.color, points: Math.round(p.loyalty) } : null,
      money: Math.floor(p.money),
      look: this.pawnLook(p),
      weapon: p.weapon,
      wanted: p.law.wanted,
      forged: !!cover && p.faction === 'rebel',
      seed: this.map.seed,
      clock: this.clock,
    };
  }

  /** Внешность пешки (портрет HUD, пешка в инвентаре) — как на карте. */
  pawnLook(c: Character): PawnLook {
    return this.entityRenderer.lookOf(c);
  }

  /** Инвентарь игрока: съесть/применить. */
  useItem(id: ItemId): void {
    if (!this.player.alive) return;
    if (this.economy.use(this.player, id)) this.bus.emit('log', { text: `Вы использовали: ${ITEMS[id].name}.`, kind: 'system' });
  }

  /** Инвентарь: надеть шлем, бронежилет, рюкзак. */
  wearGear(id: GearId): void {
    if (!this.player.alive) return;
    const err = wear(this.player, id);
    this.bus.emit('log', { text: err ?? `Вы надели: ${ITEMS[id].name}.`, kind: 'system' });
  }

  /** Инвентарь: снять надетое в рюкзак. */
  takeOffGear(slot: GearSlot): void {
    if (!this.player.alive) return;
    const id = this.player.gear[slot];
    const err = takeOff(this.player, slot);
    this.bus.emit('log', { text: err ?? `Вы сняли: ${id ? ITEMS[id].name : ''}.`, kind: 'system' });
  }

  /** Инвентарь: выбрать гранату для T. */
  chooseGrenade(id: GrenadeId): void {
    if (this.player.inventory.has(id)) this.player.grenadeKind = id;
  }

  /** Взять оружие в руки (null — убрать). Житель с оружием в руках — нарушитель. */
  equipItem(id: WeaponId | null): void {
    if (!this.player.alive) return;
    this.combat.equip(this.player, id);
  }

  say(text: string): void {
    this.chat.submit(this.player, text);
  }

  focusGame(): void {
    this.canvas.focus();
  }

  /** Знакомые игрока (панель K): кто его знает и как относится. */
  contacts(): PersonInfo[] {
    return this.ai?.relations?.enabled ? this.ai.relations.contacts(this.player) : [];
  }

  shopPrice(id: ItemId): number | undefined {
    // Лавка проспекта: цена зависит от того, как продавец относится к покупателю.
    const street = this.ui.shop.kind === 'street' ? this.ui.shop.street : null;
    const v = street && street.sub !== 'cwu' && street.vendor?.alive ? street.vendor : null;
    const mul = v && this.ai.relations?.enabled ? this.ai.relations.priceMul(v, this.player) : 1;
    return this.economy.shopPrice(this.player, id, mul);
  }

  buyBlack(k: number): string | null {
    // Чёрный рынок — барыга в своей хате (стволы и гранаты — что принесли).
    return this.ai.fence?.present ? this.ai.fence.buy(this.player, k) : this.economy.buyBlack(this.player, k);
  }

  blackInStock(k: number): boolean {
    return this.ai.fence?.present ? this.ai.fence.inStock(k) : true;
  }

  sellItem(id: ItemId): string | null {
    return this.ai.fence?.present ? this.ai.fence.sell(this.player, id) : this.economy.sellBlack(this.player, id);
  }

  get blackMarketCounter(): { x: number; y: number } | null {
    return this.insurgency?.market ?? null;
  }

  buyItem(id: ItemId): string | null {
    // Лавка проспекта: продавец на месте, товар есть — единица запаса уходит.
    const street = this.ui.shop.kind === 'street' ? this.ui.shop.street : null;
    if (street) return this.ai.shops.buy(this.player, street, id);
    return this.economy.buy(this.player, id);
  }

  /** Возрождение игрока после гибели: прежняя роль, штраф к токенам. */
  private respawn(): void {
    const p = this.player;
    // Силовой блок не возрождается: погибший ВС (и курсант) — в городе появляется новый житель.
    if (this.role?.faction === 'cp') {
      this.civilName = randomName(this.rng);
      // Новый человек с новым именем: прежние знакомые его не узнают, он их — тоже.
      this.ai.relations.forget(p.pid);
      this.role = { faction: 'citizen', rank: 0, division: null, profession: DEFAULT_PROFESSION.citizen ?? null };
      this.applyRole('citizen', 0, null, true, this.role.profession ?? null);
      this.bus.emit('announce', { text: 'Ваш юнит погиб. ВС не возрождаются — вы новый житель города' });
      this.bus.emit('log', { text: 'Силовой блок не возрождается: должность займёт младший по званию. Вы — новый гражданин. Хотите снова служить — академия ВС (нужна лояльность).', kind: 'system' });
      this.save();
      return;
    }
    const money = Math.floor(p.money * (1 - ECONOMY.deathTokenLoss));
    const r = this.role ?? { faction: 'citizen' as FactionId, rank: 0, division: null };
    this.applyRole(r.faction, r.rank, r.division, false);
    p.money = money;
    this.bus.emit('log', { text: `Вы очнулись. Потеряно ${Math.round(ECONOMY.deathTokenLoss * 100)}% токенов.`, kind: 'system' });
  }

  /**
   * GRID: поставить бетонный блок перед собой (не больше трёх — старый убирается).
   * Возвращает текст ошибки или null.
   */
  placeBarrier(): string | null {
    const p = this.player;
    const ts = this.map.tileSize;
    const tx = Math.floor((p.x + Math.cos(p.facing) * 28) / ts);
    const ty = Math.floor((p.y + Math.sin(p.facing) * 28) / ts);
    const t = this.map.tileAt(tx, ty);
    const allowed = t === T.FLOOR || t === T.STREET || t === T.BUNKER || t === T.PLAZA || t === T.WASTE;
    if (!allowed) return 'Сюда блок не поставить.';
    const cx = (tx + 0.5) * ts;
    const cy = (ty + 0.5) * ts;
    if (this.entities.near(cx, cy, 20).length > 0) return 'Место занято.';
    const i = ty * this.map.width + tx;
    this.map.tiles[i] = T.BARRIER;
    this.placedBarriers.push(i);
    if (this.placedBarriers.length > 3) {
      const old = this.placedBarriers.shift()!;
      this.map.tiles[old] = T.BUNKER;
      this.refreshTile(old);
    }
    this.refreshTile(i);
    return null;
  }

  private refreshTile(i: number): void {
    const w = this.map.width;
    const x = i % w;
    const y = (i - x) / w;
    this.nav.refresh(x - 1, y - 1, x + 1, y + 1);
    this.mapRenderer.refresh(x, y);
  }

  /** Решение игрока-ВС по проверке CID (панель или клавиши 1/2/3). */
  /** Терминал кодов тревоги в кабинете Коменданта. */
  setAlertCode(code: AlertCode): void {
    const err = this.war.setCode(code, this.player);
    if (err) this.bus.emit('log', { text: err, kind: 'system' });
  }

  resolveCheck(target: Character, choice: CheckChoice): void {
    this.playerCtl.resolve(this.player, target, choice, this.ai);
  }

  /** Кого видит игрок: прямая видимость до кружка в пределах дальности обзора. */
  /** Радиус обзора игрока: в канализации темно — видно меньше. */
  private get sightRadius(): number {
    return this.map.levelAt(this.player.x, this.player.y) === 'sewer' ? VISION.sewerRadius : VISION.radius;
  }

  private updateVisibility(): void {
    const p = this.player;
    const radius = this.sightRadius;
    this.sight.compute(this.map, p.x, p.y, radius, VISION.wallBleed);
    const r2 = (radius + 20) ** 2;
    for (const c of this.entities.list) {
      if (c === p) {
        c.visible = true;
        continue;
      }
      const dx = c.x - p.x;
      const dy = c.y - p.y;
      c.visible = dx * dx + dy * dy < r2 && canSeeCircle(this.map, p.x, p.y, c.x, c.y, c.radius);
      // Чужой, присевший за бетонным блоком, не виден, пока не выстрелит.
      if (c.visible && c.crouch && FACTIONS[c.faction].authority !== FACTIONS[p.faction].authority && this.combat.concealed(c, p.x, p.y)) c.visible = false;
    }
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, RENDER.maxDpr, Math.sqrt(RENDER.maxCanvasPixels / (w * h))));
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.camera.resize(w, h, dpr);
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const g = this.ctx.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.35, cw / 2, ch / 2, Math.hypot(cw, ch) / 2);
    // Тёплая виньетка: края темнеют в коричневое, а не в чёрное.
    g.addColorStop(0, `rgba(${COZY.vignette},0)`);
    g.addColorStop(1, `rgba(${COZY.vignette},${RENDER.vignette})`);
    this.vignette = g;
    const edge = (inner: number, color: string, a: number) => {
      const e = this.ctx.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * inner, cw / 2, ch / 2, Math.hypot(cw, ch) / 2);
      e.addColorStop(0, `rgba(${color},0)`);
      e.addColorStop(1, `rgba(${color},${a})`);
      return e;
    };
    const SV = RENDER.suppressVignette;
    const DS = RENDER.downedScreen;
    this.pressVignette = edge(SV.inner, SV.color, SV.alpha);
    this.downVignette = edge(DS.inner, DS.color, DS.alpha);
  }

  /** Раунд окончен — перезапустить карту в начале следующего тика. */
  private restartPending = false;

  /** Экспериментальный режим «отряд на отряд» (null — обычная игра в городе). */
  arena: SquadArena | null = null;

  get inArena(): boolean {
    return this.arena !== null;
  }

  /**
   * «Отряд на отряд»: город пустеет (жители, ВС, армия, подполье уходят; война и подполье стоят),
   * два отряда сходятся на пограничном КПП, игрок — в своём. Игра в этом режиме не сохраняется.
   */
  startArena(side: ArenaSide): void {
    this.save();
    for (const c of [...this.entities.list]) if (!c.isPlayer) this.entities.remove(c);
    this.combat.corpses.length = 0;
    this.war.command.paused = true;
    this.war.reinforcements = false;
    this.insurgency.paused = true;
    this.ai.radio.enabled = false;
    this.ai.talk.enabled = false;
    this.ai.relations.enabled = false;
    this.ui.roles.close();
    this.arena = new SquadArena(this.ai, side, this.player);
    this.arena.startRound();
    this.camera.snapTo(this.player.x, this.player.y);
    this.bus.emit('announce', { text: `Отряд на отряд · вы — ${ARENA.sideNames[side]}` });
    this.canvas.focus();
  }

  /** Выйти из «отряд на отряд»: тот же город заново, прежняя роль. */
  leaveArena(): void {
    this.arena = null;
    this.regenerate(this.map.seed);
    this.canvas.focus();
  }

  private update(dt: number): void {
    if (this.restartPending) {
      this.restartPending = false;
      this.regenerate();
      this.bus.emit('announce', { text: 'Новый город · раунд заново' });
      this.save();
      return;
    }
    this.touch.update(this.player, dt);
    // Пауза (P): мир стоит, отрисовка идёт.
    if (this.input.wasPressed('pause') && !this.ui.chat.isOpen) {
      this.paused = !this.paused;
      this.ui.setPaused(this.paused);
    }
    // Пауза клавишей P или открытое меню — мир стоит.
    if (this.paused || this.ui.menu.isOpen) {
      this.input.endTick();
      return;
    }
    this.saveTimer -= dt;
    if (this.saveTimer <= 0) {
      this.saveTimer = SAVE.interval;
      this.save();
    }
    this.time += dt;
    this.ai.time = this.time;
    // Телефон: стики и кнопки → Input (шаг, прицел, огонь) — до управления игроком.
    this.touch.tick(this.player, this.combat.now);
    this.playerCtl.update(this.player, this.ai, dt);
    updateNpcs(this.ai, dt);
    this.doors.update(this.entities, dt);
    stepPhysics(this.entities, this.map, dt);
    this.ai.access.update();
    this.law.update(dt, this.player);
    this.economy.update(dt);
    this.combat.update(dt);
    this.particles.update(this.combat, this.player, dt);
    if (this.arena) {
      // Город пуст: работают только бой, двери, закон и сам режим.
      this.arena.update(dt);
      this.updateVisibility();
      this.finishTick(dt);
      return;
    }
    this.war.update(dt);
    this.insurgency.update(dt);
    this.labor.update(dt);
    this.ai.scanners.update(dt);
    this.ai.roster.update(dt);
    this.ai.elections.update(dt);
    this.ai.street.update(dt);
    this.ai.security.update(dt);
    this.ai.cwuHq.update(dt);
    this.ai.shops.update();
    this.ai.gangs.update(dt);
    this.ai.brawls.update(dt);
    this.ai.arsenal.update(dt);
    this.ai.prison.update();
    this.ai.staffing.update();
    this.ai.academy.update(dt);
    this.ai.radio.update(dt);
    this.ai.talk.update();
    this.ai.relations.update(dt);
    // Красный код (штурм Управы) — возрождения нет ни у кого, игрока тоже.
    if (!this.player.alive && this.combat.now >= this.player.respawnAt && this.war.code !== 'red') this.respawn();
    this.updateVisibility();
    this.finishTick(dt);
  }

  /** Камера, зоны, клавиши интерфейса, UI — в конце тика (и в обычной игре, и в «отряд на отряд»). */
  private finishTick(dt: number): void {
    const m = this.input.mouseInside
      ? this.camera.screenToWorld(this.input.mouseX, this.input.mouseY)
      : { x: this.player.x, y: this.player.y };
    // Сменил уровень (люк) — камера сразу на месте, без «полёта» через всю карту.
    const level = this.map.levelAt(this.player.x, this.player.y);
    if (level !== this.level) {
      this.level = level;
      this.camera.snapTo(this.player.x, this.player.y);
    }
    this.camera.follow(this.player.x, this.player.y, m.x, m.y, dt, this.map.levelBounds(level), this.player.aiming);
    this.zones.update(this.map, this.player, dt);
    this.ambience.update(this.camera.view(1), dt, this.lighting.darkness(this.time));
    this.autoLite(dt);
    if (this.input.wasPressed('debug')) this.debug.enabled = !this.debug.enabled;
    if (this.input.wasPressed('devPanel')) this.ui.dev.toggle();
    if (this.input.wasPressed('help')) this.ui.help.toggle();
    if (this.input.wasPressed('bigMap')) this.ui.mapView.toggleBig();
    if (this.input.wasPressed('contacts') && !this.ui.chat.isOpen && !this.ui.roles.isOpen) this.ui.contacts.toggle();
    if (this.input.wasPressed('zoom')) {
      const k = this.camera.cycleZoom();
      this.bus.emit('log', { text: `Масштаб камеры: ×${k}`, kind: 'world' });
    }
    // Чат: Enter — открыть, «/» — открыть с командой.
    if (!this.ui.chat.isOpen && !this.ui.roles.isOpen && (this.input.wasPressed('chat') || this.input.wasPressed('command'))) {
      const slash = this.input.wasPressed('command');
      this.input.releaseAll();
      this.ui.chat.open(slash ? '/' : '');
    }
    if (this.input.wasPressed('mute')) {
      const muted = this.ui.audio.toggle();
      this.bus.emit('log', { text: muted ? 'Звук выключен (N).' : 'Звук включён (N).', kind: 'system' });
    }
    this.ui.update(this.player, this.law.now, dt);
    this.input.endTick();
  }

  /** Тряска экрана: взрывы, свои выстрелы, попадания (сдвиг вида, не камеры; px экрана). */
  private shake(v: View): void {
    const a = this.particles.shake;
    if (a <= 0.05) return;
    const t = this.combat.now * 60;
    v.left += (Math.sin(t * 1.7) * a) / v.scale;
    v.top += (Math.cos(t * 2.3) * a) / v.scale;
  }

  private render(alpha: number): void {
    const ctx = this.ctx;
    const v = this.camera.view(alpha);
    this.shake(v);
    const dpr = this.camera.dpr;
    const showAll = this.debug.enabled;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = RENDER.background;
    ctx.fillRect(0, 0, v.width, v.height);
    this.mapRenderer.draw(ctx, v);
    this.drawTerminal(v);
    this.effects.drawGround(ctx, v, this.combat, this.economy, this.law.now, this.map, this.insurgency.cache);
    this.effects.drawLabor(ctx, v, this.labor, this.economy.rationStock, this.law.now);
    this.arsenalView.drawGround(ctx, v, this.ai.arsenal, this.map.tileSize, this.law.now);
    this.prisonView.drawGround(ctx, v, this.ai.prison, this.law.cells, this.map, this.law.evidence.size, this.law.now);
    this.academyView.drawGround(ctx, v, this.ai.academy, this.map, this.law.now);
    drawFurnitureList(ctx, v, this.furnishings);
    this.effects.drawFurniture(ctx, v, this.trees, this.map.tileSize);
    this.effects.drawAvenue(ctx, v, this.ai.street.lamps, this.ai.street.benches, this.ai.street.boards, this.lighting.enabled ? this.lighting.day(this.time).lamps : 1);
    this.effects.drawBarrels(ctx, v, this.ai.street.barrels, this.law.now);
    this.effects.drawPoints(ctx, v, this.war, this.law.now);
    this.effects.drawScenes(ctx, v, this.war.scenes.list);
    this.effects.drawMines(ctx, v, this.combat, this.player, this.map);
    this.entityRenderer.drawBodies(ctx, v, this.entities.list, alpha, showAll, this.law.now);
    this.arsenalView.drawCarried(ctx, v, this.ai.arsenal, alpha);
    this.effects.drawSmokers(ctx, v, this.entities.list, this.law.now);
    this.effects.drawNotepads(ctx, v, this.entities.list, this.combat.now, this.law.now);
    this.effects.drawPrisonBars(ctx, v, this.law.cells, this.map.tileSize, this.law.now);
    this.aim.drawNpcCones(ctx, v, this.map, this.combat, this.entities.list, alpha, showAll);
    // Дымок из труб, затем свет суток и источников (умножение), свечение ламп и огня, пылинки.
    const sewer = this.level === 'sewer';
    this.ambience.drawSmoke(ctx, v);
    this.lighting.draw(ctx, v, this.time, this.player, this.combat, this.entities.list, sewer);
    this.lighting.drawBloom(ctx, v, this.time, sewer);
    if (!sewer) this.arsenalView.drawGlow(ctx, v, this.ai.arsenal, this.law.now);
    if (!sewer) this.prisonView.drawGlow(ctx, v, this.ai.prison, this.law.now);
    if (!sewer) this.ambience.drawMotes(ctx, v, this.lighting.litLamps(), this.lighting.day(this.time).lamps, this.time);
    this.particles.draw(ctx, v);
    this.effects.drawShots(ctx, v, this.combat);
    this.effects.drawFire(ctx, v, this.combat, this.entities.list, alpha, this.combat.now);
    this.effects.drawScanners(ctx, v, this.ai.scanners.list, alpha, this.law.now);
    this.aim.drawSwings(ctx, v, this.combat);
    this.fog.draw(ctx, v, this.sight, this.player.x, this.player.y, this.sightRadius, sewer ? VISION.sewerFogColor : VISION.fogColor);
    this.particles.drawOver(ctx, v, this.combat);
    if (!sewer) this.arsenalView.drawShip(ctx, v, this.ai.arsenal, this.law.now);
    this.aim.drawPlayerCone(ctx, v, this.map, this.combat, this.player, alpha);
    this.effects.drawProgress(ctx, v, this.player, this.playerCtl.progress);
    // Подробности о пешке — под курсором; на телефоне — там, где коснулись мира (TOUCH.inspect с).
    const hover = this.input.mouseInside && !this.wheel.open;
    const insp = !hover && this.input.inspect && this.input.inspect.until > performance.now() / 1000 ? this.input.inspect : null;
    const hx = hover ? this.input.mouseX * dpr : insp ? (insp.x - v.left) * v.scale : null;
    const hy = hover ? this.input.mouseY * dpr : insp ? (insp.y - v.top) * v.scale : null;
    this.entityRenderer.drawLabels(ctx, v, this.entities.list, alpha, dpr, this.law.now, showAll, this.player, hx, hy);
    this.debug.draw(ctx, v, this.entities.list, this.nav, this.player, alpha, dpr);
    if (this.vignette) {
      ctx.fillStyle = this.vignette;
      ctx.fillRect(0, 0, v.width, v.height);
    }
    this.ambience.drawGrain(ctx, v);
    this.drawCondition(v, dpr);
    this.effects.drawAlert(ctx, v, this.war.code, this.law.now, this.player);
    if (!sewer) this.effects.drawFrontMarkers(ctx, v, this.war, this.player, dpr, this.law.now);
    this.drawWaypoint(v, dpr);
    this.particles.drawHud(ctx, v, this.input.mouseInside ? this.input.mouseX * dpr : null, this.input.mouseInside ? this.input.mouseY * dpr : null, dpr);
    this.wheel.draw(ctx, v.width, v.height, dpr, this.player, this.combat);
    if (this.input.mouseInside) this.drawCrosshair(this.input.mouseX * dpr, this.input.mouseY * dpr, dpr);
  }

  /** Метка с большой карты: булавка на месте, за краем экрана — стрелка у кромки с расстоянием. */
  private drawWaypoint(v: View, dpr: number): void {
    const m = this.ui.mapView.marker;
    if (!m || m.level !== this.level) return;
    const ctx = this.ctx;
    const P = MINIMAP.waypoint;
    const M = RENDER.frontMarker;
    const sx = (m.x - v.left) * v.scale;
    const sy = (m.y - v.top) * v.scale;
    const inset = M.inset * dpr;
    const meters = Math.round((Math.hypot(m.x - this.player.x, m.y - this.player.y) / this.map.tileSize) * M.metersPerTile);
    ctx.font = M.font.replace(/(\d+)px/, (_, n) => `${Number(n) * dpr}px`);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3 * dpr;
    ctx.strokeStyle = P.edge;
    ctx.fillStyle = P.color;
    let x = sx;
    let y = sy;
    let label = `${meters} м`;
    if (sx > inset && sy > inset && sx < v.width - inset && sy < v.height - inset) {
      // Булавка на месте.
      const r = 5 * dpr;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx - r * 0.8, sy - r * 1.6);
      ctx.arc(sx, sy - r * 1.9, r, Math.PI * 0.8, Math.PI * 0.2, false);
      ctx.closePath();
      ctx.lineWidth = 1.5 * dpr;
      ctx.stroke();
      ctx.fill();
      y = sy - r * 4.2;
    } else {
      // Стрелка у кромки по направлению на метку.
      const cx = v.width / 2;
      const cy = v.height / 2;
      const dx = sx - cx;
      const dy = sy - cy;
      const k = Math.min((cx - inset) / Math.max(1e-6, Math.abs(dx)), (cy - inset) / Math.max(1e-6, Math.abs(dy)));
      x = cx + dx * k;
      y = cy + dy * k;
      const ang = Math.atan2(dy, dx);
      const a = 10 * dpr;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(ang) * a, y + Math.sin(ang) * a);
      ctx.lineTo(x + Math.cos(ang + 2.5) * a, y + Math.sin(ang + 2.5) * a);
      ctx.lineTo(x + Math.cos(ang - 2.5) * a, y + Math.sin(ang - 2.5) * a);
      ctx.closePath();
      ctx.lineWidth = 1.5 * dpr;
      ctx.stroke();
      ctx.fill();
      label = `метка · ${meters} м`;
      x -= Math.cos(ang) * 30 * dpr;
      y -= Math.sin(ang) * 18 * dpr;
    }
    ctx.lineWidth = 3 * dpr;
    ctx.strokeText(label, x, y);
    ctx.fillText(label, x, y);
  }

  /** Состояние игрока на экране: под огнём — тёмные края, тяжело ранен — красные и надпись. */
  private drawCondition(v: View, dpr: number): void {
    const ctx = this.ctx;
    const p = this.player;
    if (p.suppress > 0.02 && this.pressVignette) {
      ctx.globalAlpha = Math.min(1, p.suppress * SUPPRESS.vignette);
      ctx.fillStyle = this.pressVignette;
      ctx.fillRect(0, 0, v.width, v.height);
      ctx.globalAlpha = 1;
    }
    if (!p.alive || !p.downed || !this.downVignette) return;
    const D = RENDER.downedScreen;
    const left = Math.max(0, Math.ceil(p.downedUntil - this.combat.now));
    ctx.globalAlpha = 0.75 + 0.25 * Math.sin(this.combat.now * 3);
    ctx.fillStyle = this.downVignette;
    ctx.fillRect(0, 0, v.width, v.height);
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = D.font.replace(/(\d+)px/, (_, n) => `${Number(n) * dpr}px`);
    ctx.fillStyle = D.text;
    ctx.fillText(`ТЯЖЁЛОЕ РАНЕНИЕ · ${left} с`, v.width / 2, v.height * 0.3);
    ctx.font = D.hintFont.replace(/(\d+)px/, (_, n) => `${Number(n) * dpr}px`);
    ctx.fillStyle = D.hint;
    ctx.fillText('Ждите, пока свои поднимут (им нужен бинт). WASD — ползти, E — не ждать помощи.', v.width / 2, v.height * 0.3 + 22 * dpr);
  }

  /** Терминал найма на площади. */
  private drawTerminal(v: ReturnType<Camera['view']>): void {
    const t = poiWorld(this.ai, 'recruit_terminal');
    if (!t) return;
    const ctx = this.ctx;
    const s = v.scale;
    const x = (t.x - v.left) * s;
    const y = (t.y - v.top) * s;
    ctx.fillStyle = '#1b2530';
    ctx.fillRect(x - 7 * s, y - 7 * s, 14 * s, 14 * s);
    ctx.fillStyle = RENDER.entity.terminal;
    ctx.fillRect(x - 5 * s, y - 5 * s, 10 * s, 6 * s);
    // Терминал кодов тревоги: экран цвета текущего кода (включён с терминала — мигает).
    const ct = poiWorld(this.ai, 'code_terminal');
    if (!ct) return;
    const C = RENDER.entity.codeTerminal;
    const cx = (ct.x - v.left) * s;
    const cy = (ct.y - v.top) * s;
    ctx.fillStyle = C.case;
    ctx.fillRect(cx - 6 * s, cy - 7 * s, 12 * s, 14 * s);
    ctx.strokeStyle = C.rim;
    ctx.lineWidth = Math.max(1, s);
    ctx.strokeRect(cx - 6 * s, cy - 7 * s, 12 * s, 14 * s);
    const blink = this.war.manualCode && Math.floor(this.law.now * 2) % 2 === 0;
    ctx.fillStyle = C.screen[this.war.code];
    ctx.globalAlpha = blink ? 0.45 : 1;
    ctx.fillRect(cx - 4 * s, cy - 5 * s, 8 * s, 6 * s);
    ctx.globalAlpha = 1;
    ctx.fillStyle = C.rim;
    for (let k = 0; k < 3; k++) ctx.fillRect(cx - 4 * s + k * 3 * s, cy + 3 * s, 2 * s, 2 * s);
  }

  private drawCrosshair(x: number, y: number, dpr: number): void {
    const ctx = this.ctx;
    ctx.strokeStyle = RENDER.crosshair;
    ctx.lineWidth = 1.5 * dpr;
    const a = 3 * dpr;
    const b = 9 * dpr;
    ctx.beginPath();
    ctx.moveTo(x - b, y); ctx.lineTo(x - a, y);
    ctx.moveTo(x + a, y); ctx.lineTo(x + b, y);
    ctx.moveTo(x, y - b); ctx.lineTo(x, y - a);
    ctx.moveTo(x, y + a); ctx.lineTo(x, y + b);
    ctx.stroke();
  }
}
