// ゲームデータ定義(DOM に依存しない)。ブラウザでは window.FMV、Node では module.exports に載る。
(function (root) {
  // アイソメ(斜め見下ろし)。タイル座標 (c, r): c は右下へ、r は左下へ進む。
  const TILE_W = 132;
  const TILE_H = 66;
  const MAX_TIER = 10;   // 品物の段階の上限(系統ごとの上限は CHAINS[k].max)
  const MAX_ENERGY = 50;

  // 品物の系統。
  //  crop   : 育つ段階 1〜4(tier 0〜3)。4 の「収穫できる」をタップで食材。収穫あと(5)→ 枯れ(6)→ タップで片づける
  //  animal : 合体で 1〜6(tier 0〜5)に育つ。最後まで育ててタップすると食材が出る
  //  bonus  : 合体で育つコイン・エネルギー・素材。タップで回収する(value = 段階ごとの値)
  const CROP = (name, unlock, yields) => ({ type: 'crop', name, unlock, yields, max: 3, count: 6, tiers: ['タネ', '若葉', 'つぼみ', '収穫できる', '収穫あと', '枯れ'] });
  const ANIMAL = (name, unlock, yields) => ({ type: 'animal', name, unlock, yields, max: 3, count: 6, tiers: ['子', '若', '成', '食材を産める', '収穫あと', '年老い'] });
  const BONUS = (name, unlock, value, weight, extra) => Object.assign({ type: 'bonus', name, unlock, value, weight, max: value.length - 1, count: value.length, minTier: 0 }, extra);
  const CHAINS = {
    wheat: CROP('小麦', 1, 'wheat'),
    chicken: ANIMAL('ニワトリ', 3, 'egg'),
    cow: ANIMAL('ウシ', 4, 'milk'),
    sugarcane: CROP('サトウキビ', 7, 'sugarcane'),
    carrot: CROP('ニンジン', 9, 'carrot'),
    goat: ANIMAL('ヤギ', 11, 'goatmilk'),
    edamame: CROP('枝豆', 14, 'edamame'),
    pig: ANIMAL('ブタ', 17, 'bacon'),
    sunflower: CROP('ひまわり', 21, 'sunflower'),
    corn: CROP('トウモロコシ', 26, 'corn'),
    sheep: ANIMAL('ヒツジ', 30, 'wool'),
    coffee: CROP('コーヒー豆', 37, 'coffee'),
    deer: ANIMAL('シカ', 43, 'hide'),
    tomato: CROP('トマト', 50, 'tomato'),
    coin: BONUS('コイン', 1, Array.from({ length: 11 }, (_, t) => Math.pow(3, t)), 4),
    energy: BONUS('エネルギー', 1, [2, 6, 20, 60], 3),
    brick: BONUS('レンガ', 2, [2, 5, 12, 30, 60, 120, 250, 500, 1000, 2000], 1.2),
    logs: BONUS('丸太', 2, [2, 5, 12, 28, 55, 110, 160, 220, 450, 900], 1.2),   // 10 段階(7 番めの 160 は、私が決めた値)
    gem: BONUS('宝石', 3, [3, 8, 20, 50, 120, 300], 0.8),
    woodbox: BONUS('箱', 3, [20, 60], 0.6, { use: 'crate' }),
    tools: BONUS('工具', 4, [3, 8, 18, 40, 80, 160, 320, 640, 1200, 2500], 0.8),
    toolbox: BONUS('工具箱', 5, [30, 120, 500], 0.5, { use: 'toolbox' }),
    keys: BONUS('カギ', 6, [10, 50, 200], 0.5, { use: 'key' }),
    lockbox: BONUS('宝箱', 6, [20, 80, 300], 0.5, { use: 'chest' }),
  };

  // 宝箱: 同色のカギ2個、出現から72時間。温室・ガゼボはユーザー指定で除外。
  // 中身の数と段階の重みは試作用の暫定バランス。本家の確定したドロップ表ではない。
  // min/max = 個数の範囲、tiers = [0始まりの段階, 抽選の重み]。
  const CHEST_LIFETIME_MS = 72 * 3600 * 1000;
  const CHEST_KEYS = 2;
  const CHESTS = [
    { name: '銅の宝箱', color: '#cd7138', rewards: [
      { k: 'gem', min: 3, max: 4, tiers: [[0, 65], [1, 35]] },
      { k: 'energy', min: 2, max: 3, tiers: [[0, 80], [1, 20]] },
      { k: 'toolbox', min: 1, max: 2, tiers: [[0, 85], [1, 15]] },
    ] },
    { name: '銀の宝箱', color: '#8385b5', rewards: [
      { k: 'gem', min: 3, max: 4, tiers: [[1, 70], [2, 30]] },
      { k: 'energy', min: 3, max: 4, tiers: [[1, 75], [2, 25]] },
      { k: 'toolbox', min: 2, max: 2, tiers: [[1, 85], [2, 15]] },
    ] },
    { name: '金の宝箱', color: '#e5b620', rewards: [
      { k: 'gem', min: 5, max: 6, tiers: [[2, 65], [3, 35]] },
      { k: 'energy', min: 4, max: 5, tiers: [[2, 75], [3, 25]] },
      { k: 'toolbox', min: 2, max: 2, tiers: [[2, 100]] },
    ] },
  ];

  // 食材(合体しない)
  const INGREDIENTS = {
    wheat: { name: '小麦' },
    egg: { name: 'タマゴ' },
    milk: { name: 'ミルク' },
    carrot: { name: 'ニンジン' },
    goatmilk: { name: 'ヤギミルク' },
    corn: { name: 'トウモロコシ' },
    tomato: { name: 'トマト' },
    sunflower: { name: 'ひまわり' },
    edamame: { name: '枝豆' },
    sugarcane: { name: 'サトウキビ' },
    coffee: { name: 'コーヒー豆' },
    bacon: { name: 'ベーコン' },
    wool: { name: '羊毛' },
    hide: { name: '毛皮' },
  };

  // 障害物(本家と同じ): 大きさ(tier)によって、片づけが 3 / 5 / 10 ステップ。ステップごとに、エネルギーと時間がかかり、素材が出る。
  //   res = 出る素材の系統、tier = 1(3 ステップ)/ 2(5 ステップ)/ 3(10 ステップ)
  const OBSTACLES = {
    tree_s: { name: '小さな枯れ木', sprite: 'obs_tree_s', tier: 1, res: 'logs', xp: 4 },
    tree_m: { name: '枯れ木', sprite: 'obs_tree_m', tier: 2, res: 'logs', xp: 9 },
    tree_l: { name: '大きな枯れ木', sprite: 'obs_tree_l', tier: 3, res: 'logs', xp: 27 },
    rock_s: { name: '小さな岩', sprite: 'obs_rock_s', tier: 1, res: 'brick', xp: 4 },
    rock_m: { name: '岩', sprite: 'obs_rock_m', tier: 2, res: 'brick', xp: 9 },
    rock_l: { name: '大きな岩', sprite: 'obs_rock_l', tier: 3, res: 'brick', xp: 27 },
    junk_a: { name: 'ガラクタ', sprite: 'obs_junk_a', tier: 1, res: 'tools', xp: 4 },
    junk_b: { name: 'タイヤ', sprite: 'obs_junk_b', tier: 1, res: 'tools', xp: 4 },
    junk_c: { name: '壊れた機械', sprite: 'obs_junk_c', tier: 2, res: 'tools', xp: 9 },
    junk_d: { name: '壊れた柵', sprite: 'obs_junk_d', tier: 2, res: 'tools', xp: 9 },
    junk_e: { name: '壊れた荷車', sprite: 'obs_junk_e', tier: 3, res: 'tools', xp: 27 },
    crates: { name: '古い木箱', sprite: 'obs_crates', tier: 2, res: 'woodbox', xp: 9 },
    gold: { name: '金の延べ棒', sprite: 'obs_gold', tier: 1, res: 'coin', xp: 4 },
  };
  const OBS_STEPS = { 1: 3, 2: 5, 3: 10 };
  // 1 ステップごと: エネルギー、秒、出る素材 [[素材の段階, 個数], …](本家の Tools / Energy のページの表)
  const OBS_STAGES = [
    { energy: 5, secs: 30, drop: [[0, 2]] },
    { energy: 10, secs: 60, drop: [[0, 4]] },
    { energy: 15, secs: 180, drop: [[0, 3], [1, 1]] },
    { energy: 20, secs: 300, drop: [[0, 2], [1, 2]] },
    { energy: 25, secs: 500, drop: [[0, 1], [1, 3]] },
    { energy: 30, secs: 900, drop: [[1, 4]] },
    { energy: 35, secs: 1800, drop: [[0, 2], [1, 1], [2, 1]] },
    { energy: 40, secs: 3000, drop: [[1, 2], [2, 1]] },
    { energy: 45, secs: 4800, drop: [[1, 3], [2, 1]] },
    { energy: 50, secs: 7200, drop: [[0, 2], [1, 3], [2, 1]] },
  ];

  // レシピ建物。どのお店がどの品物を作るかは、ユーザーが選別ページの「配置ボード」で振り分けたとおり。
  // 材料・時間・報酬・解放レベルは、本家の Recipes(wiki、v1.76.0-9)。作り終えると、reward = [コインの段階, 個数] のコインのアイテムが出る
  //   段階: 0 銅(1) / 1 銅の山(3) / 2 銀(9) / 3 銀の山(27) / 4 金(81)
  // repair = 壊れた状態から始まる建物の、修理の材料(2 種類)。低い建物は 丸太(木材)+レンガ(石材)、高い建物は 機織り・バリスタ = レンガ(石材)+工具(スパナ)、トマトカー = 丸太(木材)+工具(スパナ)(ユーザーに聞いた)。
  //   番号は wiki の Recipe Buildings / 各建物のページから。個数も wiki のとおり(ユーザーの指示。一度、すべて 1 個ずつにしたが、wiki どおりに戻した)。k = 丸太 logs / レンガ brick / 工具 tools、no = その系統の何番めの品物か、n = 個数。直売所は、はじめから使える
  //   ★ パン屋の石材(4 番め ×1)と、スイーツの店の丸太(8 番め ×2)は、wiki にないので、私が決めた数
  // ★印は、wiki にない品物で、私が名前と材料を決めたもの(見た目から)
  const R = (id, name, needs, secs, reward, unlock) => ({ id, name, needs, secs, reward, unlock });
  const BUILDINGS = {
    market: { name: '直売所', recipes: [
      R('flour', '小麦粉', { wheat: 3 }, 30, [0, 1], 2),
      R('eggs', 'タマゴ', { egg: 3 }, 60, [0, 2], 3),
      R('carrots', 'ニンジン', { carrot: 6 }, 120, [1, 2], 9),
      R('rawbacon', '生ベーコン', { bacon: 6 }, 180, [2, 1], 17),
      R('corn', 'トウモロコシ', { corn: 5 }, 120, [1, 2], 36),
    ] },
    bakery: { name: 'パン屋', repair: [{ k: 'logs', no: 4, n: 1 }, { k: 'brick', no: 4, n: 1 }], recipes: [
      R('bread', 'パン', { wheat: 5 }, 180, [1, 2], 4),
      R('carrotbread', 'ニンジンパン', { carrot: 8, wheat: 7 }, 600, [3, 1], 9),
    ] },
    dairy: { name: '乳製品の店', repair: [{ k: 'logs', no: 5, n: 1 }, { k: 'brick', no: 3, n: 2 }], recipes: [
      R('cheese', 'チーズ', { milk: 5 }, 300, [2, 1], 5),
      R('milk', 'ミルク', { milk: 3 }, 120, [1, 1], 4),
      R('goatmilk', 'ヤギミルク', { goatmilk: 5 }, 120, [1, 2], 11),
      R('goatcheese', 'ヤギチーズ', { goatmilk: 7 }, 300, [2, 1], 12),
      R('butter', 'バター', { milk: 7 }, 420, [2, 2], 16),
    ] },
    bbq: { name: 'BBQ', repair: [{ k: 'logs', no: 7, n: 2 }, { k: 'brick', no: 7, n: 2 }], recipes: [
      R('tofuburger', '豆腐バーガー', { edamame: 11, wheat: 7, carrot: 7 }, 900, [4, 1], 10),
      R('grilledsandwich', 'グリルサンド', { wheat: 7, bacon: 8, egg: 5 }, 720, [3, 2], 18),
      R('grilledbacon', '焼きベーコン', { bacon: 12, sunflower: 7 }, 600, [3, 1], 22),
      R('cheesesandwich', 'チーズサンド★', { wheat: 7, milk: 5 }, 600, [3, 1], 24),
      R('grilledcorn', '焼きとうもろこし', { corn: 9, sunflower: 7 }, 480, [3, 1], 27),
    ] },
    sweets: { name: 'スイーツの店', repair: [{ k: 'logs', no: 8, n: 2 }, { k: 'brick', no: 8, n: 2 }], recipes: [
      R('omelet', 'オムレツ', { egg: 5, milk: 3 }, 300, [2, 1], 4),
      R('sugar', '砂糖', { sugarcane: 4 }, 120, [1, 1], 7),
      R('carrotcake', 'ニンジンケーキ', { carrot: 12, wheat: 7, egg: 7 }, 900, [3, 2], 10),
      R('icecream', 'アイスクリーム', { milk: 5, sugarcane: 7 }, 480, [3, 1], 16),
      R('tiramisu', 'ティラミス', { coffee: 20, egg: 7, milk: 5 }, 900, [4, 1], 39),
    ] },
    loom: { name: '機織り', repair: [{ k: 'brick', no: 9, n: 1 }, { k: 'tools', no: 9, n: 2 }], recipes: [
      R('hat', 'チュロ帽★', { wool: 8 }, 300, [2, 2], 25),
      R('fabrics', '布★', { wool: 11 }, 420, [3, 1], 28),
      R('wool', '羊毛', { wool: 5 }, 120, [1, 2], 30),
      R('trousers', 'ズボン', { wool: 9 }, 720, [3, 1], 32),
      R('jacket', 'ジャケット', { wool: 13 }, 1200, [3, 1], 33),
      R('poncho', 'ポンチョ★', { wool: 15 }, 600, [3, 2], 36),
      R('scarf', 'マフラー★', { wool: 19, hide: 6 }, 900, [4, 1], 40),
      R('pillow', 'まくら', { hide: 40 }, 1200, [4, 1], 43),
      R('purse', '毛皮のバッグ', { hide: 60 }, 1800, [4, 2], 45),
    ] },
    barista: { name: 'バリスタ', repair: [{ k: 'brick', no: 10, n: 1 }, { k: 'tools', no: 10, n: 1 }], recipes: [
      R('coffeebeans', 'コーヒー豆', { coffee: 20 }, 300, [2, 2], 35),
      R('espresso', 'エスプレッソ', { coffee: 15, sugarcane: 3 }, 300, [2, 2], 40),
      R('cappuccino', 'カプチーノ', { coffee: 15, milk: 5 }, 420, [3, 1], 41),
    ] },
    tomatocar: { name: 'トマトカー', repair: [{ k: 'logs', no: 10, n: 2 }, { k: 'tools', no: 10, n: 3 }], recipes: [
      R('tomatostick', 'トマト串', { tomato: 10, edamame: 3 }, 300, [2, 2], 45),
      R('tomatosoup', 'トマトスープ', { tomato: 20, carrot: 5 }, 600, [3, 1], 47),
      R('tomatoburger', 'トマトバーガー', { tomato: 12, egg: 3 }, 480, [3, 1], 48),
      R('stuffedtomato', '詰めトマト', { tomato: 12, milk: 3 }, 480, [3, 1], 49),
    ] },
  };

  // 区画(Land)。plots は耕せるマス、building は建物の敷地(マスではない)。
  // 初期の畑は 5×5 の菱形で、頂点(0,0)に配送トラックの市場がある(建物はすべて 4 マス(2×2)。畑 21 マス + 市場 4 マス)。
  const OLD_LANDS = [
    { id: 1, level: 1, cost: 0, plots: [[2, 0, 3, 2], [0, 2, 5, 3]], building: { key: 'market', rect: [0, 0, 2, 2] } },
    { id: 2, level: 2, cost: 2, plots: [[0, -4, 4, 4]] },
    { id: 3, level: 3, cost: 5, plots: [[-5, 0, 5, 2]] },
    { id: 4, level: 4, cost: 10, plots: [[6, 0, 2, 4]], building: { key: 'bakery', rect: [6, 4, 2, 2] }, obstacles: ['tree_s', 'rock_s', 'junk_b'] },
    { id: 5, level: 5, cost: 10, plots: [[0, 6, 4, 3]], building: { key: 'dairy', rect: [4, 6, 2, 2] }, obstacles: ['rock_s', 'junk_a'] },
    { id: 6, level: 6, cost: 20, plots: [[-4, 2, 4, 2]], obstacles: ['tree_s', 'rock_l', 'junk_d'] },
    { id: 7, level: 7, cost: 180, plots: [[0, -6, 3, 2]], obstacles: ['tree_l', 'rock_s', 'crates'] },
    { id: 8, level: 8, cost: 185, plots: [[4, -4, 6, 3]], obstacles: ['tree_l', 'rock_l', 'junk_c', 'tree_s'] },
  ];

  // 景観(土地に含まれないマスに置く)。rect = [c, r, w, h]
  const OLD_DECOR = [
    { key: 'barn', rect: [-6, 7, 3, 3] },
    { key: 'windmill', rect: [9, 6, 2, 2] },
    { key: 'house', rect: [2, 11, 3, 3] },
    { key: 'pond', rect: [-12, -4, 4, 3] },
    { key: 'lamp', rect: [5, -1, 1, 1] },
    { key: 'lamp', rect: [-1, 5, 1, 1] },
    { key: 'lamp', rect: [5, 5, 1, 1] },
  ];

  // 畑の手前2辺を巡る土の道
  const OLD_ROADS = [[5, 0, 1, 6], [0, 5, 5, 1]];

  // マップエディタの地図から作った配置(js/layout.js。tools/apply_map.js が作る)があれば、それを使う。無ければ、上の配置
  const LAYOUT = (() => {
    try {
      if (typeof module !== 'undefined' && module.exports) return process.env.FMV_LAYOUT === 'old' ? null : require('./layout.js');
      return root.FMV_LAYOUT || null;
    } catch (e) { return null; }
  })();
  const LANDS = LAYOUT ? LAYOUT.lands : OLD_LANDS;
  const DECOR = LAYOUT ? LAYOUT.decor : OLD_DECOR;
  const ROADS = LAYOUT ? LAYOUT.roads : OLD_ROADS;
  const LAYOUT_CUSTOM = !!LAYOUT;
  const LAYOUT_REVISION = LAYOUT && LAYOUT.revision || 0;
  const FORMERLY_OPEN_LANDS = LAYOUT && LAYOUT.formerlyOpenLands || [];
  const SPLIT_LANDS = LAYOUT && LAYOUT.splitLands || [];

  function rectCells(rect) {
    const [c, r, w, h] = rect;
    const out = [];
    for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) out.push([x, y]);
    return out;
  }
  const key = (c, r) => c + ',' + r;

  // マス → 区画 の対応表
  const CELL_LAND = {};
  LANDS.forEach((land) => {
    land.cells = [];
    land.plots.forEach((p) => rectCells(p).forEach(([c, r]) => { land.cells.push([c, r]); CELL_LAND[key(c, r)] = land.id; }));
    const rects = land.plots.slice();
    if (land.building) rects.push(land.building.rect);
    // 雲が覆う外接矩形
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    rects.forEach(([c, r, w, h]) => { x0 = Math.min(x0, c); y0 = Math.min(y0, r); x1 = Math.max(x1, c + w); y1 = Math.max(y1, r + h); });
    land.bounds = { c: x0, r: y0, w: x1 - x0, h: y1 - y0 };
    land.coverCells = [];
    rects.forEach((rc) => rectCells(rc).forEach((cc) => land.coverCells.push(cc)));
  });

  // レベル曲線(本家と同じ)。XP_TO[n] = レベル n へ上がるのに必要な経験値(n = 2〜110)。110 より上は、110 と同じ
  const XP_TO = [0, 0,
    39, 24, 100, 150, 323, 392, 341, 932, 903, 1347, 1493, 4490,
    7167, 8552, 9112, 11833, 11186, 17051, 21750, 20989, 22993, 29987, 38753, 47156,
    56048, 47262, 63420, 65600, 75521, 87351, 94568, 96452, 104499, 121986, 119728, 133914,
    144207, 151051, 168066, 175080, 184412, 173961, 173199, 190780, 209053, 389732, 458008, 531956,
    581553, 582531, 665947, 632657, 649331, 650579, 608257, 638446, 604771, 634853, 616273, 591943,
    638962, 617116, 631027, 632808, 599875, 614474, 585726, 617583, 603372, 612273, 631213, 612742,
    634706, 620410, 583024, 652480, 651366, 640073, 641120, 639160, 628054, 609182, 636996, 613410,
    598213, 666353, 642932, 641164, 646564, 628300, 644510, 618962, 629454, 627499, 595234, 648761,
    633649, 653314, 635324, 631143, 639423, 599574, 625749, 649664, 645095, 692192, 685972, 685024,
    676053,
  ];
  const XP_GAIN = 1;   // 経験値を得る量の倍率(1 = 本家の表のまま。進みが遅いと感じたら大きくする)
  const xpForLevel = (lv) => XP_TO[Math.min(lv + 1, XP_TO.length - 1)];   // いまのレベルから、次のレベルまでに必要な経験値
  // レベルアップの報酬(本家と同じ): Lv2〜3 は無し、Lv4 は箱 20、Lv5 から箱 10 とエネルギー 10
  const levelUpReward = (lv) => (lv <= 3 ? { crates: 0, energy: 0 } : lv === 4 ? { crates: 20, energy: 0 } : { crates: 10, energy: 10 });

  // レシピの報酬の合計(コインの額)
  const recipeReward = (rc) => Math.pow(3, rc.reward[0]) * rc.reward[1];

  const api = { TILE_W, TILE_H, MAX_TIER, MAX_ENERGY, CHAINS, INGREDIENTS, OBSTACLES, BUILDINGS, LANDS, DECOR, ROADS, CELL_LAND, key, rectCells, xpForLevel, levelUpReward, XP_GAIN, recipeReward, OBS_STEPS, OBS_STAGES, LAYOUT_CUSTOM, LAYOUT_REVISION, FORMERLY_OPEN_LANDS, SPLIT_LANDS, CHESTS, CHEST_KEYS, CHEST_LIFETIME_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FMV = Object.assign(root.FMV || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
