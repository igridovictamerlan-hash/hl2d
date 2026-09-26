import type { Character } from '../entities/Character';
import type { AiContext } from '../ai/AiContext';
import { CP_UNITS } from '../config/cpUnits';
import { FACTIONS } from '../config/factions';
import { CpBrain } from '../ai/brains/CpBrain';

/** Сканер Альянса (дрон техника TECH). */
export interface Scanner {
  owner: Character;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  tx: number;
  ty: number;
  until: number;
  nextScan: number;
  flashUntil: number;
  /** Кого и когда уже засёк (не спамить). */
  reported: Map<Character, number>;
}

const near: Character[] = [];

/**
 * Сканеры техников ГО: дрон облетает кварталы вокруг техника (над стенами), засекает повстанцев,
 * вооружённых и разыскиваемых. Повстанец или вооружённый в городе — тревога и «Надзор» знает, где он;
 * разыскиваемого — ближайший свободный патрульный идёт задерживать. Вспышка — «фото».
 */
export class ScannerSystem {
  readonly list: Scanner[] = [];
  private readonly ready = new Map<Character, number>();
  /** Счётчики (тесты, отладка). */
  stats = { deployed: 0, spotted: 0 };

  constructor(private readonly ctx: AiContext) {}

  private get now(): number {
    return this.ctx.law.now;
  }

  /** Свой активный сканер. */
  of(owner: Character): Scanner | null {
    return this.list.find((s) => s.owner === owner) ?? null;
  }

  /** Запустить сканер. Возвращает текст ошибки или null. */
  deploy(owner: Character): string | null {
    const S = CP_UNITS.scanner;
    if (this.of(owner)) return 'Сканер уже в воздухе.';
    const ready = this.ready.get(owner) ?? 0;
    if (this.now < ready) return `Сканер заряжается: ещё ${Math.ceil(ready - this.now)} с.`;
    if (this.ctx.map.levelAt(owner.x, owner.y) !== 'city') return 'Сканеру здесь не взлететь.';
    this.list.push({
      owner, x: owner.x, y: owner.y - 10, prevX: owner.x, prevY: owner.y - 10, tx: owner.x, ty: owner.y,
      until: this.now + S.life, nextScan: 0, flashUntil: 0, reported: new Map(),
    });
    this.ready.set(owner, this.now + S.life + S.cooldown);
    this.stats.deployed++;
    return null;
  }

  private pickWaypoint(s: Scanner): void {
    const { nav, rng, map } = this.ctx;
    const R = CP_UNITS.scanner.roam;
    for (let k = 0; k < 20; k++) {
      const a = rng.pick(nav.walkable);
      const x = nav.worldX(a);
      const y = nav.worldY(a);
      if (Math.hypot(x - s.owner.x, y - s.owner.y) > R || map.levelAt(x, y) !== 'city') continue;
      const kind = map.zoneAtWorld(x, y)?.kind;
      if (kind === 'outlands' || kind === 'wasteland' || kind === 'rebel_camp' || kind === 'nexus') continue;
      s.tx = x;
      s.ty = y;
      return;
    }
    s.tx = s.owner.x;
    s.ty = s.owner.y;
  }

  /** Подозрительный для сканера: повстанец (не в маскировке), напавший, вооружённый житель, в розыске. */
  private suspicious(c: Character): 'rebel' | 'armed' | 'wanted' | null {
    if (!c.alive || FACTIONS[c.faction].authority || c.faction === 'vort' || c.law.phase !== 'none') return null;
    if ((c.faction === 'rebel' && !c.disguised) || c.hostile) return 'rebel';
    if (c.weapon) return 'armed';
    if (c.law.wanted) return 'wanted';
    return null;
  }

  private scan(s: Scanner): void {
    const S = CP_UNITS.scanner;
    const { ctx } = this;
    for (const c of ctx.entities.near(s.x, s.y, S.sight, near)) {
      const kind = this.suspicious(c);
      if (!kind || ctx.map.levelAt(c.x, c.y) !== 'city') continue;
      if (this.now - (s.reported.get(c) ?? -1e9) < S.reportEvery) continue;
      s.reported.set(c, this.now);
      s.flashUntil = this.now + S.flash;
      this.stats.spotted++;
      const zone = ctx.map.zoneAtWorld(c.x, c.y)?.name ?? 'город';
      if (kind === 'rebel' || kind === 'armed') {
        ctx.war.operatives.add(c);
        ctx.war.lastKnown.set(c, { x: c.x, y: c.y });
        ctx.war.raiseAlarm(c.x, c.y, kind === 'rebel' ? 'сканер засёк повстанца' : 'сканер засёк вооружённого');
      } else {
        // Разыскиваемого — ближайший свободный патрульный.
        const cp = ctx.entities.list
          .filter((o) => o.alive && o.brain instanceof CpBrain && o.brain.canGuard)
          .sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y))[0];
        if (cp) (cp.brain as CpBrain).engage(c, 'wanted');
        ctx.bus.emit('log', { text: `Сканер ${s.owner.name}: в розыске — ${c.isPlayer ? 'ВЫ' : c.name}, ${zone}.`, kind: 'radio' });
      }
      if (c.isPlayer) ctx.bus.emit('log', { text: 'Над вами сканер Альянса — вас сфотографировали!', kind: 'law' });
    }
  }

  update(dt: number): void {
    const S = CP_UNITS.scanner;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const s = this.list[i];
      s.prevX = s.x;
      s.prevY = s.y;
      if (!s.owner.alive || this.now >= s.until) {
        if (s.owner.isPlayer && s.owner.alive) this.ctx.bus.emit('log', { text: 'Сканер вернулся на базу (заряд кончился).', kind: 'world' });
        this.list.splice(i, 1);
        continue;
      }
      const d = Math.hypot(s.tx - s.x, s.ty - s.y);
      if (d < 12) this.pickWaypoint(s);
      else {
        const step = Math.min(d, S.speed * dt);
        s.x += ((s.tx - s.x) / d) * step;
        s.y += ((s.ty - s.y) / d) * step;
      }
      if (this.now >= s.nextScan) {
        s.nextScan = this.now + S.scanEvery;
        this.scan(s);
      }
    }
  }
}
