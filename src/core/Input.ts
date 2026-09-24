import { CONTROLS, type Action } from '../config/controls';

/**
 * Ввод: клавиши по KeyboardEvent.code (не зависит от раскладки), мышь относительно холста.
 * wasPressed() срабатывает один раз до конца тика логики (endTick).
 */
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  mouseX = 0;
  mouseY = 0;
  mouseDown = false;
  mousePressed = false;
  /** Мышь над холстом (для курсора-прицела). */
  mouseInside = false;

  private readonly codeToAction = new Map<string, Action>();

  constructor(private readonly canvas: HTMLCanvasElement) {
    for (const [action, codes] of Object.entries(CONTROLS) as [Action, readonly string[]][]) {
      for (const c of codes) this.codeToAction.set(c, action);
    }
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => this.down.clear());
    canvas.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('mouseenter', () => (this.mouseInside = true));
    canvas.addEventListener('mouseleave', () => (this.mouseInside = false));
    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      this.mouseDown = true;
      this.mousePressed = true;
      canvas.focus();
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
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
    const r = this.canvas.getBoundingClientRect();
    this.mouseX = e.clientX - r.left;
    this.mouseY = e.clientY - r.top;
    this.mouseInside = true;
  };

  isDown(action: Action): boolean {
    for (const c of CONTROLS[action]) if (this.down.has(c)) return true;
    return false;
  }

  wasPressed(action: Action): boolean {
    for (const c of CONTROLS[action]) if (this.pressed.has(c)) return true;
    return false;
  }

  endTick(): void {
    this.pressed.clear();
    this.mousePressed = false;
  }
}
