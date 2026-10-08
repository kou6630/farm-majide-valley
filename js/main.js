// 起動: 素材の読み込み → セーブデータの復元 → 開始
(function () {
  const F = window.FMV;
  const SAVE_KEY = 'fmv-save-v1';
  const $ = (id) => document.getElementById(id);

  const engine = F.createEngine();
  let saved = null;
  try { saved = localStorage.getItem(SAVE_KEY); } catch (e) { /* ブラウザ設定で保存できない場合は新規で始める */ }
  if (!saved || !engine.load(saved)) engine.newState();

  let resetting = false;   // リセット中は、保存しない(再読み込みのときの保存で、消したデータが戻ってしまう)
  function save() {
    if (resetting) return;
    try { localStorage.setItem(SAVE_KEY, engine.serialize()); } catch (e) { /* 保存できなくても遊べる */ }
  }

  const view = F.createView(engine, $('stage'), {
    reset() {
      resetting = true;
      try { localStorage.removeItem(SAVE_KEY); localStorage.removeItem('fmv-hint'); } catch (e) { /* ignore */ }
      window.removeEventListener('beforeunload', save);
      location.reload();
    },
  });

  F.loadAssets((p) => { $('loading-fill').style.width = Math.round(p * 100) + '%'; }).then(() => {
    view.start();
    $('loading').classList.add('done');
    setTimeout(() => { $('loading').style.display = 'none'; }, 600);
    setInterval(save, 3000);
    window.addEventListener('beforeunload', save);
    document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  });

  // デバッグ用(開発中にコンソールから触れる)
  window.__fmv = { engine, view, save };
})();
