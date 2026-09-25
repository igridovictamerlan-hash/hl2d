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
  /** Пауза. */
  pause: ['KeyP'],
  /** Звук выстрелов вкл/выкл. */
  mute: ['KeyN'],
} as const;

export type Action = keyof typeof CONTROLS;
