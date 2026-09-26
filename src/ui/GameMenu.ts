import { CONTROLS_HELP } from './HelpBar';

export interface GameMenuHost {
  /** Есть ли что продолжать (сохранение или идущая игра). */
  canContinue(): boolean;
  continueGame(): void;
  newGame(): void;
  save(): boolean;
  changeRole(): void;
  toggleSound(): boolean;
  readonly soundMuted: boolean;
}

/**
 * Меню игры. Главное (при запуске и «Выйти в главное меню»): продолжить, новая игра, управление.
 * Пауза (Esc в игре): продолжить, сохранить, сменить роль, управление, звук, выйти в главное меню.
 * Пока меню открыто, мир стоит.
 */
export class GameMenu {
  private readonly el: HTMLElement;
  private readonly box: HTMLElement;
  private mode: 'main' | 'pause' = 'main';
  private screen: 'buttons' | 'controls' | 'confirmNew' = 'buttons';
  private note = '';

  constructor(parent: HTMLElement, private readonly host: GameMenuHost) {
    this.el = document.createElement('div');
    this.el.className = 'game-menu';
    this.el.hidden = true;
    this.box = document.createElement('div');
    this.box.className = 'game-menu-box panel';
    this.el.appendChild(this.box);
    parent.appendChild(this.el);
    this.box.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
      if (b?.dataset.act) this.act(b.dataset.act);
    });
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  get isMain(): boolean {
    return this.isOpen && this.mode === 'main';
  }

  open(mode: 'main' | 'pause'): void {
    this.mode = mode;
    this.screen = 'buttons';
    this.note = '';
    this.el.hidden = false;
    this.el.classList.toggle('main', mode === 'main');
    this.render();
  }

  close(): void {
    this.el.hidden = true;
  }

  /** Esc внутри меню: из «Управления» и подтверждения — назад, в паузе — продолжить. */
  back(): void {
    if (this.screen !== 'buttons') {
      this.screen = 'buttons';
      this.render();
    } else if (this.mode === 'pause') this.close();
  }

  private act(a: string): void {
    const h = this.host;
    switch (a) {
      case 'continue':
        this.close();
        h.continueGame();
        return;
      case 'new':
        // Подтверждение — своим экраном: window.confirm в песочнице (опубликованная страница) сразу
        // возвращает «нет», и кнопка молча не работала.
        if (h.canContinue()) {
          this.screen = 'confirmNew';
          break;
        }
        this.close();
        h.newGame();
        return;
      case 'newYes':
        this.close();
        h.newGame();
        return;
      case 'save':
        this.note = h.save() ? 'Игра сохранена.' : 'Сохранить не удалось (роль не выбрана или хранилище недоступно).';
        break;
      case 'role':
        this.close();
        h.changeRole();
        return;
      case 'sound':
        h.toggleSound();
        break;
      case 'controls':
        this.screen = 'controls';
        break;
      case 'back':
        this.screen = 'buttons';
        break;
      case 'exit':
        h.save();
        this.open('main');
        return;
    }
    this.render();
  }

  private render(): void {
    const h = this.host;
    const title = `<div class="gm-title">СИТИ-17</div><div class="gm-sub">${this.mode === 'main' ? 'HL2RP · город под контролем Альянса' : 'ПАУЗА'}</div>`;
    if (this.screen === 'controls') {
      const rows = CONTROLS_HELP.map(([k, v]) => `<div><kbd>${k}</kbd><span>${v}</span></div>`).join('');
      this.box.innerHTML = `${title}<div class="gm-controls">${rows}</div><button data-act="back">Назад</button>`;
      return;
    }
    if (this.screen === 'confirmNew') {
      this.box.innerHTML = `${title}<div class="gm-note">Начать новую игру? Будет новый город, сохранение сотрётся.</div>
        <div class="gm-buttons"><button data-act="newYes" class="primary">Да, начать заново</button><button data-act="back">Отмена</button></div>`;
      return;
    }
    const btn = (act: string, text: string, primary = false) => `<button data-act="${act}"${primary ? ' class="primary"' : ''}>${text}</button>`;
    const sound = `Звук: ${h.soundMuted ? 'выкл' : 'вкл'}`;
    const buttons =
      this.mode === 'main'
        ? [
            h.canContinue() ? btn('continue', 'Продолжить', true) : btn('continue', 'Играть', true),
            h.canContinue() ? btn('new', 'Новая игра') : '',
            btn('controls', 'Управление'),
            btn('sound', sound),
          ]
        : [
            btn('continue', 'Продолжить', true),
            btn('save', 'Сохранить'),
            btn('role', 'Сменить роль'),
            btn('controls', 'Управление'),
            btn('sound', sound),
            btn('exit', 'Выйти в главное меню'),
          ];
    this.box.innerHTML = `${title}<div class="gm-buttons">${buttons.join('')}</div><div class="gm-note">${this.note}</div>
      <div class="gm-foot">${this.mode === 'main' ? 'Игра сохраняется в браузере автоматически.' : 'Esc — вернуться в игру'}</div>`;
  }
}
