/**
 * Общее для кэшей спрайтов (пешки, мебель, оружие): уровень масштаба и вытеснение самых давних.
 *
 * Уровень — ближайший не меньший из ряда 2^(k / perOctave): спрайт рисуется чуть крупнее и
 * уменьшается при копировании. Мелкий шаг (1/16) при плавном отъезде камеры (прицел, V) давал
 * новый уровень каждые несколько кадров — и перерисовку всех пешек на экране; по уровням ряда
 * отъезд камеры проходит 1–2 уровня.
 */
export function scaleLevel(s: number, perOctave: number): number {
  const k = Math.ceil(Math.log2(Math.max(1e-3, s)) * perOctave - 1e-6);
  return Math.pow(2, k / perOctave);
}

/**
 * Кэш с вытеснением самых давно использованных (порядок вставки Map). Переполнение не сбрасывает
 * кэш целиком — иначе на следующем кадре перерисовывается всё видимое разом (рывок).
 */
export class LruCache<V> {
  private readonly map = new Map<string, V>();

  constructor(private readonly max: number) {}

  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }

  set(key: string, v: V): void {
    this.map.set(key, v);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string);
  }

  get size(): number {
    return this.map.size;
  }
}
