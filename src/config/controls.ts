/**
 * Привязка клавиш по KeyboardEvent.code — не зависит от раскладки (работает и на русской).
 */
export const CONTROLS = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  run: ['ShiftLeft', 'ShiftRight'],
  interact: ['KeyE'],
  inventory: ['Tab'],
  chat: ['Enter', 'NumpadEnter'],
  /** Открыть чат сразу с «/» для команды. */
  command: ['Slash'],
  roleAction: ['KeyF'],
  bigMap: ['KeyM'],
  /** Масштаб камеры: следующий из CAMERA.zoomLevels. */
  zoom: ['KeyV'],
  devPanel: ['F2'],
  debug: ['F3'],
  choice1: ['Digit1', 'Numpad1'],
  choice2: ['Digit2', 'Numpad2'],
  choice3: ['Digit3', 'Numpad3'],
  reload: ['KeyR'],
  special: ['KeyG'],
  /** Следующее оружие / убрать (Q), убрать оружие (H). */
  nextWeapon: ['KeyQ'],
  holster: ['KeyH'],
  /** Бросить гранату к курсору. */
  grenade: ['KeyT'],
  /** Сменить гранату (осколочная → дымовая → зажигательная). */
  grenadeKind: ['KeyY'],
  /** Перевязаться (бинт или аптечка): остановить кровотечение. */
  bandage: ['KeyB'],
  /** Поставить растяжку из гранаты под ноги (рядом с телом — заминировать тело). */
  mine: ['KeyZ'],
  /** Присесть / встать (медленнее, точнее, за бетонным блоком почти не попасть). */
  crouch: ['KeyC'],
  /** Тащить тяжелораненого / отпустить. */
  drag: ['KeyX'],
  /** Пауза. */
  pause: ['KeyP'],
  /** Звук выстрелов вкл/выкл. */
  mute: ['KeyN'],
} as const;

export type Action = keyof typeof CONTROLS;
