// スマホの自動軽量化と、メニューから選ぶ端末ごとの低画質設定。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (!root || !root.document) return;
  let storage;
  try { storage = root.localStorage; } catch { /* Storage can be unavailable in private browsers. */ }
  const profile = api.createProfile(root.navigator, root.fetch.bind(root), storage);
  root.ranchDeviceProfile = profile;
  const init = () => {
    const quality = root.document.getElementById('ranch-low-quality');
    if (quality) {
      quality.checked = profile.lowQuality;
      quality.addEventListener('change', () => profile.setLowQuality(quality.checked));
    }
    return profile.prepare().then(() => {
      root.document.querySelectorAll('img[data-ranch-src]').forEach(im => {
        const original = im.dataset.ranchSrc, source = profile.image(original);
        if (source.url !== original) im.addEventListener('error', () => { im.src = original; }, { once: true });
        im.src = source.url;
      });
    });
  };
  if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})(typeof window === 'undefined' ? null : window, function () {
  function isSmartphone(nav = {}) {
    const ua = nav.userAgent || '';
    if (/Windows NT|Macintosh|CrOS|iPad|Tablet/i.test(ua)) return false;
    return nav.userAgentData?.mobile === true || /iPhone|iPod|Windows Phone/i.test(ua) || (/Android/i.test(ua) && /Mobile/i.test(ua));
  }
  const QUALITY_KEY = 'buriburi_ranch_low_quality_v1';
  function createProfile(nav, fetcher, storage) {
    const mobile = isSmartphone(nav);
    let assets = {}, pending, lowQuality = false;
    try { lowQuality = storage?.getItem(QUALITY_KEY) === '1'; } catch { /* Use the default. */ }
    const listeners = new Set();
    return Object.freeze({
      mobile,
      get lowQuality() { return lowQuality; },
      get pixelRatioLimit() { return lowQuality ? 0.75 : mobile ? 1.25 : 2; },
      get frameInterval() { return lowQuality ? 1000 / 20 : mobile ? 1000 / 30 : 0; },
      get particleRatio() { return lowQuality ? 0.25 : mobile ? 0.5 : 1; },
      setLowQuality(enabled) {
        enabled = !!enabled;
        if (enabled === lowQuality) return;
        lowQuality = enabled;
        try { storage?.setItem(QUALITY_KEY, enabled ? '1' : '0'); } catch { /* Still apply for this session. */ }
        listeners.forEach(fn => fn());
      },
      onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      prepare() {
        if (!pending) pending = mobile
          ? Promise.resolve().then(() => fetcher('mobile-assets/manifest.json?v=20261020-discovery')).then(r => {
            if (!r.ok) throw Error('mobile assets unavailable');
            return r.json();
          }).then(data => { assets = data.assets || {}; }).catch(() => { assets = {}; })
          : Promise.resolve();
        return pending;
      },
      image(url) {
        const entry = mobile && assets[url.split('?')[0]];
        return entry ? { url: entry.url, scale: entry.scale } : { url, scale: 1 };
      },
    });
  }
  return { isSmartphone, createProfile };
});
