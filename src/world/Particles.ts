import type { View } from '../core/Camera';
import type { Character } from '../entities/Character';
import type { CombatSystem, Fx } from '../systems/CombatSystem';
import type { WeaponClass } from '../config/items';
import { Rng } from '../core/rng';
import { RENDER } from '../config/render';
import { GRENADE } from '../config/combat';
import { SUPPRESS } from '../config/tactics';

/** Виды частиц (индекс — порядок отрисовки). */
const enum K {
  Dust,
  Smoke,
  DarkSmoke,
  BloodMist,
  Blood,
  Debris,
  Fire,
  FireCore,
  Ember,
  Spark,
  Energy,
  Flash,
  Muzzle,
}
const KINDS = 13;

const P = RENDER.particles;
const COLOR: string[] = [
  P.colors.dust, P.colors.smoke, P.colors.darkSmoke, P.colors.bloodMist, P.colors.blood, P.colors.debris,
  P.colors.fire, P.colors.fireCore, P.colors.ember, P.colors.spark, P.colors.energy, P.colors.flash, P.colors.muzzle,
];
/** Прозрачность в начале жизни (дальше — к нулю). */
const ALPHA = [0.35, 0.55, 0.65, 0.45, 0.95, 1, 0.85, 0.95, 1, 1, 1, 0.9, 1];
/** Рисовать чёрточкой по скорости (искры) или кружком. */
const STREAK = [false, false, false, false, false, false, false, false, true, true, true, false, false];

/**
 * Частицы боя (только отрисовка, у логики их нет): читают новые эффекты боя (CombatSystem.fx) и
 * рождают вспышки у ствола, кровь, искры, пыль, огонь, дым, осколки; ударные волны взрывов.
 * Массивы фиксированного размера — без сборки мусора; отрисовка без save/restore и градиентов.
 * Случайность — своя (к игровой логике отношения не имеет). Плюс тряска экрана и маркер попадания.
 */
export class Particles {
  private readonly n = P.max;
  private count = 0;
  private readonly x = new Float32Array(this.n);
  private readonly y = new Float32Array(this.n);
  private readonly vx = new Float32Array(this.n);
  private readonly vy = new Float32Array(this.n);
  private readonly life = new Float32Array(this.n);
  private readonly max = new Float32Array(this.n);
  private readonly size = new Float32Array(this.n);
  private readonly grow = new Float32Array(this.n);
  private readonly drag = new Float32Array(this.n);
  private readonly ang = new Float32Array(this.n);
  private readonly kind = new Uint8Array(this.n);
  private readonly rings: { x: number; y: number; t: number; life: number; r: number }[] = [];
  private readonly lights: { x: number; y: number; t: number; life: number; r: number }[] = [];
  private readonly rng = new Rng(0x5eed);
  private seq = 0;
  /** Тряска экрана (px экрана), вспышка ранения 0..1, маркер попадания. */
  shake = 0;
  hurt = 0;
  marker = 0;
  markerKill = false;

  /** Забрать новые эффекты боя и продвинуть частицы на dt (реальное время кадра). */
  update(combat: CombatSystem, player: Character, dt: number): void {
    if (this.seq > combat.fxSeq) this.seq = 0;
    for (const f of combat.fx) {
      if (f.seq <= this.seq) continue;
      this.spawn(f, player);
    }
    this.seq = combat.fxSeq;
    const d = Math.min(dt, 0.05);
    let w = 0;
    for (let i = 0; i < this.count; i++) {
      const life = this.life[i] - d;
      if (life <= 0) continue;
      const k = Math.max(0, 1 - this.drag[i] * d);
      this.life[w] = life;
      this.vx[w] = this.vx[i] * k;
      this.vy[w] = this.vy[i] * k;
      this.x[w] = this.x[i] + this.vx[w] * d;
      this.y[w] = this.y[i] + this.vy[w] * d;
      this.max[w] = this.max[i];
      this.size[w] = this.size[i] + this.grow[i] * d;
      this.grow[w] = this.grow[i];
      this.drag[w] = this.drag[i];
      this.ang[w] = this.ang[i];
      this.kind[w] = this.kind[i];
      w++;
    }
    this.count = w;
    for (let i = this.rings.length - 1; i >= 0; i--) if ((this.rings[i].t += d) >= this.rings[i].life) this.rings.splice(i, 1);
    for (let i = this.lights.length - 1; i >= 0; i--) if ((this.lights[i].t += d) >= this.lights[i].life) this.lights.splice(i, 1);
    const fade = Math.exp(-P.decay * d);
    this.shake *= fade;
    this.hurt *= Math.exp(-4 * d);
    this.marker = Math.max(0, this.marker - d);
  }

  private add(kind: K, x: number, y: number, vx: number, vy: number, life: number, size: number, grow = 0, drag = 0, ang = 0): void {
    let i = this.count;
    if (i >= this.n) {
      // Места нет — заменяем случайную (старые и так скоро погаснут).
      i = Math.floor(this.rng.next() * this.n);
    } else this.count++;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.life[i] = life;
    this.max[i] = life;
    this.size[i] = size;
    this.grow[i] = grow;
    this.drag[i] = drag;
    this.ang[i] = ang;
    this.kind[i] = kind;
  }

  /** Веер частиц вокруг направления ang (± spread рад). */
  private fan(kind: K, n: number, x: number, y: number, ang: number, spread: number, speed: [number, number], life: [number, number], size: [number, number], grow = 0, drag = 0): void {
    const r = this.rng;
    for (let k = 0; k < n; k++) {
      const a = ang + r.range(-spread, spread);
      const v = r.range(speed[0], speed[1]);
      this.add(kind, x, y, Math.cos(a) * v, Math.sin(a) * v, r.range(life[0], life[1]), r.range(size[0], size[1]), grow, drag, a);
    }
  }

  private addShake(v: number): void {
    this.shake = Math.min(P.maxShake, this.shake + v);
  }

  private spawn(f: Fx, player: Character): void {
    const r = this.rng;
    const fromPlayer = f.by === player;
    switch (f.kind) {
      case 'muzzle': {
        const cls = f.cls as WeaponClass;
        const sz = P.muzzleSize[cls] ?? 5;
        if (sz > 0) {
          this.add(K.Muzzle, f.x, f.y, 0, 0, 0.05, sz, 0, 0, f.ang);
          this.add(K.Flash, f.x, f.y, 0, 0, 0.06, sz * 0.9);
          this.add(cls === 'pulse' ? K.Energy : K.Spark, f.x, f.y, Math.cos(f.ang) * 260, Math.sin(f.ang) * 260, 0.06, 1, 0, 6, f.ang);
          this.fan(K.Smoke, cls === 'shotgun' || cls === 'sniper' || cls === 'launcher' ? 4 : 1, f.x, f.y, f.ang, 0.5, [15, 45], [0.4, 0.9], [2, 3.5], 9, 3);
          if (cls === 'launcher') this.fan(K.DarkSmoke, 8, f.x, f.y, f.ang + Math.PI, 0.6, [60, 160], [0.6, 1.2], [4, 7], 14, 3);
        }
        if (fromPlayer) this.addShake(f.power * P.shot);
        break;
      }
      case 'hit': {
        const lethal = f.lethal;
        const n = lethal ? 16 : f.zone === 'head' ? 12 : 8;
        // Кровь летит дальше по ходу пули, облачко — на месте.
        this.fan(K.Blood, n, f.x, f.y, f.ang, 0.55, [50, 200], [0.25, 0.6], [0.9, 2], 0, 7);
        this.fan(K.BloodMist, lethal ? 3 : 1, f.x, f.y, f.ang, 0.4, [10, 40], [0.25, 0.45], [3, 5], 14, 4);
        if (f.cls === 'pulse') this.fan(K.Energy, 5, f.x, f.y, f.ang + Math.PI, 1.1, [80, 220], [0.1, 0.25], [1, 1], 0, 5);
        if (fromPlayer) {
          this.marker = P.markerTime;
          this.markerKill = lethal || !(f.target?.alive ?? true);
        }
        if (f.target === player) {
          this.addShake(P.hurt + f.power * P.hurtPerDamage);
          this.hurt = Math.min(1, this.hurt + 0.35 + f.power * 0.01);
        }
        break;
      }
      case 'stab': {
        const blade = f.cls === 'blade';
        if (blade) {
          this.fan(K.Blood, f.lethal ? 14 : 9, f.x, f.y, f.ang + Math.PI / 2, 0.8, [40, 150], [0.3, 0.6], [1, 2], 0, 7);
          this.fan(K.BloodMist, 1, f.x, f.y, f.ang, 0.3, [10, 30], [0.3, 0.5], [3, 5], 12, 4);
        } else this.fan(K.Energy, 7, f.x, f.y, f.ang + Math.PI, 1.3, [60, 180], [0.1, 0.25], [1, 1], 0, 5);
        if (fromPlayer) {
          this.addShake(blade ? 2.5 : 1.5);
          this.marker = P.markerTime;
          this.markerKill = !(f.target?.alive ?? true);
        }
        if (f.target === player) {
          this.addShake(P.hurt + f.power * P.hurtPerDamage);
          this.hurt = Math.min(1, this.hurt + 0.4);
        }
        break;
      }
      case 'wall': {
        const back = f.ang + Math.PI;
        const barrier = f.power > 0;
        if (f.cls === 'pulse') this.fan(K.Energy, 7, f.x, f.y, back, 1.2, [80, 260], [0.08, 0.22], [1, 1], 0, 5);
        else this.fan(K.Spark, r.int(3, 6), f.x, f.y, back, 1.1, [120, 380], [0.06, 0.18], [1, 1], 0, 6);
        this.fan(K.Dust, barrier ? 3 : 2, f.x, f.y, back, 0.8, [10, 50], [0.4, 0.9], [2, 3.5], 10, 3);
        this.fan(K.Debris, barrier ? 4 : 2, f.x, f.y, back, 1, [40, 140], [0.2, 0.45], [0.8, 1.4], 0, 6);
        break;
      }
      case 'blast': {
        const R = f.power;
        const big = f.cls === 'launcher' ? 1.25 : 1;
        this.add(K.Flash, f.x, f.y, 0, 0, 0.14, R * 0.75 * big);
        this.fan(K.FireCore, 8, f.x, f.y, 0, Math.PI, [20, 90], [0.15, 0.3], [R * 0.12, R * 0.2], R * 0.4, 5);
        this.fan(K.Fire, 14, f.x, f.y, 0, Math.PI, [40, 160], [0.25, 0.5], [R * 0.1, R * 0.18], R * 0.35, 4);
        this.fan(K.DarkSmoke, 10, f.x, f.y, 0, Math.PI, [20, 90], [1.6, 3], [R * 0.12, R * 0.2], R * 0.18, 1.6);
        this.fan(K.Smoke, 12, f.x, f.y, 0, Math.PI, [30, 120], [2.2, 4], [R * 0.1, R * 0.16], R * 0.14, 1.4);
        this.fan(K.Debris, 26, f.x, f.y, 0, Math.PI, [160, 520], [0.35, 0.8], [1, 2.2], 0, 3);
        this.fan(K.Spark, GRENADE.frags, f.x, f.y, 0, Math.PI, [300, 700], [0.12, 0.3], [1, 1], 0, 3);
        this.fan(K.Ember, 10, f.x, f.y, 0, Math.PI, [40, 160], [0.6, 1.4], [1, 1.6], 0, 2);
        this.rings.push({ x: f.x, y: f.y, t: 0, life: 0.35, r: R * 1.7 * big });
        this.lights.push({ x: f.x, y: f.y, t: 0, life: 0.45, r: R * 2.2 * big });
        const d = Math.hypot(f.x - player.x, f.y - player.y);
        if (d < GRENADE.shakeRange * 1.5) this.addShake(P.maxShake * (1 - d / (GRENADE.shakeRange * 1.5)) * big);
        break;
      }
      case 'fire': {
        const R = f.power;
        this.add(K.Flash, f.x, f.y, 0, 0, 0.12, R * 0.6);
        this.fan(K.Fire, 18, f.x, f.y, 0, Math.PI, [30, 120], [0.4, 0.9], [R * 0.1, R * 0.18], R * 0.2, 3);
        this.fan(K.Ember, 16, f.x, f.y, 0, Math.PI, [40, 180], [0.6, 1.6], [1, 1.6], 0, 2);
        this.fan(K.DarkSmoke, 6, f.x, f.y, 0, Math.PI, [10, 50], [1.5, 2.6], [R * 0.1, R * 0.15], R * 0.15, 1.5);
        this.lights.push({ x: f.x, y: f.y, t: 0, life: 0.5, r: R * 2 });
        break;
      }
      case 'smoke':
        this.fan(K.Smoke, 10, f.x, f.y, 0, Math.PI, [40, 140], [0.8, 1.6], [6, 10], 16, 3);
        break;
      case 'whiz':
        // Пуля над ухом — лёгкая дрожь.
        if (f.target === player) this.addShake(SUPPRESS.shake * f.power);
        break;
      case 'rocket':
        this.add(K.DarkSmoke, f.x, f.y, r.range(-10, 10), r.range(-10, 10), r.range(0.7, 1.2), 3, 9, 2);
        this.add(K.Fire, f.x - Math.cos(f.ang) * 4, f.y - Math.sin(f.ang) * 4, 0, 0, 0.08, 3.2, -10, 0);
        break;
      default:
        break;
    }
  }

  /** Частицы и ударные волны (до тумана). */
  draw(ctx: CanvasRenderingContext2D, v: View): void {
    const s = v.scale;
    const L = v.left;
    const T = v.top;
    const W = v.width / s;
    const H = v.height / s;
    for (let kind = 0; kind < KINDS; kind++) {
      const color = COLOR[kind];
      const streak = STREAK[kind];
      if (streak) {
        ctx.strokeStyle = color;
        ctx.lineCap = 'round';
      } else ctx.fillStyle = color;
      for (let i = 0; i < this.count; i++) {
        if (this.kind[i] !== kind) continue;
        const x = this.x[i];
        const y = this.y[i];
        if (x < L - 40 || y < T - 40 || x > L + W + 40 || y > T + H + 40) continue;
        const k = this.life[i] / this.max[i];
        ctx.globalAlpha = ALPHA[kind] * k;
        const sx = (x - L) * s;
        const sy = (y - T) * s;
        if (streak) {
          const len = 0.028;
          ctx.lineWidth = Math.max(1, this.size[i] * s);
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx - this.vx[i] * len * s, sy - this.vy[i] * len * s);
          ctx.stroke();
        } else if (kind === K.Muzzle) {
          // Язык пламени у ствола: вытянутый ромб по направлению выстрела.
          const a = this.ang[i];
          const len = this.size[i] * s * 1.6;
          const wd = this.size[i] * s * 0.45;
          const cs = Math.cos(a);
          const sn = Math.sin(a);
          ctx.beginPath();
          ctx.moveTo(sx - cs * wd * 0.5, sy - sn * wd * 0.5);
          ctx.lineTo(sx + cs * len * 0.45 - sn * wd, sy + sn * len * 0.45 + cs * wd);
          ctx.lineTo(sx + cs * len, sy + sn * len);
          ctx.lineTo(sx + cs * len * 0.45 + sn * wd, sy + sn * len * 0.45 - cs * wd);
          ctx.closePath();
          ctx.fill();
        } else if (kind === K.Debris) {
          const z = Math.max(1, this.size[i] * s);
          ctx.fillRect(sx - z / 2, sy - z / 2, z, z);
        } else {
          ctx.beginPath();
          ctx.arc(sx, sy, Math.max(0.6, this.size[i] * s), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    // Ударные волны — расширяющиеся кольца.
    ctx.strokeStyle = P.colors.ring;
    for (const g of this.rings) {
      const k = g.t / g.life;
      ctx.globalAlpha = 0.55 * (1 - k);
      ctx.lineWidth = Math.max(1, (4 - 3 * k) * s);
      ctx.beginPath();
      ctx.arc((g.x - L) * s, (g.y - T) * s, g.r * Math.sqrt(k) * s, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /** Поверх тумана: отсвет взрывов и дымовые завесы (облако видно и снаружи). */
  drawOver(ctx: CanvasRenderingContext2D, v: View, combat: CombatSystem): void {
    const s = v.scale;
    ctx.fillStyle = `rgb(${P.light})`;
    for (const g of this.lights) {
      const k = g.t / g.life;
      ctx.globalAlpha = 0.18 * (1 - k);
      ctx.beginPath();
      ctx.arc((g.x - v.left) * s, (g.y - v.top) * s, g.r * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.25 * (1 - k);
      ctx.beginPath();
      ctx.arc((g.x - v.left) * s, (g.y - v.top) * s, g.r * 0.45 * s, 0, Math.PI * 2);
      ctx.fill();
    }
    // Дым: клубы по кругу облака, медленно дрейфуют; растёт за grow с, тает в последние 3 с.
    const now = combat.now;
    const S = GRENADE.smoke;
    ctx.fillStyle = `rgb(${P.smokeCloud})`;
    for (const c of combat.smokes) {
      const age = now - c.born;
      const grow = Math.min(1, age / S.grow);
      const fade = Math.min(1, (c.until - now) / 3);
      const x0 = (c.x - v.left) * s;
      const y0 = (c.y - v.top) * s;
      if (x0 < -c.r * 2 * s || y0 < -c.r * 2 * s || x0 > v.width + c.r * 2 * s || y0 > v.height + c.r * 2 * s) continue;
      for (let k = 0; k < P.smokePuffs; k++) {
        const a = k * 2.399 + age * 0.08 * (k % 2 ? 1 : -1);
        const d = c.r * grow * (0.15 + 0.7 * ((k * 37) % 100) / 100);
        const rr = c.r * grow * (0.38 + 0.2 * ((k * 53) % 100) / 100);
        ctx.globalAlpha = 0.55 * fade;
        ctx.beginPath();
        ctx.arc(x0 + Math.cos(a) * d * s, y0 + Math.sin(a) * d * s, rr * s, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Вспышка ранения и маркер попадания у прицела (экранные координаты). */
  drawHud(ctx: CanvasRenderingContext2D, v: View, mx: number | null, my: number | null, dpr: number): void {
    if (this.hurt > 0.02) {
      ctx.fillStyle = `rgba(${P.hurtFlash},${(this.hurt * 0.28).toFixed(3)})`;
      ctx.fillRect(0, 0, v.width, v.height);
    }
    if (this.marker > 0 && mx !== null && my !== null) {
      const k = this.marker / P.markerTime;
      const a = 4 * dpr;
      const b = (9 + 3 * (1 - k)) * dpr;
      ctx.strokeStyle = this.markerKill ? P.markerKill : P.marker;
      ctx.globalAlpha = Math.min(1, k * 1.5);
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      for (const [sx, sy] of DIAG) {
        ctx.moveTo(mx + sx * a, my + sy * a);
        ctx.lineTo(mx + sx * b, my + sy * b);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
}

const DIAG: readonly [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
