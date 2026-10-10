import { WEAPON_SPRITES, WEAPON_POSE, type SpritePart } from '../config/weaponSprites';
import type { ItemId, WeaponId } from '../config/items';

/**
 * Иконки интерфейса (инвентарь, колесо оружия, HUD): рисунки в духе Innawoods/RimWorld — плоские
 * заливки в 2–3 тона и толстый тёмный контур. Каждая рисуется в квадрате 64×64 с центром в (0, 0);
 * drawIcon масштабирует. Цвета — часть рисунка (как модели стволов в config/weaponSprites).
 * Стволы — те же модели, что в руках у пешек (drawGunIcon).
 */
type C2 = CanvasRenderingContext2D;
type Icon = (c: C2) => void;
const OUT = '#1b1710';
const TAU = Math.PI * 2;

function shp(ctx: C2, fill: string, build: () => void, lw = 3, out = OUT): void {
  ctx.beginPath();
  build();
  ctx.fillStyle = fill;
  ctx.fill();
  if (lw > 0) {
    ctx.lineWidth = lw;
    ctx.strokeStyle = out;
    ctx.stroke();
  }
}
function fl(ctx: C2, fill: string, build: () => void): void {
  ctx.beginPath();
  build();
  ctx.fillStyle = fill;
  ctx.fill();
}
function ln(ctx: C2, pts: [number, number][], w: number, col: string): void {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.lineWidth = w;
  ctx.strokeStyle = col;
  ctx.stroke();
}
function txt(ctx: C2, s: string, x: number, y: number, size: number, col: string, align: CanvasTextAlign = 'left', weight = 600): void {
  ctx.font = `${weight} ${size}px "Segoe UI",Arial,sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = col;
  ctx.fillText(s, x, y);
}
function rrect(ctx: C2, x: number, y: number, w: number, h: number, r: number, fill: string | null, stroke: string | null, lw = 1): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.lineWidth = lw;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

const I: Record<string, Icon> = {};
I.ration = (c) => {
  shp(c, '#7c93a6', () => { c.moveTo(-17, -20); c.lineTo(17, -20); c.lineTo(20, 22); c.quadraticCurveTo(0, 26, -20, 22); c.closePath(); });
  fl(c, '#9fb3c3', () => c.rect(-15, -18, 8, 36));
  shp(c, '#5d7285', () => c.rect(-19, -25, 38, 7), 3);
  for (let i = -15; i < 16; i += 5) ln(c, [[i, -24], [i + 2, -19]], 1.2, '#3d4d5b');
  shp(c, '#e9eef2', () => c.arc(0, 3, 9, 0, TAU), 2.5);
  c.beginPath(); c.arc(0, 3, 5, 0.6, TAU - 0.6); c.lineWidth = 2.6; c.strokeStyle = '#3d4d5b'; c.stroke();
  fl(c, '#3d4d5b', () => c.rect(3, 1.8, 7, 2.4));
};
I.bread = (c) => {
  shp(c, '#b7773a', () => c.ellipse(0, 4, 25, 15, -0.15, 0, TAU));
  fl(c, '#d59a55', () => c.ellipse(-2, 0, 20, 9, -0.15, 0, TAU));
  for (const x of [-11, -2, 7]) ln(c, [[x - 4, -5], [x + 4, 7]], 2.4, '#7a4a1e');
};
I.water = (c) => {
  shp(c, '#3f6fb0', () => c.roundRect(-14, -22, 28, 46, 4));
  fl(c, '#6e97cf', () => c.rect(-11, -20, 6, 42));
  shp(c, '#e8e8e8', () => c.rect(-14, -6, 28, 14), 2.5);
  txt(c, 'B', 0, 1.5, 12, '#2c4f86', 'center', 900);
  shp(c, '#c4c8cc', () => c.ellipse(0, -22, 14, 4, 0, 0, TAU), 2.5);
  fl(c, '#8a9096', () => c.ellipse(4, -22, 4, 1.4, 0, 0, TAU));
};
I.canned = (c) => {
  shp(c, '#b9bfc5', () => c.rect(-18, -16, 36, 34));
  for (const y of [-10, -4, 12]) ln(c, [[-17, y], [17, y]], 1.2, '#7c8388');
  shp(c, '#b23b2b', () => c.rect(-18, -1, 36, 11), 2.5);
  fl(c, '#e2c060', () => c.rect(-6, 2, 12, 5));
  shp(c, '#d6dade', () => c.ellipse(0, -16, 18, 5, 0, 0, TAU), 2.5);
  c.beginPath(); c.ellipse(0, -16, 12, 3, 0, 0, TAU); c.lineWidth = 1.2; c.strokeStyle = '#7c8388'; c.stroke();
  shp(c, '#9aa0a6', () => c.ellipse(0, 18, 18, 5, 0, 0, Math.PI), 2.5);
};
I.medkit = (c) => {
  shp(c, '#2b2d31', () => c.roundRect(-8, -24, 16, 8, 3), 2.5);
  shp(c, '#e7e2d5', () => c.roundRect(-24, -18, 48, 38, 5));
  fl(c, '#c8c1b0', () => c.rect(-21, 12, 42, 5));
  shp(c, '#c8322a', () => { c.rect(-5, -12, 10, 26); c.rect(-13, -4, 26, 10); }, 0);
  fl(c, '#c8322a', () => { c.rect(-5, -12, 10, 26); c.rect(-13, -4, 26, 10); });
};
I.bandage = (c) => {
  shp(c, '#ece6d6', () => { c.moveTo(4, 8); c.lineTo(26, 18); c.lineTo(22, 26); c.lineTo(-2, 16); c.closePath(); });
  ln(c, [[8, 13], [23, 20]], 1.2, '#b9b09a');
  shp(c, '#f3eee2', () => c.arc(-5, -3, 19, 0, TAU));
  c.beginPath();
  for (let a = 0; a < 12; a += 0.3) { const r = 2 + a * 1.2; c.lineTo(-5 + Math.cos(a) * r, -3 + Math.sin(a) * r); }
  c.lineWidth = 1.5; c.strokeStyle = '#b9b09a'; c.stroke();
  fl(c, '#c8322a', () => c.rect(-9, -24, 8, 3));
};
I.cigarettes = (c) => {
  shp(c, '#f0ece2', () => c.rect(-5, -26, 5, 14), 2);
  fl(c, '#d88a3a', () => c.rect(-5, -17, 5, 5));
  shp(c, '#f0ece2', () => c.rect(3, -22, 5, 12), 2);
  fl(c, '#d88a3a', () => c.rect(3, -15, 5, 5));
  shp(c, '#b82c24', () => c.roundRect(-16, -14, 32, 38, 2));
  fl(c, '#efe8da', () => c.rect(-13, -12, 26, 12));
  fl(c, '#b82c24', () => { c.moveTo(-13, 0); c.lineTo(0, -8); c.lineTo(13, 0); c.closePath(); });
  txt(c, 'ЯВА', 0, 12, 9, '#f3d9a0', 'center', 800);
};
I.lockpick = (c) => {
  ln(c, [[-22, 18], [18, -18]], 7, OUT); ln(c, [[-22, 18], [18, -18]], 3.4, '#b8bec5');
  ln(c, [[18, -18], [22, -18], [24, -22]], 5, OUT); ln(c, [[18, -18], [22, -18], [24, -22]], 2, '#b8bec5');
  ln(c, [[-22, 6], [18, 18]], 7, OUT); ln(c, [[-22, 6], [18, 18]], 3.4, '#9aa2aa');
  ln(c, [[18, 18], [22, 14]], 5, OUT); ln(c, [[18, 18], [22, 14]], 2, '#9aa2aa');
  shp(c, '#6a3f22', () => c.roundRect(-27, 4, 12, 18, 3), 2.5);
};
I.grenade = (c) => {
  shp(c, '#5d6b3a', () => c.ellipse(0, 6, 15, 18, 0, 0, TAU));
  for (const y of [-2, 6, 14]) ln(c, [[-14, y], [14, y]], 1.5, '#3b4524');
  for (const x of [-6, 2, 9]) ln(c, [[x, -10], [x, 22]], 1.5, '#3b4524');
  fl(c, '#7d8c52', () => c.ellipse(-6, 0, 4, 9, 0, 0, TAU));
  shp(c, '#6b6f75', () => c.rect(-6, -18, 12, 8), 2.5);
  shp(c, '#8a9096', () => { c.moveTo(4, -18); c.lineTo(14, -16); c.lineTo(16, 8); c.lineTo(12, 8); c.lineTo(10, -12); c.lineTo(4, -12); c.closePath(); }, 2.5);
  c.beginPath(); c.arc(-11, -20, 6, 0, TAU); c.lineWidth = 4.5; c.strokeStyle = OUT; c.stroke(); c.lineWidth = 2; c.strokeStyle = '#c9ccd0'; c.stroke();
};
I.smoke_grenade = (c) => {
  shp(c, '#6f757b', () => c.roundRect(-12, -14, 24, 38, 3));
  shp(c, '#e9e9e9', () => c.rect(-12, -2, 24, 8), 2);
  txt(c, 'ДЫМ', 0, 13, 7, '#e9e9e9', 'center', 800);
  shp(c, '#4a4f55', () => c.rect(-8, -22, 16, 8), 2.5);
  c.beginPath(); c.arc(-12, -22, 5, 0, TAU); c.lineWidth = 4.5; c.strokeStyle = OUT; c.stroke(); c.lineWidth = 2; c.strokeStyle = '#c9ccd0'; c.stroke();
};
I.fire_grenade = (c) => {
  shp(c, '#9b2c22', () => c.roundRect(-12, -14, 24, 38, 3));
  shp(c, '#e39a2c', () => c.rect(-12, -2, 24, 8), 2);
  fl(c, '#f0c040', () => { c.moveTo(0, 20); c.quadraticCurveTo(-7, 14, -2, 8); c.quadraticCurveTo(0, 13, 3, 9); c.quadraticCurveTo(7, 14, 0, 20); });
  shp(c, '#4a4f55', () => c.rect(-8, -22, 16, 8), 2.5);
  c.beginPath(); c.arc(-12, -22, 5, 0, TAU); c.lineWidth = 4.5; c.strokeStyle = OUT; c.stroke(); c.lineWidth = 2; c.strokeStyle = '#c9ccd0'; c.stroke();
};
function cidCard(c: C2, fake: boolean): void {
  shp(c, fake ? '#c9c2a4' : '#c9d6df', () => c.roundRect(-26, -17, 52, 34, 4));
  fl(c, fake ? '#aa9f7c' : '#7d95a6', () => c.rect(-24, -15, 48, 7));
  shp(c, '#e6e2d8', () => c.rect(-21, -5, 14, 17), 2);
  fl(c, '#6b5a48', () => c.arc(-14, 1, 3.5, 0, TAU));
  fl(c, '#6b5a48', () => c.ellipse(-14, 9, 6, 3.5, 0, Math.PI, TAU));
  for (const y of [-2, 3, 8]) ln(c, [[-3, y], [20, y]], 2, fake ? '#8a7d5a' : '#4d6373');
  txt(c, 'CID', 14, -11.5, 6, '#f5f5f5', 'center', 900);
  if (fake) {
    c.save(); c.rotate(-0.35);
    rrect(c, -4, -9, 30, 14, 2, null, '#b8342a', 2);
    txt(c, 'ЧИСТ.', 11, -2, 8, '#b8342a', 'center', 900);
    c.restore();
  }
}
I.cid = (c) => cidCard(c, false);
I.fake_cid = (c) => cidCard(c, true);
/** Пропуск в Управу: картонка с полосой Протектората и печатью «липа» (подпись от руки). */
I.forged_pass = (c) => {
  shp(c, '#d8cfa8', () => c.roundRect(-24, -18, 48, 36, 3));
  fl(c, '#3a5a8a', () => c.rect(-22, -16, 44, 7));
  txt(c, 'ПРОПУСК', 0, -12.5, 6, '#f5f5f5', 'center', 900);
  for (const y of [-3, 3, 9]) ln(c, [[-18, y], [18, y]], 2, '#8a7d5a');
  c.save(); c.rotate(-0.3);
  rrect(c, -2, 4, 22, 11, 2, null, '#b8342a', 2);
  c.restore();
};
I.toolkit = (c) => {
  shp(c, '#2b2d31', () => { c.moveTo(-10, -12); c.lineTo(-10, -20); c.lineTo(10, -20); c.lineTo(10, -12); c.lineTo(6, -12); c.lineTo(6, -16); c.lineTo(-6, -16); c.lineTo(-6, -12); c.closePath(); }, 2.5);
  shp(c, '#c43a2a', () => c.roundRect(-26, -12, 52, 34, 3));
  fl(c, '#9a2a1e', () => c.rect(-26, -3, 52, 4));
  shp(c, '#c9ccd0', () => c.rect(-4, -5, 8, 7), 2);
  fl(c, '#e05a44', () => c.rect(-24, -10, 48, 4));
};
I.tokens = (c) => {
  for (let i = 3; i >= 0; i--) {
    const y = 12 - i * 6;
    shp(c, '#9aa3ab', () => c.ellipse(-4, y + 4, 18, 6, 0, 0, TAU), 2.5);
  }
  shp(c, '#c8d0d6', () => c.ellipse(-4, -8, 18, 6, 0, 0, TAU), 2.5);
  shp(c, '#c8d0d6', () => c.ellipse(12, -14, 13, 13, 0, 0, TAU));
  fl(c, '#6c9ec6', () => c.arc(12, -14, 7, 0, TAU));
  c.beginPath(); c.arc(12, -14, 4, 0.6, TAU - 0.6); c.lineWidth = 2; c.strokeStyle = '#e9eef2'; c.stroke();
};
I.ammo_pistol = (c) => {
  for (let i = 0; i < 5; i++) {
    const x = -16 + i * 8;
    shp(c, '#c9a44a', () => c.rect(x - 3, -18, 6, 10), 2);
    shp(c, '#9a7c3a', () => c.arc(x, -18, 3, Math.PI, TAU), 2);
  }
  shp(c, '#8a6a3c', () => c.rect(-24, -10, 48, 32));
  fl(c, '#a88550', () => c.rect(-24, -10, 48, 6));
  shp(c, '#e7dfc8', () => c.rect(-15, 0, 30, 14), 2);
  txt(c, '9 мм', 0, 7.5, 9, '#3a2d18', 'center', 900);
};
I.ammo_smg = (c) => {
  shp(c, '#2e3136', () => c.roundRect(-8, -24, 16, 50, 3));
  fl(c, '#4a4f56', () => c.rect(-5, -20, 4, 42));
  shp(c, '#c9a44a', () => c.rect(-5, -30, 10, 6), 2);
  ln(c, [[-8, 16], [8, 16]], 2, '#15171a');
};
I.ammo_rifle = (c) => {
  shp(c, '#3a3d42', () => { c.moveTo(-8, -24); c.lineTo(8, -24); c.quadraticCurveTo(14, 4, 22, 24); c.lineTo(6, 28); c.quadraticCurveTo(-2, 6, -8, -24); });
  fl(c, '#5a5f67', () => { c.moveTo(-4, -20); c.lineTo(0, -20); c.quadraticCurveTo(6, 4, 12, 22); c.lineTo(9, 23); c.quadraticCurveTo(2, 4, -4, -20); });
  shp(c, '#c9a44a', () => c.rect(-5, -30, 10, 6), 2);
  for (const t of [0.3, 0.6]) ln(c, [[-6 + t * 14, -24 + t * 50], [8 + t * 14, -26 + t * 50]], 1.5, '#15171a');
};
I.buckshot = (c) => {
  for (let i = 0; i < 3; i++) {
    c.save(); c.translate(-14 + i * 14, 2); c.rotate(-0.12 + i * 0.12);
    shp(c, '#b8342a', () => c.roundRect(-5.5, -20, 11, 30, 2));
    fl(c, '#d85a48', () => c.rect(-3.5, -18, 3, 26));
    shp(c, '#c9a44a', () => c.rect(-6, 8, 12, 10), 2.5);
    c.restore();
  }
};
I.bolt = (c) => {
  for (const [a, dy] of [[-0.5, -6], [-0.3, 6]] as [number, number][]) {
    c.save(); c.translate(0, dy); c.rotate(a);
    ln(c, [[-26, 0], [24, 0]], 7, OUT); ln(c, [[-26, 0], [24, 0]], 3.6, '#8e5a3a');
    for (let x = -22; x < 20; x += 5) ln(c, [[x, -1.5], [x + 2, 1.5]], 1, '#5a3620');
    fl(c, '#f09a3a', () => { c.moveTo(24, -3); c.lineTo(30, 0); c.lineTo(24, 3); c.closePath(); });
    c.restore();
  }
};
I.rocket = (c) => {
  c.save(); c.rotate(-0.6);
  shp(c, '#6b6f3e', () => { c.moveTo(-6, -8); c.quadraticCurveTo(0, -30, 6, -8); c.closePath(); });
  shp(c, '#4f5330', () => c.rect(-3, -8, 6, 32));
  shp(c, '#3b3e24', () => { c.moveTo(-3, 16); c.lineTo(-9, 26); c.lineTo(-3, 24); c.closePath(); c.moveTo(3, 16); c.lineTo(9, 26); c.lineTo(3, 24); c.closePath(); }, 2);
  fl(c, '#e8e1c6', () => c.rect(-6, -10, 12, 3));
  c.restore();
};
// снаряжение
I.cap = (c) => {
  shp(c, '#3c5a88', () => { c.moveTo(-20, 6); c.quadraticCurveTo(-20, -18, 2, -18); c.quadraticCurveTo(22, -18, 22, 6); c.closePath(); });
  shp(c, '#2c4468', () => { c.moveTo(4, 4); c.quadraticCurveTo(26, 0, 30, 8); c.quadraticCurveTo(18, 14, 4, 10); c.closePath(); });
  fl(c, '#4f71a4', () => c.ellipse(-6, -8, 7, 5, -0.3, 0, TAU));
  shp(c, '#f0d060', () => c.arc(2, -6, 5, 0, TAU), 2);
};
I.gasmask = (c) => {
  shp(c, '#2f3237', () => { c.moveTo(-18, -16); c.quadraticCurveTo(0, -26, 18, -16); c.quadraticCurveTo(22, 8, 8, 20); c.lineTo(-8, 20); c.quadraticCurveTo(-22, 8, -18, -16); });
  shp(c, '#7fb0c8', () => c.arc(-8, -6, 6, 0, TAU), 2.5);
  shp(c, '#7fb0c8', () => c.arc(8, -6, 6, 0, TAU), 2.5);
  fl(c, 'rgba(255,255,255,0.6)', () => { c.arc(-10, -8, 1.8, 0, TAU); c.arc(6, -8, 1.8, 0, TAU); });
  shp(c, '#55595f', () => c.roundRect(-7, 8, 14, 16, 3), 2.5);
  for (const y of [12, 16, 20]) ln(c, [[-5, y], [5, y]], 1.2, '#2a2c30');
};
I.helmet = (c) => {
  shp(c, '#55603a', () => { c.moveTo(-24, 8); c.quadraticCurveTo(-24, -22, 0, -22); c.quadraticCurveTo(24, -22, 24, 8); c.lineTo(18, 8); c.lineTo(18, 14); c.lineTo(-18, 14); c.lineTo(-18, 8); c.closePath(); });
  fl(c, '#6d7a4a', () => c.ellipse(-8, -10, 9, 6, -0.4, 0, TAU));
  ln(c, [[-20, 4], [20, 4]], 2, '#3a4226');
  shp(c, '#2b2d31', () => c.rect(-5, -24, 10, 5), 2);
};
I.helmet_cp = (c) => {
  shp(c, '#3f4a55', () => { c.moveTo(-26, 8); c.quadraticCurveTo(-22, -22, 0, -22); c.quadraticCurveTo(22, -22, 26, 8); c.lineTo(20, 10); c.lineTo(-20, 10); c.closePath(); });
  fl(c, '#5a6875', () => c.ellipse(-8, -10, 8, 5, -0.4, 0, TAU));
  shp(c, '#6fa0c8', () => c.rect(-18, -2, 36, 5), 2);
};
I.plate_vest = (c) => {
  shp(c, '#5d6b3a', () => { c.moveTo(-20, -22); c.lineTo(-10, -22); c.lineTo(-6, -14); c.lineTo(6, -14); c.lineTo(10, -22); c.lineTo(20, -22); c.lineTo(22, 22); c.lineTo(-22, 22); c.closePath(); });
  shp(c, '#4b5730', () => c.roundRect(-14, -10, 28, 20, 3), 2.5);
  for (let i = 0; i < 3; i++) shp(c, '#6f7e48', () => c.roundRect(-18 + i * 12.5, 12, 11, 9, 2), 2);
};
I.vest = (c) => {
  shp(c, '#5d6b3a', () => { c.moveTo(-20, -22); c.lineTo(-10, -22); c.lineTo(-6, -14); c.lineTo(6, -14); c.lineTo(10, -22); c.lineTo(20, -22); c.lineTo(22, 22); c.lineTo(-22, 22); c.closePath(); });
  for (let i = 0; i < 3; i++) shp(c, '#4b5730', () => c.roundRect(-18 + i * 12.5, 4, 11, 16, 2), 2.5);
  fl(c, '#6f7e48', () => c.rect(-14, -8, 28, 8));
  for (const x of [-12, -6, 0, 6, 12]) ln(c, [[x, -8], [x, 0]], 1, '#3b4524');
};
I.backpack = (c) => {
  shp(c, '#5a6238', () => c.roundRect(-20, -20, 40, 44, 8));
  shp(c, '#4a5130', () => c.roundRect(-14, 4, 28, 18, 4), 2.5);
  shp(c, '#4a5130', () => { c.moveTo(-20, -8); c.quadraticCurveTo(0, -2, 20, -8); c.lineTo(20, -14); c.quadraticCurveTo(0, -8, -20, -14); c.closePath(); }, 2.5);
  shp(c, '#2b2d31', () => c.roundRect(-8, -27, 16, 8, 3), 2.5);
  ln(c, [[0, 4], [0, 22]], 1.5, '#2e3320');
};
I.coat = (c) => {
  shp(c, '#6b5a40', () => { c.moveTo(-10, -24); c.lineTo(10, -24); c.lineTo(24, -14); c.lineTo(24, 22); c.lineTo(14, 26); c.lineTo(10, 10); c.lineTo(-10, 10); c.lineTo(-14, 26); c.lineTo(-24, 22); c.lineTo(-24, -14); c.closePath(); });
  fl(c, '#7d6b4f', () => { c.moveTo(-10, -24); c.lineTo(0, -10); c.lineTo(10, -24); c.closePath(); });
  ln(c, [[0, -10], [0, 22]], 1.6, '#4a3d2a');
  fl(c, '#e6dcc0', () => { c.arc(-3, -2, 1.6, 0, TAU); c.arc(-3, 9, 1.6, 0, TAU); });
  ln(c, [[-22, 6], [22, 6]], 2.5, '#3c3121');
};
/** Рубаха в крови — значок состояния «в крови». */
I.bloody_shirt = (c) => {
  shp(c, '#5b6470', () => { c.moveTo(-12, -22); c.lineTo(-22, -14); c.lineTo(-16, -6); c.lineTo(-14, 22); c.lineTo(14, 22); c.lineTo(16, -6); c.lineTo(22, -14); c.lineTo(12, -22); c.quadraticCurveTo(0, -14, -12, -22); c.closePath(); });
  shp(c, '#9b1c16', () => c.ellipse(4, 6, 8, 6, 0.3, 0, TAU), 2);
  fl(c, '#d4362b', () => c.arc(-6, -2, 3, 0, TAU));
};
/** Лупа — значок состояния «ищут». */
I.search = (c) => {
  ln(c, [[8, 8], [22, 22]], 9, OUT);
  ln(c, [[8, 8], [22, 22]], 5, '#6b5a48');
  shp(c, '#cfe3ef', () => c.arc(-5, -5, 16, 0, TAU), 4.5);
  fl(c, 'rgba(255,255,255,0.7)', () => c.arc(-11, -11, 4, 0, TAU));
};
I.jumpsuit = (c) => {
  shp(c, '#3f6a8c', () => { c.moveTo(-10, -24); c.lineTo(10, -24); c.lineTo(24, -14); c.lineTo(20, 4); c.lineTo(14, 0); c.lineTo(14, 26); c.lineTo(2, 26); c.lineTo(0, 6); c.lineTo(-2, 26); c.lineTo(-14, 26); c.lineTo(-14, 0); c.lineTo(-20, 4); c.lineTo(-24, -14); c.closePath(); });
  fl(c, '#335a78', () => { c.moveTo(-10, -24); c.lineTo(0, -14); c.lineTo(10, -24); c.closePath(); });
  ln(c, [[0, -14], [0, 6]], 1.6, '#1f3a52');
  fl(c, '#e6e2d8', () => c.rect(4, -10, 7, 5));
};
I.radio = (c) => {
  ln(c, [[8, -18], [10, -30]], 5, OUT); ln(c, [[8, -18], [10, -30]], 2.4, '#3a3d42');
  shp(c, '#2f3237', () => c.roundRect(-11, -18, 22, 42, 4));
  shp(c, '#9fd070', () => c.rect(-7, -13, 14, 9), 2);
  for (const y of [2, 7, 12]) for (const x of [-5, 0, 5]) fl(c, '#6a6f76', () => c.arc(x, y, 1.6, 0, TAU));
  shp(c, '#c8322a', () => c.rect(-4, 17, 8, 3), 1.5);
};
I.flashlight = (c) => {
  c.save(); c.rotate(-0.5);
  shp(c, '#2f3237', () => c.roundRect(-24, -6, 34, 12, 3));
  shp(c, '#3a3d42', () => { c.moveTo(10, -6); c.lineTo(22, -10); c.lineTo(22, 10); c.lineTo(10, 6); c.closePath(); });
  shp(c, '#f3eaa0', () => c.ellipse(22, 0, 3, 10, 0, 0, TAU), 2);
  for (const x of [-18, -12, -6]) ln(c, [[x, -5], [x, 5]], 1.2, '#1a1c1f');
  c.restore();
};
I.knife_i = (c) => {
  c.save(); c.rotate(-0.6);
  shp(c, '#c9ced4', () => { c.moveTo(-2, -5); c.lineTo(26, -5); c.quadraticCurveTo(24, 3, 14, 5); c.lineTo(-2, 5); c.closePath(); });
  shp(c, '#3a2c20', () => c.roundRect(-24, -5, 22, 10, 3));
  shp(c, '#55595f', () => c.rect(-4, -8, 4, 16), 2);
  c.restore();
};
I.heart = (c) => {
  shp(c, '#d8443a', () => { c.moveTo(0, 20); c.bezierCurveTo(-30, 0, -18, -26, 0, -10); c.bezierCurveTo(18, -26, 30, 0, 0, 20); });
  fl(c, '#f07a6a', () => c.ellipse(-9, -6, 5, 3.5, -0.6, 0, TAU));
};
I.cross = (c) => {
  shp(c, '#e7e2d5', () => { c.rect(-7, -20, 14, 40); c.rect(-20, -7, 40, 14); }, 0);
  shp(c, '#d8443a', () => { c.moveTo(-7, -20); c.lineTo(7, -20); c.lineTo(7, -7); c.lineTo(20, -7); c.lineTo(20, 7); c.lineTo(7, 7); c.lineTo(7, 20); c.lineTo(-7, 20); c.lineTo(-7, 7); c.lineTo(-20, 7); c.lineTo(-20, -7); c.lineTo(-7, -7); c.closePath(); });
};
I.drop = (c) => {
  shp(c, '#c8281e', () => { c.moveTo(0, -24); c.bezierCurveTo(6, -10, 18, 2, 18, 10); c.arc(0, 10, 18, 0, Math.PI); c.bezierCurveTo(-18, 2, -6, -10, 0, -24); });
  fl(c, '#ff6a58', () => c.ellipse(-7, 8, 4, 7, 0.3, 0, TAU));
};
I.leg = (c) => {
  shp(c, '#c7a07a', () => { c.moveTo(-8, -26); c.lineTo(8, -26); c.lineTo(6, 14); c.lineTo(18, 18); c.lineTo(18, 26); c.lineTo(-6, 26); c.lineTo(-8, 14); c.closePath(); });
  shp(c, '#ece6d6', () => c.rect(-9, -8, 17, 10), 2);
  fl(c, '#c8281e', () => c.rect(-4, -6, 7, 6));
};
I.arm = (c) => {
  shp(c, '#c7a07a', () => { c.moveTo(-26, -6); c.lineTo(12, -8); c.quadraticCurveTo(26, -8, 26, 2); c.quadraticCurveTo(26, 10, 12, 8); c.lineTo(-26, 6); c.closePath(); });
  shp(c, '#ece6d6', () => c.rect(-8, -8, 11, 16), 2);
  fl(c, '#c8281e', () => c.rect(-6, -3, 6, 6));
};
I.suppress = (c) => {
  shp(c, '#c9a44a', () => { c.moveTo(-26, -10); c.lineTo(10, -10); c.quadraticCurveTo(22, -10, 26, 0); c.quadraticCurveTo(22, 10, 10, 10); c.lineTo(-26, 10); c.closePath(); });
  for (const y of [-20, 20]) ln(c, [[-24, y], [6, y]], 3, '#f0e2b0');
  ln(c, [[-30, 0], [-40, 0]], 3, '#f0e2b0');
};
I.crouch = (c) => {
  fl(c, '#e9e0c8', () => { c.arc(0, -16, 7, 0, TAU); });
  ln(c, [[0, -8], [4, 6], [-8, 12], [-2, 22]], 7, '#e9e0c8');
  ln(c, [[4, 6], [14, 14], [12, 22]], 7, '#e9e0c8');
  ln(c, [[2, -4], [14, 0]], 6, '#e9e0c8');
};
I.wanted = (c) => {
  shp(c, '#e8d8a8', () => c.rect(-20, -24, 40, 48));
  txt(c, 'РОЗЫСК', 0, -16, 8, '#6a1a14', 'center', 900);
  fl(c, '#6b5a48', () => c.arc(0, 0, 7, 0, TAU));
  fl(c, '#6b5a48', () => c.ellipse(0, 14, 11, 7, 0, Math.PI, TAU));
  ln(c, [[-14, 18], [14, 18]], 2, '#6a1a14');
};
I.hunger = (c) => {
  shp(c, '#9aa0a6', () => c.ellipse(0, 6, 24, 10, 0, 0, Math.PI));
  shp(c, '#c9ccd0', () => c.ellipse(0, 6, 24, 6, 0, 0, TAU), 2.5);
  ln(c, [[18, -18], [8, 2]], 6, OUT); ln(c, [[18, -18], [8, 2]], 3, '#c9ccd0');
  shp(c, '#c9ccd0', () => c.ellipse(20, -21, 4, 6, 0.5, 0, TAU), 2.5);
};
I.mask = (c) => {
  shp(c, '#3a3d42', () => { c.moveTo(-22, -6); c.quadraticCurveTo(0, -18, 22, -6); c.quadraticCurveTo(18, 8, 0, 6); c.quadraticCurveTo(-18, 8, -22, -6); });
  fl(c, '#e9e0c8', () => { c.ellipse(-9, -4, 5, 3, 0, 0, TAU); c.ellipse(9, -4, 5, 3, 0, 0, TAU); });
};

I.cell_ar2 = (c) => {
  shp(c, '#d9dcdf', () => c.roundRect(-10, -22, 20, 44, 5));
  fl(c, '#5fd6ff', () => c.roundRect(-5, -14, 10, 28, 3));
  fl(c, '#d6f6ff', () => c.rect(-2, -12, 3, 24));
  shp(c, '#6a7178', () => c.rect(-11, -26, 22, 6), 2.5);
  shp(c, '#6a7178', () => c.rect(-11, 20, 22, 6), 2.5);
};
I.rounds = (c) => {
  for (let i = 0; i < 4; i++) {
    c.save();
    c.translate(-15 + i * 10, 4);
    c.rotate(-0.15 + i * 0.1);
    shp(c, '#c9a44a', () => c.rect(-3.5, -8, 7, 20), 2.2);
    shp(c, '#9a7c3a', () => c.arc(0, -8, 3.5, Math.PI, TAU), 2.2);
    c.restore();
  }
};
I.rounds_long = (c) => {
  for (let i = 0; i < 3; i++) {
    c.save();
    c.translate(-10 + i * 10, 2);
    c.rotate(-0.1 + i * 0.1);
    shp(c, '#c9a44a', () => c.rect(-3.5, -10, 7, 30), 2.2);
    shp(c, '#8a8f96', () => { c.moveTo(-3.5, -10); c.lineTo(0, -24); c.lineTo(3.5, -10); c.closePath(); }, 2.2);
    c.restore();
  }
};
I.mag_straight = (c) => {
  shp(c, '#3a3d42', () => c.roundRect(-8, -24, 16, 50, 2));
  fl(c, '#5a5f67', () => c.rect(-4, -20, 4, 42));
  for (const y of [-8, 6]) ln(c, [[-8, y], [8, y]], 1.5, '#15171a');
  shp(c, '#c9a44a', () => c.rect(-5, -30, 10, 6), 2);
};

/** Какой рисунок у предмета инвентаря (стволы — моделью, см. drawGunIcon). */
const ITEM_ICON: Partial<Record<ItemId, string>> = {
  ammo_ar2: 'cell_ar2',
  ammo_357: 'rounds',
  ammo_buckshot: 'buckshot',
  ammo_bolt: 'bolt',
  ammo_556: 'mag_straight',
  ammo_545: 'ammo_rifle',
  ammo_338: 'rounds_long',
  ammo_rocket: 'rocket',
  helmet_cp: 'helmet_cp',
  plate_vest: 'plate_vest',
  parcel: 'ration',
  parcel_x: 'ration',
};

export function iconOf(id: ItemId): string {
  return ITEM_ICON[id] ?? id;
}

export function hasIcon(id: string): boolean {
  return id in I;
}

/** Иконка id с центром (cx, cy); s — масштаб (1 = 64 px). */
export function drawIcon(ctx: C2, id: string, cx: number, cy: number, s = 1): void {
  const f = I[id];
  if (!f) return;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  f(ctx);
  ctx.restore();
}

const cache = new Map<string, HTMLCanvasElement>();
/** Иконка готовым холстом px×px (для DOM: значки состояний и т.п.), с кэшем. */
export function iconCanvas(id: string, px: number): HTMLCanvasElement {
  const key = `${id}@${px}`;
  let cv = cache.get(key);
  if (!cv) {
    cv = document.createElement('canvas');
    cv.width = cv.height = px;
    drawIcon(cv.getContext('2d')!, id, px / 2, px / 2, px / 64);
    cache.set(key, cv);
  }
  return cv;
}

const urls = new Map<string, string>();
/** Иконка картинкой (data URL) для <img>, с кэшем. */
export function iconUrl(id: string, px: number): string {
  const key = `${id}@${px}`;
  let u = urls.get(key);
  if (!u) {
    u = iconCanvas(id, px).toDataURL();
    urls.set(key, u);
  }
  return u;
}

function bbox(parts: readonly SpritePart[]): [number, number, number, number] {
  let x0 = 1e9;
  let y0 = 1e9;
  let x1 = -1e9;
  let y1 = -1e9;
  const add = (x: number, y: number, pad = 0) => {
    x0 = Math.min(x0, x - pad);
    x1 = Math.max(x1, x + pad);
    y0 = Math.min(y0, y - pad);
    y1 = Math.max(y1, y + pad);
  };
  for (const p of parts) {
    if ('r' in p) {
      add(p.r[0], p.r[1]);
      add(p.r[2], p.r[3]);
    } else if ('p' in p) p.p.forEach(([x, y]) => add(x, y));
    else if ('l' in p) p.l.forEach(([x, y]) => add(x, y, p.w / 2));
    else add(p.o[0], p.o[1], p.o[2]);
  }
  return [x0, y0, x1, y1];
}

function partPath(ctx: C2, p: SpritePart): void {
  ctx.beginPath();
  if ('r' in p) ctx.rect(p.r[0], p.r[1], p.r[2] - p.r[0], p.r[3] - p.r[1]);
  else if ('p' in p) {
    p.p.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  } else if ('l' in p) p.l.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  else ctx.arc(p.o[0], p.o[1], p.o[2], 0, TAU);
}

export interface GunIconOpts {
  /** Силуэт одним цветом (колесо оружия), иначе — в цвете, как в руках. */
  silhouette?: string;
  /** Цвет контура (null — без контура). */
  outline?: string | null;
  outlineWidth?: number;
  /** Наибольшая высота, px (пистолет не раздувается по ширине ячейки). */
  maxH?: number;
  alpha?: number;
}

/** Ствол по центру (cx, cy) длиной до len px — та же модель, что в руках у пешки. */
export function drawGunIcon(ctx: C2, id: WeaponId, cx: number, cy: number, len: number, o: GunIconOpts = {}): void {
  const sp = WEAPON_SPRITES[id];
  const [x0, y0, x1, y1] = bbox(sp.parts);
  const k = Math.min(len / (x1 - x0), (o.maxH ?? Infinity) / (y1 - y0));
  const out = o.outline === undefined ? WEAPON_POSE.outline : o.outline;
  const ow = o.outlineWidth ?? WEAPON_POSE.outlineWidth;
  ctx.save();
  if (o.alpha !== undefined) ctx.globalAlpha *= o.alpha;
  ctx.translate(cx, cy);
  ctx.scale(k, k);
  ctx.translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (out) {
    ctx.strokeStyle = out;
    ctx.fillStyle = out;
    for (const p of sp.parts) {
      partPath(ctx, p);
      if ('l' in p) {
        ctx.lineWidth = p.w + ow * 2;
        ctx.stroke();
      } else {
        ctx.lineWidth = ow * 2;
        ctx.stroke();
        ctx.fill();
      }
    }
  }
  for (const p of sp.parts) {
    partPath(ctx, p);
    const col = o.silhouette ?? p.c;
    if ('l' in p) {
      ctx.lineWidth = p.w;
      ctx.strokeStyle = col;
      ctx.stroke();
    } else {
      ctx.fillStyle = col;
      ctx.fill();
    }
  }
  ctx.restore();
}
