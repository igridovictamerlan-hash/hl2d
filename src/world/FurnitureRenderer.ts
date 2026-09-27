import type { View } from '../core/Camera';
import type { Furniture, FurnitureKind } from './furnish';
import { FURNITURE } from '../config/furniture';

type Ctx = CanvasRenderingContext2D;
const P = FURNITURE.palette;

/**
 * Мебель в духе RimWorld: каждый предмет — спрайт (рисуется один раз на вид, размер, поворот,
 * вариант и квантованный масштаб, дальше drawImage). В локальной системе предмет «прислонён» к
 * стене сверху: ширина a — вдоль стены, глубина b — от стены; поворот rot разворачивает его к своей
 * стене.
 */
const cache = new Map<string, HTMLCanvasElement>();

const pick = <T>(arr: readonly T[], v: number, salt = 0): T => arr[((v >>> salt) & 0xffff) % arr.length];

function box(g: Ctx, x: number, y: number, w: number, h: number, fill: string, r = 0): void {
  g.beginPath();
  if (r > 0 && g.roundRect) g.roundRect(x, y, w, h, r);
  else g.rect(x, y, w, h);
  g.fillStyle = fill;
  g.fill();
  g.lineWidth = P.line;
  g.strokeStyle = P.outline;
  g.stroke();
}

function grain(g: Ctx, x: number, y: number, w: number, h: number, horizontal: boolean, v: number): void {
  g.fillStyle = P.woodGrain;
  if (horizontal) for (let yy = y + 3; yy < y + h - 1; yy += 4) g.fillRect(x + 1 + ((v >> yy) & 3), yy, w - 3, 0.6);
  else for (let xx = x + 3; xx < x + w - 1; xx += 4) g.fillRect(xx, y + 1 + ((v >> xx) & 3), 0.6, h - 3);
}

/** Предмет в локальной системе: a × b, стена сверху (y = 0). */
function drawLocal(g: Ctx, kind: FurnitureKind, a: number, b: number, v: number): void {
  const wood = pick(P.wood, v);
  switch (kind) {
    case 'bed':
    case 'bed_double':
    case 'cot': {
      const cot = kind === 'cot';
      box(g, 0, 0, a, b, cot ? P.metalDark : P.woodDark, 1.5);
      // Изголовье.
      box(g, 0, 0, a, 4, cot ? P.metal : wood, 1);
      g.fillStyle = cot ? '#8a9078' : P.sheet;
      g.fillRect(1.5, 4, a - 3, b - 6);
      // Подушки.
      const pillows = kind === 'bed_double' ? 2 : 1;
      const pw = (a - 4 - (pillows - 1) * 2) / pillows;
      for (let k = 0; k < pillows; k++) box(g, 2 + k * (pw + 2), 5.5, pw, 6, cot ? '#c9ccbf' : P.pillow, 2);
      // Одеяло с отогнутым краем.
      const top = cot ? 13 : 14;
      box(g, 1.5, top, a - 3, b - top - 2, cot ? P.cot : pick(P.blanket, v, 3), 1);
      g.fillStyle = 'rgba(255,255,255,0.28)';
      g.fillRect(2, top + 0.8, a - 4, 1.8);
      g.fillStyle = 'rgba(0,0,0,0.18)';
      g.fillRect(a / 2 - 0.3, top + 3, 0.6, b - top - 6);
      if (!cot) box(g, 0, b - 2.5, a, 2.5, wood);
      break;
    }
    case 'nightstand': {
      box(g, 0, 0, a, b, wood, 1);
      g.fillStyle = P.woodDark;
      g.fillRect(1.5, b / 2, a - 3, 0.8);
      g.fillStyle = '#d9c38a';
      g.fillRect(a / 2 - 1, b / 2 + 2, 2, 1.2);
      if (v & 1) {
        g.beginPath();
        g.arc(a / 2, b / 2 - 2, 2.2, 0, Math.PI * 2);
        g.fillStyle = P.lampShade;
        g.fill();
        g.stroke();
      }
      break;
    }
    case 'bookshelf': {
      box(g, 0, 0, a, b, P.woodDark, 1);
      g.fillStyle = P.shelfBack;
      g.fillRect(1.5, 1.5, a - 3, b - 3);
      // Два ряда корешков разной ширины и высоты.
      const rows = 2;
      const rh = (b - 3) / rows;
      let seed = v | 1;
      for (let r = 0; r < rows; r++) {
        let x = 2;
        while (x < a - 2.5) {
          seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
          const w = 1.6 + ((seed >>> 8) % 3) * 0.6;
          if (x + w > a - 2) break;
          const h = rh - 0.8 - ((seed >>> 12) % 3) * 0.5;
          g.fillStyle = pick(P.books, seed, 16);
          g.fillRect(x, 1.5 + r * rh + (rh - h), w, h);
          x += w + ((seed >>> 20) % 5 === 0 ? 1.2 : 0.3);
        }
        g.fillStyle = P.woodDark;
        g.fillRect(1.5, 1.5 + (r + 1) * rh - 0.4, a - 3, 0.8);
      }
      break;
    }
    case 'dresser':
    case 'wardrobe': {
      box(g, 0, 0, a, b, wood, 1);
      grain(g, 0, 0, a, b, true, v);
      g.fillStyle = P.woodDark;
      const n = kind === 'wardrobe' ? 2 : 3;
      for (let k = 1; k < n; k++) g.fillRect(k * (a / n) - 0.4, 1.5, 0.8, b - 3);
      g.fillStyle = '#d9c38a';
      for (let k = 0; k < n; k++) g.fillRect((k + 0.5) * (a / n) - 1, b - 4, 2, 1.2);
      break;
    }
    case 'stove': {
      box(g, 0, 0, a, b, P.metal, 1);
      g.fillStyle = P.metalDark;
      g.fillRect(1.5, 1.5, a - 3, 3);
      for (const cx of [a * 0.3, a * 0.7]) {
        g.beginPath();
        g.arc(cx, b * 0.62, 2.8, 0, Math.PI * 2);
        g.fillStyle = P.burner;
        g.fill();
        g.stroke();
      }
      break;
    }
    case 'crate': {
      box(g, 0, 0, a, b, wood, 0.5);
      g.fillStyle = P.woodDark;
      for (let k = 1; k < 3; k++) g.fillRect(1, (k * b) / 3 - 0.4, a - 2, 0.8);
      g.lineWidth = 0.8;
      g.strokeStyle = P.woodDark;
      g.beginPath();
      g.moveTo(1.5, 1.5);
      g.lineTo(a - 1.5, b - 1.5);
      g.stroke();
      break;
    }
    case 'plant': {
      g.beginPath();
      g.arc(a / 2, b / 2 + 1, a * 0.3, 0, Math.PI * 2);
      g.fillStyle = P.potTerra;
      g.fill();
      g.lineWidth = P.line;
      g.strokeStyle = P.outline;
      g.stroke();
      for (let k = 0; k < 5; k++) {
        const ang = (k / 5) * Math.PI * 2 + (v & 7);
        g.beginPath();
        g.ellipse(a / 2 + Math.cos(ang) * 2.6, b / 2 + Math.sin(ang) * 2.6, 3, 1.8, ang, 0, Math.PI * 2);
        g.fillStyle = pick(P.leaf, v + k);
        g.fill();
        g.lineWidth = 0.6;
        g.stroke();
      }
      break;
    }
    case 'sofa':
    case 'armchair': {
      const c = pick(P.sofa, v);
      box(g, 0, 0, a, b, c, 2);
      box(g, 0, 0, a, 5, c, 2);
      box(g, 0, 0, 3.5, b, c, 1.5);
      box(g, a - 3.5, 0, 3.5, b, c, 1.5);
      g.fillStyle = 'rgba(255,255,255,0.15)';
      if (kind === 'sofa') g.fillRect(a / 2 - 0.3, 6, 0.6, b - 7);
      break;
    }
    case 'desk': {
      box(g, 0, 0, a, b, wood, 1);
      grain(g, 0, 0, a, b, true, v);
      // Бумаги, папка и лампа.
      g.fillStyle = P.paper;
      g.fillRect(3, 3, 6, 7);
      g.fillRect(10.5, 4, 5, 6.5);
      g.fillStyle = P.ink;
      for (let k = 0; k < 3; k++) g.fillRect(4, 4.5 + k * 1.8, 4, 0.5);
      g.fillStyle = '#8a3a2a';
      g.fillRect(17, 3.5, 5, 7);
      g.beginPath();
      g.arc(a - 4, 4.5, 2, 0, Math.PI * 2);
      g.fillStyle = '#ffd36b';
      g.fill();
      g.lineWidth = 0.7;
      g.stroke();
      break;
    }
    case 'locker': {
      box(g, 0, 0, a, b, P.metal, 0.5);
      g.fillStyle = P.metalDark;
      g.fillRect(a / 2 - 0.4, 1, 0.8, b - 2);
      for (let k = 0; k < 3; k++) {
        g.fillRect(2, 2.5 + k * 1.6, a / 2 - 3.5, 0.6);
        g.fillRect(a / 2 + 1.5, 2.5 + k * 1.6, a / 2 - 3.5, 0.6);
      }
      g.fillStyle = P.metalLight;
      g.fillRect(a / 2 - 2, b - 4, 1, 2);
      g.fillRect(a / 2 + 1, b - 4, 1, 2);
      break;
    }
    case 'lamp': {
      g.beginPath();
      g.arc(a / 2, b / 2, a / 2 - 0.5, 0, Math.PI * 2);
      g.fillStyle = P.lampShade;
      g.fill();
      g.lineWidth = P.line;
      g.strokeStyle = P.outline;
      g.stroke();
      g.beginPath();
      g.arc(a / 2, b / 2, 1.2, 0, Math.PI * 2);
      g.fillStyle = P.woodDark;
      g.fill();
      break;
    }
    case 'chair': {
      // Сиденье и спинка (у стены / от стола).
      box(g, 1, 2.5, a - 2, b - 3, wood, 1);
      box(g, 0.5, 0.2, a - 1, 3, P.woodDark, 1);
      break;
    }
    case 'table': {
      box(g, 0, 0, a, b, wood, 1);
      grain(g, 0, 0, a, b, true, v);
      if (v & 2) {
        g.fillStyle = P.paper;
        g.fillRect(a * 0.2, b * 0.25, 6, 5);
      }
      if (v & 4) {
        g.beginPath();
        g.arc(a * 0.7, b * 0.5, 2.2, 0, Math.PI * 2);
        g.fillStyle = '#d8d2c4';
        g.fill();
        g.lineWidth = 0.7;
        g.stroke();
      }
      break;
    }
    case 'card_table': {
      box(g, 0, 0, a, b, P.woodDark, 2);
      g.fillStyle = P.felt;
      g.fillRect(2, 2, a - 4, b - 4);
      // Карты веером и колода.
      for (let k = 0; k < 4; k++) {
        const x = 5 + k * 3.2;
        const y = 6 + (k & 1) * 1.5;
        g.fillStyle = P.card;
        g.fillRect(x, y, 3, 4.2);
        g.fillStyle = k & 1 ? P.cardRed : P.outline;
        g.fillRect(x + 1, y + 1.2, 1, 1);
      }
      g.fillStyle = P.card;
      g.fillRect(a - 9, b - 9, 4, 5);
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.fillRect(a - 9, b - 4.4, 4, 0.6);
      break;
    }
    case 'rug': {
      g.fillStyle = pick(P.rug, v);
      g.fillRect(0, 0, a, b);
      g.strokeStyle = P.rugBorder;
      g.lineWidth = 1;
      g.strokeRect(2.5, 2.5, a - 5, b - 5);
      g.strokeRect(5, 5, a - 10, b - 10);
      break;
    }
  }
}

/** Спрайт предмета (с поворотом) при масштабе q. */
function sprite(f: Furniture, q: number): HTMLCanvasElement {
  const key = `${f.kind}|${f.w}|${f.h}|${f.rot}|${f.variant & 0xffff}|${q}`;
  let c = cache.get(key);
  if (c) return c;
  if (cache.size >= FURNITURE.cache.max) cache.clear();
  c = document.createElement('canvas');
  const pad = 2;
  c.width = Math.ceil((f.w + pad * 2) * q);
  c.height = Math.ceil((f.h + pad * 2) * q);
  const g = c.getContext('2d')!;
  g.scale(q, q);
  g.translate(pad + f.w / 2, pad + f.h / 2);
  g.rotate((f.rot * Math.PI) / 2);
  // Локальные размеры: при повороте на 90° ширина и глубина меняются местами.
  const side = f.rot === 1 || f.rot === 3;
  const a = side ? f.h : f.w;
  const b = side ? f.w : f.h;
  g.translate(-a / 2, -b / 2);
  drawLocal(g, f.kind, a, b, f.variant);
  cache.set(key, c);
  return c;
}

export function drawFurnitureList(ctx: Ctx, v: View, list: readonly Furniture[]): void {
  const s = v.scale;
  const q = Math.max(FURNITURE.cache.step, Math.round(s / FURNITURE.cache.step) * FURNITURE.cache.step);
  const k = s / q;
  const pad = 2;
  // Ковры — первыми (под мебелью).
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      if ((f.kind === 'rug') !== (pass === 0)) continue;
      const x = (f.x - pad - v.left) * s;
      const y = (f.y - pad - v.top) * s;
      if (x > v.width || y > v.height || x + (f.w + pad * 2) * s < 0 || y + (f.h + pad * 2) * s < 0) continue;
      const img = sprite(f, q);
      ctx.drawImage(img, x, y, img.width * k, img.height * k);
    }
  }
}
