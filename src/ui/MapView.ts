import type { GameMap, Level, Rect } from '../world/GameMap';
import type { Character } from '../entities/Character';
import type { EntityManager } from '../entities/EntityManager';
import type { WarSystem } from '../systems/WarSystem';
import type { EconomySystem } from '../systems/EconomySystem';
import type { InsurgencySystem } from '../systems/InsurgencySystem';
import { MINIMAP } from '../config/minimap';
import { FACTIONS } from '../config/factions';

export interface MapViewHost {
  readonly map: GameMap;
  readonly player: Character;
  readonly entities: EntityManager;
  readonly war: WarSystem;
  readonly economy: EconomySystem;
  readonly insurgency: InsurgencySystem;
}

const C = MINIMAP.colors;

/**
 * Мини-карта (правый верхний угол) и большая карта уровня (M). Город известен целиком,
 * канализация открывается по мере исследования (повстанцам — сразу). Люки в городе видны
 * повстанцам и тем, кто их уже находил. Маркеры: КПП (бой, капт, захвачен), Нексус, раздача,
 * магазин, узлы Альянса (сломанные — красные), точка тревоги, свои (ГО — ГО, повстанцы — повстанцы).
 */
export class MapView {
  private readonly mini: HTMLCanvasElement;
  private readonly big: HTMLElement;
  private readonly bigCanvas: HTMLCanvasElement;
  private readonly legend: HTMLElement;
  private map: GameMap | null = null;
  private readonly base = new Map<Level, HTMLCanvasElement>();
  private sewerFull: Uint8ClampedArray | null = null;
  private sewerImg: ImageData | null = null;
  /** Исследованные тайлы канализации (для сохранения). */
  explored: Uint8Array = new Uint8Array(0);
  /** Найденные люки (id). */
  readonly hatches = new Set<number>();
  private zoneLabels: { name: string; x: number; y: number }[] = [];
  private time = 0;

  constructor(parent: HTMLElement) {
    this.mini = document.createElement('canvas');
    this.mini.className = 'minimap';
    parent.appendChild(this.mini);
    this.big = document.createElement('div');
    this.big.className = 'bigmap';
    this.big.hidden = true;
    this.big.innerHTML = `<div class="bigmap-box panel"><div class="inv-head"><span data-title>КАРТА</span><span class="bigmap-hint">M / Esc — закрыть</span></div><canvas></canvas><div class="bigmap-legend"></div></div>`;
    this.bigCanvas = this.big.querySelector('canvas')!;
    this.legend = this.big.querySelector('.bigmap-legend')!;
    parent.appendChild(this.big);
    this.big.addEventListener('click', (e) => e.target === this.big && this.toggleBig(false));
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.bigOpen) this.toggleBig(false);
    });
    this.legend.innerHTML = [
      [C.player, 'вы'],
      [C.fight, 'КПП: бой'],
      [C.capture, 'КПП: капт / захвачен'],
      [C.nexus, 'Нексус'],
      [C.ration, 'раздача'],
      [C.shop, 'магазин ГСР'],
      [C.hatch, 'люк'],
      [C.nodeBroken, 'узел Альянса выведен из строя'],
      [C.alarm, 'тревога'],
      [C.base, 'убежище'],
      [C.market, 'чёрный рынок'],
    ]
      .map(([c, t]) => `<span><i style="background:${c}"></i>${t}</span>`)
      .join('');
  }

  get bigOpen(): boolean {
    return !this.big.hidden;
  }

  toggleBig(open = !this.bigOpen): void {
    this.big.hidden = !open;
  }

  /** Сбросить знания (новая карта) и при необходимости восстановить из сохранения. */
  reset(map: GameMap, explored?: Uint8Array | null, hatches?: number[]): void {
    this.map = map;
    this.explored = explored && explored.length === map.width * map.height ? explored : new Uint8Array(map.width * map.height);
    this.hatches.clear();
    for (const h of hatches ?? []) this.hatches.add(h);
    this.buildBase(map);
  }

  private levelRect(level: Level): Rect {
    const map = this.map!;
    const b = map.levelBounds(level);
    const ts = map.tileSize;
    return { x: b.x / ts, y: b.y / ts, w: b.w / ts, h: b.h / ts };
  }

  private buildBase(map: GameMap): void {
    this.base.clear();
    this.sewerFull = null;
    this.sewerImg = null;
    const levels: Level[] = map.underground ? ['city', 'sewer'] : ['city'];
    for (const level of levels) {
      const r = this.levelRect(level);
      const cv = document.createElement('canvas');
      cv.width = r.w;
      cv.height = r.h;
      const ctx = cv.getContext('2d')!;
      const img = ctx.createImageData(r.w, r.h);
      const full = new Uint8ClampedArray(r.w * r.h * 4);
      for (let y = 0; y < r.h; y++) {
        for (let x = 0; x < r.w; x++) {
          const [cr, cg, cb] = MINIMAP.tiles[map.tiles[(r.y + y) * map.width + r.x + x]] ?? [255, 0, 255];
          const i = (y * r.w + x) * 4;
          full[i] = cr;
          full[i + 1] = cg;
          full[i + 2] = cb;
          full[i + 3] = 255;
        }
      }
      if (level === 'sewer') {
        this.sewerFull = full;
        this.sewerImg = img;
        for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
        this.paintExplored(r, 0, 0, r.w, r.h);
      } else img.data.set(full);
      ctx.putImageData(img, 0, 0);
      this.base.set(level, cv);
    }
    // Подписи районов города — по центру масс их тайлов.
    const sums = new Map<number, [number, number, number]>();
    const city = this.levelRect('city');
    for (let y = 0; y < city.h; y += 2) {
      for (let x = 0; x < city.w; x += 2) {
        const z = map.zoneGrid[y * map.width + x];
        const s = sums.get(z) ?? [0, 0, 0];
        s[0] += x;
        s[1] += y;
        s[2]++;
        sums.set(z, s);
      }
    }
    this.zoneLabels = [];
    for (const [id, [sx, sy, n]] of sums) {
      const zone = map.zones[id];
      if (!zone || n < 40 || zone.kind === 'avenue' || zone.kind === 'outlands') continue;
      // Части КПП — коротко: «D3», «шорт», «лонг», «D4».
      const name = zone.kind === 'checkpoint' ? zone.name.replace(/^.* · /, '') : zone.name;
      this.zoneLabels.push({ name, x: sx / n, y: sy / n });
    }
  }

  /** Перенести исследованные тайлы канализации из полной схемы в видимую. */
  private paintExplored(r: Rect, x0: number, y0: number, w: number, h: number): void {
    const map = this.map!;
    const img = this.sewerImg!;
    const full = this.sewerFull!;
    const all = this.knowsSewer();
    for (let y = Math.max(0, y0); y < Math.min(r.h, y0 + h); y++) {
      for (let x = Math.max(0, x0); x < Math.min(r.w, x0 + w); x++) {
        const known = all || this.explored[(r.y + y) * map.width + r.x + x];
        const i = (y * r.w + x) * 4;
        img.data[i] = known ? full[i] : 6;
        img.data[i + 1] = known ? full[i + 1] : 7;
        img.data[i + 2] = known ? full[i + 2] : 8;
      }
    }
  }

  private player: Character | null = null;
  private knowsSewer(): boolean {
    return this.player?.faction === 'rebel';
  }

  update(host: MapViewHost, dt: number): void {
    this.time += dt;
    const { map, player } = host;
    if (map !== this.map) this.reset(map);
    const wasRebel = this.knowsSewer();
    this.player = player;
    if (wasRebel !== this.knowsSewer() && map.underground) this.redrawSewer();
    const ts = map.tileSize;
    const level = map.levelAt(player.x, player.y);
    // Исследование канализации и поиск люков.
    if (level === 'sewer' && map.underground) this.explore(player.x / ts, player.y / ts);
    for (const h of map.hatches) {
      const p = level === 'sewer' ? h.sewer : h.city;
      if (Math.hypot(p.x - player.x, p.y - player.y) < MINIMAP.discoverHatch) this.hatches.add(h.id);
    }
    this.drawMini(host, level);
    if (this.bigOpen) this.drawBig(host, level);
  }

  private redrawSewer(): void {
    const r = this.levelRect('sewer');
    this.paintExplored(r, 0, 0, r.w, r.h);
    this.base.get('sewer')?.getContext('2d')!.putImageData(this.sewerImg!, 0, 0);
  }

  private explore(tx: number, ty: number): void {
    const map = this.map!;
    const r = this.levelRect('sewer');
    const R = MINIMAP.exploreRadius;
    let changed = false;
    for (let y = Math.floor(ty - R); y <= ty + R; y++) {
      for (let x = Math.floor(tx - R); x <= tx + R; x++) {
        if (x < r.x || y < r.y || x >= r.x + r.w || y >= r.y + r.h || (x - tx) ** 2 + (y - ty) ** 2 > R * R) continue;
        const i = y * map.width + x;
        if (!this.explored[i]) {
          this.explored[i] = 1;
          changed = true;
        }
      }
    }
    if (!changed || this.knowsSewer()) return;
    const x0 = Math.floor(tx - R) - r.x;
    const y0 = Math.floor(ty - R) - r.y;
    this.paintExplored(r, x0, y0, 2 * R + 2, 2 * R + 2);
    this.base.get('sewer')!.getContext('2d')!.putImageData(this.sewerImg!, 0, 0, Math.max(0, x0), Math.max(0, y0), 2 * R + 2, 2 * R + 2);
  }

  private fit(canvas: HTMLCanvasElement, w: number, h: number): CanvasRenderingContext2D {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    return ctx;
  }

  private drawMini(host: MapViewHost, level: Level): void {
    const S = MINIMAP.size;
    const ctx = this.fit(this.mini, S, S);
    const r = this.levelRect(level);
    const ts = host.map.tileSize;
    const span = Math.min(MINIMAP.span, r.w, r.h);
    const x0 = Math.max(r.x, Math.min(r.x + r.w - span, host.player.x / ts - span / 2));
    const y0 = Math.max(r.y, Math.min(r.y + r.h - span, host.player.y / ts - span / 2));
    ctx.fillStyle = '#050607';
    ctx.fillRect(0, 0, S, S);
    const base = this.base.get(level);
    if (base) ctx.drawImage(base, x0 - r.x, y0 - r.y, span, span, 0, 0, S, S);
    const k = S / span;
    this.drawMarkers(ctx, host, level, (x, y) => [(x / ts - x0) * k, (y / ts - y0) * k], 1);
    ctx.strokeStyle = C.frame;
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, S - 1, S - 1);
  }

  private drawBig(host: MapViewHost, level: Level): void {
    const r = this.levelRect(level);
    const maxW = Math.min(window.innerWidth - 80, 900);
    const maxH = Math.min(window.innerHeight - 170, 900);
    const k = Math.min(maxW / r.w, maxH / r.h);
    const W = Math.floor(r.w * k);
    const H = Math.floor(r.h * k);
    const ctx = this.fit(this.bigCanvas, W, H);
    this.legend.style.maxWidth = `${W}px`;
    (this.big.querySelector('[data-title]') as HTMLElement).textContent = level === 'sewer' ? 'КАРТА · КАНАЛИЗАЦИЯ' : 'КАРТА · СИТИ-17';
    ctx.fillStyle = '#050607';
    ctx.fillRect(0, 0, W, H);
    const base = this.base.get(level);
    if (base) ctx.drawImage(base, 0, 0, W, H);
    const ts = host.map.tileSize;
    if (level === 'city') {
      ctx.font = '600 11px "Segoe UI", Roboto, Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.fillStyle = C.zoneLabel;
      for (const z of this.zoneLabels) {
        ctx.strokeText(z.name, (z.x - r.x) * k, (z.y - r.y) * k);
        ctx.fillText(z.name, (z.x - r.x) * k, (z.y - r.y) * k);
      }
    }
    this.drawMarkers(ctx, host, level, (x, y) => [(x / ts - r.x) * k, (y / ts - r.y) * k], 1.6);
  }

  private drawMarkers(
    ctx: CanvasRenderingContext2D,
    host: MapViewHost,
    level: Level,
    to: (x: number, y: number) => [number, number],
    size: number,
  ): void {
    const { map, player, war, economy, insurgency } = host;
    const dot = (x: number, y: number, r: number, color: string, ring = false) => {
      const [sx, sy] = to(x, y);
      ctx.beginPath();
      ctx.arc(sx, sy, r * size, 0, Math.PI * 2);
      if (ring) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else {
        ctx.fillStyle = color;
        ctx.fill();
      }
    };
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 6);
    const ts = map.tileSize;
    const poi = (type: Parameters<GameMap['poisOf']>[0]) => map.poisOf(type).map((p) => ({ x: (p.x + 0.5) * ts, y: (p.y + 0.5) * ts }));
    if (level === 'city') {
      for (const p of poi('nexus_gate')) dot(p.x, p.y, 3.5, C.nexus);
      for (const p of poi('ration_window')) dot(p.x, p.y, 3, economy.open ? C.ration : 'rgba(255,211,107,0.4)');
      for (const p of poi('shop_counter')) dot(p.x, p.y, 2.5, C.shop);
      for (const n of economy.nodes) if (n.broken) dot(n.x, n.y, 2.5, C.nodeBroken);
      for (const h of map.hatches) if (player.faction === 'rebel' || this.hatches.has(h.id)) dot(h.city.x, h.city.y, 2, C.hatch, true);
      for (const f of war.fronts) {
        const color = f.capture || f.held > 0 ? C.capture : war.active(f) ? C.fight : C.front;
        dot(f.innerGate.x, f.innerGate.y, 3.5, color);
        if (f.capture) dot(f.innerGate.x, f.innerGate.y, 5 + pulse * 3, color, true);
      }
      if (war.alarm && war.code !== 'green') dot(war.alarm.x, war.alarm.y, 4 + pulse * 4, C.alarm, true);
    } else {
      const r = this.levelRect('sewer');
      const known = (x: number, y: number) =>
        player.faction === 'rebel' || this.explored[Math.floor(y / ts) * map.width + Math.floor(x / ts)] === 1;
      for (const h of map.hatches) if (known(h.sewer.x, h.sewer.y)) dot(h.sewer.x, h.sewer.y, 2, C.hatch, true);
      if (insurgency.base && known(insurgency.base.x, insurgency.base.y)) dot(insurgency.base.x, insurgency.base.y, 4, C.base);
      if (insurgency.market && known(insurgency.market.x, insurgency.market.y)) dot(insurgency.market.x, insurgency.market.y, 3, C.market);
      void r;
    }
    // Свои: ГО видит сотрудников Альянса, повстанец — повстанцев (на своём уровне).
    const auth = FACTIONS[player.faction].authority;
    for (const c of host.entities.list) {
      if (c === player || !c.alive || map.levelAt(c.x, c.y) !== level) continue;
      if (auth && FACTIONS[c.faction].authority) dot(c.x, c.y, 1.6, C.ally);
      else if (player.faction === 'rebel' && c.faction === 'rebel') dot(c.x, c.y, 1.6, C.rebelAlly);
    }
    // Игрок — стрелка по взгляду.
    const [px, py] = to(player.x, player.y);
    const a = player.facing;
    const s = 5 * size;
    ctx.fillStyle = C.player;
    ctx.beginPath();
    ctx.moveTo(px + Math.cos(a) * s, py + Math.sin(a) * s);
    ctx.lineTo(px + Math.cos(a + 2.5) * s * 0.8, py + Math.sin(a + 2.5) * s * 0.8);
    ctx.lineTo(px + Math.cos(a - 2.5) * s * 0.8, py + Math.sin(a - 2.5) * s * 0.8);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}
