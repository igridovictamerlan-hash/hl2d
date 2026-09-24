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
import type { GameMap } from '../world/GameMap';
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
import { PathService } from '../ai/PathService';
import { AnchorBfs } from '../ai/yieldSearch';
import type { AiContext } from '../ai/AiContext';
import { updateNpcs } from '../ai/NpcController';
import { ZoneSystem } from '../systems/ZoneSystem';
import { DoorSystem } from '../systems/DoorSystem';
import { LawSystem } from '../systems/LawSystem';
import { spawnPopulation, roleSpawn, poiWorld } from '../systems/Population';
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
  private ai!: AiContext;
  private mapRenderer!: MapRenderer;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly entityRenderer = new EntityRenderer();
  private readonly fog = new FogRenderer();
  private readonly sight = new VisibilityPolygon(VISION.rays);
  private readonly zones: ZoneSystem;
  private readonly playerCtl: PlayerController;
  private rng = new Rng(randomSeed());
  private vignette: CanvasGradient | null = null;
  /** Выбранная роль игрока (сохраняется при смене карты). */
  private role: { faction: FactionId; rank: number } | null = null;
  /** Гражданское имя игрока (для ролей без позывного). */
  private civilName = '';
  time = 0;

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
      checkPanelTarget: () => this.ui.check.target,
      closeCheckPanel: (c) => this.ui.check.choose(c),
    });
    this.loop = new GameLoop(
      (dt) => this.update(dt),
      (a) => this.render(a),
    );
    window.addEventListener('resize', () => this.resize());
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
    };
    this.entities.clear();
    resetCids();
    this.playerCtl.reset();
    this.ui.check.hide();
    const start = roleSpawn(this.ai, 'citizen');
    this.player = createCharacter(this.entities, this.rng, 'citizen', start.x, start.y, true);
    this.civilName = this.player.name;
    this.ai.player = this.player;
    spawnPopulation(this.ai, this.opts.npcs);
    if (this.role) this.applyRole(this.role.faction, this.role.rank, false);
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
  chooseRole(faction: FactionId, rank: number): void {
    this.role = { faction, rank };
    this.applyRole(faction, rank, true);
  }

  private applyRole(faction: FactionId, rank: number, announce: boolean): void {
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
    p.faction = faction;
    p.rank = rank;
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
      this.bus.emit('log', { text: `Вы теперь: ${FACTIONS[faction].role}${r ? ` (${r.name})` : ''} — ${p.name}`, kind: 'system' });
    }
  }

  /** Решение игрока-ГО по проверке CID (панель или клавиши 1/2/3). */
  resolveCheck(target: Character, choice: CheckChoice): void {
    this.playerCtl.resolve(this.player, target, choice, this.ai);
  }

  /** Кого видит игрок: прямая видимость до кружка в пределах дальности обзора. */
  private updateVisibility(): void {
    const p = this.player;
    this.sight.compute(this.map, p.x, p.y, VISION.radius, VISION.wallBleed);
    const r2 = (VISION.radius + 20) ** 2;
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
    this.time += dt;
    this.ai.time = this.time;
    this.playerCtl.update(this.player, this.ai);
    updateNpcs(this.ai, dt);
    this.doors.update(this.entities, dt);
    stepPhysics(this.entities, this.map, dt);
    this.law.update(dt, this.player);
    this.updateVisibility();
    const m = this.input.mouseInside
      ? this.camera.screenToWorld(this.input.mouseX, this.input.mouseY)
      : { x: this.player.x, y: this.player.y };
    this.camera.follow(this.player.x, this.player.y, m.x, m.y, dt, this.map.worldWidth, this.map.worldHeight);
    this.zones.update(this.map, this.player, dt);
    if (this.input.wasPressed('debug')) this.debug.enabled = !this.debug.enabled;
    if (this.input.wasPressed('devPanel')) this.ui.dev.toggle();
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
    this.entityRenderer.drawBodies(ctx, v, this.entities.list, alpha, showAll);
    this.fog.draw(ctx, v, this.sight, this.player.x, this.player.y);
    this.entityRenderer.drawLabels(ctx, v, this.entities.list, alpha, dpr, this.law.now, showAll);
    this.debug.draw(ctx, v, this.entities.list, this.nav, this.player, alpha, dpr);
    if (this.vignette) {
      ctx.fillStyle = this.vignette;
      ctx.fillRect(0, 0, v.width, v.height);
    }
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
