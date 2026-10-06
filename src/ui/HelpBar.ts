/** Клавиши по группам — для панели F1 и экрана «Управление» в меню. */
export const CONTROLS_GROUPS: [string, [string, string][]][] = [
  ['Движение', [
    ['WASD', 'ходьба'],
    ['Shift', 'бег'],
    ['C', 'присесть / встать'],
    ['Мышь', 'взгляд'],
  ]],
  ['Бой', [
    ['ЛКМ', 'огонь; без оружия — кулаки'],
    ['ПКМ', 'прицел'],
    ['R', 'перезарядка'],
    ['Q', 'следующее оружие; зажать — колесо оружия'],
    ['H', 'убрать оружие'],
    ['O', 'оскорбить того, кто перед вами (драка)'],
    ['T / Y', 'бросить / сменить гранату'],
    ['Z', 'растяжка из гранаты'],
    ['B', 'перевязаться'],
    ['X', 'тащить раненого'],
  ]],
  ['Действия', [
    ['E', 'действие рядом; перед человеком — поговорить (ещё раз — угостить голодного); поднять раненого'],
    ['F', 'проверить CID (ВС)'],
    ['G', 'умение роли (лечить, блок, сканер, маскировка, клич главы)'],
    ['Tab', 'инвентарь: еда, оружие, снаряжение'],
    ['Enter', 'чат (/помощь — команды)'],
  ]],
  ['Интерфейс', [
    ['K', 'знакомые: кто вас знает и как относится'],
    ['M', 'карта: колесо — масштаб, ЛКМ — метка'],
    ['V', 'масштаб камеры'],
    ['N', 'звук'],
    ['P / Esc', 'пауза / меню'],
    ['F1', 'эта подсказка'],
    ['F2 / F3', 'генератор / отладка ИИ'],
  ]],
];

/** Все клавиши одним списком (экран «Управление»). */
export const CONTROLS_HELP: [string, string][] = CONTROLS_GROUPS.flatMap(([, rows]) => rows);

/**
 * Подсказка по управлению: в углу — маленький значок «F1 — управление», по F1 — панель со всеми
 * клавишами по группам (не мешает игре — сквозь неё можно стрелять).
 */
export class HelpBar {
  private readonly chip: HTMLElement;
  private readonly panel: HTMLElement;

  constructor(parent: HTMLElement) {
    this.chip = document.createElement('div');
    this.chip.className = 'help-chip panel';
    this.chip.innerHTML = '<kbd>F1</kbd> управление';
    parent.appendChild(this.chip);
    this.panel = document.createElement('div');
    this.panel.className = 'help panel';
    this.panel.hidden = true;
    this.panel.innerHTML =
      `<div class="help-head"><span>УПРАВЛЕНИЕ</span><span><kbd>F1</kbd> — скрыть</span></div><div class="help-cols">` +
      CONTROLS_GROUPS.map(([title, rows]) => `<div class="help-col"><div class="help-title">${title}</div>${rows.map(([k, v]) => `<div class="help-row"><kbd>${k}</kbd><span>${v}</span></div>`).join('')}</div>`).join('') +
      '</div>';
    parent.appendChild(this.panel);
  }

  get isOpen(): boolean {
    return !this.panel.hidden;
  }

  toggle(): void {
    this.panel.hidden = !this.panel.hidden;
    this.chip.hidden = !this.panel.hidden;
  }
}
