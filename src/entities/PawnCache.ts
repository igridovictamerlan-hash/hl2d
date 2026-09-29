import { PAWN } from '../config/pawns';
import { drawPawn, type PawnDir, type PawnLook } from './PawnRenderer';
import { LruCache, scaleLevel } from '../core/spriteCache';

/**
 * Кэш спрайтов пешек. Пешка — десятки кривых, заливок и клипов; в бою у КПП на экране десятки
 * пешек и тел, и векторная отрисовка каждой каждый кадр съедает кадр. Внешность неизменна
 * (фракция, ранг, зерно, профессия, сторона), поэтому пешка рисуется один раз в холст и дальше
 * копируется drawImage. Масштаб — по уровням (PAWN.cache.perOctave на удвоение, core/spriteCache),
 * отличие от точного — уменьшением при копировании; при переполнении уходят самые давние.
 */
const cache = new LruCache<HTMLCanvasElement>(PAWN.cache.max);

export function drawPawnCached(ctx: CanvasRenderingContext2D, look: PawnLook, x: number, y: number, s: number, dir: PawnDir): void {
  const C = PAWN.cache;
  const q = scaleLevel(s, C.perOctave);
  const key = `${look.faction}|${look.rank}|${look.color}|${look.seed}|${look.profession ?? ''}|${look.kin ?? ''}|${look.band ?? ''}|${look.helmet ?? ''}|${look.vest ?? ''}|${dir}|${q}`;
  let sprite = cache.get(key);
  if (!sprite) {
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
