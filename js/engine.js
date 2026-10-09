// ゲームロジック。DOM を使わないので Node でもテストできる。
// 状態を変える操作は、見た目の演出用イベントを events に積む(view 側が drain して再生する)。
(function (root) {
  const D = typeof module !== 'undefined' && module.exports ? require('./data.js') : root.FMV;
  const { CHAINS, INGREDIENTS, OBSTACLES, BUILDINGS, LANDS, CELL_LAND, MAX_ENERGY, key, rectCells, xpForLevel, levelUpReward, XP_GAIN, recipeReward, OBS_STEPS, OBS_STAGES, LAYOUT_CUSTOM, LAYOUT_REVISION, FORMERLY_OPEN_LANDS, SPLIT_LANDS, CHESTS, CHEST_KEYS, CHEST_LIFETIME_MS } = D;

  // 本家と同じ: エネルギーは 3 分に 1(上限 50)。箱は 5 分に 5 個(上限 40。ご褒美で、上限を超えることもある)
  const ENERGY_REGEN_MS = 180000;
  const CRATE_REGEN_MS = 300000;
  const CRATE_REGEN_AMOUNT = 5;
  const MAX_CRATES = 40;
  const START_CRATES = 1000; // テスト用の開始時所持数。自然回復の上限は40のまま。
  // アップグレードカード(本家): 収穫のときに、ときどき星 1 のカードが出る。星 1 を 3 枚で星 2、星 2 を 3 枚で星 3 に合体できる。
  // 使うと、その作物・動物の「星のレベル」が上がり、収穫で出る食材が、星 1 つにつき 1 つ増える。
  // 1 つの系統で出るカードは、星 3 のカード 1 枚ぶん(星 1 の 9 枚ぶん)まで。そろったら、もう出ない。
  // 収穫のあと: 作物・動物は 5 段階めの見た目になり、1 時間(REGROW_MS)は時計がついて収穫できない。1 時間たつと、もう一度収穫できる。
  // そのあとは枯れた見た目になり、タップすると、作物は 1 段階めの苗が 2 つ、動物は銅貨が 1 枚出る。
  // 待ち時間は、ジェムで飛ばせる(画像から: 52 分 52 秒で 53 個。1 分につき 1 個、切り上げ)。ジェムは、はじめに GEM_START 個(画像の数)。
  const REGROW_MS = 3600000;
  // 作っている間の「無料」ボタン: 残りがこの時間以下のときだけ押せる(画像: 残り 26 秒で「無料」)。これより長いときの表示は、ユーザーに確認中
  const FREE_FINISH_MS = 30000;
  const GEM_START = 5;
  // 作業者: はじめは 1 人。ジェムで、14 日間、作業者を借りられる(wiki の Gems)。人数に上限はなく、借りた分だけ増える。
  // 借りるジェムの数は、いつでも同じ(ユーザーに聞いた)。本家の画面の数: 225
  const WORKER_RENT_MS = 14 * 24 * 3600 * 1000;
  const WORKER_RENT_GEMS = 225;
  const CARD_DROP_RATE = 0.3;
  const CARD_UNITS = { 1: 1, 2: 3, 3: 9 };
  const CARD_CAP = 9;
  // 収穫 1 回で出る食材の数(ユーザーから聞いた本家の数): 4 つ。星のレベル 1 つにつき 2 つ増える(ユーザーの指示)
  const HARVEST_BASE = 4, HARVEST_PER_STAR = 2;
  const LUCKY_RATE = 0.05;
  const SAVE_VERSION = 3;   // 3: 土地の配置を、マップエディタの地図に変えた(古い保存データは使えない)

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function createEngine(opts = {}) {
    const rng = opts.rng || Math.random;
    const now = opts.now || (() => Date.now());
    let s = null;
    let events = [];

    const emit = (type, data) => events.push(Object.assign({ type }, data));
    const drain = () => { const e = events; events = []; return e; };

    // ---------- 状態 ----------
    function newState() {
      const st = {
        v: SAVE_VERSION, layoutRevision: LAYOUT_REVISION, level: 1, xp: 0, coins: 0, gems: GEM_START, energy: MAX_ENERGY, crates: START_CRATES, sinceKC: 0,
        lastEnergyAt: now(), lastCrateAt: now(),
        lands: {}, items: {}, nextId: 1,
        buildings: {}, inv: {}, jobs: [], rentals: [], bpos: {}, cards: {}, rewardBubbles: [],
      };
      Object.keys(BUILDINGS).forEach((k) => { st.buildings[k] = { job: null, repaired: !BUILDINGS[k].repair, paid: {} }; });
      s = st;
      LANDS.forEach((l) => { if (l.start !== undefined ? l.start : l.id === 1) st.lands[l.id] = true; });   // 最初から開いている土地
      placeObstacles(mulberry32(20240607));
      // 最初の盤面。マップエディタの地図(layout.js)なら、地図に置いた品物。そうでなければ、小麦のタネ数個
      if (!LAYOUT_CUSTOM) [[1, 2, 0], [2, 2, 0], [3, 3, 0], [1, 3, 1], [3, 1, 1], [2, 4, 0]].forEach(([c, r, t]) => putItem(c, r, { t: 'chain', k: 'wheat', tier: t }));
      tickChests();
      return st;
    }

    function placeObstacles(r) {
      LANDS.forEach((land) => {
        if (land.items) {   // 地図に置いた品物・障害物(雲の下のものも)
          Object.keys(land.items).forEach((k) => { const [c, rr] = k.split(',').map(Number), it = land.items[k]; putItem(c, rr, it.t === 'obs' ? { t: 'obs', k: it.k, tier: 0 } : { t: 'chain', k: it.k, tier: it.tier }); });
          return;
        }
        if (!land.obstacles) return;
        const cells = land.cells.slice();
        for (let i = cells.length - 1; i > 0; i--) {
          const j = Math.floor(r() * (i + 1));
          [cells[i], cells[j]] = [cells[j], cells[i]];
        }
        land.obstacles.forEach((ok, idx) => {
          const [c, rr] = cells[idx];
          putItem(c, rr, { t: 'obs', k: ok, tier: 0 });
        });
      });
    }

    function putItem(c, r, it) {
      it.id = s.nextId++;
      if (it.k === 'lockbox' && isOwned(c, r)) it.expiresAt = now() + CHEST_LIFETIME_MS;
      s.items[key(c, r)] = it;
      return it;
    }
    const getItem = (c, r) => (s ? s.items[key(c, r)] || null : null);
    const inGrid = () => true; // 土地は負の座標にも広がる。所有しているかで判定する
    // ---- 建物の敷地(動かせる)。bpos に「動かした建物の左上」を入れる。無ければ、データの初期位置 ----
    const BLAND = {};   // 建物 → その土地
    LANDS.forEach((l) => { if (l.building) BLAND[l.building.key] = l; });
    function rectOf(bk) {
        const d = BLAND[bk].building.rect, p = s.bpos && s.bpos[bk];
        return p ? [p[0], p[1], d[2], d[3]] : d.slice();
    }
    const inRect = (rc, c, r) => c >= rc[0] && c < rc[0] + rc[2] && r >= rc[1] && r < rc[1] + rc[3];
    function coveredBy(c, r) {                       // いま、建物の敷地になっているマスなら、その建物
      for (const bk of Object.keys(BLAND)) if (inRect(rectOf(bk), c, r)) return bk;
      return null;
    }
    // マスの土地。建物の敷地は、どの土地でもない。建物が動いたあとの元の敷地は、その土地のマスに戻る
    function landOf(c, r) {
      if (coveredBy(c, r)) return 0;
      const cl = CELL_LAND[key(c, r)];
      if (cl) return cl;
      for (const bk of Object.keys(s.bpos || {})) if (inRect(BLAND[bk].building.rect, c, r)) return BLAND[bk].id;
      return 0;
    }
    const isOwned = (c, r) => !!(landOf(c, r) && s.lands[landOf(c, r)]);
    const isFree = (c, r) => isOwned(c, r) && !s.items[key(c, r)];
    // 土地のいまのマス(建物の敷地を除き、建物が動いたあとの元の敷地を足す)
    function landCells(id) {
      const land = LANDS.find((l) => l.id === id), out = land.cells.filter(([c, r]) => !coveredBy(c, r));
      if (land.building && s.bpos && s.bpos[land.building.key]) {
        rectCells(land.building.rect).forEach(([c, r]) => { if (!coveredBy(c, r)) out.push([c, r]); });
      }
      return out;
    }

    function ownedCells() {
      const out = [];
      LANDS.forEach((l) => { if (s.lands[l.id]) landCells(l.id).forEach((cc) => out.push(cc)); });
      return out;
    }
    function freeCells() { return ownedCells().filter(([c, r]) => !s.items[key(c, r)]); }
    // 箱から出る品物の置き場所。マップエディタの地図では、遠くに離れた土地にも品物が出てしまうので、
    // はじめの土地から、となりあってつながっている土地のマスだけにする(そこが満杯のときは、開いている土地ぜんぶ)
    function crateCells() {
      const free = freeCells();
      if (!LAYOUT_CUSTOM || LAYOUT_REVISION >= 2) return free; // 雲を買って開けた土地は、画面中央から箱を出せる。
      const own = new Set(ownedCells().map(([c, r]) => key(c, r)));
      const start = LANDS.find((l) => (l.start !== undefined ? l.start : l.id === 1) && l.cells.length);
      const seen = new Set(), st = start ? start.cells.map(([c, r]) => key(c, r)).filter((k) => own.has(k)) : [];
      st.forEach((k) => seen.add(k));
      while (st.length) {
        const [c, r] = st.pop().split(',').map(Number);
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dc, dr]) => { const n = key(c + dc, r + dr); if (own.has(n) && !seen.has(n)) { seen.add(n); st.push(n); } });
      }
      const near = free.filter(([c, r]) => seen.has(key(c, r)));
      return near.length ? near : free;
    }
    // 建物は、壊れた状態から始まる(直売所だけは、はじめから使える)。修理の材料(丸太・レンガ・工具)を、建物へドラッグして渡すと直る
    const isRepaired = (bk) => s.buildings[bk].repaired !== false;
    const repairTier = (rq) => Math.min(rq.no, CHAINS[rq.k].count) - 1;   // 「丸太の 7 番め」→ その系統の tier(0 から数える)
    function repairNeeds(bk) {
      const def = BUILDINGS[bk]; if (!def.repair) return [];
      const paid = s.buildings[bk].paid || {};
      return def.repair.map((rq, i) => ({ i, k: rq.k, tier: repairTier(rq), n: rq.n, have: Math.min(rq.n, paid[i] || 0) }));
    }
    // お店として使える建物: 地図に置いてあって、直っているもの
    const hasShop = (bk) => !!BLAND[bk] && !!s.lands[BLAND[bk].id] && s.level >= BLAND[bk].level && isRepaired(bk);

    // 起点に近い空きマスを n 個(マンハッタン距離順)
    function nearestFree(c, r, n) {
      return freeCells()
        .map(([x, y]) => ({ x, y, d: Math.abs(x - c) + Math.abs(y - r) + rng() * 0.5 }))
        .sort((a, b) => a.d - b.d)
        .slice(0, n)
        .map(({ x, y }) => [x, y]);
    }

    // ---------- 時間経過 ----------
    function tick() {
      tickChests();
      const t = now();
      if (s.energy < MAX_ENERGY) {
        const gain = Math.floor((t - s.lastEnergyAt) / ENERGY_REGEN_MS);
        if (gain > 0) { s.energy = Math.min(MAX_ENERGY, s.energy + gain); s.lastEnergyAt += gain * ENERGY_REGEN_MS; }
      } else s.lastEnergyAt = t;
      if (s.crates < MAX_CRATES) {
        const gain = Math.floor((t - s.lastCrateAt) / CRATE_REGEN_MS);
        if (gain > 0) { s.crates = Math.min(MAX_CRATES, s.crates + gain * CRATE_REGEN_AMOUNT); s.lastCrateAt += gain * CRATE_REGEN_MS; }
      } else s.lastCrateAt = t;

      s.rentals = s.rentals.filter((u) => u > t);   // 期限が切れた作業者は、いなくなる(作業中の仕事は、終わるまで続く)
      s.jobs.filter((j) => t >= j.endsAt).forEach((j) => finishClear(j));
      Object.keys(s.buildings).forEach((bk) => {
        const b = s.buildings[bk];
        if (b.job && t >= b.job.endsAt) {
          const rec = BUILDINGS[bk].recipes.find((x) => x.id === b.job.id);
          b.job = null;
          const [tier, n] = rec.reward, rc = rectOf(bk), value = recipeReward(rec);
          const spots = nearestFree(rc[0], rc[1], n), spawned = [];
          for (let i = 0; i < n; i++) {
            if (spots[i]) { const it = putItem(spots[i][0], spots[i][1], { t: 'chain', k: 'coin', tier }); spawned.push({ c: spots[i][0], r: spots[i][1], item: Object.assign({}, it) }); }
            else s.coins += Math.pow(3, tier);   // 置く場所がなければ、そのまま受け取る
          }
          emit('recipeDone', { building: bk, recipe: rec, coins: value, spawned });
          addXp(Math.round(value * 0.6));
        }
      });
    }

    // 雲の下の宝箱は土地の購入で盤面に現れてから期限を数える。
    function tickChests() {
      const t = now();
      Object.keys(s.items).forEach((pos) => {
        const it = s.items[pos];
        if (it.k !== 'lockbox') return;
        const [c, r] = pos.split(',').map(Number);
        if (!isOwned(c, r)) return;
        if (!Number.isFinite(it.expiresAt)) it.expiresAt = t + CHEST_LIFETIME_MS;
        if (it.expiresAt <= t) { delete s.items[pos]; emit('chestExpired', { c, r, item: it }); }
      });
    }
    function chestInfo(c, r) {
      const it = getItem(c, r);
      if (!it || it.k !== 'lockbox' || !isOwned(c, r)) return null;
      const keys = Object.entries(s.items).filter(([pos, item]) => item.t === 'chain' && item.k === 'keys' && item.tier === it.tier && isOwned(...pos.split(',').map(Number)));
      return { id: it.id, tier: it.tier, name: CHESTS[it.tier].name, have: keys.length, need: CHEST_KEYS, left: Math.max(0, (it.expiresAt || now() + CHEST_LIFETIME_MS) - now()) };
    }
    function openChest(c, r, expectedId) {
      tickChests();
      const info = chestInfo(c, r);
      if (!info || (expectedId !== undefined && info.id !== expectedId)) return { ok: false, reason: 'none' };
      if (info.have < CHEST_KEYS) return { ok: false, reason: 'keys', have: info.have, need: CHEST_KEYS, tier: info.tier };
      const consumed = Object.entries(s.items).filter(([pos, it]) => it.t === 'chain' && it.k === 'keys' && it.tier === info.tier && isOwned(...pos.split(',').map(Number)))
        .map(([pos, item]) => { const [x, y] = pos.split(',').map(Number); return { c: x, r: y, item, d: Math.abs(x - c) + Math.abs(y - r) }; })
        .sort((a, b) => a.d - b.d).slice(0, CHEST_KEYS);
      const rewards = [];
      CHESTS[info.tier].rewards.forEach((drop) => {
        const count = drop.min + Math.floor(rng() * (drop.max - drop.min + 1));
        const total = drop.tiers.reduce((n, [, w]) => n + w, 0);
        for (let i = 0; i < count; i++) {
          let roll = rng() * total, tier = drop.tiers[drop.tiers.length - 1][0];
          for (const [t, weight] of drop.tiers) { roll -= weight; if (roll < 0) { tier = t; break; } }
          rewards.push({ t: 'chain', k: drop.k, tier });
        }
      });
      const item = getItem(c, r);
      delete s.items[key(c, r)];
      consumed.forEach((it) => delete s.items[key(it.c, it.r)]);
      const result = placeRewards(c, r, rewards);
      emit('chestOpened', { c, r, item, consumed, ...result });
      return { ok: true, ...result };
    }
    // 置けない報酬は泡に保管する。換金・破棄せず、保存してあとから取り出せる。
    function placeRewards(c, r, rewards) {
      const spots = nearestRewardFree(c, r, rewards.length), spawned = [], bubbles = [];
      rewards.forEach((reward, i) => {
        const pos = spots[i];
        if (pos) { const item = putItem(pos[0], pos[1], reward); spawned.push({ c: pos[0], r: pos[1], item }); }
        else {
          const bubble = { id: s.nextId++, c, r, item: reward };
          s.rewardBubbles.push(bubble); bubbles.push(bubble);
        }
      });
      return { spawned, bubbles };
    }
    // 報酬は開けた場所につながる畑へ。遠く離れた開始済みの土地へ飛ばさない。
    function nearestRewardFree(c, r, n) {
      const cells = ownedCells(), own = new Set(cells.map(([x, y]) => key(x, y)));
      if (!cells.length) return [];
      const start = own.has(key(c, r)) ? [c, r] : cells.reduce((a, b) => Math.abs(b[0] - c) + Math.abs(b[1] - r) < Math.abs(a[0] - c) + Math.abs(a[1] - r) ? b : a);
      const queue = [start], seen = new Set([key(...start)]);
      while (queue.length) {
        const [x, y] = queue.pop();
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
          const pos = key(x + dx, y + dy);
          if (own.has(pos) && !seen.has(pos)) { seen.add(pos); queue.push([x + dx, y + dy]); }
        });
      }
      return cells.filter(([x, y]) => seen.has(key(x, y)) && !getItem(x, y))
        .map(([x, y]) => ({ x, y, d: Math.abs(x - c) + Math.abs(y - r) + rng() * 0.5 }))
        .sort((a, b) => a.d - b.d).slice(0, n).map(({ x, y }) => [x, y]);
    }
    function claimRewardBubble(id) {
      const bubble = s.rewardBubbles.find((b) => b.id === id);
      if (!bubble) return { ok: false, reason: 'none' };
      const spot = nearestRewardFree(bubble.c, bubble.r, 1)[0];
      if (!spot) return { ok: false, reason: 'full' };
      const item = putItem(spot[0], spot[1], bubble.item);
      s.jobs.filter((j) => j.rewardBubbleId === id).forEach((j) => { j.c = spot[0]; j.r = spot[1]; delete j.rewardBubbleId; });
      s.rewardBubbles = s.rewardBubbles.filter((b) => b.id !== id);
      emit('rewardClaimed', { c: bubble.c, r: bubble.r, spawned: [{ c: spot[0], r: spot[1], item }] });
      return { ok: true };
    }

    // ---------- 経験値 ----------
    function addXp(x) {
      s.xp += Math.round(x * XP_GAIN);
      while (s.xp >= xpForLevel(s.level)) {
        s.xp -= xpForLevel(s.level);
        s.level += 1;
        const rw = levelUpReward(s.level);
        s.crates += rw.crates;
        s.energy = Math.min(MAX_ENERGY, s.energy + rw.energy);
        const unlocked = Object.keys(CHAINS).filter((k) => CHAINS[k].unlock === s.level && CHAINS[k].type !== 'bonus');
        const recipes = [];
        Object.keys(BUILDINGS).forEach((bk) => BUILDINGS[bk].recipes.forEach((rc) => { if (rc.unlock === s.level) recipes.push({ building: BUILDINGS[bk].name, name: rc.name, id: rc.id }); }));
        const lands = LANDS.filter((l) => l.level === s.level).map((l) => l.id);
        emit('levelup', { level: s.level, reward: rw, unlocked, recipes, lands });
      }
    }

    // ---------- 箱 ----------
    function crateItem() {
      // Lv12 から、ごくまれに ご褒美のカギ・宝箱(出たあと 100 個は出ない。出ないまま続くと、少しずつ出やすくなる)
      if (s.level >= 12) {
        s.sinceKC = (s.sinceKC || 0) + 1;
        if (s.sinceKC > 100) {
          const extra = s.sinceKC - 100, pChest = 0.000099 + extra * 0.000002, pKey = 0.00099 + extra * 0.00002, x = rng();
          if (x < pChest) { s.sinceKC = 0; const y = rng(); return { t: 'chain', k: 'lockbox', tier: y < 0.5 ? 0 : y < 0.8333 ? 1 : 2 }; }
          if (x < pChest + pKey) { s.sinceKC = 0; return { t: 'chain', k: 'keys', tier: rng() < 0.098 ? 1 : 0 }; }
        }
      }
      // ふつうは、解放済みの作物・動物だけ(コインやエネルギーは出ない)
      const kinds = Object.keys(CHAINS).filter((k) => CHAINS[k].type !== 'bonus' && CHAINS[k].unlock <= s.level);
      const k = kinds[Math.floor(rng() * kinds.length)];
      const x = rng();
      return { t: 'chain', k, tier: x < 0.901 ? 0 : x < 0.991 ? 1 : 2 };
    }

    // at = 品物を出すマス(画面の中心にいちばん近い空きマス)。無ければ、空きマスからランダム
    function openCrate(at) {
      if (s.crates <= 0) return { ok: false, reason: 'nocrate' };
      const cells = crateCells();
      if (!cells.length) return { ok: false, reason: 'full' };
      const [c, r] = at && cells.some(([x, y]) => x === at[0] && y === at[1]) ? at : cells[Math.floor(rng() * cells.length)];
      if (s.crates >= MAX_CRATES) s.lastCrateAt = now();   // 満タンから減ったときから、補充の時間を数える
      s.crates -= 1;
      const it = putItem(c, r, crateItem());
      emit('spawn', { c, r, item: Object.assign({}, it), from: 'crate' });
      return { ok: true, c, r };
    }

    // ---------- 合体 ----------
    function sameKind(a, b) { return a && b && a.t === 'chain' && b.t === 'chain' && a.k === b.k && a.tier === b.tier; }
    function mergeable(it) { return !!it && it.t === 'chain' && it.k !== 'toolbox' && it.k !== 'woodbox' && it.tier < CHAINS[it.k].max && (it.k !== 'lockbox' || !it.expiresAt || it.expiresAt > now()); }

    // 上下左右でつながった同じ品物の集合(起点に近い順)
    function findGroup(c, r) {
      const it = getItem(c, r);
      if (!mergeable(it)) return [];
      const seen = new Set([key(c, r)]);
      const q = [[c, r]];
      const order = [];
      while (q.length) {
        const [x, y] = q.shift();
        order.push([x, y]);
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
          const nx = x + dx, ny = y + dy, k = key(nx, ny);
          if (seen.has(k) || !isOwned(nx, ny)) return;
          if (!sameKind(it, getItem(nx, ny)) || !mergeable(getItem(nx, ny))) return;
          seen.add(k); q.push([nx, ny]);
        });
      }
      return order;
    }

    // 合体の本体: used = 使うマス(先頭が起点)。extra = マスにない消費分(重ねて動かしてきた品物)
    function mergeCore(c, r, base, n, used, extra) {
      const newTier = base.tier + 1;
      const consumed = (extra || []).concat(used.map(([x, y]) => ({ c: x, r: y, item: Object.assign({}, getItem(x, y)) })));
      used.forEach(([x, y]) => { delete s.items[key(x, y)]; });

      const created = [];
      const mk = (x, y) => { const it = putItem(x, y, { t: 'chain', k: base.k, tier: newTier }); created.push({ c: x, r: y, item: Object.assign({}, it) }); };
      mk(c, r);
      if (n === 5) mk(used[1][0], used[1][1]);

      let lucky = null;
      if (rng() < LUCKY_RATE) {
        const spot = nearestFree(c, r, 1)[0];
        if (spot) { mk(spot[0], spot[1]); lucky = { c: spot[0], r: spot[1] }; }
      }
      const xp = Math.pow(3, newTier) * (n === 5 ? 2 : 1);   // newTier = 合体で、いまできる段階(1 → 3、2 → 9、3 → 27)
      emit('merge', { anchor: [c, r], n, consumed, created, lucky, xp, newTier, kind: base.k });
      addXp(xp);
      return true;
    }

    // タップで合体: すでに 3 つ以上つながっている品物を、まとめて合体させる
    function tryMerge(c, r) {
      const group = findGroup(c, r);
      if (group.length < 3) return false;
      const n = group.length >= 5 ? 5 : 3;
      const base = Object.assign({}, getItem(c, r));
      return mergeCore(c, r, base, n, group.slice(0, n), null);
    }

    // 重ねて合体: 動かす品物(from)を、同じ品物(to)の上に落とす。
    // 落とし先につながっている同じ品物に、動かす 1 個を足して 3 つ以上になるときだけ合体する。
    // 戻り値: 落とし先につながっている品物のマス(動かす品物は含まない)。合体できなければ null
    function stackGroup(from, to) {
      const it = getItem(from[0], from[1]), target = getItem(to[0], to[1]);
      if (!mergeable(it) || !sameKind(it, target)) return null;
      const k = key(from[0], from[1]);
      delete s.items[k];                 // 動かす品物は、元の場所に無いものとして数える
      const g = findGroup(to[0], to[1]);
      s.items[k] = it;
      return g.length + 1 >= 3 ? g : null;
    }
    function stackMerge(from, to) {
      const g = stackGroup(from, to);
      if (!g) return false;
      const it = getItem(from[0], from[1]), base = Object.assign({}, getItem(to[0], to[1]));
      const n = g.length + 1 >= 5 ? 5 : 3;
      const extra = [{ c: from[0], r: from[1], item: Object.assign({}, it) }];
      delete s.items[key(from[0], from[1])];
      return mergeCore(to[0], to[1], base, n, g.slice(0, n - 1), extra);
    }

    // ---------- 操作 ----------
    function collectBonus(c, r) {
      const it = getItem(c, r);
      const ch = CHAINS[it.k];
      const v = ch.value[it.tier];
      let gained = v;
      if (it.k === 'energy') {
        s.energy += v;   // 自然回復の上限は50。宝箱の報酬は上限を超えて受け取れる。
        if (s.energy >= MAX_ENERGY) s.lastEnergyAt = now();
      } else if (it.k === 'gem') s.gems += v;
      else if (it.k === 'woodbox') s.crates += v;
      else s.coins += v;
      delete s.items[key(c, r)];
      emit('collect', { c, r, item: it, kind: it.k, value: gained });
      return { ok: true };
    }

    // 収穫。動物は、収穫すると消える。作物は、収穫できる(4)→ 収穫あと(5)→ 枯れ(6)と変わり、枯れをタップすると片づく
    // 収穫あと(5 段階め)の、のこりの待ち時間(ミリ秒)。はじめの収穫あとは readyAt がない古い保存データも、すぐ収穫できる
    const regrowLeft = (it) => Math.max(0, (it.readyAt || 0) - now());
    const skipCost = (it) => Math.ceil(regrowLeft(it) / 60000);
    function harvest(c, r) {
      const it = getItem(c, r), ch = CHAINS[it.k];
      const stage = it.tier - ch.max;   // 0 = 収穫できる、1 = 収穫あと(1 時間は回復中)、2 = 枯れ
      if (stage >= 2) return collectWithered(c, r);
      if (stage === 1) {
        const left = regrowLeft(it);
        if (left > 0) return { ok: false, reason: 'regrow', left, cost: skipCost(it) };
      }
      const n = HARVEST_BASE + HARVEST_PER_STAR * starsOf(it.k);   // 星のレベルが上がるほど、食材が増える
      const spots = nearestFree(c, r, n);
      if (!spots.length) return { ok: false, reason: 'full' };
      const before = Object.assign({}, it);
      it.tier += 1;
      if (stage === 0) it.readyAt = now() + REGROW_MS; else delete it.readyAt;
      const spawned = spots.map(([x, y]) => {
        const g = putItem(x, y, { t: 'ing', k: ch.yields, tier: 0 });
        return { c: x, r: y, item: Object.assign({}, g) };
      });
      emit('harvest', { c, r, item: before, spawned, remains: true });
      addXp(6);
      if (stage === 0) maybeDropCard(it.k, c, r);
      return { ok: true };
    }
    // 枯れたものをタップ: 作物は 1 段階めの苗が 2 つ、動物は銅貨が 1 枚出る
    function collectWithered(c, r) {
      const it = getItem(c, r), ch = CHAINS[it.k];
      const give = ch.type === 'crop' ? [{ k: it.k, tier: 0 }, { k: it.k, tier: 0 }] : [{ k: 'coin', tier: 0 }];
      delete s.items[key(c, r)];
      const spots = nearestFree(c, r, give.length);
      if (spots.length < give.length) { s.items[key(c, r)] = it; return { ok: false, reason: 'full' }; }
      const spawned = give.map((g, i) => {
        const x = putItem(spots[i][0], spots[i][1], { t: 'chain', k: g.k, tier: g.tier });
        return { c: spots[i][0], r: spots[i][1], item: Object.assign({}, x) };
      });
      emit('witherDone', { c, r, item: Object.assign({}, it), spawned });
      return { ok: true };
    }
    // ジェムで待ち時間を飛ばす
    function skipRegrow(c, r) {
      const it = getItem(c, r);
      if (!it || it.t !== 'chain' || it.tier !== CHAINS[it.k].max + 1 || regrowLeft(it) <= 0) return { ok: false, reason: 'none' };
      const cost = skipCost(it);
      if (s.gems < cost) return { ok: false, reason: 'nogems', cost };
      s.gems -= cost; delete it.readyAt;
      emit('regrowSkipped', { c, r, cost });
      return { ok: true, cost };
    }

    // ---------- アップグレードカード ----------
    const cardOf = (k) => s.cards[k] || (s.cards[k] = { c1: 0, c2: 0, c3: 0, lv: 0, spent: 0 });
    const starsOf = (k) => (s.cards && s.cards[k] ? s.cards[k].lv : 0);
    const cardUnits = (cd) => cd.c1 + 3 * cd.c2 + 9 * cd.c3 + cd.spent;
    function maybeDropCard(k, c, r) {
      const cd = cardOf(k);
      if (cardUnits(cd) >= CARD_CAP || rng() >= CARD_DROP_RATE) return false;
      cd.c1 += 1;
      emit('card', { k, star: 1, c, r });
      return true;
    }
    // カードを使う: 星 star のカードで、星のレベルが star になる(1 から 3 へ、とばしてもよい)
    function useCard(k, star) {
      const cd = cardOf(k);
      if (!(star >= 1 && star <= 3) || cd['c' + star] <= 0 || star <= cd.lv) return { ok: false, reason: 'cant' };
      cd['c' + star] -= 1; cd.lv = star; cd.spent += CARD_UNITS[star];
      emit('cardUsed', { k, star });
      return { ok: true };
    }
    // カードの合体: 星 star のカード 3 枚が、星 star+1 のカード 1 枚になる
    function mergeCards(k, star) {
      const cd = cardOf(k);
      if (!(star === 1 || star === 2) || cd['c' + star] < 3) return { ok: false, reason: 'cant' };
      cd['c' + star] -= 3; cd['c' + (star + 1)] += 1;
      emit('cardMerged', { k, star: star + 1 });
      return { ok: true };
    }

    // タップ: 合体できるなら合体、できなければ収穫/回収/撤去
    function tap(c, r) {
      const it = getItem(c, r);
      if (!it || !isOwned(c, r)) return { ok: false, reason: 'none' };
      if (it.k === 'lockbox') return { ok: false, reason: 'chest', info: chestInfo(c, r) };
      if (it.k === 'toolbox') return it.pend ? claimClear(c, r) : startClear(c, r);
      if (it.t === 'obs') return it.pend ? claimClear(c, r) : startClear(c, r);
      if (mergeable(it) && tryMerge(c, r)) return { ok: true, merged: true };
      if (it.k === 'keys') return { ok: false, reason: 'key', tier: it.tier };
      if (it.t === 'chain') {
        const ch = CHAINS[it.k];
        if (ch.type === 'bonus') return collectBonus(c, r);
        if (it.tier >= ch.max) return harvest(c, r);
        return { ok: false, reason: 'single' };
      }
      if (it.t === 'ing') return collectIngredient(c, r);
      return { ok: false, reason: 'ingredient' };
    }

    // ドラッグ移動。空きなら移動、別の品物なら入れ替え、建物なら食材を渡す
    function move(from, to) {
      const [fc, fr] = from;
      const it = getItem(fc, fr);
      if (!it || it.t === 'obs' || it.k === 'woodbox' || !isOwned(fc, fr)) return { ok: false, reason: 'cantmove' };
      if (fc === to[0] && fr === to[1]) return { ok: true, same: true };

      const bk = buildingAt(to[0], to[1]);
      if (bk) return feedBuilding(bk, fc, fr);

      const [tc, tr] = to;
      if (!inGrid(tc, tr) || !isOwned(tc, tr)) return { ok: false, reason: 'invalid' };
      const other = getItem(tc, tr);
      if (it.k === 'toolbox' && (it.pend || s.jobs.some((j) => j.c === fc && j.r === fr))) return { ok: false, reason: 'busy' };
      if (other && other.k === 'toolbox' && (other.pend || s.jobs.some((j) => j.c === tc && j.r === tr))) return { ok: false, reason: 'busy' };
      if (other && (other.t === 'obs' || other.k === 'woodbox')) return { ok: false, reason: 'blocked' };

      // 同じ品物の上に重ねたら合体(横に置いただけでは合体しない)
      if (other && mergeable(it) && sameKind(it, other)) {
        if (stackMerge([fc, fr], [tc, tr])) return { ok: true, merged: true };
        return { ok: false, reason: 'needmore' };
      }

      delete s.items[key(fc, fr)];
      if (other) s.items[key(fc, fr)] = other;
      s.items[key(tc, tr)] = it;
      emit('move', { from: [fc, fr], to: [tc, tr], swapped: !!other });
      return { ok: true, merged: false };
    }

    // ---------- 障害物の撤去 ----------
    // 木・岩・ガラクタは、3 / 5 / 10 ステップに分けて片づける(1 ステップごとに、エネルギーと時間がかかり、素材が出る)
    // 作業者の人数 = はじめの 1 人 + 借りている人数
    const workerCap = () => 1 + s.rentals.filter((u) => u > now()).length;
    function rentWorker() {
      if (s.gems < WORKER_RENT_GEMS) return { ok: false, reason: 'nogems', cost: WORKER_RENT_GEMS };
      s.gems -= WORKER_RENT_GEMS;
      s.rentals.push(now() + WORKER_RENT_MS);
      emit('workerRented', { cost: WORKER_RENT_GEMS, workers: workerCap() });
      return { ok: true, cost: WORKER_RENT_GEMS };
    }
    const stepsOf = (it) => OBS_STEPS[it.k === 'toolbox' ? it.tier + 1 : OBSTACLES[it.k].tier];
    function startClear(c, r) {
      const it = getItem(c, r);
      const step = it.step || 0, st = OBS_STAGES[step];
      if (s.jobs.some((j) => j.c === c && j.r === r)) return { ok: false, reason: 'busy' };   // この障害物は、作業中
      if (s.jobs.length >= workerCap()) return { ok: false, reason: 'busy' };               // 作業者が、みんな作業中
      if (s.energy < st.energy) return { ok: false, reason: 'noenergy', need: st.energy };
      if (s.energy >= MAX_ENERGY) s.lastEnergyAt = now();   // 満タンから減ったときから、回復の時間を数える
      s.energy -= st.energy;
      s.jobs.push({ c, r, startedAt: now(), endsAt: now() + st.secs * 1000, step });
      emit('clearStart', { c, r, secs: st.secs, energy: st.energy, step: step + 1, of: stepsOf(it) });
      return { ok: true };
    }
    // 作業者の作業が終わったら、障害物の上に、素材(木・レンガなど)の吹き出しが出る。タップすると、素材が出る(作物の収穫と同じ)
    function finishClear(w) {
      s.jobs = s.jobs.filter((j) => j !== w);
      const bubble = w.rewardBubbleId && s.rewardBubbles.find((b) => b.id === w.rewardBubbleId);
      const it = bubble ? bubble.item : getItem(w.c, w.r);
      if (!it || (it.t !== 'obs' && it.k !== 'toolbox')) return;
      it.pend = w.step + 1;   // 終わったステップの数。素材は、まだ出ない
      emit('clearDone', { c: w.c, r: w.r, item: Object.assign({}, it), step: it.pend, of: stepsOf(it) });
    }
    function claimClear(c, r) {
      const it = getItem(c, r);
      const ob = it.k === 'toolbox' ? { res: 'tools', xp: [4, 9, 27][it.tier] } : OBSTACLES[it.k], step = it.pend - 1, last = it.pend >= stepsOf(it), w = { c, r };
      delete it.pend;
      // このステップの素材
      const drops = [];
      let coins = 0;
      const want = [];
      OBS_STAGES[step].drop.forEach(([tier, n]) => { for (let i = 0; i < n; i++) want.push(Math.min(tier, CHAINS[ob.res].count - 1)); });
      const spots = it.k === 'toolbox' ? nearestRewardFree(w.c, w.r, want.length) : nearestFree(w.c, w.r, want.length);
      want.forEach((tier, i) => {
        if (spots[i]) { const g = putItem(spots[i][0], spots[i][1], { t: 'chain', k: ob.res, tier }); drops.push({ c: spots[i][0], r: spots[i][1], item: Object.assign({}, g) }); }
        else if (it.k === 'toolbox') s.rewardBubbles.push({ id: s.nextId++, c, r, item: { t: 'chain', k: 'tools', tier } });
        else coins += CHAINS[ob.res].value[tier];   // 木・岩の既存動作
      });
      s.coins += coins;
      if (last) {
        delete s.items[key(w.c, w.r)];
        emit('cleared', { c: w.c, r: w.r, item: it, coins, drops });
        addXp(ob.xp);
      } else {
        it.step = step + 1;
        emit('stageDone', { c: w.c, r: w.r, item: Object.assign({}, it), coins, drops, step: step + 1, of: stepsOf(it) });
      }
      return { ok: true, claimed: true };
    }

    // ---------- 建物 ----------
    function buildingAt(c, r) {
      for (const land of LANDS) {
        if (!land.building || !s.lands[land.id]) continue;
        if (inRect(rectOf(land.building.key), c, r)) return land.building.key;
      }
      return null;
    }
    // 建物を動かせるか(置く場所が、自分の今の敷地か、持っている土地の空きマスか)
    function canMoveBuilding(bk, c, r) {
      const land = BLAND[bk];
      if (!land || !s.lands[land.id]) return { ok: false, reason: 'locked' };
      const rc = rectOf(bk);
      for (const [x, y] of rectCells([c, r, rc[2], rc[3]])) {
        if (coveredBy(x, y) === bk) continue;
        if (!isOwned(x, y)) return { ok: false, reason: 'invalid' };
        const it = getItem(x, y);
        if (it && it.t === 'obs') return { ok: false, reason: 'blocked' };
        if (it && it.k === 'toolbox' && (it.pend || s.jobs.some((j) => j.c === x && j.r === y))) return { ok: false, reason: 'blocked' };
      }
      return { ok: true };
    }
    // 建物を動かす。置く場所にある品物は、近くの空きマスへ寄せる(寄せ先がなければ動かさない)
    function moveBuilding(bk, c, r) {
      const cur = rectOf(bk);
      if (cur[0] === c && cur[1] === r) return { ok: true, same: true };
      const chk = canMoveBuilding(bk, c, r);
      if (!chk.ok) return chk;
      const prev = s.bpos[bk] ? s.bpos[bk].slice() : null;
      s.bpos[bk] = [c, r];
      const moved = [];
      const undo = () => { moved.reverse().forEach((m) => { delete s.items[key(m.to[0], m.to[1])]; s.items[key(m.from[0], m.from[1])] = m.it; }); if (prev) s.bpos[bk] = prev; else delete s.bpos[bk]; };
      for (const [x, y] of rectCells([c, r, cur[2], cur[3]])) {
        const it = s.items[key(x, y)];
        if (!it) continue;
        const spot = nearestFree(x, y, 1)[0];
        if (!spot) { undo(); return { ok: false, reason: 'full' }; }
        delete s.items[key(x, y)]; s.items[key(spot[0], spot[1])] = it;
        moved.push({ from: [x, y], to: spot, it });
      }
      emit('buildingMoved', { key: bk, from: cur, to: [c, r, cur[2], cur[3]], moves: moved.map((m) => ({ from: m.from, to: m.to, item: Object.assign({}, m.it) })) });
      return { ok: true };
    }
    function needsOf(bk) {
      const set = {};
      BUILDINGS[bk].recipes.forEach((rc) => Object.keys(rc.needs).forEach((n) => { set[n] = true; }));
      return set;
    }
    // 食材は、建物ごとではなく、ひとつの持ち物(アイテムリスト)に入る。「素材」のタブに出る
    const addInv = (k) => { s.inv[k] = (s.inv[k] || 0) + 1; };
    const useOf = (k) => Object.keys(BUILDINGS).find((bk) => needsOf(bk)[k]) || Object.keys(BUILDINGS)[0];
    // 建物にドラッグしても、持ち物に入る(その建物で使う食材だけ)
    function feedBuilding(bk, c, r) {
      if (!BLAND[bk] || !s.lands[BLAND[bk].id] || s.level < BLAND[bk].level) return { ok: false, reason: 'locked' };
      const it = getItem(c, r);
      if (!it || !isOwned(c, r)) return { ok: false, reason: 'none' };
      if (!isRepaired(bk)) {   // 壊れている建物には、修理の材料だけ渡せる
        const rq = it.t === 'chain' ? repairNeeds(bk).find((x) => x.k === it.k && x.tier === it.tier && x.have < x.n) : null;
        if (!rq) return { ok: false, reason: 'notneeded', broken: true };
        const b = s.buildings[bk];
        b.paid[rq.i] = rq.have + 1;
        delete s.items[key(c, r)];
        emit('feed', { building: bk, c, r, item: it, repair: true });
        if (repairNeeds(bk).every((x) => x.have >= x.n)) { b.repaired = true; emit('repaired', { building: bk }); }
        return { ok: true, fed: true, repaired: b.repaired };
      }
      if (it.t !== 'ing') return { ok: false, reason: 'notingredient' };
      if (!needsOf(bk)[it.k]) return { ok: false, reason: 'notneeded' };
      addInv(it.k);
      delete s.items[key(c, r)];
      emit('feed', { building: bk, c, r, item: it });
      return { ok: true, fed: true };
    }
    // 盤面の食材をタップすると、回収される(持ち物に入る)
    // 盤面の同じ食材を、いっぺんに回収する(タップした食材に近い順)
    function collectIngredient(c, r) {
      const it = getItem(c, r), same = [];
      Object.keys(s.items).forEach((k) => {
        const o = s.items[k];
        if (o.t !== 'ing' || o.k !== it.k) return;
        const [x, y] = k.split(',').map(Number);
        if (isOwned(x, y)) same.push({ x, y, o, d: Math.abs(x - c) + Math.abs(y - r) });
      });
      same.sort((a, b) => a.d - b.d).forEach(({ x, y, o }) => {
        addInv(o.k);
        delete s.items[key(x, y)];
        emit('feed', { building: useOf(o.k), c: x, r: y, item: o });
      });
      return { ok: true, collected: same.length };
    }
    // ショップの「いまの注文」(ショップ 1 つにつき 1 つ)。作っている間は、その注文。
    // そうでなければ、いま持っている食材で作れるレシピのうち、単価(できる品物の値段 = 報酬のコインの合計)がいちばん高いもの。
    // 同じ値段なら、解放がはやいほう。作れるものがなければ、いちばんそろっているレシピ
    function orderOf(bk) {
      const def = BUILDINGS[bk], b = s.buildings[bk];
      if (b.job) return def.recipes.find((r) => r.id === b.job.id);
      const open = def.recipes.filter((r) => s.level >= (r.unlock || 1));
      if (!open.length) return null;
      const can = open.filter((rc) => Object.keys(rc.needs).every((n) => (s.inv[n] || 0) >= rc.needs[n]));
      if (can.length) return can.reduce((a, rc) => (recipeReward(rc) > recipeReward(a) ? rc : a), can[0]);
      const score = (rc) => Math.min(...Object.keys(rc.needs).map((n) => Math.min(1, (s.inv[n] || 0) / rc.needs[n])));
      let best = open[0], bs = score(best);
      open.forEach((rc) => { const sc = score(rc); if (sc > bs) { best = rc; bs = sc; } });
      return best;
    }
    function startRecipe(bk, id) {
      if (!BLAND[bk] || !s.lands[BLAND[bk].id] || s.level < BLAND[bk].level) return { ok: false, reason: 'locked' };
      const b = s.buildings[bk];
      const rec = BUILDINGS[bk].recipes.find((x) => x.id === id);
      if (!rec || b.job) return { ok: false, reason: 'busy' };
      if (!isRepaired(bk)) return { ok: false, reason: 'broken' };
      if (s.level < (rec.unlock || 1)) return { ok: false, reason: 'level', need: rec.unlock };
      if (orderOf(bk) !== rec) return { ok: false, reason: 'notorder' };   // ショップのいまの注文だけ作れる
      for (const n of Object.keys(rec.needs)) if ((s.inv[n] || 0) < rec.needs[n]) return { ok: false, reason: 'lack' };
      Object.keys(rec.needs).forEach((n) => { s.inv[n] -= rec.needs[n]; });
      b.job = { id, startedAt: now(), endsAt: now() + rec.secs * 1000 };
      emit('recipeStart', { building: bk, recipe: rec });
      return { ok: true };
    }

    // 作っている間の「無料」: 残りが FREE_FINISH_MS 以下なら、すぐできあがる
    function finishRecipeFree(bk) {
      const b = s.buildings[bk];
      if (!b.job) return { ok: false, reason: 'none' };
      if (b.job.endsAt - now() > FREE_FINISH_MS) return { ok: false, reason: 'long' };
      b.job.endsAt = now();
      tick();
      return { ok: true };
    }

    // ---------- 土地 ----------
    function landState(id) {
      const land = LANDS.find((l) => l.id === id);
      if (s.lands[id]) return 'owned';
      if (s.level < land.level) return 'locked';
      return s.coins >= land.cost ? 'buyable' : 'poor';
    }
    function buyLand(id) {
      const land = LANDS.find((l) => l.id === id);
      if (!land || s.lands[id]) return { ok: false, reason: 'owned' };
      if (s.level < land.level) return { ok: false, reason: 'level', need: land.level };
      if (s.coins < land.cost) return { ok: false, reason: 'coins', need: land.cost };
      s.coins -= land.cost;
      s.lands[id] = true;
      LANDS.forEach((l) => { if (l.parent === id) s.lands[l.id] = true; });   // 同じ土地にある、2 つめ以降の建物
      tickChests();
      emit('landBought', { id });
      addXp(10 + land.id * 2);
      return { ok: true };
    }

    // ---------- 保存 ----------
    function serialize() { return JSON.stringify(s); }
    function load(json) {
      try {
        const d = JSON.parse(json);
        if (!d || d.v !== SAVE_VERSION) return false;
        s = d;
        if (!s.bpos) s.bpos = {};
        if (s.sinceKC === undefined) s.sinceKC = 0;
        if (!s.cards) s.cards = {};
        if (!s.rewardBubbles) s.rewardBubbles = [];
        if (s.gems === undefined) s.gems = GEM_START;
        if (!s.jobs) { s.jobs = s.worker ? [s.worker] : []; delete s.worker; }   // 古い保存データ: 作業者が 1 人だけだった
        if (!s.rentals) s.rentals = [];
        if (!s.inv) {   // 古い保存データ: 建物ごとの食材を、ひとつの持ち物にまとめる
          s.inv = {};
          Object.keys(s.buildings).forEach((k) => { const st = s.buildings[k].stock || {}; Object.keys(st).forEach((n) => { s.inv[n] = (s.inv[n] || 0) + st[n]; }); delete s.buildings[k].stock; });
        }
        Object.keys(BUILDINGS).forEach((k) => { if (!s.buildings[k]) s.buildings[k] = { job: null, repaired: !BUILDINGS[k].repair, paid: {} }; else { if (s.buildings[k].repaired === undefined) s.buildings[k].repaired = true; if (!s.buildings[k].paid) s.buildings[k].paid = {}; } });
        migrateShopClouds();
        tick();
        return true;
      } catch (e) { return false; }
    }

    // 土地の分割・雲の変更を引き継ぐ。購入済み・作業中・回収済みの進行を保護する。
    function migrateShopClouds() {
      if ((s.layoutRevision || 0) >= LAYOUT_REVISION) return;
      const oldRevision = s.layoutRevision || 0;
      // 旧版の大きな区画を購入済みなら、その区画に属する小区画も購入済みとして引き継ぐ。
      if (oldRevision < 1) FORMERLY_OPEN_LANDS.forEach((id) => {
        if (!s.lands[id]) return;
        const split = SPLIT_LANDS.find((l) => l.oldId === id), land = LANDS.find((l) => l.id === id);
        const footprint = new Set(split ? split.cells : land.coverCells.map(([c, r]) => key(c, r)));
        const used = Object.keys(s.items).some((k) => footprint.has(k))
          || s.rewardBubbles.some((b) => footprint.has(key(b.c, b.r)))
          || Object.keys(s.bpos).some((bk) => BLAND[bk] && rectCells(rectOf(bk)).some(([c, r]) => footprint.has(key(c, r))));
        if (!used) delete s.lands[id];
      });
      const previousOwnership = { ...s.lands };
      SPLIT_LANDS.forEach((split) => { if (previousOwnership[split.oldId]) split.ids.forEach((id) => s.lands[id] = true); });
      // 雲の下の未開放区画にだけ新しい配置を補う。すでに片づけた土地へ障害物を戻さない。
      if (oldRevision < 2) LANDS.forEach((land) => {
        if (s.lands[land.id]) return;
        Object.entries(land.items || {}).forEach(([pos, definition]) => {
          if (s.items[pos]) return;
          const [c, r] = pos.split(',').map(Number); putItem(c, r, { ...definition, tier: definition.tier || 0 });
        });
      });
      FORMERLY_OPEN_LANDS.forEach((id) => {
        const land = LANDS.find((l) => l.id === id);
        if (!land || !s.lands[id]) return;
        const footprint = new Set(land.coverCells.map(([c, r]) => key(c, r)));
        {
          // 新しい店の敷地に保存済みの品物・移動済みの建物があれば、店を空いている場所へ寄せる。
          const bk = land.building.key, rc = rectOf(bk);
          const overlaps = rectCells(rc).some(([c, r]) => s.items[key(c, r)] || Object.keys(s.bpos).some((other) => other !== bk && BLAND[other] && inRect(rectOf(other), c, r)));
          if (overlaps) {
            const spot = land.cells.find(([c, r]) => rectCells([c, r, rc[2], rc[3]]).every(([x, y]) => isFree(x, y)));
            if (spot) s.bpos[bk] = spot.slice();
            else {
              const packedSpot = land.coverCells.find(([c, r]) => rectCells([c, r, rc[2], rc[3]]).every(([x, y]) => footprint.has(key(x, y))
                && !Object.keys(BLAND).some((other) => other !== bk && inRect(rectOf(other), x, y))));
              if (packedSpot) s.bpos[bk] = packedSpot.slice();
              // 満杯なら敷地の品物を保存できる泡へ。作業中の道具は近くへ移し、仕事も追従させる。
              rectCells(rectOf(bk)).forEach(([c, r]) => {
                const item = s.items[key(c, r)]; if (!item) return;
                const pos = nearestFree(c, r, 1)[0];
                delete s.items[key(c, r)];
                if (pos) {
                  s.items[key(...pos)] = item;
                  s.jobs.filter((j) => j.c === c && j.r === r).forEach((j) => { j.c = pos[0]; j.r = pos[1]; });
                } else {
                  const bubble = { id: s.nextId++, c, r, item };
                  s.rewardBubbles.push(bubble);
                  s.jobs.filter((j) => j.c === c && j.r === r).forEach((j) => j.rewardBubbleId = bubble.id);
                }
              });
            }
          }
        }
      });
      s.layoutRevision = LAYOUT_REVISION;
    }

    return {
      get state() { return s; },
      newState, load, serialize, tick, drain,
      getItem, isOwned, isFree, landOf, freeCells, ownedCells, nearestFree,
      findGroup, stackGroup, mergeable, openCrate, cardOf, starsOf, useCard, mergeCards, rectOf, landCells, canMoveBuilding, moveBuilding, tap, move, buyLand, landState,
      startRecipe, orderOf, hasShop, isRepaired, repairNeeds, workerCap, rentWorker, crateCells, finishRecipeFree, buildingAt, feedBuilding, startClear, regrowLeft, skipRegrow, chestInfo, openChest, claimRewardBubble,
      emitRaw: emit,
      consts: { ENERGY_REGEN_MS, CRATE_REGEN_MS, CRATE_REGEN_AMOUNT, MAX_CRATES, CARD_CAP, FREE_FINISH_MS, HARVEST_BASE, HARVEST_PER_STAR, WORKER_RENT_GEMS, WORKER_RENT_MS },
    };
  }

  const api = { createEngine };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FMV = Object.assign(root.FMV || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
