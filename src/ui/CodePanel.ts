import type { WarSystem, AlertCode } from '../systems/WarSystem';

const NAMES: Record<AlertCode, string> = { green: 'ЗЕЛЁНЫЙ', yellow: 'ЖЁЛТЫЙ', red: 'КРАСНЫЙ' };

/**
 * Терминал кодов тревоги в кабинете Администратора: 1 — код жёлтый, 2 — код красный, 3 — отбой
 * (зелёный). Показывает текущий код и включён ли он с терминала (тогда держится до отмены).
 */
export class CodePanel {
  private readonly el: HTMLElement;
  isOpen = false;

  constructor(
    parent: HTMLElement,
    private readonly war: () => WarSystem,
    private readonly onChoice: (code: AlertCode) => void,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'check-panel code-panel panel';
    this.el.hidden = true;
    parent.appendChild(this.el);
  }

  open(): void {
    this.isOpen = true;
    this.render();
    this.el.hidden = false;
  }

  close(): void {
    this.isOpen = false;
    this.el.hidden = true;
  }

  /** Выбор кода (клавиша или кнопка); панель остаётся открытой и показывает новый код. */
  choose(code: AlertCode): void {
    if (!this.isOpen) return;
    this.onChoice(code);
    this.render();
  }

  private render(): void {
    const w = this.war();
    const manual = w.manualCode ? ' · <span class="code-manual">с терминала, держится до отмены</span>' : ' · по обстановке';
    this.el.innerHTML = `
      <div class="check-head">ТЕРМИНАЛ АДМИНИСТРАЦИИ · КОДЫ ТРЕВОГИ</div>
      <div>Сейчас: <span class="code-now code-${w.code}">КОД ${NAMES[w.code]}</span>${manual}</div>
      <div class="code-hint">Жёлтый — усиленные проверки CID. Красный — комендантский час, раздача закрыта, OTA выходит из Цитадели.</div>
      <div class="check-actions">
        <button data-c="yellow"><kbd>1</kbd> Код жёлтый</button>
        <button data-c="red"><kbd>2</kbd> Код красный</button>
        <button data-c="green"><kbd>3</kbd> Отбой</button>
      </div>`;
    this.el.querySelectorAll<HTMLButtonElement>('button[data-c]').forEach((b) => b.addEventListener('click', () => this.choose(b.dataset.c as AlertCode)));
  }
}
