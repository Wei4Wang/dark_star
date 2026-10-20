'use strict';
/* 《星之暗面》 Dark Side of the Star
   五章完整版 · Canvas 2D · 无外部素材，全部程序化 */
(function () {

  // ───────────────────────── 常量 ─────────────────────────
  var W = 1600, H = 900, TAU = Math.PI * 2;
  var A_SIDE = 900, A_LIFT = 900, A_SINK = 90, A_BRAKE = 25, A_DIVE = 300;
  var K_DRAG = 1.4, V_MAX = 480, V_SINK_MAX = 320, R_LIGHT = 320;

  var clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var dist = function (ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); };
  var ease = function (t) { return t * t * (3 - 2 * t); };
  var mod = function (v, m) { return ((v % m) + m) % m; };

  // ───────────────────────── 全局状态 ─────────────────────────
  var G = {
    canvas: null, ctx: null, frame: null,
    state: 'title',       // title | chapter | playing | letter | pause | end
    lv: null, lvIndex: 0,
    tt: 0, chapT: 0, endT: 0,
    cam: { x: 0, y: 0 },
    p: null, her: null, herPath: null, herTime: 0, herMul: 1, herPause: 0,
    dust: [], parts: [], stars: [], obs: [],
    done: {}, exp: 0, stare: 0, deaths: 0,
    cloud: { a: 0, target: 0, rect: null },
    shake: 0, fade: 1, fadeDir: -1,
    flash: 0, tint: 0,
    easy: false, paused: false,
    last: 0, acc: 0, running: false,
    hintT: 0, endingKind: 'A', giveT: 0, msg: null,
    hp: 100, hpMax: 100, failPending: false, failT: 0,
    input: { x: 0, brake: false, dive: false, gaze: false, give: false }
  };

  var K = {};

  function $(id) { return typeof document !== 'undefined' ? document.getElementById(id) : null; }

  // ───────────────────────── 输入 ─────────────────────────
  function bindInput() {
    window.addEventListener('keydown', function (e) {
      K[e.code] = true;
      if (e.code === 'Escape') { togglePause(); e.preventDefault(); }
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'ArrowDown') e.preventDefault();
      if (['KeyA', 'KeyD', 'KeyW', 'KeyS', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].indexOf(e.code) >= 0) e.preventDefault();
    });
    window.addEventListener('keyup', function (e) { K[e.code] = false; });
    window.addEventListener('blur', function () { K = {}; G.mouseL = false; G.mouseR = false; });

    var cv = G.canvas;
    cv.addEventListener('mousedown', function (e) {
      if (e.button === 0) G.mouseL = true;
      if (e.button === 2) G.mouseR = true;
      e.preventDefault();
    });
    window.addEventListener('mouseup', function (e) {
      if (e.button === 0) G.mouseL = false;
      if (e.button === 2) G.mouseR = false;
    });
    cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  function readInput() {
    if (G.auto && G.p) {
      var hx = G.her ? G.her.x : G.p.x + 300;
      var hy = G.her ? G.her.y : G.p.y;
      var dd = Math.hypot(hx - G.p.x, hy - G.p.y);
      K['KeyD'] = hx - G.p.x > 40;
      K['KeyA'] = hx - G.p.x < -40;
      K['KeyW'] = dd > 260;
    }
    var x = 0;
    if (K['KeyA'] || K['ArrowLeft']) x -= 1;
    if (K['KeyD'] || K['ArrowRight']) x += 1;
    G.input.x = x;
    G.input.brake = !!(K['KeyW'] || K['ArrowUp'] || K['Space']);
    G.input.dive = !!(K['KeyS'] || K['ArrowDown']);
    G.input.gaze = !!G.mouseL;
    G.input.give = !!G.mouseR || !!K['ShiftLeft'] || !!K['ShiftRight'];
  }

  // ───────────────────────── 路径 ─────────────────────────
  function catmull(a, b, c, d, u) {
    var u2 = u * u, u3 = u2 * u;
    return 0.5 * ((2 * b) + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3);
  }

  function shiftKeys(keys, dx, dy) {
    return keys.map(function (k) { return [k[0], k[1] + dx, k[2] + (dy || 0), k[3]]; });
  }

  function makePath(keys, dur) {
    var ks = [], shift = 0;
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      ks.push({ t: k[0] + shift, x: k[1], y: k[2] });
      if (k[3]) { shift += k[3]; ks.push({ t: k[0] + shift, x: k[1], y: k[2] }); }
    }
    var N = Math.ceil(dur * 120) + 4;
    var xs = new Float32Array(N), ys = new Float32Array(N);
    var last = ks[ks.length - 1].t;
    var si = 0;
    for (var n = 0; n < N; n++) {
      var t = n / 120;
      if (t >= last) { xs[n] = ks[ks.length - 1].x; ys[n] = ks[ks.length - 1].y; continue; }
      while (si < ks.length - 2 && t > ks[si + 1].t) si++;
      var k0 = ks[Math.max(si - 1, 0)], k1 = ks[si];
      var k2 = ks[Math.min(si + 1, ks.length - 1)], k3 = ks[Math.min(si + 2, ks.length - 1)];
      var span = k2.t - k1.t;
      var u = span > 1e-4 ? clamp((t - k1.t) / span, 0, 1) : 0;
      xs[n] = catmull(k0.x, k1.x, k2.x, k3.x, u);
      ys[n] = catmull(k0.y, k1.y, k2.y, k3.y, u);
    }
    return {
      dur: dur,
      at: function (t) {
        var i = clamp(Math.floor(t * 120), 0, N - 1);
        return { x: xs[i], y: ys[i] };
      }
    };
  }

  function makeDust(w, h, n) {
    var a = [];
    for (var i = 0; i < n; i++) a.push({ x: Math.random() * w, y: Math.random() * h, p: Math.random() * TAU, s: 0.4 + Math.random() * 0.8 });
    return a;
  }

  // ───────────────────────── 粒子 ─────────────────────────
  function spawn(x, y, vx, vy, life, col, size) {
    if (G.parts.length > 700) return;
    G.parts.push({ x: x, y: y, vx: vx, vy: vy, life: life, age: 0, col: col, size: size });
  }

  function burst(x, y, n, col, spd, life) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * TAU, s = spd * (0.3 + Math.random());
      spawn(x, y, Math.cos(a) * s, Math.sin(a) * s, life * (0.6 + Math.random() * 0.7), col, 1.4 + Math.random() * 1.8);
    }
  }

  function updateParts(dt) {
    var out = [];
    for (var i = 0; i < G.parts.length; i++) {
      var p = G.parts[i];
      p.age += dt;
      if (p.age >= p.life) continue;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.985; p.vy *= 0.985;
      out.push(p);
    }
    G.parts = out;
  }

  // ───────────────────────── 玩家 ─────────────────────────
  function makePlayer(x, y) {
    return { x: x, y: y, vx: 0, vy: 0, light: 100, r: 7, t: 0, trail: [], rec: 0, fromX: x, fromY: y, toY: y, dim: 0, inv: 1.4 };
  }

  function physics(dt, lift, opt) {
    opt = opt || {};
    var p = G.p;
    var sink = opt.sink !== undefined ? opt.sink : A_SINK;
    if (G.input.brake) sink = Math.min(sink, A_BRAKE);
    if (G.input.dive) sink = A_DIVE;
    var ay = sink - lift;
    p.vx += G.input.x * A_SIDE * dt;
    p.vy += ay * dt;
    var d = Math.exp(-K_DRAG * dt);
    p.vx *= d; p.vy *= d;
    var sp = Math.hypot(p.vx, p.vy);
    if (sp > V_MAX) { p.vx *= V_MAX / sp; p.vy *= V_MAX / sp; }
    if (p.vy > V_SINK_MAX) p.vy = V_SINK_MAX;
    if (opt.wind) p.vx += opt.wind * dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (opt.minX !== undefined) p.x = clamp(p.x, opt.minX, opt.maxX);
  }

  function playerStep(dt, lift, opt) {
    var p = G.p;
    p.t += dt;
    if (p.rec > 0) {
      p.rec -= dt;
      var k = clamp(1 - p.rec / 2, 0, 1);
      p.x = p.fromX;
      p.y = lerp(p.fromY, p.toY, ease(k));
      p.vx = p.vy = 0;
      if (p.rec <= 0) p.vy = -140;
      return;
    }
    physics(dt, lift, opt);
    if (opt && opt.floor && p.y > opt.floor) {
      p.rec = 2.0;
      p.fromX = p.x; p.fromY = p.y;
      p.toY = opt.floor - 300;
      p.vx = p.vy = 0;
      G.herPause = 2.0;
      G.flash = Math.max(G.flash, 0.12);
      damage(30, 'fall');
    }
  }

  // ───────────────────────── 她的渲染辅助 ─────────────────────────
  function updateHer(dt) {
    if (!G.her || !G.herPath) return;
    G.herPause = Math.max(0, G.herPause - dt);
    G.herTime += dt * G.herMul * (G.herPause > 0 ? 0 : 1);
    var pos = G.herPath.at(G.herTime);
    // 回头看的时候朝向锁住，不再跟随运动方向
    if (G.her.x !== undefined && (G.her.look || 0) <= 0) {
      var dx = pos.x - G.her.x, dy = pos.y - G.her.y;
      var dl = Math.hypot(dx, dy);
      if (dl > 0.4) {
        var tx = dx / dl, ty = dy / dl;
        var k = 1 - Math.exp(-6 * dt);
        G.her.fx = lerp(G.her.fx === undefined ? tx : G.her.fx, tx, k);
        G.her.fy = lerp(G.her.fy === undefined ? ty : G.her.fy, ty, k);
        var fl = Math.hypot(G.her.fx, G.her.fy) || 1;
        G.her.fx /= fl; G.her.fy /= fl;
      }
    }
    G.her.x = pos.x; G.her.y = pos.y;
    G.her.look = Math.max(0, (G.her.look || 0) - dt);

    if (G.her.trail) {
      var lx = G.her._lx, ly = G.her._ly;
      if (lx === undefined || dist(lx, ly, pos.x, pos.y) > 4) {
        G.her._lx = pos.x; G.her._ly = pos.y;
        G.her.trail.push({ x: pos.x, y: pos.y, age: 0 });
      }
      for (var i = G.her.trail.length - 1; i >= 0; i--) {
        G.her.trail[i].age += dt;
        if (G.her.trail[i].age > (G.herTrailLife || 0.9)) G.her.trail.splice(i, 1);
      }
    }
  }

  // ───────────────────────── 绘制辅助 ─────────────────────────
  function glow(x, y, r, c0, c1) {
    var ctx = G.ctx;
    var g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, c0); g.addColorStop(1, c1);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  }

  // 十字星芒：让光点读起来像"星"而不是"球"
  function flare(x, y, len, alpha, rgb) {
    var ctx = G.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var g1 = ctx.createLinearGradient(x - len, y, x + len, y);
    g1.addColorStop(0, 'rgba(' + rgb + ',0)');
    g1.addColorStop(0.5, 'rgba(' + rgb + ',' + alpha + ')');
    g1.addColorStop(1, 'rgba(' + rgb + ',0)');
    ctx.fillStyle = g1;
    ctx.fillRect(x - len, y - 1.1, len * 2, 2.2);
    var g2 = ctx.createLinearGradient(x, y - len, x, y + len);
    g2.addColorStop(0, 'rgba(' + rgb + ',0)');
    g2.addColorStop(0.5, 'rgba(' + rgb + ',' + alpha + ')');
    g2.addColorStop(1, 'rgba(' + rgb + ',0)');
    ctx.fillStyle = g2;
    ctx.fillRect(x - 1.1, y - len, 2.2, len * 2);
    ctx.restore();
  }

  function drawBG() {    var ctx = G.ctx;
    ctx.fillStyle = '#03050a';
    ctx.fillRect(0, 0, W, H);

    var off = G.cam.x * 0.03;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    glow(W * 0.22 - mod(off, 400), H * 0.3, 680, 'rgba(30,50,92,0.34)', 'rgba(0,0,0,0)');
    glow(W * 0.78 - mod(off, 260), H * 0.72, 600, 'rgba(64,40,72,0.26)', 'rgba(0,0,0,0)');
    glow(W * 0.55 - mod(off * 1.7, 520), H * 0.55, 520, 'rgba(24,44,70,0.20)', 'rgba(0,0,0,0)');
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < G.stars.length; i++) {
      var s = G.stars[i];
      var sx = mod(s.x - G.cam.x * s.p, W);
      var sy = mod(s.y - G.cam.y * s.p, H);
      var tw = 0.55 + 0.45 * Math.sin(G.tt * s.t + s.p * 9);
      ctx.fillStyle = 'rgba(190,210,240,' + (s.a * tw) + ')';
      ctx.fillRect(sx, sy, s.r, s.r);
    }
    ctx.restore();
  }

  function drawDust() {
    var ctx = G.ctx;
    var x0 = G.cam.x - W / 2 - 60, x1 = G.cam.x + W / 2 + 60;
    var y0 = G.cam.y - H / 2 - 60, y1 = G.cam.y + H / 2 + 60;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < G.dust.length; i++) {
      var d = G.dust[i];
      if (d.x < x0 || d.x > x1 || d.y < y0 || d.y > y1) continue;
      var tw = 0.5 + 0.5 * Math.sin(G.tt * 1.4 * d.s + d.p);
      ctx.fillStyle = 'rgba(150,175,210,' + (0.10 + 0.16 * tw) + ')';
      ctx.fillRect(d.x, d.y, 1.6 * d.s, 1.6 * d.s);
    }
    ctx.restore();
  }

  function drawTrail(tr, col, base, life) {
    if (!tr) return;
    var ctx = G.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < tr.length; i++) {
      var t = tr[i];
      var k = 1 - t.age / life;
      if (k <= 0) continue;
      ctx.fillStyle = col.replace('$A', (0.20 * k).toFixed(3));
      ctx.beginPath(); ctx.arc(t.x, t.y, base * k + 0.6, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  function drawHer() {
    var h = G.her;
    if (!h || h.vis <= 0.001) return;
    var ctx = G.ctx;
    var a = h.vis * (1 - G.cloud.a * 0.8);

    // 视线光锥（多层叠加做出柔和的角向衰减）
    if (h.look > 0 && G.lv && G.lv.cone) {
      var lw = clamp(Math.min(1, h.look * 2), 0, 1);
      var reach = 660, half = 0.42;
      var ang = Math.atan2(h.fy || -1, h.fx || 0);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (var k = 0; k < 6; k++) {
        var hw = half * (1 - k * 0.14);
        var al = (0.012 + k * 0.006) * a * lw;
        var g = ctx.createRadialGradient(h.x, h.y, 20, h.x, h.y, reach);
        g.addColorStop(0, 'rgba(255,226,170,' + al.toFixed(3) + ')');
        g.addColorStop(0.55, 'rgba(255,214,150,' + (al * 0.45).toFixed(3) + ')');
        g.addColorStop(1, 'rgba(255,200,130,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(h.x, h.y);
        ctx.arc(h.x, h.y, reach, ang - hw, ang + hw);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }

    drawTrail(h.trail, 'rgba(255,214,150,$A)', 5.0, G.herTrailLife || 0.9);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var pulse = 1 + 0.05 * Math.sin(G.tt * 1.8);
    glow(h.x, h.y, 200 * pulse, 'rgba(255,230,190,' + (0.040 * a) + ')', 'rgba(255,196,120,0)');
    glow(h.x, h.y, 82 * pulse, 'rgba(255,234,198,' + (0.11 * a) + ')', 'rgba(255,200,130,0)');
    glow(h.x, h.y, 30 * pulse, 'rgba(255,246,228,' + (0.42 * a) + ')', 'rgba(255,220,160,0)');
    ctx.fillStyle = 'rgba(255,252,244,' + (0.96 * a) + ')';
    ctx.beginPath(); ctx.arc(h.x, h.y, 5.5, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,' + a + ')';
    ctx.beginPath(); ctx.arc(h.x, h.y, 2.6, 0, TAU); ctx.fill();
    ctx.restore();
    flare(h.x, h.y, 58 * pulse, 0.16 * a, '255,226,180');
  }

  function drawPlayer() {
    var p = G.p;
    if (!p) return;
    var ctx = G.ctx;
    var lf = clamp(p.light / 100, 0.12, 1);
    var dim = p.dim > 0 ? 0.45 : 1;
    if (p.inv > 0) dim *= (0.35 + 0.65 * Math.abs(Math.sin(G.tt * 18)));
    var s = (0.55 + 0.45 * lf) * dim;

    drawTrail(p.trail, 'rgba(120,180,235,$A)', 3.0, 0.55);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var gold = p.disguise ? 1 : 0;
    var c1 = gold ? 'rgba(255,228,170,' : 'rgba(150,205,240,';
    var c2 = gold ? 'rgba(255,200,120,0)' : 'rgba(80,150,210,0)';
    glow(p.x, p.y, 120 * s, c1 + (0.06 * s) + ')', c2);
    glow(p.x, p.y, 44 * s, c1 + (0.20 * s) + ')', c2);
    glow(p.x, p.y, 16 * s, c1 + (0.55 * s) + ')', c2);
    ctx.fillStyle = gold ? 'rgba(255,250,230,' + (0.95 * s) + ')' : 'rgba(230,245,255,' + (0.95 * s) + ')';
    ctx.beginPath(); ctx.arc(p.x, p.y, 3.4 * s + 1.6, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,' + (0.95 * s) + ')';
    ctx.beginPath(); ctx.arc(p.x, p.y, 1.8, 0, TAU); ctx.fill();
    ctx.restore();
    flare(p.x, p.y, 34, 0.12 * s, gold ? '255,236,190' : '190,225,255');
  }

  function drawParts() {
    var ctx = G.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < G.parts.length; i++) {
      var p = G.parts[i];
      var k = 1 - p.age / p.life;
      ctx.globalAlpha = k * 0.75;
      ctx.fillStyle = p.col;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.4 + k * 0.6), 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ───────────────────────── 关卡 1 · 引力 ─────────────────────────
  var L1 = {
    num: '一', name: '引力', sub: '靠近她，你才会飞',
    dur: 180, cone: true,
    world: { w: 24000, h: 1400, floor: 1240, ceiling: 80 },
    spawn: { x: 800, y: 500 },
    letter: '今天她转过来了一下。\n我知道不是看我。\n但我还是，停了两秒。',
    init: function () {
      G.herPath = makePath(shiftKeys([
        [0, 700, 520], [12, 1600, 600], [24, 2500, 500], [36, 3300, 660],
        [48, 4400, 540], [58, 5600, 680], [68, 6700, 580, 0.8], [80, 8300, 700],
        [90, 9600, 520], [100, 11000, 640], [110, 12500, 500], [118, 13700, 600],
        [126, 15200, 540], [134, 16800, 660]
      ], 500), 200);
      G.herTime = 0; G.herMul = 1;
      G.her = { x: 1200, y: 520, vis: 1, fx: 1, fy: 0, look: 0, trail: [] };
      G.herTrailLife = 0.9;
      G.dust = makeDust(24000, 1400, 7000);
      Audio2.setLayer('amb', 0.65);
      G.cloud = { a: 0, target: 0, rect: { x: 13900, y: 150, w: 5200, h: 1200 } };
      G.sinkOff = false; G.gone = false;
    },
    update: function (dt) {
      var t = G.tt, p = G.p, h = G.her;
      updateHer(dt);

      var d = dist(p.x, p.y, h.x, h.y);
      var lift = 0;
      if (!G.gone && d < R_LIGHT) {
        lift = A_LIFT * (1 - d / R_LIGHT);
        once('first', true, function () {
          Audio2.setLayer('her', 0.55);
          Audio2.chime();
          burst(h.x, h.y, 26, '#ffd79a', 180, 1.2);
        });
      }
      playerStep(dt, lift, { floor: 1240, sink: G.sinkOff ? 0 : undefined });

      once('look', t > 68, function () {
        h.look = 2.4;
        h.fx = -h.fx; h.fy = -h.fy;   // 她回头看了眼来路——你会以为她在看你
        Audio2.sting(); G.flash = 0.10;
      });
      once('cloudIn', t > 100, function () { G.cloud.target = 1; G.herTrailLife = 2.6; });
      once('fast', t > 118, function () { G.herMul = 1.35; });
      once('fade', t > 126, function () { G.herFade = 1; });
      once('gone', t > 134, function () { G.gone = true; G.sinkOff = true; G.her.vis = 0; });
      once('cloudOut', t > 142, function () { G.cloud.target = 0; Audio2.setLayer('her', 0.14); Audio2.setLayer('pl', 0.35); });
      once('end', t > 158, function () { finishLevel(); });

      if (G.herFade) { h.vis = Math.max(0, h.vis - dt * 0.5); }
      else { h.vis = 1; }

      G.cloud.a = lerp(G.cloud.a, G.cloud.target, 1 - Math.exp(-0.7 * dt));
      if (G.gone) G.herTrailLife = 2.6;
    },
    drawBack: function () {},
    drawFront: function () {
      var ctx = G.ctx;
      if (G.cloud.a > 0.01 && G.cloud.rect) {
        var r = G.cloud.rect;
        ctx.save();
        for (var i = 0; i < 16; i++) {
          var bx = r.x + mod(i * 400 + G.tt * 12, r.w);
          var by = r.y + r.h * 0.5 + Math.sin(i * 1.7 + G.tt * 0.3) * r.h * 0.3;
          glow(bx, by, 300 + Math.sin(i * 2.3) * 80, 'rgba(120,140,170,' + (0.05 * G.cloud.a) + ')', 'rgba(90,110,140,0)');
        }
        ctx.restore();
      }
    },
    drawHUD: function () {}
  };

  // ───────────────────────── 关卡 2 · 余光 ─────────────────────────
  var L2 = {
    num: '二', name: '余光', sub: '只能在她的余光里',
    dur: 170, cone: true,
    world: { w: 16000, h: 1400, floor: 1240, ceiling: 80 },
    spawn: { x: 700, y: 800 },
    letter: '我学会了待在她的余光里。\n原来这也算一种在一起。',
    init: function () {
      G.herPath = makePath(shiftKeys([
        [0, 900, 700], [15, 2100, 560], [30, 3400, 780], [45, 4700, 520],
        [58, 5900, 820], [72, 7200, 560], [86, 8500, 740], [100, 9900, 500],
        [114, 11200, 800], [128, 12600, 600], [142, 14200, 760], [156, 15600, 600]
      ], 400), 180);
      G.herTime = 0; G.herMul = 1;
      G.her = { x: 1300, y: 700, vis: 1, fx: 1, fy: 0, look: 0, trail: [] };
      G.herTrailLife = 0.9;
      G.dust = makeDust(16000, 1400, 6000);
      Audio2.setLayer('amb', 0.55);
      G.exp = 0; G.stare = 0; G.sinkOff = false;
      G.cloud.a = 0; G.cloud.target = 0;
    },
    update: function (dt) {
      var t = G.tt, p = G.p, h = G.her;
      var slow = G.input.gaze && !p.rec ? 0.45 : 1;
      var sdt = dt * slow;

      updateHer(sdt);

      if (G.stare > 0) {
        G.stare -= dt;
        p.vx *= 0.9; p.vy *= 0.9;
        p.y += p.vy * dt; p.x += p.vx * dt;
        G.exp = Math.max(0, G.exp - 70 * dt);
        if (G.stare <= 0) { p.dim = 0; }
        return;
      }

      var d = dist(p.x, p.y, h.x, h.y);
      var lift = d < R_LIGHT ? A_LIFT * (1 - d / R_LIGHT) : 0;
      playerStep(sdt, lift, { floor: 1240 });

      // 她回头时，视线会慢慢追上你——你必须绕到她身后
      if (h.look > 0 && d > 1) {
        var want = Math.atan2(p.y - h.y, p.x - h.x);
        var cur = Math.atan2(h.fy, h.fx);
        var diff = ((want - cur + Math.PI * 3) % TAU) - Math.PI;
        var stepA = clamp(diff, -0.95 * sdt, 0.95 * sdt);
        var na = cur + stepA;
        h.fx = Math.cos(na); h.fy = Math.sin(na);
      }

      // 光锥判定
      var cone = 0;
      if (d < 640 && h.look > 0) {
        var dx = p.x - h.x, dy = p.y - h.y;
        var dot = (dx * h.fx + dy * h.fy) / (d || 1);
        var ang = Math.acos(clamp(dot, -1, 1));
        if (ang < 0.42) cone = (1 - d / 640) * (1 - ang / 0.42);
      }
      if (cone > 0) G.exp += (68 * cone) * sdt * (G.input.gaze ? 1.9 : 1);
      else G.exp -= 26 * dt;
      G.exp = clamp(G.exp, 0, 100);

      if (G.exp >= 100) {
        G.exp = 0; G.stare = 1.8; p.dim = 1;
        h.look = 2.6;
        h.fx = (p.x - h.x) / (d || 1); h.fy = (p.y - h.y) / (d || 1);
        G.flash = 0.22; G.shake = 8;
        Audio2.sting(); Audio2.setLayer('her', 0.8);
        damage(12, 'seen');
        once('stared', true, function () { hint('她转过头来，看了你两秒。'); });
      }

      // 她定期回头
      once('turn1', t > 42, function () { h.look = 2.2; Audio2.setLayer('her', 0.7); });
      once('turn2', t > 92, function () { h.look = 2.2; Audio2.setLayer('her', 0.7); });
      once('turn3', t > 132, function () { h.look = 2.4; Audio2.setLayer('her', 0.75); });
      once('end', t > 162, function () { finishLevel(); });

      var hg = 0.55 + 0.25 * (G.exp / 100);
      if (Math.abs(hg - (G.lastHerAudio || 0)) > 0.04) { G.lastHerAudio = hg; Audio2.setLayer('her', hg); }
      G.sinkOff = false;
    },
    drawBack: function () {},
    drawFront: function () {},
    drawHUD: function () {
      var ctx = G.ctx;
      if (G.exp > 3) {
        var a = G.exp / 100;
        ctx.save();
        var g = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.8);
        g.addColorStop(0, 'rgba(140,20,25,0)');
        g.addColorStop(1, 'rgba(150,24,30,' + (0.55 * a) + ')');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        ctx.restore();
      }
    }
  };

  // ───────────────────────── 关卡 3 · 群星 ─────────────────────────
  var L3 = {
    num: '三', name: '群星', sub: '如果我也能发光',
    dur: 170, cone: true,
    world: { w: 18000, h: 1400, floor: 1240, ceiling: 80 },
    spawn: { x: 800, y: 780 },
    letter: '如果我也能发光，\n是不是就可以站在她旁边，不用假装。',
    init: function () {
      G.herPath = makePath(shiftKeys([
        [0, 1100, 660], [16, 2400, 540], [32, 3700, 760], [48, 5100, 520],
        [62, 6400, 700], [72, 7300, 620], [86, 8600, 700], [100, 10000, 520],
        [114, 11400, 760], [128, 12900, 580], [142, 14400, 700], [156, 16000, 560]
      ], 300), 180);
      G.herTime = 0; G.herMul = 1;
      G.her = { x: 1400, y: 660, vis: 1, fx: 1, fy: 0, look: 0, trail: [] };
      G.herTrailLife = 1.0;
      G.dust = makeDust(18000, 1400, 6000);
      Audio2.setLayer('amb', 0.45);
      G.bright = [{ ph: 0, r: 640, w: 0.32 }, { ph: 2.1, r: 760, w: -0.26 }, { ph: 4.2, r: 560, w: 0.38 }];
      G.sinkOff = false;
      G.disguise = false;
      G.exp = 0;
    },
    update: function (dt) {
      var t = G.tt, p = G.p, h = G.her;
      updateHer(dt);
      h.x = G.herPath.at(G.herTime).x;
      h.y = G.herPath.at(G.herTime).y;

      var bs = [];
      for (var i = 0; i < G.bright.length; i++) {
        var b = G.bright[i];
        var ang = t * b.w + b.ph;
        bs.push({ x: h.x + Math.cos(ang) * b.r, y: h.y + Math.sin(ang) * b.r * 0.55, i: i });
      }
      G.brightPos = bs;

      var d = dist(p.x, p.y, h.x, h.y);
      var lift = d < R_LIGHT ? A_LIFT * (1 - d / R_LIGHT) : 0;
      var cold = 0;
      for (var j = 0; j < bs.length; j++) {
        var dd = dist(p.x, p.y, bs[j].x, bs[j].y);
        if (dd < 400) { cold = Math.max(cold, 1 - dd / 400); }
      }
      if (cold > 0) { lift += 300 * cold; p.light -= 5 * dt; }

      var wantGive = G.input.give && p.light > 3 && !G.gone;
      p.disguise = wantGive;
      if (wantGive) {
        p.light -= 22 * dt;
        lift = Math.max(lift, 820);
        if (!G.done['dg']) { G.done['dg'] = 1; Audio2.setLayer('pl', 0.5); hint('你把自己点燃了。'); }
        for (var q = 0; q < bs.length; q++) {
          if (dist(p.x, p.y, bs[q].x, bs[q].y) < 300) {
            var kx = p.x - bs[q].x, ky = p.y - bs[q].y;
            var kl = Math.hypot(kx, ky) || 1;
            p.vx += kx / kl * 220; p.vy += ky / kl * 220;
            p.light -= 8;
            G.flash = 0.16; G.shake = 10;
            Audio2.impact();
            damage(12, 'noticed');
            once('noticed', true, function () { hint('它们注意到你了。'); });
            break;
          }
        }
      }
      if (p.light <= 0) { p.light = 0; p.disguise = false; }

      if (G.noLift) lift = 0;
      playerStep(dt, lift, { floor: G.noLift ? null : 1240 });
      if (G.noLift) {
        p.y = Math.min(p.y, 1340);
        if (p.y >= 1340) p.vy = 0;
      }

      once('slow', t > 70, function () { G.herMul = 0.42; });
      once('beside', t > 74, function () { if (p.disguise) hint('你们并排飞了十秒。'); });
      once('look', t > 86, function () { h.look = 2.2; Audio2.sting(); });
      once('drop', t > 88, function () {
        if (p.disguise) { p.light = 0; p.disguise = false; p.vy = 240; G.flash = 0.2; Audio2.impact(); }
        G.herMul = 1;
      });
      once('end', t > 150, function () {
        G.noLift = true; Audio2.setLayer('her', 0.12); Audio2.setLayer('pl', 0.3); hint('你掉下去了。');
      });
      once('finish', t > 156, function () { finishLevel(); });

      p.light = clamp(p.light, 0, 100);
      if (!G.done['audio3']) { G.done['audio3'] = 1; Audio2.setLayer('her', 0.5); Audio2.setLayer('amb', 0.5); }
    },
    drawBack: function () {
      var bs = G.brightPos || [];
      var ctx = G.ctx;
      for (var i = 0; i < bs.length; i++) {
        var b = bs[i];
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        var pulse = 1 + 0.06 * Math.sin(G.tt * 2 + i);
        glow(b.x, b.y, 220 * pulse, 'rgba(210,226,255,0.06)', 'rgba(160,190,255,0)');
        glow(b.x, b.y, 54 * pulse, 'rgba(236,244,255,0.22)', 'rgba(180,205,255,0)');
        glow(b.x, b.y, 15 * pulse, 'rgba(255,255,255,0.55)', 'rgba(220,235,255,0)');
        ctx.fillStyle = 'rgba(255,255,255,0.98)';
        ctx.beginPath(); ctx.arc(b.x, b.y, 3.6, 0, TAU); ctx.fill();
        ctx.restore();
        flare(b.x, b.y, 52 * pulse, 0.14, '225,240,255');
      }
    },
    drawFront: function () {},
    drawHUD: function () {}
  };

  // ───────────────────────── 关卡 4 · 风雨 ─────────────────────────
  var L4 = {
    num: '四', name: '风雨', sub: '她跟着我的时候，我也是有光的',
    dur: 150, cone: false,
    world: { w: 1800, h: 1400, floor: 1240, ceiling: 80 },
    spawn: { x: 900, y: 820 },
    letter: '她跟着我的时候，\n我第一次觉得，我也是有光的。',
    init: function () {
      G.herPath = null;
      G.her = { x: 900, y: 300, vis: 1, fx: 0, fy: 1, look: 0, trail: [], vy: 90 };
      G.herTrailLife = 1.2;
      G.dust = makeDust(1800, 1400, 800);
      G.meteors = [];
      G.meteorT = 0;
      G.wave = 1;
      G.sinkOff = false;
      Audio2.setLayer('amb', 1.0);
    },
    update: function (dt) {
      var t = G.tt, p = G.p, h = G.her;
      h.look = Math.max(0, h.look - dt);

      var giving = G.input.give && p.light > 1;
      p.disguise = giving;

      // 她自己的重力 + 你的托举
      h.vy += 58 * dt;
      if (giving) {
        h.vy -= 540 * dt;
        p.light -= 18 * dt;
      }
      h.vy = clamp(h.vy, -300, 240);
      h.y += h.vy * dt;
      h.x += (p.x - h.x) * (1 - Math.exp(-1.1 * dt));

      if (h.y > 1080) {
        h.y = 480; h.vy = -60; p.light -= 10; G.flash = 0.3; G.shake = 16;
        Audio2.impact();
        hint('她掉下去了。再撑一会儿。');
      }
      if (h.y < 220) { h.y = 220; h.vy = Math.max(h.vy, 0); }

      var d = dist(p.x, p.y, h.x, h.y);
      var lift = d < R_LIGHT ? A_LIFT * (1 - d / R_LIGHT) : 0;
      if (giving) lift *= 0.55;

      var wind = Math.sin(t * 0.7) * (t > 80 ? 260 : 140);
      playerStep(dt, lift, { floor: 1240, wind: wind, minX: 60, maxX: 1740 });

      // 陨石
      G.meteorT -= dt;
      if (G.meteorT <= 0 && t < 128) {
        G.meteorT = (t > 80 ? 0.38 : (t > 40 ? 0.55 : 0.8)) * (0.7 + Math.random() * 0.6);
        G.meteors.push({ x: h.x + (Math.random() - 0.5) * 900, y: -40, vy: 380 + Math.random() * 220, vx: (Math.random() - 0.5) * 90, r: 12 + Math.random() * 12 });
      }
      for (var i = G.meteors.length - 1; i >= 0; i--) {
        var m = G.meteors[i];
        m.x += m.vx * dt; m.y += m.vy * dt;
        if (m.y > 1500) { G.meteors.splice(i, 1); continue; }
        if (dist(m.x, m.y, p.x, p.y) < m.r + 12) {
          p.light -= 10; G.shake = 14; G.flash = 0.18;
          Audio2.impact(); burst(m.x, m.y, 14, '#ffb27a', 220, 0.8);
          damage(22, 'meteor');
          G.meteors.splice(i, 1); continue;
        }
        if (dist(m.x, m.y, h.x, h.y) < m.r + 30) {
          h.vy += 190; G.shake = 16; G.flash = 0.22;
          Audio2.impact(); burst(m.x, m.y, 18, '#ffc08a', 240, 0.9);
          G.meteors.splice(i, 1); continue;
        }
      }

      p.light = clamp(p.light, 0, 100);
      if (p.light <= 0) {
        p.light = 30; h.y = 480; h.vy = -40;
        G.flash = 0.4; hint('你的光快没了。');
      }

      once('w2', t > 40, function () { G.wave = 2; });
      once('w3', t > 80, function () { G.wave = 3; hint('风暴来了。'); });
      once('ascend', t > 126, function () { h.vy = -340; Audio2.setLayer('her', 0.8); });
      once('end', t > 142, function () { finishLevel(); });

      var plg = giving ? 0.45 : 0.2;
      if (Math.abs(plg - (G.lastPlAudio || 0)) > 0.04) { G.lastPlAudio = plg; Audio2.setLayer('pl', plg); }
    },
    drawBack: function () {
      var ctx = G.ctx;
      if (G.tt > 80) {
        ctx.save();
        ctx.strokeStyle = 'rgba(150,175,210,0.06)';
        ctx.lineWidth = 2;
        for (var i = 0; i < 16; i++) {
          var y = mod(i * 100 + G.tt * 420, H);
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(W, y + 30);
          ctx.stroke();
        }
        ctx.restore();
      }
    },
    drawFront: function () {
      var ctx = G.ctx;
      for (var i = 0; i < G.meteors.length; i++) {
        var m = G.meteors[i];
        var sp = Math.hypot(m.vx, m.vy) || 1;
        var nx = m.vx / sp, ny = m.vy / sp;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (var k = 1; k <= 6; k++) {
          var tx = m.x - nx * k * 11, ty = m.y - ny * k * 11;
          ctx.fillStyle = 'rgba(255,140,70,' + (0.15 * (1 - k / 7)).toFixed(3) + ')';
          ctx.beginPath(); ctx.arc(tx, ty, m.r * (1 - k * 0.11), 0, TAU); ctx.fill();
        }
        glow(m.x, m.y, m.r * 2.2, 'rgba(255,150,90,0.30)', 'rgba(255,100,60,0)');
        ctx.fillStyle = 'rgba(255,226,190,0.95)';
        ctx.beginPath(); ctx.arc(m.x, m.y, m.r * 0.5, 0, TAU); ctx.fill();
        ctx.restore();
      }
    },
    drawHUD: function () {}
  };

  // ───────────────────────── 关卡 5 · 暗面（地狱） ─────────────────────────
  // 规则：集齐 100 颗星才算通关；死一次 → 星星清零、从井口重新开始。
  function buildPickups(obs, n) {
    var list = [];
    var top = 380, bot = 9060;
    for (var i = 0; i < n; i++) {
      var t = i / (n - 1);
      var y = top + (bot - top) * t;
      var cycles = 1.6 * t + 1.9 * t * t;
      var amp = 150 + 300 * t;
      var x = 600 + Math.sin(Math.PI * 2 * cycles) * amp;
      x += Math.sin(i * 2.399) * 26;
      x = clamp(x, 95, 1105);
      list.push({ x: x, y: y, got: false, i: i });
    }
    // 转子中心永远被刀片穿过，星星必须避开
    for (var k = 0; k < list.length; k++) {
      var s = list[k];
      for (var j = 0; j < obs.length; j++) {
        var o = obs[j];
        if (o.type === 'rotor' && Math.abs(s.y - o.y) < 66 && Math.abs(s.x - 600) < 90) {
          s.x = 600 + (s.x >= 600 ? 1 : -1) * 230;
        }
      }
      s.x = clamp(s.x, 95, 1105);
    }
    return list;
  }

  var L5 = {
    num: '五', name: '暗面', sub: '集齐一百颗星 · 死一次就从头开始',
    dur: 9999, cone: false,
    world: { w: 1200, h: 9600, floor: 9500, ceiling: 0 },
    spawn: { x: 600, y: 160 },
    letter: '',
    init: function () {
      G.herPath = null;
      G.her = null;
      G.dust = makeDust(1200, 9600, 1800);
      G.sinkOff = false;
      G.deaths = 0;
      G.shaftT = 0;
      G.runT = 0;
      G.starGoal = 100;
      G.starGot = 0;
      G.obs = [];
      var i;
      for (i = 0; i < 5; i++) {
        G.obs.push({ type: 'rotor', y: 1400 + i * 520, len: 370 + (i % 2) * 40, w: 24, spin: (i % 2 ? 1 : -1) * (1.05 + i * 0.05), ph: i * 1.3 });
      }
      for (i = 0; i < 10; i++) {
        G.obs.push({ type: 'block', y: 3700 + i * 300, w: 560, h: 54, amp: 235, sp: 0.62 + i * 0.03, ph: i * 0.9 });
      }
      for (i = 0; i < 12; i++) {
        G.obs.push({ type: 'shard', y: 6700 + i * 230, r: 30, amp: 430, sp: 0.95 + i * 0.05, ph: i * 1.7 });
      }
      G.pickups = buildPickups(G.obs, G.starGoal);
      Audio2.setLayer('amb', 0.8);
      Audio2.setLayer('her', 0);
      Audio2.setLayer('pl', 0);
    },
    update: function (dt) {
      var p = G.p;
      G.shaftT += dt;
      G.runT += dt;

      var jet = G.input.brake && p.light > 0;
      var ay = 380;
      if (jet) { ay -= 1150; p.light -= 13 * dt; }
      p.vy += ay * dt;
      p.vy *= Math.exp(-1.1 * dt);
      p.vx += G.input.x * 900 * dt;
      p.vx *= Math.exp(-2.6 * dt);
      p.vx = clamp(p.vx, -460, 460);
      p.vy = clamp(p.vy, -420, 620);
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.x = clamp(p.x, 40, 1160);
      p.y = Math.max(p.y, 60);
      p.light = clamp(p.light, 0, 100);

      p.trail.push({ x: p.x, y: p.y, age: 0 });
      for (var k = p.trail.length - 1; k >= 0; k--) {
        p.trail[k].age += dt;
        if (p.trail[k].age > 0.5) p.trail.splice(k, 1);
      }
      if (jet && Math.random() < 0.6) spawn(p.x + (Math.random() - 0.5) * 8, p.y + 10, (Math.random() - 0.5) * 40, 160, 0.5, '#7fb2dd', 1.6);

      // 收星
      for (var i = 0; i < G.pickups.length; i++) {
        var s = G.pickups[i];
        if (s.got) continue;
        if (Math.abs(s.y - p.y) > 80) continue;
        if (dist(s.x, s.y, p.x, p.y) < 36) {
          s.got = true;
          G.starGot++;
          p.light = Math.min(100, p.light + 1.6);
          burst(s.x, s.y, 5, '#cfe6ff', 90, 0.5);
          if (G.starGot % 10 === 0) { Audio2.lamp(); G.flash = Math.max(G.flash, 0.08); }
          else Audio2.blip(760 + (G.starGot % 12) * 34);
        }
      }

      p.inv = Math.max(0, (p.inv || 0) - dt);
      if (p.inv <= 0 && this.hitTest(p.x, p.y, 7)) { die(); return; }

      if (p.y > 9280) {
        if (G.starGot >= G.starGoal) {
          G.state = 'endseq'; G.endT = 0;
          G.endingKind = p.light >= 25 ? 'A' : 'B';
          G.giveT = 0;
          Audio2.setLayer('amb', 0.5);
          Audio2.setLayer('her', 0.4);
        } else {
          G.msg = { text: '还差 ' + (G.starGoal - G.starGot) + ' 颗星', t: 2.8 };
          G.flash = 0.5; G.shake = 14;
          Audio2.impact();
          resetRun();
        }
      }
      if (p.y > 9600) p.y = 9600;
    },
    hitTest: function (x, y, r) {
      for (var i = 0; i < G.obs.length; i++) {
        var o = G.obs[i];
        var sp = G.easy ? 0.85 : 1;
        if (o.type === 'rotor') {
          if (Math.abs(y - o.y) > o.len + o.w + r) continue;
          var a = (o.ph + G.shaftT * o.spin * sp);
          var ax = Math.cos(a) * o.len, ay = Math.sin(a) * o.len;
          if (segDist(x, y, 600 - ax, o.y - ay, 600 + ax, o.y + ay) < o.w * 0.5 + r) return true;
        } else if (o.type === 'block') {
          if (Math.abs(y - o.y) > o.h * 0.5 + r + 4) continue;
          var bx = 600 + Math.sin(o.ph + G.shaftT * o.sp * sp) * o.amp;
          if (Math.abs(x - bx) < o.w * 0.5 + r && Math.abs(y - o.y) < o.h * 0.5 + r) return true;
        } else {
          if (Math.abs(y - o.y) > o.r + r + 4) continue;
          var sx = 600 + Math.sin(o.ph + G.shaftT * o.sp * sp) * o.amp;
          if (dist(x, y, sx, o.y) < o.r + r) return true;
        }
      }
      return false;
    },
    drawBack: function () {
      var ctx = G.ctx;
      ctx.save();
      ctx.fillStyle = '#04060b';
      ctx.fillRect(-400, 0, 440, 9600);
      ctx.fillRect(1200, 0, 440, 9600);
      var gL = ctx.createLinearGradient(40, 0, 190, 0);
      gL.addColorStop(0, 'rgba(78,118,168,0.30)');
      gL.addColorStop(1, 'rgba(78,118,168,0)');
      ctx.fillStyle = gL;
      ctx.fillRect(40, 0, 150, 9600);
      var gR = ctx.createLinearGradient(1200, 0, 1050, 0);
      gR.addColorStop(0, 'rgba(78,118,168,0.30)');
      gR.addColorStop(1, 'rgba(78,118,168,0)');
      ctx.fillStyle = gR;
      ctx.fillRect(1050, 0, 150, 9600);
      ctx.restore();
    },
    drawFront: function () {
      var ctx = G.ctx;
      var sp = G.easy ? 0.85 : 1;
      var i;

      // 星星连成的路
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(120,175,230,0.05)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      var started = false;
      for (i = 0; i < G.pickups.length; i++) {
        var s0 = G.pickups[i];
        if (Math.abs(s0.y - G.p.y) > 900) { started = false; continue; }
        if (!started) { ctx.moveTo(s0.x, s0.y); started = true; }
        else ctx.lineTo(s0.x, s0.y);
      }
      ctx.stroke();
      ctx.restore();

      // 未收集的星
      for (i = 0; i < G.pickups.length; i++) {
        var s = G.pickups[i];
        if (s.got) continue;
        if (Math.abs(s.y - G.p.y) > 760) continue;
        var tw = 0.7 + 0.3 * Math.sin(G.tt * 2.6 + s.i * 1.7);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = 'rgba(140,195,240,' + (0.16 * tw).toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(s.x, s.y, 13, 0, TAU); ctx.fill();
        // 四芒，让目标在黑里也能一眼认出来
        ctx.strokeStyle = 'rgba(190,225,255,' + (0.35 * tw).toFixed(3) + ')';
        ctx.lineWidth = 1;
        var L1 = 7 + 2.5 * tw;
        ctx.beginPath();
        ctx.moveTo(s.x - L1, s.y); ctx.lineTo(s.x + L1, s.y);
        ctx.moveTo(s.x, s.y - L1); ctx.lineTo(s.x, s.y + L1);
        ctx.stroke();
        ctx.fillStyle = 'rgba(235,247,255,' + (0.95 * tw).toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(s.x, s.y, 3.2, 0, TAU); ctx.fill();
        ctx.restore();
      }

      // 障碍
      for (i = 0; i < G.obs.length; i++) {
        var o = G.obs[i];
        if (Math.abs(G.p.y - o.y) > 700) continue;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        if (o.type === 'rotor') {
          var a = o.ph + G.shaftT * o.spin * sp;
          var ax = Math.cos(a) * o.len, ay = Math.sin(a) * o.len;
          ctx.strokeStyle = 'rgba(190,205,235,0.55)';
          ctx.lineCap = 'round';
          ctx.lineWidth = o.w;
          ctx.beginPath(); ctx.moveTo(600 - ax, o.y - ay); ctx.lineTo(600 + ax, o.y + ay); ctx.stroke();
          ctx.strokeStyle = 'rgba(255,240,220,0.9)';
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(600 - ax, o.y - ay); ctx.lineTo(600 + ax, o.y + ay); ctx.stroke();
          glow(600, o.y, 46, 'rgba(180,200,255,0.16)', 'rgba(0,0,0,0)');
        } else if (o.type === 'block') {
          var bx = 600 + Math.sin(o.ph + G.shaftT * o.sp * sp) * o.amp;
          ctx.fillStyle = 'rgba(30,36,48,0.95)';
          ctx.fillRect(bx - o.w / 2, o.y - o.h / 2, o.w, o.h);
          ctx.strokeStyle = 'rgba(150,175,215,0.55)';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(bx - o.w / 2, o.y - o.h / 2, o.w, o.h);
        } else {
          var sx = 600 + Math.sin(o.ph + G.shaftT * o.sp * sp) * o.amp;
          glow(sx, o.y, o.r * 3.2, 'rgba(200,120,110,0.20)', 'rgba(160,60,60,0)');
          ctx.fillStyle = 'rgba(240,180,160,0.9)';
          ctx.beginPath(); ctx.arc(sx, o.y, o.r * 0.6, 0, TAU); ctx.fill();
        }
        ctx.restore();
      }
    },
    drawHUD: function () {
      var ctx = G.ctx;
      ctx.save();
      ctx.textAlign = 'left';
      ctx.font = '15px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillStyle = 'rgba(150,165,190,0.5)';
      ctx.fillText('死亡 ' + G.deaths, 28, 40);

      ctx.textAlign = 'center';
      ctx.font = '22px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillStyle = 'rgba(228,242,255,0.85)';
      ctx.fillText(G.starGot + ' / ' + G.starGoal, W / 2, 44);

      var bw = 280, bx = W / 2 - bw / 2, by = 56;
      ctx.fillStyle = 'rgba(120,150,190,0.18)';
      ctx.fillRect(bx, by, bw, 2);
      ctx.fillStyle = 'rgba(190,225,255,0.78)';
      ctx.fillRect(bx, by, bw * (G.starGot / G.starGoal), 2);

      ctx.textAlign = 'right';
      ctx.font = '14px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillStyle = 'rgba(150,165,190,0.35)';
      ctx.fillText('一次都不能死', W - 28, 40);
      ctx.restore();
    }
  };

  function segDist(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay;
    var l2 = dx * dx + dy * dy;
    var t = l2 > 0 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  function die() {
    var p = G.p;
    G.deaths++;
    burst(p.x, p.y, 26, '#9fc4e8', 230, 0.7);
    Audio2.impact();
    G.shake = 12; G.flash = 0.28;
    G.msg = { text: '从头再来', t: 1.4 };
    resetRun();
  }

  // 死一次：星星清零、回到井口、光补满。这是第五章的全部难度来源。
  function resetRun() {
    var p = G.p;
    p.x = 600; p.y = 160; p.vx = 0; p.vy = 0; p.light = 100; p.inv = 1.4;
    p.trail.length = 0;
    G.shaftT = 0;
    G.runT = 0;
    G.starGot = 0;
    if (G.pickups) {
      for (var i = 0; i < G.pickups.length; i++) G.pickups[i].got = false;
    }
  }

  // ───────────────────────── 关卡表 ─────────────────────────
  var LEVELS = [L1, L2, L3, L4, L5];

  // ───────────────────────── 通用流程 ─────────────────────────
  // ───────────────────────── 生命（前四章） ─────────────────────────
  function damage(n, why) {
    if (G.failPending || G.state !== 'playing') return;
    G.hp = Math.max(0, G.hp - n);
    G.flash = Math.max(G.flash, 0.16);
    G.shake = Math.max(G.shake, 9);
    Audio2.impact();
    if (G.hp <= 0) {
      G.failPending = true;
      G.failT = 1.4;
      G.flash = Math.max(G.flash, 0.4);
      G.shake = Math.max(G.shake, 16);
      G.msg = { text: '这一关重来', t: 1.4 };
    }
  }

  function drawHealth() {
    var ctx = G.ctx;
    var w = 200, h = 4, x = 28, y = 26;
    var k = clamp(G.hp / G.hpMax, 0, 1);
    ctx.save();
    ctx.fillStyle = 'rgba(120,140,170,0.16)';
    ctx.fillRect(x, y, w, h);
    var col = k > 0.6 ? 'rgba(150,210,240,0.85)'
      : (k > 0.3 ? 'rgba(244,214,150,0.9)' : 'rgba(240,140,130,0.95)');
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w * k, h);
    ctx.fillStyle = 'rgba(10,14,20,0.85)';
    ctx.fillRect(x + w * 0.25 - 1, y, 1, h);
    ctx.fillRect(x + w * 0.5 - 1, y, 1, h);
    ctx.fillRect(x + w * 0.75 - 1, y, 1, h);
    ctx.restore();
  }

  function once(key, cond, fn) {
    if (!G.done[key] && cond) { G.done[key] = 1; if (fn) fn(); }
  }

  function hint(text) {
    G.hintT = 3.2;
    var el = $('hint');
    if (el) { el.textContent = text; el.classList.add('show'); }
  }

  function startChapter(i) {
    Audio2.stopAll();
    G.lvIndex = i;
    G.lv = LEVELS[i];
    G.state = 'chapter';
    G.chapT = 0;
    G.tt = 0;
    G.done = {};
    G.parts = [];
    G.exp = 0; G.stare = 0;
    G.shake = 0; G.flash = 0; G.fade = 1;
    G.hintT = 0;
    G.herFade = 0;
    G.her = null; G.herPath = null;
    G.herMul = 1; G.herPause = 0; G.herTime = 0;
    G.sinkOff = false; G.gone = false; G.noLift = false;
    G.cloud = { a: 0, target: 0, rect: null };
    G.exp = 0;
    G.lastHerAudio = 0; G.lastPlAudio = 0;
    G.msg = null;
    G.hp = G.hpMax; G.failPending = false;
    G.p = makePlayer(G.lv.spawn.x, G.lv.spawn.y);
    G.cam.x = G.lv.spawn.x; G.cam.y = G.lv.spawn.y;

    G.lv.init();

    var numEl = $('chNum'), nameEl = $('chName'), subEl = $('chSub');
    if (numEl) numEl.textContent = G.lv.num;
    if (nameEl) nameEl.textContent = G.lv.name;
    if (subEl) subEl.textContent = G.lv.sub;

    hideAll();
    show('screenChapter');
    var blk = typeof document !== 'undefined' ? document.querySelector('#screenChapter .chapter-block') : null;
    if (blk) { blk.style.animation = 'none'; void blk.offsetWidth; blk.style.animation = ''; }

    saveProgress(i);
    var h = $('hint'); if (h) h.classList.remove('show');
  }

  function beginPlay() {
    hideAll();
    G.state = 'playing';
    G.fade = 1;
  }

  function finishLevel() {
    if (G.state === 'letter') return;
    G.state = 'letter';
    Audio2.stopAll();
    var lv = G.lv;
    var el = $('letterText');
    if (el) el.textContent = lv.letter || '';
    show('screenLetter');
  }

  function showEnd() {
    G.state = 'end';
    hideAll();
    var lit = G.starGot;
    var A = G.endingKind === 'A';
    var tag = $('endTag'), title = $('endTitle'), text = $('endText'), stat = $('endStat');
    if (tag) tag.textContent = A ? '结局 · 点亮' : '结局 · 沉默';
    if (title) title.textContent = A ? '你不用知道是我' : '你们都还在';
    if (text) {
      text.textContent = A
        ? '你在暗面点亮了最后一盏灯。\n她在明面抵达顶点，整片星海为她亮起。\n她回头，看向那片什么都没有的黑暗，笑了一下。\n\n你熄灭了。\n她的轨道旁边，多了一颗很小、几乎看不见的星。'
        : '她抵达顶点，四周是暗的。\n她一个人站在那儿，抬起头，什么也没看见。\n\n你在暗处看着她。\n你们都还在，只是没有光。';
    }
    if (stat) stat.textContent = '死亡 ' + G.deaths + ' 次　·　星 ' + lit + ' / 100';
    show('screenEnd');
    Audio2.stopAll();
    if (A) { Audio2.setLayer('her', 0.8); Audio2.setLayer('amb', 0.4); }
  }

  function hideAll() {
    ['screenTitle', 'screenChapter', 'screenLetter', 'screenPause', 'screenEnd'].forEach(function (id) {
      var el = $(id); if (el) el.classList.remove('active');
    });
  }

  function show(id) {
    var el = $(id); if (el) el.classList.add('active');
  }

  function togglePause() {
    if (G.state === 'playing') {
      G.state = 'pause'; show('screenPause');
    } else if (G.state === 'pause') {
      hideAll(); G.state = 'playing';
    }
  }

  function saveProgress(i) {
    try {
      var cur = parseInt(localStorage.getItem('sds.progress') || '0', 10);
      if (i > cur) localStorage.setItem('sds.progress', String(i));
    } catch (e) {}
  }

  function loadProgress() {
    try { return parseInt(localStorage.getItem('sds.progress') || '0', 10); } catch (e) { return 0; }
  }

  // ───────────────────────── 更新 ─────────────────────────
  function step(dt) {
    if (G.state === 'chapter') {
      G.chapT += dt;
      if (G.chapT > 2.5) beginPlay();
      return;
    }
    if (G.state === 'endseq') {
      endSeq(dt);
      return;
    }
    if (G.state !== 'playing') return;

    readInput();
    G.tt += dt;
    var p = G.p;

    if (G.stare > 0 && G.lv !== L2) G.stare = 0;
    G.lv.update(dt);

    if (G.failPending) {
      // 停一拍再重开：让玩家看清自己是"被耗死的"，而不是莫名黑屏
      G.failT -= dt;
      G.input.x = 0; G.input.brake = false; G.input.dive = false;
      G.input.give = false; G.input.gaze = false;
      p.vx *= 0.9; p.vy *= 0.9;
      updateParts(dt); updateCam(dt);
      if (G.failT <= 0) { G.failPending = false; startChapter(G.lvIndex); }
      return;
    }

    p.light = clamp(p.light, 0, 100);
    p.dim = Math.max(0, p.dim - dt * 0.4);

    // 拖尾
    p.trail.push({ x: p.x, y: p.y, age: 0 });
    for (var i = p.trail.length - 1; i >= 0; i--) {
      p.trail[i].age += dt;
      if (p.trail[i].age > 0.55) p.trail.splice(i, 1);
    }

    updateParts(dt);
    updateCam(dt);

    G.flash = Math.max(0, G.flash - dt * 2.2);
    G.shake = Math.max(0, G.shake - dt * 26);

    if (G.hintT > 0) {
      G.hintT -= dt;
      if (G.hintT <= 0) { var el = $('hint'); if (el) el.classList.remove('show'); }
    }
    if (G.msg) { G.msg.t -= dt; if (G.msg.t <= 0) G.msg = null; }
  }

  function endSeq(dt) {
    readInput();
    G.endT += dt;
    var p = G.p;
    p.vy *= 0.965; p.vx *= 0.965;
    p.y += p.vy * dt; p.x += p.vx * dt;
    p.y = Math.min(p.y, 9420);
    p.x = clamp(p.x, 120, 1080);
    updateParts(dt);

    if (!G.done['endHint']) { G.done['endHint'] = 1; hint('右键　把最后的光给她'); }

    if (G.endingKind === 'A') {
      if (G.input.give) {
        G.giveT += dt;
        p.light = Math.max(0, p.light - 22 * dt);
        if (Math.random() < 0.6) spawn(p.x + (Math.random() - 0.5) * 24, p.y - 8, (Math.random() - 0.5) * 30, -200, 1.3, '#ffd9a2', 2);
        if (!G.done['giveSfx']) { G.done['giveSfx'] = 1; Audio2.chime(); }
      }
      if (G.endT > 6.5 && G.giveT < 0.4) G.endingKind = 'B';
    }

    if (G.endT > 8.5) showEnd();
    updateCam(dt);
  }

  function updateCam(dt) {
    var p = G.p, lv = G.lv;
    if (!lv) return;
    var tx = p.x + p.vx * 0.16, ty = p.y + p.vy * 0.16;
    G.cam.x += (tx - G.cam.x) * (1 - Math.exp(-7 * dt));
    G.cam.y += (ty - G.cam.y) * (1 - Math.exp(-7 * dt));
    var halfW = W / 2, halfH = H / 2;
    if (lv.world.w <= W) G.cam.x = lv.world.w / 2;
    else G.cam.x = clamp(G.cam.x, halfW, lv.world.w - halfW);
    if (lv.world.h <= H) G.cam.y = lv.world.h / 2;
    else G.cam.y = clamp(G.cam.y, halfH, lv.world.h - halfH);
  }

  // ───────────────────────── 渲染 ─────────────────────────
  function render() {
    var ctx = G.ctx;
    if (!ctx) return;
    var sx = 0, sy = 0;
    if (G.shake > 0) { sx = (Math.random() - 0.5) * G.shake; sy = (Math.random() - 0.5) * G.shake; }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawBG();

    ctx.save();
    ctx.translate(W / 2 - G.cam.x + sx, H / 2 - G.cam.y + sy);

    drawDust();
    if (G.lv && G.lv.drawBack) G.lv.drawBack();
    drawHer();
    drawPlayer();
    drawParts();
    if (G.lv && G.lv.drawFront) G.lv.drawFront();

    ctx.restore();

    // 屏幕空间
    if (G.exp > 3 && G.lv === L2) {
      var a = G.exp / 100;
      var g = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.85);
      g.addColorStop(0, 'rgba(120,16,22,0)');
      g.addColorStop(1, 'rgba(130,18,24,' + (0.6 * a) + ')');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }

    // 暗角
    var vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.42, W / 2, H / 2, H * 0.95);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.72)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

    if (G.lv && G.lv.drawHUD) G.lv.drawHUD();
    if (G.lvIndex < 4 && G.p && (G.state === 'playing' || G.state === 'chapter')) drawHealth();

    if (G.msg) {
      var ma = clamp(G.msg.t, 0, 1);
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = '30px "Songti SC","SimSun",serif';
      ctx.fillStyle = 'rgba(255,206,190,' + (0.92 * ma).toFixed(3) + ')';
      ctx.fillText(G.msg.text, W / 2, H / 2 - 40);
      ctx.restore();
    }

    if (G.flash > 0) {
      ctx.fillStyle = 'rgba(255,240,214,' + (G.flash * 0.55) + ')';
      ctx.fillRect(0, 0, W, H);
    }

    if (G.fade > 0.001) {
      ctx.fillStyle = 'rgba(0,0,0,' + G.fade + ')';
      ctx.fillRect(0, 0, W, H);
    }
  }

  // ───────────────────────── 循环 ─────────────────────────
  function loop(ts) {
    if (!G.running) return;
    requestAnimationFrame(loop);
    if (!G.last) G.last = ts;
    var dt = (ts - G.last) / 1000;
    G.last = ts;
    if (!isFinite(dt) || dt < 0) dt = 0;
    dt = Math.min(dt, 0.05);
    G.acc += dt;
    var guard = 0;
    while (G.acc >= 1 / 120 && guard++ < 10) {
      step(1 / 120);
      G.acc -= 1 / 120;
    }
    if (G.fade > 0) G.fade = Math.max(0, G.fade - dt * 0.9);
    render();
  }

  // ───────────────────────── 启动 ─────────────────────────
  function buildStars() {
    G.stars = [];
    for (var i = 0; i < 220; i++) {
      G.stars.push({
        x: Math.random() * W, y: Math.random() * H,
        r: Math.random() < 0.85 ? 1 : 2,
        a: 0.15 + Math.random() * 0.5,
        p: Math.random(),
        t: 0.6 + Math.random() * 1.8
      });
    }
  }

  function boot() {
    G.canvas = $('game');
    G.frame = $('frame');
    if (!G.canvas) return;
    G.ctx = G.canvas.getContext('2d');
    buildStars();
    bindInput();

    var startBtn = $('btnStart');
    if (startBtn) startBtn.addEventListener('click', function () {
      Audio2.start();
      var prog = loadProgress();
      startChapter(Math.min(prog, 4));
    });

    var chapBtn = $('btnChapters');
    if (chapBtn) chapBtn.addEventListener('click', function () {
      var row = $('chapterRow');
      if (!row) return;
      row.innerHTML = '';
      var prog = loadProgress();
      for (var i = 0; i < 5; i++) {
        (function (idx) {
          var b = document.createElement('button');
          b.textContent = '第' + LEVELS[idx].num + '章';
          if (idx > prog) { b.classList.add('locked'); b.disabled = true; }
          b.addEventListener('click', function () { Audio2.start(); startChapter(idx); });
          row.appendChild(b);
        })(i);
      }
    });

    var lb = $('btnLetter');
    if (lb) lb.addEventListener('click', function () {
      if (G.lvIndex >= 4) { showEnd(); return; }
      startChapter(G.lvIndex + 1);
    });

    var rb = $('btnResume');
    if (rb) rb.addEventListener('click', function () { hideAll(); G.state = 'playing'; });
    var rt = $('btnRestart');
    if (rt) rt.addEventListener('click', function () { startChapter(G.lvIndex); });
    var qt = $('btnQuit');
    if (qt) qt.addEventListener('click', function () { G.state = 'title'; hideAll(); show('screenTitle'); Audio2.stopAll(); G.exp = 0; });
    var eb = $('btnEasy');
    if (eb) eb.addEventListener('click', function () {
      G.easy = !G.easy;
      eb.textContent = G.easy ? '开' : '关';
    });
    var ebb = $('btnEndBack');
    if (ebb) ebb.addEventListener('click', function () { G.state = 'title'; hideAll(); show('screenTitle'); Audio2.stopAll(); G.exp = 0; });

    var chapterScreen = $('screenChapter');
    if (chapterScreen) chapterScreen.addEventListener('click', function () { if (G.state === 'chapter' && G.chapT > 0.6) beginPlay(); });

    G.running = true;
    G.last = 0;
    requestAnimationFrame(loop);

    // 调试入口：?ch=0&play&t=68 直接跳到第一章第 68 秒
    try {
      if (typeof location !== 'undefined' && location.search && location.search.length > 1) {
        var q = {};
        location.search.substring(1).split('&').forEach(function (kv) {
          var p = kv.split('='); q[p[0]] = p.length > 1 ? p[1] : '1';
        });
        if (q.ch !== undefined) {
          startChapter(parseInt(q.ch, 10) || 0);
          if (q.play) { G.state = 'playing'; hideAll(); G.fade = 0; }
          if (q.auto) G.auto = true;
          if (q.t) {
            var n = Math.floor(parseFloat(q.t) * 120);
            for (var i = 0; i < n; i++) step(1 / 120);
          }
          if (q.x !== undefined) G.p.x = parseFloat(q.x);
          if (q.y !== undefined) { G.p.y = parseFloat(q.y); G.p.vy = 0; G.p.inv = 99; }
          if (q.y !== undefined) { G.cam.y = G.p.y; }
          if (q.ending) { G.endingKind = q.ending; G.deaths = 37; G.starGot = 100; showEnd(); }
        }
      }
    } catch (e) {}
  }

  if (typeof window !== 'undefined') {
    window.__SDS__ = {
      G: G, boot: boot, startChapter: startChapter, step: step, render: render,
      press: function (code, down) { K[code] = !!down; },
      setState: function (s) { G.state = s; }
    };
    if (typeof document !== 'undefined') {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
      else boot();
    }
  }

})();
