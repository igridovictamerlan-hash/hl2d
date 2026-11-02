/** Описание — docs/rendering.md («Атмосфера: настройки»). Без DOM: разбор, пресеты, упрощение — проверяются тестами. */
import { ATMOSPHERE } from '../config/lighting';

export type AtmoQuality = 'high' | 'medium' | 'low';
export type NightLevel = 'bright' | 'normal' | 'dark';

/**
 * Настройки атмосферы (меню «Атмосфера: свет и сутки»): общий выключатель, качество (разрешение карты света и набор
 * эффектов по пресету), яркость ночи и выключатели эффектов. Хранятся в браузере (ATMOSPHERE.storageKey).
 */
export interface AtmoSettings {
  on: boolean;
  quality: AtmoQuality;
  night: NightLevel;
  /** Свечение ламп и окон, тёплая дымка вокруг света. */
  glow: boolean;
  /** Тени облаков днём и в лунном свете. */
  clouds: boolean;
  /** Тени от солнца: дома и люди. */
  shadows: boolean;
  /** Дымок из труб, пылинки у фонарей, светлячки у зелени. */
  life: boolean;
  /** Плёнка: зерно и виньетка. */
  film: boolean;
  /** Качество снижено само (слабая машина). */
  auto: boolean;
}

export type AtmoToggle = 'on' | 'glow' | 'clouds' | 'shadows' | 'life' | 'film';

const QUALITIES: readonly AtmoQuality[] = ['high', 'medium', 'low'];
const NIGHTS: readonly NightLevel[] = ['bright', 'normal', 'dark'];

/** Эффекты по пресету качества (выбор качества выставляет их; дальше каждый — свой выключатель). */
export function preset(q: AtmoQuality): Pick<AtmoSettings, 'glow' | 'clouds' | 'shadows' | 'life' | 'film'> {
  const P = ATMOSPHERE.presets[q];
  return { glow: P.glow, clouds: P.clouds, shadows: P.shadows, life: P.life, film: P.film };
}

export function defaultAtmo(): AtmoSettings {
  return { on: true, quality: ATMOSPHERE.defaultQuality, night: 'normal', ...preset(ATMOSPHERE.defaultQuality), auto: false };
}

/** Из строки хранилища (JSON); legacy — прежний ключ «вкл/выкл» ('0' — выключено). Битое — по умолчанию. */
export function parseAtmo(raw: string | null, legacy: string | null = null): AtmoSettings {
  const d = defaultAtmo();
  if (!raw) {
    if (legacy === '0') d.on = false;
    return d;
  }
  try {
    const o = JSON.parse(raw) as Partial<AtmoSettings>;
    const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def);
    return {
      on: bool(o.on, d.on),
      quality: QUALITIES.includes(o.quality as AtmoQuality) ? (o.quality as AtmoQuality) : d.quality,
      night: NIGHTS.includes(o.night as NightLevel) ? (o.night as NightLevel) : d.night,
      glow: bool(o.glow, d.glow),
      clouds: bool(o.clouds, d.clouds),
      shadows: bool(o.shadows, d.shadows),
      life: bool(o.life, d.life),
      film: bool(o.film, d.film),
      auto: bool(o.auto, false),
    };
  } catch {
    return d;
  }
}

export function serializeAtmo(s: AtmoSettings): string {
  return JSON.stringify(s);
}

/** Следующее качество по кругу (высокое → среднее → низкое → высокое) — с пресетом эффектов. */
export function cycleQuality(s: AtmoSettings): AtmoSettings {
  const q = QUALITIES[(QUALITIES.indexOf(s.quality) + 1) % QUALITIES.length];
  return { ...s, quality: q, ...preset(q), auto: false };
}

export function cycleNight(s: AtmoSettings): AtmoSettings {
  return { ...s, night: NIGHTS[(NIGHTS.indexOf(s.night) + 1) % NIGHTS.length] };
}

export function toggle(s: AtmoSettings, key: AtmoToggle): AtmoSettings {
  return { ...s, [key]: !s[key], auto: key === 'on' ? false : s.auto };
}

/** Слабая машина: на ступень проще (качество ниже, его пресет); на низком — null (дальше некуда). */
export function simplify(s: AtmoSettings): AtmoSettings | null {
  const i = QUALITIES.indexOf(s.quality);
  if (!s.on || i >= QUALITIES.length - 1) return null;
  const q = QUALITIES[i + 1];
  return { ...s, quality: q, ...preset(q), auto: true };
}

/** Что рисовать на деле: выключатели и качество (карта света — его разрешение). */
export interface AtmoEffective {
  lighting: boolean;
  lightScale: number;
  glow: boolean;
  /** Тёплая дымка вокруг света (на высоком качестве). */
  haze: boolean;
  clouds: boolean;
  sunShadows: boolean;
  pawnShadows: boolean;
  smoke: boolean;
  motes: boolean;
  fireflies: boolean;
  grain: boolean;
  vignette: boolean;
  /** Подъём ночи: доля до белого (+) или затемнение (−). */
  nightLift: number;
}

export function effective(s: AtmoSettings): AtmoEffective {
  const A = ATMOSPHERE;
  const P = A.presets[s.quality];
  const on = s.on;
  return {
    lighting: on,
    lightScale: P.lightScale,
    glow: on && s.glow,
    haze: on && s.glow && P.haze,
    clouds: on && s.clouds,
    sunShadows: s.shadows,
    pawnShadows: on && s.shadows && P.pawnShadows,
    smoke: on && s.life,
    motes: on && s.life,
    fireflies: on && s.life && P.fireflies,
    grain: on && s.film && P.grain,
    vignette: on && s.film,
    nightLift: A.night[s.night],
  };
}
