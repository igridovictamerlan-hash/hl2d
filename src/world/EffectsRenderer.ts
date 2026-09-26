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
import { drawPawn, lookSeed } from '../entities/PawnRenderer';
import { PAWN } from '../config/pawns';
import { RENDER } from '../config/render';
import { COMBAT, GRENADE } from '../config/combat';
import { FACTIONS } from '../config/factions';

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
    // Следы: копоть, кровь, выбоины, гильзы (исчезают к концу жизни).
    for (const d of combat.decals) {
      const x = (d.x - v.left) * s;
      const y = (d.y - v.top) * s;
      if (!onScreen(x, y, 40)) continue;
      const left = d.until - now;
      const a = Math.min(1, left / 8);
      if (d.kind === 'casing') {
        ctx.globalAlpha = a;
        ctx.fillStyle = E.casing;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(d.ang);
        ctx.fillRect(-1.5 * s, -0.7 * s, 3 * s, 1.4 * s);
        ctx.restore();
      } else if (d.kind === 'blood') {
        ctx.fillStyle = `rgba(${E.bloodDecal},${0.55 * a})`;
        ctx.beginPath();
        ctx.ellipse(x, y, 5 * d.size * s, 3 * d.size * s, d.ang, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
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
      ctx.globalAlpha = 1;
    }
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
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(seed % 2 ? Math.PI / 2 : -Math.PI / 2);
      ctx.globalAlpha = PAWN.corpseAlpha;
      drawPawn(ctx, { faction: c.faction, rank: c.rank, color: col.color, seed, profession: c.profession }, 0, -2 * s, s * PAWN.scale, 'S');
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
    // Конвейер завода и коробки на складе.
    const f = labor.factory;
    if (f) {
      const x = (f.x - v.left) * s;
      const y = (f.y - 22 - v.top) * s;
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
        box(x + (((now * 12) % 40) - 20) * s, y);
      }
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

  drawShots(ctx: CanvasRenderingContext2D, v: View, combat: CombatSystem): void {
    const s = v.scale;
    const E = RENDER.effects;
    ctx.lineCap = 'round';
    const TR = RENDER.tracers;
    for (const t of combat.tracers) {
      ctx.globalAlpha = Math.min(1, t.t / COMBAT.tracerTime);
      ctx.strokeStyle = t.kind === 'rifle' ? TR.pulse : t.kind === 'crossbow' ? TR.bolt : t.combine ? E.tracerCombine : E.tracerRebel;
      ctx.lineWidth = Math.max(1, TR.width[t.kind] * s);
      ctx.beginPath();
      ctx.moveTo((t.x0 - v.left) * s, (t.y0 - v.top) * s);
      ctx.lineTo((t.x1 - v.left) * s, (t.y1 - v.top) * s);
      ctx.stroke();
      // Вспышка у ствола.
      ctx.fillStyle = E.flash;
      ctx.beginPath();
      ctx.arc((t.x0 - v.left) * s, (t.y0 - v.top) * s, 3 * s, 0, Math.PI * 2);
      ctx.fill();
    }
    // Гранаты: в полёте — крупнее (дуга) с тенью; на земле мигает огонёк.
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
      ctx.fillStyle = E.grenade;
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
    // Взрывы: огненный шар расширяется и гаснет, по краю — дым.
    for (const b of combat.blasts) {
      const k = 1 - b.t / COMBAT.blastTime;
      const x = (b.x - v.left) * s;
      const y = (b.y - v.top) * s;
      const R = GRENADE.radius * s;
      ctx.fillStyle = `rgba(${E.blastSmoke},${0.45 * (1 - k)})`;
      ctx.beginPath();
      ctx.arc(x, y, R * (0.55 + 0.5 * k), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(${E.blastFire},${0.85 * (1 - k) ** 1.5})`;
      ctx.beginPath();
      ctx.arc(x, y, R * (0.25 + 0.55 * Math.sqrt(k)), 0, Math.PI * 2);
      ctx.fill();
      if (k < 0.35) {
        ctx.fillStyle = `rgba(${E.blastCore},${1 - k / 0.35})`;
        ctx.beginPath();
        ctx.arc(x, y, R * 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    for (const im of combat.impacts) {
      ctx.globalAlpha = Math.min(1, im.t / COMBAT.impactTime);
      ctx.fillStyle = im.blood ? E.bloodHit : E.spark;
      ctx.beginPath();
      ctx.arc((im.x - v.left) * s, (im.y - v.top) * s, (im.blood ? 3 : 2) * s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
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
