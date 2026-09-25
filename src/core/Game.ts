import { EventBus } from './EventBus';
import { Camera } from './Camera';
import { Input } from './Input';
import { GameLoop } from './GameLoop';
import { Rng, randomSeed } from './rng';
import { PlayerController } from './PlayerController';
import { RENDER } from '../config/render';
import { VISION } from '../config/vision';
import { CHARACTER } from '../config/entities';
import { FACTIONS, rankOf, type FactionId } from '../config/factions';
import type { GameMap, Level } from '../world/GameMap';
import { NavGrid } from '../world/NavGrid';
import { MapRenderer } from '../world/MapRenderer';
import { FogRenderer } from '../world/FogRenderer';
import { VisibilityPolygon, canSeeCircle } from '../world/visibility';
import { generateCity } from '../world/generator/CityGenerator';
import { EntityManager } from '../entities/EntityManager';
import type { Character } from '../entities/Character';
import { createCharacter, nameFor, randomName, resetCids } from '../entities/factory';
import { stepPhysics } from '../entities/physics';
import { EntityRenderer } from '../entities/EntityRenderer';
import { AimRenderer } from '../entities/AimRenderer';
import { PathService } from '../ai/PathService';
import { AnchorBfs } from '../ai/yieldSearch';
import type { AiContext } from '../ai/AiContext';
import { updateNpcs } from '../ai/NpcController';
import { ZoneSystem } from '../systems/ZoneSystem';
import { DoorSystem } from '../systems/DoorSystem';
import { LawSystem } from '../systems/LawSystem';
import { spawnPopulation, roleSpawn, poiWorld, equipKit, cpKit } from '../systems/Population';
import { EconomySystem } from '../systems/EconomySystem';
import { CombatSystem } from '../systems/CombatSystem';
import { WarSystem } from '../systems/WarSystem';
import { UndergroundSystem } from '../systems/UndergroundSystem';
import { InsurgencySystem } from '../systems/InsurgencySystem';
import { ChatSystem } from '../systems/ChatSystem';
import { LOYALTY } from '../config/loyalty';
import { SAVE } from '../config/save';
import { capturePlayer, parseSave, applyToPlayer, decodeBits, type SaveData } from '../systems/SaveGame';
import { EffectsRenderer } from '../world/EffectsRenderer';
import { ECONOMY } from '../config/economy';
import type { DivisionId } from '../config/factions';
import { ITEMS, REBEL_OFFICER_RANK, type ItemId, type WeaponId } from '../config/items';
import { T } from '../world/tiles';
import { UI } from '../ui/UI';
import type { CheckChoice } from '../ui/CheckPanel';
import { DebugOverlay } from '../ui/DebugOverlay';

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
  combat!: CombatSystem;
  war!: WarSystem;
  insurgency!: InsurgencySystem;
  private chat!: ChatSystem;
  private ai!: AiContext;
  private mapRenderer!: MapRenderer;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly entityRenderer = new EntityRenderer();
  private readonly fog = new FogRenderer();
  private readonly effects = new EffectsRenderer();
  private readonly aim = new AimRenderer();
  /** Бетонные блоки, поставленные игроком-GRID (самый старый убирается). */
  private placedBarriers: number[] = [];
  private readonly sight = new VisibilityPolygon(VISION.rays);
  private readonly zones: ZoneSystem;
  private readonly playerCtl: PlayerController;
  private rng = new Rng(randomSeed());
  private vignette: CanvasGradient | null = null;
  /** Выбранная роль игрока (сохраняется при смене карты). */
  private role: { faction: FactionId; rank: number; division: DivisionId | null } | null = null;
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
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.input = new Input(canvas);
    this.zones = new ZoneSystem(this.bus);
    this.ui = new UI(uiRoot, this.bus, this);
    this.playerCtl = new PlayerController(this.input, this.camera, this.bus, {
      openRoleMenu: () => this.ui.roles.open(false),
      menuOpen: () => this.ui.roles.isOpen,
      openShop: (kind) => this.ui.shop.open(kind),
      toggleInventory: () => this.ui.inventory.toggle(),
      placeBarrier: () => this.placeBarrier(),
      checkPanelTarget: () => this.ui.check.target,
      closeCheckPanel: (c) => this.ui.check.choose(c),
    });
    this.loop = new GameLoop(
      (dt) => this.update(dt),
      (a) => this.render(a),
    );
    window.addEventListener('resize', () => this.resize());
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
    };
    this.war = new WarSystem(this.ai);
    this.ai.war = this.war;
    this.insurgency = new InsurgencySystem(this.ai);
    this.ai.insurgency = this.insurgency;
    this.chat = new ChatSystem(this.ai);
    this.law.curfewCheck = (c) => this.war.curfewViolation(c);
    this.law.panicking = (c) => c.panicUntil > this.law.now;
    this.entities.clear();
    resetCids();
    this.playerCtl.reset();
    this.ui.check.hide();
    const start = roleSpawn(this.ai, 'citizen');
    this.player = createCharacter(this.entities, this.rng, 'citizen', start.x, start.y, true);
    this.civilName = this.player.name;
    this.ai.player = this.player;
    spawnPopulation(this.ai, this.opts.npcs);
    const save = this.pendingSave && this.pendingSave.seed === map.seed && source === 'generated' ? this.pendingSave : null;
    this.pendingSave = null;
    this.ui.mapView.reset(map, save ? decodeBits(save.explored, map.width * map.height) : null, save?.hatches);
    if (save) this.restore(save);
    else if (this.role) this.applyRole(this.role.faction, this.role.rank, this.role.division, false);
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
  chooseRole(faction: FactionId, rank: number, division: DivisionId | null = null): void {
    this.role = { faction, rank, division: faction === 'cp' ? division ?? 'union' : null };
    this.applyRole(faction, rank, this.role.division, true);
    this.save();
  }

  private applyRole(faction: FactionId, rank: number, division: DivisionId | null, announce: boolean): void {
    const p = this.player;
    const law = p.law;
    // Если сидел — освобождаем камеру.
    const cell = this.law.cells[law.cell];
    if (cell && (cell.occupant === p || cell.reserved === p)) {
      cell.occupant = cell.reserved = null;
      if (cell.door) this.doors.setLocked(cell.door, false);
    }
    for (const o of this.entities.list) if (o.law.handler === p) this.law.clear(o);
    this.ui.check.hide();
    this.playerCtl.reset();
    this.economy.leaveQueue(p);
    this.economy.releaseDispenser(p);
    p.faction = faction;
    p.rank = rank;
    p.division = faction === 'cp' ? division : null;
    p.alive = true;
    p.health = p.maxHealth;
    p.hunger = ECONOMY.hunger.max;
    p.hostile = false;
    p.panicUntil = 0;
    // Новая роль — лояльность с чистого листа (при возрождении сохраняется).
    if (announce) p.loyalty = faction === 'cwu' ? LOYALTY.playerStart.cwu : LOYALTY.playerStart.citizen;
    equipKit(p, faction === 'cp' ? cpKit(p.division) : faction === 'rebel' && rank >= REBEL_OFFICER_RANK ? 'rebel_officer' : faction, this.ai);
    // Жителям оружие на виду ни к чему; повстанец начинает в убежище — с оружием в руках (Q/H — убрать).
    if (faction !== 'cp' && faction !== 'rebel') this.combat.equip(p, null);
    p.name = faction === 'cp' ? nameFor(this.rng, 'cp') : this.civilName || randomName(this.rng);
    p.money = CHARACTER.roleMoney[faction] ?? CHARACTER.startMoney;
    p.brain = null;
    Object.assign(law, {
      hasCid: true, wanted: faction === 'rebel', phase: 'none', handler: null, reason: null,
      cell: -1, jailUntil: 0, savedBrain: null, lastCheck: this.law.now,
    });
    const spot = roleSpawn(this.ai, faction);
    p.x = p.prevX = spot.x;
    p.y = p.prevY = spot.y;
    p.vx = p.vy = p.wantX = p.wantY = 0;
    this.camera.snapTo(p.x, p.y);
    if (announce) {
      const r = rankOf(faction, rank);
      const div = p.division ? ` · ${p.division.toUpperCase()}` : '';
      this.bus.emit('log', { text: `Вы теперь: ${FACTIONS[faction].role}${r ? ` (${r.name})` : ''}${div} — ${p.name}`, kind: 'system' });
    }
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

  /** Сохранить сейчас (если роль выбрана и игрок жив). */
  save(): boolean {
    if (!this.role || !this.player?.alive) return false;
    const data = capturePlayer(this.player, this.map.seed, this.role, this.civilName, { explored: this.ui.mapView.explored, hatches: this.ui.mapView.hatches });
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
    this.applyRole(save.role.faction, save.role.rank, save.role.division, false);
    applyToPlayer(this.player, save);
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

  /** Инвентарь игрока: съесть/применить. */
  useItem(id: ItemId): void {
    if (!this.player.alive) return;
    if (this.economy.use(this.player, id)) this.bus.emit('log', { text: `Вы использовали: ${ITEMS[id].name}.`, kind: 'system' });
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

  shopPrice(id: ItemId): number | undefined {
    return this.economy.shopPrice(this.player, id);
  }

  buyBlack(k: number): string | null {
    return this.economy.buyBlack(this.player, k);
  }

  sellItem(id: ItemId): string | null {
    return this.economy.sellBlack(this.player, id);
  }

  get blackMarketCounter(): { x: number; y: number } | null {
    return this.insurgency?.market ?? null;
  }

  buyItem(id: ItemId): string | null {
    return this.economy.buy(this.player, id);
  }

  /** Возрождение игрока после гибели: прежняя роль, штраф к токенам. */
  private respawn(): void {
    const p = this.player;
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

  /** Решение игрока-ГО по проверке CID (панель или клавиши 1/2/3). */
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
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${RENDER.vignette})`);
    this.vignette = g;
  }

  private update(dt: number): void {
    // Пауза (P): мир стоит, отрисовка идёт.
    if (this.input.wasPressed('pause') && !this.ui.chat.isOpen) {
      this.paused = !this.paused;
      this.ui.setPaused(this.paused);
    }
    if (this.paused) {
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
    this.playerCtl.update(this.player, this.ai, dt);
    updateNpcs(this.ai, dt);
    this.doors.update(this.entities, dt);
    stepPhysics(this.entities, this.map, dt);
    this.law.update(dt, this.player);
    this.economy.update(dt);
    this.combat.update(dt);
    this.war.update(dt);
    this.insurgency.update(dt);
    if (!this.player.alive && this.combat.now >= this.player.respawnAt) this.respawn();
    this.updateVisibility();
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
    if (this.input.wasPressed('debug')) this.debug.enabled = !this.debug.enabled;
    if (this.input.wasPressed('devPanel')) this.ui.dev.toggle();
    if (this.input.wasPressed('bigMap')) this.ui.mapView.toggleBig();
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

  private render(alpha: number): void {
    const ctx = this.ctx;
    const v = this.camera.view(alpha);
    const dpr = this.camera.dpr;
    const showAll = this.debug.enabled;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = RENDER.background;
    ctx.fillRect(0, 0, v.width, v.height);
    this.mapRenderer.draw(ctx, v);
    this.drawTerminal(v);
    this.effects.drawGround(ctx, v, this.combat, this.economy, this.law.now, this.map, this.insurgency.cache);
    this.entityRenderer.drawBodies(ctx, v, this.entities.list, alpha, showAll, this.law.now);
    this.aim.drawNpcCones(ctx, v, this.map, this.combat, this.entities.list, alpha, showAll);
    this.effects.drawShots(ctx, v, this.combat);
    this.aim.drawSwings(ctx, v, this.combat);
    const sewer = this.level === 'sewer';
    this.fog.draw(ctx, v, this.sight, this.player.x, this.player.y, this.sightRadius, sewer ? VISION.sewerFogColor : VISION.fogColor);
    this.aim.drawPlayerCone(ctx, v, this.map, this.combat, this.player, alpha);
    this.effects.drawProgress(ctx, v, this.player, this.playerCtl.progress);
    this.entityRenderer.drawLabels(ctx, v, this.entities.list, alpha, dpr, this.law.now, showAll);
    this.debug.draw(ctx, v, this.entities.list, this.nav, this.player, alpha, dpr);
    if (this.vignette) {
      ctx.fillStyle = this.vignette;
      ctx.fillRect(0, 0, v.width, v.height);
    }
    this.effects.drawAlert(ctx, v, this.war.code, this.law.now, this.player);
    if (!sewer) this.effects.drawFrontMarkers(ctx, v, this.war, this.player, dpr, this.law.now);
    if (this.input.mouseInside) this.drawCrosshair(this.input.mouseX * dpr, this.input.mouseY * dpr, dpr);
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
