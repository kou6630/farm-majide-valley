// 演出の部品: イージング、トゥイーン
(function (root) {
  const ease = {
    linear: (t) => t,
    inQuad: (t) => t * t,
    outQuad: (t) => 1 - (1 - t) * (1 - t),
    outCubic: (t) => 1 - Math.pow(1 - t, 3),
    inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
    inBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return c3 * t * t * t - c1 * t * t; },
    outBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
    outElastic: (t) => (t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
    outBounce: (t) => {
      const n1 = 7.5625, d1 = 2.75;
      if (t < 1 / d1) return n1 * t * t;
      if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
      if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
      return n1 * (t -= 2.625 / d1) * t + 0.984375;
    },
  };

  // ---- トゥイーン ----
  const list = [];
  // opts: { delay, dur, ease, update(p, e), done() }  (p: 0..1, e: イージング後)
  function tween(opts) {
    const tw = { t0: performance.now() + (opts.delay || 0), dur: opts.dur || 300, ease: opts.ease || ease.outCubic, update: opts.update, done: opts.done, started: false, onStart: opts.start };
    list.push(tw);
    return tw;
  }
  // obj の数値プロパティを to へ。開始時点の値から補間する
  function tweenProps(obj, to, dur, easing, delay, done) {
    let from = null;
    return tween({
      delay, dur, ease: easing,
      start() { from = {}; Object.keys(to).forEach((k) => { from[k] = obj[k]; }); },
      update(p, e) { Object.keys(to).forEach((k) => { obj[k] = from[k] + (to[k] - from[k]) * e; }); },
      done,
    });
  }
  function stepTweens(now) {
    for (let i = list.length - 1; i >= 0; i--) {
      const tw = list[i];
      if (now < tw.t0) continue;
      if (!tw.started) { tw.started = true; if (tw.onStart) tw.onStart(); }
      const p = Math.min(1, (now - tw.t0) / tw.dur);
      if (tw.update) tw.update(p, tw.ease(p));
      if (p >= 1) { list.splice(i, 1); if (tw.done) tw.done(); }
    }
  }
  const later = (ms, fn) => tween({ delay: ms, dur: 1, update() {}, done: fn });

  root.FMV = Object.assign(root.FMV || {}, { ease, tween, tweenProps, stepTweens, later });
})(window);
