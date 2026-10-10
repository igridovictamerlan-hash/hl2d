/**
 * Ближний бой (systems/Melee.ts, ai/MeleeFighter.ts): кулаки, дубинка, нож.
 *
 * Удар — три фазы: замах (windup — рука или оружие отведены, это видно: противник успевает закрыться,
 * отшагнуть или ударить навстречу быстрее) → удар (урон, выпад вперёд, отброс цели) → отход (recover —
 * новый удар не начать). Серия: следующий удар в окне combo.window после отхода — следующий в цепочке
 * стиля; последний — тяжёлый: сильнее, отбрасывает, пробивает блок, после него серия сначала.
 * Попавший удар сбивает (stagger): цель не бьёт и теряет начатый замах. Кулаком не убить (FISTS.floor —
 * нокаут: лежит FISTS.knockout с). Базовые урон и дальность — FISTS и WEAPONS (дубинка, нож).
 * Время — секунды, расстояния — px, скорости — px/с, углы — градусы.
 */

/** Стиль ближнего боя: кулаки (без оружия), дубинка (класс melee), нож (blade). */
export type MeleeStyle = 'fists' | 'baton' | 'blade';

export interface StrikeDef {
  /** Название (журнал, отладка). */
  name: string;
  /** Движение: thrust — прямой выпад вперёд, slash — дугой; side: +1 — слева направо (по часовой), −1 — справа налево. */
  motion: 'thrust' | 'slash';
  side: 1 | -1;
  /** Кулаки: какой рукой (−1 — левой, +1 — правой). */
  hand: 1 | -1;
  windup: number;
  recover: number;
  /** × базового урона стиля и × его дальности; полуугол сектора удара. */
  damage: number;
  reach: number;
  arc: number;
  /** Выпад бьющего вперёд и отброс цели, px/с (отброс делится на √массы: игрока отбрасывает меньше). */
  lunge: number;
  knock: number;
  /** Сбивает: цель не бьёт и теряет замах столько секунд. */
  stagger: number;
  /** × замедления стиля (FISTS.stun, WeaponDef.stun). */
  stun: number;
  /** Шанс попасть в голову (иначе корпус). */
  head: number;
  /** Тяжёлый: пробивает блок, после него серия сначала. */
  heavy?: boolean;
}

const S = (d: StrikeDef): StrikeDef => d;

export const MELEE = {
  /** Серия продолжается, если следующий удар начат не позже window с после конца отхода. */
  combo: { window: 0.5 },
  /** Нажал удар раньше, чем можно (отход ещё идёт), — он выйдет сам, как только можно (не позже buffer с). */
  buffer: 0.22,
  styles: {
    /** Двойка и боковой: джеб левой, прямой правой, хук левой — отбрасывает. */
    fists: [
      S({ name: 'джеб', motion: 'thrust', side: 1, hand: -1, windup: 0.09, recover: 0.17, damage: 0.8, reach: 1, arc: 40, lunge: 80, knock: 55, stagger: 0.17, stun: 0.5, head: 0.4 }),
      S({ name: 'прямой', motion: 'thrust', side: 1, hand: 1, windup: 0.1, recover: 0.2, damage: 1, reach: 1.05, arc: 38, lunge: 105, knock: 80, stagger: 0.22, stun: 0.8, head: 0.45 }),
      S({ name: 'хук', motion: 'slash', side: 1, hand: -1, windup: 0.2, recover: 0.38, damage: 1.6, reach: 0.95, arc: 60, lunge: 130, knock: 190, stagger: 0.5, stun: 1.6, head: 0.7, heavy: true }),
    ],
    /** Дубинка: наотмашь, обратным, тычок с разрядом — отбрасывает и оглушает надолго. */
    baton: [
      S({ name: 'наотмашь', motion: 'slash', side: 1, hand: 1, windup: 0.14, recover: 0.24, damage: 0.85, reach: 1, arc: 50, lunge: 70, knock: 100, stagger: 0.25, stun: 0.45, head: 0.3 }),
      S({ name: 'обратным', motion: 'slash', side: -1, hand: 1, windup: 0.13, recover: 0.24, damage: 0.85, reach: 1, arc: 50, lunge: 70, knock: 100, stagger: 0.25, stun: 0.45, head: 0.3 }),
      S({ name: 'разряд', motion: 'thrust', side: 1, hand: 1, windup: 0.24, recover: 0.42, damage: 1.4, reach: 1.15, arc: 28, lunge: 150, knock: 230, stagger: 0.6, stun: 1, head: 0.2, heavy: true }),
    ],
    /** Нож: полоснуть, обратным, ткнуть — глубоко (дальше и сильнее). В спину — всегда в полную силу и мимо брони. */
    blade: [
      S({ name: 'полоснул', motion: 'slash', side: 1, hand: 1, windup: 0.08, recover: 0.15, damage: 0.72, reach: 1, arc: 50, lunge: 95, knock: 35, stagger: 0.15, stun: 0.5, head: 0.12 }),
      S({ name: 'обратным', motion: 'slash', side: -1, hand: 1, windup: 0.08, recover: 0.16, damage: 0.72, reach: 1, arc: 50, lunge: 95, knock: 35, stagger: 0.15, stun: 0.5, head: 0.12 }),
      S({ name: 'ткнул', motion: 'thrust', side: 1, hand: 1, windup: 0.16, recover: 0.32, damage: 1.35, reach: 1.25, arc: 24, lunge: 175, knock: 70, stagger: 0.35, stun: 1, head: 0.05, heavy: true }),
    ],
  } satisfies Record<MeleeStyle, readonly StrikeDef[]>,
  /** Урон по зонам (руки — когда закрылся голыми руками от ножа). */
  zones: { head: 1.35, torso: 1, arm: 0.7 },
  /** Кулак или дубинка в спину: × урон и сбивает дольше. */
  backMul: 1.3,
  /**
   * Блок (игрок — ПКМ без оружия или с холодным; NPC в драке — по замаху противника): удары спереди в
   * пределах arc от взгляда — урон × take[чем закрылся][чем били], отброс × knockMul, не сбивает;
   * шаг × speedMul, самому не бить. Поднял блок не раньше parry с до удара — парирование: урона нет,
   * бьющий сбит на parryStagger с. Тяжёлый удар пробивает блок: урон × heavyTake, не закрыться guardBreak с.
   * Голыми руками от ножа — порез по рукам (кровит).
   */
  block: {
    arc: 75,
    speedMul: 0.55,
    parry: 0.15,
    parryStagger: 0.6,
    parryKnock: 90,
    guardBreak: 0.85,
    heavyTake: 0.6,
    knockMul: 0.45,
    take: {
      fists: { fists: 0.15, baton: 0.45, blade: 0.5 },
      baton: { fists: 0.1, baton: 0.25, blade: 0.2 },
      blade: { fists: 0.2, baton: 0.4, blade: 0.3 },
    } satisfies Record<MeleeStyle, Record<MeleeStyle, number>>,
  },
  /** После выпада или отброса столько секунд скорость — не бег (ВС не считает нарушением). */
  impulse: 0.3,
  /** Кулаки видны (стойка) столько секунд после удара, блока или полученного удара. */
  stance: 1.6,
  /**
   * Замирание кадра у игрока (реальное время, только картинка): попал / по нему попали — hit с,
   * тяжёлым — heavy, парирование и нокаут — parry; время идёт × scale.
   */
  hitstop: { hit: 0.03, heavy: 0.065, parry: 0.085, scale: 0.12 },
  /** Тряска экрана игроку: свой удар (по стилю), тяжёлый × heavyMul, блок, по нему попали — как от пули. */
  shake: { fists: 1.4, baton: 2, blade: 2.2, heavyMul: 1.7, block: 1 },
  /**
   * Драка NPC (MeleeFighter): держится чуть дальше удара (band px сверх дальности) и обходит по кругу
   * (circle × шаг, сторону меняет в среднем раз в turn с), заходит серией в combo ударов, отходит back с,
   * ждёт wait с. Видит замах противника (тот смотрит на него и близко) — закрывается (block, держит guard
   * с), отшагивает (dodge) или бьёт навстречу. Бандиты злее: блок реже, серии длиннее.
   */
  ai: {
    band: 10,
    circle: 0.6,
    turn: 1.4,
    press: 1,
    backSpeed: 0.85,
    combo: [1, 3] as const,
    back: [0.3, 0.7] as const,
    wait: [0.25, 0.8] as const,
    block: 0.4,
    dodge: 0.2,
    guard: [0.3, 0.6] as const,
    bandit: { block: 0.22, dodge: 0.1, combo: [2, 3] as const },
    /** Сколько px до противника ведёт по пути (дальше — Mover), ближе — шагами сам. */
    engage: 70,
  },
} as const;

/**
 * Как выглядит ближний бой (EntityRenderer, AimRenderer, Particles) — только картинка.
 * Размеры кулаков и оружия — в единицах пешки (× PAWN.scale), дуги — px мира.
 */
export const MELEE_LOOK = {
  /**
   * След удара: серп по дуге (slash) или клин по выпаду (thrust) у кончика оружия/кулака — тянется за
   * sweep с, гаснет за fade с; толщина у кончика width px мира; цвет по стилю; попал — ярче.
   */
  trail: {
    sweep: 0.075,
    fade: 0.16,
    width: { fists: 2.6, baton: 5.5, blade: 3 },
    color: { fists: '255,244,226', baton: '150,212,255', blade: '236,244,252' },
    alpha: 0.42,
    hitAlpha: 0.75,
    segments: 12,
  },
  /**
   * Кулаки: в стойке — у груди (fwd вперёд, side в стороны, y — высота от центра), в блоке — у лица
   * (guard*), замах отводит на pull, выпад выносит на ext; хук — дугой с боку (hookSide); r — радиус.
   */
  fists: { fwd: 4.6, side: 3.4, y: 2.2, guardFwd: 4.2, guardSide: 2, guardY: -5.5, pull: 2.4, ext: 9.5, hookSide: 7, r: 2.4 },
  /** Оружие: замах — отвести на windupAng (дуга) / pull (выпад), удар — до swingAng / ext; блок — поперёк (blockAng). */
  weapon: { windupAng: 70, swingAng: 70, pull: 3, ext: 5, blockAng: 78, blockPull: 2.5 },
  /** Получил удар: наклон от удара (lean рад), сдвиг (shift), вспышка (flash с, flashAlpha) — time с. */
  flinch: { time: 0.2, lean: 0.3, shift: 2.4, flash: 0.08, flashAlpha: 0.45 },
  /** Нокаут: лежит на боку, над головой кружат звёздочки. */
  ko: { star: '#ffd75a', stars: 3, spin: 3.2 },
  /** Дальность следующего удара у игрока (дуга перед ним; пока удар не готов — бледнее), блок — щит-дуга. */
  reach: '255,236,200',
  reachAlpha: 0.28,
  guard: '170,214,255',
} as const;
