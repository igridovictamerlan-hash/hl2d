import type { Character } from '../entities/Character';
import type { PawnDir, PawnLook } from '../entities/PawnRenderer';
import type { CombatSystem } from '../systems/CombatSystem';
import { GRENADE_KINDS } from '../systems/CombatSystem';
import { armorOf, roleArmor } from '../systems/wounds';
import { ITEMS, WEAPONS, type ItemId, type WeaponId, type WeaponDef, type GrenadeId, type GearId, type GearSlot } from '../config/items';
import { REBEL_RANKS } from '../config/factions';
import { HUD } from '../config/hud';
import { drawGunIcon, drawIcon, iconOf } from './icons';
import { drawPawnFigure } from './pawnFigure';
import { MELEE as MELEE_CFG } from '../config/melee';

export interface InventoryHost {
  useItem(id: ItemId): void;
  equipItem(id: WeaponId | null): void;
  chooseGrenade(id: GrenadeId): void;
  wearGear(id: GearId): void;
  takeOffGear(slot: GearSlot): void;
}

/** Область на холсте: что под мышью и что делать по клику. */
interface Hit {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Подсказка: название, описание, действие. */
  title: string;
  desc: string;
  act: string;
  click?: () => void;
}

const DIRS: PawnDir[] = ['E', 'S', 'W', 'N'];
const SIDE_ARMS = new Set(['pistol', 'magnum']);
const MELEE = new Set(['melee', 'blade']);
/** Армия сопротивления (рюкзак, рация). */
const ARMY = new Set<string>(REBEL_RANKS.map((r) => r.profession));

/**
 * Инвентарь (Tab) в духе Innawoods (C1): бумага цвета хаки, толстые рамки. Слева — снаряжение на
 * пешке (по роли: шлем, противогаз, бронежилет, одежда, рюкзак, рация), в центре — своя пешка с оружием
 * в руках, как на карте (‹ › — повернуть), под ней — основной ствол, пистолет, ближний бой и гранаты,
 * справа — рюкзак ячейками (всего ECONOMY.inventorySlots вместе со стволами и гранатами) и подсказка.
 * ЛКМ: еда и лекарства — применить, ствол — в руки (в руках — убрать), граната — выбрать для T.
 */
export class InventoryPanel {
  private readonly el: HTMLElement;
  private readonly cv: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private hits: Hit[] = [];
  private hover: Hit | null = null;
  private mx = -1;
  private my = -1;
  private dir = 0;
  private sig = '';
  private scale = 1;
  isOpen = false;
  /** Размер панели, px CSS (до масштаба под окно). */
  private readonly W = 850;
  private readonly H = 560;

  constructor(parent: HTMLElement, private readonly host: InventoryHost) {
    this.el = document.createElement('div');
    this.el.className = 'inventory';
    this.el.hidden = true;
    this.cv = document.createElement('canvas');
    this.el.appendChild(this.cv);
    // Закрыть — и мышью, и пальцем (на телефоне нет Tab).
    const close = document.createElement('button');
    close.className = 'inv-close';
    close.textContent = '✕';
    close.addEventListener('click', () => this.isOpen && this.toggle());
    this.el.appendChild(close);
    parent.appendChild(this.el);
    this.ctx = this.cv.getContext('2d')!;
    this.cv.addEventListener('mousemove', (e) => {
      const r = this.cv.getBoundingClientRect();
      this.mx = (e.clientX - r.left) / this.scale;
      this.my = (e.clientY - r.top) / this.scale;
      const h = this.hitAt(this.mx, this.my);
      if (h !== this.hover) {
        this.hover = h;
        this.sig = '';
      }
      this.cv.style.cursor = h?.click ? 'pointer' : 'default';
    });
    this.cv.addEventListener('mouseleave', () => {
      this.hover = null;
      this.sig = '';
    });
    // Мышь и палец: координаты — из самого нажатия (у касания не было mousemove до него); подсказка — по
    // тому, чего коснулись.
    this.cv.style.touchAction = 'none';
    this.cv.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const r = this.cv.getBoundingClientRect();
      this.mx = (e.clientX - r.left) / this.scale;
      this.my = (e.clientY - r.top) / this.scale;
      const h = this.hitAt(this.mx, this.my);
      if (e.pointerType !== 'mouse') this.hover = h;
      if (h?.click) h.click();
      this.sig = '';
      e.preventDefault();
    });
    this.cv.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Сенсорный режим (телефон): подсказки — «касание», а не «ЛКМ». */
  private get touch(): boolean {
    return document.body.classList.contains('touch');
  }

  private get press(): string {
    return this.touch ? 'Касание' : 'ЛКМ';
  }

  private hitAt(x: number, y: number): Hit | null {
    for (let k = this.hits.length - 1; k >= 0; k--) {
      const h = this.hits[k];
      if (x >= h.x && y >= h.y && x < h.x + h.w && y < h.y + h.h) return h;
    }
    return null;
  }

  toggle(): void {
    this.isOpen = !this.isOpen;
    this.el.hidden = !this.isOpen;
    this.hover = null;
    this.sig = '';
  }

  update(p: Character, combat: CombatSystem, look: PawnLook): void {
    if (!this.isOpen) return;
    const hoverKey = this.hover ? `${this.hover.x},${this.hover.y}` : '';
    const sig = `${p.inventory.slots.map((s) => `${s.id}:${s.qty}`).join(',')}|${p.weapon}|${p.gear.head}|${p.gear.torso}|${p.gear.back}|${p.mag}|${p.grenadeKind}|${p.money}|${this.dir}|${hoverKey}|${look.seed}|${look.color}|${combat.reloading(p)}|${window.innerWidth}x${window.innerHeight}|${this.touch}`;
    if (sig === this.sig) return;
    this.sig = sig;
    this.draw(p, combat, look);
  }

  private draw(p: Character, combat: CombatSystem, look: PawnLook): void {
    const { W, H } = this;
    const dpr = window.devicePixelRatio || 1;
    this.scale = Math.min(1, (window.innerWidth - 32) / W, (window.innerHeight - 32) / H);
    this.cv.style.width = `${W * this.scale}px`;
    this.cv.style.height = `${H * this.scale}px`;
    const px = Math.round(W * this.scale * dpr);
    if (this.cv.width !== px) {
      this.cv.width = px;
      this.cv.height = Math.round(H * this.scale * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr * this.scale, 0, 0, dpr * this.scale, 0, 0);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const K = HUD.inventory;
    const C = K.colors;
    this.hits = [];
    paper(ctx, 0, 0, W, H, C.bg, 2);
    ctx.lineWidth = 4;
    ctx.strokeStyle = C.line;
    ctx.strokeRect(2, 2, W - 4, H - 4);
    const S = K.cell;
    const G = K.gap;
    const L = 16;
    const T = 40;
    text(ctx, 'ИНВЕНТАРЬ', L, 22, 15, C.text, 'left', 800);
    text(ctx, this.touch ? '' : 'Tab — закрыть', W - 56, 22, 11, C.textDim, 'right', 700);

    // --- снаряжение: надетое (шлем, бронежилет, рюкзак — снимается) и форма роли (не снять) ---
    const role = roleArmor(p);
    const army = p.faction === 'rebel' && !!p.profession && ARMY.has(p.profession);
    const uniformed = p.faction === 'cp' || p.faction === 'ota';
    const worn = {
      head: role.head > 0 ? 'helmet' : p.faction === 'cwu' ? 'cap' : null,
      face: (p.faction === 'cp' && p.division === 'pcu') || p.faction === 'ota' ? 'gasmask' : null,
      torso: role.torso > 0 ? 'vest' : null,
      back: army || p.faction === 'ota' ? 'backpack' : null,
      radio: uniformed || army ? 'radio' : null,
      p1: uniformed || army ? 'flashlight' : null,
    };
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    /** Слот формы роли (лицо, рация, фонарь, одежда): только показывает. */
    const roleSlot = (x: number, y: number, w: number, h: number, label: string, id: string | null, ghost: string, name: string) => {
      this.slot(ctx, x, y, w, h, label, id ? null : ghost);
      if (id) drawIcon(ctx, id, x + w / 2, y + h / 2 + 2, 0.85);
      this.hits.push({ x, y, w, h, title: id ? name : `${label.toLowerCase()}: пусто`, desc: id ? 'Часть формы вашей роли.' : 'Выдаётся по роли.', act: '' });
    };
    /** Рабочий слот: надетое — снять; нет — форма роли или пусто (надеть из рюкзака). */
    const gearSlot = (x: number, y: number, label: string, slot: GearSlot, uniform: string | null, uniformArmor: number, ghost: string) => {
      const on = p.gear[slot];
      const hot = !!on && this.hover?.x === x && this.hover?.y === y;
      this.slot(ctx, x, y, S, S, label, on || uniform ? null : ghost, hot);
      if (on) {
        const g = ITEMS[on].gear!;
        drawIcon(ctx, iconOf(on), x + S / 2, y + S / 2 + 2, 0.85);
        ctx.lineWidth = 3;
        ctx.strokeStyle = C.equipped;
        ctx.strokeRect(x + 4, y + 4, S - 8, S - 8);
        const stat = g.capacity ? `+${g.capacity} ячейки` : `броня ${pct(g.head ?? g.torso ?? 0)}`;
        this.hits.push({ x, y, w: S, h: S, title: `${ITEMS[on].name} (надето)`, desc: `${ITEMS[on].desc} ${stat[0].toUpperCase()}${stat.slice(1)}.`, act: `${this.press} — снять`, click: () => this.host.takeOffGear(slot) });
      } else if (uniform) {
        ctx.globalAlpha = 0.75;
        drawIcon(ctx, uniform, x + S / 2, y + S / 2 + 2, 0.85);
        ctx.globalAlpha = 1;
        text(ctx, 'форма', x + 6, y + S - 10, 9, C.ink, 'left', 800);
        this.hits.push({ x, y, w: S, h: S, title: 'Форма роли', desc: uniformArmor > 0 ? `Броня формы ${pct(uniformArmor)}: не снять. Надетое из рюкзака заменит, если крепче.` : 'Часть формы роли. Можно надеть поверх снаряжение из рюкзака.', act: '' });
      } else {
        this.hits.push({ x, y, w: S, h: S, title: `${label.toLowerCase()}: пусто`, desc: 'Наденьте снаряжение из рюкзака: ЛКМ по предмету. Найти — на телах, купить — у барыги.', act: '' });
      }
    };
    // Верхний ряд: CID и токены; лицо и рация — над правой колонкой.
    const cidId = p.inventory.has('fake_cid') ? 'fake_cid' : 'cid';
    this.slot(ctx, L, T, S, S - 4, 'CID', null);
    drawIcon(ctx, cidId, L + S / 2, T + S / 2, 0.85);
    this.hits.push({ x: L, y: T, w: S, h: S - 4, title: `CID #${p.cid}`, desc: p.law.wanted ? 'В розыске.' : p.law.hasCid ? 'Документы в порядке.' : 'Карты нет.', act: '' });
    this.slot(ctx, L + S + G, T, S, S - 4, 'ТОКЕНЫ', null);
    drawIcon(ctx, 'tokens', L + S + G + S / 2, T + S / 2 - 2, 0.8);
    text(ctx, String(p.money), L + 2 * S + G - 8, T + S - 16, 13, C.ink, 'right', 900);
    this.hits.push({ x: L + S + G, y: T, w: S, h: S - 4, title: `Токены: ${p.money}`, desc: 'Деньги Протектората.', act: '' });
    const dollX = L + S + G;
    const dollW = 2 * S + G + 120;
    const rx = dollX + dollW + G;
    roleSlot(rx - S - G, T, S, S - 4, 'ЛИЦО', worn.face, 'gasmask', 'Противогаз');
    roleSlot(rx, T, S, S - 4, 'РАЦИЯ', worn.radio, 'radio', 'Рация');
    const y0 = T + S + 2;
    gearSlot(L, y0, 'ГОЛОВА', 'head', worn.head, role.head, 'helmet');
    gearSlot(L, y0 + S + 4, 'БРОНЯ', 'torso', worn.torso, role.torso, 'vest');
    roleSlot(L, y0 + 2 * (S + 4), S, S, 'ОДЕЖДА', 'jumpsuit', 'jumpsuit', 'Одежда');
    gearSlot(rx, y0, 'РЮКЗАК', 'back', worn.back, 0, 'backpack');
    roleSlot(rx, y0 + S + 4, S, S, 'КАРМАН', worn.p1, 'flashlight', 'Фонарь');
    roleSlot(rx, y0 + 2 * (S + 4), S, S, 'КАРМАН', null, 'lockpick', '');

    // --- пешка с оружием в руках ---
    const dollH = 3 * S + 8;
    ctx.save();
    ctx.beginPath();
    ctx.rect(dollX, y0, dollW, dollH);
    ctx.clip();
    paper(ctx, dollX, y0, dollW, dollH, C.doll, 13);
    const gx = dollX + dollW / 2;
    const gy = y0 + dollH - 36;
    ctx.fillStyle = C.shadow;
    ctx.beginPath();
    ctx.ellipse(gx, gy + 4, 46, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    drawPawnFigure(ctx, look, p.weapon, gx, gy, K.pawnScale, DIRS[this.dir], combat.reloading(p));
    ctx.restore();
    ctx.lineWidth = 4;
    ctx.strokeStyle = C.line;
    ctx.strokeRect(dollX, y0, dollW, dollH);
    text(ctx, p.name, dollX + 10, y0 + 14, 12, C.text, 'left', 800);
    const ar = armorOf(p);
    text(ctx, `броня: голова ${pct(ar.head)} · корпус ${pct(ar.torso)}`, dollX + 10, y0 + 30, 10, C.textDim, 'left', 700);
    for (const sg of [-1, 1]) {
      const ax = sg < 0 ? dollX + 4 : dollX + dollW - 34;
      const ay = y0 + dollH - 50;
      const hot = this.hover?.x === ax && this.hover?.y === ay;
      text(ctx, sg < 0 ? '‹' : '›', ax + 15, ay + 20, 34, hot ? C.selected : C.ink, 'center', 900);
      this.hits.push({ x: ax, y: ay, w: 30, h: 40, title: 'Повернуть пешку', desc: '', act: '', click: () => (this.dir = (this.dir + (sg > 0 ? 1 : 3)) % 4) });
    }

    // --- стволы: основное, пистолет, ближний бой; гранаты ---
    const guns = combat.weaponsOf(p);
    const pickGun = (f: (w: WeaponDef) => boolean) => (p.weapon && f(WEAPONS[p.weapon]) ? p.weapon : guns.find((g) => f(WEAPONS[g])) ?? null);
    const main = pickGun((w) => !SIDE_ARMS.has(w.class) && !MELEE.has(w.class));
    const side = pickGun((w) => SIDE_ARMS.has(w.class));
    const melee = pickGun((w) => MELEE.has(w.class));
    const shown = new Set<string>([main, side, melee].filter((g): g is WeaponId => !!g));
    const wy = y0 + dollH + 8;
    const ww = rx + S - L;
    const mainW = Math.round(ww * 0.64);
    this.gunSlot(ctx, p, combat, L, wy, mainW, S + 16, 'ОСНОВНОЕ', main, 'ak74', 62);
    this.gunSlot(ctx, p, combat, L + mainW + G, wy, ww - mainW - G, S + 16, 'ПИСТОЛЕТ', side, 'usp', 52);
    const ky = wy + S + 16 + G;
    this.gunSlot(ctx, p, combat, L, ky, S, S - 10, 'БЛИЖНИЙ', melee, 'knife', 34);
    GRENADE_KINDS.forEach((g, i) => {
      const x = L + (S + G) * (i + 1);
      const n = p.inventory.count(g);
      const sel = n > 0 && p.grenadeKind === g;
      this.slot(ctx, x, ky, S, S - 10, i ? '' : 'ГРАНАТЫ', n ? null : g, sel);
      if (n) {
        drawIcon(ctx, g, x + S / 2, ky + (S - 10) / 2 + 2, 0.7);
        badge(ctx, `×${n}`, x + S - 6, ky + S - 16);
      }
      this.hits.push({ x, y: ky, w: S, h: S - 10, title: ITEMS[g].name, desc: ITEMS[g].desc, act: n ? (sel ? 'Выбрана для T' : `${this.press} — выбрать для T`) : 'нет', click: n ? () => this.host.chooseGrenade(g) : undefined });
    });

    // --- рюкзак: остальное (всего ячеек — вместе со стволами и гранатами) ---
    const bag = p.inventory.slots.filter((s) => !shown.has(s.id) && !(GRENADE_KINDS as readonly string[]).includes(s.id));
    const used = p.inventory.slots.length;
    const cap = p.inventory.capacity;
    const cells = Math.max(bag.length, cap - (used - bag.length));
    const bx = rx + S + 22;
    const cols = 4;
    text(ctx, `РЮКЗАК · занято ${used} из ${cap}`, bx, T - 10, 11, C.text, 'left', 800);
    for (let k = 0; k < cells; k++) {
      const x = bx + (k % cols) * (S + 4);
      const y = T + Math.floor(k / cols) * (S - 2);
      const st = bag[k];
      const hot = !!st && this.hover?.x === x && this.hover?.y === y;
      this.slot(ctx, x, y, S, S - 6, '', null, hot, st ? C.slot : C.slotEmpty);
      if (!st) continue;
      const def = ITEMS[st.id];
      if (def.kind === 'weapon') drawGunIcon(ctx, st.id as WeaponId, x + S / 2, y + (S - 6) / 2, S - 16, { maxH: S - 30 });
      else drawIcon(ctx, iconOf(st.id), x + S / 2, y + (S - 6) / 2, 0.78);
      if (st.qty > 1) badge(ctx, String(st.qty), x + S - 6, y + S - 20);
      let act = '';
      let click: (() => void) | undefined;
      if (def.food || def.heal || st.id === 'fake_cid') {
        act = def.food ? `${this.press} — съесть` : `${this.press} — применить`;
        click = () => this.host.useItem(st.id);
      } else if (def.kind === 'weapon') {
        act = `${this.press} — взять в руки`;
        click = () => this.host.equipItem(st.id as WeaponId);
      } else if (def.gear) {
        act = `${this.press} — надеть`;
        click = () => this.host.wearGear(st.id as GearId);
      }
      this.hits.push({ x, y, w: S, h: S - 6, title: `${def.name}${st.qty > 1 ? ` ×${st.qty}` : ''}`, desc: def.kind === 'weapon' ? `${def.desc} ${weaponStats(WEAPONS[st.id as WeaponId])}` : def.desc, act, click });
    }

    // --- подсказка: что под мышью ---
    const rows = Math.ceil(cells / cols);
    const hy = T + rows * (S - 2) + 8;
    const hw = cols * (S + 4) - 4;
    const hh = H - hy - 16;
    this.slot(ctx, bx, hy, hw, hh, '', null, false, C.slotEmpty);
    const h = this.hover;
    if (h) {
      text(ctx, h.title, bx + 12, hy + 22, 14, C.text, 'left', 800);
      const lines = wrap(ctx, h.desc, hw - 24, '600 11px "Segoe UI", Arial, sans-serif');
      lines.slice(0, Math.max(1, Math.floor((hh - 70) / 15))).forEach((l, i) => text(ctx, l, bx + 12, hy + 44 + i * 15, 11, C.text, 'left', 600));
      if (h.act) text(ctx, h.act, bx + 12, hy + hh - 16, 11, C.selected, 'left', 800);
    } else {
      text(ctx, this.touch ? 'Коснитесь предмета' : 'Наведите на предмет', bx + 12, hy + 22, 12, C.textDim, 'left', 700);
      text(ctx, `${this.press} — съесть, применить, взять в руки`, bx + 12, hy + 44, 11, C.textDim, 'left', 600);
      text(ctx, 'Q зажать — колесо оружия', bx + 12, hy + 60, 11, C.textDim, 'left', 600);
    }
  }

  /** Ячейка ствола: модель в цвете, патроны, в руках — красная рамка; пусто — бледный эскиз. */
  private gunSlot(ctx: CanvasRenderingContext2D, p: Character, combat: CombatSystem, x: number, y: number, w: number, h: number, label: string, id: WeaponId | null, ghost: WeaponId, maxH: number): void {
    const C = HUD.inventory.colors;
    const inHands = !!id && p.weapon === id;
    const hot = !!id && this.hover?.x === x && this.hover?.y === y;
    this.slot(ctx, x, y, w, h, label, null, hot);
    if (!id) {
      drawGunIcon(ctx, ghost, x + w / 2, y + h / 2, w * 0.7, { silhouette: C.ink, outline: null, maxH, alpha: C.ghost });
      this.hits.push({ x, y, w, h, title: `${label.toLowerCase()}: пусто`, desc: '', act: '' });
      return;
    }
    const wd = WEAPONS[id];
    drawGunIcon(ctx, id, x + w / 2, y + h / 2 - 3, w * 0.78, { maxH });
    if (wd.ammo) {
      const mag = inHands ? p.mag : p.mags[id] ?? 0;
      text(ctx, `${mag} | ${combat.reserveOf(p, id)}`, x + w - 8, y + h - 12, 12, C.ink, 'right', 900);
    }
    if (inHands) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = C.equipped;
      ctx.strokeRect(x + 4, y + 4, w - 8, h - 8);
      text(ctx, 'в руках', x + 10, y + h - 12, 11, C.equipped, 'left', 800);
    }
    this.hits.push({ x, y, w, h, title: wd.name, desc: `${ITEMS[id].desc} ${weaponStats(wd)}`, act: inHands ? `${this.press} — убрать` : `${this.press} — взять в руки`, click: () => this.host.equipItem(inHands ? null : id) });
  }

  /** Бумажная ячейка с рамкой; ghost — эскиз пустого слота; sel — жёлтая рамка. */
  private slot(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, label: string, ghost: string | null, sel = false, fill: string = HUD.inventory.colors.slot): void {
    const C = HUD.inventory.colors;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    paper(ctx, x, y, w, h, fill, x * 7 + y);
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, C.shade);
    g.addColorStop(0.2, C.clear);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    if (ghost) {
      ctx.globalAlpha = C.ghost;
      drawIcon(ctx, ghost, x + w / 2, y + h / 2 + 2, (Math.min(w, h) / 64) * 0.85);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    ctx.lineWidth = 4;
    ctx.strokeStyle = C.line;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = C.notch;
    for (let i = 0; i < 4; i++) ctx.fillRect(x + 5 + i * 4, y + 5, 2, 3);
    if (label) text(ctx, label, x + w - 5, y + 9, 8, C.label, 'right', 700, 'monospace');
    if (sel) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = C.selected;
      ctx.strokeRect(x + 3, y + 3, w - 6, h - 6);
    }
  }
}

/** Бумага: заливка, зерно и пятна (детерминированно по seed). */
function paper(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, base: string, seed: number): void {
  const C = HUD.inventory.colors;
  ctx.fillStyle = base;
  ctx.fillRect(x, y, w, h);
  let s = seed >>> 0;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const n = (w * h) / 60;
  ctx.fillStyle = C.grainLight;
  for (let i = 0; i < n / 2; i++) ctx.fillRect(x + r() * w, y + r() * h, 1 + r() * 2, 1 + r() * 2);
  ctx.fillStyle = C.grainDark;
  for (let i = 0; i < n / 2; i++) ctx.fillRect(x + r() * w, y + r() * h, 1 + r() * 2, 1 + r() * 2);
  for (let i = 0; i < Math.max(1, (w * h) / 40000); i++) {
    const cx = x + r() * w;
    const cy = y + r() * h;
    const rr = 20 + r() * 50;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
    g.addColorStop(0, C.stain);
    g.addColorStop(1, C.clear);
    ctx.fillStyle = g;
    ctx.fillRect(cx - rr, cy - rr, rr * 2, rr * 2);
  }
}

function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, col: string, align: CanvasTextAlign = 'left', weight = 600, font = '"Segoe UI", Arial, sans-serif'): void {
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = col;
  ctx.fillText(s, x, y);
}

/** Бирка с числом (стопка, гранаты). */
function badge(ctx: CanvasRenderingContext2D, s: string, right: number, y: number): void {
  const C = HUD.inventory.colors;
  ctx.font = '800 11px "Segoe UI", Arial, sans-serif';
  const w = Math.max(18, ctx.measureText(s).width + 8);
  ctx.fillStyle = C.badge;
  ctx.beginPath();
  ctx.roundRect(right - w, y - 8, w, 16, 3);
  ctx.fill();
  text(ctx, s, right - w / 2, y, 11, C.text, 'center', 800);
}

function wrap(ctx: CanvasRenderingContext2D, s: string, width: number, font: string): string[] {
  ctx.font = font;
  const out: string[] = [];
  let line = '';
  for (const word of s.split(' ')) {
    const t = line ? `${line} ${word}` : word;
    if (ctx.measureText(t).width > width && line) {
      out.push(line);
      line = word;
    } else line = t;
  }
  if (line) out.push(line);
  return out;
}

/** Характеристики оружия одной строкой (подсказка). */
function weaponStats(w: WeaponDef): string {
  // Холодное: серия из трёх ударов (config/melee), третий — тяжёлый; ПКМ — блок.
  if (w.mode === 'melee') return `Урон ${w.damage}, серия: ${MELEE_CFG.styles[w.class === 'blade' ? 'blade' : 'baton'].map((s) => s.name).join(' — ')}; ПКМ — блок.`;
  const dmg = w.pellets > 1 ? `${w.damage}×${w.pellets}` : `${w.damage}`;
  const parts = [`урон ${dmg}`, `${w.fireRate} выстр/с`, `дальность ${w.effectiveRange}/${w.range}`, `магазин ${w.magazine}`, `перезарядка ${w.reload} с`];
  if (w.penetration > 0) parts.push(`пробитие ${Math.round(w.penetration * 100)}%`);
  return `${parts.join(', ')}.`;
}
