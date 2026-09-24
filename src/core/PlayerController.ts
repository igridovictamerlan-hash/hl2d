import type { Input } from './Input';
import type { Camera } from './Camera';
import type { EventBus } from './EventBus';
import type { Character } from '../entities/Character';
import type { AiContext } from '../ai/AiContext';
import type { CheckChoice } from '../ui/CheckPanel';
import { CHARACTER } from '../config/entities';
import { LAW } from '../config/law';
import { FACTIONS } from '../config/factions';
import { poiWorld } from '../systems/Population';

const near: Character[] = [];

/** Дистанция взаимодействия (E, F), px. */
const REACH = 48;

/**
 * Управление игроком: движение и взгляд, E — терминал найма, F — действие роли
 * (у ГО: проверить документы у того, кто перед вами), 1/2/3 — решение по проверке.
 * Если игрок задержан (у него временно есть мозг PrisonerBrain), ввод движения игнорируется.
 */
export class PlayerController {
  /** Идёт проверка документов, начатая игроком-ГО. */
  private check: { target: Character; until: number } | null = null;

  constructor(
    private readonly input: Input,
    private readonly camera: Camera,
    private readonly bus: EventBus,
    private readonly hooks: {
      openRoleMenu(): void;
      menuOpen(): boolean;
      checkPanelTarget(): Character | null;
      closeCheckPanel(choice: CheckChoice): void;
    },
  ) {}

  reset(): void {
    this.check = null;
  }

  update(p: Character, ctx: AiContext): void {
    const i = this.input;
    const law = p.law;
    const locked = !!p.brain || law.phase === 'checking' || this.hooks.menuOpen();
    if (locked) {
      if (!p.brain) p.wantX = p.wantY = 0;
    } else {
      let mx = (i.isDown('right') ? 1 : 0) - (i.isDown('left') ? 1 : 0);
      let my = (i.isDown('down') ? 1 : 0) - (i.isDown('up') ? 1 : 0);
      const len = Math.hypot(mx, my);
      if (len > 0) {
        mx /= len;
        my /= len;
      }
      const speed = i.isDown('run') ? CHARACTER.runSpeed : CHARACTER.walkSpeed;
      p.wantX = mx * speed;
      p.wantY = my * speed;
      if (i.mouseInside) {
        const m = this.camera.screenToWorld(i.mouseX, i.mouseY);
        p.facing = Math.atan2(m.y - p.y, m.x - p.x);
      } else if (len > 0) p.facing = Math.atan2(my, mx);
    }
    if (this.hooks.menuOpen() || p.brain) return;

    if (i.wasPressed('interact')) {
      const t = poiWorld(ctx, 'recruit_terminal');
      if (t && Math.hypot(t.x - p.x, t.y - p.y) < REACH) this.hooks.openRoleMenu();
      else this.bus.emit('log', { text: 'Рядом нечего использовать. Терминал найма — в углу площади раздачи.', kind: 'system' });
    }
    if (i.wasPressed('roleAction')) this.roleAction(p, ctx);
    if (this.hooks.checkPanelTarget()) {
      if (i.wasPressed('choice1')) this.hooks.closeCheckPanel('release');
      else if (i.wasPressed('choice2')) this.hooks.closeCheckPanel('fine');
      else if (i.wasPressed('choice3')) this.hooks.closeCheckPanel('arrest');
    }
    this.updateCheck(p, ctx);
    // Игрок-ГО догнал беглеца — задержание.
    if (FACTIONS[p.faction].authority) {
      for (const o of ctx.entities.near(p.x, p.y, LAW.catchDistance, near)) {
        if (o !== p && o.law.handler === p && o.law.phase === 'fleeing') ctx.law.arrest(p, o, 'resisting');
      }
    }
  }

  /** F: у ГО — проверка документов у ближайшего, кто перед игроком. */
  private roleAction(p: Character, ctx: AiContext): void {
    if (p.faction !== 'cp') {
      this.bus.emit('log', { text: 'Действие роли (F) пока есть только у ГО: проверка CID.', kind: 'system' });
      return;
    }
    if (this.check || this.hooks.checkPanelTarget()) return;
    let best: Character | null = null;
    let bestScore = Infinity;
    for (const o of ctx.entities.near(p.x, p.y, REACH + 12, near)) {
      if (o === p || FACTIONS[o.faction].authority || o.law.phase !== 'none') continue;
      const d = Math.hypot(o.x - p.x, o.y - p.y);
      let a = Math.atan2(o.y - p.y, o.x - p.x) - p.facing;
      while (a > Math.PI) a -= Math.PI * 2;
      while (a < -Math.PI) a += Math.PI * 2;
      const score = d + Math.abs(a) * 30;
      if (Math.abs(a) < 1.2 && score < bestScore) {
        bestScore = score;
        best = o;
      }
    }
    if (!best) {
      this.bus.emit('log', { text: 'Перед вами некого проверять — подойдите ближе и посмотрите на человека.', kind: 'system' });
      return;
    }
    ctx.law.order(p, best, 'routine');
    if (best.law.phase === 'fleeing') {
      this.bus.emit('log', { text: `${best.name} убегает! Догоните, чтобы задержать.`, kind: 'law' });
      return;
    }
    ctx.law.beginCheck(p, best);
    this.check = { target: best, until: ctx.law.now + LAW.checkTime };
  }

  private updateCheck(p: Character, ctx: AiContext): void {
    const c = this.check;
    if (!c) return;
    if (c.target.law.handler !== p || c.target.law.phase !== 'checking') {
      this.check = null;
      return;
    }
    if (ctx.law.now < c.until) return;
    this.check = null;
    this.bus.emit('law:checkResult', { target: c.target, verdict: ctx.law.judge(c.target) });
  }

  /** Решение игрока-ГО по проверке. */
  resolve(p: Character, target: Character, choice: CheckChoice, ctx: AiContext): void {
    if (target.law.handler !== p) return;
    const verdict = ctx.law.judge(target);
    if (choice === 'arrest') ctx.law.apply(p, target, { kind: 'arrest', reason: verdict.reason, fine: 0 });
    else if (choice === 'fine') ctx.law.apply(p, target, { kind: 'fine', reason: verdict.reason, fine: verdict.fine || LAW.fines.running });
    else ctx.law.apply(p, target, { kind: 'ok', reason: verdict.reason, fine: 0 });
    if (choice === 'arrest') this.bus.emit('log', { text: 'Отведите задержанного к свободной камере КПЗ в Нексусе — он идёт за вами.', kind: 'system' });
  }
}
