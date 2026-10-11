/**
 * Вид передового блиндажа повстанцев (world/DugoutRenderer.ts): койки, ящик со штабелем по запасу, фонарь; разрушенный —
 * копоть, обломки сруба, дымок, мигающий заряд у входа. Только картинка — логика в WAR.dugout. Размеры — px мира.
 */
export const DUGOUT_LOOK = {
  outline: 'rgba(20,14,8,0.9)',
  /** Койка: рама, тюфяк, одеяло армии (по цвету формы), подушка. */
  bunk: { w: 12, h: 14, frame: '#5b4026', mattress: '#a89868', blanket: '#5e6a42', blanketUsed: '#7a8650', pillow: '#d8cfae' },
  /** Ящик в углу: основа и штабель — по одному ящику на stackPer комплектов (до stackMax), гранатный ящик — если гранаты есть. */
  crate: { w: 10, h: 8, body: '#7a5a2e', lid: '#8f6c38', mark: '#c8a23c', empty: '#5a4424', stackPer: 1.6, stackMax: 5, grenade: '#4f5a36', grenadeMark: '#c04a36' },
  /** Фонарь: подвешен у середины пола. */
  lantern: { r: 2.4, body: '#3a3226', glass: '#ffd890', glassOff: '#6a6048', ring: 'rgba(255,214,150,0.2)' },
  /** Разрушен: копоть по полу и срубу, пятно взрыва, обломки, дымок (живёт smokeTime с после взрыва). */
  ruin: {
    soot: 'rgba(18,13,9,0.55)',
    wallSoot: 'rgba(22,16,11,0.5)',
    scorch: 'rgba(8,6,4,0.55)',
    splinter: '#caa070',
    charred: '#2a1f16',
    debris: 16,
    smokeTime: 90,
    smoke: 'rgba(70,66,60,0.32)',
    smokePuffs: 3,
    smokeRise: 26,
  },
  /** Заряд легионеров у входа: красная точка мигает с частотой rate Гц, пока копится прогресс. */
  charge: { color: '#ff4030', r: 2.6, rate: 3 },
} as const;
