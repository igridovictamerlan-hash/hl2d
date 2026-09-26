import { PAWN } from '../config/pawns';
import { drawPawn, type PawnDir, type PawnLook } from './PawnRenderer';

/**
 * Кэш спрайтов пешек. Пешка — десятки кривых, заливок и клипов; в бою у КПП на экране десятки
 * пешек и тел, и векторная отрисовка каждой каждый кадр съедает кадр. Внешность неизменна
 * (фракция, ранг, зерно, профессия, сторона), поэтому пешка рисуется один раз в холст и дальше
 * копируется drawImage. Масштаб квантуется (PAWN.cache.step), отличие от точного — растяжением
 * при копировании; при переполнении кэш сбрасывается.
 */
const cache = new Map<string, HTMLCanvasElement>();

export function drawPawnCached(ctx: CanvasRenderingContext2D, look: PawnLook, x: number, y: number, s: number, dir: PawnDir): void {
  const C = PAWN.cache;
  const q = Math.max(C.step, Math.round(s / C.step) * C.step);
  const key = `${look.faction}|${look.rank}|${look.color}|${look.seed}|${look.profession ?? ''}|${dir}|${q}`;
  let sprite = cache.get(key);
  if (!sprite) {
    if (cache.size >= C.max) cache.clear();
    sprite = document.createElement('canvas');
    sprite.width = Math.ceil((C.left + C.right) * q);
    sprite.height = Math.ceil((C.top + C.bottom) * q);
    const g = sprite.getContext('2d')!;
    drawPawn(g, look, C.left * q, C.top * q, q, dir);
    cache.set(key, sprite);
  }
  const k = s / q;
  ctx.drawImage(sprite, x - C.left * s, y - C.top * s, sprite.width * k, sprite.height * k);
}
