import { EventBus } from './EventBus';
import { Camera } from './Camera';
import { Input } from './Input';
import { GameLoop } from './GameLoop';
import { Rng, randomSeed } from './rng';
import { dist } from './math';
import { CHARACTER } from '../config/entities';
import { RENDER } from '../config/render';
import type { GameMap } from '../world/GameMap';
import { NavGrid } from '../world/NavGrid';
import { MapRenderer } from '../world/MapRenderer';
import { generateCity } from '../world/generator/CityGenerator';
import { EntityManager } from '../entities/EntityManager';
import type { Character } from '../entities/Character';
import { createCharacter, resetCids } from '../entities/factory';
import { stepPhysics } from '../entities/physics';
import { EntityRenderer } from '../entities/EntityRenderer';
import { PathService } from '../ai/PathService';
import { AnchorBfs } from '../ai/yieldSearch';
import type { AiContext } from '../ai/AiContext';
import { updateNpcs } from '../ai/NpcController';
import { CitizenBrain } from '../ai/brains/CitizenBrain';
import { randomAnchorAround, zoneIds } from '../ai/destinations';
import { ZoneSystem } from '../systems/ZoneSystem';
import { UI } from '../ui/UI';
import { DebugOverlay } from '../ui/DebugOverlay';

export interface GameOptions {
  npcs: number;
}

/**
 * Корневой объект: владеет картой, сущностями, системами и циклом.
 * Порядок тика: ввод игрока → ИИ NPC (+ очередь A*) → физика → камера → системы → UI.
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
  private ai!: AiContext;
  private mapRenderer!: MapRenderer;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly entityRenderer = new EntityRenderer();
  private readonly zones: ZoneSystem;
  private rng = new Rng(randomSeed());
  private vignette: CanvasGradient | null = null;
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
    this.ai = {
      map,
      nav: this.nav,
      paths: new PathService(map, this.nav),
      bfs: new AnchorBfs(this.nav),
      entities: this.entities,
      rng: this.rng,
      player: null,
      time: this.time,
    };
    this.spawn();
    this.zones.reset();
    this.camera.snapTo(this.player.x, this.player.y);
    this.bus.emit('map:loaded', { seed: map.seed, stats: map.stats, source });
    if (source === 'generated') {
      const url = new URL(location.href);
      url.searchParams.set('seed', String(map.seed));
      url.searchParams.delete('map');
      history.replaceState(null, '', url);
    }
  }

  /** Игрок — у площади раздачи, граждане — часть рядом с площадью, остальные по городу. */
  private spawn(): void {
    const { nav, map, rng } = this;
    this.entities.clear();
    resetCids();
    const center = map.poisOf('plaza_center')[0];
    const cx = center ? (center.x + 0.5) * map.tileSize : map.worldWidth / 2;
    const cy = center ? (center.y + 0.5) * map.tileSize : map.worldHeight / 2;
    let start = nav.nearestWalkable(cx, cy, 10);
    if (start < 0) start = nav.walkable[0];
    this.player = createCharacter(this.entities, rng, 'citizen', nav.worldX(start), nav.worldY(start), true);
    this.ai.player = this.player;

    const avoid = zoneIds(this.ai, ['nexus', 'cells', 'restricted']);
    const nearPlaza = Math.min(6, this.opts.npcs);
    for (let k = 0; k < this.opts.npcs; k++) {
      for (let tries = 0; tries < 200; tries++) {
        const a = k < nearPlaza ? randomAnchorAround({ x: cx, y: cy }, this.ai, 3, 22, avoid) : rng.pick(nav.walkable);
        if (a < 0 || avoid.has(nav.zone[a])) continue;
        const x = nav.worldX(a);
        const y = nav.worldY(a);
        if (this.entities.list.some((c) => dist(c.x, c.y, x, y) < 40)) continue;
        const npc = createCharacter(this.entities, rng, 'citizen', x, y);
        npc.facing = rng.range(0, Math.PI * 2);
        npc.brain = new CitizenBrain(npc, this.ai);
        break;
      }
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

  private controlPlayer(): void {
    const p = this.player;
    const i = this.input;
    let mx = (i.isDown('right') ? 1 : 0) - (i.isDown('left') ? 1 : 0);
    let my = (i.isDown('down') ? 1 : 0) - (i.isDown('up') ? 1 : 0);
    const len = Math.hypot(mx, my);
    if (len > 0) {
      mx /= len;
      my /= len;
    }
    const speed = i.isDown('run') ? CHARACTER.runSpeed : CHARACTER.walkSpeed;
    p.wantX = mx * speed;
    p.wantY = my * speed;
    if (i.mouseInside) {
      const m = this.camera.screenToWorld(i.mouseX, i.mouseY);
      p.facing = Math.atan2(m.y - p.y, m.x - p.x);
    } else if (len > 0) {
      p.facing = Math.atan2(my, mx);
    }
  }

  private update(dt: number): void {
    this.time += dt;
    this.ai.time = this.time;
    this.controlPlayer();
    updateNpcs(this.ai, dt);
    stepPhysics(this.entities, this.map, dt);
    const m = this.input.mouseInside
      ? this.camera.screenToWorld(this.input.mouseX, this.input.mouseY)
      : { x: this.player.x, y: this.player.y };
    this.camera.follow(this.player.x, this.player.y, m.x, m.y, dt, this.map.worldWidth, this.map.worldHeight);
    this.zones.update(this.map, this.player, dt);
    if (this.input.wasPressed('debug')) this.debug.enabled = !this.debug.enabled;
    if (this.input.wasPressed('devPanel')) this.ui.dev.toggle();
    this.ui.update(this.player, dt);
    this.input.endTick();
  }

  private render(alpha: number): void {
    const ctx = this.ctx;
    const v = this.camera.view(alpha);
    const dpr = this.camera.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = RENDER.background;
    ctx.fillRect(0, 0, v.width, v.height);
    this.mapRenderer.draw(ctx, v);
    this.entityRenderer.draw(ctx, v, this.entities.list, alpha, dpr);
    this.debug.draw(ctx, v, this.entities.list, this.nav, this.player, alpha, dpr);
    if (this.vignette) {
      ctx.fillStyle = this.vignette;
      ctx.fillRect(0, 0, v.width, v.height);
    }
    if (this.input.mouseInside) this.drawCrosshair(this.input.mouseX * dpr, this.input.mouseY * dpr, dpr);
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
