(() => {
  const rules=window.kayoRanchState, $=id=>document.getElementById(id);
  const prefix='buriburi_ranch_pending_v1:';
  const purchasePrefix='buriburi_ranch_purchase_v1:';
  const travelPrefix='buriburi_ranch_travel_v1:',activeTripPrefix='buriburi_ranch_active_trip_v1:';
  const racePrefix='buriburi_ranch_race_claim_v1:';
  const SAVE_INTERVAL_MS=5*60*1000;
  const LOAD_STALL_MS=60000;
  let active=null, generation=0, services=null;
  const bootTimer=setTimeout(()=>fail({code:'auth-load-timeout'}),LOAD_STALL_MS);
  bootTimer.unref?.();
  function status(text){if($('ranch-status').textContent!==text)$('ranch-status').textContent=text;}
  function message(error) {
    if(error?.code==='auth-load-timeout' || error?.code==='auth-init-failed')return 'ログインの準備が進んでいません。通信を確認して再読み込みしてください。';
    if(error?.code==='ranch-load-timeout')return error.message;
    if(error?.code==='permission-denied') return 'このアカウントでは牧場を利用できません。トラッカーの登録・解放状態を確認してください。';
    if(error?.message && /^(トラッカー|スキルツリー|このアカウント|保存済み|別の端末|牧場の|KP|購入)/.test(error.message)) return error.message;
    if(error?.code==='auth/popup-blocked') return 'ログイン画面を開けませんでした。ポップアップを許可して再試行してください。';
    if(error?.code==='auth/unauthorized-domain') return 'このページのGoogleログイン設定がまだ完了していません。';
    return '通信を確認して、もう一度お試しください。';
  }
  function gate(text,loggedIn=false) {
    active?.race?.stop();
    $('ranch-menu').close();
    if($('action-confirm').open)$('action-confirm').close();
    for(const id of ['travel-picker','visit-gift'])if($(id)?.open)$(id).close();
    $('ranch-gate').hidden=false;
    $('ranch-message').textContent=text;
    $('ranch-login').hidden=loggedIn;
    $('ranch-gate-logout').hidden=!loggedIn;
    $('ranch-reload').hidden=!loggedIn;
    $('ranch-gate-save').hidden=true;
    $('ranch-progress-box').hidden=true;
  }
  function loading(text,detail,percent=null){
    if($('ranch-message').textContent!==text)$('ranch-message').textContent=text;
    $('ranch-progress-box').hidden=false;
    $('ranch-progress-detail').textContent=detail;
    if(percent===null)$('ranch-progress').removeAttribute('value');
    else $('ranch-progress').value=Math.max(0,Math.min(100,percent));
  }
  async function waitLoading(task,timeoutMessage){
    let timer,rejectTimeout,acceptProgress=true;
    const timeout=new Promise((_resolve,reject)=>{rejectTimeout=reject;});
    const reset=()=>{
      clearTimeout(timer);
      timer=setTimeout(()=>rejectTimeout(Object.assign(Error(typeof timeoutMessage==='function'?timeoutMessage():timeoutMessage),{code:'ranch-load-timeout'})),LOAD_STALL_MS);
      timer.unref?.();
    };
    reset();
    try{return await Promise.race([Promise.resolve().then(()=>task(()=>{if(acceptProgress)reset();return acceptProgress;})),timeout]);}
    finally{acceptProgress=false;clearTimeout(timer);}
  }
  function current(session){return active===session && session.generation===generation;}
  function persist(session){
    if(!session.pending)return;
    try {localStorage.setItem(prefix+session.uid,JSON.stringify({payload:session.pending,latest:session.latest,attempted:session.attempted}));}
    catch {status('保存待ち（このブラウザに一時保存できません）');}
  }
  function queue(session,snapshot){
    session.latest=snapshot;
    const dirty=rules.progressKey(snapshot)!==session.savedKey;
    if(!dirty && session.pending && !session.attempted && !session.flight){
      session.pending=null;
      try{localStorage.removeItem(prefix+session.uid);}catch{}
      status('変更なし・クラウド保存済み');
    }
    if(dirty && !session.pending){
      session.pending={saveId:'ranch_'+crypto.randomUUID().replaceAll('-',''),baseVersion:session.version,stateJson:snapshot};
      session.attempted=false;
      if(!session.flight)status('端末に保存済み・クラウド保存待ち');
    } else if(session.pending && !session.attempted && !session.flight){
      // Coalesce edits until the first request. Retries must keep the exact
      // payload, because a previous response might have been lost.
      session.pending.stateJson=snapshot;
    }
    persist(session);
  }
  function capture(session){
    if(!session.engine || !current(session) || session.ended)return;
    session.engine.tick();
    const snapshot=rules.normalizeSnapshot(JSON.stringify({schemaVersion:1,gameJson:session.engine.serialize(),tutorial:Number(window.ranchTutorial)||0}));
    if(!snapshot){pause(session,Error('牧場の保存データを確認できませんでした。'));return;}
    queue(session,snapshot);
  }
  function pause(session,error){
    if(!current(session))return;
    session.paused=true;
    session.frozenAt=Date.now();
    $('ranch-play').inert=true;
    gate(message(error),true);
  }
  async function flush(session){
    if(!current(session) || session.conflict || session.ended)return false;
    if(session.flight)return session.flight;
    if(!session.pending)return true;
    const payload=session.pending;
    session.attempted=true;
    status('保存中…'); persist(session);
    session.flight=(async()=>{
      try {
        const result=await services.cloud.save(session.uid,payload);
        if(!current(session))return false;
        session.saved=payload.stateJson;session.savedKey=rules.progressKey(session.saved);session.version=result.version;session.pending=null;session.attempted=false;
        if(Number.isSafeInteger(result.cookies)){session.cookies=result.cookies;session.cookiesEarned=result.cookiesEarned;}
        try {localStorage.removeItem(prefix+session.uid);} catch {}
        status('最終保存 '+new Date().toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit',second:'2-digit'})); $('ranch-retry').hidden=true;
        if(rules.progressKey(session.latest)!==session.savedKey)queue(session,session.latest);
        return true;
      } catch(error){
        if(!current(session))return false;
        persist(session);
        if(['ranch-conflict','ranch-locked','onboarding-required','account-blocked','permission-denied'].includes(error.code)){
          session.conflict=true; pause(session,error);
        } else {status('未保存の進捗を保持しています');$('ranch-retry').hidden=false;}
        return false;
      }
    })();
    const result=await session.flight;session.flight=null;return result;
  }
  async function changed(user){
    generation++;
    if(active){
      active.frozenAt=Date.now();persist(active);active.unsubscribe?.();
      active.race?.stop();
      for(const timer of active.timers||[])clearInterval(timer);
      location.reload();return;
    }
    if(!user){gate('トラッカーに登録したGoogleアカウントでログインしてください。');return;}
    const request=generation;
    gate('登録と牧場の解放状態を確認中…',true);
    loading('登録と牧場の解放状態を確認中…','1 / 3　登録・解放の確認');
    try {
      let cloudPhase='登録と牧場の解放状態の確認';
      let result=await waitLoading(touch=>services.cloud.load(user.uid,stage=>{
        if(!touch() || request!==generation)return;
        cloudPhase=stage==='save'?'セーブデータの読み込み':stage==='unlock'?'牧場の利用権の引き継ぎ':'登録と牧場の解放状態の確認';
        if(stage==='save')loading('セーブデータを読み込み中…','2 / 3　クラウドのセーブを確認');
        else loading('登録と牧場の解放状態を確認中…',stage==='unlock'?'1 / 3　牧場の利用権を引き継ぎ中':'1 / 3　登録・解放の確認');
      }),()=>`${cloudPhase}が60秒間進みませんでした。通信を確認して再読み込みしてください。`);
      if(request!==generation)return;
      let purchase=null;
      try {purchase=JSON.parse(localStorage.getItem(purchasePrefix+user.uid)||'null');}catch{}
      if(purchase){
        loading('購入結果を確認中…','2 / 3　KPとジェムの購入を確認');
        try {
          const recovered=await waitLoading(()=>services.cloud.purchase(user.uid,purchase),'購入結果の確認が60秒間進みませんでした。通信を確認して再読み込みしてください。');
          if(request!==generation)return;
          result={...result,...recovered};localStorage.removeItem(purchasePrefix+user.uid);
        }catch(error){
          if(['insufficient-kp','ranch-conflict','ranch-invalid-purchase','ranch-kp-unavailable','permission-denied'].includes(error.code))localStorage.removeItem(purchasePrefix+user.uid);
          throw error;
        }
      }
      let travelPending=null;
      try{travelPending=JSON.parse(localStorage.getItem(travelPrefix+user.uid)||'null');}catch{}
      if(travelPending&&!['depart','collect','receive'].includes(travelPending.type)){localStorage.removeItem(travelPrefix+user.uid);travelPending=null;}
      if(travelPending&&services.visits){
        loading('訪問結果を確認中…','2 / 3　チケットと訪問報酬を確認');
        try{
          const recovered=await waitLoading(()=>services.visits[travelPending.type](user.uid,travelPending.payload),'訪問結果の確認が60秒間進みませんでした。再読み込みしてください。');
          if(request!==generation)return;
          result={...result,...recovered};
          if(recovered.trip)localStorage.setItem(activeTripPrefix+user.uid,recovered.trip.id);
          localStorage.removeItem(travelPrefix+user.uid);
        }catch(error){
          if(['visit-cooldown','visit-no-ticket','visit-invalid','visit-unavailable','visit-energy-full','visit-receipt-claimed','ranch-conflict'].includes(error.code)){
            localStorage.removeItem(travelPrefix+user.uid);result=await services.cloud.load(user.uid);
          }else throw error;
        }
      }
      let pendingRace=null;try{pendingRace=JSON.parse(localStorage.getItem(racePrefix+user.uid)||'null');}catch{}
      if(pendingRace&&services.race){
        loading('レースの受取結果を確認中…','2 / 3　レース報酬の受取を確認');
        try{const recovered=await waitLoading(()=>services.race.claim(user.uid,pendingRace),'牧場のレース報酬を確認できませんでした。再読み込みしてください。');if(request!==generation)return;result={...result,...recovered};localStorage.removeItem(racePrefix+user.uid);}
        catch(error){if(['race-expired','race-invalid','race-not-entered','ranch-conflict','ranch-locked','account-blocked','onboarding-required'].includes(error.code)){localStorage.removeItem(racePrefix+user.uid);result=await services.cloud.load(user.uid);}else throw error;}
      }
      const session=active={uid:user.uid,generation,version:result.version,kp:result.kp,cookies:result.cookies||0,cookiesEarned:rules.cookieEarnings(result.stateJson),saved:result.stateJson,savedKey:rules.progressKey(result.stateJson),latest:result.stateJson,pending:null,attempted:false,conflict:false,flight:null,engine:null,frozenAt:null,ended:false,finishing:false,purchasing:false,timers:[]};
      let cached=null;
      try {cached=JSON.parse(localStorage.getItem(prefix+user.uid)||'null');} catch {}
      if(cached?.payload){
        loading('未保存の進捗を復旧中…','2 / 3　この端末の保存待ちデータを確認');
        const snapshot=rules.normalizeSnapshot(cached.payload.stateJson),latest=rules.normalizeSnapshot(cached.latest);
        if(!snapshot || !latest)throw Object.assign(Error('牧場の未保存データを確認できませんでした。保存済みの進捗を読み直してください。'),{code:'ranch-invalid-pending'});
        if(cached.payload.saveId===result.saveId && snapshot===result.stateJson){
          try{localStorage.removeItem(prefix+user.uid);}catch{}
          if(rules.progressKey(latest)!==session.savedKey)queue(session,latest);
        }else{session.pending={...cached.payload,stateJson:snapshot};session.attempted=cached.attempted!==false;queue(session,latest);}
        const restored=await waitLoading(async()=>await flush(session) && (!session.pending || await flush(session)),
          '牧場の未保存データの復旧が60秒間進みませんでした。通信を確認して再読み込みしてください。');
        if(!restored){
          if(!session.conflict)gate('牧場の未保存の進捗を復旧できませんでした。通信を確認して再読み込みしてください。',true);
          return;
        }
      }
      if(!current(session))return;
      const saved=session.latest?JSON.parse(session.latest):null;
      const engine=session.engine=window.FMV.createEngine({now:()=>session.frozenAt ?? Date.now()});
      if(saved && !engine.load(saved.gameJson))throw Error('保存済みの牧場データを読み込めませんでした。');
      if(!saved)engine.newState();
      window.ranchTutorial=saved?.tutorial||0;
      const view=session.view=window.FMV.createView(engine,$('stage'),{confirmationScope:user.uid,cookies:()=>session.cookies+Math.max(0,(engine.state.cookiesEarned||0)-session.cookiesEarned),airport:kind=>session.travel?.airport(kind),reset:()=>view.toast('登録した牧場の進捗は、この画面からリセットできません。')});
      window.FMV.createMarket(engine,view,()=>capture(session),{getKp:()=>session.kp,purchase:id=>buyGems(session,id)});
      loading('牧場の画像を読み込み中…','3 / 3　画像を準備',0);
      await waitLoading(touch=>window.FMV.loadAssets((p,counts)=>{
        if(!touch() || !current(session))return;
        const percent=Math.round(p*100),number=counts?`${counts.done} / ${counts.total}枚`:`${percent}%`;
        const failures=counts?.failed?`・${counts.failed}枚読み込み失敗`:'';
        loading('牧場の画像を読み込み中…',`3 / 3　画像確認 ${number}（${percent}%）${failures}`,percent);
        $('loading-fill').style.width=percent+'%';
      }),'牧場の画像読み込みが60秒間進みませんでした。通信を確認して再読み込みしてください。');
      if(!current(session))return;
      $('loading').style.display='none';$('ranch-gate').hidden=true;
      $('ranch-account').textContent=result.nickname; $('ranch-menu-toggle').hidden=false;
      $('ranch-play').inert=false;view.start();status('クラウドの進捗を読み込みました');capture(session);
      if(!session.saved)await flush(session);
      session.unsubscribe=services.cloud.watch(user.uid,error=>{session.conflict=true;pause(session,error);},(kp,cookies,earned)=>{if(current(session)){session.kp=kp;if(Number.isSafeInteger(cookies)){session.cookies=cookies;session.cookiesEarned=earned;}}});
      session.timers=[setInterval(()=>capture(session),3000),setInterval(()=>{capture(session);void flush(session);},SAVE_INTERVAL_MS)];
      if(services.race&&window.kayoWeeklyRaceUI){session.race=window.kayoWeeklyRaceUI.create({uid:user.uid,view,service:services.race,isCurrent:()=>current(session)&&!session.ended,
        canOpen:()=>!session.visiting&&!session.paused&&!session.finishing&&!session.purchasing&&!session.travelBusy&&!session.raceBusy&&!$('ranch-play').inert&&!$('ranch-menu').open&&!$('sort-confirm').open&&!$('sort-btn').disabled,
        operate:fields=>raceClaim(session,fields)});void session.race.init().catch(()=>{});}
      if(services.visits&&window.kayoRanchVisitsUI){
        session.travel=window.kayoRanchVisitsUI.create({uid:user.uid,engine,view,service:services.visits,
          operate:(type,fields)=>travelOperation(session,type,fields),
          home:()=>{session.visiting=false;session.frozenAt=null;capture(session);},
          away:()=>{session.visiting=true;session.frozenAt??=Date.now();}});
        void session.travel.init().catch(error=>view.toast(error.message||'訪問情報を読み込めませんでした。'));
      }
    } catch(error){
      if(request!==generation)return;
      if(active){if(error.code==='ranch-invalid-pending')active.conflict=true;pause(active,error);} else gate(message(error),true);
    }
  }
  async function travelOperation(session,type,fields){
    if(!current(session)||session.paused||session.raceBusy||session.travelBusy||session.purchasing||session.finishing||session.conflict||session.ended)throw Error('いまは訪問操作ができません。');
    session.travelBusy=true;session.frozenAt??=Date.now();$('ranch-play').inert=true;
    let uncertain=false;
    try{
      capture(session);
      for(let i=0;i<3&&session.pending;i++)if(!await flush(session))throw Object.assign(Error('訪問前の保存に失敗しました。通信を確認してください。'),{code:'visit-save-failed'});
      if(session.pending)throw Object.assign(Error('訪問前の保存が完了していません。'),{code:'visit-save-failed'});
      const payload={...fields,baseVersion:session.version};
      localStorage.setItem(travelPrefix+session.uid,JSON.stringify({type,payload}));
      const result=await services.visits[type](session.uid,payload);
      if(!current(session))throw Error('アカウントが切り替わりました。');
      const snapshot=JSON.parse(result.stateJson);
      if(!session.engine.load(snapshot.gameJson))throw Error('訪問後の進捗を読み込めませんでした。');
      session.saved=result.stateJson;session.savedKey=rules.progressKey(result.stateJson);session.latest=result.stateJson;
      session.version=result.version;session.pending=null;session.attempted=false;
      localStorage.removeItem(prefix+session.uid);localStorage.removeItem(travelPrefix+session.uid);
      if(result.trip){session.visiting=true;localStorage.setItem(activeTripPrefix+session.uid,result.trip.id);}
      status('訪問・報酬をクラウドへ保存しました');
      return result;
    }catch(error){
      if(['visit-save-failed','visit-cooldown','visit-no-ticket','visit-invalid','visit-unavailable','visit-energy-full','visit-receipt-claimed','permission-denied','ranch-conflict','account-blocked','ranch-locked','onboarding-required'].includes(error.code)){
        localStorage.removeItem(travelPrefix+session.uid);
        if(['permission-denied','ranch-conflict','account-blocked','ranch-locked','onboarding-required'].includes(error.code)){session.conflict=true;pause(session,error);}
      }else{uncertain=true;pause(session,Error('訪問結果を確認できませんでした。再読み込みして、チケットと報酬を確認してください。'));}
      throw error;
    }finally{
      session.travelBusy=false;
      if(current(session)&&!uncertain&&!session.conflict&&!session.ended){if(!session.visiting)session.frozenAt=null;$('ranch-play').inert=false;}
    }
  }
  async function raceClaim(session,fields){
    if(!current(session)||session.paused||session.ended||session.conflict||session.visiting||session.travelBusy||session.raceBusy||session.purchasing||session.finishing)throw Error('いまはレース報酬を受け取れません。');
    session.raceBusy=true;session.frozenAt=Date.now();$('ranch-play').inert=true;let uncertain=false;
    try{
      capture(session);for(let i=0;i<3&&session.pending;i++)if(!await flush(session))throw Object.assign(Error('牧場の保存を完了できませんでした。通信を確認してください。'),{code:'race-save-failed'});
      if(session.pending)throw Object.assign(Error('牧場の保存が完了していません。'),{code:'race-save-failed'});
      const payload={...fields,baseVersion:session.version,opId:'ranchrace_'+crypto.randomUUID().replaceAll('-','')};
      localStorage.setItem(racePrefix+session.uid,JSON.stringify(payload));
      const result=await services.race.claim(session.uid,payload);if(!current(session))throw Error('アカウントが切り替わりました。');
      if(!session.engine.load(JSON.parse(result.stateJson).gameJson))throw Error('牧場のレース報酬を読み込めませんでした。');
      session.saved=result.stateJson;session.savedKey=rules.progressKey(result.stateJson);session.latest=result.stateJson;session.version=result.version;session.pending=null;session.attempted=false;
      localStorage.removeItem(prefix+session.uid);localStorage.removeItem(racePrefix+session.uid);status('レース報酬をクラウドへ保存しました');return result;
    }catch(error){
      if(['race-save-failed','race-expired','race-invalid','race-not-entered','race-preparing','permission-denied','ranch-conflict','account-blocked','ranch-locked','onboarding-required'].includes(error.code)){
        localStorage.removeItem(racePrefix+session.uid);
        if(['permission-denied','ranch-conflict','account-blocked','ranch-locked','onboarding-required'].includes(error.code)){session.conflict=true;pause(session,error);}
      }else{uncertain=true;pause(session,Error('牧場のレース報酬を確認できませんでした。再読み込みして受取結果を確認してください。'));}
      throw error;
    }finally{session.raceBusy=false;if(current(session)&&!uncertain&&!session.conflict&&!session.ended){session.frozenAt=null;$('ranch-play').inert=false;}}
  }
  async function buyGems(session,packId){
    if(!current(session) || session.raceBusy || session.travelBusy || session.visiting || session.purchasing || session.finishing || session.conflict || session.ended)return {ok:false,message:'購入できる状態ではありません。'};
    if(!rules.GEM_PACKS[packId])return {ok:false,message:'購入内容を確認できませんでした。'};
    session.purchasing=true;session.frozenAt=Date.now();$('ranch-play').inert=true;
    let keepPaused=false;
    try {
      capture(session);
      for(let i=0;i<3 && session.pending;i++){
        if(!await flush(session))throw Object.assign(Error('購入前の進捗を保存できませんでした。再読み込みして確認してください。'),{code:'purchase-save-failed'});
        if(!current(session))return {ok:false};
      }
      if(session.pending)throw Error('購入前の保存が完了していません。');
      const payload={purchaseId:'ranchbuy_'+crypto.randomUUID().replaceAll('-',''),packId,baseVersion:session.version};
      // Persist the operation before sending. Recovery reuses this ID instead of charging twice.
      localStorage.setItem(purchasePrefix+session.uid,JSON.stringify(payload));
      const result=await services.cloud.purchase(session.uid,payload);
      if(!current(session))return {ok:false};
      const snapshot=JSON.parse(result.stateJson);
      if(!session.engine.load(snapshot.gameJson))throw Error('購入後の牧場を読み込めませんでした。');
      window.ranchTutorial=snapshot.tutorial;
      session.version=result.version;session.kp=result.kp;session.saved=result.stateJson;session.savedKey=rules.progressKey(result.stateJson);session.latest=result.stateJson;session.pending=null;session.attempted=false;
      localStorage.removeItem(prefix+session.uid);localStorage.removeItem(purchasePrefix+session.uid);
      status('購入・クラウド保存が完了しました');
      return {ok:true,kind:'gems',n:rules.GEM_PACKS[packId].gems};
    }catch(error){
      if(!current(session))return {ok:false};
      if(['insufficient-kp','ranch-invalid-purchase','ranch-kp-unavailable'].includes(error.code)){
        localStorage.removeItem(purchasePrefix+session.uid);
        if(error.code==='insufficient-kp')session.kp=error.kp;
        return {ok:false,message:error.message};
      }
      if(['ranch-conflict','permission-denied','ranch-locked','onboarding-required','account-blocked'].includes(error.code)){
        localStorage.removeItem(purchasePrefix+session.uid);session.conflict=true;
      }
      keepPaused=true;pause(session,Error('購入結果を確認できませんでした。再読み込みして購入結果を確認してください。'));
      return {ok:false,message:'購入結果の確認が必要です。再読み込みしてください。'};
    }finally{
      session.purchasing=false;
      if(current(session) && !keepPaused && !session.conflict && !session.ended){session.frozenAt=null;$('ranch-play').inert=false;}
    }
  }
  async function finish(logoutAccount=false){
    const session=active;
    if(session?.finishing || session?.purchasing || session?.travelBusy || session?.raceBusy)return;
    if(session){
      session.finishing=true;$('ranch-menu-toggle').disabled=true;
      session.exitLogout=logoutAccount;
    }
    try{
      $('ranch-menu').close();
      if(session){
        session.frozenAt=Date.now();$('ranch-play').inert=true;capture(session);
        for(let i=0;i<3 && session.pending;i++){
          const saved=await flush(session);
          if(!current(session))return;
          if(!saved){
            if(!session.conflict)gate('牧場の進捗を保存できませんでした。通信を確認して、もう一度保存をお試しください。',true);
            $('ranch-gate-save').hidden=session.conflict;
            $('ranch-force-logout').hidden=false;return;
          }
        }
        if(!current(session))return;
        if(session.pending)return;
        session.ended=true;session.unsubscribe?.();
        for(const timer of session.timers)clearInterval(timer);
      }
      if(logoutAccount){await services.logout();return;}
      gate('クラウドへ保存しました。この画面を閉じて終了できます。別の端末でも、保存した進捗から遊べます。',true);
      $('ranch-force-logout').hidden=true;
    }finally{
      if(session)session.finishing=false;
      $('ranch-menu-toggle').disabled=false;
    }
  }
  function start(adapter){
    clearTimeout(bootTimer);
    services=adapter;
    $('ranch-login').onclick=async()=>{
      $('ranch-login').disabled=true;
      try{await services.login();}catch(error){if(error.code!=='auth/popup-closed-by-user')gate(message(error));}
      finally{$('ranch-login').disabled=false;}
    };
    $('ranch-menu-toggle').onclick=()=>{if(active && !active.ended && !active.finishing && !active.purchasing)$('ranch-menu').showModal();};
    $('ranch-menu-close').onclick=()=>$('ranch-menu').close();
    $('ranch-save-exit').onclick=()=>finish(false).catch(error=>gate(message(error),true));
    $('ranch-gate-save').onclick=()=>finish(active?.exitLogout||false).catch(error=>gate(message(error),true));
    $('ranch-logout').onclick=$('ranch-gate-logout').onclick=()=>finish(true).catch(error=>gate(message(error),true));
    $('ranch-force-logout').onclick=()=>void services.logout().catch(error=>gate(message(error),true));
    $('ranch-retry').onclick=()=>{if(active){capture(active);void flush(active);}};
    $('ranch-reload').onclick=()=>{
      if(active?.conflict && !confirm('この画面の未保存の進捗を破棄し、クラウドの進捗を読み直しますか？'))return;
      if(active?.conflict){try{localStorage.removeItem(prefix+active.uid);}catch{}}
      location.reload();
    };
    services.observe(user=>void changed(user));
    window.addEventListener('pointerup',()=>{if(active)setTimeout(()=>capture(active),0);});
    document.addEventListener('visibilitychange',()=>{if(document.hidden && active){capture(active);persist(active);}});
    window.addEventListener('pagehide',()=>{if(active){capture(active);persist(active);}});
  }
  function fail(error){
    clearTimeout(bootTimer);
    gate(message(error));$('ranch-login').hidden=true;$('ranch-reload').hidden=false;
    $('ranch-reload').onclick=()=>location.reload();
  }
  window.kayoRanchBrowser={start,fail};
})();
