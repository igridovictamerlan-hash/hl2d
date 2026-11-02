/** Описание системы — docs/rendering.md («Окна и тени»). */
import { LIGHTING, type Rgb } from '../config/lighting';

/** Высота тайла в MapRenderer.heights — этажи × HEIGHT_UNIT (Uint8: до ~8 этажей). */
export const HEIGHT_UNIT = 32;

/** Доля светового дня 0..1 (0 — восход, 1 — закат) в долю суток f; ночью — null. */
export function sunPhase(f: number): number | null {
  const S = LIGHTING.sun;
  if (f <= S.rise || f >= S.set) return null;
  return (f - S.rise) / (S.set - S.rise);
}

/**
 * Смещение тени одного этажа (px мира) в фазе дня p: солнце встаёт на востоке, в полдень на юге, садится на
 * западе — тень утром на запад, в полдень на север, вечером на восток; чем ниже солнце, тем длиннее (до lenMax).
 */
export function sunOffset(p: number): { dx: number; dy: number } {
  const S = LIGHTING.sun;
  const th = Math.PI * Math.min(1, Math.max(0, p));
  const len = S.storey * Math.min(S.lenMax, S.lenNoon / Math.max(1e-3, Math.sin(th)));
  return { dx: -Math.cos(th) * len, dy: -Math.sin(th) * len };
}

/** Прозрачность теней в долю суток f: ночью 0, у восхода и заката бледнеют. */
export function sunAlpha(f: number): number {
  const S = LIGHTING.sun;
  if (sunPhase(f) === null) return 0;
  return S.alpha * Math.min(1, (f - S.rise) / S.fade, (S.set - f) / S.fade);
}

/** Цвет тени в фазе дня p: в полдень — холодная синяя (свет неба), у горизонта — сиреневая (LIGHTING.sun). */
export function sunTint(p: number): Rgb {
  const S = LIGHTING.sun;
  const h = Math.sin(Math.PI * Math.min(1, Math.max(0, p)));
  const t = Math.min(1, h / 0.7);
  return [0, 1, 2].map((k) => Math.round(S.low[k] + (S.noon[k] - S.low[k]) * t)) as unknown as Rgb;
}
