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
  chat: ['Enter'],
  roleAction: ['KeyF'],
  bigMap: ['KeyM'],
  devPanel: ['F2'],
  debug: ['F3'],
} as const;

export type Action = keyof typeof CONTROLS;
