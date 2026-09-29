import type { Character } from '../entities/Character';
import type { CombatSystem } from '../systems/CombatSystem';
import { GRENADE_KINDS } from '../systems/CombatSystem';
import { WEAPONS, ITEMS, type WeaponId, type GrenadeId } from '../config/items';
import { HUD } from '../config/hud';
import { drawGunIcon, drawIcon } from './icons';

/** Вариант в секторе: ствол, граната или «убрать оружие» (null). */
type Choice = { kind: 'weapon'; id: WeaponId } | { kind: 'grenade'; id: GrenadeId } | { kind: 'holster' };

/**
 * Колесо оружия (B1, как в GTA V): зажать Q — открыто (мир замедлен — Game), мышь от центра экрана
 * выбирает сектор, колесо мыши листает стволы в секторе, отпустить Q — взять. Секторы — классы
 * оружия (HUD.wheel.sectors), гранаты — свой сектор (выбирает гранату для T).
 */
export class WeaponWheel {
  open = false;
  /** Выбранный сектор (-1 — мышь в центре, ничего). */
  sel = -1;
  /** Какой вариант листан в каждом секторе. */
  private readonly pick: number[] = HUD.wheel.sectors.map(() => 0);
  private options: Choice[][] = [];

  /** Открыть: собрать, что есть у игрока; сектор — с тем, что в руках. */
  show(p: Character, combat: CombatSystem): void {
    this.open = true;
    this.options = this.collect(p, combat);
    this.sel = -1;
    this.options.forEach((opts, i) => {
      const k = opts.findIndex((o) => o.kind === 'weapon' && o.id === p.weapon);
      if (k >= 0) {
        this.pick[i] = k;
        this.sel = i;
      } else if (opts.some((o) => o.kind === 'grenade')) {
        const g = opts.findIndex((o) => o.kind === 'grenade' && o.id === p.grenadeKind);
        this.pick[i] = Math.max(0, g);
      } else this.pick[i] = Math.min(this.pick[i], Math.max(0, opts.length - 1));
    });
  }

  private collect(p: Character, combat: CombatSystem): Choice[][] {
    const have = combat.weaponsOf(p);
    return HUD.wheel.sectors.map((s) => {
      if (!s.classes) return GRENADE_KINDS.filter((g) => p.inventory.has(g)).map((id) => ({ kind: 'grenade' as const, id }));
      const list: Choice[] = have.filter((w) => s.classes!.includes(WEAPONS[w].class)).map((id) => ({ kind: 'weapon' as const, id }));
      // Ближний бой: последний вариант — убрать оружие (руки свободны).
      if (s.classes.includes('melee')) list.push({ kind: 'holster' });
      return list;
    });
  }

  /** Мышь (px экрана, CSS) относительно центра экрана → сектор. */
  aim(dx: number, dy: number): void {
    if (Math.hypot(dx, dy) < HUD.wheel.dead) return;
    const n = HUD.wheel.sectors.length;
    const seg = (Math.PI * 2) / n;
    // Сектор 0 — сверху, по часовой.
    const a = Math.atan2(dy, dx) + Math.PI / 2 + seg / 2;
    this.sel = ((Math.floor(a / seg) % n) + n) % n;
  }

  /** Колесо мыши: следующий/предыдущий вариант в выбранном секторе. */
  scroll(dir: number): void {
    if (this.sel < 0) return;
    const n = this.options[this.sel]?.length ?? 0;
    if (n > 1) this.pick[this.sel] = (this.pick[this.sel] + (dir > 0 ? 1 : n - 1)) % n;
  }

  /** Закрыть; вернуть выбранное (null — ничего не выбрано или сектор пуст). */
  close(): Choice | null {
    this.open = false;
    if (this.sel < 0) return null;
    return this.options[this.sel]?.[this.pick[this.sel]] ?? null;
  }

  /** Отрисовка поверх всего (экранные px; dpr — плотность). */
  draw(ctx: CanvasRenderingContext2D, width: number, height: number, dpr: number, p: Character, combat: CombatSystem): void {
    if (!this.open) return;
    const W = HUD.wheel;
    const C = W.colors;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = width / dpr;
    const h = height / dpr;
    ctx.fillStyle = C.dim;
    ctx.fillRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;
    const R2 = Math.min(W.outer, Math.min(w, h) / 2 - 12);
    const R1 = Math.min(W.inner, R2 * 0.42);
    const n = W.sectors.length;
    const seg = (Math.PI * 2) / n;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const a0 = -Math.PI / 2 - seg / 2 + i * seg + W.gap;
      const a1 = a0 + seg - W.gap * 2;
      const am = (a0 + a1) / 2;
      const opts = this.options[i] ?? [];
      const sel = i === this.sel;
      ctx.beginPath();
      ctx.arc(cx, cy, R2, a0, a1);
      ctx.arc(cx, cy, R1, a1, a0, true);
      ctx.closePath();
      ctx.fillStyle = sel ? C.selected : C.sector;
      ctx.fill();
      if (sel) {
        ctx.beginPath();
        ctx.arc(cx, cy, R2 + 1, a0, a1);
        ctx.lineWidth = 5;
        ctx.strokeStyle = C.edge;
        ctx.stroke();
      }
      const rm = (R1 + R2) / 2;
      const x = cx + Math.cos(am) * rm;
      const y = cy + Math.sin(am) * rm;
      const len = Math.min(W.gunLen, (R2 - R1) * 0.8);
      const choice = opts[this.pick[i]] ?? null;
      const ghost = W.ghost[i];
      if (choice?.kind === 'weapon') drawGunIcon(ctx, choice.id, x, y, len, { silhouette: C.gun, outline: C.gunOutline, outlineWidth: 1, maxH: W.gunMax });
      else if (choice?.kind === 'grenade') this.grenade(ctx, choice.id, x, y, 1);
      else if (choice?.kind === 'holster') this.label(ctx, 'УБРАТЬ', x, y, 12, C.text);
      else if (ghost) drawGunIcon(ctx, ghost, x, y, len, { silhouette: C.gun, outline: null, maxH: W.gunMax, alpha: C.empty });
      else this.grenade(ctx, 'grenade', x, y, C.empty);
      // Несколько вариантов — точки-счётчик у внутреннего края и стрелки у выбранного.
      if (opts.length > 1) {
        const px = cx + Math.cos(am) * (R1 + 12);
        const py = cy + Math.sin(am) * (R1 + 12);
        for (let k = 0; k < opts.length; k++) {
          ctx.beginPath();
          ctx.arc(px + (k - (opts.length - 1) / 2) * 8, py, 2.6, 0, Math.PI * 2);
          ctx.fillStyle = k === this.pick[i] ? C.text : C.sub;
          ctx.fill();
        }
        if (sel) {
          for (const sg of [-1, 1]) {
            const aa = am + sg * (seg / 2 - 0.13);
            this.label(ctx, sg < 0 ? '‹' : '›', cx + Math.cos(aa) * rm, cy + Math.sin(aa) * rm, 22, C.text);
          }
        }
      }
      // Патроны в магазине — у внешнего края (кроме выбранного: он в центре).
      if (!sel && choice?.kind === 'weapon' && WEAPONS[choice.id].ammo) {
        this.label(ctx, String(this.magOf(p, choice.id)), cx + Math.cos(am) * (R2 - 13), cy + Math.sin(am) * (R2 - 13), 10, C.sub);
      } else if (!sel && choice?.kind === 'grenade') {
        this.label(ctx, `×${p.inventory.count(choice.id)}`, cx + Math.cos(am) * (R2 - 13), cy + Math.sin(am) * (R2 - 13), 10, C.sub);
      }
    }
    // Центр: что выбрано, патроны, сектор.
    ctx.beginPath();
    ctx.arc(cx, cy, R1 - 6, 0, Math.PI * 2);
    ctx.fillStyle = C.center;
    ctx.fill();
    const s = this.sel >= 0 ? W.sectors[this.sel] : null;
    const choice = this.sel >= 0 ? this.options[this.sel]?.[this.pick[this.sel]] ?? null : null;
    let title = 'Q — отпустить';
    let sub = '';
    if (choice?.kind === 'weapon') {
      const wd = WEAPONS[choice.id];
      title = wd.name.length > 16 ? wd.name.split(' ').pop()! : wd.name;
      sub = wd.ammo ? `${this.magOf(p, choice.id)} | ${combat.reserveOf(p, choice.id)}` : wd.class === 'blade' ? 'нож' : 'удар';
    } else if (choice?.kind === 'grenade') {
      title = ITEMS[choice.id].name.split(' ')[0];
      sub = `×${p.inventory.count(choice.id)} · T`;
    } else if (choice?.kind === 'holster') title = 'Убрать оружие';
    else if (s) title = 'Пусто';
    this.label(ctx, title, cx, cy - 15, 14, C.text, 800);
    if (sub) this.label(ctx, sub, cx, cy + 6, 13, C.text, 600);
    if (s) this.label(ctx, s.name.toUpperCase(), cx, cy + 25, 9, C.sub, 700);
    ctx.restore();
  }

  private magOf(p: Character, id: WeaponId): number {
    return p.weapon === id ? p.mag : p.mags[id] ?? 0;
  }

  private grenade(ctx: CanvasRenderingContext2D, id: GrenadeId, x: number, y: number, alpha: number): void {
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.filter = 'grayscale(1) brightness(2.2)';
    drawIcon(ctx, id, x, y, 0.8);
    ctx.restore();
  }

  private label(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, col: string, weight = 700): void {
    ctx.font = `${weight} ${size}px "Segoe UI", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = col;
    ctx.fillText(s, x, y);
  }
}
