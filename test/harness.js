/* 测试桩：用假 DOM / 假 Canvas 把游戏跑在 Node 里 */
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
if (!api) { console.error('无法加载游戏'); process.exit(1); }
api.boot();

module.exports = { sandbox, api };
