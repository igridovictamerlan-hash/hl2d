import type { Brain } from '../Brain';
import { bark } from '../../systems/Barks';
import type { AiContext } from '../AiContext';
import type { Character } from '../../entities/Character';
import { Mover } from '../Mover';
import { Gunner } from '../Gunner';
import { faceMovement, faceTowards } from '../facing';
import { randomAnchorAround, zoneIds } from '../destinations';
import { canSeeCircle } from '../../world/visibility';
import { COMBAT } from '../../config/combat';
import { WAR } from '../../config/war';
import { CHARACTER } from '../../config/entities';
import { T } from '../../world/tiles';

const nearRebels: Character[] = [];

type Mode = 'gather' | 'raid' | 'assault' | 'infiltrate' | 'retreat' | 'capture' | 'hold';

/**
 * Боец сопротивления из пустошей.
 *  gather — собирается с остальными на пустоши вне видимости постов, ждёт капта (не лезет под огонь);
 *  raid — занимает позицию на пустоши с видом на ворота КПП и перестреливается с часовыми;
 *  assault — идёт на прорыв через коридор КПП в город (стреляет по пути);
 *  infiltrate — прорвался: прячется в кварталах, отстреливается, если нашли;
 *  retreat — ранен или без патронов: уходит вглубь пустоши (исчезает);
 *  capture — идёт капт КПП: занимает позиции в передней части коридора и у внешних ворот;
 *  hold — КПП захвачен: держит пост часового.
 */
export class RebelBrain implements Brain {
  readonly mover: Mover;
  readonly gunner: Gunner;
  mode: Mode = 'raid';
  /** Дошёл до края пустоши при отходе — WarSystem уберёт. */
  departed = false;
  private relocate = 0;
  private goal = -1;
  private suppressIn = 0;
  private suppressLeft = 0;
  private suppressAt: { x: number; y: number } | null = null;
  private repath = 0;
  private holdPost: { x: number; y: number } | null = null;
  /** Капт: доля пути по коридору, сколько ещё держаться в укрытии, фаза перебежки. */
  private advance = 0;
  private coverLeft = 0;
  private shooting = false;
  private phaseLeft = 0;
  /** Медик: кого лечит, перерыв между перевязками, как часто искать раненых. */
  private patient: Character | null = null;
  private healCooldown = 0;
  private medicScan = 0;

  constructor(
    private self: Character,
    private ctx: AiContext,
    readonly front: number,
    /** Когда отряд пойдёт на штурм (Infinity — не пойдёт). */
    private assaultAt: number,
  ) {
    this.mover = new Mover(ctx.rng.range(75, 90));
    this.gunner = new Gunner(ctx.rng);
  }

  get stateName(): string {
    return `${this.mode}${this.gunner.target ? ' · бой' : ''}`;
  }

  /** Пост, который держит (режим hold). */
  get post(): { x: number; y: number } | null {
    return this.mode === 'hold' ? this.holdPost : null;
  }

  orderAssault(): void {
    if (this.mode === 'hold' || this.mode === 'capture') {
      this.mode = 'assault';
      this.goal = -1;
      return;
    }
    if (this.mode === 'gather') this.mode = 'raid';
    if (this.mode === 'raid') this.assaultAt = 0;
  }

  /** Собираться на точке сбора до начала капта. */
  orderGather(): void {
    if (this.mode !== 'raid') return;
    this.mode = 'gather';
    this.goal = -1;
  }

  /** Капт начался: вперёд по коридору перебежками от укрытия к укрытию. */
  orderCapture(): void {
    if (this.mode !== 'raid' && this.mode !== 'assault' && this.mode !== 'gather') return;
    this.mode = 'capture';
    this.goal = -1;
    this.advance = this.ctx.rng.range(0, WAR.capture.advanceStep);
    this.coverLeft = this.ctx.rng.range(WAR.capture.coverWait[0], WAR.capture.coverWait[1]);
    this.shooting = false;
    this.phaseLeft = 0;
  }

  /** Якорь коридора на доле пути t (0 — внешние ворота, 1 — внутренние), по возможности — за блоком. */
  private coverAt(f: NonNullable<AiContext['war']['fronts'][number]>, t: number): number {
    const { ctx } = this;
    const n = f.corridor.length;
    if (n === 0) return ctx.nav.nearestWalkable(f.outerGate.x, f.outerGate.y, 6);
    const k = Math.min(n - 1, Math.floor(t * (n - 1)));
    const lo = Math.max(0, k - 4);
    const hi = Math.min(n - 1, k + 4);
    const covered: number[] = [];
    for (let i = lo; i <= hi; i++) {
      const a = f.corridor[i];
      const ax = ctx.nav.ax(a);
      const ay = ctx.nav.ay(a);
      // Блок рядом со стороны города (откуда стреляют) — укрытие.
      let cover = false;
      for (let dy = -1; dy <= 2 && !cover; dy++) for (let dx = -1; dx <= 2; dx++) if (ctx.map.tileAt(ax + dx, ay + dy) === T.BARRIER) cover = true;
      if (cover) covered.push(a);
    }
    return covered.length ? ctx.rng.pick(covered) : f.corridor[lo + Math.floor(ctx.rng.next() * (hi - lo + 1))];
  }

  /** КПП захвачен: держать пост. */
  orderHold(post: { x: number; y: number }): void {
    if (this.mode === 'retreat' || this.mode === 'infiltrate') return;
    this.mode = 'hold';
    this.holdPost = post;
    this.goal = -1;
  }

  /** Капт отбит / КПП отбит — назад на точку сбора, ждать подхода своих. */
  orderRegroup(): void {
    if (this.mode !== 'capture' && this.mode !== 'hold' && this.mode !== 'raid') return;
    this.mode = 'gather';
    this.goal = -1;
    this.assaultAt = Infinity;
  }

  /**
   * Точка сбора: пустошь в WAR.gatherDist от внешних ворот, не видна ни с одного поста (не лезть
   * под огонь по одному), рядом со своими, но не вплотную.
   */
  private pickGather(f: NonNullable<AiContext['war']['fronts'][number]>): number {
    const { ctx, self } = this;
    let best = -1;
    let bestScore = -Infinity;
    for (let k = 0; k < 40; k++) {
      const a = ctx.rng.pick(f.outlands);
      const x = ctx.nav.worldX(a);
      const y = ctx.nav.worldY(a);
      const d = Math.hypot(x - f.outerGate.x, y - f.outerGate.y);
      let score = ctx.rng.range(0, 2);
      if (d < WAR.gatherDist[0] || d > WAR.gatherDist[1]) score -= 8;
      if (f.posts.some((p) => canSeeCircle(ctx.map, x, y, p.x, p.y, 10))) score -= 20;
      for (const o of f.squad) {
        if (o === self) continue;
        const od = Math.hypot(o.x - x, o.y - y);
        if (od < 30) score -= 4;
        else if (od < 120) score += 1;
      }
      if (score > bestScore) {
        bestScore = score;
        best = a;
      }
    }
    return best;
  }

  infiltrate(): void {
    this.mode = 'infiltrate';
    this.goal = -1;
    this.mover.speed = CHARACTER.runSpeed * 0.8;
  }

  /**
   * Огневая позиция на пустоши: видно пост часового (иначе — хотя бы ворота), пост в пределах
   * дальности своего оружия (арбалетчик держится подальше), завал на линии огня рядом (укрытие),
   * не вплотную к своим.
   */
  private pickPosition(f: NonNullable<AiContext['war']['fronts'][number]>): number {
    const { ctx, self } = this;
    const reach = ctx.combat.reach(self);
    const sniper = self.inventory.has('crossbow');
    let best = -1;
    let bestScore = -Infinity;
    for (let k = 0; k < 40; k++) {
      const a = ctx.rng.pick(f.outlands);
      const x = ctx.nav.worldX(a);
      const y = ctx.nav.worldY(a);
      let score = ctx.rng.range(0, 2);
      let post: { x: number; y: number } | null = null;
      for (const p of f.posts) {
        if (canSeeCircle(ctx.map, x, y, p.x, p.y, 8) && (!post || Math.hypot(p.x - x, p.y - y) < Math.hypot(post.x - x, post.y - y))) post = p;
      }
      if (post) {
        const d = Math.hypot(post.x - x, post.y - y);
        score += 10;
        if (d <= reach * 0.95) score += 6;
        if (sniper) score += Math.min(6, d / 80);
        if (coverOnLine(ctx, x, y, post.x, post.y)) score += 4;
      } else if (canSeeCircle(ctx.map, x, y, f.outerGate.x, f.outerGate.y, 4)) score += 3;
      for (const o of f.squad) {
        if (o !== self && Math.hypot(o.x - x, o.y - y) < 40) score -= 3;
      }
      if (score > bestScore) {
        bestScore = score;
        best = a;
      }
    }
    return best;
  }

  /** Очередь по видимому посту, где стоит часовой (за укрытием — не видно, но известно). */
  private suppress(f: NonNullable<AiContext['war']['fronts'][number]>, dt: number): void {
    const { ctx, self } = this;
    this.suppressIn -= dt;
    if (this.suppressIn > 0) {
      if (this.suppressLeft > 0 && this.suppressAt && ctx.combat.canFire(self)) {
        ctx.combat.fire(self, this.suppressAt.x + ctx.rng.range(-10, 10), this.suppressAt.y + ctx.rng.range(-10, 10));
        this.suppressLeft--;
      }
      return;
    }
    this.suppressIn = ctx.rng.range(WAR.suppressEvery[0], WAR.suppressEvery[1]);
    this.suppressAt = null;
    const reach = ctx.combat.reach(self);
    const manned = ctx.war.guardPosts(f);
    for (const p of manned) {
      if (Math.hypot(p.x - self.x, p.y - self.y) <= reach && canSeeCircle(ctx.map, self.x, self.y, p.x, p.y, 6)) {
        this.suppressAt = p;
        break;
      }
    }
    if (!this.suppressAt) return;
    const best = ctx.combat.bestWeapon(self, Math.hypot(this.suppressAt.x - self.x, this.suppressAt.y - self.y));
    if (best && best !== self.weapon) ctx.combat.equip(self, best);
    self.aiming = true;
    faceTowards(self, this.suppressAt.x, this.suppressAt.y, 1);
    this.suppressLeft = ctx.rng.int(WAR.suppressBurst[0], WAR.suppressBurst[1]);
  }

  /** Медик: найти раненого своего и перевязать. true — занят лечением (движение уже задано). */
  private medic(self: Character, ctx: AiContext, dt: number, fighting: boolean): boolean {
    this.healCooldown -= dt;
    this.medicScan -= dt;
    if (this.medicScan <= 0) {
      this.medicScan = 0.5;
      this.patient = null;
      if (!self.inventory.has('bandage') && !self.inventory.has('medkit')) return false;
      let bestD = 240;
      for (const o of ctx.entities.near(self.x, self.y, bestD, nearRebels)) {
        if (o === self || o.faction !== 'rebel' || !o.alive || o.health >= o.maxHealth * 0.6) continue;
        const d = Math.hypot(o.x - self.x, o.y - self.y);
        if (d < bestD) {
          bestD = d;
          this.patient = o;
        }
      }
    }
    const p = this.patient;
    if (!p || !p.alive || (fighting && this.gunner.target && Math.hypot(p.x - self.x, p.y - self.y) > 60)) return false;
    if (Math.hypot(p.x - self.x, p.y - self.y) > COMBAT.healRange) {
      if (this.repath <= 0 || this.mover.status === 'idle' || this.mover.status === 'arrived') {
        this.repath = 0.8;
        this.mover.speed = CHARACTER.runSpeed * 0.8;
        this.go(ctx.nav.nearestWalkable(p.x, p.y, 3));
      }
      return true;
    }
    this.mover.stop();
    if (this.healCooldown <= 0 && (self.inventory.remove('bandage', 1) || self.inventory.remove('medkit', 1))) {
      ctx.combat.heal(p, COMBAT.healAmount);
      this.healCooldown = COMBAT.healCooldown;
      self.say('Держись, брат, латаю.', ctx.law.now, 1.5);
      if (p.health >= p.maxHealth * 0.6) {
        this.patient = null;
        this.goal = -1;
      }
    }
    return true;
  }

  private go(anchor: number): void {
    if (anchor < 0) return;
    this.goal = anchor;
    this.mover.goTo(this.self, this.ctx, anchor);
  }

  update(self: Character, ctx: AiContext, dt: number): void {
    this.self = self;
    this.ctx = ctx;
    const f = ctx.war.fronts[this.front];
    const outOfAmmo = ctx.combat.maxRange(self) <= 0;
    // В капте раненые не уходят — дерутся до конца (без патронов — уходят).
    const stays = this.mode === 'capture' && !outOfAmmo;
    if (this.mode !== 'infiltrate' && this.mode !== 'retreat' && !stays && (self.health < self.maxHealth * COMBAT.woundedFraction || outOfAmmo)) {
      this.mode = 'retreat';
      this.goal = -1;
    }
    if (this.mode === 'raid' && ctx.combat.now >= this.assaultAt) {
      this.mode = 'assault';
      this.goal = -1;
    }
    const fighting = this.gunner.update(self, ctx, dt);
    this.relocate -= dt;
    this.repath -= dt;
    // Медик: раненый свой рядом — к нему и перевязать (важнее позиции, но не во время перестрелки в упор).
    if (self.profession === 'rebel_medic' && this.mode !== 'retreat' && this.mode !== 'infiltrate' && this.medic(self, ctx, dt, fighting)) {
      this.mover.update(self, ctx, dt);
      if (!this.gunner.look(self, ctx, dt)) faceMovement(self, ctx, dt);
      return;
    }

    switch (this.mode) {
      case 'gather': {
        if (!f) break;
        if (this.goal < 0 || this.mover.status === 'failed') this.go(this.pickGather(f));
        // Заметили — отстреливается с места, но вперёд не лезет.
        if (fighting && this.gunner.target) this.mover.stop();
        else if (this.mover.status === 'idle' && this.goal >= 0 && Math.hypot(ctx.nav.worldX(this.goal) - self.x, ctx.nav.worldY(this.goal) - self.y) > 20) this.go(this.goal);
        else if (this.mover.status === 'arrived') this.mover.stop();
        break;
      }
      case 'raid': {
        if (!f) break;
        // Позиция: пустошь, с видом на внешние ворота.
        if (this.goal < 0 || this.relocate <= 0 || this.mover.status === 'failed') {
          this.relocate = ctx.rng.range(WAR.relocateEvery[0], WAR.relocateEvery[1]);
          const pick = this.pickPosition(f);
          if (pick >= 0) this.go(pick);
        }
        // Часовых не видно — огонь на подавление по постам (перестрелка не затихает).
        if (!this.gunner.target && this.mover.status !== 'moving') this.suppress(f, dt);
        // Стреляя — стоит на месте.
        if (fighting && this.gunner.target) this.mover.stop();
        else if (this.mover.status === 'idle' && this.goal >= 0) this.go(this.goal);
        break;
      }
      case 'assault': {
        if (!f) break;
        if (this.goal < 0 || this.mover.status === 'failed' || this.mover.status === 'arrived') {
          // Цель — за внутренними воротами, в город.
          const beyond = { x: f.apron.x + (f.apron.x - f.outerGate.x) * 0.6, y: f.apron.y + (f.apron.y - f.outerGate.y) * 0.6 };
          this.go(ctx.nav.nearestWalkable(beyond.x, beyond.y, 8));
        }
        // Прорыв: перебежками — стреляет, но не останавливается надолго.
        this.mover.speed = fighting ? 55 : CHARACTER.runSpeed * 0.75;
        break;
      }
      case 'capture': {
        if (!f) break;
        const C = WAR.capture;
        // Цель — укрытие в камере штурмуемой точки на доле пути this.advance; дошли и продержались — дальше.
        const [lo, hi] = ctx.war.captureSpan(f);
        const at = (t: number) => this.coverAt(f, lo + (hi - lo) * t);
        if (this.goal < 0 || this.mover.status === 'failed') this.go(at(this.advance));
        const arrived = this.goal >= 0 && Math.hypot(ctx.nav.worldX(this.goal) - self.x, ctx.nav.worldY(this.goal) - self.y) < 14;
        if (arrived) {
          this.mover.stop();
          this.coverLeft -= dt;
          if (this.coverLeft <= 0 && this.advance < 1) {
            this.advance = Math.min(1, this.advance + C.advanceStep);
            this.coverLeft = ctx.rng.range(C.coverWait[0], C.coverWait[1]);
            this.go(at(this.advance));
          }
          break;
        }
        // Перебежки: под огнём — короткая остановка на очередь, потом рывок к укрытию.
        this.phaseLeft -= dt;
        if (fighting && this.gunner.target) {
          if (this.phaseLeft <= 0) {
            this.shooting = !this.shooting;
            this.phaseLeft = this.shooting ? ctx.rng.range(C.shootStop[0], C.shootStop[1]) : ctx.rng.range(C.dash[0], C.dash[1]);
            if (!this.shooting) bark(self, 'advance', ctx.combat.now, ctx.rng);
          }
        } else this.shooting = false;
        this.mover.speed = CHARACTER.runSpeed * 0.8;
        if (this.shooting) this.mover.stop();
        else if (this.mover.status === 'idle') this.go(this.goal);
        break;
      }
      case 'hold': {
        const p = this.holdPost;
        if (!p) break;
        if (this.goal < 0 || this.mover.status === 'failed') this.go(ctx.nav.nearestWalkable(p.x, p.y, 3));
        if (fighting && this.gunner.target) this.mover.stop();
        else if (this.mover.status === 'idle' && Math.hypot(p.x - self.x, p.y - self.y) > 20) this.go(this.goal);
        break;
      }
      case 'infiltrate': {
        if (fighting && this.gunner.target && self.health > self.maxHealth * 0.5) {
          this.mover.stop();
          this.goal = -1;
          break;
        }
        if (this.goal < 0 || this.mover.status === 'arrived' || this.mover.status === 'failed' || this.mover.status === 'idle') {
          const avoid = zoneIds(ctx, ['nexus', 'cells', 'checkpoint', 'outlands', 'plaza', 'avenue']);
          const g = randomAnchorAround(self, ctx, 12, 45, avoid);
          this.mover.speed = CHARACTER.runSpeed * 0.7;
          this.go(g);
        }
        break;
      }
      case 'retreat': {
        if (!f) {
          this.departed = true;
          break;
        }
        this.mover.speed = CHARACTER.runSpeed * 0.7;
        if (this.goal < 0 || this.mover.status === 'failed') {
          // Самая дальняя от ворот точка пустоши.
          let best = -1;
          let bestD = -1;
          for (const a of f.outlands) {
            const d = Math.hypot(ctx.nav.worldX(a) - f.outerGate.x, ctx.nav.worldY(a) - f.outerGate.y);
            if (d > bestD) {
              bestD = d;
              best = a;
            }
          }
          this.go(best);
        }
        if (this.mover.status === 'arrived') this.departed = true;
        break;
      }
    }
    this.mover.update(self, ctx, dt);
    if (this.gunner.look(self, ctx, dt)) return;
    // На позиции смотрит на КПП (глаз на спине нет — иначе часовых не заметить).
    if ((this.mode === 'raid' || this.mode === 'gather') && f && self.moveSpeed < 8) {
      const post = f.posts[0] ?? f.outerGate;
      faceTowards(self, (post.x + f.outerGate.x) / 2, (post.y + f.outerGate.y) / 2, dt);
    } else faceMovement(self, ctx, dt);
  }
}

/** Есть ли бетонный завал на линии огня в пределах WAR.coverReach от стрелка. */
function coverOnLine(ctx: AiContext, x: number, y: number, tx: number, ty: number): boolean {
  const d = Math.hypot(tx - x, ty - y) || 1;
  const ts = ctx.map.tileSize;
  for (let t = 14; t <= WAR.coverReach; t += 4) {
    const px = x + ((tx - x) / d) * t;
    const py = y + ((ty - y) / d) * t;
    if (ctx.map.tileAt(Math.floor(px / ts), Math.floor(py / ts)) === T.BARRIER) return true;
  }
  return false;
}
