/** Подсказка по управлению (правый нижний угол). */
export class HelpBar {
  constructor(parent: HTMLElement) {
    const el = document.createElement('div');
    el.className = 'help panel';
    el.innerHTML = [
      ['WASD', 'ходьба'],
      ['Shift', 'бег'],
      ['Мышь', 'взгляд'],
      ['ЛКМ', 'огонь'],
      ['ПКМ', 'прицел'],
      ['Q', 'сменить оружие'],
      ['R', 'перезарядка'],
      ['E', 'действие рядом'],
      ['Tab', 'инвентарь'],
      ['F', 'проверить CID (ГО)'],
      ['G', 'умение отряда ГО'],
      ['N', 'звук'],
      ['M', 'карта'],
      ['Enter', 'чат (/помощь)'],
      ['P', 'пауза'],
      ['F2', 'генератор'],
      ['F3', 'отладка ИИ'],
    ]
      .map(([k, v]) => `<span><kbd>${k}</kbd> ${v}</span>`)
      .join('');
    parent.appendChild(el);
  }
}
