/** Параметры персонажей. Скорости — px/с. */
export const CHARACTER = {
  radius: 12,
  walkSpeed: 95,
  runSpeed: 170,
  /** Разгон/торможение, px/с². */
  accel: 1100,
  npcWalkSpeed: [62, 84] as const,
  npcAccel: 600,
  maxHealth: 100,
  startMoney: 25,
  /** Стартовые токены по ролям. */
  roleMoney: { citizen: 25, cwu: 40, cp: 60, rebel: 15, ota: 0, admin: 200, vort: 0 } as Record<string, number>,
  /** Масса для расталкивания: игрок «тяжелее», NPC уступают. */
  mass: { player: 2.5, npc: 1 },
} as const;
