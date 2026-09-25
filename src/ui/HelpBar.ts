/** Клавиши и действия — для подсказки и экрана «Управление» в меню. */
export const CONTROLS_HELP: [string, string][] = [
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
  ['Esc', 'меню'],
];

/** Подсказка по управлению (правый нижний угол). */
export class HelpBar {
  constructor(parent: HTMLElement) {
    const el = document.createElement('div');
    el.className = 'help panel';
    el.innerHTML = CONTROLS_HELP.map(([k, v]) => `<span><kbd>${k}</kbd> ${v}</span>`).join('');
    parent.appendChild(el);
  }
}
