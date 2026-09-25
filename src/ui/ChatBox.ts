/**
 * Строка ввода чата (Enter — открыть, Enter — отправить, Esc — закрыть). Пока открыта, игровые
 * клавиши не перехватываются (Input пропускает ввод в поля). Логика команд — systems/ChatSystem.
 */
export class ChatBox {
  private readonly el: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly history: string[] = [];
  private histPos = -1;

  constructor(
    parent: HTMLElement,
    private readonly onSubmit: (text: string) => void,
    private readonly onClose: () => void,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'chat-box panel';
    this.el.hidden = true;
    this.el.innerHTML = `<input type="text" maxlength="140" placeholder="Сказать… (/помощь — команды, Esc — закрыть)" />`;
    this.input = this.el.querySelector('input')!;
    parent.appendChild(this.el);
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        const text = this.input.value.trim();
        if (text) {
          this.history.push(text);
          this.onSubmit(text);
        }
        this.close();
      } else if (e.code === 'Escape') this.close();
      else if (e.code === 'ArrowUp' && this.history.length) {
        this.histPos = this.histPos < 0 ? this.history.length - 1 : Math.max(0, this.histPos - 1);
        this.input.value = this.history[this.histPos];
        e.preventDefault();
      }
    });
    this.input.addEventListener('blur', () => this.isOpen && this.close());
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(prefill = ''): void {
    this.el.hidden = false;
    this.histPos = -1;
    this.input.value = prefill;
    // Enter, открывший чат, не должен сразу попасть в поле.
    window.setTimeout(() => this.input.focus(), 0);
  }

  close(): void {
    if (this.el.hidden) return;
    this.el.hidden = true;
    this.input.blur();
    this.onClose();
  }
}
