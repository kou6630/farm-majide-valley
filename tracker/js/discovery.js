// 図鑑の表示。発見・受取状態はエンジンの通常セーブに含める。
(function (F) {
  F.createDiscovery = function (engine, { canOpen = () => true, save = () => {}, toast = () => {} } = {}) {
    const $ = id => document.getElementById(id), dialog = $('discovery-dialog');
    const image = url => window.ranchDeviceProfile ? window.ranchDeviceProfile.image(url).url : url;
    let group = 'crops', revision = -1, opener;
    const gem = () => `<img src="${image('assets/ref/tactical_gem.png')}" alt="ジェム">`;
    function render() {
      const info = engine.discoveryInfo();
      $('discovery-progress').textContent = `${info.discovered} / ${info.total}`;
      $('discovery-balance').textContent = engine.state.gems.toLocaleString();
      $('discovery-pending').textContent = `未受取 ${info.pending}`;
      $('discovery-tabs').innerHTML = Object.entries(F.DISCOVERY_GROUPS).map(([id, name]) => {
        const entries = info.entries.filter(it => it.group === id), pending = entries.filter(it => it.seen && !it.claimed).length;
        return `<button data-group="${id}" aria-pressed="${id === group}">${name}${pending ? `<b>${pending}</b>` : ''}</button>`;
      }).join('');
      $('discovery-grid').innerHTML = info.entries.filter(it => it.group === group).map(it => `<article class="discovery-entry${it.seen ? ' discovered' : ''}${it.claimed ? ' claimed' : ''}">
        <div class="discovery-picture"><img class="discovery-item" src="${image(it.image)}" alt="" loading="lazy">${it.card ? `<span class="discovery-star">${'★'.repeat(it.tier + 1)}</span>` : ''}${!it.seen ? '<span class="discovery-unknown" aria-hidden="true">?</span>' : ''}</div>
        <h3>${it.seen ? it.name : '？？？'}</h3>
        ${it.seen && !it.claimed ? `<button data-claim="${it.id}" aria-label="${it.name}の報酬 ジェム${it.reward}個を受け取る">${gem()}<b>×${it.reward}</b><span>受け取る</span></button>` : `<p>${it.claimed ? '✓ 受取済み' : '未発見'}</p>`}
      </article>`).join('');
    }
    function update() {
      if (revision === engine.state.discovery.revision) return;
      revision = engine.state.discovery.revision;
      const pending = engine.discoveryInfo().pending;
      $('discovery-badge').hidden = pending === 0;
      $('discovery-open').setAttribute('aria-label', pending ? `図鑑を開く 未受取の報酬${pending}件` : '図鑑を開く');
      if (dialog.open) render();
    }
    function open() {
      if (!canOpen() || dialog.open) return;
      opener = document.activeElement; render(); $('discovery-message').textContent = '';
      dialog.showModal(); $('discovery-close').focus();
    }
    function close() { dialog.close(); if (opener?.isConnected) opener.focus(); }
    $('discovery-open').addEventListener('click', open);
    $('discovery-close').addEventListener('click', close);
    dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close(); } });
    $('discovery-tabs').addEventListener('click', event => {
      const target = event.target.closest('[data-group]');
      if (!target || !Object.hasOwn(F.DISCOVERY_GROUPS, target.dataset.group)) return;
      group = target.dataset.group; render(); $('discovery-scroll').scrollTop = 0;
      $('discovery-tabs').querySelector(`[data-group="${group}"]`)?.focus();
    });
    $('discovery-grid').addEventListener('click', event => {
      const button = event.target.closest('[data-claim]');
      if (!button || !dialog.open || !canOpen()) return;
      const id = button.dataset.claim, result = engine.claimDiscovery(id);
      if (!result.ok) return;
      save(); update();
      $('discovery-message').textContent = `ジェム ×${result.gems} を受け取りました`;
      toast(`図鑑の報酬 ジェム +${result.gems}`);
      // 再描画で消えた受取ボタンから、次の受取先か閉じるへフォーカスを戻す。
      ($('discovery-grid').querySelector('[data-claim]') || $('discovery-close')).focus();
    });
    update();
    return { open, close, update };
  };
})(window.FMV);
