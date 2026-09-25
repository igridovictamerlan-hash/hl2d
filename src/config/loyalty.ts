/**
 * Лояльность граждан (и ГСР) к Альянсу — очки. Уровень влияет на то, как часто ГО проверяет
 * CID «для порядка», на надбавку к рациону и скидку в магазине ГСР.
 */
export interface LoyaltyTier {
  min: number;
  name: string;
  /** Множитель шанса плановой проверки CID. */
  checkMul: number;
  /** Доп. токены в рационе. */
  rationBonus: number;
  /** Скидка в магазине ГСР (доля). */
  discount: number;
  color: string;
}

export const LOYALTY = {
  min: -100,
  max: 200,
  /** Стартовые очки: граждане — случайно в диапазоне, ГСР — выше. */
  start: { citizen: [-20, 50] as const, cwu: [20, 70] as const },
  /** Игрок в новой роли. */
  playerStart: { citizen: 10, cwu: 40 },
  tiers: [
    { min: -Infinity, name: 'Неблагонадёжный', checkMul: 2.5, rationBonus: 0, discount: 0, color: '#ff7a6a' },
    { min: 0, name: 'Гражданин', checkMul: 1, rationBonus: 0, discount: 0, color: '#c8c4b8' },
    { min: 40, name: 'Лоялист', checkMul: 0.5, rationBonus: 4, discount: 0.1, color: '#9fd7a0' },
    { min: 100, name: 'Образцовый гражданин', checkMul: 0.15, rationBonus: 8, discount: 0.2, color: '#ffd36b' },
  ] as LoyaltyTier[],
  /** За что даётся и снимается. */
  points: {
    ration: 2,
    checkOk: 2,
    cwuWork: 3,
    report: 12,
    falseReport: -8,
    reward: 5,
    fine: -10,
    arrest: -25,
    insult: -8,
  },
  /** ГО может поощрить одного и того же гражданина не чаще, с. */
  rewardCooldown: 60,
  /** Донос: подозреваемый должен быть виден и не дальше, px; не чаще раза в … с. */
  reportRange: 260,
  reportCooldown: 30,
} as const;
