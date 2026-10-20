/* 无头冒烟测试：用桩件跑完五章，检查逻辑不崩、状态能推进、坐标不出 NaN。
   node test/headless.js */
const fs = require('fs');
const vm = require('vm');

const gradient = { addColorStop() {} };
const ctxStub = new Proxy({}, {
  get(t, k) {
    if (k === 'canvas') return { width: 1600, height: 900 };
    if (k in t) return t[k];
    return function () {
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return gradient;
      if (k === 'measureText') return { width: 8 };
    };
  },
  set(t, k, v) { t[k] = v; return true; }
});

function makeEl() {
  const set = new Set();
  return {
    style: {},
    classList: {
      add: (c) => set.add(c),
      remove: (c) => set.delete(c),
      contains: (c) => set.has(c)
    },
    addEventListener() {},
    appendChild() {},
    getContext: () => ctxStub,
    querySelector: () => makeEl(),
    textContent: '',
    innerHTML: '',
    offsetWidth: 0,
    disabled: false
  };
}

const els = {};
const documentStub = {
  readyState: 'complete',
  getElementById: (id) => (els[id] || (els[id] = makeEl())),
  createElement: () => makeEl(),
  querySelector: () => makeEl(),
  addEventListener() {}
};

const store = {};
const sandbox = {
  document: documentStub,
  console,
  Math, Date, JSON, isFinite, parseFloat, parseInt, Float32Array,
  setTimeout, clearTimeout,
  addEventListener() {},
  requestAnimationFrame() { return 0; },
  localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = v; }
  }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

for (const f of ['js/audio.js', 'js/game.js']) {
  vm.runInContext(fs.readFileSync(f, 'utf8'), sandbox, { filename: f });
}

const api = sandbox.__SDS__;
if (!api) { console.error('FAIL: 没有拿到 __SDS__'); process.exit(1); }

let failures = 0;
function check(cond, msg) {
  if (!cond) { console.error('  ✗ ' + msg); failures++; }
}

api.boot();
const G = api.G;

const chapters = [
  { i: 0, dur: 182, end: 'letter' },
  { i: 1, dur: 168, end: 'letter' },
  { i: 2, dur: 166, end: 'letter' },
  { i: 3, dur: 150, end: 'letter' }
];

for (const c of chapters) {
  api.startChapter(c.i);
  G.hpMax = 1e6; G.hp = 1e6;   // 冒烟测试关掉生命，专注"能跑完"
  const steps = Math.ceil(c.dur * 120);
  let nan = false;
  for (let s = 0; s < steps; s++) {
    api.step(1 / 120);
    if (s % 120 === 0) {
      api.render();
      if (!isFinite(G.p.x) || !isFinite(G.p.y)) nan = true;
    }
    if (G.state === 'letter') break;
  }
  check(!nan, `第${c.i + 1}章 出现 NaN 坐标`);
  check(G.state === c.end, `第${c.i + 1}章 结束时状态为 ${G.state}（期望 ${c.end}）`);
  console.log(`  第${c.i + 1}章 ok  t=${G.tt.toFixed(1)}  state=${G.state}`);
}

// 生命条：摔四次应当整关重来
api.startChapter(0);
G.hpMax = 100; G.hp = 100;
G.state = 'playing'; G.fade = 0;
let falls = 0, restarts = 0;
for (let i = 0; i < 8; i++) {
  G.p.y = 1400; G.p.vy = 0; G.p.rec = 0;   // 直接扔进雾里
  const hpBefore = G.hp;
  for (let s = 0; s < 320; s++) { api.step(1 / 120); if (G.p.rec > 0) break; }
  for (let s = 0; s < 320; s++) { api.step(1 / 120); if (G.p.rec <= 0) break; }
  if (G.hp < hpBefore) falls++;
  if (G.hp > hpBefore) restarts++;          // 血被回满 = 整关重来了
}
check(falls >= 3, `摔进雾里应当扣血（实际扣血 ${falls} 次）`);
check(restarts >= 1, '血扣光会整关重来');
console.log(`  生命条 ok  扣血${falls}次  重开${restarts}次`);

// 第五章：集齐星后到达底部 → 结局流程
api.startChapter(4);
G.state = 'playing'; G.fade = 0;
for (let s = 0; s < 240; s++) api.step(1 / 120);
G.obs = [];
for (const s of G.pickups) s.got = true;
G.starGot = G.starGoal;
G.p.y = 9300; G.p.light = 80;
for (let s = 0; s < 120; s++) api.step(1 / 120);
check(G.state === 'endseq', `第五章终点应进入 endseq，实际 ${G.state}`);
for (let s = 0; s < 1100; s++) api.step(1 / 120);
check(G.state === 'end', `结局后状态应为 end，实际 ${G.state}`);
console.log(`  第五章结局 ok  死亡=${G.deaths}  星=${G.starGot}/100  结局=${G.endingKind}`);

// 差星到达底部 → 不算通关，整关重来
api.startChapter(4);
G.state = 'playing'; G.fade = 0;
for (const s of G.pickups) s.got = false;
G.starGot = 0;
G.p.y = 9300;
G.p.vy = 0;
const t0 = G.tt;
api.step(1 / 120);
check(G.p.y < 500 && G.starGot === 0, '差星到底会被拉回井口重开');
console.log(`  差星重开 ok  y=${G.p.y.toFixed(0)}`);

// 死亡应清空星星
api.startChapter(4);
G.state = 'playing'; G.fade = 0;
for (const s of G.pickups) s.got = true;
G.starGot = 100;
G.p.y = 2000; G.p.inv = 0;
G.obs = [{ type: 'block', y: 2000, w: 900, h: 80, amp: 0, sp: 0.1, ph: 0 }];  // 压在玩家身上
api.step(1 / 120);
check(G.starGot === 0 && G.p.y === 160, '死一次：星清零、回井口');
console.log(`  死亡重置 ok  星=${G.starGot}  y=${G.p.y}`);

console.log(failures === 0 ? '\n全部通过' : `\n失败 ${failures} 项`);
process.exit(failures === 0 ? 0 : 1);
