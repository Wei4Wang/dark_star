/* 第五章（地狱）可行性测试
   这一关不做"手感好不好"的判断，只量四件可以客观回答的事：
   1) 100 颗星是不是真的收得齐、路线存在；
   2) 全程要多久；
   3) 不带无敌时会被卡在第几层（难度量级）；
   4) 每次重来是不是完全一样——只有一样，苦练才有意义。
   node test/hell.js */
const { api } = require('./harness.js');
const G = api.G;
let fails = 0;
const ok = (c, m) => { if (!c) { console.error('  ✗ ' + m); fails++; } else console.log('  ✓ ' + m); };

const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// 预测 dtOff 秒后 (x,y) 会不会被撞上，留 14 的余量
function danger(x, y, dtOff) {
  const sp = G.easy ? 0.85 : 1;
  for (const o of G.obs) {
    if (o.type === 'rotor') {
      if (Math.abs(y - o.y) > o.len + o.w + 14) continue;
      const a = o.ph + (G.shaftT + dtOff) * o.spin * sp;
      const ax = Math.cos(a) * o.len, ay = Math.sin(a) * o.len;
      if (segDist(x, y, 600 - ax, o.y - ay, 600 + ax, o.y + ay) < o.w * 0.5 + 14) return true;
    } else if (o.type === 'block') {
      if (Math.abs(y - o.y) > o.h * 0.5 + 14) continue;
      const bx = 600 + Math.sin(o.ph + (G.shaftT + dtOff) * o.sp * sp) * o.amp;
      if (Math.abs(x - bx) < o.w * 0.5 + 14 && Math.abs(y - o.y) < o.h * 0.5 + 14) return true;
    } else {
      if (Math.abs(y - o.y) > o.r + 14) continue;
      const sx = 600 + Math.sin(o.ph + (G.shaftT + dtOff) * o.sp * sp) * o.amp;
      if (Math.hypot(x - sx, y - o.y) < o.r + 14) return true;
    }
  }
  return false;
}

function nextStar() {
  let best = null;
  for (const s of G.pickups) {
    if (s.got) continue;
    if (s.y < G.p.y - 30) continue;
    if (!best || s.y < best.y) best = s;
  }
  return best;
}

// 机器人：主线跟着下一颗星，够不到才刹车。刻意不做"完美走位"——
// 它代表第一次上手的玩家，用来量难度，不是用来通关的。
function botFrame(inv) {
  const p = G.p;
  const target = nextStar();
  if (!target) {
    api.press('KeyA', false); api.press('KeyD', false); api.press('KeyW', false);
    if (inv) p.inv = 99;
    return;
  }
  const dx = target.x - p.x;
  api.press('KeyD', dx > 10);
  api.press('KeyA', dx < -10);
  const dy = target.y - p.y;
  api.press('KeyW', p.vy > 330 || (dy < 70 && Math.abs(dx) > 30));
  if (inv) p.inv = 99;
}

// ── 1. 路线存在性（无敌）──
api.startChapter(4);
G.state = 'playing'; G.fade = 0;
let steps = 0;
while (G.state === 'playing' && steps < 120 * 200) {
  botFrame(true);
  api.step(1 / 120);
  steps++;
}
const t1 = steps / 120;
ok(G.starGot === 100, `100 颗星全部收得齐（实际 ${G.starGot}）`);
ok(G.state !== 'playing', '能走到井底并进入结局');
ok(t1 < 150, `单程时间在合理量级（${t1.toFixed(1)}s）`);
console.log(`     剩余光 ${G.p.light.toFixed(0)}　结局 ${G.endingKind}`);

// ── 2. 难度量级（会死）──
function mortalRun(budget) {
  api.startChapter(4);
  G.state = 'playing'; G.fade = 0;
  const deaths = [];
  let best = 0, deep = 0, s = 0, d0 = G.deaths;
  while (s < 120 * budget && G.state === 'playing') {
    const prevY = G.p.y, prevStar = G.starGot, d0n = G.deaths;
    botFrame(false);
    api.step(1 / 120);
    s++;
    best = Math.max(best, G.starGot);
    deep = Math.max(deep, G.p.y);
    if (G.deaths > d0n) deaths.push({ y: Math.round(prevY), star: prevStar });
  }
  return { deaths: deaths, best: best, deep: deep, n: G.deaths };
}

const m = mortalRun(180);
console.log(`     3 分钟内：死亡 ${m.n} 次，最好一次 ${m.best} 颗星，最深 y=${m.deep.toFixed(0)}`);
console.log(`     前几次死在哪：${m.deaths.slice(0, 8).map(d => `y${d.y}(${d.star}星)`).join('  ')}`);
ok(m.n > 0, '一定会死（这一关确实是地狱）');
ok(m.best >= 8, `至少能推进若干颗星（最好 ${m.best} 颗）`);
ok(m.deep >= 1000, `能打到第一组转子（最深 y=${m.deep.toFixed(0)}）`);

// ── 3. 确定性：每一次重来必须一模一样，否则背板和苦练都失去意义 ──
const a = mortalRun(30);
const b = mortalRun(30);
const same = JSON.stringify(a.deaths.slice(0, 5)) === JSON.stringify(b.deaths.slice(0, 5));
ok(same, `两次重来的死亡点完全一致（${a.deaths.slice(0, 3).map(d => 'y' + d.y).join(' / ')}）`);

console.log(fails === 0 ? '\n地狱关测试通过' : `\n地狱关测试失败 ${fails} 项`);
process.exit(fails === 0 ? 0 : 1);
