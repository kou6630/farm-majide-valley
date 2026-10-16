(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('../kayo-ranch-state'):root.kayoRanchState,typeof module==='object'&&module.exports?require('./js/data'):root.FMV);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.kayoRanchVisits=api;
})(typeof window!=='undefined'?window:globalThis,function(rules,D){
  const COOLDOWN=30*60*1000, REWARDS={energy:10,crates:10,coins:4};
  const day=ms=>Math.floor((ms+9*3600000)/86400000);
  const unpack=state=>JSON.parse(JSON.parse(state).gameJson);
  const error=(code,message)=>Object.assign(Error(message),{code});
  function targets(state,now=Date.now()){
    const game=unpack(state),out={crates:{airport:true},coins:null,energy:null};
    for(const [pos,it] of Object.entries(game.items)){
      const lid=D.CELL_LAND[pos];if(!lid||!game.lands[lid])continue;
      const [c,r]=pos.split(',').map(Number);
      const ch=D.CHAINS[it.k];
      if(!out.coins&&it.t==='chain'&&ch&&ch.type!=='bonus'&&(it.tier===ch.max||(it.tier===ch.max+1&&(it.readyAt||0)<=now)))out.coins={c,r,id:it.id};
      if(!out.energy&&((it.t==='obs'&&/^(tree|rock)_/.test(it.k))||it.k==='toolbox'))out.energy={c,r,id:it.id};
    }
    return out;
  }
  function directory(uid,nickname,state,now=Date.now()){
    const t=targets(state,now),g=unpack(state);
    return {uid,nickname,level:g.level,coinsAvailable:!!t.coins,energyAvailable:!!t.energy};
  }
  function edit(saved,baseVersion,id,fn){
    const previous=rules.snapshotResult(saved||{});
    if(!previous.ok||!previous.stateJson)throw error('ranch-invalid-state','保存済みの牧場データを読み込めませんでした。');
    if(previous.version!==baseVersion)throw error('ranch-conflict','別の端末で牧場が更新されました。保存済みの進捗を読み直してください。');
    const snapshot=JSON.parse(previous.stateJson),game=JSON.parse(snapshot.gameJson);fn(game);
    snapshot.gameJson=JSON.stringify(game);
    const stateJson=rules.normalizeSnapshot(JSON.stringify(snapshot));
    if(!stateJson)throw error('ranch-invalid-state','牧場の保存データを確認できませんでした。');
    return {ok:true,stateJson,version:previous.version+1,saveId:id};
  }
  function depart(saved,payload,route,remote,visitorName,targetName,now){
    if(route&&now-route.departedAt<COOLDOWN)throw error('visit-cooldown','この牧場へは、前の出発から30分後に訪問できます。');
    const available=targets(remote,now),today=day(now),multiplier=route?.day===today?1:2;
    const plan=edit(saved,payload.baseVersion,payload.opId,g=>{
      if(!Number.isInteger(g.flightTickets)||g.flightTickets<1)throw error('visit-no-ticket','飛行機チケットがありません。');
      g.flightTickets--;
    });
    return {...plan,trip:{visitorUid:payload.uid,targetUid:payload.targetUid,visitorName,targetName,day:today,multiplier,
      stateJson:remote,coinsAvailable:!!available.coins,energyAvailable:!!available.energy,claimed:{energy:false,crates:false,coins:false}}};
  }
  function collect(saved,payload,trip){
    const kind=payload.kind;
    if(!Object.hasOwn(REWARDS,kind)||trip.claimed[kind]||!({crates:true,coins:trip.coinsAvailable,energy:trip.energyAvailable})[kind])throw error('visit-unavailable','この報酬は回収できません。');
    const amount=REWARDS[kind]*trip.multiplier;
    const plan=edit(saved,payload.baseVersion,payload.opId,g=>{
      if(kind==='energy'&&g.energy>=50)throw error('visit-energy-full','スタミナが50以上のため回収できません。');
      g[kind]+=amount;
    });
    return {...plan,kind,amount};
  }
  function receive(saved,payload,receipts){
    if(!receipts.length||receipts.some(x=>x.claimed))throw error('visit-receipt-claimed','この訪問報酬は回収済みです。');
    return edit(saved,payload.baseVersion,payload.opId,g=>{for(const r of receipts)g[r.kind]+=r.amount;});
  }
  return {COOLDOWN,REWARDS,day,targets,directory,edit,depart,collect,receive,unpack,error};
});
