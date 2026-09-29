import type { GameMap, Level, Rect } from '../world/GameMap';
import type { Character } from '../entities/Character';
import type { EntityManager } from '../entities/EntityManager';
import type { WarSystem } from '../systems/WarSystem';
import type { EconomySystem } from '../systems/EconomySystem';
import type { Housing } from '../systems/Housing';
import type { GangSystem } from '../systems/Gangs';
import type { Fence } from '../systems/Fence';
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
  /** Жильё: свой дом игрока (или явка подпольщика) — кружок на карте. */
  readonly housing?: Housing;
  /** Банды: районы цветом, общаги; барыга — чёрный рынок. */
  readonly gangs?: GangSystem;
  readonly fence?: Fence;
  /** Тюрьма Альянса: маркер у ворот (мигает, пока армия идёт выручать своих). */
  readonly prison?: PrisonSystem | null;
  readonly law?: LawSystem;
}

import type { PrisonSystem } from '../systems/Prison';
import type { LawSystem } from '../systems/LawSystem';
const C = MINIMAP.colors;
import { GANGS } from '../config/gangs';

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
  /** Для какой карты уже подкрашены районы банд. */
  private turfsFor: GameMap | null = null;
  private zoneLabels: { name: string; x: number; y: number }[] = [];
  private time = 0;
  /** Метка игрока (мир, px) и её уровень; null — нет. */
  marker: { x: number; y: number; level: Level } | null = null;
  /** Дошёл до метки (UI пишет в журнал). */
  onArrive: (() => void) | null = null;
  /** Большая карта: масштаб (1 — уровень целиком) и центр вида (тайлы; NaN — по игроку). */
  private zoom = 1;
  private cx = NaN;
  private cy = NaN;
  /** Как нарисована большая карта в последний раз (для мыши). */
  private view: { x0: number; y0: number; k: number; level: Level } | null = null;
  private drag: { sx: number; sy: number; cx: number; cy: number; moved: boolean } | null = null;

  constructor(parent: HTMLElement) {
    this.mini = document.createElement('canvas');
    this.mini.className = 'minimap';
    parent.appendChild(this.mini);
    this.big = document.createElement('div');
    this.big.className = 'bigmap';
    this.big.hidden = true;
    this.big.innerHTML = `<div class="bigmap-box panel"><div class="inv-head"><span data-title>КАРТА</span><span class="bigmap-hint">колесо — масштаб · тянуть — сдвиг · ЛКМ — метка · ПКМ — снять · M / Esc — закрыть</span></div><canvas></canvas><div class="bigmap-legend"></div></div>`;
    this.bigCanvas = this.big.querySelector('canvas')!;
    this.legend = this.big.querySelector('.bigmap-legend')!;
    parent.appendChild(this.big);
    this.big.addEventListener('click', (e) => e.target === this.big && this.toggleBig(false));
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.bigOpen) this.toggleBig(false);
    });
    this.bindMouse();
    this.legend.innerHTML = [
      [C.player, 'вы'],
      [C.fight, 'КПП: бой'],
      [C.capture, 'КПП: капт / захвачен'],
      [C.nexus, 'Нексус'],
      [C.ration, 'раздача и столовая'],
      [C.shop, 'магазин ГСР'],
      [C.cwuHq, 'штаб ГСР'],
      [C.arsenal, 'склад Альянса'],
      [C.prison, 'тюрьма Альянса'],
      [C.hatch, 'люк'],
      [C.nodeBroken, 'узел Альянса выведен из строя'],
      [C.alarm, 'тревога'],
      [MINIMAP.waypoint.color, 'ваша метка'],
      [C.scene, 'место происшествия (оцепление)'],
      [C.base, 'лагерь / схрон'],
      [C.market, 'барыга (чёрный рынок)'],
      [GANGS.defs[0].color, 'районы и общаги банд'],
    ]
      .map(([c, t]) => `<span><i style="background:${c}"></i>${t}</span>`)
      .join('');
  }

  get bigOpen(): boolean {
    return !this.big.hidden;
  }

  toggleBig(open = !this.bigOpen): void {
    this.big.hidden = !open;
    // Открыли — вид вокруг себя (при том же масштабе).
    if (open) this.cx = this.cy = NaN;
    this.drag = null;
  }

  /** Мышь на большой карте: колесо — масштаб к курсору, тянуть — сдвиг, клик — метка, ПКМ — снять. */
  private bindMouse(): void {
    const B = MINIMAP.big;
    const cv = this.bigCanvas;
    const tileAt = (e: MouseEvent) => {
      const v = this.view!;
      const r = cv.getBoundingClientRect();
      return { x: v.x0 + (e.clientX - r.left) / v.k, y: v.y0 + (e.clientY - r.top) / v.k };
    };
    cv.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (!this.view) return;
        const before = tileAt(e);
        const z = Math.max(1, Math.min(B.maxZoom, this.zoom * (e.deltaY < 0 ? B.step : 1 / B.step)));
        if (z === this.zoom) return;
        // Точка под курсором остаётся на месте.
        const v = this.view;
        const k1 = (v.k / this.zoom) * z;
        const r = cv.getBoundingClientRect();
        const mx = e.clientX - r.left;
        const my = e.clientY - r.top;
        this.zoom = z;
        this.cx = before.x - mx / k1 + r.width / 2 / k1;
        this.cy = before.y - my / k1 + r.height / 2 / k1;
      },
      { passive: false },
    );
    cv.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || !this.view) return;
      const v = this.view;
      const r = cv.getBoundingClientRect();
      this.drag = { sx: e.clientX, sy: e.clientY, cx: v.x0 + r.width / 2 / v.k, cy: v.y0 + r.height / 2 / v.k, moved: false };
    });
    window.addEventListener('mousemove', (e) => {
      const d = this.drag;
      if (!d || !this.view) return;
      const dx = e.clientX - d.sx;
      const dy = e.clientY - d.sy;
      if (!d.moved && Math.hypot(dx, dy) < B.drag) return;
      d.moved = true;
      this.cx = d.cx - dx / this.view.k;
      this.cy = d.cy - dy / this.view.k;
    });
    window.addEventListener('mouseup', (e) => {
      const d = this.drag;
      this.drag = null;
      if (!d || d.moved || e.button !== 0 || !this.view || !this.map) return;
      const t = tileAt(e);
      const ts = this.map.tileSize;
      this.marker = { x: t.x * ts, y: t.y * ts, level: this.view.level };
    });
    cv.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.marker = null;
    });
  }

  /** Сбросить знания (новая карта) и при необходимости восстановить из сохранения. */
  reset(map: GameMap, explored?: Uint8Array | null, hatches?: number[]): void {
    this.map = map;
    this.marker = null;
    this.zoom = 1;
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
    this.turfsFor = null;
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
      if (!zone || n < 40 || zone.kind === 'avenue' || zone.kind === 'outlands' || zone.kind === 'wasteland') continue;
      // Части КПП — коротко: «D3», «шорт», «лонг», «D4».
      const name = zone.kind === 'checkpoint' ? zone.name.replace(/^.* · /, '') : zone.name;
      this.zoneLabels.push({ name, x: sx / n, y: sy / n });
    }
  }

  /** Районы банд — подкраска их кварталов цветом банды, в подписи — название банды. */
  private paintTurfs(gangs: GangSystem): void {
    const map = this.map!;
    this.turfsFor = map;
    const cv = this.base.get('city');
    if (!cv || !gangs.gangs.length) return;
    const r = this.levelRect('city');
    const ctx = cv.getContext('2d')!;
    const img = ctx.getImageData(0, 0, r.w, r.h);
    const A = MINIMAP.turfAlpha;
    for (const g of gangs.gangs) {
      const c = g.def.color;
      const [tr, tg, tb] = [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
      for (let y = 0; y < r.h; y++) {
        for (let x = 0; x < r.w; x++) {
          if (!g.turf.has(map.zoneGrid[(r.y + y) * map.width + r.x + x])) continue;
          const i = (y * r.w + x) * 4;
          img.data[i] += (tr - img.data[i]) * A;
          img.data[i + 1] += (tg - img.data[i + 1]) * A;
          img.data[i + 2] += (tb - img.data[i + 2]) * A;
        }
      }
      const z = [...g.turf].map((id) => map.zones[id]?.name);
      for (const l of this.zoneLabels) if (z.includes(l.name) && !l.name.includes('·')) l.name = `${l.name} · ${g.def.name}`;
    }
    ctx.putImageData(img, 0, 0);
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
    if (host.gangs && this.turfsFor !== map) this.paintTurfs(host.gangs);
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
    const m = this.marker;
    if (m && m.level === level && Math.hypot(m.x - player.x, m.y - player.y) < MINIMAP.waypoint.reach) {
      this.marker = null;
      this.onArrive?.();
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
    const m = this.marker;
    if (m && m.level === level) this.drawPin(ctx, (m.x / ts - x0) * k, (m.y / ts - y0) * k, 1, S);
    ctx.strokeStyle = C.frame;
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, S - 1, S - 1);
  }

  private drawBig(host: MapViewHost, level: Level): void {
    const r = this.levelRect(level);
    const maxW = Math.min(window.innerWidth - 80, 900);
    const maxH = Math.min(window.innerHeight - 170, 900);
    const k0 = Math.min(maxW / r.w, maxH / r.h);
    const W = Math.floor(r.w * k0);
    const H = Math.floor(r.h * k0);
    const ctx = this.fit(this.bigCanvas, W, H);
    this.legend.style.maxWidth = `${W}px`;
    (this.big.querySelector('[data-title]') as HTMLElement).textContent = `${level === 'sewer' ? 'КАРТА · КАНАЛИЗАЦИЯ' : 'КАРТА · СИТИ-17'}${this.zoom > 1 ? ` · ×${this.zoom.toFixed(1)}` : ''}`;
    const ts = host.map.tileSize;
    // Вид: масштаб zoom, центр — выбранный или игрок; не выходит за уровень.
    const k = k0 * this.zoom;
    const vw = W / k;
    const vh = H / k;
    if (Number.isNaN(this.cx)) {
      this.cx = host.player.x / ts;
      this.cy = host.player.y / ts;
    }
    const x0 = Math.max(r.x, Math.min(r.x + r.w - vw, this.cx - vw / 2));
    const y0 = Math.max(r.y, Math.min(r.y + r.h - vh, this.cy - vh / 2));
    this.cx = x0 + vw / 2;
    this.cy = y0 + vh / 2;
    this.view = { x0, y0, k, level };
    this.bigCanvas.style.cursor = this.drag?.moved ? 'grabbing' : 'crosshair';
    ctx.fillStyle = '#050607';
    ctx.fillRect(0, 0, W, H);
    const base = this.base.get(level);
    if (base) ctx.drawImage(base, x0 - r.x, y0 - r.y, vw, vh, 0, 0, W, H);
    if (level === 'city') {
      ctx.font = `600 ${Math.round(11 + Math.min(3, this.zoom - 1))}px "Segoe UI", Roboto, Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.fillStyle = C.zoneLabel;
      for (const z of this.zoneLabels) {
        const zx = (z.x - x0) * k;
        const zy = (z.y - y0) * k;
        if (zx < -60 || zy < -20 || zx > W + 60 || zy > H + 20) continue;
        ctx.strokeText(z.name, zx, zy);
        ctx.fillText(z.name, zx, zy);
      }
    }
    const size = 1.6 * Math.min(2, Math.sqrt(this.zoom));
    this.drawMarkers(ctx, host, level, (x, y) => [(x / ts - x0) * k, (y / ts - y0) * k], size);
    const m = this.marker;
    if (m && m.level === level) this.drawPin(ctx, (m.x / ts - x0) * k, (m.y / ts - y0) * k, size, null);
  }

  /** Метка: булавка; за краем мини-карты — у края (edge — размер области). */
  private drawPin(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, edge: number | null): void {
    const P = MINIMAP.waypoint;
    let px = x;
    let py = y;
    if (edge !== null) {
      px = Math.max(4, Math.min(edge - 4, x));
      py = Math.max(4, Math.min(edge - 4, y));
    }
    const s = 3.2 * size;
    ctx.fillStyle = P.color;
    ctx.strokeStyle = P.edge;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px - s * 0.8, py - s * 1.6);
    ctx.arc(px, py - s * 1.9, s, Math.PI * 0.8, Math.PI * 0.2, false);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = P.edge;
    ctx.beginPath();
    ctx.arc(px, py - s * 1.9, s * 0.38, 0, Math.PI * 2);
    ctx.fill();
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
      for (const p of poi('canteen_serve')) dot(p.x, p.y, 3, C.ration);
      for (const p of poi('cwu_hire')) dot(p.x, p.y, 3, C.cwuHq);
      for (const p of poi('arsenal_desk')) dot(p.x, p.y, 3, C.arsenal);
      // Тюрьма — у ворот; идёт штурм армии — мигает.
      const gate = host.law?.prisonGate;
      if (gate) dot(gate.x, gate.y, 3.5, host.prison?.rescue && pulse > 0.5 ? C.alarm : C.prison);
      // Общаги банд — цветом банды; хата барыги — тем, кто с улицы или из подполья.
      for (const g of host.gangs?.gangs ?? []) dot(g.hq.x, g.hq.y, 3, g.def.color);
      const fence = host.fence?.counter;
      if (fence && (player.faction === 'rebel' || player.gang >= 0 || player.profession === 'thief' || player.profession === 'bandit')) dot(fence.x, fence.y, 3, C.market);
      const home = host.housing?.of(player);
      if (home) dot(home.at.x, home.at.y, 3.5, home.stash ? C.base : C.home, true);
      for (const n of economy.nodes) if (n.broken) dot(n.x, n.y, 2.5, C.nodeBroken);
      for (const h of map.hatches) if (player.profession === 'partisan' || player.profession === 'spec_agent' || this.hatches.has(h.id)) dot(h.city.x, h.city.y, 2, C.hatch, true);
      // Лагерь сопротивления в пустоши — своим.
      if (player.faction === 'rebel') for (const p of poi('rebel_camp')) dot(p.x, p.y, 4, C.base);
      for (const f of war.fronts) {
        const color = f.capture || f.held > 0 ? C.capture : war.active(f) ? C.fight : C.front;
        dot(f.innerGate.x, f.innerGate.y, 3.5, color);
        if (f.capture) dot(f.innerGate.x, f.innerGate.y, 5 + pulse * 3, color, true);
      }
      if (war.alarm && war.code !== 'green') dot(war.alarm.x, war.alarm.y, 4 + pulse * 4, C.alarm, true);
      // Места происшествий: жёлтый квадрат в чёрной рамке, мигающее кольцо.
      for (const sc of war.scenes.list) {
        if (sc.closed) continue;
        const [sx, sy] = to(sc.x, sc.y);
        const r = 2.6 * size;
        ctx.fillStyle = C.sceneEdge;
        ctx.fillRect(sx - r - 1, sy - r - 1, r * 2 + 2, r * 2 + 2);
        ctx.fillStyle = C.scene;
        ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
        dot(sc.x, sc.y, 4 + pulse * 2.5, C.scene, true);
      }
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
