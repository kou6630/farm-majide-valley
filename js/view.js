// 画面: アイソメ(斜め見下ろし)の Canvas 描画、入力(ドラッグ/パン/ズーム)、演出、HUD、パネル
(function (root) {
  const F = root.FMV;
  const { TILE_W, TILE_H, MAX_TIER, MAX_ENERGY, CHAINS, INGREDIENTS, OBSTACLES, OBS_STEPS, BUILDINGS, LANDS, DECOR, ROADS, LAYOUT_CUSTOM, key, rectCells, xpForLevel } = F;
  const { ease, tween, tweenProps, later } = F;

  const HW = TILE_W / 2, HH = TILE_H / 2;
  const OX = 1800, OY = 800; // タイル (0,0) の上の頂点
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const $ = (id) => document.getElementById(id);

  // ---------- 素材 ----------
  const imgs = {};
  // 建物・景観の表示設定: w=表示幅(ワールド座標)、ay=絵の高さのどこに足元の中心が来るか
  const SPRITE = {
    market: { w: 270, ay: 0.7 }, dairy: { w: 260, ay: 0.72 }, bakery: { w: 260, ay: 0.72 },
    house: { w: 440, ay: 0.62 }, barn: { w: 600, ay: 0.64 }, windmill: { w: 250, ay: 0.8 },
  };
  const SHOP_ART = /^(market|bakery|dairy|bbq|sweets|loom|barista|tomatocar)(_broken)?$/;
  function spriteGeom(name) {
    const im = imgs['ref/' + name];
    const sp = SPRITE[name] || (SHOP_ART.test(name) && ready(im) ? { w: Math.round(im.naturalWidth / im.exportScale * 0.9), ay: 0.72 } : null);
    if (!ready(im) || !sp) return null;
    const w = sp.w, h = im.naturalHeight * w / im.naturalWidth;
    return { im, w, h, x0: -w / 2, y0: -h * sp.ay };
  }
  // 取り込んだ絵(assets/ref/*.png)と、自作の絵(assets/*/*.svg)
  const REF = ['g_a0', 'g_a1', 'g_a2', 'g_a3', 'g_a4', 'g_a5', 'g_a6', 'g_a7', 'g_a8', 'g_b0', 'g_b1', 'g_b2', 'g_b3', 'g_b4', 'g_b5', 'g_b6',
    'g_tactical_light', 'g_tactical_dark',
    'tactical_road', 'tactical_tree', 'tactical_bush', 'tactical_house', 'tactical_barn', 'tactical_windmill', 'tactical_lamp', 'tactical_pond',
    'tile_cloud_tactical', 'market', 'dairy', 'bakery', 'coin', 'bolt', 'crown', 'clock', 'gem'];
  const SHOP_KEYS = ['market', 'bakery', 'dairy', 'bbq', 'sweets', 'loom', 'barista', 'tomatocar'];
  const TACTICAL_CHAIN = /^ref\/items\/(wheat|chicken|cow|sugarcane|carrot|goat|edamame|pig|sunflower|corn|sheep|coffee|deer|tomato)_([0-5])$/;
  const TACTICAL_BONUS = /^ref\/items\/(toolbox|lockbox|keys)_([0-2])$/;
  const TACTICAL_OBSTACLE = /^ref\/items\/obs_(rock|tree)_[sml]$/;
  const TACTICAL_SHOP = /^ref\/(market|bakery|dairy|bbq|sweets|loom|barista|tomatocar)(_broken)?$/;
  const assetUrl = (name) => {
    if (TACTICAL_OBSTACLE.test(name) || TACTICAL_SHOP.test(name)) {
      const slash = name.lastIndexOf('/');
      return `assets/${name.slice(0, slash + 1)}tactical_${name.slice(slash + 1)}.png`;
    }
    const match = name.match(TACTICAL_CHAIN) || name.match(TACTICAL_BONUS);
    return match ? `assets/ref/items/tactical_${match[1]}_${Math.min(Number(match[2]), 4)}.png`
      : `assets/${name}.${name.startsWith('ui/tactical/') ? 'svg' : 'png'}`;
  };
  function assetNames() {
    const n = [];
    Object.keys(CHAINS).forEach((k) => { for (let t = CHAINS[k].minTier || 0; t < CHAINS[k].count; t++) n.push(`ref/items/${k}_${t}`); });
    Object.keys(INGREDIENTS).forEach((k) => n.push('ref/items/ing_' + k));
    Object.values(OBSTACLES).forEach((o) => n.push('ref/items/' + o.sprite));
    REF.forEach((x) => n.push('ref/' + x));
    SHOP_KEYS.forEach((k) => n.push('ref/' + k, 'ref/' + k + '_broken'));
    ['lock', 'worker'].forEach((x) => n.push('ref/' + x));
    Object.values(BUILDINGS).forEach((bd) => bd.recipes.forEach((rc) => n.push('ref/products/' + rc.id)));
    n.push('ref/cards/arrow', 'ref/cards/frame_1', 'ref/cards/frame_2', 'ref/cards/frame_3');
    Object.keys(CHAINS).forEach((k) => { if (CHAINS[k].type !== 'bonus') n.push('ref/cards/pic_' + k); });
    ['coin', 'gem', 'bolt', 'rank', 'lock', 'worker', 'clock'].forEach((x) => n.push('ui/tactical/' + x));
    return n;
  }
  function loadAssets(onProgress) {
    const names = assetNames();
    let done = 0;
    const fin = () => { done++; onProgress(done / names.length); };
    return Promise.all(names.map((name) => new Promise((resolve) => {
      const im = new Image();
      im.onload = () => { fin(); resolve(); };
      im.onerror = () => { console.warn('素材が読めません:', name); fin(); resolve(); };
      if (name.startsWith('ref/items/')) im.tight = true; // 切り出したままの絵: 足元が下端、幅が表示幅の2倍
      // 5種類目と6種類目は同じ絵。6種類目だけ描画時に暗くする。
      const tactical = name.match(TACTICAL_CHAIN);
      im.withered = !!tactical && tactical[2] === '5';
      im.keepWitheredColor = !!tactical && tactical[1] !== 'wheat';
      im.exportScale = tactical || TACTICAL_BONUS.test(name) || TACTICAL_OBSTACLE.test(name) || TACTICAL_SHOP.test(name) ? 4 : 1;
      im.src = assetUrl(name);
      imgs[name] = im;
    }))).then(() => {
      // 外周の景観だけを差し替える。ショップ・アイテム・市松タイルは別の素材。
      Object.entries({ house: 'house', barn: 'barn', windmill: 'windmill', lamp: 'lamp', tree: 'tree', tree_2: 'tree', tree_3: 'tree', bush_a: 'bush' })
        .forEach(([alias, name]) => { imgs['ref/' + alias] = imgs['ref/tactical_' + name]; });
      Object.entries({ coin: 'coin', energy: 'bolt', gems: 'gem', crown: 'rank', lock: 'lock', worker: 'worker', clock: 'clock' })
        .forEach(([alias, name]) => { imgs['ui/' + alias] = imgs['ui/tactical/' + name]; });
      // HUDに重ねる手描きの絵と、飛び込む報酬の絵を揃える。
      Object.entries({ coin: 'coin', energy: 'bolt', gems: 'gem', crown: 'crown', worker: 'worker', clock: 'clock' })
        .forEach(([alias, name]) => { imgs['ui/' + alias] = imgs['ref/' + name]; });
    });
  }
  const ready = (im) => !!(im && im.complete && im.naturalWidth);
  const spriteOf = (it) => {
    if (it.t === 'chain') return imgs[`ref/items/${it.k}_${it.tier}`];
    if (it.t === 'ing') return imgs[`ref/items/ing_${it.k}`];
    return imgs['ref/items/' + OBSTACLES[it.k].sprite];
  };

  // ---------- 座標(アイソメ) ----------
  // 連続タイル座標 (cc, rr) → ワールド座標。タイル (c,r) の上の頂点 = (cc=c, rr=r)
  const proj = (cc, rr) => [OX + (cc - rr) * HW, OY + (cc + rr) * HH];
  const tileTop = (c, r) => proj(c, r);
  const tileCenter = (c, r) => proj(c + 0.5, r + 0.5);
  const tileFeet = (c, r) => { const p = tileCenter(c, r); return [p[0], p[1] + HH * 0.42]; };
  const unproj = (x, y) => { const u = (x - OX) / HW, v = (y - OY) / HH; return [(u + v) / 2, (v - u) / 2]; };
  const tileAt = (x, y) => { const [cc, rr] = unproj(x, y); return [Math.floor(cc), Math.floor(rr)]; };
  const depthOf = (c, r) => c + r + 2;

  function createView(engine, canvas, hooks) {
    const ctx = canvas.getContext('2d');
    let vw = 0, vh = 0, dpr = 1;
    const cam = { x: OX, y: OY + 190, zoom: 1 };
    let shake = 0;

    const vis = new Map();
    const getVis = (id) => {
      let v = vis.get(id);
      if (!v) { v = { ox: 0, oy: 0, sx: 1, sy: 1, rot: 0, alpha: 1, hideUntil: 0, phase: Math.random() * 6.28 }; vis.set(id, v); }
      return v;
    };

    const parts = [], floaters = [], flyers = [], fxList = [];
    const dissolving = {}, tileAnim = {}, bsquash = {};
    const hold = { coins: 0, energy: 0, gems: 0 };
    const disp = { coins: 0, energy: 0, gems: 0, xp: 0 };
    let drag = null, lastDrop = null, lastDropFrom = null, pressed = null, panelFor = null, bdrag = null;
    let obstacleFocus = null;
    const lvQueue = [];

    // ---------- 地形の準備 ----------
    const landCells = new Map(); // "c,r" -> land
    LANDS.forEach((l) => l.cells.forEach(([c, r]) => landCells.set(key(c, r), l)));
    const blocked = new Set();
    LANDS.forEach((l) => l.coverCells.forEach(([c, r]) => blocked.add(key(c, r))));
    const roadCells = [];
    ROADS.forEach(([c, r, w, h]) => { for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) { roadCells.push([x, y]); blocked.add(key(x, y)); } });
    const roadSet = new Set(roadCells.map(([c, r]) => key(c, r)));
    const roadPath = new Path2D();
    const roadEdges = [], edgesFrom = new Map();
    roadCells.forEach(([c, r]) => {
      const corners = [[c, r], [c + 1, r], [c + 1, r + 1], [c, r + 1]];
      [[c, r - 1], [c + 1, r], [c, r + 1], [c - 1, r]].forEach(([x, y], i) => {
        if (roadSet.has(key(x, y))) return;
        const edge = { a: corners[i], b: corners[(i + 1) % 4], soft: !blocked.has(key(x, y)), dir: i };
        roadEdges.push(edge);
        const k = key(...edge.a); if (!edgesFrom.has(k)) edgesFrom.set(k, []); edgesFrom.get(k).push(edge);
      });
    });
    // 道の草地側だけ小さく面取りし、畑の側はマスにぴったり合わせる。
    const visitedEdges = new Set();
    roadEdges.forEach((first) => {
      if (visitedEdges.has(first)) return;
      const loop = []; let edge = first;
      while (edge && !visitedEdges.has(edge)) {
        loop.push(edge); visitedEdges.add(edge);
        edge = (edgesFrom.get(key(...edge.b)) || []).filter((e) => !visitedEdges.has(e))
          .sort((a, b) => ((a.dir - edge.dir + 3) % 4) - ((b.dir - edge.dir + 3) % 4))[0];
      }
      const rounded = loop.map((e, i) => {
        const prev = loop[(i + loop.length - 1) % loop.length], p = proj(...e.a), a = proj(...prev.a), b = proj(...e.b);
        const radius = prev.soft && e.soft ? 0.18 : 0;
        return { p, in: [lerp(p[0], a[0], radius), lerp(p[1], a[1], radius)], out: [lerp(p[0], b[0], radius), lerp(p[1], b[1], radius)] };
      });
      roadPath.moveTo(...rounded[0].in);
      rounded.forEach((p) => { roadPath.lineTo(...p.in); roadPath.lineTo(...p.out); }); roadPath.closePath();
    });
    const cloudShapes = new Map();
    LANDS.forEach((land) => {
      const cells = new Set(land.coverCells.map(([c, r]) => key(c, r))), outline = [];
      land.coverCells.forEach(([c, r]) => {
        if (!cells.has(key(c, r - 1))) outline.push([c, r, c + 1, r]);
        if (!cells.has(key(c + 1, r))) outline.push([c + 1, r, c + 1, r + 1]);
        if (!cells.has(key(c, r + 1))) outline.push([c + 1, r + 1, c, r + 1]);
        if (!cells.has(key(c - 1, r))) outline.push([c, r + 1, c, r]);
      });
      cloudShapes.set(land.id, { cells, outline });
    });
    DECOR.forEach((d) => { const [c, r, w, h] = d.rect; for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) blocked.add(key(x, y)); });

    // 森: 島から離れるほど密に
    let sd = 4242;
    const rnd = () => { sd = (sd * 16807) % 2147483647; return (sd - 1) / 2147483646; };
    const dist = new Map();
    {
      const q = [];
      blocked.forEach((k) => { dist.set(k, 0); q.push(k.split(',').map(Number)); });
      for (let i = 0; i < q.length; i++) {
        const [c, r] = q[i], d = dist.get(key(c, r));
        if (d >= 9) continue;
        [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].forEach(([dx, dy]) => {
          const nk = key(c + dx, r + dy);
          if (!dist.has(nk)) { dist.set(nk, d + 1); q.push([c + dx, r + dy]); }
        });
      }
    }
    const forest = [];
    // 森の範囲: マップエディタの地図なら、土地・道のある範囲のまわり。そうでなければ、決まった範囲
    let fc0 = -22, fc1 = 24, fr0 = -22, fr1 = 26;
    if (LAYOUT_CUSTOM) {
      fc0 = 1e9; fc1 = -1e9; fr0 = 1e9; fr1 = -1e9;
      blocked.forEach((k) => { const [c, r] = k.split(',').map(Number); fc0 = Math.min(fc0, c - 12); fc1 = Math.max(fc1, c + 12); fr0 = Math.min(fr0, r - 12); fr1 = Math.max(fr1, r + 12); });
    }
    for (let c = fc0; c <= fc1; c++) {
      for (let r = fr0; r <= fr1; r++) {
        const u = c - r, v = c + r;
        if (!LAYOUT_CUSTOM && (Math.abs(u) > 26 || v < -18 || v > 28)) continue;
        const k = key(c, r);
        if (blocked.has(k)) continue;
        if (LAYOUT_CUSTOM && dist.get(k) == null) continue;
        const d = dist.get(k) == null ? 9 : dist.get(k);
        const patch = 0.85 + 0.15 * Math.sin(c * 0.43 + r * 0.27) + 0.12 * Math.cos(c * 0.21 - r * 0.38);
        const p = d <= 2 ? 0 : (d === 3 ? 0.2 : d === 4 ? 0.38 : 0.58) * patch;
        const tc = c + 0.5 + (rnd() - 0.5) * 0.4, tr = r + 0.5 + (rnd() - 0.5) * 0.4;
        const [fx, yy] = proj(tc, tr), fy = yy + HH * 0.4;
        if (d <= 3 && rnd() < (d === 1 ? 0.13 : 0.27)) {
          const w = 54 + rnd() * 25, h = w * 96 / 110;
          forest.push({ img: 'ref/bush_a', x: fx, y: fy, w, h, depth: tc + tr + 1, ax: w / 2, ay: h * 0.92, mirror: rnd() > 0.5 });
        }
        if (rnd() < p) {
          const w = 100 + rnd() * 43, h = w * 229 / 180, v2 = ['tree', 'tree_2', 'tree_3'][Math.floor(rnd() * 3)];
          forest.push({ img: 'ref/' + v2, x: fx, y: fy, w, h, depth: tc + tr + 1, ax: w / 2, ay: h * 0.95, mirror: rnd() > 0.5 });
        }
      }
    }
    forest.sort((a, b) => a.depth - b.depth);

    // ---------- カメラ ----------
    // 農場と景観の端に一マスだけ余白を残す。
    const BOUND = (() => {
      let x0 = OX - 1000, x1 = OX + 1000, y0 = OY + 20, y1 = OY + 700;
      if (LAYOUT_CUSTOM) {
        x0 = Infinity; x1 = -Infinity;
        blocked.forEach((k) => {
          const [c, r] = k.split(',').map(Number), [x, y] = proj(c + 0.5, r + 0.5);
          x0 = Math.min(x0, x - HW - TILE_W); x1 = Math.max(x1, x + HW + TILE_W);
          y0 = Math.min(y0, y - 300); y1 = Math.max(y1, y + 600);
        });
      }
      return { x0, x1, y0, y1 };
    })();
    function clampCam() {
      // 横長の画面でも、縮小しすぎて左右が森ばかりにならないようにする。
      const minZoom = LAYOUT_CUSTOM ? Math.max(0.3, Math.min(1.6, vw / (BOUND.x1 - BOUND.x0))) : 0.3;
      cam.zoom = clamp(cam.zoom, minZoom, 1.6);
      const halfWidth = vw / (cam.zoom * 2);
      const left = BOUND.x0 + halfWidth, right = BOUND.x1 - halfWidth;
      cam.x = left >= right ? (BOUND.x0 + BOUND.x1) / 2 : clamp(cam.x, left, right);
      cam.y = clamp(cam.y, BOUND.y0, BOUND.y1);
    }
    function resetCamera() {
      obstacleFocus = null;
      cam.zoom = vw > vh ? clamp(Math.min(vw / 1220, vh / 700), 0.4, 1.1) : clamp(vw / 760, 0.34, 1.1);
      cam.x = OX; cam.y = OY + 200 + (vh > vw ? 60 : 40);
      clampCam();
    }
    let camInit = false;
    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = canvas.getBoundingClientRect();
      vw = Math.round(r.width || window.innerWidth); vh = Math.round(r.height || window.innerHeight);
      if (vw < 2 || vh < 2) return; // まだ大きさが決まっていない
      canvas.width = Math.round(vw * dpr); canvas.height = Math.round(vh * dpr);
      if (!camInit) { camInit = true; resetCamera(); } else clampCam();
    }
    const w2s = (x, y) => [(x - cam.x) * cam.zoom + vw / 2, (y - cam.y) * cam.zoom + vh / 2];
    const s2w = (sx, sy) => [(sx - vw / 2) / cam.zoom + cam.x, (sy - vh / 2) / cam.zoom + cam.y];

    // ---------- パーティクル等 ----------
    function addPart(p) { parts.push(Object.assign({ age: 0, life: 0.7, vx: 0, vy: 0, g: 0, size: 8, color: '#fff', type: 'dot', rot: 0, vr: 0, grow: 0 }, p)); }
    function burst(x, y, n, o = {}) {
      const colors = o.colors || ['#fff7a8', '#ffd23f', '#ffffff', '#ffb3d1'];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * 6.283 + Math.random() * 0.5, sp = (o.speed || 260) * (0.5 + Math.random() * 0.7);
        addPart({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.7 - (o.up || 40), g: o.g == null ? 420 : o.g, life: 0.5 + Math.random() * 0.45, size: (o.size || 16) * (0.6 + Math.random() * 0.7), color: colors[i % colors.length], type: o.type || 'spark', rot: Math.random() * 6, vr: (Math.random() - 0.5) * 8 });
      }
    }
    function puff(x, y, n, color = '#e9dcc0', spread = 50) {
      for (let i = 0; i < n; i++) addPart({ x: x + (Math.random() - 0.5) * spread, y: y + (Math.random() - 0.5) * 12, vx: (Math.random() - 0.5) * 90, vy: -30 - Math.random() * 50, life: 0.5 + Math.random() * 0.3, size: 14 + Math.random() * 14, grow: 40, color, type: 'puff' });
    }
    function ring(x, y, color = '#fff7a8', size = 90) { addPart({ x, y, life: 0.45, size, color, type: 'ring' }); }
    function confetti(x, y) {
      const cs = ['#ff7aa8', '#ffd23f', '#7ad0ff', '#7ccc4a', '#ff9a3c'];
      for (let i = 0; i < 70; i++) addPart({ x, y, vx: (Math.random() - 0.5) * 900, vy: -300 - Math.random() * 700, g: 900, life: 1.4 + Math.random(), size: 10 + Math.random() * 8, color: cs[i % 5], type: 'confetti', rot: Math.random() * 6, vr: (Math.random() - 0.5) * 14 });
    }
    function floater(x, y, text, color = '#fff', size = 30) { floaters.push({ x, y, text, color, size, age: 0, life: 1.1 }); }
    function addFx(dur, draw, done) { fxList.push({ t0: performance.now(), dur, draw, done }); }

    function flyTo(startWorld, kind, n, value) {
      const target = kind === 'energy' ? $('energy-pill') : kind === 'gems' ? $('gem-pill') : $('coin-pill');
      const im = target.querySelector('img').getBoundingClientRect();
      const tx = im.left + im.width / 2, ty = im.top + im.height / 2;
      const [sx, sy] = w2s(startWorld[0], startWorld[1]);
      const each = value / n;
      hold[kind] += value;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.28, d = 30 + Math.random() * 50;
        flyers.push({ x0: sx, y0: sy, cx: sx + Math.cos(a) * d * 2, cy: sy + Math.sin(a) * d * 2 - 70, x1: tx, y1: ty, t0: performance.now() + i * 70 + 80, dur: 650 + Math.random() * 200, img: imgs[kind === 'energy' ? 'ui/energy' : kind === 'gems' ? 'ui/gems' : 'ui/coin'], kind, amt: each, el: target });
      }
    }

    // ---------- 描画ヘルパー ----------
    function cutRect(x, y, w, h, r) {
      const cut = Math.min(r, w / 4, h / 3);
      ctx.beginPath();
      ctx.moveTo(x + cut, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + h - cut);
      ctx.lineTo(x + w - cut, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + cut); ctx.closePath();
    }
    function diamondPath(c, r, inset = 0) {
      const [x, y] = tileTop(c, r);
      ctx.beginPath();
      ctx.moveTo(x, y + inset * 0.5); ctx.lineTo(x + HW - inset, y + HH); ctx.lineTo(x, y + TILE_H - inset * 0.5); ctx.lineTo(x - HW + inset, y + HH); ctx.closePath();
    }
    function star(x, y, r, rot, color, alpha) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.globalAlpha = alpha; ctx.fillStyle = color;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) { const rr = i % 2 ? r * 0.28 : r; const a = (i / 8) * 6.283; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
      ctx.closePath(); ctx.fill(); ctx.restore();
    }
    // 足元 (x, y) に品物の足元が来るように描く
    function drawSprite(im, x, y, size, o = {}) {
      if (!ready(im)) return;
      let art = im;
      if (im.withered) {
        // Canvas.filter がないスマホでも同じ色になるよう一度だけ色を変える。
        if (!im.darkArt) {
          const layer = document.createElement('canvas'); layer.width = im.naturalWidth; layer.height = im.naturalHeight;
          const lc = layer.getContext('2d'); lc.drawImage(im, 0, 0);
          const pixels = lc.getImageData(0, 0, layer.width, layer.height), data = pixels.data;
          for (let i = 0; i < data.length; i += 4) {
            if (im.keepWitheredColor) {
              data[i] *= 0.33; data[i + 1] *= 0.33; data[i + 2] *= 0.33;
            } else {
              const gray = (data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722) * 0.33;
              data[i] = data[i + 1] = data[i + 2] = gray;
            }
          }
          lc.putImageData(pixels, 0, 0); im.darkArt = layer;
        }
        art = im.darkArt;
      }
      ctx.save();
      ctx.translate(x + (o.ox || 0), y + (o.oy || 0));
      if (o.rot) ctx.rotate(o.rot);
      ctx.scale(o.sx == null ? 1 : o.sx, o.sy == null ? 1 : o.sy);
      ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
      if (im.tight) {
        const k = size / 118 / im.exportScale, w = im.naturalWidth / 2 * k, h = im.naturalHeight / 2 * k;
        ctx.drawImage(art, -w / 2, -h * 0.97, w, h);
      } else ctx.drawImage(art, -size / 2, -size * 0.9, size, size);
      ctx.restore();
    }
    function shadow(x, y, size, lift = 0, alpha = 1) {
      const s = 1 - Math.min(0.4, lift / 140);
      ctx.save();
      ctx.globalAlpha = 0.22 * alpha * s;
      ctx.fillStyle = '#1d3a12';
      ctx.beginPath(); ctx.ellipse(x, y - 1, size * 0.27 * s, size * 0.075 * s, 0, 0, 6.283); ctx.fill();
      ctx.restore();
    }

    // ---------- 品物の描画 ----------
    function idleOf(it, v, t) {
      const ph = v.phase;
      if (it.t === 'chain') {
        const ch = CHAINS[it.k];
        if (ch.type === 'animal') { const b = Math.sin(t * 2.2 + ph); return { sx: 1 - 0.018 * b, sy: 1 + 0.032 * b, rot: 0, oy: 0 }; }
        if (ch.type === 'crop') return { sx: 1, sy: 1, rot: 0.03 * Math.sin(t * 1.6 + ph), oy: 0 };
        if (it.k === 'energy') { const p = 1 + 0.045 * Math.sin(t * 3 + ph); return { sx: p, sy: p, rot: 0, oy: 0 }; }
        return { sx: 1, sy: 1, rot: 0.02 * Math.sin(t * 2 + ph), oy: -3 * Math.sin(t * 2.4 + ph) };
      }
      if (it.t === 'ing') return { sx: 1, sy: 1, rot: 0, oy: -2 * Math.sin(t * 2 + ph) };
      return { sx: 1, sy: 1, rot: 0, oy: 0 };
    }
    // 絵の見た目の幅と高さ(影・光・吹き出し・つかむ範囲に使う)
    function dimsOf(it) {
      const im = spriteOf(it);
      if (im && im.tight && ready(im)) return { w: im.naturalWidth / 2 / im.exportScale, h: im.naturalHeight / 2 / im.exportScale };
      const s = sizeOf(it);
      return { w: s, h: s * 0.9 };
    }
    function sizeOf(it) {
      return 118;
    }
    function aura(x, y, size, t) {
      const g = ctx.createRadialGradient(x, y - size * 0.4, size * 0.05, x, y - size * 0.4, size * 0.6);
      const a = 0.42 + 0.14 * Math.sin(t * 3);
      g.addColorStop(0, `rgba(255,236,120,${a})`); g.addColorStop(1, 'rgba(255,236,120,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y - size * 0.4, size * 0.6, 0, 6.283); ctx.fill();
    }
    // 作物・動物の、いまの状態: 'ready' 収穫できる / 'regrow' 収穫あと(時計がついて、1 時間は収穫できない)/ 'withered' 枯れ(タップで片づく)
    function lifePhase(it) {
      if (it.t !== 'chain') return null;
      const ch = CHAINS[it.k];
      if (ch.type === 'bonus') return null;
      if (it.tier === ch.max) return 'ready';
      if (it.tier === ch.max + 1) return engine.regrowLeft(it) > 0 ? 'regrow' : 'ready';
      if (it.tier > ch.max + 1) return 'withered';
      return null;
    }
    const harvestable = (it) => lifePhase(it) === 'ready';
    // 頭上に出す吹き出し。収穫できるときは得られる食材、枯れのときは、タップで出るもの(作物は 1 段階めの苗、動物は銅貨)
    function harvestBubble(x, y, it, t, img) {
      const by = y - 112 + Math.sin(t * 3.2) * 3;
      ctx.save();
      ctx.fillStyle = '#182a34'; ctx.strokeStyle = '#91d5cf'; ctx.lineWidth = 2;
      cutRect(x - 24, by - 24, 48, 44, 12); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 7, by + 19); ctx.lineTo(x, by + 29); ctx.lineTo(x + 7, by + 19); ctx.fill();
      const ing = img || imgs['ref/items/ing_' + CHAINS[it.k].yields];
      if (ready(ing)) {
        const k = Math.min(38 / ing.naturalWidth, 38 / ing.naturalHeight), w = ing.naturalWidth * k, h = ing.naturalHeight * k;
        ctx.drawImage(ing, x - w / 2, by - 2 - h / 2, w, h);
      }
      ctx.restore();
    }

    function drawItem(it, c, r, t, o = {}) {
      const v = getVis(it.id);
      if (performance.now() < v.hideUntil) return;
      const [bx, by] = o.pos || tileFeet(c, r);
      const idle = idleOf(it, v, t);
      const full = sizeOf(it), dm = dimsOf(it);
      const size = Math.max(dm.w, 56);
      const work = engine.state.jobs.find((j) => j.c === c && j.r === r);
      let rot = v.rot + idle.rot;
      const phase = lifePhase(it), isMax = phase === 'ready';
      const lift = (o.lift || 0) - v.oy;
      shadow(bx + v.ox, by, size, lift, v.alpha);
      if (isMax) aura(bx + v.ox, by + v.oy, size, t + v.phase);
      drawSprite(spriteOf(it), bx, by, full, { ox: v.ox, oy: v.oy + idle.oy + (o.liftY || 0), sx: v.sx * idle.sx * (o.scale || 1), sy: v.sy * idle.sy * (o.scale || 1), rot, alpha: v.alpha });
      if (isMax && !o.pos) harvestBubble(bx + v.ox, by + v.oy - Math.max(0, dm.h - 100), it, t);
      if ((it.t === 'obs' || it.k === 'toolbox') && it.pend && !o.pos) harvestBubble(bx + v.ox, by + v.oy - Math.max(0, dm.h - 100), it, t, imgs[`ref/items/${it.k === 'toolbox' ? 'tools' : OBSTACLES[it.k].res}_0`]);   // 作業が終わった: 素材の吹き出し
      if (phase === 'withered' && !o.pos) harvestBubble(bx + v.ox, by + v.oy - Math.max(0, dm.h - 100), it, t, imgs[CHAINS[it.k].type === 'crop' ? `ref/items/${it.k}_0` : 'ref/items/coin_0']);
      if (phase === 'regrow' && !o.pos) {   // 回復中: 小さな青い時計がかぶさる
        const ck = imgs['ui/clock'];
        if (ready(ck)) { const sc = 1 + 0.05 * Math.sin(t * 3 + v.phase); ctx.drawImage(ck, bx + v.ox - 24 * sc, by + v.oy - dm.h * 0.42 - 24 * sc, 48 * sc, 51 * sc); }
      }
      if (isMax && !o.pos) {   // 星のレベル: 黄色い矢印
        const lv = engine.starsOf(it.k), ar = imgs['ref/cards/arrow'];
        if (lv > 0 && ready(ar)) { const byB = by + v.oy - Math.max(0, dm.h - 100) - 112 + Math.sin(t * 3.2) * 3; for (let i = 0; i < lv; i++) ctx.drawImage(ar, bx + v.ox + 28 + i * 19, byB - 20, 18, 24); }   // 吹き出しの右がわに並べる
      }
      if (it.t === 'chain' && CHAINS[it.k].type === 'bonus' && it.tier >= 2) {
        const k = (t * 1.1 + v.phase) % 2;
        if (k < 1) star(bx - size * 0.25, by - size * 0.7, size * 0.1 * Math.sin(k * 3.14), -t * 2, '#ffffff', 0.9);
      }
      if ((it.t === 'obs' || it.k === 'toolbox') && work && work.c === c && work.r === r) {
        const p = clamp((Date.now() - work.startedAt) / (work.endsAt - work.startedAt), 0, 1);
        // 石・木の段階メーターと作業者の丸い時間表示を重ねない。
        const cx = bx, cy = it.t === 'obs' && /^(tree|rock)_/.test(it.k) ? by + v.oy - dm.h - 46 : by - size * 0.95;
        ctx.save();
        ctx.fillStyle = '#0f1923'; ctx.beginPath(); ctx.arc(cx, cy, 24, 0, 6.283); ctx.fill();
        ctx.strokeStyle = '#91d5cf'; ctx.lineWidth = 6; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(cx, cy, 18, -1.5708, -1.5708 + p * 6.283); ctx.stroke();
        ctx.restore();
        const w = imgs['ui/worker'];
        if (ready(w)) ctx.drawImage(w, cx - 13, cy - 13 + Math.sin(t * 10) * 1.5, 26, 26);
      }
      // 残り段階は選んだ障害物と作業中だけ。未作業の山へ一斉に重ねない。
      if (it.t === 'obs' && /^(tree|rock)_/.test(it.k) && !o.pos && (obstacleFocus === it.id || work)) {
        const total = OBS_STEPS[OBSTACLES[it.k].tier], left = Math.max(0, total - (it.pend || it.step || 0));
        const mw = 72, mh = 12, mx = bx + v.ox - mw / 2, my = by + v.oy - dm.h - 16;
        ctx.save();
        ctx.fillStyle = '#f7fff8'; cutRect(mx, my, mw, mh, 3); ctx.fill();
        const sw = (mw - 4) / total;
        for (let i = 0; i < total; i++) {
          ctx.fillStyle = i < left ? '#6bc9ad' : '#d4ddce';
          ctx.fillRect(mx + 2 + i * sw, my + 2, sw - 1, mh - 4);
        }
        ctx.restore();
      }
    }

    // ---------- 建物・景観 ----------
    function rectCenter(rc) { const [c, r, w, h] = rc; return proj(c + w / 2, r + h / 2); }
    function drawAnchored(name, rc, o = {}) {
      const g = spriteGeom(name);
      if (!g) return null;
      const [x, y] = o.center || rectCenter(rc);
      ctx.save();
      ctx.translate(x, y);
      if (o.scale) ctx.scale(o.scale, o.scale);
      if (o.sq) ctx.scale(1 + o.sq, 1 - o.sq * 1.3);
      ctx.drawImage(g.im, g.x0, g.y0, g.w, g.h);
      ctx.restore();
      return { x, y, top: y + g.y0, w: g.w };
    }
    // 建物の敷地(動かせる)。長押しで持ち上げて、ドラッグで動かす
    const bmove = {};   // 建物 → 手を離したあとの着地の動き { fx, fy, t0 }
    function bcenter(bk) {
      const [x, y] = rectCenter(engine.rectOf(bk)), a = bmove[bk];
      if (!a) return [x, y];
      const p = clamp((performance.now() - a.t0) / 300, 0, 1);
      if (p >= 1) { delete bmove[bk]; return [x, y]; }
      const e = ease.outBack(p);
      return [lerp(a.fx, x, e), lerp(a.fy, y, e)];
    }
    function drawBuilding(land, now, t) {
      const bk = land.building.key, b = engine.state.buildings[bk];
      const sq = bsquash[bk] ? clamp((now - bsquash[bk]) / 360, 0, 1) : 1;
      const lifted = bdrag && bdrag.key === bk;
      const art = engine.isRepaired(bk) ? bk : bk + '_broken';
      const gm = spriteGeom(art);
      let center = bcenter(bk);
      if (lifted) {
        center = [bdrag.x, bdrag.y - 22];
        if (gm) { ctx.save(); ctx.globalAlpha = 0.28; ctx.fillStyle = '#1d3a12'; ctx.beginPath(); ctx.ellipse(bdrag.x, bdrag.y + 4, gm.w * 0.3, gm.w * 0.09, 0, 0, 6.283); ctx.fill(); ctx.restore(); }
      }
      const info = drawAnchored(art, engine.rectOf(bk), { sq: sq < 1 ? Math.sin(sq * 3.14) * 0.06 : 0, center, scale: lifted ? 1.04 : 1 });
      if (!info) return;
      // 長押しの進み具合(いっぱいになると、持ち上がる)
      if (pressed && pressed.bcand === bk && !pressed.moved && !bdrag) {
        const p = clamp((performance.now() - pressed.t0) / 450, 0, 1), rx = info.x, ry = info.top + 20;
        ctx.save();
        ctx.fillStyle = '#0f1923'; ctx.beginPath(); ctx.arc(rx, ry, 24, 0, 6.283); ctx.fill();
        ctx.strokeStyle = '#91d5cf'; ctx.lineWidth = 6; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(rx, ry, 18, -1.5708, -1.5708 + p * 6.283); ctx.stroke();
        ctx.restore();
      }
      const cx = info.x, top = info.top + 36;
      if (!engine.isRepaired(bk)) {   // 壊れている: 修理に要る材料の吹き出し(足りないもののうち、先頭)
        const need = engine.repairNeeds(bk).find((x) => x.have < x.n), im2 = need && imgs[`ref/items/${need.k}_${need.tier}`];
        if (im2) {
          const by = top - 12 + Math.sin(t * 4) * 4;
          ctx.save();
          ctx.fillStyle = '#182a34'; ctx.strokeStyle = '#91d5cf'; ctx.lineWidth = 2;
          cutRect(cx - 28, by - 54, 56, 52, 14); ctx.fill(); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(cx - 8, by - 4); ctx.lineTo(cx, by + 8); ctx.lineTo(cx + 8, by - 4); ctx.fill();
          if (ready(im2)) { const k = Math.min(44 / im2.naturalWidth, 40 / im2.naturalHeight); ctx.drawImage(im2, cx - im2.naturalWidth * k / 2, by - 28 - im2.naturalHeight * k / 2, im2.naturalWidth * k, im2.naturalHeight * k); }
          ctx.restore();
        }
      } else if (b.reward) {
        const by = top - 12 + Math.sin(t * 4) * 4, coin = imgs[`ref/items/coin_${b.reward.tier}`];
        ctx.save();
        ctx.fillStyle = '#182a34'; ctx.strokeStyle = '#e5cf97'; ctx.lineWidth = 2;
        cutRect(cx - 28, by - 54, 56, 52, 14); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx - 8, by - 4); ctx.lineTo(cx, by + 8); ctx.lineTo(cx + 8, by - 4); ctx.fill();
        if (ready(coin)) { const k = Math.min(44 / coin.naturalWidth, 40 / coin.naturalHeight); ctx.drawImage(coin, cx - coin.naturalWidth * k / 2, by - 28 - coin.naturalHeight * k / 2, coin.naturalWidth * k, coin.naturalHeight * k); }
        ctx.restore();
      } else if (b.job) {
        const p = clamp((Date.now() - b.job.startedAt) / (b.job.endsAt - b.job.startedAt), 0, 1);
        ctx.fillStyle = '#0f1923'; cutRect(cx - 38, top - 8, 76, 16, 8); ctx.fill();
        ctx.fillStyle = '#91d5cf'; cutRect(cx - 34, top - 4, 68 * p, 8, 4); ctx.fill();
      } else {
        const oc = engine.orderOf(bk);
        const rc = oc && Object.keys(oc.needs).every((n) => (engine.state.inv[n] || 0) >= oc.needs[n]) ? oc : null;
        if (rc) {
          const by = top - 12 + Math.sin(t * 4) * 4, pi = imgs['ref/products/' + rc.id];
          ctx.save();
          ctx.fillStyle = '#182a34'; ctx.strokeStyle = '#91d5cf'; ctx.lineWidth = 2;
          cutRect(cx - 28, by - 54, 56, 52, 14); ctx.fill(); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(cx - 8, by - 4); ctx.lineTo(cx, by + 8); ctx.lineTo(cx + 8, by - 4); ctx.fill();
          if (ready(pi)) { const k = Math.min(44 / pi.naturalWidth, 40 / pi.naturalHeight); ctx.drawImage(pi, cx - pi.naturalWidth * k / 2, by - 28 - pi.naturalHeight * k / 2, pi.naturalWidth * k, pi.naturalHeight * k); }
          ctx.fillStyle = '#e8282e'; ctx.beginPath(); ctx.arc(cx + 26, by - 52, 11, 0, 6.283); ctx.fill();
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
          ctx.fillStyle = '#fff'; ctx.font = '900 15px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('!', cx + 26, by - 51);
          ctx.restore();
        }
      }
    }

    // 未購入の土地の値札(吹き出し)
    function landLabelPos(land) {
      let sx = 0, sy = 0;
      land.coverCells.forEach(([c, r]) => { const p = tileCenter(c, r); sx += p[0]; sy += p[1]; });
      const cx = sx / land.coverCells.length, cy = sy / land.coverCells.length;
      const center = land.coverCells.map(([c, r]) => tileCenter(c, r)).sort((a, b) => Math.hypot(a[0] - cx, (a[1] - cy) * 2) - Math.hypot(b[0] - cx, (b[1] - cy) * 2))[0];
      return [center[0], center[1] - 30];
    }
    function drawLandLabel(land, t) {
      const [x0, y0] = landLabelPos(land);
      const st = engine.landState(land.id);
      const ok = st === 'buyable', lockedByLevel = st === 'locked';
      const font = '"Bahnschrift","Yu Gothic UI",system-ui,sans-serif';
      ctx.save();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (lockedByLevel) {
        // まだ買えない土地は、小さな鍵のチップだけ出す
        ctx.translate(x0, y0 + 20);
        ctx.fillStyle = 'rgba(15,25,35,.94)'; cutRect(-44, -17, 88, 34, 6); ctx.fill();
        ctx.fillStyle = '#91d5cf'; ctx.fillRect(-44, -9, 2, 18);
        if (ready(imgs['ui/lock'])) ctx.drawImage(imgs['ui/lock'], -36, -12, 24, 24);
        ctx.fillStyle = '#fff'; ctx.font = `900 16px ${font}`; ctx.fillText(`Lv ${land.level}`, 12, 1);
        ctx.restore();
        return;
      }
      const bob = Math.sin(t * 2.4 + land.id) * 3;
      const s = ok ? 1 + 0.04 * Math.sin(t * 4) : 1;
      ctx.translate(x0, y0 + bob); ctx.scale(s, s);
      const w = 150, h = 92;
      ctx.fillStyle = 'rgba(0,0,0,.16)'; cutRect(-w / 2 + 3, -h / 2 + 6, w, h, 16); ctx.fill();
      ctx.fillStyle = '#182a34'; cutRect(-w / 2, -h / 2, w, h, 8); ctx.fill();
      ctx.fillStyle = '#ff6571'; ctx.fillRect(-w / 2 + 8, -h / 2, w - 8, 3);
      ctx.fillStyle = '#182a34';
      ctx.beginPath(); ctx.moveTo(-10, h / 2 - 1); ctx.lineTo(0, h / 2 + 13); ctx.lineTo(10, h / 2 - 1); ctx.fill();
      ctx.fillStyle = '#ece8e1'; ctx.font = `800 17px ${font}`;
      ctx.fillText('土地', 0, -h / 2 + 17);
      const bw = 124, bh = 30, by = -h / 2 + 30;
      ctx.fillStyle = ok ? '#ff6571' : '#425761';
      cutRect(-bw / 2, by, bw, bh, 9); ctx.fill();
      ctx.fillStyle = ok ? '#0f1923' : '#c4ced0'; ctx.font = `900 16px ${font}`;
      ctx.fillText('購入する', 0, by + bh / 2 + 1);
      // コストの進行バー
      const cost = land.cost, have = engine.state.coins, p = cost ? clamp(have / cost, 0, 1) : 1;
      const by2 = h / 2 - 17;
      ctx.fillStyle = '#425761'; cutRect(-40, by2 - 7, 92, 14, 2); ctx.fill();
      ctx.fillStyle = '#91d5cf'; cutRect(-40, by2 - 7, Math.max(14, 92 * p), 14, 2); ctx.fill();
      ctx.fillStyle = '#ece8e1'; ctx.font = '900 12px system-ui,sans-serif'; ctx.textAlign = 'left';
      ctx.strokeStyle = '#0f1923'; ctx.lineWidth = 3; ctx.strokeText(String(cost), -34, by2 + 1);
      ctx.fillText(String(cost), -34, by2 + 1);
      if (ready(imgs['ui/coin'])) ctx.drawImage(imgs['ui/coin'], -62, by2 - 14, 28, 28);
      ctx.restore();
    }

    // ---------- 描画 ----------
    // ドラッグ中、同じ品物の上に重ねると合体できるとき、つながっている品物のマスを返す(合体できなければ null)
    function previewInfo() {
      if (!drag || !drag.hover) return null;
      return engine.stackGroup(drag.from, drag.hover);
    }

    function rewardBubblePositions() {
      const groups = new Map();
      return engine.state.rewardBubbles.map((bubble) => {
        const k = key(bubble.c, bubble.r), i = groups.get(k) || 0;
        groups.set(k, i + 1);
        const [x, y] = tileCenter(bubble.c, bubble.r);
        return { bubble, x: x + ((i % 5) - 2) * 66, y: y - 185 - Math.floor(i / 5) * 66 };
      });
    }
    function drawRewardBubbles() {
      rewardBubblePositions().forEach(({ bubble, x, y }) => {
        ctx.save();
        const g = ctx.createRadialGradient(x - 10, y - 12, 2, x, y, 31);
        g.addColorStop(0, 'rgba(255,255,255,.95)'); g.addColorStop(1, 'rgba(177,230,255,.45)');
        ctx.fillStyle = g; ctx.strokeStyle = '#e9faff'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(x, y, 31, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        const im = spriteOf(bubble.item);
        if (ready(im)) { const sc = 46 / Math.max(im.naturalWidth, im.naturalHeight); ctx.drawImage(im, x - im.naturalWidth * sc / 2, y - im.naturalHeight * sc / 2, im.naturalWidth * sc, im.naturalHeight * sc); }
        ctx.restore();
      });
    }

    // マスを見分ける市松の2色を固定する。
    const hash = (c, r, k = 0) => Math.abs(((c * 73856093) ^ (r * 19349663) ^ (k * 83492791)) | 0);
    function grassKind(c, r) {
      return (c + r) % 2 === 0 ? 'g_tactical_light' : 'g_tactical_dark';
    }
    // 道は連続した舗装。マスの明暗を持つプレイ用タイルとは分ける。
    const roadKind = () => 'tactical_road';

    function drawLandscape(vx0, vy0, vx1, vy1) {
      const g = ctx.createLinearGradient(0, BOUND.y0, 0, BOUND.y1);
      g.addColorStop(0, '#668378'); g.addColorStop(1, '#4d6e65');
      ctx.fillStyle = g; ctx.fillRect(vx0, vy0, vx1 - vx0, vy1 - vy0);
      // 市松に見えない、大きさも形も不揃いな草地の淡い塗り面。
      ctx.save();
      for (let row = Math.floor(vy0 / 190); row <= Math.ceil(vy1 / 190); row++) {
        for (let col = Math.floor(vx0 / 310); col <= Math.ceil(vx1 / 310); col++) {
          const seed = hash(col, row, 21), x = col * 310 + seed % 137, y = row * 190 + (seed >>> 8) % 83;
          const w = 180 + seed % 220, h = 65 + (seed >>> 12) % 90;
          ctx.globalAlpha = 0.035 + (seed % 4) * 0.012;
          ctx.fillStyle = seed % 2 ? '#cad4b0' : '#203f41';
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w * 0.6, y - h * 0.4);
          ctx.lineTo(x + w, y + h * 0.35); ctx.lineTo(x + w * 0.4, y + h); ctx.closePath(); ctx.fill();
        }
      }
      ctx.restore();
    }
    function drawTile(c, r, kind, now, wide = 1, dy = 0) {
      const [x, y] = tileTop(c, r);
      let s = 1;
      const ta = tileAnim[key(c, r)];
      if (ta) {
        if (now < ta) return;
        const p = clamp((now - ta) / 380, 0, 1);
        s = ease.outBack(p); if (p >= 1) delete tileAnim[key(c, r)];
      }
      const im = imgs['ref/' + kind];
      if (!ready(im)) return;
      const w = (TILE_W + 1.6) * wide, h = im.naturalHeight * w / im.naturalWidth;
      ctx.save();
      ctx.translate(x, y + HH + dy); ctx.scale(s, s);
      ctx.drawImage(im, -w / 2, -HH - 0.8, w, h);
      ctx.restore();
    }
    // 未購入の土地にかかる白い雲。白いふくらみと柔らかい青灰色の陰影を重ねる。
    const CLOUD_WIDE = 1.16;
    function cloudLayer(land) {
      const shape = cloudShapes.get(land.id);
      if (shape.layer) return shape.layer;
      const im = imgs['ref/tile_cloud_tactical']; if (!ready(im)) return null;
      const points = land.coverCells.flatMap(([c, r]) => [proj(c, r), proj(c + 1, r + 1), proj(c + 1, r), proj(c, r + 1)]);
      const x = Math.floor(Math.min(...points.map((p) => p[0]))) - 24, y = Math.floor(Math.min(...points.map((p) => p[1]))) - 24;
      const layer = document.createElement('canvas');
      layer.width = Math.ceil(Math.max(...points.map((p) => p[0])) - x) + 24;
      layer.height = Math.ceil(Math.max(...points.map((p) => p[1])) - y) + 24;
      const cc = layer.getContext('2d'); cc.translate(-x, -y);
      // タイル素材の余白が、区画の外の道路へ残らないように切り取る。
      cc.save(); cc.beginPath();
      land.coverCells.forEach(([c, r]) => {
        cc.moveTo(...proj(c, r)); cc.lineTo(...proj(c + 1, r));
        cc.lineTo(...proj(c + 1, r + 1)); cc.lineTo(...proj(c, r + 1)); cc.closePath();
      });
      cc.clip();
      const w = (TILE_W + 1.6) * CLOUD_WIDE, h = im.naturalHeight * w / im.naturalWidth;
      land.coverCells.forEach(([c, r]) => { const [tx, ty] = tileTop(c, r); cc.drawImage(im, tx - w / 2, ty - 0.8, w, h); });
      cc.restore();
      // 雲の輪郭だけをぼかして細く離し、区画の境目を保つ。
      cc.globalCompositeOperation = 'destination-out'; cc.filter = 'blur(4px)'; cc.lineWidth = 14; cc.lineJoin = 'round'; cc.strokeStyle = '#000'; cc.beginPath();
      shape.outline.forEach(([c, r, xx, yy]) => { cc.moveTo(...proj(c, r)); cc.lineTo(...proj(xx, yy)); }); cc.stroke();
      shape.layer = { image: layer, x, y }; return shape.layer;
    }
    // 購入直後、雲がふわっと浮いて消えていく
    function drawMeltingIce(tl, now) {
      const p = clamp((now - tl.dis) / 900, 0, 1);
      const delay = ((tl.c + tl.r) - (tl.land.bounds.c + tl.land.bounds.r)) * 0.025;
      const q = clamp(p - delay, 0, 1);
      const im = imgs['ref/tile_cloud_tactical'];
      if (q >= 1 || !ready(im)) return;
      const [x, y] = tileTop(tl.c, tl.r);
      const w = (TILE_W + 1.6) * CLOUD_WIDE, h = im.naturalHeight * w / im.naturalWidth;
      ctx.save(); ctx.globalAlpha = 1 - q; ctx.translate(x, y + HH - q * 60); ctx.scale(1 + q * 0.25, 1 + q * 0.25);
      ctx.drawImage(im, -w / 2, -HH - 0.8, w, h); ctx.restore();
    }

    function draw(now, t) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#55756b'; ctx.fillRect(0, 0, vw, vh);
      const sh = shake > 0.3 ? [(Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake] : [0, 0];
      ctx.save();
      ctx.translate(vw / 2 + sh[0], vh / 2 + sh[1]); ctx.scale(cam.zoom, cam.zoom); ctx.translate(-cam.x, -cam.y);
      const vx0 = cam.x - vw / 2 / cam.zoom - 200, vx1 = cam.x + vw / 2 / cam.zoom + 200;
      const vy0 = cam.y - vh / 2 / cam.zoom - 260, vy1 = cam.y + vh / 2 / cam.zoom + 120;
      const inView = (x, y, pad = 0) => x > vx0 - pad && x < vx1 + pad && y > vy0 - pad && y < vy1 + pad;

      drawLandscape(vx0, vy0, vx1, vy1);

      // 池(地面に張り付くもの)
      DECOR.filter((d) => d.key === 'pond').forEach((d) => {
        const [pc, pr, pw, ph] = d.rect, [x, y] = proj(pc + pw / 2, pr + ph / 2);
        const im = imgs['ref/tactical_pond'];
        if (!ready(im)) return;
        const w = (pw + ph) * HW * 0.8, h = im.naturalHeight * w / im.naturalWidth;
        ctx.drawImage(im, x - w / 2, y - h / 2, w, h);
      });

      // 道
      // 細い縁石と接地影で舗装を草地につなぐ。
      ctx.save(); ctx.lineJoin = 'bevel'; ctx.translate(0, 3);
      ctx.strokeStyle = '#304b4d'; ctx.lineWidth = 10; ctx.stroke(roadPath); ctx.restore();
      ctx.save(); ctx.lineJoin = 'bevel'; ctx.strokeStyle = '#a1b3b1'; ctx.lineWidth = 5; ctx.stroke(roadPath);
      ctx.clip(roadPath); ctx.fillStyle = '#819499'; ctx.fill(roadPath);
      roadCells.forEach(([c, r]) => { const [x, y] = tileTop(c, r); if (inView(x, y, 160)) drawTile(c, r, roadKind(c, r), now); });
      ctx.restore();
      ctx.save(); ctx.strokeStyle = '#cc8a7e'; ctx.lineWidth = 3;
      roadEdges.forEach((edge) => {
        if (!edge.soft || hash(...edge.a, 23) % 13) return;
        const a = proj(...edge.a), b = proj(...edge.b);
        if (!inView(...a, 160)) return;
        ctx.beginPath(); ctx.moveTo(lerp(a[0], b[0], 0.22), lerp(a[1], b[1], 0.22));
        ctx.lineTo(lerp(a[0], b[0], 0.4), lerp(a[1], b[1], 0.4)); ctx.stroke();
      }); ctx.restore();

      // 土地のタイル(奥から手前へ)
      const tiles = [];
      LANDS.forEach((land) => {
        const owned = engine.state.lands[land.id], dis = dissolving[land.id];
        engine.landCells(land.id).forEach(([c, r]) => { const [x, y] = tileTop(c, r); if (inView(x, y, 160)) tiles.push({ c, r, owned, dis, land }); });
        // 店の 2×2 の敷地も、土地を買うまでは周囲と同じ雲で覆う。
        if (land.building && (!owned || dis)) rectCells(engine.rectOf(land.building.key)).forEach(([c, r]) => {
          const [x, y] = tileTop(c, r); if (inView(x, y, 160)) tiles.push({ c, r, owned, dis, land });
        });
      });
      tiles.sort((a, b) => (a.c + a.r) - (b.c + b.r));
      tiles.filter((tl) => tl.owned).forEach((tl) => drawTile(tl.c, tl.r, grassKind(tl.c, tl.r), now));
      // 区画ごとに雲を切り抜き、境界に細いすき間を作る。一枚の巨大な雲に見せない。
      LANDS.forEach((land) => {
        if (engine.state.lands[land.id]) return;
        const visible = tiles.filter((tl) => tl.land.id === land.id);
        if (!visible.length) return;
        const layer = cloudLayer(land);
        if (layer) ctx.drawImage(layer.image, layer.x, layer.y + Math.sin(t * 0.8 + land.id * 1.4) * 1.2);
      });
      tiles.forEach((tl) => { if (tl.owned && tl.dis) drawMeltingIce(tl, now); });
      LANDS.forEach((l) => { if (dissolving[l.id] && now - dissolving[l.id] > 1000) delete dissolving[l.id]; });

      // 建物を動かしている間の、置き先の敷地の目印
      if (bdrag) {
        const rc = engine.rectOf(bdrag.key), [tc, tr] = bdrag.target;
        const a = proj(tc, tr), b2 = proj(tc + rc[2], tr), c2 = proj(tc + rc[2], tr + rc[3]), d2 = proj(tc, tr + rc[3]);
        ctx.save();
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b2[0], b2[1]); ctx.lineTo(c2[0], c2[1]); ctx.lineTo(d2[0], d2[1]); ctx.closePath();
        ctx.fillStyle = bdrag.ok ? 'rgba(160,255,90,.42)' : 'rgba(255,106,92,.42)'; ctx.fill();
        ctx.strokeStyle = bdrag.ok ? '#7ad94f' : '#ff6a5c'; ctx.lineWidth = 5; ctx.lineJoin = 'round'; ctx.stroke();
        ctx.restore();
      }

      // ドラッグ中の強調(タイル)
      if (drag && drag.hover) {
        const info = previewInfo();
        const [hc, hr] = drag.hover;
        const bk = engine.buildingAt(hc, hr);
        ctx.save();
        if (bk) {
          const [bc, br, bw, bh] = engine.rectOf(bk);
          ctx.strokeStyle = drag.feedable ? '#7ad94f' : '#ff6a5c'; ctx.lineWidth = 6; ctx.lineJoin = 'round';
          const a = proj(bc, br), b = proj(bc + bw, br), c2 = proj(bc + bw, br + bh), d = proj(bc, br + bh);
          ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c2[0], c2[1]); ctx.lineTo(d[0], d[1]); ctx.closePath(); ctx.stroke();
        } else {
          if (info) {
            const pulse = 0.5 + 0.2 * Math.sin(t * 9);
            info.forEach(([c, r]) => { diamondPath(c, r, 2); ctx.globalAlpha = pulse; ctx.fillStyle = '#e4ff66'; ctx.fill(); });
            ctx.globalAlpha = 1;
          }
          diamondPath(hc, hr, 4); ctx.lineWidth = 4; ctx.lineJoin = 'round';
          ctx.strokeStyle = drag.hoverOk ? 'rgba(255,255,255,.95)' : '#ff6a5c'; ctx.stroke();
        }
        ctx.restore();
      }

      // 前後関係を揃えて描く(画面の下にあるものほど手前)
      const list = [];
      forest.forEach((f2) => {
        if (!inView(f2.x, f2.y, 200)) return;
        list.push({ d: f2.depth, fn: () => {
          const im = imgs[f2.img]; if (!ready(im)) return;
          ctx.save(); ctx.translate(f2.x, f2.y);
          ctx.fillStyle = 'rgba(22,45,48,.16)'; ctx.beginPath(); ctx.ellipse(0, 0, f2.w * 0.24, f2.w * 0.065, 0, 0, Math.PI * 2); ctx.fill();
          if (f2.mirror) ctx.scale(-1, 1);
          const h = im.naturalHeight * f2.w / im.naturalWidth;
          ctx.drawImage(im, -f2.ax, -h * (f2.img === 'ref/bush_a' ? 0.92 : 0.95), f2.w, h); ctx.restore();
        } });
      });
      DECOR.filter((d) => d.key !== 'pond').forEach((d) => {
        const [c, r, w, h] = d.rect;
        list.push({ d: c + w + r + h - 0.3, fn: () => {
          if (d.key === 'lamp') { const [x, y] = tileFeet(c, r); const im = imgs['ref/lamp']; if (ready(im)) { const w = 30, h = im.naturalHeight * w / im.naturalWidth; ctx.drawImage(im, x - w / 2, y - h * 0.95, w, h); } }
          else drawAnchored(d.key, d.rect);
        } });
      });
      LANDS.forEach((land) => {
        if (!land.building) return;
        const owned = engine.state.lands[land.id];
        if (!owned && !dissolving[land.id]) return;
        const [bc, br, bw, bh] = engine.rectOf(land.building.key);
        list.push({ d: bdrag && bdrag.key === land.building.key ? 9999 : bc + bw + br + bh - 0.2, fn: () => drawBuilding(land, now, t) });
      });
      Object.keys(engine.state.items).forEach((k) => {
        const [c, r] = k.split(',').map(Number);
        const it = engine.state.items[k];
        if (!engine.isOwned(c, r)) return;
        if (drag && drag.id === it.id) return;
        list.push({ d: depthOf(c, r), fn: () => drawItem(it, c, r, t) });
      });
      list.sort((a, b) => a.d - b.d).forEach((d) => d.fn());

      // 未購入の土地の値札
      LANDS.forEach((land) => { if (!engine.state.lands[land.id] && !land.parent) drawLandLabel(land, t); });

      // 演出(ゴースト等)
      for (let i = fxList.length - 1; i >= 0; i--) {
        const fx = fxList[i];
        const p = clamp((now - fx.t0) / fx.dur, 0, 1);
        fx.draw(p);
        if (p >= 1) { fxList.splice(i, 1); if (fx.done) fx.done(); }
      }

      // ドラッグ中の品物と「つながる数」のバッジ
      if (drag && drag.started) {
        const it = engine.getItem(drag.from[0], drag.from[1]);
        if (it) {
          drawItem(it, 0, 0, t, { pos: [drag.x, drag.y], lift: 40, liftY: 0 });
          const info = drag.hover && previewInfo();
          if (info) {
            const n = info.length + 1 >= 5 ? 5 : 3, [hx, hy] = tileCenter(drag.hover[0], drag.hover[1]);
            const bx = hx, by = hy - 126 + Math.sin(t * 8) * 2;
            ctx.save();
            ctx.fillStyle = '#182a34'; ctx.strokeStyle = '#91d5cf'; ctx.lineWidth = 2;
            cutRect(bx - 26, by - 26, 52, 52, 8); ctx.fill(); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(bx - 7, by + 23); ctx.lineTo(bx, by + 34); ctx.lineTo(bx + 7, by + 23); ctx.fill();
            ctx.fillStyle = n === 5 ? '#91d5cf' : '#ece8e1'; ctx.font = '900 30px "Bahnschrift",system-ui,sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(n), bx, by + 2);
            ctx.restore();
          }
        }
      }

      drawRewardBubbles();
      drawParts();
      drawFloaters();
      ctx.restore();

      // 森の外周を暗くする(奥行きのあるビネット)
      const vg = ctx.createRadialGradient(vw / 2, vh * 0.52, Math.min(vw, vh) * 0.35, vw / 2, vh * 0.52, Math.max(vw, vh) * 0.82);
      vg.addColorStop(0, 'rgba(10,40,12,0)'); vg.addColorStop(1, 'rgba(10,40,12,.55)');
      ctx.fillStyle = vg; ctx.fillRect(0, 0, vw, vh);

      drawFlyers(now);
    }

    function drawParts() {
      parts.forEach((p) => {
        const k = p.age / p.life;
        ctx.save();
        ctx.globalAlpha = clamp(1 - k, 0, 1);
        if (p.type === 'spark') { star(p.x, p.y, p.size * (1 - k * 0.4), p.rot, p.color, ctx.globalAlpha); }
        else if (p.type === 'puff') { ctx.fillStyle = p.color; ctx.globalAlpha *= 0.7; ctx.beginPath(); ctx.arc(p.x, p.y, p.size + p.grow * p.age, 0, 6.283); ctx.fill(); }
        else if (p.type === 'ring') { const rr = p.size * ease.outCubic(k); ctx.strokeStyle = p.color; ctx.lineWidth = 8 * (1 - k) + 1; ctx.beginPath(); ctx.ellipse(p.x, p.y, rr, rr * 0.5, 0, 0, 6.283); ctx.stroke(); }
        else if (p.type === 'confetti') { ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.color; ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); }
        else { ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.size / 2, 0, 6.283); ctx.fill(); }
        ctx.restore();
      });
    }
    function drawFloaters() {
      floaters.forEach((fl) => {
        const k = fl.age / fl.life;
        ctx.save();
        const pop = k < 0.15 ? ease.outBack(k / 0.15) : 1;
        ctx.globalAlpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
        ctx.translate(fl.x, fl.y - ease.outCubic(k) * 70); ctx.scale(pop, pop);
        ctx.font = `900 ${fl.size}px "Hiragino Maru Gothic ProN","Yu Gothic UI",system-ui,sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
        ctx.lineWidth = 7; ctx.strokeStyle = '#3b2a1c'; ctx.strokeText(fl.text, 0, 0);
        ctx.fillStyle = fl.color; ctx.fillText(fl.text, 0, 0);
        ctx.restore();
      });
    }
    function drawFlyers(now) {
      for (let i = flyers.length - 1; i >= 0; i--) {
        const fl = flyers[i];
        if (now < fl.t0) continue;
        const p = clamp((now - fl.t0) / fl.dur, 0, 1);
        const e = ease.inOutQuad(p);
        const x = (1 - e) * (1 - e) * fl.x0 + 2 * (1 - e) * e * fl.cx + e * e * fl.x1;
        const y = (1 - e) * (1 - e) * fl.y0 + 2 * (1 - e) * e * fl.cy + e * e * fl.y1;
        const s = 34 * (1 - 0.25 * p);
        if (ready(fl.img)) ctx.drawImage(fl.img, x - s / 2, y - s / 2, s, s * (fl.kind === 'xp' ? 0.67 : 1));
        if (p >= 1) {
          flyers.splice(i, 1);
          hold[fl.kind] = (hold[fl.kind] || 0) - fl.amt;
          if (fl.el) { fl.el.classList.remove('bump'); void fl.el.offsetWidth; fl.el.classList.add('bump'); }
        }
      }
    }
    function updateParts(dt) {
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.age += dt;
        if (p.age >= p.life) { parts.splice(i, 1); continue; }
        p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      }
      for (let i = floaters.length - 1; i >= 0; i--) { floaters[i].age += dt; if (floaters[i].age >= floaters[i].life) floaters.splice(i, 1); }
      shake = Math.max(0, shake - dt * 28);
    }

    // ---------- イベント → 演出 ----------
    const ghostDraw = (item, x, y, o = {}) => drawSprite(spriteOf(item), x, y, sizeOf(item), o);
    const flush = () => engine.drain().forEach(onEvent);
    function wiggle(c, r) {
      const it = engine.getItem(c, r);
      if (!it) return;
      const v = getVis(it.id);
      tween({ dur: 420, ease: ease.linear, update(p) { v.rot = Math.sin(p * 3.14 * 4) * 0.22 * (1 - p); }, done() { v.rot = 0; } });
    }
    function toast(msg) {
      const el = $('toast');
      el.textContent = msg; el.classList.add('show');
      clearTimeout(toast.t);
      toast.t = setTimeout(() => el.classList.remove('show'), 1900);
    }

    // チュートリアル(農家フランシーヌの吹き出し)。段階: 0 箱を開ける → 1 つなげる → 2 育った → 3 終わり
    const TUT = [
      'ようこそ!わたしはハナ、この谷の農家です。まずは下の箱をタップして、届いた荷物を開けてみてね!',
      'いい調子!同じ品物を2つ並べて、3つ目をその上に重ねてみて。ひとつ育つよ!',
      'やったね、育ったよ!もっと合体させて、大きく育てよう!',
    ];
    let tut = 0;
    function setTut(n, force) {
      if (!force && n <= tut) return;
      tut = n;
      try { localStorage.setItem('fmv-tut', String(n)); } catch (e) { /* ignore */ }
      const box = $('tutor');
      if (n >= TUT.length) { box.classList.add('off'); $('hand').classList.add('off'); return; }
      $('tutor-text').textContent = TUT[n];
      box.classList.remove('off');
      $('hand').classList.toggle('off', n !== 0);
      if (n === TUT.length - 1) setTimeout(() => setTut(TUT.length), 6000);   // 最後の吹き出しは、数秒で消える(ずっといない)
    }

    function onEvent(ev) {
      const now = performance.now();
      switch (ev.type) {
        case 'spawn': {
          setTut(1);
          const v = getVis(ev.item.id);
          v.oy = -190; v.sx = 0.5; v.sy = 0.5; v.alpha = 0;
          tweenProps(v, { oy: 0 }, 560, ease.outBounce);
          tweenProps(v, { sx: 1, sy: 1 }, 460, ease.outBack);
          tweenProps(v, { alpha: 1 }, 140, ease.linear);
          const [bx, by] = tileFeet(ev.c, ev.r);
          later(420, () => { puff(bx, by - 4, 5, '#d8c9a8', 36); });
          const cb = $('crate-btn'); cb.classList.remove('squash'); void cb.offsetWidth; cb.classList.add('squash');
          break;
        }
        case 'move': {
          const [tc, tr] = ev.to, [fc, fr] = ev.from;
          const moved = engine.getItem(tc, tr);
          if (moved && lastDrop) {
            const v = getVis(moved.id), [bx, by] = tileFeet(tc, tr);
            v.ox = lastDrop[0] - bx; v.oy = lastDrop[1] - by; v.sx = 1.12; v.sy = 1.12;
            tweenProps(v, { ox: 0, oy: 0 }, 260, ease.outBack);
            tweenProps(v, { sx: 1, sy: 1 }, 260, ease.outBack);
          }
          if (ev.swapped) {
            const other = engine.getItem(fc, fr);
            if (other) {
              const v = getVis(other.id), a = tileFeet(fc, fr), b = tileFeet(tc, tr);
              v.ox = b[0] - a[0]; v.oy = b[1] - a[1];
              tweenProps(v, { ox: 0, oy: 0 }, 280, ease.outBack);
            }
          }
          lastDrop = null;
          break;
        }
        case 'merge': {
          setTut(2);
          const [ax, ay] = tileCenter(ev.anchor[0], ev.anchor[1]);
          const target = tileFeet(ev.anchor[0], ev.anchor[1]);
          ev.consumed.forEach((cons) => {
            // 手に持っていた品物は、離した場所から合体する(元の場所から飛んでこない)
            const held = lastDrop && lastDropFrom && cons.c === lastDropFrom[0] && cons.r === lastDropFrom[1];
            const [fx, fy] = held ? lastDrop : tileFeet(cons.c, cons.r);
            const same = cons.c === ev.anchor[0] && cons.r === ev.anchor[1];
            if (!same) addFx(250, (p) => {
              const e = ease.inBack(p);
              ghostDraw(cons.item, lerp(fx, target[0], e), lerp(fy, target[1], e), { sx: 1 - 0.3 * p, sy: 1 - 0.3 * p, alpha: 1 - 0.2 * p });
            });
            else addFx(250, (p) => ghostDraw(cons.item, fx, fy, { sx: 1 + 0.15 * Math.sin(p * 3.14) - 0.4 * p, sy: 1 - 0.15 * Math.sin(p * 3.14) - 0.4 * p, alpha: 1 - p }));
          });
          ev.created.forEach((cr, i) => {
            const v = getVis(cr.item.id);
            v.hideUntil = now + 250; v.sx = 0.01; v.sy = 0.01;
            tweenProps(v, { sx: 1, sy: 1 }, 680, ease.outElastic, 250);
            if (i > 0) later(250, () => { const [bx, by] = tileCenter(cr.c, cr.r); burst(bx, by, 8, { size: 13 }); });
          });
          later(250, () => {
            const big = ev.n === 5;
            burst(ax, ay, big ? 20 : 12, { size: big ? 20 : 16, speed: big ? 340 : 260 });
            ring(ax, ay + 10, big ? '#ff9ac6' : '#fff7a8', big ? 150 : 110);
            // 経験値: 金の王冠がレベルのメダルへ飛ぶ
            floater(ax, ay - 70, `+${ev.xp}`, '#ffe37a', 30);
            const medal = $('medal').getBoundingClientRect();
            const [sx, sy] = w2s(ax, ay - 70);
            for (let i = 0; i < Math.min(5, 2 + ev.newTier); i++) {
              flyers.push({ x0: sx, y0: sy, cx: sx + (Math.random() - 0.5) * 160, cy: sy - 60 - Math.random() * 60, x1: medal.left + medal.width / 2, y1: medal.top + medal.height / 2, t0: performance.now() + 120 + i * 80, dur: 700, img: imgs['ui/crown'], kind: 'xp', amt: 0, el: $('medal') });
            }
            if (big) { floater(ax, ay - 118, '×2 ボーナス!', '#ffd23f', 28); shake = 9; }
            if (ev.lucky) {
              const [lx, ly] = tileCenter(ev.lucky.c, ev.lucky.r);
              burst(lx, ly, 22, { size: 20, colors: ['#ff7aa8', '#ffd23f', '#7ad0ff', '#fff'] });
              floater(lx, ly - 70, 'ラッキー!', '#ff9ac6', 34);
            }
          });
          break;
        }
        case 'collect': {
          const [cx, cy] = tileCenter(ev.c, ev.r), [bx, by] = tileFeet(ev.c, ev.r);
          addFx(240, (p) => ghostDraw(ev.item, bx, by, { sx: 1 + 0.35 * p, sy: 1 + 0.35 * p, alpha: 1 - p, oy: -30 * p }));
          const n = Math.min(6, 1 + ev.item.tier * 1.5 | 0);
          if (ev.kind !== 'woodbox') flyTo([cx, cy - 30], ev.kind === 'energy' ? 'energy' : ev.kind === 'gem' ? 'gems' : 'coins', n, ev.value);
          floater(cx, cy - 60, `+${ev.value}${ev.kind === 'woodbox' ? ' 箱' : ''}`, ev.kind === 'woodbox' ? '#c4efff' : ev.kind === 'gem' ? '#d9a6ff' : ev.kind === 'energy' ? '#ffe66b' : '#ffd23f', 30);
          burst(cx, cy, 6, { size: 12 });
          break;
        }
        case 'chestOpened':
        case 'rewardClaimed': {
          hideChest();
          const [bx, by] = tileFeet(ev.c, ev.r);
          if (ev.item) addFx(320, (p) => ghostDraw(ev.item, bx, by, { sx: 1 + p * 0.35, sy: 1 - p * 0.2, alpha: 1 - p }));
          (ev.consumed || []).forEach((k) => {
            const from = tileFeet(k.c, k.r);
            addFx(260, (p) => ghostDraw(k.item, lerp(from[0], bx, ease.inQuad(p)), lerp(from[1], by - 45, ease.inQuad(p)), { alpha: 1 - p }));
          });
          burst(bx, by - 45, 18, { size: 17, colors: ['#fff7a8', '#ffd23f', '#ffffff', '#c1ecff'] });
          ring(bx, by, '#fff7a8', 130);
          ev.spawned.forEach((sp, i) => {
            const v = getVis(sp.item.id), dest = tileFeet(sp.c, sp.r), delay = 180 + i * 60;
            v.hideUntil = now + delay; v.sx = v.sy = 0.35;
            tween({ delay, dur: 560, ease: ease.linear, update(p) { const e = ease.outCubic(p); v.ox = (bx - dest[0]) * (1 - e); v.oy = (by - dest[1]) * (1 - e) - Math.sin(p * Math.PI) * 90; v.sx = v.sy = 0.35 + 0.65 * ease.outBack(p); }, done() { v.ox = v.oy = 0; v.sx = v.sy = 1; } });
          });
          if (ev.bubbles && ev.bubbles.length) toast('空きマスのない報酬は、泡に入っています');
          break;
        }
        case 'chestExpired': { const [x, y] = tileCenter(ev.c, ev.r); puff(x, y, 6, '#dbe5ef', 40); break; }
        case 'harvest': {
          const [cx, cy] = tileCenter(ev.c, ev.r), [bx, by] = tileFeet(ev.c, ev.r);
          addFx(340, (p) => ghostDraw(ev.item, bx, by, { sx: (1 + 0.25 * Math.sin(p * 3.14)) * (1 - p * 0.9), sy: (1 - 0.18 * Math.sin(p * 3.14)) * (1 - p * 0.9), alpha: 1 - p * p }));
          burst(cx, cy - 20, 14, { size: 17, colors: ['#fff7a8', '#ffd23f', '#ffffff'] });
          ev.spawned.forEach((sp, i) => {
            const v = getVis(sp.item.id), dest = tileFeet(sp.c, sp.r);
            v.hideUntil = now + 120 + i * 100; v.sx = 0.5; v.sy = 0.5;
            const dx = bx - dest[0], dy = by - dest[1];
            tween({
              delay: 120 + i * 100, dur: 560, ease: ease.linear,
              update(p) { const e = ease.outCubic(p); v.ox = dx * (1 - e); v.oy = dy * (1 - e) - Math.sin(p * 3.14) * 90; const s = 0.5 + 0.5 * ease.outBack(p); v.sx = v.sy = s; },
              done() { v.ox = 0; v.oy = 0; v.sx = v.sy = 1; const [x, y] = tileFeet(sp.c, sp.r); puff(x, y - 4, 3, '#d8c9a8', 24); },
            });
          });
          if (ev.remains) { const cur = engine.getItem(ev.c, ev.r); if (cur) { const v = getVis(cur.id); v.hideUntil = now + 300; v.sx = v.sy = 0.6; tweenProps(v, { sx: 1, sy: 1 }, 520, ease.outBack, 300); } }
          break;
        }
        case 'feed': {
          const [bx, by] = tileFeet(ev.c, ev.r);
          const land = LANDS.find((l) => l.building && l.building.key === ev.building);
          const [tx, ty] = rectCenter(engine.rectOf(ev.building));
          const tcy = ty - 50;
          addFx(380, (p) => {
            const e = ease.inQuad(p);
            ghostDraw(ev.item, lerp(bx, tx, e), lerp(by, tcy, e) - Math.sin(p * 3.14) * 60, { sx: 1 - 0.65 * p, sy: 1 - 0.65 * p, alpha: 1 - 0.3 * p });
          }, () => {
            bsquash[ev.building] = performance.now();
            burst(tx, tcy, 6, { size: 12 });
            floater(tx, tcy - 40, `+1 ${ev.item.t === 'ing' ? INGREDIENTS[ev.item.k].name : CHAINS[ev.item.k].name}`, '#fff', 24);
            refreshPanel();
          });
          break;
        }
        case 'buildingMoved': {
          const [bx, by] = rectCenter(ev.to);
          puff(bx, by, 7, '#d8c9a8', 60);
          ev.moves.forEach((m) => {
            const it = engine.getItem(m.to[0], m.to[1]);
            if (!it) return;
            const v = getVis(it.id), a = tileFeet(m.from[0], m.from[1]), b = tileFeet(m.to[0], m.to[1]);
            v.ox = a[0] - b[0]; v.oy = a[1] - b[1];
            tweenProps(v, { ox: 0, oy: 0 }, 360, ease.outBack, 60);
          });
          break;
        }
        case 'clearStart': break;
        case 'card': break;
        case 'cardUsed': toast(`${CHAINS[ev.k].name} が ★${ev.star} になった!(収穫が増えます)`); renderCards(); refreshCardsBadge(); break;
        case 'cardMerged': renderCards(); refreshCardsBadge(); break;
        case 'repaired': {   // 建物が直った
          const [bx, by] = rectCenter(engine.rectOf(ev.building));
          puff(bx, by, 10, '#d8c9a8', 70); burst(bx, by - 40, 16, { size: 16 }); ring(bx, by, '#fff7a8', 140);
          bsquash[ev.building] = performance.now(); shake = 6;
          toast(`${BUILDINGS[ev.building].name}が直った!`);
          if (panelFor === ev.building) refreshPanel(true);
          break;
        }
        case 'witherDone': {   // 枯れをタップ: 苗(動物は銅貨)が出て、枯れは消える
          const [cx, cy] = tileCenter(ev.c, ev.r);
          puff(cx, cy, 8, '#c9b27a', 52);
          (ev.spawned || []).forEach((sp, i) => {
            const v2 = getVis(sp.item.id), d0 = 60 + i * 110;
            v2.hideUntil = now + d0; v2.oy = -90; v2.sx = v2.sy = 0.5;
            tweenProps(v2, { oy: 0 }, 460, ease.outBounce, d0); tweenProps(v2, { sx: 1, sy: 1 }, 320, ease.outBack, d0);
          });
          break;
        }
        case 'regrowSkipped': {   // ジェムで待ち時間を飛ばした
          const [cx, cy] = tileCenter(ev.c, ev.r);
          burst(cx, cy - 40, 12, { size: 14, colors: ['#e6c8ff', '#b266ff', '#ffffff'] });
          ring(cx, cy + 10, '#d9b3ff', 100);
          break;
        }
        case 'stageDone': {   // 片づけの途中の 1 ステップが終わった: 素材が出る(障害物は残る)
          const [cx, cy] = tileCenter(ev.c, ev.r);
          puff(cx, cy, 8, ev.item.k.startsWith('tree') ? '#8fd25a' : '#c8cdd4', 56);
          const vv = getVis(ev.item.id); vv.sx = 1.12; vv.sy = 0.9; tweenProps(vv, { sx: 1, sy: 1 }, 320, ease.outBack);
          if (ev.coins > 0) { flyTo([cx, cy - 30], 'coins', 3, ev.coins); floater(cx, cy - 50, `+${ev.coins}`, '#ffd23f', 30); }
          (ev.drops || []).forEach((sp, i) => {
            const v2 = getVis(sp.item.id), d0 = 150 + i * 90;
            v2.hideUntil = now + d0; v2.oy = -110; v2.sx = v2.sy = 0.5;
            tweenProps(v2, { oy: 0 }, 520, ease.outBounce, d0); tweenProps(v2, { sx: 1, sy: 1 }, 360, ease.outBack, d0);
          });
          toast(`${ev.step}/${ev.of} ${ev.item.k === 'toolbox' ? 'まで開けた' : 'まで片づけた'}`);
          break;
        }
        case 'cleared': {
          const [cx, cy] = tileCenter(ev.c, ev.r), [bx, by] = tileFeet(ev.c, ev.r);
          addFx(340, (p) => ghostDraw(ev.item, bx, by, { sx: 1 + 0.3 * p, sy: 1 - 0.3 * p, alpha: 1 - p }));
          puff(cx, cy, 12, ev.item.k.startsWith('tree') ? '#8fd25a' : '#c8cdd4', 70);
          burst(cx, cy - 10, 8, { size: 12, colors: ['#8a5a32', '#6dbb55', '#c8cdd4'], type: 'dot' });
          if (ev.coins > 0) { flyTo([cx, cy - 30], 'coins', 3, ev.coins); floater(cx, cy - 50, `+${ev.coins}`, '#ffd23f', 30); }
          (ev.drops || []).forEach((sp, i) => {   // 素材が、ぽんと飛び出す
            const v = getVis(sp.item.id), d0 = 200 + i * 120;
            v.hideUntil = now + d0; v.oy = -110; v.sx = v.sy = 0.5;
            tweenProps(v, { oy: 0 }, 520, ease.outBounce, d0); tweenProps(v, { sx: 1, sy: 1 }, 360, ease.outBack, d0);
          });
          break;
        }
        case 'recipeStart': bsquash[ev.building] = performance.now(); refreshPanel(); break;
        case 'recipeReady':
          bsquash[ev.building] = performance.now();
          toast(`${ev.recipe.name}ができた! コインの吹き出しをタップして受け取ろう`);
          refreshPanel();
          break;
        case 'recipeDone': {
          const land = LANDS.find((l) => l.building && l.building.key === ev.building);
          const [cx, cy] = rectCenter(engine.rectOf(ev.building));
          bsquash[ev.building] = performance.now();
          burst(cx, cy - 60, 14, { size: 17 });
          if (ev.spawned && ev.spawned.length) {   // コインのアイテムが、建物の前にぽんと出る
            ev.spawned.forEach((sp, i) => {
              const v = getVis(sp.item.id), dest = tileFeet(sp.c, sp.r), d0 = 150 + i * 140;
              v.hideUntil = performance.now() + d0; v.sx = v.sy = 0.4;
              tween({ delay: d0, dur: 520, ease: ease.linear, update(p) { const e2 = ease.outCubic(p); v.ox = (cx - dest[0]) * (1 - e2); v.oy = (cy - dest[1]) * (1 - e2) - Math.sin(p * 3.14) * 80; v.sx = v.sy = 0.4 + 0.6 * ease.outBack(p); }, done() { v.ox = 0; v.oy = 0; v.sx = v.sy = 1; } });
            });
          }
          refreshPanel();
          break;
        }
        case 'landBought': {
          const land = LANDS.find((l) => l.id === ev.id);
          dissolving[ev.id] = now;
          const [lx, ly] = landLabelPos(land);
          land.cells.forEach(([c, r]) => {
            const delay = 150 + ((c + r) - (land.bounds.c + land.bounds.r)) * 30;
            tileAnim[key(c, r)] = now + delay;
            const it = engine.getItem(c, r);
            if (it) { const v = getVis(it.id); v.hideUntil = now + delay + 150; v.sx = v.sy = 0.2; tweenProps(v, { sx: 1, sy: 1 }, 520, ease.outElastic, delay + 150); }
          });
          burst(lx, ly + 30, 28, { size: 22, speed: 440, colors: ['#ffffff', '#fff7a8', '#bfe9ff'] });
          ring(lx, ly + 30, '#ffffff', 260);
          floater(lx, ly - 20, '土地を解放!', '#ffffff', 36);
          break;
        }
        case 'levelup': {
          $('medal').classList.remove('pulse'); void $('medal').offsetWidth; $('medal').classList.add('pulse');
          lvQueue.push(ev);
          later(650, showLevelUp);
          break;
        }
        default: break;
      }
    }

    // ---------- レベルアップ表示 ----------
    function showLevelUp() {
      const box = $('levelup');
      if (!lvQueue.length || !box.classList.contains('hidden')) return;
      const ev = lvQueue.shift();
      $('lu-level').textContent = ev.level;
      const tile = (img, name, tag, locked) => `<div class="lu-tile"><div class="lu-pic"><img class="p" src="${img}" alt="">${locked ? '<img class="lk" src="assets/ui/tactical/lock.svg" alt="">' : ''}</div><div class="lu-nm">${name}</div><div class="lu-tag">${tag}</div></div>`;
      const li = [];
      (ev.recipes || []).forEach((rc) => li.push(tile(`assets/ref/products/${rc.id}.png`, rc.name, '新しいレシピ', true)));
      ev.unlocked.forEach((k) => li.push(tile(assetUrl(`ref/items/${k}_${CHAINS[k].minTier || 0}`), CHAINS[k].name, CHAINS[k].type === 'animal' ? '新しい動物' : CHAINS[k].type === 'crop' ? '新しい作物' : '新しいアイテム', true)));
      if (ev.reward.crates) li.push(tile('assets/ref/crate_small.png', `箱 ×${ev.reward.crates}`, 'ごほうび', false));
      if (ev.reward.energy) li.push(tile('assets/ui/tactical/bolt.svg', `エネルギー +${ev.reward.energy}`, 'ごほうび', false));
      $('lu-list').innerHTML = li.join('');
      $('lu-sub').classList.toggle('off', !li.length);
      box.classList.remove('hidden');
      const [cx, cy] = s2w(vw / 2, vh / 3);
      confetti(cx, cy);
    }
    $('levelup').addEventListener('click', () => { $('levelup').classList.add('hidden'); later(200, showLevelUp); });

    // ---------- 建物パネル ----------
    const ingImg = (k) => `assets/ref/items/ing_${k}.png`;
    let panelTab = 'order';
    function openPanel(bk) { panelFor = bk; panelTab = 'order'; $('panel').classList.remove('hidden'); refreshPanel(true); }
    function closePanel() { panelFor = null; $('panel').classList.add('hidden'); }
    // 本家の「オーダー」画面のように: 建物ごとに、注文は 1 つずつ。お客さんの顔 / 必要な食材 = 作れる品物 / 報酬 / 作る。下の小さな絵で、作るものを切り替える
    const NPC_N = 13;
    const bIndex = (bk) => Object.keys(BUILDINGS).indexOf(bk);
    const npcImg = (bk, i) => `assets/ref/npc/npc_${(bIndex(bk) * 4 + i) % NPC_N}.png`;
    function refreshPanel(force) {
      if (!panelFor) return;
      const bk = panelFor, def = BUILDINGS[bk], b = engine.state.buildings[bk], now = Date.now(), lv = engine.state.level;
      const body = $('panel-body');
      const broken = !engine.isRepaired(bk);
      $('ord-tabs').style.display = broken ? 'none' : '';
      $('ord-title').textContent = broken ? def.name + 'の修理' : 'オーダー';
      if (broken) {   // 壊れた建物: 修理に要る材料(丸太・レンガ・工具)。ドラッグして渡す
        body.innerHTML = '<p class="rep-msg">壊れています。材料を、建物へドラッグして直そう</p><div class="rep-list">' + engine.repairNeeds(bk).map((x) => {
          const ok = x.have >= x.n, no = Math.min(BUILDINGS[bk].repair[x.i].no, CHAINS[x.k].count);
          return `<div class="rep-item"><span class="no">${CHAINS[x.k].name} ${no}番め</span><img src="assets/ref/items/${x.k}_${x.tier}.png" alt=""><b class="${ok ? 'ok' : ''}">${x.have}/${x.n}</b></div>`;
        }).join('') + '</div>';
        return;
      }
      $('tab-order').classList.toggle('on', panelTab === 'order'); $('tab-stock').classList.toggle('on', panelTab === 'stock');
      if (panelTab === 'stock') {
        const inv = engine.state.inv, chips = Object.keys(inv).filter((n) => inv[n] > 0).map((n) => `<span class="chip"><img src="${ingImg(n)}" alt=""><b>${inv[n]}</b></span>`).join('');
        body.innerHTML = `<div class="ord-stock">${chips || '<p class="ord-empty">食材は、まだありません</p>'}</div>`;
        return;
      }
      // 下の小さな絵は、ショップごとの「いまの注文」(ショップ 1 つにつき 1 つ)
      const shops = Object.keys(BUILDINGS).filter((k) => engine.hasShop(k) && engine.orderOf(k));
      const sel = engine.orderOf(bk);
      if (!sel) { body.innerHTML = `<p class="ord-empty">レベル ${Math.min(...def.recipes.map((r) => r.unlock || 1))} で作れるようになります</p>`; return; }
      const inv = engine.state.inv;
      const enough = (rc) => Object.keys(rc.needs).every((n) => (inv[n] || 0) >= rc.needs[n]);
      const job = b.job ? sel : null;
      const left = job ? (b.job.endsAt - now) / 1000 : 0;
      const needs = Object.keys(sel.needs).map((n) => {
        const have = inv[n] || 0, ok = have >= sel.needs[n];
        return `<div class="ord-need"><img src="${ingImg(n)}" alt=""><i data-ing="${n}">?</i><b class="${ok ? 'ok' : 'lack'}">${have}/${sel.needs[n]}</b></div>`;
      }).join('');
      const FREE = engine.consts.FREE_FINISH_MS / 1000;
      let btn;
      if (b.reward) btn = `<button class="cook-btn go" data-claim="1">受け取る</button>`;
      else if (job) btn = `<button class="cook-btn ${left <= FREE ? '' : 'none'}" data-free="1">無料</button>`;
      else btn = `<button class="cook-btn ${enough(sel) ? 'go' : ''}" data-id="${sel.id}">作る</button>`;
      const n = sel.reward[1], coin = `assets/ref/items/coin_${sel.reward[0]}.png`;
      const timer = b.reward ? '<span class="ord-time">生産完了</span>' : job ? `<span class="ord-time"><img src="assets/ui/tactical/clock.svg" alt="">${mmss2(left)}</span>` : '';
      body.innerHTML = `<div class="ord-main"><img class="ord-npc" src="${npcImg(bk, def.recipes.indexOf(sel))}" alt="">
          <div class="ord-eq">${b.reward ? '' : needs + '<span class="ord-equal">=</span>'}<span class="ord-prodwrap"><img class="ord-prod" src="assets/ref/products/${sel.id}.png" alt="">${timer}</span></div></div>
        <div class="ord-bar"><span>報酬</span><img src="${coin}" alt="">${n > 1 ? `<span>×${n}</span>` : ''}${btn}</div>
        <div class="ord-list">${shops.map((k) => {
          const rc = engine.orderOf(k), cooking = !!engine.state.buildings[k].job;
          const mark = cooking ? '<img class="clk" src="assets/ui/tactical/clock.svg" alt="">' : (enough(rc) ? '<i class="bang">!</i>' : '');
          return `<button class="ord-tile ${k === bk ? 'on' : ''}" data-shop="${k}"><img class="p" src="assets/ref/products/${rc.id}.png" alt=""><img class="c" src="assets/ref/items/coin_${rc.reward[0]}.png" alt="">${mark}</button>`;
        }).join('')}</div>`;
    }
    $('panel-body').addEventListener('click', (e) => {
      const q = e.target.closest('[data-ing]');
      if (q) { toast(INGREDIENTS[q.dataset.ing].name); return; }
      const tile = e.target.closest('[data-shop]');
      if (tile) { panelFor = tile.dataset.shop; refreshPanel(true); return; }
      const btn = e.target.closest('.cook-btn');
      if (!btn) return;
      if (btn.dataset.claim) { claimShopReward(panelFor); refreshPanel(true); return; }
      if (btn.dataset.free) { engine.finishRecipeFree(panelFor); flush(); refreshPanel(true); return; }
      const res = engine.startRecipe(panelFor, btn.dataset.id);
      flush();
      if (!res.ok) { toast(res.reason === 'level' ? `レベル ${res.need} で作れるようになります` : res.reason === 'busy' ? 'このショップは、いま作っています' : '食材が足りません'); }
    });
    $('tab-order').addEventListener('click', () => { panelTab = 'order'; refreshPanel(true); });
    $('tab-stock').addEventListener('click', () => { panelTab = 'stock'; refreshPanel(true); });
    $('panel-close').addEventListener('click', closePanel);
    $('panel').addEventListener('click', (e) => { if (e.target === $('panel')) closePanel(); });

    // ---------- 入力 ----------
    // 背の高い品物は、頭の部分(隣のタイルに見える部分)でも掴めるようにする
    function pickItem(wx, wy) {
      let best = null, bd = -1;
      Object.keys(engine.state.items).forEach((k) => {
        const [c, r] = k.split(',').map(Number);
        if (!engine.isOwned(c, r)) return;
        const it = engine.state.items[k];
        const [bx, by] = tileFeet(c, r), dm = dimsOf(it);
        const onBody = wx > bx - Math.max(dm.w, 56) * 0.42 && wx < bx + Math.max(dm.w, 56) * 0.42 && wy > by - dm.h * 0.9 && wy < by + HH * 0.5;
        // 頭の上の吹き出し(収穫できる・枯れ)も、押せる
        const ph = lifePhase(it), byB = by - Math.max(0, dm.h - 100) - 112;
        const onBubble = (ph === 'ready' || ph === 'withered' || ((it.t === 'obs' || it.k === 'toolbox') && it.pend)) && wx > bx - 28 && wx < bx + 28 && wy > byB - 30 && wy < byB + 34;
        if (onBody || onBubble) {
          const d = depthOf(c, r);
          if (d > bd) { bd = d; best = { c, r, item: it }; }
        }
      });
      return best;
    }
    function hitTest(wx, wy) {
      for (const land of LANDS) {
        if (!land.building || !engine.state.lands[land.id]) continue;
        const bk = land.building.key, b = engine.state.buildings[bk];
        if (!b.reward) continue;
        const g = spriteGeom(bk);
        if (!g) continue;
        const [x, y] = rectCenter(engine.rectOf(bk)), by = y + g.y0 + 24 + Math.sin(performance.now() / 1000 * 4) * 4;
        if (Math.abs(wx - x) <= 32 && wy >= by - 58 && wy <= by + 12) return { type: 'shopReward', key: bk };
      }
      const bubble = rewardBubblePositions().reverse().find((b) => Math.hypot(wx - b.x, wy - b.y) < 32);
      if (bubble) return { type: 'rewardBubble', id: bubble.bubble.id };
      const pick = pickItem(wx, wy);
      if (pick) return { type: 'cell', c: pick.c, r: pick.r, item: pick.item };
      const [c, r] = tileAt(wx, wy);
      // 建物(足元の敷地、または見えている絵の範囲)
      for (const land of LANDS) {
        if (!land.building) continue;
        const [bc, br, bw, bh] = engine.rectOf(land.building.key);
        const cc = unproj(wx, wy);
        const inFoot = cc[0] >= bc && cc[0] < bc + bw && cc[1] >= br && cc[1] < br + bh;
        let inArt = false;
        const g = spriteGeom(engine.isRepaired(land.building.key) ? land.building.key : land.building.key + '_broken');
        if (g) {
          const [x, y] = rectCenter(engine.rectOf(land.building.key));
          inArt = wx > x + g.x0 * 0.8 && wx < x - g.x0 * 0.8 && wy > y + g.y0 * 0.85 && wy < y + g.y0 + g.h * 0.9;
        }
        if (inFoot || inArt) return engine.state.lands[land.id] ? { type: 'building', key: land.building.key } : { type: 'land', land: land.parent ? LANDS.find((l) => l.id === land.parent) : land };
      }
      const lid = engine.landOf(c, r), land = lid ? LANDS.find((l) => l.id === lid) : null;
      if (land) return engine.state.lands[land.id] ? { type: 'cell', c, r, item: engine.getItem(c, r) } : { type: 'land', land };
      // 値札の吹き出し
      for (const l of LANDS) {
        if (engine.state.lands[l.id] || l.parent) continue;
        const [lx, ly] = landLabelPos(l);
        if (Math.abs(wx - lx) < 80 && wy > ly - 50 && wy < ly + 56) return { type: 'land', land: l };
      }
      return null;
    }

    const ptrs = new Map();
    let pinch = null;
    const isTouch = (e) => e.pointerType === 'touch' || e.pointerType === 'pen';

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      obstacleFocus = null;
      canvas.setPointerCapture(e.pointerId);
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: cam.zoom };
        cancelDrag(); pressed = null;
        return;
      }
      if (ptrs.size > 2) return;
      const [wx, wy] = s2w(e.clientX, e.clientY);
      const hit = hitTest(wx, wy);
      hideChest();
      pressed = { id: e.pointerId, sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY, hit, moved: false, t0: performance.now(), touch: isTouch(e) };
      if (e.button === 0 || e.pointerType !== 'mouse') {
        if (hit && hit.type === 'cell' && hit.item && hit.item.t !== 'obs' && hit.item.k !== 'woodbox' && !(hit.item.k === 'toolbox' && (hit.item.pend || engine.state.jobs.some((j) => j.c === hit.c && j.r === hit.r)))) pressed.dragCandidate = { c: hit.c, r: hit.r, item: hit.item };
        // 建物は、長押しで持ち上がって動かせる(ふつうにタップすると、建物のパネルが開く)
        if (hit && hit.type === 'building') { pressed.bcand = hit.key; pressed.lpTimer = setTimeout(startBuildingDrag, 450); }
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      const p = ptrs.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX; p.y = e.clientY;
      if (pinch && ptrs.size >= 2) {
        const [a, b] = [...ptrs.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const before = s2w(mx, my);
        cam.zoom = pinch.zoom * (d / pinch.d); clampCam();
        const after = s2w(mx, my);
        cam.x += before[0] - after[0]; cam.y += before[1] - after[1]; clampCam();
        return;
      }
      if (bdrag && bdrag.pointerId === e.pointerId) { if (pressed) { pressed.lx = e.clientX; pressed.ly = e.clientY; } updateBDrag(e.clientX, e.clientY); return; }
      if (!pressed || pressed.id !== e.pointerId) return;
      const dist = Math.hypot(e.clientX - pressed.sx, e.clientY - pressed.sy);
      if (drag && drag.pointerId === e.pointerId) { updateDrag(e); return; }
      if (!pressed.moved && dist > (pressed.touch ? 9 : 5)) {
        pressed.moved = true;
        clearTimeout(pressed.lpTimer);
        if (pressed.dragCandidate) startDrag(e);
      }
      if (pressed.moved && !drag) {
        cam.x -= (e.clientX - pressed.lx) / cam.zoom; cam.y -= (e.clientY - pressed.ly) / cam.zoom; clampCam();
        canvas.classList.add('dragging');
      }
      pressed.lx = e.clientX; pressed.ly = e.clientY;
    });
    function endPointer(e) {
      ptrs.delete(e.pointerId);
      if (ptrs.size < 2) pinch = null;
      canvas.classList.remove('dragging');
      if (pressed && pressed.id === e.pointerId) clearTimeout(pressed.lpTimer);
      if (bdrag && bdrag.pointerId === e.pointerId) { dropBDrag(e.type === 'pointerup'); pressed = null; return; }
      if (drag && drag.pointerId === e.pointerId) { dropDrag(); pressed = null; return; }
      if (pressed && pressed.id === e.pointerId) {
        if (!pressed.moved && e.type === 'pointerup') handleTap(pressed.hit);
        pressed = null;
      }
    }
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', (e) => { if (drag) cancelDrag(); endPointer(e); });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      obstacleFocus = null;
      const before = s2w(e.clientX, e.clientY);
      cam.zoom *= Math.exp(-e.deltaY * 0.0014); clampCam();
      const after = s2w(e.clientX, e.clientY);
      cam.x += before[0] - after[0]; cam.y += before[1] - after[1]; clampCam();
    }, { passive: false });

    // ---- 建物を動かす ----
    function startBuildingDrag() {
      const pr = pressed;
      if (!pr || !pr.bcand || pr.moved || drag || bdrag) return;
      const bk = pr.bcand, [cx, cy] = rectCenter(engine.rectOf(bk)), [wx, wy] = s2w(pr.lx, pr.ly);
      bdrag = { key: bk, pointerId: pr.id, gx: cx - wx, gy: cy - wy, x: cx, y: cy, target: engine.rectOf(bk).slice(0, 2), ok: true, touch: pr.touch };
      pr.bcand = null;
      delete bmove[bk];
      try { if (navigator.vibrate) navigator.vibrate(14); } catch (err) { /* 振動しない端末もある */ }
      canvas.classList.add('dragging');
      updateBDrag(pr.lx, pr.ly);
    }
    function updateBDrag(sx, sy) {
      const [wx, wy] = s2w(sx, sy), rc = engine.rectOf(bdrag.key);
      bdrag.x = wx + bdrag.gx;
      bdrag.y = wy + bdrag.gy;   // つかんだ位置のまま、指についてくる
      const [cc, rr] = unproj(bdrag.x, bdrag.y);
      bdrag.target = [Math.round(cc - rc[2] / 2), Math.round(rr - rc[3] / 2)];
      bdrag.ok = engine.canMoveBuilding(bdrag.key, bdrag.target[0], bdrag.target[1]).ok;
    }
    function dropBDrag(commit) {
      const b = bdrag;
      bdrag = null;
      canvas.classList.remove('dragging');
      bmove[b.key] = { fx: b.x, fy: b.y - 22, t0: performance.now() };
      if (!commit) return;
      const res = engine.moveBuilding(b.key, b.target[0], b.target[1]);
      flush();
      if (res.ok) { if (!res.same) { bsquash[b.key] = performance.now(); } return; }
      if (res.reason === 'blocked') toast('障害物のあるマスには置けません');
      else if (res.reason === 'full') toast('品物を寄せる空きマスが足りません');
      else toast('建物は、持っている土地の空きマスに置けます');
    }

    function startDrag(e) {
      const dc = pressed.dragCandidate;
      const it = engine.getItem(dc.c, dc.r);
      if (!it) return;
      const [wx, wy] = s2w(pressed.sx, pressed.sy);
      const base = tileFeet(dc.c, dc.r);
      drag = { pointerId: e.pointerId, id: it.id, from: [dc.c, dc.r], started: true, x: base[0], y: base[1], gx: base[0] - wx, gy: base[1] - wy, hover: null, hoverOk: false, feedable: false, touch: pressed.touch };
      const v = getVis(it.id);
      v.ox = 0; v.oy = 0; v.sx = 1; v.sy = 1; v.rot = 0;
      tweenProps(v, { sx: 1.16, sy: 1.16 }, 150, ease.outBack);
      canvas.classList.add('dragging');
      updateDrag(e);
    }
    function updateDrag(e) {
      const [wx, wy] = s2w(e.clientX, e.clientY);
      drag.x = wx + drag.gx;
      drag.y = wy + drag.gy;   // つかんだ位置のまま、指についてくる(上にずらさない)
      // 足元の少し上(タイルの中心)がどのタイルかで、置き先を決める
      const [hc, hr] = tileAt(drag.x, drag.y - HH * 0.42);
      const it = engine.getItem(drag.from[0], drag.from[1]);
      const bk = engine.buildingAt(hc, hr);
      drag.hover = [hc, hr];
      drag.feedable = false; drag.hoverOk = false;
      if (bk) drag.feedable = !!it && (engine.isRepaired(bk) ? it.t === 'ing' && BUILDINGS[bk].recipes.some((r) => r.needs[it.k]) : it.t === 'chain' && engine.repairNeeds(bk).some((x) => x.k === it.k && x.tier === it.tier && x.have < x.n));
      else if (engine.isOwned(hc, hr)) {
        const other = engine.getItem(hc, hr);
        drag.hoverOk = !other || other.t !== 'obs';
      }
    }
    // 指を止めていても、持っている品物が画面端へ近づくとカメラを送る。
    function scrollHeldItem(dt) {
      if ((!drag && !bdrag) || pinch || ptrs.size !== 1) return;
      const held = drag || bdrag, p = ptrs.get(held.pointerId);
      if (!p) return;
      const edge = Math.min(64, vw * 0.15, vh * 0.15);
      const speed = (pos, span) => pos < edge ? -clamp((edge - pos) / edge, 0, 1) : pos > span - edge ? clamp((pos - span + edge) / edge, 0, 1) : 0;
      const dx = speed(p.x, vw) * 560 * dt / cam.zoom, dy = speed(p.y, vh) * 560 * dt / cam.zoom;
      if (!dx && !dy) return;
      cam.x += dx; cam.y += dy; clampCam();
      if (drag) updateDrag({ clientX: p.x, clientY: p.y }); else updateBDrag(p.x, p.y);
    }
    function cancelDrag() {
      if (!drag) return;
      const it = engine.getItem(drag.from[0], drag.from[1]);
      if (it) { const v = getVis(it.id); const b = tileFeet(drag.from[0], drag.from[1]); v.ox = drag.x - b[0]; v.oy = drag.y - b[1]; tweenProps(v, { ox: 0, oy: 0, sx: 1, sy: 1 }, 240, ease.outBack); }
      drag = null; canvas.classList.remove('dragging');
    }
    function dropDrag() {
      const d = drag;
      drag = null;
      const from = d.from;
      const it = engine.getItem(from[0], from[1]);
      const revert = () => {
        if (!it) return;
        const v = getVis(it.id), b = tileFeet(from[0], from[1]);
        v.ox = d.x - b[0]; v.oy = d.y - b[1];
        tweenProps(v, { ox: 0, oy: 0, sx: 1, sy: 1 }, 260, ease.outBack);
      };
      if (!d.hover) { revert(); return; }
      lastDrop = [d.x, d.y]; lastDropFrom = from;
      const res = engine.move(from, d.hover);
      flush();
      if (!res.ok) {
        lastDrop = null; revert();
        if (res.reason === 'notneeded') toast(res.broken ? 'この建物の修理に使う材料(丸太・レンガ・工具)を、表の番号のとおりに渡そう' : 'この建物では使わない食材です');
        else if (res.reason === 'notingredient') toast('建物には食材を渡せます');
        else if (res.reason === 'needmore') toast('同じ品物が3つ(動かす1つを入れて)つながるところに重ねよう');
        return;
      }
      if (res.same || res.merged) { lastDrop = null; if (res.same) revert(); }
    }

    // ---------- 回復中のふきだし ----------
    let regrowFor = null;
    const hideRegrow = () => { regrowFor = null; $('regrow').classList.add('hidden'); };
    function updateRegrow() {
      if (!regrowFor) return;
      const [c, r] = regrowFor, it = engine.getItem(c, r);
      const left = it ? engine.regrowLeft(it) : 0;
      if (!it || left <= 0) { hideRegrow(); return; }
      const [bx, by] = tileFeet(c, r), dm = dimsOf(it), [sx, sy] = w2s(bx, by - dm.h * 0.5), el = $('regrow');
      el.style.left = clamp(sx, 96, vw - 96) + 'px'; el.style.top = Math.max(sy - 18, 130) + 'px';
      const sec = Math.ceil(left / 1000), h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
      const txt = h > 0 ? `${h}H ${m}M ${sec % 60}S` : `${m}M ${sec % 60}S`;
      setText('rg-time', txt); setText('rg-cost', String(Math.ceil(left / 60000)));
      el.classList.remove('hidden');
    }
    $('rg-skip').addEventListener('click', () => {
      if (!regrowFor) return;
      const res = engine.skipRegrow(regrowFor[0], regrowFor[1]);
      flush();
      if (res.ok) { hideRegrow(); return; }
      if (res.reason === 'nogems') { toast(`ジェムが足りません (必要 ${res.cost})`); const el = $('gem-pill'); el.classList.remove('warn'); void el.offsetWidth; el.classList.add('warn'); }
    });

    function handleTap(hit) {
      obstacleFocus = hit && hit.type === 'cell' && hit.item && hit.item.t === 'obs' && /^(tree|rock)_/.test(hit.item.k) ? hit.item.id : null;
      hideRegrow();
      hideChest();
      if (!hit) return;
      if (hit.type === 'rewardBubble') { const res = engine.claimRewardBubble(hit.id); flush(); if (res.reason === 'full') toast('マスに十分な空きがありません'); return; }
      if (hit.type === 'shopReward' || (hit.type === 'building' && engine.state.buildings[hit.key].reward)) { claimShopReward(hit.key); return; }
      if (hit.type === 'building') { openPanel(hit.key); bsquash[hit.key] = performance.now(); return; }
      if (hit.type === 'land') {
        const res = engine.buyLand(hit.land.id);
        flush();
        if (!res.ok) {
          if (res.reason === 'level') toast(`レベル ${res.need} で解放できます`);
          else if (res.reason === 'coins') { toast(`コインが足りません (${res.need})`); const el = $('coin-pill'); el.classList.remove('warn'); void el.offsetWidth; el.classList.add('warn'); }
        }
        return;
      }
      if (hit.type === 'cell' && hit.item) {
        const it = hit.item;
        if (it.k === 'lockbox') { chestFor = { c: hit.c, r: hit.r, id: it.id }; updateChest(); return; }
        const res = engine.tap(hit.c, hit.r);
        flush();
        if (res.ok) return;
        if (it.t === 'obs' || it.k === 'toolbox') {
          wiggle(hit.c, hit.r);
          if (res.reason === 'busy') { if (engine.state.jobs.length >= engine.workerCap()) openWorkers(); else toast('この障害物は、作業中です'); }   // 作業者が足りないとき、本家の「作業者が足りません!」の画面を出す
          else if (res.reason === 'noenergy') { toast(`エネルギーが足りません (必要 ${res.need})`); const el = $('energy-pill'); el.classList.remove('warn'); void el.offsetWidth; el.classList.add('warn'); }
          else if (res.reason === 'full') toast('マスに十分な空きがありません');
          return;
        }
        if (res.reason === 'regrow') { regrowFor = [hit.c, hit.r]; updateRegrow(); return; }
        if (res.reason === 'key') { toast(['銅', '銀', '金'][it.tier] + 'の宝箱をタップして、同じ色のカギ2個で開けよう'); return; }
        wiggle(hit.c, hit.r);
        if (res.reason === 'ingredient') toast('食材は建物にドラッグして渡そう');
        else if (res.reason === 'full') { toast('マスに十分な空きがありません'); }
        else if (res.reason === 'energyfull') { toast('エネルギーは満タンです'); }
        else if (res.reason === 'single') toast('同じ品物を2つ並べて、3つ目を上に重ねて合体!');
      }
    }

    // ---------- HUD ----------
    const lastText = {};
    const setText = (id, v) => { if (lastText[id] !== v) { lastText[id] = v; $(id).textContent = v; } };
    const mmss2 = (secs) => { const t = Math.max(0, Math.ceil(secs)); return `${String(Math.floor(t / 60)).padStart(2, '0')}M ${String(t % 60).padStart(2, '0')}S`; };
    const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

    // 本家と同じ操作: 宝箱をタップ → 同色のカギ2個を「開ける」で消費。
    let chestFor = null, chestPressId = null;
    function hideChest() { chestFor = null; chestPressId = null; $('chest').classList.add('hidden'); }
    function updateChest() {
      if (!chestFor) return;
      const info = engine.chestInfo(chestFor.c, chestFor.r);
      if (!info || info.id !== chestFor.id || info.left <= 0) { hideChest(); return; }
      const [bx, by] = tileFeet(chestFor.c, chestFor.r), dm = dimsOf(engine.getItem(chestFor.c, chestFor.r));
      const [sx, sy] = w2s(bx, by - dm.h * 0.9), el = $('chest');
      el.classList.remove('hidden');
      const half = el.offsetWidth / 2, x = clamp(sx, half + 8, vw - half - 8);
      el.style.left = x + 'px'; el.style.top = clamp(sy - 12, el.offsetHeight + 8, vh - 16) + 'px';
      el.style.setProperty('--chest-pointer', clamp(sx - x + half, 20, el.offsetWidth - 20) + 'px');
      setText('chest-title', info.name);
      const seconds = Math.ceil(info.left / 1000), h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60);
      setText('chest-time', `${h}H ${m}M ${seconds % 60}S`);
      setText('chest-count', `${info.have}/${info.need}`);
      const keySrc = assetUrl(`ref/items/keys_${info.tier}`);
      if ($('chest-key').getAttribute('src') !== keySrc) $('chest-key').src = keySrc;
      $('chest-key').alt = ['銅', '銀', '金'][info.tier] + 'のカギ';
      $('chest-count').classList.toggle('enough', info.have >= info.need);
      $('chest-open').disabled = info.have < info.need;
    }
    $('chest-close').addEventListener('click', hideChest);
    $('chest-open').addEventListener('pointerdown', () => { chestPressId = chestFor && chestFor.id; });
    $('chest-open').addEventListener('pointercancel', () => { chestPressId = null; });
    $('chest-open').addEventListener('click', (event) => {
      if (!chestFor) return;
      // 横画面で新しく出たボタンが元のタップ位置に重なっても、選択のタップでは開けない。
      // キーボード操作(detail=0)は許可。ポインター操作はボタン自体を押したときのみ。
      if (event.detail !== 0 && chestPressId !== chestFor.id) return;
      chestPressId = null;
      const res = engine.openChest(chestFor.c, chestFor.r, chestFor.id);
      flush();
      if (res.ok) hideChest(); else { updateChest(); if (res.reason === 'keys') toast('同じ色のカギが2個必要です'); }
    });
    function updateHud() {
      const s = engine.state, t = Date.now();
      const tc = s.coins - hold.coins, te = s.energy - hold.energy;
      disp.coins += (tc - disp.coins) * 0.22; if (Math.abs(tc - disp.coins) < 0.5) disp.coins = tc;
      disp.energy += (te - disp.energy) * 0.25; if (Math.abs(te - disp.energy) < 0.5) disp.energy = te;
      setText('coin-num', String(Math.round(disp.coins)));
      const tg = s.gems - hold.gems;
      disp.gems += (tg - disp.gems) * 0.22; if (Math.abs(tg - disp.gems) < 0.5) disp.gems = tg;
      setText('gem-num', String(Math.round(disp.gems)));
      setText('energy-num', String(Math.round(disp.energy)));
      setText('level-num', String(s.level));
      const need = xpForLevel(s.level);
      disp.xp += (s.xp - disp.xp) * 0.2; if (Math.abs(s.xp - disp.xp) < 0.3) disp.xp = s.xp;
      $('xp-fill').style.width = clamp(disp.xp / need, 0, 1) * 100 + '%';
      setText('xp-text', `${s.xp}/${need}`);
      setText('energy-timer', s.energy < MAX_ENERGY ? mmss(engine.consts.ENERGY_REGEN_MS - (t - s.lastEnergyAt)) : 'MAX');
      refreshCardsBadge();
      updateRegrow();
      updateChest();
      setText('crate-count', s.crates + '/' + engine.consts.MAX_CRATES);
      setText('crate-timer', s.crates < engine.consts.MAX_CRATES ? mmss2((engine.consts.CRATE_REGEN_MS - (t - s.lastCrateAt)) / 1000) : '');
      $('crate-regen').classList.toggle('off', s.crates >= engine.consts.MAX_CRATES);
      $('crate-btn').classList.toggle('empty', s.crates <= 0);
      $('crate-btn').classList.toggle('ready', s.crates > 0 && engine.freeCells().length > 0);
      // 作業者の表示(使っている人数 / 全部の人数)
      const cap = engine.workerCap();
      setText('worker-text', `${s.jobs.length}/${cap}`);
      $('worker-chip').classList.toggle('full', s.jobs.length >= cap);
      if (!$('workers').classList.contains('hidden')) renderWorkers();
    }

    // ---------- 作業者の画面(本家の「作業者が足りません!」) ----------
    const fmtLeft = (ms) => { const m = Math.max(0, Math.ceil(ms / 60000)), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60); return d > 0 ? `${d}日${h}時間` : h > 0 ? `${h}時間${m % 60}分` : `${m}分`; };
    function renderWorkers() {
      const s = engine.state, t = Date.now(), cap = engine.workerCap(), rentals = s.rentals.filter((u) => u > t);
      $('wk-title').textContent = s.jobs.length >= cap ? '作業者が足りません!' : '作業者';
      setText('wk-count', `${s.jobs.length}/${cap}`);
      setText('wk-gems', String(engine.consts.WORKER_RENT_GEMS));
      setText('wk-note', rentals.length ? `借りている作業者: ${rentals.length}人(いちばん早い期限まで あと${fmtLeft(Math.min(...rentals) - t)})` : '');
    }
    const openWorkers = () => { renderWorkers(); $('workers').classList.remove('hidden'); };
    const closeWorkers = () => $('workers').classList.add('hidden');
    $('worker-chip').addEventListener('click', openWorkers);
    $('wk-close').addEventListener('click', closeWorkers);
    $('wk-rent').addEventListener('click', () => {
      const res = engine.rentWorker();
      flush();
      if (!res.ok) { toast(`ジェムが足りません (必要 ${res.cost})`); const el = $('gem-pill'); el.classList.remove('warn'); void el.offsetWidth; el.classList.add('warn'); return; }
      toast('作業者を借りました(14日間)'); renderWorkers(); closeWorkers();
    });

    // ---------- ボタン ----------
    $('crate-btn').addEventListener('click', () => {
      // 画面の中心にいちばん近い空きマスから出す(ばらばらに出さない)
      let at = null, bd = 1e18;
      engine.crateCells().forEach(([c, r]) => { const p = tileCenter(c, r), d = (p[0] - cam.x) ** 2 + (p[1] - cam.y) ** 2; if (d < bd) { bd = d; at = [c, r]; } });
      const res = engine.openCrate(at);
      flush();
      if (!res.ok) {
        toast(res.reason === 'full' ? '空きマスがありません。合体してスペースを作ろう' : '箱がありません。少し待つかレベルアップで増えます');
      }
    });
    $('crate-btn').addEventListener('animationend', (event) => {
      if (event.animationName === 'cargo-button-pop') $('crate-btn').classList.remove('squash');
    });
    // ---------- アップグレードカードの画面 ----------
    const stars = (n) => '<img src="assets/ref/cards/arrow.png" alt="">'.repeat(n);
    function refreshCardsBadge() {
      let n = 0;
      Object.keys(engine.state.cards || {}).forEach((k) => { const cd = engine.state.cards[k]; if (cd.c1 + cd.c2 + cd.c3 > 0) n += cd.c1 + cd.c2 + cd.c3; });
      if (lastText['cards-badge'] === n) return;
      lastText['cards-badge'] = n;
      const b = $('cards-badge'); if (b) { b.textContent = String(n); b.classList.toggle('hidden', n <= 0); }
    }
    function renderCards() {
      const s = engine.state, ks = Object.keys(CHAINS).filter((k) => CHAINS[k].type !== 'bonus' && CHAINS[k].unlock <= s.level);
      $('cards-list').innerHTML = ks.map((k) => {
        const cd = engine.cardOf(k), name = CHAINS[k].name;
        const canUse = [3, 2, 1].find((st) => cd['c' + st] > 0 && st > cd.lv);
        const canMerge = [1, 2].find((st) => cd['c' + st] >= 3);
        const tiles = [1, 2, 3].map((st) => `<span class="ctile ${cd['c' + st] ? '' : 'zero'}"><img src="assets/ref/cards/frame_${st}.png" alt=""><b>${cd['c' + st]}</b></span>`).join('');
        return `<div class="crow"><img class="pic" src="assets/ref/cards/pic_${k}.png" alt="">
          <div><div class="nm">${name} ${cd.lv ? stars(cd.lv) : ''}</div><div class="sub">収穫 ${engine.consts.HARVEST_BASE + engine.consts.HARVEST_PER_STAR * cd.lv} 個${cd.lv ? '(星 ' + cd.lv + ')' : ''}</div><div class="ctiles">${tiles}</div></div>
          <div class="cbtns"><button class="use" data-k="${k}" data-star="${canUse || ''}" ${canUse ? '' : 'disabled'}>${canUse ? '★' + canUse + ' を使う' : '使う'}</button><button class="mrg" data-k="${k}" data-merge="${canMerge || ''}" ${canMerge ? '' : 'disabled'}>合体</button></div></div>`;
      }).join('') || '<p class="card-sub">まだ作物・動物がありません</p>';
    }
    $('cards-close').addEventListener('click', () => $('cards').classList.add('hidden'));
    $('cards-list').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b || b.disabled) return;
      if (b.dataset.star) engine.useCard(b.dataset.k, +b.dataset.star);
      else if (b.dataset.merge) engine.mergeCards(b.dataset.k, +b.dataset.merge);
      flush();
    });

    // 公開ページでは confirm() が使えないので、二度押しで確認する
    let resetArmed = 0;
    $('btn-reset').addEventListener('click', () => {
      if (performance.now() < resetArmed) { hooks.reset(); return; }
      resetArmed = performance.now() + 3500;
      $('btn-reset').classList.add('armed'); setTimeout(() => $('btn-reset').classList.remove('armed'), 3500);
      toast('もう一度押すと、最初からやり直します');
    });

    function claimShopReward(bk) {
      const res = engine.claimRecipe(bk);
      flush();
      if (res.reason === 'full') toast('マスに十分な空きがありません');
      return res;
    }

    // ---------- メインループ ----------
    let last = performance.now(), pruneAt = 0, panelAt = 0;
    const stats = { drawMs: 0 };
    function frame(now) {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      scrollHeldItem(dt);
      engine.tick();
      engine.drain().forEach(onEvent);
      F.stepTweens(now);
      updateParts(dt);
      const d0 = performance.now();
      draw(now, now / 1000);
      stats.drawMs = performance.now() - d0;
      updateHud();
      if (panelFor && now > panelAt) { panelAt = now + 250; refreshPanel(); }
      if (now > pruneAt) {
        pruneAt = now + 8000;
        const live = new Set(Object.values(engine.state.items).map((i) => i.id));
        vis.forEach((_, id) => { if (!live.has(id)) vis.delete(id); });
      }
      requestAnimationFrame(frame);
    }

    function start() {
      let saved = 0;
      try { saved = parseInt(localStorage.getItem('fmv-tut') || '0', 10) || 0; } catch (e) { /* ignore */ }
      setTut(Math.max(0, saved), true);
      resize(); if (!camInit && vw > 1) { camInit = true; resetCamera(); }
      const s = engine.state;
      disp.coins = s.coins; disp.energy = s.energy; disp.gems = s.gems; disp.xp = s.xp;
      window.addEventListener('resize', resize);
      if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
      requestAnimationFrame(frame);
    }

    const tileScreen = (c, r) => { const [x, y] = tileFeet(c, r); return w2s(x, y - 30); };
    return { start, resize, resetCamera, toast, stats, tileScreen };
  }

  root.FMV = Object.assign(root.FMV || {}, { createView, loadAssets });
})(window);
