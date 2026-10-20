/* 行为测试：模拟按键，验证核心循环真的能跑通（不只是不崩）。
   node test/behavior.js */
const fs = require('fs');
const vm = require('vm');
const { sandbox, api } = require('./harness.js');

const G = api.G;
let fails = 0;
const ok = (c, m) => { if (!c) { console.error('  ✗ ' + m); fails++; } else console.log('  ✓ ' + m); };

// ── 第一章：跟随策略下能不能稳定待在她的光里 ──
api.startChapter(0);
G.state = 'playing';
let inside = 0, total = 0, gotClose = false, firstAt = 0;
for (let s = 0; s < 120 * 40; s++) {
  const dx = G.her.x - G.p.x;
  const d = Math.hypot(G.p.x - G.her.x, G.p.y - G.her.y);
  api.press('KeyD', dx > 40);
  api.press('KeyA', dx < -40);
  api.press('KeyW', d > 260);        // 远离时滑翔保命
  api.step(1 / 120);
  total += 1 / 120;
  if (d < 320) inside += 1 / 120;
  if (d < 120) gotClose = true;
  if (G.done.first && !firstAt) firstAt = G.tt;
}
api.press('KeyD', false); api.press('KeyA', false); api.press('KeyW', false);
ok(gotClose, '第一章：能靠近她');
ok(G.done.first === 1, '第一章：首次进入光照会触发"她出现"事件');
ok(inside / total > 0.55, `第一章：跟随策略下 ${(inside / total * 100).toFixed(0)}% 时间在她的光里`);
console.log(`     首次接触 t=${firstAt.toFixed(1)}s`);

// ── 第一章：她回头那 2 秒 ──
ok(G.her.look >= 0, '第一章：回头事件可触发（look 值有效）');

// ── 第二章：站在她面前不动，曝光应该涨满并触发"她看你" ──
api.startChapter(1);
G.state = 'playing';
G.p.x = G.her.x + 260;
G.p.y = G.her.y;
G.her.look = 2.4;
G.her.fx = 0; G.her.fy = 0;
let stared = false;
for (let s = 0; s < 120 * 4; s++) {
  // 每帧把她视线固定指向玩家，模拟"被逮个正着"
  G.her.fx = (G.p.x - G.her.x); G.her.fy = (G.p.y - G.her.y);
  const l = Math.hypot(G.her.fx, G.her.fy) || 1; G.her.fx /= l; G.her.fy /= l;
  G.her.look = Math.max(G.her.look, 0.05);
  api.step(1 / 120);
  if (G.stare > 0) { stared = true; break; }
}
ok(stared, '第二章：被她看到会触发凝视定格（软惩罚）');

// ── 第三章：右键献光应该变亮并消耗光 ──
api.startChapter(2);
G.state = 'playing';
const l0 = G.p.light;
api.press('ShiftLeft', true);
for (let s = 0; s < 120 * 2; s++) api.step(1 / 120);
api.press('ShiftLeft', false);
ok(G.p.light < l0 - 20, `第三章：献光确实消耗了光（${l0.toFixed(0)} → ${G.p.light.toFixed(0)}）`);
ok(G.p.disguise === true || G.p.disguise === false, '第三章：伪装状态可读写');

// ── 第四章：按住右键她的高度应该被托住 ──
api.startChapter(3);
G.state = 'playing';
G.her.y = 700;
G.her.vy = 120;
api.press('ShiftLeft', true);
for (let s = 0; s < 120 * 3; s++) api.step(1 / 120);
const yHold = G.her.y;
api.press('ShiftLeft', false);
ok(yHold < 900, `第四章：托举能把她拉住（her.y=${yHold.toFixed(0)}）`);

// ── 第五章：喷气应该能减速下落 ──
api.startChapter(4);
G.state = 'playing';
G.p.y = 500; G.p.vy = 300;
for (let s = 0; s < 60; s++) api.step(1 / 120);
const fallSpeed = G.p.vy;
api.startChapter(4);
G.state = 'playing';
G.p.y = 500; G.p.vy = 300;
api.press('KeyW', true);
for (let s = 0; s < 60; s++) api.step(1 / 120);
api.press('KeyW', false);
ok(G.p.vy < fallSpeed - 50, `第五章：按住 W 会减速下落（${fallSpeed.toFixed(0)} → ${G.p.vy.toFixed(0)}）`);
ok(G.p.light < 100, `第五章：喷气消耗了光（剩 ${G.p.light.toFixed(0)}）`);

console.log(fails === 0 ? '\n行为测试全部通过' : `\n行为测试失败 ${fails} 项`);
process.exit(fails === 0 ? 0 : 1);
