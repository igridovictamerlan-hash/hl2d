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
  /**
   * Привилегии (как у лоялистов сервера): run — бег не нарушение; queue — в очереди за рационом
   * встаёт перед теми, у кого статус ниже; escort — /охрана: вызвать двух юнитов ГО в сопровождение.
   */
  perks: ('run' | 'queue' | 'escort')[];
}

export const LOYALTY = {
  min: -100,
  max: 200,
  /** Стартовые очки: граждане — случайно в диапазоне, ГСР — выше. */
  start: { citizen: [-20, 50] as const, cwu: [20, 70] as const },
  /** Игрок в новой роли. */
  playerStart: { citizen: 10, cwu: 40 },
  tiers: [
    { min: -Infinity, name: 'Неблагонадёжный', checkMul: 2.5, rationBonus: 0, discount: 0, color: '#ff7a6a', perks: [] },
    { min: 0, name: 'Гражданин', checkMul: 1, rationBonus: 0, discount: 0, color: '#c8c4b8', perks: [] },
    { min: 40, name: 'Лоялист', checkMul: 0.5, rationBonus: 4, discount: 0.1, color: '#9fd7a0', perks: ['run', 'queue'] },
    { min: 100, name: 'Доверенный лоялист', checkMul: 0.15, rationBonus: 8, discount: 0.2, color: '#ffd36b', perks: ['run', 'queue', 'escort'] },
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
  /** /охрана доверенного лоялиста: сколько юнитов, на сколько секунд, не чаще раза в … с. */
  escort: { units: 2, time: 90, cooldown: 180 },
  /** Донос: подозреваемый должен быть виден и не дальше, px; не чаще раза в … с. */
  reportRange: 260,
  reportCooldown: 30,
} as const;
