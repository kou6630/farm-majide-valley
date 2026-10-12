// 市場は DOM で表示し、購入・在庫・受け取り時刻はエンジンの保存データで管理する。
(function (F) {
  F.createMarket = function (engine, view, save = () => {}) {
    const $ = id => document.getElementById(id), modal = $('market'), dialog = $('market-dialog');
    const names = { crates: '物資箱', energy: 'スタミナ', gems: 'ジェム' };
    let opener, expiry = 0, pending = null;
    const time = ms => { const s = Math.ceil(ms / 1000); return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(n => String(n).padStart(2, '0')).join(':'); };
    const money = p => p.currency === 'coins' ? 'コイン' : 'ジェム';
    const price = p => p.free ? '無料で受け取る' : p.currency === 'demo' ? `$${p.price} · デモ購入` : `<img src="assets/ref/tactical_${p.currency === 'coins' ? 'coin' : 'gem'}.png" alt="${money(p)}">${p.price}`;
    function card(p, deal = false) {
      const locked = (p.level || 1) > engine.state.level, disabled = locked || (deal ? !p.remaining : p.left > 0);
      return `<article class="market-product${p.free ? ' free' : ''}${p.n === 3500 ? ' featured' : ''}">
        <div class="market-product-top">${deal ? `<span data-stock="${p.id}">残り ${p.remaining}</span>` : `<span>${p.badge || (p.free ? '毎日無料' : p.currency === 'demo' ? '支払いなし' : '補給パック')}</span>`}<b>×${p.n.toLocaleString()}</b></div>
        <img class="market-art" src="${p.image}" alt="${p.name || names[p.kind]}">
        <h3>${p.name || names[p.kind]}</h3>
        <button class="market-buy" data-buy="${p.id}" ${disabled ? 'disabled' : ''} aria-label="${p.name || names[p.kind]}${p.n}個 ${p.free ? '無料で受け取る' : p.currency === 'demo' ? 'デモ購入' : money(p) + p.price + 'で交換'}">${locked ? `LV ${p.level} で解放` : deal && !p.remaining ? '売り切れ' : p.free && p.left ? time(p.left) : price(p)}</button>
      </article>`;
    }
    function render() {
      const scroll = $('market-scroll').scrollTop;
      const info = engine.marketInfo(); expiry = info.expiresAt;
      $('market-content').innerHTML = `<section id="market-deals" class="market-section"><div class="market-section-heading"><div><small>FLASH SUPPLY</small><h2>フラッシュディール</h2></div><span>4時間ごとに補充</span></div><div class="market-grid">${info.deals.map(p => card(p, true)).join('')}</div><div class="market-refresh"><span>補充まで <b id="market-refresh-time">${time(info.left)}</b></span><button id="market-reset"><img src="assets/ref/tactical_gem.png" alt="ジェム">${F.MARKET_RESET_GEMS} で在庫リセット</button></div><p class="market-delivery">素材は畑へお届け。空きがないときは報酬の泡に保管します。</p></section>`
        + ['crates', 'energy', 'gems'].map(kind => `<section id="market-${kind}" class="market-section"><div class="market-section-heading"><div><small>${kind === 'crates' ? 'SUPPLY DROPS' : kind === 'energy' ? 'ENERGY RECHARGE' : 'RADIANT GEMS'}</small><h2>${names[kind]}</h2></div><span>${kind === 'gems' ? 'デモ購入 · 支払いなし' : '残高に直接追加'}</span></div>${kind === 'gems' ? '<p class="market-demo-note">ジェムの購入は体験用です。実際の決済は発生しません。</p>' : ''}<div class="market-grid">${info.packs.filter(p => p.kind === kind).sort((a,b) => kind === 'gems' ? (b.n === 3500) - (a.n === 3500) : 0).map(p => card(p)).join('')}</div></section>`).join('');
      $('market-scroll').scrollTop = scroll;
      update();
    }
    function update() {
      const info = engine.marketInfo(), s = engine.state;
      $('market-gem-balance').textContent = s.gems.toLocaleString(); $('market-coin-balance').textContent = s.coins.toLocaleString();
      const available = info.packs.some(p => p.free && !p.left); $('market-badge').classList.toggle('hidden', !available);
      if (modal.classList.contains('hidden')) return;
      if (expiry !== info.expiresAt) { render(); return; }
      if ($('market-refresh-time')) $('market-refresh-time').textContent = time(info.left);
      info.packs.filter(p => p.free).forEach(p => { const b = modal.querySelector(`[data-buy="${p.id}"]`); if (b) { b.disabled = p.left > 0; b.textContent = p.left ? time(p.left) : '無料で受け取る'; } });
    }
    function open(section = 'deals') {
      opener = document.activeElement;
      ['card-popover','workers','regrow','panel','chest'].forEach(id => $(id).classList.add('hidden'));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      render(); $('market-message').classList.add('hidden'); modal.classList.remove('hidden'); scrollTo(section);
      $('market-close').focus();
    }
    function close() { modal.classList.add('hidden'); cancelConfirmation(); if (opener) opener.focus(); }
    function scrollTo(section) { const scroller = $('market-scroll'), el = $('market-' + section); scroller.scrollTo({ top: scroller.scrollTop + el.getBoundingClientRect().top - scroller.getBoundingClientRect().top, behavior: 'auto' }); modal.querySelectorAll('[data-section]').forEach(b => b.classList.toggle('on', b.dataset.section === section)); }
    function feedback(res, p) {
      if (!res.ok) { view.toast({ nogems: 'ジェムが足りません', coins: 'コインが足りません', soldout: '売り切れです', cooldown: '次の無料受け取りまでお待ちください', level: 'まだ解放されていません' }[res.reason] || 'この商品は受け取れません'); return; }
      save(); render();
      $('market-message').textContent = p ? `${p.name || names[p.kind]} ×${p.n.toLocaleString()} を受け取りました${res.bubbles && res.bubbles.length ? '（報酬の泡に保管）' : ''}${res.demo ? ' · 支払いなし' : ''}` : '特売の在庫を補充しました';
      $('market-message').classList.remove('hidden');
    }
    function confirm(p) {
      pending = p; $('market-confirm-title').textContent = p === 'reset' ? '特売の在庫を補充しますか？' : 'デモ購入';
      $('market-confirm-copy').textContent = p === 'reset' ? `ジェム ${F.MARKET_RESET_GEMS} 個を使って在庫をリセットします。` : `ジェム ×${p.n.toLocaleString()} · 表示価格 $${p.price}\n支払いなしでジェムを受け取れます。`;
      $('market-confirm-ok').textContent = p === 'reset' ? 'ジェムで補充' : '支払いなしで受け取る';
      $('market-confirm').classList.remove('hidden'); $('market-confirm-ok').focus();
    }
    function cancelConfirmation() { pending = null; $('market-confirm').classList.add('hidden'); }
    $('market-content').addEventListener('click', e => {
      const b = e.target.closest('[data-buy]');
      if (b) { const info = engine.marketInfo(), p = [...info.deals, ...info.packs].find(p => p.id === b.dataset.buy); if (!p) return; $('market-message').classList.add('hidden'); if (p.currency === 'demo') confirm(p); else feedback(engine.buyMarket(p.id), p); }
      if (e.target.closest('#market-reset')) confirm('reset');
    });
    $('market-confirm-ok').addEventListener('click', () => { const p = pending; if (!p) return; cancelConfirmation(); feedback(p === 'reset' ? engine.refreshMarket() : engine.buyMarket(p.id, { demoConfirmed: true }), p === 'reset' ? null : p); $('market-close').focus(); });
    $('market-confirm-cancel').addEventListener('click', () => { cancelConfirmation(); $('market-close').focus(); });
    $('market-tabs').addEventListener('click', e => { const b = e.target.closest('[data-section]'); if (b) scrollTo(b.dataset.section); });
    $('btn-market').addEventListener('click', () => open());
    $('gem-add').addEventListener('click', () => open('gems'));
    $('energy-add').addEventListener('click', () => open('energy'));
    $('market-close').addEventListener('click', close);
    modal.addEventListener('click', e => { if (e.target === modal) close(); });
    modal.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); if (pending) { cancelConfirmation(); $('market-close').focus(); } else close(); }
      if (e.key === 'Tab') {
        const area = pending ? $('market-confirm') : dialog, buttons = Array.from(area.querySelectorAll('button:not(:disabled)')).filter(b => b.getClientRects().length);
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    setInterval(update, 1000); update();
    return { open, close };
  };
})(window.FMV);
