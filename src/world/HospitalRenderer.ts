/** Описание системы — docs/hospital.md. */
import type { View } from '../core/Camera';
import type { GameMap, Poi } from './GameMap';
import type { HospitalSystem } from '../systems/Hospital';
import { HOSPITAL_LOOK as L } from '../config/hospital';

/** Мебель больницы по тайлам (px мира) — собирается раз на карту. */
interface Furniture {
  map: GameMap;
  cabinets: { x: number; y: number }[];
  tables: { x: number; y: number }[];
  counter: { x: number; y: number }[];
}

/**
 * Городская больница на экране (только отрисовка, до персонажей): койки с рамой, простынёй, подушкой у изголовья и
 * одеялом (больной рисуется лёжа поверх — EntityRenderer, sleepAt), носилки в приёмном покое, шкафы с аптечками и
 * красным крестом, стол ординаторской, стойка регистратуры, знак с крестом у входа, надписи помещений. Без
 * save/restore.
 */
export class HospitalRenderer {
  private f: Furniture | null = null;
  private font = '';
  private fontScale = -1;

  private furniture(map: GameMap): Furniture {
    if (this.f?.map === map) return this.f;
    const ts = map.tileSize;
    const c = (t: Poi['type']) => map.poisOf(t).map((p) => ({ x: p.x * ts, y: p.y * ts }));
    this.f = { map, cabinets: c('hospital_cabinet'), tables: c('hospital_table'), counter: c('hospital_counter') };
    return this.f;
  }

  drawGround(ctx: CanvasRenderingContext2D, v: View, H: HospitalSystem | undefined, map: GameMap): void {
    const r = H?.rect;
    if (!H?.present || !r) return;
    const s = v.scale;
    if ((r.x + r.w - v.left) * s < 0 || (r.y + r.h - v.top) * s < 0 || (r.x - v.left) * s > v.width || (r.y - v.top) * s > v.height) return;
    const ts = map.tileSize;
    const F = this.furniture(map);
    const X = (x: number) => (x - v.left) * s;
    const Y = (y: number) => (y - v.top) * s;
    const t = ts * s;
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1, s);
    ctx.strokeStyle = L.outline;

    // ——— Койки: рама, простыня, подушка у изголовья, одеяло ———
    H.beds.forEach((b, i) => {
      const box = b.box;
      if (!box) return;
      const x = X(box.x - box.w / 2);
      const y = Y(box.y - box.h / 2);
      const w = box.w * s;
      const h = box.h * s;
      ctx.fillStyle = L.frame;
      ctx.fillRect(x + 1.5 * s, y + 1.5 * s, w - 3 * s, h - 3 * s);
      ctx.strokeRect(x + 1.5 * s, y + 1.5 * s, w - 3 * s, h - 3 * s);
      ctx.fillStyle = L.sheet;
      ctx.fillRect(x + 3 * s, y + 3 * s, w - 6 * s, h - 6 * s);
      // Изголовье — дальняя от места больного сторона.
      const dx = Math.sign(b.spot.x - box.x);
      const dy = Math.sign(b.spot.y - box.y);
      const vertical = Math.abs(dy) >= Math.abs(dx);
      ctx.fillStyle = L.pillow;
      if (vertical) {
        const py = dy > 0 ? y + 3.5 * s : y + h - 3.5 * s - 6 * s;
        ctx.fillRect(x + 4 * s, py, w - 8 * s, 6 * s);
        ctx.strokeRect(x + 4 * s, py, w - 8 * s, 6 * s);
        ctx.fillStyle = L.blankets[i % L.blankets.length];
        const by = dy > 0 ? y + h * 0.45 : y + 3 * s;
        ctx.fillRect(x + 3 * s, by, w - 6 * s, h * 0.55 - 3 * s);
      } else {
        const px = dx > 0 ? x + 3.5 * s : x + w - 3.5 * s - 6 * s;
        ctx.fillRect(px, y + 4 * s, 6 * s, h - 8 * s);
        ctx.strokeRect(px, y + 4 * s, 6 * s, h - 8 * s);
        ctx.fillStyle = L.blankets[i % L.blankets.length];
        const bx = dx > 0 ? x + w * 0.45 : x + 3 * s;
        ctx.fillRect(bx, y + 3 * s, w * 0.55 - 3 * s, h - 6 * s);
      }
    });

    // ——— Носилки в приёмном покое ———
    for (const b of H.stretchers) {
      const x = X(b.spot.x) - t * 0.45;
      const y = Y(b.spot.y) - t * 0.75;
      ctx.fillStyle = L.stretcher;
      ctx.fillRect(x, y, t * 0.9, t * 1.5);
      ctx.strokeRect(x, y, t * 0.9, t * 1.5);
      ctx.fillStyle = L.sheet;
      ctx.fillRect(x + 2 * s, y + 2 * s, t * 0.9 - 4 * s, 5 * s);
    }

    // ——— Шкафы с аптечками: белые, красный крест ———
    for (const p of F.cabinets) {
      const x = X(p.x);
      const y = Y(p.y);
      ctx.fillStyle = L.cabinetEdge;
      ctx.fillRect(x + 1 * s, y + 1 * s, t - 2 * s, t - 2 * s);
      ctx.fillStyle = L.cabinet;
      ctx.fillRect(x + 2 * s, y + 2 * s, t - 4 * s, t - 4 * s);
      ctx.fillStyle = L.cross;
      ctx.fillRect(x + t / 2 - 1.2 * s, y + t / 2 - 4 * s, 2.4 * s, 8 * s);
      ctx.fillRect(x + t / 2 - 4 * s, y + t / 2 - 1.2 * s, 8 * s, 2.4 * s);
    }

    // ——— Стол ординаторской и стойка регистратуры ———
    for (const p of F.tables) {
      ctx.fillStyle = L.table;
      ctx.fillRect(X(p.x) + 1 * s, Y(p.y) + 2 * s, t - 2 * s, t - 4 * s);
      ctx.strokeRect(X(p.x) + 1 * s, Y(p.y) + 2 * s, t - 2 * s, t - 4 * s);
    }
    for (const p of F.counter) {
      ctx.fillStyle = L.counter;
      ctx.fillRect(X(p.x), Y(p.y) + 2 * s, t, t - 4 * s);
      ctx.fillStyle = L.counterTop;
      ctx.fillRect(X(p.x), Y(p.y) + 2 * s, t, 4 * s);
    }

    // ——— Знак у входа: белый круг с красным крестом; надписи помещений ———
    const door = H.door;
    if (door) {
      const R = L.sign.r * s;
      const cx = X(door.x);
      const cy = Y(door.y);
      ctx.fillStyle = L.sign.ring;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = L.cross;
      ctx.fillRect(cx - R * 0.18, cy - R * 0.62, R * 0.36, R * 1.24);
      ctx.fillRect(cx - R * 0.62, cy - R * 0.18, R * 1.24, R * 0.36);
    }
    if (s >= 1.2) {
      if (this.fontScale !== s) {
        this.fontScale = s;
        this.font = L.font.replace(/(\d+)px/, (_, n) => `${Math.round(Number(n) * s)}px`);
      }
      ctx.font = this.font;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = L.text;
      for (const a of H.areas) {
        const label = a.kind === 'ward' ? L.labels.ward : a.kind === 'hub' ? L.labels.hub : a.kind === 'reception' ? L.labels.reception : '';
        if (label) ctx.fillText(label, X(a.x + a.w / 2), Y(a.y + a.h / 2) - 4 * s);
      }
    }
  }
}
