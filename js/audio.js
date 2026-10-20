/* 极简程序化配乐：55Hz 底噪 + 她的主题（完整）+ 你的主题（低八度、缺三个音）。
   没有音频文件，全部由 WebAudio 即时合成。 */
window.Audio2 = (function () {
  var ac = null, master = null;
  var layers = { amb: null, her: null, pl: null };
  var droneStarted = false;

  var BASE = 587.33;
  var LOOP = 8.0;
  var HER = [[0, 0], [0.9, 3], [1.8, 7], [2.7, 3], [3.4, 2], [4.2, 0], [5.4, -2], [6.2, 0]];
  var PL = [[0, 0], [0.9, 3], [2.7, 3], [4.2, 0], [6.2, 0]];
  var herState = { i: 0, start: 0 };
  var plState = { i: 0, start: 0 };
  var timer = null;

  function start() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { ac = new AC(); } catch (e) { return; }

    master = ac.createGain();
    master.gain.value = 0.5;
    master.connect(ac.destination);

    layers.amb = ac.createGain(); layers.amb.gain.value = 0.0; layers.amb.connect(master);
    layers.her = ac.createGain(); layers.her.gain.value = 0.0; layers.her.connect(master);
    layers.pl = ac.createGain(); layers.pl.gain.value = 0.0; layers.pl.connect(master);

    herState.start = ac.currentTime + 0.2;
    plState.start = ac.currentTime + 0.2;
    timer = setInterval(schedule, 70);
  }

  function drone() {
    if (!ac || droneStarted) return;
    droneStarted = true;
    var lp = ac.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 0.6;
    lp.connect(layers.amb);
    [[55, 0.5], [82.5, 0.28], [110, 0.10]].forEach(function (p) {
      var o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sine'; o.frequency.value = p[0];
      g.gain.value = p[1];
      o.connect(g); g.connect(lp); o.start();
    });
  }

  function playNote(t, freq, dest, amp, dur, type) {
    if (!ac) return;
    var o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(amp, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + 0.05);
  }

  function scheduleLayer(pattern, st, dest, octave, amp) {
    var ahead = ac.currentTime + 0.4;
    var guard = 0;
    while (st.start + pattern[st.i][0] < ahead && guard++ < 64) {
      var t = st.start + pattern[st.i][0];
      if (t >= ac.currentTime) {
        var f = BASE * octave * Math.pow(2, pattern[st.i][1] / 12);
        playNote(t, f, dest, amp, 2.3, 'sine');
        playNote(t, f * 2.002, dest, amp * 0.18, 1.6, 'sine');
      }
      st.i++;
      if (st.i >= pattern.length) { st.i = 0; st.start += LOOP; }
    }
  }

  function schedule() {
    if (!ac) return;
    scheduleLayer(HER, herState, layers.her, 1, 0.10);
    scheduleLayer(PL, plState, layers.pl, 0.5, 0.11);
  }

  function setLayer(name, v) {
    if (!ac || !layers[name]) return;
    drone();
    layers[name].gain.setTargetAtTime(Math.max(0, v), ac.currentTime, 0.7);
  }

  function sfx(freq, amp, dur, type) {
    if (!ac) return;
    playNote(ac.currentTime + 0.01, freq, master, amp, dur, type || 'sine');
  }

  function chime() { sfx(1568, 0.10, 2.8); sfx(2349, 0.05, 2.2); }
  function sting() { sfx(587.33, 0.10, 2.4, 'triangle'); }
  function lamp() { sfx(880, 0.09, 1.6); }
  function blip(f) { sfx(f || 880, 0.045, 0.18); }

  function impact() {
    if (!ac) return;
    var b = ac.createBuffer(1, 2048, ac.sampleRate);
    var d = b.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    var s = ac.createBufferSource(); s.buffer = b;
    var f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 220;
    var g = ac.createGain(); g.gain.value = 0.35;
    s.connect(f); f.connect(g); g.connect(master); s.start();
  }

  function mute(on) { if (master) master.gain.setTargetAtTime(on ? 0 : 0.5, ac.currentTime, 0.2); }

  function stopAll() {
    if (!ac) return;
    ['amb', 'her', 'pl'].forEach(function (k) { if (layers[k]) layers[k].gain.setTargetAtTime(0, ac.currentTime, 0.3); });
  }

  return {
    start: start, setLayer: setLayer,
    chime: chime, sting: sting, lamp: lamp, impact: impact, blip: blip,
    mute: mute, stopAll: stopAll,
    get ready() { return !!ac; }
  };
})();
