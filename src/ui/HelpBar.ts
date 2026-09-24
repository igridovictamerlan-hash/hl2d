/** Подсказка по управлению (правый нижний угол). */
export class HelpBar {
  constructor(parent: HTMLElement) {
    const el = document.createElement('div');
    el.className = 'help panel';
    el.innerHTML = [
      ['WASD', 'ходьба'],
      ['Shift', 'бег'],
      ['Мышь', 'взгляд'],
      ['E', 'терминал найма'],
      ['F', 'проверить CID (ГО)'],
      ['F2', 'панель карты'],
      ['F3', 'отладка ИИ'],
    ]
      .map(([k, v]) => `<span><kbd>${k}</kbd> ${v}</span>`)
      .join('');
    parent.appendChild(el);
  }
}
