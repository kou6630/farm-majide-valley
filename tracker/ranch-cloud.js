(function(root,factory){
  const api=factory(root);
  if(typeof module==='object' && module.exports) module.exports=api;
  if(root) root.kayoRanchCloud=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  function create(sdk,db,rules) {
    const profileRef=uid=>sdk.doc(db,'googleUsers',uid);
    const saveRef=uid=>sdk.doc(db,'googleRanches',uid);
    const purchaseRef=(uid,id)=>sdk.doc(db,'googleRanchPurchases',uid,'operations',id);
    function permitProfile(profile) {
      const access=rules.access(profile);
      if(!access.ok) throw Object.assign(Error(access.message),access);
    }
    function permit(profile) {
      permitProfile(profile);
      if(profile.kayoRanchUnlocked!==true) throw Object.assign(Error('トラッカーで牧場を開いてから、もう一度お試しください。'),{code:'ranch-locked'});
    }
    async function load(uid,onProgress=()=>{}) {
      onProgress('profile');
      let profile=await sdk.getDocFromServer(profileRef(uid));
      const data=profile.exists()?profile.data():null;
      permitProfile(data);
      // Older tracker versions store the unlock in progressJson only.
      // Confirm the latest profile inside a transaction before migrating it.
      if(data.kayoRanchUnlocked!==true){
        onProgress('unlock');
        await sdk.runTransaction(db,async transaction=>{
          const fresh=await transaction.get(profileRef(uid));
          const latest=fresh.exists()?fresh.data():null;
          permitProfile(latest);
          if(latest.kayoRanchUnlocked!==true)transaction.update(profileRef(uid),{kayoRanchUnlocked:true});
        });
        profile=await sdk.getDocFromServer(profileRef(uid));
      }
      permit(profile.exists()?profile.data():null);
      onProgress('save');
      const saved=await sdk.getDocFromServer(saveRef(uid));
      const result=rules.snapshotResult(saved.exists()?saved.data():{});
      if(!result.ok) throw Object.assign(Error(result.message),result);
      return {...result,nickname:profile.data().nickname,kp:rules.walletKp(profile.data()),cookies:rules.walletCookies(profile.data()),cookiesEarned:rules.cookieEarnings(result.stateJson),killCoinAwards:profile.data().kayoKillCoinAwards||{}};
    }
    async function save(uid,payload) {
      return sdk.runTransaction(db,async transaction=>{
        const profile=await transaction.get(profileRef(uid));
        permit(profile.exists()?profile.data():null);
        const saved=await transaction.get(saveRef(uid));
        const plan=rules.planSave({...profile.data(),...(saved.exists()?saved.data():{})},payload);
        if(!plan.ok) throw Object.assign(Error(plan.message),plan);
        if(!plan.alreadyApplied) {
          // 開いた日時は publish() だけが更新する。保存で訪問先の順番を動かさない。
          const directoryRef=sdk.doc(db,'googleRanchDirectory',uid);
          const directory=root.kayoRanchVisits ? await transaction.get(directoryRef) : null;
          const summary=directory ? root.kayoRanchVisits.directory(uid,profile.data().nickname,plan.stateJson) : null;
          const previous=directory?.exists() ? directory.data() : null;
          transaction.set(saveRef(uid),{ranchStateJson:plan.stateJson,ranchStateVersion:plan.version,ranchSaveId:plan.saveId,ranchUpdatedAt:sdk.serverTimestamp()});
          if(plan.cookieCredit > 0) {
            const cookies = rules.walletCookies(profile.data()) + plan.cookieCredit;
            if(!Number.isSafeInteger(cookies) || cookies > 1e12)throw Object.assign(Error('クッキーの残高を確認できませんでした。'),{code:'ranch-invalid-save'});
            transaction.update(profileRef(uid),{cookies,kayoRanchCookieSaveId:plan.saveId,kayoRanchCookiesEarned:plan.cookiesEarned,trackerWriteNonce:plan.saveId.slice(-32)});
            transaction.set(sdk.doc(db,'googleRanchCookieClaims',uid,'operations',plan.saveId),{saveId:plan.saveId,amount:plan.cookieCredit,total:plan.cookiesEarned,baseVersion:payload.baseVersion,version:plan.version,createdAt:sdk.serverTimestamp()});
          }
          if(summary && (!previous?.updatedAt || Object.entries(summary).some(([key,value])=>previous[key]!==value))) {
            transaction.set(directoryRef,{...summary,updatedAt:previous?.updatedAt||sdk.serverTimestamp()});
          }
        }
        return {...plan,cookies:rules.walletCookies(profile.data())+(plan.alreadyApplied?0:plan.cookieCredit||0),cookiesEarned:rules.cookieEarnings(plan.stateJson)};
      });
    }
    async function purchase(uid,payload) {
      if(!/^ranchbuy_[A-Za-z0-9_-]{16,100}$/.test(String(payload?.purchaseId||'')))throw Object.assign(Error('購入内容を確認できませんでした。'),{code:'ranch-invalid-purchase'});
      return sdk.runTransaction(db,async transaction=>{
        const profile=await transaction.get(profileRef(uid));
        permit(profile.exists()?profile.data():null);
        const saved=await transaction.get(saveRef(uid));
        const receipt=await transaction.get(purchaseRef(uid,payload.purchaseId));
        const plan=rules.planPurchase(profile.data(),saved.exists()?saved.data():{},payload,receipt.exists()?receipt.data():null);
        if(!plan.ok)throw Object.assign(Error(plan.message),plan);
        if(!plan.alreadyApplied){
          transaction.update(profileRef(uid),{kp:plan.kp,kayoRanchPurchaseId:payload.purchaseId,trackerWriteNonce:payload.purchaseId.slice(-32)});
          transaction.set(saveRef(uid),{ranchStateJson:plan.stateJson,ranchStateVersion:plan.version,ranchSaveId:plan.saveId,ranchUpdatedAt:sdk.serverTimestamp()});
          transaction.set(purchaseRef(uid,payload.purchaseId),{purchaseId:payload.purchaseId,packId:plan.packId,kpCost:plan.cost,gems:plan.gems,baseVersion:payload.baseVersion,version:plan.version,createdAt:sdk.serverTimestamp()});
        }
        return plan;
      });
    }
    function watch(uid,invalid,wallet=()=>{}) {
      return sdk.onSnapshot(profileRef(uid),snapshot=>{
        if(snapshot.metadata.fromCache) return;
        try {permit(snapshot.exists()?snapshot.data():null);wallet(rules.walletKp(snapshot.data()),rules.walletCookies(snapshot.data()),snapshot.data().kayoRanchCookiesEarned||0,snapshot.data().kayoKillCoinAwards||{});} catch(error){invalid(error);}
      },invalid);
    }
    return {load,save,purchase,watch};
  }
  return {create};
});
