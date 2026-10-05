import { CONTROLS, type Action } from '../config/controls';

/**
 * Ввод: клавиши по KeyboardEvent.code (не зависит от раскладки), мышь относительно холста; на телефоне —
 * сенсорный экран (ui/TouchControls) пишет сюда же: виртуальные клавиши, аналоговый шаг, «мышь»-прицел.
 * wasPressed() срабатывает один раз до конца тика логики (endTick).
 */
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  mouseX = 0;
  mouseY = 0;
  mouseDown = false;
  mousePressed = false;
  /** Зажата правая кнопка (прицеливание). */
  aimDown = false;
  /** Прокрутка колеса мыши за тик (+ вниз, − вверх; колесо оружия). */
  wheel = 0;
  /** Мышь над холстом (для курсора-прицела). */
  mouseInside = false;
  /**
   * Сенсорный режим (ui/TouchControls): аналоговый шаг со стика (moveX/moveY — направление × доля скорости,
   * run — дотянул до края), виртуальные клавиши кнопок экрана, точка «касание мира» для подробностей о пешке.
   */
  touch = false;
  moveX = 0;
  moveY = 0;
  moveRun = false;
  inspect: { x: number; y: number; until: number } | null = null;
  private vdown = new Set<Action>();
  private vpressed = new Set<Action>();

  private readonly codeToAction = new Map<string, Action>();

  constructor(private readonly canvas: HTMLCanvasElement) {
    for (const [action, codes] of Object.entries(CONTROLS) as [Action, readonly string[]][]) {
      for (const c of codes) this.codeToAction.set(c, action);
    }
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => {
      this.down.clear();
      this.mouseDown = this.aimDown = false;
    });
    canvas.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('mouseenter', () => !this.touch && (this.mouseInside = true));
    canvas.addEventListener('mouseleave', () => !this.touch && (this.mouseInside = false));
    canvas.addEventListener('mousedown', (e) => {
      if (this.touch) return;
      if (e.button === 2) {
        this.aimDown = true;
        return;
      }
      if (e.button !== 0) return;
      this.mouseDown = true;
      this.mousePressed = true;
      canvas.focus();
    });
    window.addEventListener('mouseup', (e) => {
      if (this.touch) return;
      if (e.button === 0) this.mouseDown = false;
      if (e.button === 2) this.aimDown = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener(
      'wheel',
      (e) => {
        this.wheel += Math.sign(e.deltaY);
        e.preventDefault();
      },
      { passive: false },
    );
  }

  /** Фокус в поле ввода — игровые клавиши не перехватываем. */
  private isTyping(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.isTyping(e)) return;
    const action = this.codeToAction.get(e.code);
    if (action) e.preventDefault();
    if (!this.down.has(e.code)) this.pressed.add(e.code);
    this.down.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.down.delete(e.code);
  };

  private onMouseMove = (e: MouseEvent) => {
    // В сенсорном режиме «мышь» — это прицел со стика (TouchControls), не события браузера.
    if (this.touch) return;
    const r = this.canvas.getBoundingClientRect();
    this.mouseX = e.clientX - r.left;
    this.mouseY = e.clientY - r.top;
    this.mouseInside = true;
  };

  /** Размер холста в px CSS (центр — для колеса оружия). */
  get width(): number {
    return this.canvas.clientWidth;
  }

  get height(): number {
    return this.canvas.clientHeight;
  }

  isDown(action: Action): boolean {
    if (this.vdown.has(action)) return true;
    for (const c of CONTROLS[action]) if (this.down.has(c)) return true;
    return false;
  }

  wasPressed(action: Action): boolean {
    if (this.vpressed.has(action)) return true;
    for (const c of CONTROLS[action]) if (this.pressed.has(c)) return true;
    return false;
  }

  /** Виртуальная клавиша (кнопка сенсорного экрана) нажата / отпущена. */
  press(action: Action): void {
    if (!this.vdown.has(action)) this.vpressed.add(action);
    this.vdown.add(action);
  }

  release(action: Action): void {
    this.vdown.delete(action);
  }

  /** Короткое нажатие виртуальной клавиши: сработает на ближайшем тике. */
  tap(action: Action): void {
    this.vpressed.add(action);
  }

  /** Отпустить все клавиши (открыли чат, потеряли фокус). */
  releaseAll(): void {
    this.down.clear();
    this.vdown.clear();
    this.mouseDown = this.aimDown = false;
    this.moveX = this.moveY = 0;
    this.moveRun = false;
  }

  endTick(): void {
    this.pressed.clear();
    this.vpressed.clear();
    this.mousePressed = false;
    this.wheel = 0;
  }
}
