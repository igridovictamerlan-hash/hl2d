import type { Vec2 } from '../core/math';
import type { CrimeScene } from '../systems/CrimeScenes';
import type { Cell } from '../systems/LawSystem';
import type { View } from '../core/Camera';
import type { CombatSystem } from '../systems/CombatSystem';
import type { LaborSystem } from '../systems/LaborSystem';
import type { Scanner } from '../systems/ScannerSystem';
import { CP_UNITS } from '../config/cpUnits';
import { LABOR } from '../config/labor';
import type { EconomySystem } from '../systems/EconomySystem';
import type { Character } from '../entities/Character';
import type { WarSystem } from '../systems/WarSystem';
import type { GameMap } from './GameMap';
import { colorsOf } from '../config/factions';
import { lookSeed } from '../entities/PawnRenderer';
import { drawPawnCached } from '../entities/PawnCache';
import type { Barrel, Bench, Lamp, NoticeBoard } from '../systems/StreetLife';
import type { Poi } from './GameMap';
import { PAWN } from '../config/pawns';
import { RENDER } from '../config/render';
import { GRENADE, MINE } from '../config/combat';
import { FACTIONS } from '../config/factions';
import { lineOfSight } from './visibility';

/**
 * Эффекты мира: тела погибших, поломки (щитки), места в очереди за рационом, трассеры и
 * попадания, красная тревога и «ранен» по краям экрана.
 */
export class EffectsRenderer {
  drawGround(ctx: CanvasRenderingContext2D, v: View, combat: CombatSystem, economy: EconomySystem, now: number, map?: GameMap, cache?: { x: number; y: number } | null): void {
    const s = v.scale;
    const E = RENDER.effects;
    const onScreen = (x: number, y: number, m: number) => x > -m && y > -m && x < v.width + m && y < v.height + m;
    // Люки: в городе — крышка, в канализации — лестница и свет сверху.
    if (map) {
      for (const h of map.hatches) {
        const cx = (h.city.x - v.left) * s;
        const cy = (h.city.y - v.top) * s;
        if (onScreen(cx, cy, 20)) {
          ctx.fillStyle = E.hatchCover;
          ctx.beginPath();
          ctx.arc(cx, cy, 9 * s, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = E.hatchRim;
          ctx.lineWidth = Math.max(1, 1.2 * s);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(cx - 5 * s, cy - 3 * s); ctx.lineTo(cx + 5 * s, cy - 3 * s);
          ctx.moveTo(cx - 6 * s, cy); ctx.lineTo(cx + 6 * s, cy);
          ctx.moveTo(cx - 5 * s, cy + 3 * s); ctx.lineTo(cx + 5 * s, cy + 3 * s);
          ctx.stroke();
        }
        const sx = (h.sewer.x - v.left) * s;
        const sy = (h.sewer.y - v.top) * s;
        if (onScreen(sx, sy, 40)) {
          const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, 34 * s);
          g.addColorStop(0, E.hatchLight);
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g;
          ctx.fillRect(sx - 34 * s, sy - 34 * s, 68 * s, 68 * s);
          ctx.strokeStyle = E.hatchLadder;
          ctx.lineWidth = Math.max(1, 1.5 * s);
          ctx.beginPath();
          ctx.moveTo(sx - 5 * s, sy - 9 * s); ctx.lineTo(sx - 5 * s, sy + 9 * s);
          ctx.moveTo(sx + 5 * s, sy - 9 * s); ctx.lineTo(sx + 5 * s, sy + 9 * s);
          for (let k = -6; k <= 6; k += 4) {
            ctx.moveTo(sx - 5 * s, sy + k * s);
            ctx.lineTo(sx + 5 * s, sy + k * s);
          }
          ctx.stroke();
        }
      }
    }
    // Тайник сопротивления.
    if (cache) {
      const x = (cache.x - v.left) * s;
      const y = (cache.y - v.top) * s;
      if (onScreen(x, y, 20)) {
        ctx.fillStyle = E.cache;
        ctx.fillRect(x - 7 * s, y - 5 * s, 14 * s, 10 * s);
        ctx.fillStyle = E.loot;
        ctx.fillRect(x - 1 * s, y - 5 * s, 2 * s, 10 * s);
      }
    }
    // Места очереди — пока открыта раздача.
    if (economy.open) {
      ctx.fillStyle = E.queueMark;
      for (let i = 0; i < 9; i++) {
        const q = economy.queueSlot(i);
        ctx.fillRect((q.x - v.left) * s - 5 * s, (q.y - v.top) * s - 1 * s, 10 * s, 2 * s);
      }
    }
    // Щитки: целый — серый, сломанный — мигает. Узлы Альянса — панель с огоньком / искрами.
    for (const r of economy.repairs) {
      const x = (r.x - v.left) * s;
      const y = (r.y - v.top) * s;
      if (x < -20 || y < -20 || x > v.width + 20 || y > v.height + 20) continue;
      if (r.kind === 'node') {
        ctx.fillStyle = E.node;
        ctx.fillRect(x - 6 * s, y - 6 * s, 12 * s, 12 * s);
        ctx.fillStyle = r.broken ? E.nodeDead : E.nodeLight;
        ctx.fillRect(x - 3 * s, y - 3 * s, 6 * s, 6 * s);
        if (r.broken && Math.floor(now * 7 + r.index) % 3 === 0) {
          ctx.fillStyle = E.nodeSpark;
          ctx.fillRect(x + (((now * 37) % 8) - 4) * s, y - 8 * s, 2 * s, 2 * s);
          ctx.fillRect(x - (((now * 23) % 8) - 4) * s, y + 6 * s, 2 * s, 2 * s);
        }
        if (r.worker && r.broken) {
          ctx.fillStyle = E.progress;
          ctx.fillRect(x - 8 * s, y - 10 * s, 16 * s * Math.min(1, r.progress / 5), 2 * s);
        }
        continue;
      }
      ctx.fillStyle = r.broken ? (Math.floor(now * 4) % 2 ? E.brokenA : E.brokenB) : E.fusebox;
      ctx.fillRect(x - 4 * s, y - 4 * s, 8 * s, 8 * s);
      if (r.worker && r.broken) {
        ctx.fillStyle = E.progress;
        ctx.fillRect(x - 8 * s, y - 9 * s, 16 * s * Math.min(1, r.progress / 5), 2 * s);
      }
    }
    // Следы: копоть, кровь, выбоины, гильзы (исчезают к концу жизни). Прозрачность — globalAlpha,
    // гильза — повёрнутый прямоугольник через setTransform: без save/restore и новых строк цвета.
    for (const d of combat.decals) {
      const x = (d.x - v.left) * s;
      const y = (d.y - v.top) * s;
      if (!onScreen(x, y, 40)) continue;
      const a = Math.min(1, (d.until - now) / 8);
      if (a <= 0) continue;
      if (d.kind === 'casing') {
        ctx.globalAlpha = a;
        ctx.fillStyle = E.casing;
        const c = Math.cos(d.ang);
        const n = Math.sin(d.ang);
        ctx.setTransform(c, n, -n, c, x, y);
        ctx.fillRect(-1.5 * s, -0.7 * s, 3 * s, 1.4 * s);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      } else if (d.kind === 'blood') {
        ctx.globalAlpha = 0.55 * a;
        ctx.fillStyle = E.bloodDecalColor;
        ctx.beginPath();
        ctx.ellipse(x, y, 5 * d.size * s, 3 * d.size * s, d.ang, 0, Math.PI * 2);
        ctx.moveTo(x + Math.cos(d.ang) * 6 * s + 1.4 * s, y + Math.sin(d.ang) * 6 * s);
        ctx.arc(x + Math.cos(d.ang) * 6 * s, y + Math.sin(d.ang) * 6 * s, 1.4 * s, 0, Math.PI * 2);
        ctx.fill();
      } else if (d.kind === 'scorch') {
        const r = GRENADE.radius * 0.38 * s;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(${E.scorch},${0.75 * a})`);
        g.addColorStop(0.6, `rgba(${E.scorch},${0.35 * a})`);
        g.addColorStop(1, `rgba(${E.scorch},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      } else {
        ctx.globalAlpha = a;
        ctx.fillStyle = E.chip;
        ctx.fillRect(x - 1 * d.size * s, y - 1 * d.size * s, 2 * d.size * s, 2 * d.size * s);
      }
    }
    ctx.globalAlpha = 1;
    // Тела.
    for (const c of combat.corpses) {
      const x = (c.x - v.left) * s;
      const y = (c.y - v.top) * s;
      if (x < -30 || y < -30 || x > v.width + 30 || y > v.height + 30) continue;
      const col = colorsOf(c.faction, c.rank);
      ctx.fillStyle = E.blood;
      ctx.beginPath();
      ctx.ellipse(x + 3 * s, y + 4 * s, 16 * s, 9 * s, 0.4, 0, Math.PI * 2);
      ctx.fill();
      // Тело — пешка лежит на боку (повёрнута), чуть блеклая.
      const seed = lookSeed(c.name);
      // Накрытое тело — только простыня.
      if (c.covered) {
        this.drawSheet(ctx, x, y, s, seed);
        continue;
      }
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(seed % 2 ? Math.PI / 2 : -Math.PI / 2);
      ctx.globalAlpha = PAWN.corpseAlpha;
      drawPawnCached(ctx, { faction: c.faction, rank: c.rank, color: col.color, seed, profession: c.profession }, 0, -2 * s, s * PAWN.scale, 'S');
      ctx.restore();
      ctx.globalAlpha = 1;
      if (c.loot.length) {
        ctx.fillStyle = E.loot;
        ctx.fillRect(x + 8 * s, y - 10 * s, 3 * s, 3 * s);
      }
    }
  }

  /**
   * Работы профессий на земле: кучи мусора, конвейер завода с коробками на складе, коробки у
   * будки раздачи (склад будки) с числом рационов.
   */
  /** Деревья в садах особняков (POI tree). Обстановка комнат — world/FurnitureRenderer. */
  drawFurniture(ctx: CanvasRenderingContext2D, v: View, pois: readonly Poi[], ts: number): void {
    const s = v.scale;
    const F = RENDER.effects.furniture;
    for (let k = 0; k < pois.length; k++) {
      const p = pois[k];
      const x = (p.x * ts - v.left) * s;
      const y = (p.y * ts - v.top) * s;
      const w = (p.w ?? 1) * ts * s;
      const h = (p.h ?? 1) * ts * s;
      if (x > v.width + 40 || y > v.height + 40 || x + w < -40 || y + h < -40) continue;
      switch (p.type) {
        case 'tree': {
          // Дерево в саду: тень, крона из трёх кругов, блик.
          const cx = x + 8 * s;
          const cy = y + 8 * s;
          ctx.fillStyle = F.treeShade;
          ctx.beginPath();
          ctx.arc(cx + 3 * s, cy + 4 * s, 13 * s, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = F.tree[0];
          ctx.beginPath();
          ctx.arc(cx, cy, 12 * s, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = F.tree[1];
          ctx.beginPath();
          ctx.arc(cx - 4 * s, cy - 3 * s, 7 * s, 0, Math.PI * 2);
          ctx.moveTo(cx + 11 * s, cy + 2 * s);
          ctx.arc(cx + 5 * s, cy + 2 * s, 6 * s, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
      }
    }
  }

  /** Пятно света фонаря — спрайт (градиент рисуется один раз, дальше drawImage). */
  private lampGlow: HTMLCanvasElement | null = null;

  /**
   * Скамейки и фонари главного проспекта (под персонажами). lit — насколько горят фонари (время
   * суток, world/Lighting): днём плафон погашен и пятна под ним нет.
   */
  drawAvenue(ctx: CanvasRenderingContext2D, v: View, lamps: readonly Lamp[], benches: readonly Bench[], boards: readonly NoticeBoard[] = [], lit = 1): void {
    const s = v.scale;
    const L = RENDER.effects.lamp;
    const B = RENDER.effects.bench;
    const pad = (L.glowRadius + 8) * s;
    for (let k = 0; k < benches.length; k++) {
      const b = benches[k];
      const x = (b.x - v.left) * s;
      const y = (b.y - v.top) * s;
      if (x < -pad || y < -pad || x > v.width + pad || y > v.height + pad) continue;
      // Вдоль стены — длина, от стены — глубина; спинка у стены.
      const along = b.ny !== 0;
      const w = (along ? B.length : B.depth) * s;
      const h = (along ? B.depth : B.length) * s;
      ctx.fillStyle = B.leg;
      ctx.fillRect(x - w / 2 - s, y - h / 2 - s, w + 2 * s, h + 2 * s);
      ctx.fillStyle = B.wood;
      ctx.fillRect(x - w / 2, y - h / 2, w, h);
      // Щели между досками и спинка.
      ctx.fillStyle = B.dark;
      if (along) {
        ctx.fillRect(x - w / 2, y - 0.5 * s, w, s);
        ctx.fillRect(x - w / 2, b.ny > 0 ? y - h / 2 - 2 * s : y + h / 2, w, 2.5 * s);
      } else {
        ctx.fillRect(x - 0.5 * s, y - h / 2, s, h);
        ctx.fillRect(b.nx > 0 ? x - w / 2 - 2 * s : x + w / 2, y - h / 2, 2.5 * s, h);
      }
    }
    // Доски объявлений: рамка на стене, листки.
    const N = RENDER.effects.board;
    for (let k = 0; k < boards.length; k++) {
      const b = boards[k];
      const x = (b.x - v.left) * s;
      const y = (b.y - v.top) * s;
      if (x < -pad || y < -pad || x > v.width + pad || y > v.height + pad) continue;
      const along = b.ny !== 0;
      const w = (along ? 22 : 5) * s;
      const h = (along ? 5 : 22) * s;
      ctx.fillStyle = N.frame;
      ctx.fillRect(x - w / 2, y - h / 2, w, h);
      ctx.fillStyle = N.paper;
      for (let p = 0; p < 3; p++) {
        const o = (p - 1) * 7 * s;
        if (along) ctx.fillRect(x + o - 2.5 * s, y - 1.5 * s, 5 * s, 3 * s);
        else ctx.fillRect(x - 1.5 * s, y + o - 2.5 * s, 3 * s, 5 * s);
      }
    }
    if (!this.lampGlow) {
      const r = 64;
      const c = document.createElement('canvas');
      c.width = c.height = r * 2;
      const g = c.getContext('2d')!;
      const grad = g.createRadialGradient(r, r, 0, r, r, r);
      grad.addColorStop(0, `rgba(${L.glow},1)`);
      grad.addColorStop(1, `rgba(${L.glow},0)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, r * 2, r * 2);
      this.lampGlow = c;
    }
    const gr = L.glowRadius * s;
    for (let k = 0; k < lamps.length; k++) {
      const l = lamps[k];
      const x = (l.x - v.left) * s;
      const y = (l.y - v.top) * s;
      if (x < -pad || y < -pad || x > v.width + pad || y > v.height + pad) continue;
      // Плафон на кронштейне над улицей, свет — пятном под ним.
      const hx = x + l.nx * 12 * s;
      const hy = y + l.ny * 12 * s;
      if (lit > 0.02) {
        ctx.globalAlpha = L.glowAlpha * lit;
        ctx.drawImage(this.lampGlow, hx - gr, hy - gr, gr * 2, gr * 2);
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = L.arm;
      ctx.lineWidth = Math.max(1, 2 * s);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      ctx.fillStyle = L.post;
      ctx.beginPath();
      ctx.arc(x, y, 3.2 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = L.rim;
      ctx.beginPath();
      ctx.arc(hx, hy, 4.2 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = L.head;
      ctx.beginPath();
      ctx.arc(hx, hy, 3 * s, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Места преступления: лента между конусами (жёлтая с чёрными полосами) и оранжевые конусы. */
  /**
   * Растяжки: свои (той же стороны, что игрок) видны всегда, чужие — только вблизи (MINE.seeRange)
   * и в прямой видимости. Граната, проволока в сторону, у взведённой мигает огонёк.
   */
  drawMines(ctx: CanvasRenderingContext2D, v: View, combat: CombatSystem, player: Character, map: GameMap): void {
    const s = v.scale;
    const M = RENDER.effects.mine;
    const mine = FACTIONS[player.faction].authority;
    const now = combat.now;
    ctx.lineCap = 'round';
    for (const m of combat.mines) {
      const own = m.alliance === mine || m.owner === player;
      if (!own && (Math.hypot(m.x - player.x, m.y - player.y) > MINE.seeRange || !lineOfSight(map, player.x, player.y, m.x, m.y))) continue;
      const x = (m.x - v.left) * s;
      const y = (m.y - v.top) * s;
      if (x < -20 || y < -20 || x > v.width + 20 || y > v.height + 20) continue;
      // Проволока — в сторону, заданную координатами (без случайности на кадр).
      const a = ((m.x * 0.37 + m.y * 0.61) % 6.283);
      ctx.strokeStyle = M.wire;
      ctx.lineWidth = Math.max(1, 0.8 * s);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * M.wireLen * s, y + Math.sin(a) * M.wireLen * s);
      ctx.stroke();
      ctx.fillStyle = m.kind === 'fire_grenade' ? M.fire : M.frag;
      ctx.strokeStyle = M.rim;
      ctx.lineWidth = Math.max(1, 1 * s);
      ctx.beginPath();
      ctx.arc(x, y, M.r * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (now >= m.armedAt && Math.floor(now * 2 + m.x) % 2 === 0) {
        ctx.fillStyle = M.light;
        ctx.beginPath();
        ctx.arc(x, y - M.r * 0.45 * s, 1.3 * s, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /**
   * Тело в чёрном мешке (вид сверху): капсула с бликом, молния с бегунком по центру, ручки по бокам,
   * бирка, мазки и капли крови на мешке. Сторона головы и пятна — по внешности (seed).
   */
  private drawSheet(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, seed: number): void {
    const C = RENDER.effects.bag;
    const w = C.w * s;
    const h = C.h * s;
    const dir = seed % 2 ? 1 : -1;
    const x0 = x - w / 2;
    const y0 = y - h / 2;
    // Тень и лужа, натёкшая из-под мешка.
    ctx.fillStyle = C.pool;
    ctx.beginPath();
    ctx.ellipse(x + dir * w * 0.12, y + h * 0.45, w * 0.36, h * 0.42, 0.2 * dir, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = C.shadow;
    ctx.beginPath();
    ctx.roundRect(x0 + 1.5 * s, y0 + 2 * s, w, h, h / 2);
    ctx.fill();
    // Мешок: чуть шире у плеч.
    ctx.fillStyle = C.body;
    ctx.beginPath();
    ctx.roundRect(x0, y0, w, h, h / 2);
    ctx.fill();
    ctx.lineWidth = Math.max(1, 0.9 * s);
    ctx.strokeStyle = C.outline;
    ctx.stroke();
    ctx.fillStyle = C.shine;
    ctx.beginPath();
    ctx.roundRect(x0 + h * 0.35, y0 + h * 0.14, w - h * 0.7, h * 0.22, h * 0.11);
    ctx.fill();
    // Бугорки головы и ступней.
    ctx.fillStyle = C.bump;
    ctx.beginPath();
    ctx.ellipse(x + dir * w * 0.36, y, h * 0.3, h * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x - dir * w * 0.38, y - h * 0.18, h * 0.14, h * 0.13, 0, 0, Math.PI * 2);
    ctx.ellipse(x - dir * w * 0.38, y + h * 0.18, h * 0.14, h * 0.13, 0, 0, Math.PI * 2);
    ctx.fill();
    // Ручки по бокам.
    ctx.fillStyle = C.handle;
    for (const k of [-0.28, 0, 0.28]) {
      ctx.fillRect(x + k * w - 1.2 * s, y0 - 0.9 * s, 2.4 * s, 1.4 * s);
      ctx.fillRect(x + k * w - 1.2 * s, y0 + h - 0.5 * s, 2.4 * s, 1.4 * s);
    }
    // Молния: лента, зубцы, бегунок у головы.
    ctx.fillStyle = C.zipTape;
    ctx.fillRect(x0 + h * 0.4, y - 0.7 * s, w - h * 0.8, 1.4 * s);
    ctx.fillStyle = C.zip;
    for (let d = x0 + h * 0.4; d < x0 + w - h * 0.4; d += 1.6 * s) ctx.fillRect(d, y - 0.35 * s, 0.8 * s, 0.7 * s);
    ctx.fillStyle = C.pull;
    ctx.fillRect(x + dir * (w / 2 - h * 0.45) - 1 * s, y - 1.2 * s, 2 * s, 2.4 * s);
    // Бирка на ногах.
    ctx.fillStyle = C.tag;
    ctx.fillRect(x - dir * (w / 2 - 1 * s) - 1.8 * s, y + h * 0.28, 3.6 * s, 2.6 * s);
    ctx.fillStyle = C.tagInk;
    ctx.fillRect(x - dir * (w / 2 - 1 * s) - 1.2 * s, y + h * 0.28 + 0.8 * s, 2.4 * s, 0.4 * s);
    ctx.fillRect(x - dir * (w / 2 - 1 * s) - 1.2 * s, y + h * 0.28 + 1.6 * s, 1.6 * s, 0.4 * s);
    // Кровь на мешке: мазок и капли.
    const r = (seed >> 2) % 7;
    ctx.fillStyle = C.blood;
    ctx.beginPath();
    ctx.ellipse(x + (r - 3) * s, y + h * 0.18, 3.6 * s, 1.8 * s, 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + (r - 1) * s + 4 * s, y - h * 0.22, 0.9 * s, 0, Math.PI * 2);
    ctx.arc(x - (r + 2) * s, y + h * 0.36, 0.7 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = C.bloodShine;
    ctx.fillRect(x + (r - 4) * s, y + h * 0.12, 1.4 * s, 0.5 * s);
  }

  /**
   * Места преступления: в переулке — жёлтая лента в чёрную полоску, провисает между двумя
   * дорожными конусами у стен (тень ленты на земле); на широких улицах — ряд козел (drawBarriers).
   */
  drawScenes(ctx: CanvasRenderingContext2D, v: View, scenes: readonly CrimeScene[]): void {
    const s = v.scale;
    const C = RENDER.effects.scene;
    for (let k = 0; k < scenes.length; k++) {
      const sc = scenes[k];
      if (sc.closed) continue;
      const cx = (sc.x - v.left) * s;
      const cy = (sc.y - v.top) * s;
      const R = (sc.r + 24) * s;
      if (cx < -R || cy < -R || cx > v.width + R || cy > v.height + R) continue;
      for (const line of sc.lines) {
        const pts = line.pts;
        if (pts.length < 2) continue;
        if (line.barrier) {
          this.drawBarriers(ctx, v, pts);
          continue;
        }
        const a = pts[0];
        const b = pts[pts.length - 1];
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        // Конусы чуть отступают от стен внутрь прохода.
        const ux = (b.x - a.x) / len;
        const uy = (b.y - a.y) / len;
        const ax = (a.x + ux * C.coneInset - v.left) * s;
        const ay = (a.y + uy * C.coneInset - v.top) * s;
        const bx = (b.x - ux * C.coneInset - v.left) * s;
        const by = (b.y - uy * C.coneInset - v.top) * s;
        const top = C.coneTape * s;
        const sag = Math.min(len * C.sag, C.sagMax) * s;
        const mx = (ax + bx) / 2;
        const my = (ay + by) / 2;
        // Тень ленты на земле.
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.quadraticCurveTo(mx, my + sag * 0.6 + 2 * s, bx, by);
        ctx.lineWidth = C.width * s;
        ctx.strokeStyle = C.tapeShadow;
        ctx.stroke();
        // Конус у одного конца — до ленты, у другого — тоже (лента поверх верхушек).
        this.drawCone(ctx, ax, ay, s);
        this.drawCone(ctx, bx, by, s);
        ctx.beginPath();
        ctx.moveTo(ax, ay - top);
        ctx.quadraticCurveTo(mx, my - top + sag * 2, bx, by - top);
        ctx.lineWidth = (C.width + 0.8) * s;
        ctx.strokeStyle = C.outline;
        ctx.stroke();
        ctx.lineWidth = C.width * s;
        ctx.strokeStyle = C.tape;
        ctx.stroke();
        ctx.setLineDash([C.dash * s, C.dash * s]);
        ctx.strokeStyle = C.stripe;
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  /** Дорожный конус в изометрии: тень, квадратное основание, конус со светлой и тёмной стороной, белые полосы. */
  private drawCone(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
    const C = RENDER.effects.scene;
    const h = C.coneH * s;
    const w = C.coneW * s;
    ctx.fillStyle = C.coneShadow;
    ctx.beginPath();
    ctx.ellipse(x + 2 * s, y + 0.8 * s, w * 0.75, w * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
    // Основание — ромб-плитка.
    ctx.beginPath();
    ctx.moveTo(x - w * 0.62, y);
    ctx.lineTo(x, y - w * 0.3);
    ctx.lineTo(x + w * 0.62, y);
    ctx.lineTo(x, y + w * 0.3);
    ctx.closePath();
    ctx.fillStyle = C.coneBase;
    ctx.fill();
    ctx.lineWidth = Math.max(1, 0.7 * s);
    ctx.strokeStyle = C.outline;
    ctx.stroke();
    // Тело конуса.
    const bw = w * 0.36;
    const tw = w * 0.08;
    ctx.beginPath();
    ctx.moveTo(x - bw, y - 0.4 * s);
    ctx.lineTo(x - tw, y - h);
    ctx.lineTo(x + tw, y - h);
    ctx.lineTo(x + bw, y - 0.4 * s);
    ctx.closePath();
    ctx.fillStyle = C.cone;
    ctx.fill();
    ctx.stroke();
    // Тёмная сторона.
    ctx.beginPath();
    ctx.moveTo(x + bw * 0.15, y - 0.4 * s);
    ctx.lineTo(x + tw * 0.2, y - h);
    ctx.lineTo(x + tw, y - h);
    ctx.lineTo(x + bw, y - 0.4 * s);
    ctx.closePath();
    ctx.fillStyle = C.coneDark;
    ctx.fill();
    // Светоотражающие полосы.
    ctx.fillStyle = C.coneStripe;
    for (const f of [0.38, 0.68]) {
      const yy = y - h * f;
      const half = bw + (tw - bw) * f;
      ctx.fillRect(x - half, yy - 0.7 * s, half * 2, 1.4 * s);
    }
  }

  /** Ряд козел вдоль ломаной: бело-красная доска с косыми полосами на двух опорах, через C.barrierGap px. */
  private drawBarriers(ctx: CanvasRenderingContext2D, v: View, pts: readonly Vec2[]): void {
    const s = v.scale;
    const C = RENDER.effects.scene;
    const half = C.barrierLen / 2;
    const bw = C.barrierWidth / 2;
    let carry = C.barrierGap / 2;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 1e-3) continue;
      const ux = (b.x - a.x) / len;
      const uy = (b.y - a.y) / len;
      const nx = -uy;
      const ny = ux;
      for (let d = carry; d <= len; d += C.barrierGap) {
        const mx = (a.x + ux * d - v.left) * s;
        const my = (a.y + uy * d - v.top) * s;
        const P = (along: number, across: number): [number, number] => [mx + (ux * along + nx * across) * s, my + (uy * along + ny * across) * s];
        const quad = (p: [number, number][], fill: string, stroke = false): void => {
          ctx.beginPath();
          ctx.moveTo(p[0][0], p[0][1]);
          for (let q = 1; q < p.length; q++) ctx.lineTo(p[q][0], p[q][1]);
          ctx.closePath();
          ctx.fillStyle = fill;
          ctx.fill();
          if (stroke) {
            ctx.lineWidth = Math.max(1, 0.8 * s);
            ctx.strokeStyle = C.outline;
            ctx.stroke();
          }
        };
        // Тень.
        ctx.fillStyle = C.barrierShadow;
        const [shx, shy] = P(0, 0);
        ctx.beginPath();
        ctx.ellipse(shx + 1.5 * s, shy + 2.5 * s, (half + 1) * s, 3 * s, Math.atan2(uy, ux), 0, Math.PI * 2);
        ctx.fill();
        // Опоры — поперёк доски.
        for (const k of [-half + 2.5, half - 2.5]) quad([P(k - 1.4, -3.4), P(k + 1.4, -3.4), P(k + 1.4, 3.4), P(k - 1.4, 3.4)], C.barrierLeg, true);
        // Доска и косые красные полосы.
        quad([P(-half, -bw), P(half, -bw), P(half, bw), P(-half, bw)], C.barrierWhite, true);
        for (let t = -half; t < half - 1; t += C.barrierStripe * 2) {
          const t1 = Math.min(t + C.barrierStripe, half);
          quad([P(t, -bw), P(Math.min(t1, half), -bw), P(Math.max(t1 - 1.6, -half), bw), P(Math.max(t - 1.6, -half), bw)], C.barrierRed);
        }
        ctx.lineWidth = Math.max(1, 0.8 * s);
        ctx.strokeStyle = C.outline;
        const c0 = P(-half, -bw);
        const c1 = P(half, bw);
        ctx.beginPath();
        const c2 = P(half, -bw);
        const c3 = P(-half, bw);
        ctx.moveTo(c0[0], c0[1]);
        ctx.lineTo(c2[0], c2[1]);
        ctx.lineTo(c1[0], c1[1]);
        ctx.lineTo(c3[0], c3[1]);
        ctx.closePath();
        ctx.stroke();
      }
      carry = C.barrierGap - ((len - carry) % C.barrierGap);
      if (carry > C.barrierGap) carry -= C.barrierGap;
    }
  }

  /** Планшет с зажимом в руках у медика на месте происшествия (пишет — строки прибавляются). */
  drawNotepads(ctx: CanvasRenderingContext2D, v: View, list: readonly Character[], now: number, lawNow: number): void {
    const s = v.scale;
    const C = RENDER.effects.notepad;
    for (let k = 0; k < list.length; k++) {
      const c = list[k];
      if (c.notepadUntil <= now || !c.alive || !c.visible) continue;
      const x = (c.x + Math.cos(c.facing) * 6 - v.left) * s;
      const y = (c.y + Math.sin(c.facing) * 6 - v.top) * s;
      if (x < -20 || y < -20 || x > v.width + 20 || y > v.height + 20) continue;
      const w = C.w * s;
      const h = C.h * s;
      ctx.fillStyle = C.board;
      ctx.beginPath();
      ctx.roundRect(x - w / 2, y - h / 2, w, h, 0.8 * s);
      ctx.fill();
      ctx.lineWidth = Math.max(1, 0.6 * s);
      ctx.strokeStyle = C.outline;
      ctx.stroke();
      ctx.fillStyle = C.paper;
      ctx.fillRect(x - w / 2 + 0.7 * s, y - h / 2 + 1.5 * s, w - 1.4 * s, h - 2.2 * s);
      ctx.fillStyle = C.clip;
      ctx.fillRect(x - w * 0.25, y - h / 2 - 0.5 * s, w * 0.5, 1.6 * s);
      ctx.strokeRect(x - w * 0.25, y - h / 2 - 0.5 * s, w * 0.5, 1.6 * s);
      ctx.fillStyle = C.ink;
      const rows = 1 + Math.floor(((lawNow * 0.6 + c.id) % 1) * 4);
      for (let r = 0; r < rows; r++) ctx.fillRect(x - w / 2 + 1.2 * s, y - h / 2 + (2.6 + r * 1.4) * s, w - 2.4 * s - (r % 2) * 1.2 * s, 0.45 * s);
    }
  }

  /**
   * Решётки камер тюрьмы: поверх закрытой двери — рама и прутья (видно, кто сидит), выбитая — погнутая
   * решётка настежь. ts — размер тайла в px мира.
   */
  drawPrisonBars(ctx: CanvasRenderingContext2D, v: View, cells: readonly Cell[], ts: number, now: number): void {
    const s = v.scale;
    const C = RENDER.effects.cage;
    for (let k = 0; k < cells.length; k++) {
      const c = cells[k];
      const d = c.door;
      if (!c.prison || !d) continue;
      const x0 = Math.round((d.bounds.x0 * ts - v.left) * s);
      const y0 = Math.round((d.bounds.y0 * ts - v.top) * s);
      const x1 = Math.round(((d.bounds.x1 + 1) * ts - v.left) * s);
      const y1 = Math.round(((d.bounds.y1 + 1) * ts - v.top) * s);
      if (x1 < 0 || y1 < 0 || x0 > v.width || y0 > v.height) continue;
      const broken = c.brokenUntil > now;
      if (!d.closed && !broken) continue;
      const w = x1 - x0;
      const h = y1 - y0;
      const vertical = h > w;
      ctx.fillStyle = C.floor;
      ctx.fillRect(x0, y0, w, h);
      ctx.fillStyle = C.bar;
      const bw = Math.max(1, s * 1.2);
      const step = C.step * s;
      // Прутья поперёк проёма; выбитая дверь — прутья вполовину (решётка сорвана).
      const part = broken ? 0.4 : 1;
      if (vertical) for (let by = y0 + step / 2; by < y1; by += step) ctx.fillRect(x0, by - bw / 2, w * part, bw);
      else for (let bx = x0 + step / 2; bx < x1; bx += step) ctx.fillRect(bx - bw / 2, y0, bw, h * part);
      ctx.fillStyle = C.frame;
      const t = Math.max(1.5, 2 * s);
      if (vertical) {
        ctx.fillRect(x0, y0, w, t);
        ctx.fillRect(x0, y1 - t, w, t);
      } else {
        ctx.fillRect(x0, y0, t, h);
        ctx.fillRect(x1 - t, y0, t, h);
      }
    }
  }

  /** Курящие: огонёк у руки и дымок, поднимающийся вверх (над пешкой). */
  drawSmokers(ctx: CanvasRenderingContext2D, v: View, list: readonly Character[], now: number): void {
    const s = v.scale;
    const S = RENDER.effects.smoke;
    for (let k = 0; k < list.length; k++) {
      const c = list[k];
      if (!c.smoking || !c.alive || !c.visible) continue;
      const x = (c.x + Math.cos(c.facing) * 7 - v.left) * s;
      const y = (c.y + Math.sin(c.facing) * 7 - v.top) * s;
      if (x < -40 || y < -40 || x > v.width + 40 || y > v.height + 40) continue;
      const pulse = 0.5 + 0.5 * Math.sin(now * 3 + c.id);
      ctx.fillStyle = pulse > 0.5 ? S.ember[0] : S.ember[1];
      ctx.fillRect(x - s, y - s, 2 * s, 2 * s);
      ctx.fillStyle = S.puff;
      for (let p = 0; p < 3; p++) {
        const t = (now * 0.5 + p / 3 + c.id * 0.13) % 1;
        const r = (1.5 + t * 3) * s;
        ctx.globalAlpha = 1 - t;
        ctx.fillRect(x + Math.sin(t * 6 + p) * 3 * s - r / 2, y - t * 18 * s - r / 2, r, r);
      }
      ctx.globalAlpha = 1;
    }
  }

  /** Отсвет бочки на земле — спрайт (градиент один раз). */
  private barrelGlow: HTMLCanvasElement | null = null;

  /** Бочки с огнём: отсвет на земле, ржавая бочка, мерцающие языки пламени и искры. */
  drawBarrels(ctx: CanvasRenderingContext2D, v: View, barrels: readonly Barrel[], now: number): void {
    const s = v.scale;
    const B = RENDER.effects.barrel;
    if (!this.barrelGlow) {
      const r = 64;
      const c = document.createElement('canvas');
      c.width = c.height = r * 2;
      const g = c.getContext('2d')!;
      const grad = g.createRadialGradient(r, r, 0, r, r, r);
      grad.addColorStop(0, `rgba(${B.glow},0.32)`);
      grad.addColorStop(1, `rgba(${B.glow},0)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, r * 2, r * 2);
      this.barrelGlow = c;
    }
    for (let k = 0; k < barrels.length; k++) {
      const b = barrels[k];
      const x = (b.x - v.left) * s;
      const y = (b.y - v.top) * s;
      const gr = B.glowRadius * s;
      if (x < -gr || y < -gr || x > v.width + gr || y > v.height + gr) continue;
      const flick = 0.8 + 0.2 * Math.sin(now * 11 + k * 1.7) * Math.sin(now * 7.3 + k);
      const fr = gr * flick;
      ctx.drawImage(this.barrelGlow, x - fr, y - fr, fr * 2, fr * 2);
      const r = B.r * s;
      ctx.fillStyle = B.body;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = Math.max(1, 1.6 * s);
      ctx.strokeStyle = B.rim;
      ctx.stroke();
      ctx.fillStyle = B.rust;
      ctx.fillRect(x - r * 0.6, y + r * 0.2, r * 0.5, r * 0.35);
      // Пламя: три языка разного цвета, пляшут.
      for (let f = 0; f < 3; f++) {
        const a = now * (5 + f) + k * 2.1 + f * 2;
        ctx.fillStyle = B.fire[2 - f];
        ctx.beginPath();
        ctx.arc(x + Math.sin(a) * r * 0.25, y + Math.cos(a * 1.3) * r * 0.2 - f * r * 0.15, r * (0.75 - f * 0.2) * flick, 0, Math.PI * 2);
        ctx.fill();
      }
      // Искры вверх.
      ctx.fillStyle = B.fire[0];
      for (let f = 0; f < 3; f++) {
        const t = (now * 0.9 + f / 3 + k * 0.37) % 1;
        ctx.fillRect(x + Math.sin(t * 9 + f * 3 + k) * r * 0.8, y - r - t * 22 * s, 1.5 * s, 1.5 * s);
      }
    }
  }

  drawLabor(ctx: CanvasRenderingContext2D, v: View, labor: LaborSystem, stock: number, now: number): void {
    const s = v.scale;
    const E = RENDER.effects;
    const onScreen = (x: number, y: number, m: number) => x > -m && y > -m && x < v.width + m && y < v.height + m;
    for (const p of labor.trash) {
      const x = (p.x - v.left) * s;
      const y = (p.y - v.top) * s;
      if (!onScreen(x, y, 30)) continue;
      for (let k = 0; k < 5; k++) {
        const a = ((p.seed >>> (k * 4)) % 628) / 100;
        const r = 2 + ((p.seed >>> (k * 3)) % 5);
        const w = 3.2 + ((p.seed >>> (k * 5)) % 3);
        ctx.fillStyle = E.trash[(p.seed + k) % E.trash.length];
        ctx.strokeStyle = PAWN.outline;
        ctx.lineWidth = Math.max(0.8, 0.8 * s);
        ctx.beginPath();
        ctx.ellipse(x + Math.cos(a) * r * s, y + Math.sin(a) * r * s, w * s, (w - 1) * s, a, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      if (p.searched) {
        ctx.fillStyle = E.trashSearched;
        ctx.beginPath();
        ctx.arc(x, y, 7 * s, 0, Math.PI * 2);
        ctx.fill();
      }
      // Идёт уборка — полоска.
      if (p.worker && p.progress > 0) {
        ctx.fillStyle = E.progress;
        ctx.fillRect(x - 8 * s, y - 12 * s, 16 * s * Math.min(1, p.progress / LABOR.trash.cleanTime), 2 * s);
      }
    }
    const box = (x: number, y: number) => {
      ctx.fillStyle = E.box;
      ctx.strokeStyle = PAWN.outline;
      ctx.lineWidth = Math.max(1, 1.1 * s);
      ctx.fillRect(x - 4 * s, y - 3.4 * s, 8 * s, 6.8 * s);
      ctx.strokeRect(x - 4 * s, y - 3.4 * s, 8 * s, 6.8 * s);
      ctx.fillStyle = E.boxTape;
      ctx.fillRect(x - 0.7 * s, y - 3.4 * s, 1.4 * s, 6.8 * s);
    };
    // Конвейеры цеха (у каждого места фасовки) и коробки на складе.
    for (const station of labor.stations) {
      const x = (station.belt.x - v.left) * s;
      const y = (station.belt.y - v.top) * s;
      if (onScreen(x, y, 80)) {
        ctx.fillStyle = E.conveyor;
        ctx.strokeStyle = PAWN.outline;
        ctx.lineWidth = Math.max(1, 1.2 * s);
        ctx.fillRect(x - 26 * s, y - 6 * s, 52 * s, 12 * s);
        ctx.strokeRect(x - 26 * s, y - 6 * s, 52 * s, 12 * s);
        ctx.fillStyle = E.conveyorBelt;
        ctx.fillRect(x - 24 * s, y - 3.5 * s, 48 * s, 7 * s);
        // Ролики «бегут».
        ctx.fillStyle = E.roller;
        const shift = (now * 12) % 6;
        for (let k = -24 + shift; k < 24; k += 6) ctx.fillRect(x + k * s, y - 3.5 * s, 1.2 * s, 7 * s);
        // Коробка едет по ленте, только пока здесь фасуют.
        if (station.who) box(x + (((now * 12) % 40) - 20) * s, y);
      }
    }
    {
      const st = labor.factoryStore;
      if (st) {
        const sx = (st.x - v.left) * s;
        const sy = (st.y + 14 - v.top) * s;
        for (let k = 0; k < labor.boxes; k++) box(sx + ((k % 3) - 1) * 9 * s, sy - Math.floor(k / 3) * 7 * s);
      }
    }
    // Склад будки раздачи.
    const d = labor.boothDrop;
    const bx = (d.x - v.left) * s;
    const by = (d.y - v.top) * s;
    if (onScreen(bx, by, 40)) {
      const n = Math.min(6, Math.ceil(stock / LABOR.factory.boxRations));
      for (let k = 0; k < n; k++) box(bx + ((k % 3) - 1) * 9 * s, by - Math.floor(k / 3) * 7 * s);
      ctx.font = `600 ${Math.round(9 * s)}px "Segoe UI", Roboto, Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = stock > 0 ? E.stockText : E.brokenA;
      ctx.fillText(`рационов: ${stock}`, bx, by + 14 * s);
    }
  }

  /** Пламя пиротехника на земле и горящие персонажи (языки огня мерцают). */
  drawFire(ctx: CanvasRenderingContext2D, v: View, combat: CombatSystem, list: readonly Character[], alpha: number, now: number): void {
    const s = v.scale;
    const E = RENDER.effects;
    const flame = (x: number, y: number, h: number, seed: number) => {
      const f = 0.75 + 0.25 * Math.sin(now * 17 + seed * 3.1);
      const w = h * 0.45;
      ctx.fillStyle = E.flameOuter;
      ctx.beginPath();
      ctx.moveTo(x - w, y);
      ctx.quadraticCurveTo(x - w, y - h * 0.6 * f, x + Math.sin(now * 9 + seed) * w * 0.4, y - h * f);
      ctx.quadraticCurveTo(x + w, y - h * 0.6 * f, x + w, y);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = E.flameInner;
      ctx.beginPath();
      ctx.moveTo(x - w * 0.5, y);
      ctx.quadraticCurveTo(x - w * 0.5, y - h * 0.35 * f, x, y - h * 0.6 * f);
      ctx.quadraticCurveTo(x + w * 0.5, y - h * 0.35 * f, x + w * 0.5, y);
      ctx.closePath();
      ctx.fill();
    };
    for (const f of combat.fires) {
      const x = (f.x - v.left) * s;
      const y = (f.y - v.top) * s;
      const r = f.r * s;
      if (x < -r || y < -r || x > v.width + r || y > v.height + r) continue;
      const left = Math.min(1, (f.until - now) / 2);
      ctx.globalAlpha = left;
      ctx.fillStyle = E.flameGlow;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      for (let k = 0; k < 9; k++) {
        const a = k * 2.4 + f.x * 0.01;
        const d = (0.25 + ((k * 37) % 10) / 14) * r * 0.9;
        flame(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.7, (7 + (k % 3) * 3) * s, k + f.x);
      }
      ctx.globalAlpha = 1;
    }
    // Тела, которые сжигает крематор.
    for (const k of combat.corpses) {
      if (!k.burning) continue;
      const x = (k.x - v.left) * s;
      const y = (k.y - v.top) * s;
      for (let j = 0; j < 5; j++) flame(x + (j - 2) * 5 * s, y + ((j % 2) * 4 - 2) * s, (9 + (j % 3) * 3) * s, j + k.x);
    }
    for (const c of list) {
      if (!c.alive || c.burnUntil <= now || !c.visible) continue;
      const x = (c.prevX + (c.x - c.prevX) * alpha - v.left) * s;
      const y = (c.prevY + (c.y - c.prevY) * alpha - v.top) * s;
      for (let k = 0; k < 4; k++) flame(x + (k - 1.5) * 4 * s, y + (4 - (k % 2) * 6) * s, (8 + (k % 2) * 4) * s, k + c.id);
    }
  }

  /** Сканеры Альянса: тень на земле, пятно света, парящий корпус с линзой, вспышка при «фото». */
  /** Разметка точек D на полу камер тамбура: имя точки цветом того, кто её держит. */
  drawPoints(ctx: CanvasRenderingContext2D, v: View, war: WarSystem, now: number): void {
    const s = v.scale;
    const E = RENDER.effects;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.round(22 * s)}px sans-serif`;
    for (const f of war.fronts) {
      f.points.forEach((pt, k) => {
        const x = (pt.center.x - v.left) * s;
        const y = (pt.center.y - v.top) * s;
        if (x < -80 || y < -80 || x > v.width + 80 || y > v.height + 80) return;
        const capturing = f.capture?.point === k;
        ctx.globalAlpha = capturing ? 0.6 + 0.4 * Math.abs(Math.sin(now * 4)) : 1;
        ctx.fillStyle = capturing ? E.pointCapture : k < f.held ? E.pointRebel : E.pointCombine;
        ctx.fillText(pt.name, x, y);
      });
    }
    ctx.restore();
  }

  drawScanners(ctx: CanvasRenderingContext2D, v: View, list: readonly Scanner[], alpha: number, now: number): void {
    const s = v.scale;
    const E = RENDER.effects;
    for (const sc of list) {
      const wx = sc.prevX + (sc.x - sc.prevX) * alpha;
      const wy = sc.prevY + (sc.y - sc.prevY) * alpha;
      const x = (wx - v.left) * s;
      const y = (wy - v.top) * s;
      if (x < -60 || y < -60 || x > v.width + 60 || y > v.height + 60) continue;
      // Свет на земле и тень (дрон висит выше).
      ctx.fillStyle = E.scannerLight;
      ctx.beginPath();
      ctx.ellipse(x, y + 16 * s, 22 * s, 12 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(x + 3 * s, y + 18 * s, 6 * s, 3 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      const hy = y + Math.sin(now * 3 + sc.x * 0.01) * 1.5 * s;
      ctx.fillStyle = E.scannerBody;
      ctx.strokeStyle = PAWN.outline;
      ctx.lineWidth = Math.max(1, 1.3 * s);
      ctx.beginPath();
      ctx.ellipse(x, hy, 7 * s, 5.6 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Антенны-лопасти.
      ctx.strokeStyle = E.scannerRim;
      ctx.beginPath();
      ctx.moveTo(x - 9 * s, hy - 2 * s);
      ctx.lineTo(x - 5 * s, hy - 1 * s);
      ctx.moveTo(x + 9 * s, hy - 2 * s);
      ctx.lineTo(x + 5 * s, hy - 1 * s);
      ctx.stroke();
      ctx.fillStyle = E.scannerLens;
      ctx.beginPath();
      ctx.arc(x, hy + 1 * s, 2.2 * s, 0, Math.PI * 2);
      ctx.fill();
      if (now < sc.flashUntil) {
        const k = (sc.flashUntil - now) / CP_UNITS.scanner.flash;
        ctx.fillStyle = E.scannerFlash;
        ctx.globalAlpha = k;
        ctx.beginPath();
        ctx.arc(x, hy, 18 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }

  /**
   * Пули в полёте (светящийся хвост от прошлого положения к текущему: ядро и ореол; AR2 — голубой
   * импульс, болт — оранжевый, ракета — корпус с пламенем) и гранаты (осколочная — тёмная,
   * дымовая — серая, зажигательная — красная; в полёте — выше и с тенью, на земле мигает огонёк).
   */
  drawShots(ctx: CanvasRenderingContext2D, v: View, combat: CombatSystem): void {
    const s = v.scale;
    const E = RENDER.effects;
    const TR = RENDER.tracers;
    ctx.lineCap = 'round';
    for (const b of combat.bullets) {
      const len = Math.max(6, b.speed * TR.tail);
      const t0 = Math.max(0, b.dist - len);
      const hx = (b.x - v.left) * s;
      const hy = (b.y - v.top) * s;
      const tx = (b.ox + b.dx * t0 - v.left) * s;
      const ty = (b.oy + b.dy * t0 - v.top) * s;
      if (b.rocket) {
        // Ракета: корпус и язык пламени сзади.
        ctx.strokeStyle = TR.rocketFlame;
        ctx.lineWidth = Math.max(1, 2.4 * s);
        ctx.beginPath();
        ctx.moveTo(hx - b.dx * 6 * s, hy - b.dy * 6 * s);
        ctx.lineTo(hx - b.dx * 11 * s, hy - b.dy * 11 * s);
        ctx.stroke();
        ctx.strokeStyle = TR.rocket;
        ctx.lineWidth = Math.max(1, 3 * s);
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(hx - b.dx * 6 * s, hy - b.dy * 6 * s);
        ctx.stroke();
        continue;
      }
      const w = TR.width[b.kind];
      ctx.strokeStyle = b.kind === 'pulse' ? TR.pulse : b.kind === 'crossbow' ? TR.bolt : b.combine ? TR.combine : TR.rebel;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = Math.max(1, w * 2.2 * s);
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = b.kind === 'pulse' ? TR.pulseCore : TR.core;
      ctx.lineWidth = Math.max(0.8, w * 0.8 * s);
      ctx.beginPath();
      ctx.moveTo((tx + hx) / 2, (ty + hy) / 2);
      ctx.lineTo(hx, hy);
      ctx.stroke();
    }
    const now = combat.now;
    for (const g of combat.grenades) {
      const x = (g.x - v.left) * s;
      const y = (g.y - v.top) * s;
      const lift = g.flight < 1 ? Math.sin(Math.PI * g.flight) : 0;
      if (lift > 0) {
        ctx.fillStyle = E.grenadeShadow;
        ctx.beginPath();
        ctx.arc(x, y, 3 * s, 0, Math.PI * 2);
        ctx.fill();
      }
      const gy = y - lift * 14 * s;
      ctx.fillStyle = g.kind === 'smoke_grenade' ? E.grenadeSmoke : g.kind === 'fire_grenade' ? E.grenadeFire : E.grenade;
      ctx.beginPath();
      ctx.arc(x, gy, (3.5 + lift * 1.5) * s, 0, Math.PI * 2);
      ctx.fill();
      // Чем ближе взрыв — тем чаще мигает.
      const left = g.at - now;
      if (Math.floor(now * (left < 0.8 ? 12 : 4)) % 2 === 0) {
        ctx.fillStyle = FACTIONS[g.thrower.faction].authority ? E.grenadeLightCombine : E.grenadeLightRebel;
        ctx.beginPath();
        ctx.arc(x, gy, 1.6 * s, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Огненный шар в первые мгновения взрыва (дальше — частицы).
    for (const b of combat.blasts) {
      const k = 1 - b.t / b.life;
      if (k > 0.4) continue;
      const x = (b.x - v.left) * s;
      const y = (b.y - v.top) * s;
      ctx.fillStyle = `rgba(${E.blastFire},${(0.9 * (1 - k / 0.4)).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, b.r * (0.2 + 0.5 * Math.sqrt(k / 0.4)) * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(${E.blastCore},${(1 - k / 0.4).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, b.r * 0.22 * s, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * Указатели на пограничные КПП у края экрана (если КПП не в кадре): стрелка, название,
   * расстояние; идёт бой — оранжевая мигающая надпись «бой».
   */
  drawFrontMarkers(ctx: CanvasRenderingContext2D, v: View, war: WarSystem, player: Character, dpr: number, now: number): void {
    const M = RENDER.frontMarker;
    const s = v.scale;
    const inset = M.inset * dpr;
    const cx = v.width / 2;
    const cy = v.height / 2;
    ctx.font = M.font.replace(/(\d+)px/, (_, n) => `${Number(n) * dpr}px`);
    ctx.textBaseline = 'middle';
    for (const f of war.fronts) {
      const sx = (f.innerGate.x - v.left) * s;
      const sy = (f.innerGate.y - v.top) * s;
      if (sx > inset && sy > inset && sx < v.width - inset && sy < v.height - inset) continue;
      // Точка на кромке экрана по направлению на КПП.
      const dx = sx - cx;
      const dy = sy - cy;
      const k = Math.min((cx - inset) / Math.max(1e-6, Math.abs(dx)), (cy - inset) / Math.max(1e-6, Math.abs(dy)));
      const x = cx + dx * k;
      const y = cy + dy * k;
      const ang = Math.atan2(dy, dx);
      const fight = war.active(f);
      const color = fight ? `rgba(${M.fight},${(0.65 + 0.35 * Math.sin(now * 8)).toFixed(3)})` : M.calm;
      ctx.fillStyle = color;
      ctx.beginPath();
      const a = 9 * dpr;
      ctx.moveTo(x + Math.cos(ang) * a, y + Math.sin(ang) * a);
      ctx.lineTo(x + Math.cos(ang + 2.5) * a, y + Math.sin(ang + 2.5) * a);
      ctx.lineTo(x + Math.cos(ang - 2.5) * a, y + Math.sin(ang - 2.5) * a);
      ctx.closePath();
      ctx.fill();
      const meters = Math.round((Math.hypot(f.innerGate.x - player.x, f.innerGate.y - player.y) / 16) * M.metersPerTile);
      const pts = f.points.map((p) => p.name).join('–');
      const state = f.capture
        ? ` · капт ${f.points[f.capture.point]?.name ?? ''} ${f.capture.rebelKills}:${f.capture.cpKills}`
        : f.owner === 'rebels' ? ' · прорван' : f.held > 0 ? ` · ${f.points[0].name} у повстанцев` : fight ? ' · бой' : '';
      const label = `${pts} ${f.name.replace('Пограничный ', '')} · ${meters} м${state}`;
      const w = ctx.measureText(label).width;
      // Подпись — внутрь экрана от стрелки.
      const tx = Math.max(6 * dpr + w / 2, Math.min(v.width - 6 * dpr - w / 2, x - Math.cos(ang) * (w / 2 + 16 * dpr)));
      const ty = Math.max(10 * dpr, Math.min(v.height - 10 * dpr, y - Math.sin(ang) * 16 * dpr));
      ctx.textAlign = 'center';
      ctx.lineWidth = 3 * dpr;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.strokeText(label, tx, ty);
      ctx.fillText(label, tx, ty);
    }
    ctx.textBaseline = 'alphabetic';
  }

  /** Полоска прогресса действия над игроком (люк, саботаж, ремонт). */
  drawProgress(ctx: CanvasRenderingContext2D, v: View, p: Character, t: number | null): void {
    if (t === null) return;
    const s = v.scale;
    const x = (p.x - v.left) * s;
    const y = (p.y - v.top) * s - (p.radius + 8) * s;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x - 15 * s, y - 2 * s, 30 * s, 4 * s);
    ctx.fillStyle = RENDER.effects.progress;
    ctx.fillRect(x - 14 * s, y - 1 * s, 28 * s * Math.max(0, Math.min(1, t)), 2 * s);
  }

  /** Красный код — пульсирующая кромка; ранен — красная виньетка. */
  drawAlert(ctx: CanvasRenderingContext2D, v: View, code: 'green' | 'yellow' | 'red', now: number, player: Character): void {
    const hurt = player.alive ? 1 - player.health / player.maxHealth : 1;
    const red = code === 'red';
    // Жёлтый код — едва заметная янтарная кромка.
    if (code === 'yellow') {
      const g = ctx.createRadialGradient(v.width / 2, v.height / 2, Math.min(v.width, v.height) * 0.4, v.width / 2, v.height / 2, Math.hypot(v.width, v.height) / 2);
      g.addColorStop(0, 'rgba(230,170,30,0)');
      g.addColorStop(1, `rgba(230,170,30,${(0.1 + 0.04 * Math.sin(now * 3)).toFixed(3)})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, v.width, v.height);
    }
    const pulse = red ? 0.12 + 0.1 * Math.sin(now * 4) : 0;
    const a = Math.max(pulse, hurt > 0.5 ? (hurt - 0.5) * 0.9 : 0);
    if (a <= 0.01) return;
    const g = ctx.createRadialGradient(v.width / 2, v.height / 2, Math.min(v.width, v.height) * 0.3, v.width / 2, v.height / 2, Math.hypot(v.width, v.height) / 2);
    g.addColorStop(0, 'rgba(200,20,20,0)');
    g.addColorStop(1, `rgba(200,20,20,${a.toFixed(3)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, v.width, v.height);
  }
}
