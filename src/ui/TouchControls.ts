import { TOUCH, TOUCH_BUTTONS } from '../config/touch';
import { stickOf, moveOf, aimPoint, Trigger, roleButtons, type Stick } from '../core/touch';
import type { Input } from '../core/Input';
import type { Action } from '../config/controls';
import type { Camera } from '../core/Camera';
import type { Character } from '../entities/Character';
import { ITEMS } from '../config/items';
import { GRENADE_KINDS } from '../systems/CombatSystem';
import { GAME } from '../config/game';

/** Что нужно экрану касаний от игры. */
export interface TouchHost {
  readonly input: Input;
  readonly camera: Camera;
  readonly canvas: HTMLCanvasElement;
  /** Открыто колесо оружия (палец выбирает сектор). */
  wheelOpen(): boolean;
  /** ☰: закрыть открытую панель или меню паузы (как Esc). */
  escape(): void;
  /** Открыть чат (в обработчике касания — иначе Android не покажет клавиатуру). */
  openChat(): void;
  /** Поверх игры открыто меню или панель — стики и кнопки прячутся. */
  busy(): boolean;
  /** Игра на экране (не главное меню). */
  playing(): boolean;
}

const ZERO: Stick = { x: 0, y: 0, mag: 0, far: 0 };

/** Палец на элементе: откуда начал и где сейчас (CSS px экрана). */
interface Finger {
  id: number;
  sx: number;
  sy: number;
  x: number;
  y: number;
  t: number;
}

const now = () => performance.now() / 1000;

/**
 * Сенсорное управление для телефона (Android) поверх холста. Левая часть экрана — стик шага: появляется
 * там, где коснулись; дотянули до края — бег. Справа внизу — стик прицела: тянуть — целиться (конус
 * сужается), до кольца — огонь; короткое касание — выстрел или удар туда, куда смотрите. Вокруг — кнопки
 * E (действие), R, Q (коротко — следующее оружие, держать — колесо: палец выбирает сектор), T (тянуть —
 * куда бросить), C, B и ролевые F/G; сверху — меню, рюкзак, карта, чат, масштаб и «ещё». Касание мира —
 * повернуться туда и прочитать подписи пешки под пальцем.
 *
 * Всё пишется в Input (виртуальные клавиши, аналоговый шаг, «мышь»-прицел) в tick() перед PlayerController —
 * логика игры не знает, мышь это или палец.
 */
export class TouchControls {
  readonly el: HTMLElement;
  enabled = false;
  private readonly moveBase: HTMLElement;
  private readonly moveKnob: HTMLElement;
  private readonly aimBase: HTMLElement;
  private readonly aimKnob: HTMLElement;
  private readonly moreEl: HTMLElement;
  private readonly roleF: HTMLElement;
  private readonly roleG: HTMLElement;
  private readonly nadeLabel: HTMLElement;
  private move: Finger | null = null;
  private aim: Finger | null = null;
  private nade: Finger | null = null;
  private wheel: Finger | null = null;
  private aimTap = false;
  private nadeAt: { x: number; y: number } | null = null;
  private faceAt: { x: number; y: number } | null = null;
  private readonly trigger = new Trigger();
  private player: Character | null = null;
  private acc = 0;

  constructor(root: HTMLElement, private readonly host: TouchHost) {
    const el = document.createElement('div');
    el.className = 'touch-pad';
    el.hidden = true;
    const B = TOUCH_BUTTONS;
    const btn = (b: { action: string; label: string; key?: string; size?: string }, cls: string) =>
      `<button class="t-btn ${cls} ${b.size ?? ''}" data-act="${b.action}">${b.key ? `<b>${b.key}</b>` : ''}<span>${b.label}</span></button>`;
    el.innerHTML = `
      <div class="t-move" hidden><i class="t-knob"></i></div>
      <div class="t-aim"><i class="t-ring"></i><i class="t-knob"></i><span>Огонь</span></div>
      <div class="t-cluster">${B.main.map((b) => btn(b, `t-${b.action}`)).join('')}
        <button class="t-btn small t-roleF" data-act="roleAction" hidden><b>F</b><span>CID</span></button>
        <button class="t-btn small t-roleG" data-act="special" hidden><b>G</b><span>Умение</span></button>
      </div>
      <div class="t-top">${B.top.map((b) => `<button class="t-btn top" data-act="${b.action}" title="${b.title}">${b.label}</button>`).join('')}</div>
      <div class="t-more" hidden>${B.more.map((b) => btn(b, 'wide')).join('')}</div>
      <div class="t-rotate"><div>⟳</div>${TOUCH.portraitHint}</div>`;
    root.appendChild(el);
    this.el = el;
    this.moveBase = el.querySelector('.t-move')!;
    this.moveKnob = this.moveBase.querySelector('.t-knob')!;
    this.aimBase = el.querySelector('.t-aim')!;
    this.aimKnob = this.aimBase.querySelector('.t-knob')!;
    this.moreEl = el.querySelector('.t-more')!;
    this.roleF = el.querySelector('[data-act="roleAction"]')!;
    this.roleG = el.querySelector('[data-act="special"]')!;
    this.nadeLabel = el.querySelector('.t-grenade span')!;
    this.bindButtons();
    this.bindAim();
    this.bindCanvas();
    // Касание экрана — сенсорный режим; настоящая мышь двинулась — обычный.
    window.addEventListener('pointerdown', (e) => e.pointerType === 'touch' && this.enable(true), true);
    // Первое касание — во весь экран (строка адреса не мешает, телефон держат горизонтально).
    const first = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || !TOUCH.autoFullscreen) return;
      window.removeEventListener('pointerup', first, true);
      toggleFullscreen(true);
    };
    window.addEventListener('pointerup', first, true);
    window.addEventListener('pointermove', (e) => {
      if (TOUCH.autoOff && e.pointerType === 'mouse' && (e.movementX !== 0 || e.movementY !== 0) && this.enabled && !this.forced) this.enable(false);
    });
  }

  /** ?touch=1 — сенсорный режим и с мышью (проверка на компьютере). */
  forced = false;

  enable(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    this.el.hidden = !on;
    document.body.classList.toggle('touch', on);
    const i = this.host.input;
    i.touch = on;
    i.releaseAll();
    i.mouseInside = false;
    this.reset();
  }

  private reset(): void {
    this.move = this.aim = this.nade = this.wheel = null;
    this.nadeAt = this.faceAt = null;
    this.aimTap = false;
    this.trigger.reset();
    this.moveBase.hidden = true;
    this.knob(this.aimKnob, 0, 0);
  }

  // ————— Привязка элементов —————

  private bindButtons(): void {
    const i = this.host.input;
    for (const b of Array.from(this.el.querySelectorAll<HTMLButtonElement>('.t-btn'))) {
      const act = b.dataset.act!;
      b.addEventListener('contextmenu', (e) => e.preventDefault());
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        b.setPointerCapture(e.pointerId);
        b.classList.add('on');
        const f: Finger = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, t: now() };
        if (act === 'grenade') this.nade = f;
        else if (act === 'nextWeapon') {
          this.wheel = f;
          i.press('nextWeapon');
        } else if (act === 'more') this.moreEl.hidden = !this.moreEl.hidden;
        else if (act === 'menu') this.host.escape();
        else if (act === 'chat') this.host.openChat();
        else if (act === 'fullscreen') toggleFullscreen();
        else i.press(act as Action);
        // Пункты «ещё» — по одному нажатию: выбрал — список закрылся.
        if (b.parentElement === this.moreEl) this.moreEl.hidden = true;
      });
      b.addEventListener('pointermove', (e) => {
        const f = act === 'grenade' ? this.nade : act === 'nextWeapon' ? this.wheel : null;
        if (f && f.id === e.pointerId) {
          f.x = e.clientX;
          f.y = e.clientY;
        }
      });
      const up = (e: PointerEvent) => {
        b.classList.remove('on');
        if (act === 'grenade' && this.nade?.id === e.pointerId) {
          // Отпустил — бросок в точку, куда тянул (или вперёд).
          if (e.type === 'pointerup') this.nadeAt = this.nadeTarget();
          this.nade = null;
        } else if (act === 'nextWeapon' && this.wheel?.id === e.pointerId) {
          this.wheel = null;
          i.release('nextWeapon');
        } else if (!['more', 'menu', 'chat', 'fullscreen'].includes(act)) i.release(act as Action);
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
    }
  }

  /** Стик прицела: тянуть — прицел, до кольца — огонь, короткое касание — выстрел вперёд. */
  private bindAim(): void {
    const base = this.aimBase;
    base.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      base.setPointerCapture(e.pointerId);
      const r = base.getBoundingClientRect();
      this.aim = { id: e.pointerId, sx: r.left + r.width / 2, sy: r.top + r.height / 2, x: e.clientX, y: e.clientY, t: now() };
      this.moreEl.hidden = true;
    });
    base.addEventListener('pointermove', (e) => {
      if (this.aim?.id !== e.pointerId) return;
      this.aim.x = e.clientX;
      this.aim.y = e.clientY;
    });
    const up = (e: PointerEvent) => {
      const f = this.aim;
      if (f?.id !== e.pointerId) return;
      // Коротко и не тянул — выстрел (удар) туда, куда смотрите.
      if (e.type === 'pointerup' && now() - f.t < TOUCH.aim.tapTime && this.stick(f, TOUCH.aim.radius, TOUCH.aim.dead).mag === 0) this.aimTap = true;
      this.aim = null;
      this.knob(this.aimKnob, 0, 0);
    };
    base.addEventListener('pointerup', up);
    base.addEventListener('pointercancel', up);
  }

  /** Холст: левая часть — стик шага, правая — касание мира (повернуться, подписи пешки). */
  private bindCanvas(): void {
    const cv = this.host.canvas;
    cv.addEventListener('pointerdown', (e) => {
      if (!this.enabled || e.pointerType === 'mouse') return;
      e.preventDefault();
      this.moreEl.hidden = true;
      if (!this.move && e.clientX < window.innerWidth * TOUCH.move.zone) {
        cv.setPointerCapture(e.pointerId);
        this.move = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, t: now() };
        this.moveBase.hidden = false;
        this.moveBase.style.left = `${e.clientX}px`;
        this.moveBase.style.top = `${e.clientY}px`;
        this.knob(this.moveKnob, 0, 0);
        return;
      }
      const w = this.host.camera.screenToWorld(e.clientX, e.clientY);
      this.faceAt = w;
      this.host.input.inspect = { x: w.x, y: w.y, until: now() + TOUCH.inspect };
    });
    cv.addEventListener('pointermove', (e) => {
      if (this.move?.id !== e.pointerId) return;
      this.move.x = e.clientX;
      this.move.y = e.clientY;
    });
    const up = (e: PointerEvent) => {
      if (this.move?.id !== e.pointerId) return;
      this.move = null;
      this.moveBase.hidden = true;
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
  }

  // ————— Каждый тик логики —————

  private stick(f: Finger | null, radius: number, dead: number): Stick {
    return f ? stickOf(f.x - f.sx, f.y - f.sy, radius, dead) : ZERO;
  }

  /** Ручка стика: сдвиг внутри основания (px). */
  private knob(k: HTMLElement, dx: number, dy: number): void {
    k.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  /** Куда полетит граната (мир): тянул — туда, просто нажал — вперёд на TOUCH.grenade.dist. */
  private nadeTarget(): { x: number; y: number } | null {
    const p = this.player;
    const f = this.nade;
    if (!p || !f) return null;
    const G = TOUCH.grenade;
    let dx = (f.x - f.sx) * G.gain;
    let dy = (f.y - f.sy) * G.gain;
    let d = Math.hypot(dx, dy);
    if (d < G.gain * 12) {
      dx = Math.cos(p.facing) * G.dist;
      dy = Math.sin(p.facing) * G.dist;
      d = G.dist;
    }
    if (d > G.max) {
      dx *= G.max / d;
      dy *= G.max / d;
    }
    return { x: p.x + dx, y: p.y + dy };
  }

  /** «Мышь» в точке мира (прицел со стика, граната, поворот). */
  private pointAt(w: { x: number; y: number }): void {
    const i = this.host.input;
    const s = this.host.camera.worldToScreen(w.x, w.y);
    i.mouseX = s.x;
    i.mouseY = s.y;
    i.mouseInside = true;
  }

  /**
   * Перед PlayerController: шаг со стика, прицел и огонь, граната, колесо оружия, поворот по касанию —
   * всё в Input. Меню или панель поверх — всё отпущено.
   */
  tick(p: Character, t: number): void {
    if (!this.enabled) return;
    this.player = p;
    const i = this.host.input;
    if (this.host.busy()) {
      i.moveX = i.moveY = 0;
      i.moveRun = false;
      i.mouseInside = i.mouseDown = i.aimDown = false;
      return;
    }
    // Шаг.
    const M = TOUCH.move;
    const ms = this.stick(this.move, M.radius, M.dead);
    const mv = moveOf(ms);
    i.moveX = mv.x * mv.k;
    i.moveY = mv.y * mv.k;
    i.moveRun = mv.run;
    if (this.move) this.knob(this.moveKnob, ms.x * ms.mag * M.radius, ms.y * ms.mag * M.radius);
    this.moveBase.classList.toggle('run', mv.run);
    // Прицел, огонь, граната, колесо — что сейчас под пальцем.
    const A = TOUCH.aim;
    const as = this.stick(this.aim, A.radius, A.dead);
    if (this.aim) {
      const m = Math.min(1, Math.hypot(this.aim.x - this.aim.sx, this.aim.y - this.aim.sy) / A.radius);
      const a = Math.atan2(this.aim.y - this.aim.sy, this.aim.x - this.aim.sx);
      this.knob(this.aimKnob, Math.cos(a) * m * A.radius, Math.sin(a) * m * A.radius);
    }
    this.aimBase.classList.toggle('fire', as.mag >= A.fireAt);
    i.aimDown = false;
    i.mouseDown = false;
    if (this.nade) {
      const w = this.nadeTarget();
      if (w) this.pointAt(w);
    } else if (this.nadeAt) {
      this.pointAt(this.nadeAt);
      i.tap('grenade');
      this.nadeAt = null;
    } else if (this.wheel && this.host.wheelOpen()) {
      i.mouseX = i.width / 2 + (this.wheel.x - this.wheel.sx) * TOUCH.wheel.gain;
      i.mouseY = i.height / 2 + (this.wheel.y - this.wheel.sy) * TOUCH.wheel.gain;
      i.mouseInside = true;
    } else if (as.mag > 0) {
      this.pointAt(aimPoint(p.x, p.y, as));
      i.aimDown = true;
      const tr = this.trigger.update(as.mag >= A.fireAt, t);
      i.mouseDown = tr.down;
      if (tr.pressed) i.mousePressed = true;
    } else if (this.aimTap) {
      // Короткое касание стика прицела — выстрел (удар) вперёд.
      this.aimTap = false;
      this.pointAt({ x: p.x + Math.cos(p.facing) * A.min, y: p.y + Math.sin(p.facing) * A.min });
      i.mousePressed = true;
      i.mouseDown = true;
    } else if (this.faceAt) {
      this.pointAt(this.faceAt);
      this.faceAt = null;
    } else {
      i.mouseInside = false;
      this.trigger.update(false, t);
    }
  }

  /** С частотой HUD: ролевые кнопки, число гранат, видимость. */
  update(p: Character, dt: number): void {
    if (!this.enabled) return;
    this.acc += dt;
    if (this.acc < GAME.hudInterval) return;
    this.acc = 0;
    const busy = this.host.busy();
    this.el.classList.toggle('busy', busy);
    this.el.classList.toggle('menu', !this.host.playing());
    const r = roleButtons(p);
    this.roleF.hidden = !r.f;
    this.roleG.hidden = !r.g;
    if (r.f) this.roleF.querySelector('span')!.textContent = r.f;
    if (r.g) this.roleG.querySelector('span')!.textContent = r.g;
    const nades = GRENADE_KINDS.filter((g) => p.inventory.has(g));
    const g = nades.includes(p.grenadeKind) ? p.grenadeKind : nades[0];
    this.nadeLabel.textContent = g ? `${TOUCH.nadeShort[g] ?? ITEMS[g].name} ×${p.inventory.count(g)}` : 'Граната';
    this.el.querySelector('.t-grenade')!.classList.toggle('empty', !g);
  }
}

/**
 * Во весь экран (и альбомная ориентация, где браузер позволяет) — или обратно. Во весь экран — body, не
 * <html>: с корнем в полноэкранном слое холст переставал получать касания.
 */
export function toggleFullscreen(on = !document.fullscreenElement): void {
  try {
    if (on) {
      const r = document.body.requestFullscreen?.({ navigationUI: 'hide' });
      void r
        ?.then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
        .catch(() => {});
    } else void document.exitFullscreen?.().catch(() => {});
  } catch {
    /* браузер не дал — играем как есть */
  }
}
