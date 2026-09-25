import type { Character } from '../entities/Character';
import type { AiContext } from '../ai/AiContext';
import { FACTIONS } from '../config/factions';
import { LINES } from '../config/lines';
import { LOYALTY } from '../config/loyalty';
import { CHAT } from '../config/chat';
import { CpBrain } from '../ai/brains/CpBrain';
import { adjustLoyalty, hasLoyalty, loyaltyTier } from './Loyalty';

const near: Character[] = [];

/** Описание команд для /помощь. */
export const CHAT_HELP: [string, string][] = [
  ['текст', 'сказать вслух (слышат рядом)'],
  ['/me действие', 'действие от третьего лица'],
  ['/r текст', 'рация (ГО, OTA)'],
  ['/roll', 'бросок 1–100'],
  ['/cid', 'ваша CID, статус и лояльность'],
  ['/донос', 'сообщить ГО о подозрительном, кого видите (+лояльность; ложный — минус)'],
  ['/поощрить', 'ГО: поднять лояльность гражданину перед собой'],
  ['/помощь', 'список команд'],
];

/**
 * Чат и команды игрока (логика без DOM: ввод — ui/ChatBox). Речь — реплика над головой и строка
 * журнала; NPC реагируют: горожанин отвечает на приветствие, ГО рядом — на оскорбление (проверка,
 * штраф). Команды — /me, /r, /roll, /cid, /донос, /поощрить, /помощь (и английские синонимы).
 */
export class ChatSystem {
  private lastReport = -1e9;
  private readonly rewarded = new Map<Character, number>();

  constructor(private readonly ctx: AiContext) {}

  private log(text: string, kind: 'system' | 'chat' | 'radio' | 'world' = 'system'): void {
    this.ctx.bus.emit('log', { text, kind });
  }

  submit(p: Character, raw: string): void {
    const text = raw.trim().slice(0, CHAT.maxLength);
    if (!text || !p.alive) return;
    const now = this.ctx.law.now;
    if (!text.startsWith('/')) return this.speak(p, text, now);
    const [cmdRaw, ...restParts] = text.slice(1).split(/\s+/);
    const cmd = cmdRaw.toLowerCase();
    const rest = restParts.join(' ');
    switch (cmd) {
      case 'me':
      case 'я':
        if (!rest) return this.log('Использование: /me действие');
        p.say(`*${rest}*`, now, 4);
        return this.log(`* ${p.name} ${rest}`, 'chat');
      case 'r':
      case 'р':
      case 'рация':
        if (!FACTIONS[p.faction].authority) return this.log('Рации у вас нет — только у ГО и OTA.');
        if (!rest) return this.log('Использование: /r текст');
        return this.log(`${p.name}: ${rest}`, 'radio');
      case 'roll':
      case 'кости': {
        const n = this.ctx.rng.int(1, 100);
        p.say(`🎲 ${n}`, now, 3);
        return this.log(`* ${p.name} бросает кости: ${n}`, 'chat');
      }
      case 'cid':
      case 'сид': {
        const l = p.law;
        const status = l.wanted ? 'в розыске' : l.hasCid ? 'чистая' : 'недействительна';
        const loy = hasLoyalty(p) ? ` · лояльность ${p.loyalty} (${loyaltyTier(p).name})` : '';
        return this.log(`CID #${p.cid}: ${status}${loy}`);
      }
      case 'донос':
      case 'report':
        return this.report(p, now);
      case 'поощрить':
      case 'reward':
        return this.reward(p, now);
      case 'помощь':
      case 'help':
      case '?':
        return this.log('Команды: ' + CHAT_HELP.map(([c, d]) => `${c} — ${d}`).join('; '));
      default:
        return this.log(`Неизвестная команда /${cmd}. Список — /помощь`);
    }
  }

  /** Речь вслух и реакции тех, кто рядом. */
  private speak(p: Character, text: string, now: number): void {
    p.say(text, now, CHAT.bubbleTime);
    this.log(`${p.name}: ${text}`, 'chat');
    const { ctx } = this;
    // Оскорбили ГО — тот, кто рядом и видит, требует документы (штраф за оскорбление).
    if (CHAT.insult.test(text) && !FACTIONS[p.faction].authority && p.law.phase === 'none') {
      for (const o of ctx.entities.near(p.x, p.y, CHAT.hearRange, near)) {
        if (o === p || !(o.brain instanceof CpBrain) || !ctx.law.canSee(o, p)) continue;
        if (o.brain.target || o.brain.guardPost) continue;
        p.law.reason = 'insult';
        o.brain.engage(p, 'insult');
        return;
      }
    }
    // Поздоровались — ближайший прохожий ответит.
    if (CHAT.greeting.test(text)) {
      let best: Character | null = null;
      let bestD: number = CHAT.greetRange;
      for (const o of ctx.entities.near(p.x, p.y, CHAT.greetRange, near)) {
        if (o === p || o.isPlayer || !o.alive || FACTIONS[o.faction].authority) continue;
        const d = Math.hypot(o.x - p.x, o.y - p.y);
        if (d < bestD) {
          bestD = d;
          best = o;
        }
      }
      if (best) {
        const reply = ctx.rng.pick(LINES.citizenGreet);
        best.say(reply, now + 0.6, 3);
        this.log(`${best.name}: ${reply}`, 'chat');
      }
    }
  }

  /** Донос: подозреваемый (повстанец, с оружием, в розыске), которого игрок сейчас видит. */
  private report(p: Character, now: number): void {
    const { ctx } = this;
    if (FACTIONS[p.faction].authority || p.faction === 'rebel') return this.log('Доносы пишут граждане.');
    if (now - this.lastReport < LOYALTY.reportCooldown) return this.log('Вы недавно писали донос — подождите.');
    this.lastReport = now;
    let suspect: Character | null = null;
    let bestD: number = LOYALTY.reportRange;
    for (const o of ctx.entities.near(p.x, p.y, LOYALTY.reportRange, near)) {
      if (o === p || !o.alive || !o.visible || FACTIONS[o.faction].authority || o.law.phase !== 'none') continue;
      if (o.faction !== 'rebel' && !o.weapon && !o.law.wanted) continue;
      const d = Math.hypot(o.x - p.x, o.y - p.y);
      if (d < bestD) {
        bestD = d;
        suspect = o;
      }
    }
    if (!suspect) {
      adjustLoyalty(p, LOYALTY.points.falseReport, 'ложный донос', ctx.bus);
      return this.log('Надзор: донос не подтвердился. Не тратьте время Альянса.', 'radio');
    }
    const zone = ctx.map.zoneAtWorld(suspect.x, suspect.y)?.name ?? 'город';
    adjustLoyalty(p, LOYALTY.points.report, 'донос', ctx.bus);
    this.log(`Надзор: принят донос гражданина #${p.cid} — ${zone}. Патрули направлены.`, 'radio');
    suspect.law.wanted = true;
    if (suspect.faction === 'rebel' || suspect.weapon) ctx.war.raiseAlarm(suspect.x, suspect.y, 'донос о вооружённом');
    else {
      // Ближайший свободный патрульный идёт разбираться.
      let cp: CpBrain | null = null;
      let cpD = Infinity;
      for (const o of ctx.entities.list) {
        if (!(o.brain instanceof CpBrain) || o.brain.target || o.brain.guardPost || o.brain.medicStation || !o.alive) continue;
        const d = Math.hypot(o.x - suspect.x, o.y - suspect.y);
        if (d < cpD) {
          cpD = d;
          cp = o.brain;
        }
      }
      cp?.engage(suspect, 'wanted');
    }
  }

  /** ГО поощряет гражданина перед собой. */
  private reward(p: Character, now: number): void {
    if (p.faction !== 'cp' && p.faction !== 'admin') return this.log('Поощрять может только ГО или Администратор.');
    let best: Character | null = null;
    let bestD: number = CHAT.rewardRange;
    for (const o of this.ctx.entities.near(p.x, p.y, CHAT.rewardRange, near)) {
      if (o === p || !hasLoyalty(o) || !o.alive) continue;
      const d = Math.hypot(o.x - p.x, o.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    if (!best) return this.log('Рядом некого поощрить — подойдите к гражданину.');
    if (now - (this.rewarded.get(best) ?? -1e9) < LOYALTY.rewardCooldown) return this.log(`${best.name} уже поощрён недавно.`);
    this.rewarded.set(best, now);
    adjustLoyalty(best, LOYALTY.points.reward, 'поощрение ГО', this.ctx.bus);
    best.say(this.ctx.rng.pick(LINES.citizenPraised), now, 2.5);
    this.log(`${p.name} поощрил гражданина ${best.name} (лояльность ${best.loyalty}).`, 'world');
  }
}
