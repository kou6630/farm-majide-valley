(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.kayoRanchState = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const MAX_BYTES = 300000;
  const GEM_PACKS = Object.freeze({
    'gems-200': Object.freeze({gems:200,kp:40}),
    'gems-900': Object.freeze({gems:900,kp:160}),
    'gems-3500': Object.freeze({gems:3500,kp:600})
  });
  function walletKp(profile) { return Number.isSafeInteger(profile?.kp) && profile.kp >= 0 ? profile.kp : null; }
  function walletCookies(profile) { return Number.isSafeInteger(profile?.cookies) && profile.cookies >= 0 ? profile.cookies : 0; }
  function cookieEarnings(snapshot) {
    return snapshot ? JSON.parse(JSON.parse(snapshot).gameJson).cookiesEarned || 0 : 0;
  }
  function planPurchase(profile, saved, payload = {}, receipt = null) {
    const permitted=access(profile);if(!permitted.ok)return permitted;
    const pack=GEM_PACKS[payload.packId], purchaseId=String(payload.purchaseId||'');
    if(!pack || !/^ranchbuy_[A-Za-z0-9_-]{16,100}$/.test(purchaseId) || !Number.isInteger(payload.baseVersion) || payload.baseVersion<1)return {ok:false,code:'ranch-invalid-purchase',message:'購入内容を確認できませんでした。'};
    const previous=snapshotResult(saved||{}),kp=walletKp(profile);
    if(!previous.ok)return previous;
    if(kp===null)return {ok:false,code:'ranch-kp-unavailable',message:'トラッカーのKP残高を確認できませんでした。トラッカーでログインし直してください。'};
    if(receipt){
      if(receipt.purchaseId!==purchaseId || receipt.packId!==payload.packId || receipt.baseVersion!==payload.baseVersion)return {ok:false,code:'ranch-invalid-purchase',message:'購入内容を確認できませんでした。'};
      return {...previous,alreadyApplied:true,kp,packId:payload.packId,gems:pack.gems};
    }
    if(!previous.stateJson || previous.version!==payload.baseVersion)return {ok:false,code:'ranch-conflict',message:'別の端末で牧場が更新されました。保存済みの進捗を読み直してください。'};
    if(kp<pack.kp)return {ok:false,code:'insufficient-kp',message:'KPが足りません。',cost:pack.kp,kp};
    const value=JSON.parse(previous.stateJson),game=JSON.parse(value.gameJson);
    game.gems+=pack.gems;value.gameJson=JSON.stringify(game);
    const stateJson=normalizeSnapshot(JSON.stringify(value));
    if(!stateJson)return {ok:false,code:'ranch-invalid-save',message:'牧場の保存データを確認できませんでした。'};
    return {ok:true,stateJson,version:previous.version+1,saveId:purchaseId,kp:kp-pack.kp,packId:payload.packId,gems:pack.gems,cost:pack.kp};
  }
  function normalizeSnapshot(input) {
    try {
      if (typeof input !== "string" || input.length > MAX_BYTES) return null;
      const value = JSON.parse(input);
      if (!value || value.schemaVersion !== 1 || typeof value.gameJson !== "string") return null;
      const game = JSON.parse(value.gameJson);
      if (!game || game.v !== 3 || !game.items || typeof game.items !== "object" || Array.isArray(game.items)) return null;
      if (!Number.isInteger(game.level) || game.level < 1 || game.level > 1000) return null;
      for (const key of ["xp", "coins", "gems", "energy", "crates"]) {
        if (!Number.isFinite(game[key]) || game[key] < 0 || game[key] > 1e12) return null;
      }
      if (game.cookiesEarned !== undefined && (!Number.isSafeInteger(game.cookiesEarned) || game.cookiesEarned < 0 || game.cookiesEarned > 1e12)) return null;
      const snapshot = JSON.stringify({schemaVersion:1,gameJson:JSON.stringify(game),tutorial:Math.max(0, Math.min(100, Math.floor(Number(value.tutorial) || 0)))});
      if (new TextEncoder().encode(snapshot).length > MAX_BYTES) return null;
      return snapshot;
    } catch { return null; }
  }
  function access(current) {
    if (!current || !current.onboardingCompletedAt || !String(current.nickname || "").trim()) return {ok:false,code:"onboarding-required",message:"トラッカーのGoogleアカウント登録を完了してください。"};
    if (current.accountStatus === "blocked") return {ok:false,code:"account-blocked",message:"このアカウントでは牧場を利用できません。"};
    let progress;
    try { progress = JSON.parse(current.progressJson || "{}"); } catch { progress = {}; }
    const unlocks = Array.isArray(progress.skillTreeUnlocks) ? progress.skillTreeUnlocks : [];
    if (!unlocks.includes("ranch") && !unlocks.includes("farm")) return {ok:false,code:"ranch-locked",message:"スキルツリーでK/AYO牧場を解放してください。"};
    return {ok:true};
  }
  function snapshotResult(current) {
    const raw = String(current.ranchStateJson || "");
    const stateJson = raw ? normalizeSnapshot(raw) : "";
    if (raw && !stateJson) return {ok:false,code:"ranch-invalid-state",message:"保存済みの牧場データを読み込めませんでした。"};
    return {ok:true,stateJson,version:Math.max(0,Math.floor(Number(current.ranchStateVersion) || 0)),saveId:String(current.ranchSaveId || "")};
  }
  function planSave(current, payload = {}) {
    const permitted = access(current);
    if (!permitted.ok) return permitted;
    const stateJson = normalizeSnapshot(payload.stateJson);
    const saveId = String(payload.saveId || "");
    if (!stateJson || !/^[A-Za-z0-9_-]{16,128}$/.test(saveId) || !Number.isInteger(payload.baseVersion) || payload.baseVersion < 0) return {ok:false,code:"ranch-invalid-save",message:"牧場の保存データを確認できませんでした。"};
    const previous = snapshotResult(current);
    if (!previous.ok) return previous;
    if (saveId === previous.saveId && stateJson === previous.stateJson) return {...previous,alreadyApplied:true};
    if (payload.baseVersion !== previous.version || saveId === previous.saveId) return {ok:false,code:"ranch-conflict",message:"別の端末で牧場が更新されました。保存済みの進捗を読み直してください。"};
    const cookiesEarned = cookieEarnings(stateJson), cookieCredit = cookiesEarned - cookieEarnings(previous.stateJson);
    if (cookieCredit < 0) return {ok:false,code:'ranch-conflict',message:'クッキーの保存状態が変わりました。保存済みの進捗を読み直してください。'};
    return {ok:true,stateJson,version:previous.version+1,saveId,cookieCredit,cookiesEarned};
  }
  // Full resource gauges advance these anchors every frame. They do not,
  // by themselves, represent progress that needs another cloud write.
  function progressKey(snapshot) {
    if(!snapshot)return '';
    const value=JSON.parse(snapshot),game=JSON.parse(value.gameJson);
    delete game.lastEnergyAt;delete game.lastCrateAt;
    return JSON.stringify({schemaVersion:value.schemaVersion,game,tutorial:value.tutorial});
  }
  return {MAX_BYTES,GEM_PACKS,walletKp,walletCookies,cookieEarnings,planPurchase,normalizeSnapshot,access,snapshotResult,planSave,progressKey};
});
