(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.kayoWeeklyRaceCloud=api;})(typeof globalThis!=='undefined'?globalThis:this,()=>{
 'use strict';
 const fail=(code,message)=>Object.assign(Error(message),{code});
 // Rules enforce Google identity, server time and single-use receipts.
 // Only the private automation identity publishes the draw and trajectories.
 function create(sdk,db,getUid,R,W,{clock=Date.now}={}){
  const uid=()=>{const id=getUid();if(!id)throw fail('unauthenticated','Googleでログインしてください。');return id;};
  const ref=(...parts)=>sdk.doc(db,...parts),profile=id=>ref('googleUsers',id),save=id=>ref('googleRanches',id),race=id=>ref('weeklyRaces',id),entry=(id,user)=>ref('weeklyRaces',id,'entries',user);
  function permit(p){const a=R.access(p);if(!a.ok||p?.kayoRanchUnlocked!==true)throw fail(a.code||'ranch-locked',a.message||'牧場を解放してください。');}
  const data=s=>s.exists()?s.data():null;
  async function status(){const user=uid(),p=W.period(clock());permit(data(await sdk.getDocFromServer(profile(user))));if(p.phase==='closed')return {...p,ok:true,eligible:true,entered:false,claimed:false,serverNow:clock()};const [e,r]=await Promise.all([sdk.getDocFromServer(entry(p.raceId,user)),sdk.getDocFromServer(race(p.raceId))]);return {...p,ok:true,eligible:true,entered:e.exists(),claimed:data(e)?.claimed===true,ready:data(r)?.status==='ready',serverNow:clock()};}
  async function enter(){const user=uid();return sdk.runTransaction(db,async tx=>{
   const p=W.period(clock());if(p.phase!=='entry')throw fail('race-entry-closed','エントリー受付は土曜日だけです。');
   const [u,s,e,r]=await Promise.all([tx.get(profile(user)),tx.get(save(user)),tx.get(entry(p.raceId,user)),tx.get(race(p.raceId))]);permit(data(u));
   if(!s.exists()||!R.snapshotResult(data(s)).stateJson)throw fail('ranch-invalid-state','牧場の保存を完了してからエントリーしてください。');
   if(e.exists())return {ok:true,alreadyApplied:true};if(r.exists()&&data(r).status!=='open')throw fail('race-entry-closed','今週のエントリー受付は終了しました。');
   if(!r.exists())tx.set(race(p.raceId),{status:'open',start:p.start,resultsAt:p.resultsAt,expiresAt:p.expiresAt,createdAt:sdk.serverTimestamp()});
   tx.set(entry(p.raceId,user),{uid:user,name:data(u).nickname,enteredAt:sdk.serverTimestamp(),claimed:false,claimId:''});return {ok:true};
  });}
  async function results(){const user=uid(),p=W.period(clock());if(p.phase!=='results')throw fail('race-expired','結果の公開・報酬受取期間は日曜日だけです。');
   const [e,r]=await Promise.all([sdk.getDocFromServer(entry(p.raceId,user)),sdk.getDocFromServer(race(p.raceId))]);if(!e.exists())throw fail('race-not-entered','今週はエントリーしていません。');
   const meta=data(r);if(meta?.status!=='ready')throw fail('race-preparing','結果の映像を準備しています。少し待ってから開いてください。');
   const page=await sdk.getDocs(sdk.collection(db,'weeklyRaces',p.raceId,'runs',meta.run,'racers'));
   const records=page.docs.map(s=>{const a=s.data();return {id:s.id,name:a.name,color:a.color,number:a.number,rank:a.rank,time:a.time,frames:a.frames,trajectory:a.trajectory.toBase64()};}).sort((a,b)=>a.number-b.number);
   if(records.length!==meta.total)throw fail('race-preparing','結果を確認しています。少し待ってから開いてください。');
   return {ok:true,raceId:p.raceId,uid:user,claimed:data(e).claimed===true,record:{schema:1,fps:meta.fps,duration:meta.duration,countdown:meta.countdown,course:meta.course,records},expiresAt:p.expiresAt,serverNow:clock()};
  }
  async function claim(expectedUid,payload={}){const user=uid();if(expectedUid!==user)throw fail('unauthenticated','ログインしているアカウントを確認してください。');
   if(!/^\d{4}-\d{2}-\d{2}$/.test(payload.raceId||'')||!/^ranchrace_[a-f0-9]{32}$/.test(payload.opId||''))throw fail('race-invalid','報酬の受取内容を確認できませんでした。');
   const id=payload.raceId,receipt=ref('googleRanchRaceClaims',user,'operations',payload.opId);
   async function latestSave(){const value=R.snapshotResult(data(await sdk.getDocFromServer(save(user)))||{});if(!value.ok||!value.stateJson)throw fail('ranch-invalid-state','牧場の保存データを確認できませんでした。');return value;}
   async function confirmed(e){return {...await latestSave(),alreadyApplied:true,rank:e.rank,rewards:e.rewards};}
   const entered=data(await sdk.getDocFromServer(entry(id,user)));if(!entered)throw fail('race-not-entered','今週はエントリーしていません。');
   if(entered.claimed)return confirmed(entered);
   const p=W.period(clock());if(p.phase!=='results'||p.raceId!==id)throw fail('race-expired',W.DEADLINE_NOTE+'。');
   const previous=await latestSave();if(previous.version!==payload.baseVersion)throw fail('ranch-conflict','別の端末で牧場が更新されました。保存済みの進捗を読み直してください。');
   const meta=data(await sdk.getDocFromServer(race(id)));if(meta?.status!=='ready')throw fail('race-preparing','結果を準備しています。少し待ってから開いてください。');
   const result=data(await sdk.getDocFromServer(ref('weeklyRaces',id,'runs',meta.run,'racers',user)));if(!result)throw fail('race-preparing','結果を確認しています。少し待ってから開いてください。');
   const rank=result.rank,rewards=W.prize(rank),snapshot=JSON.parse(previous.stateJson),game=JSON.parse(snapshot.gameJson);for(const [key,amount]of Object.entries(rewards))game[key]+=amount;snapshot.gameJson=JSON.stringify(game);
   const stateJson=R.normalizeSnapshot(JSON.stringify(snapshot)),version=previous.version+1;if(!stateJson)throw fail('ranch-invalid-state','報酬を保存できませんでした。');
   // Atomic optimistic commit: rules require the unchanged base version and an
   // unclaimed entry. A competing save/claim makes all three writes fail together.
   const batch=sdk.writeBatch(db);
   batch.update(save(user),{ranchStateJson:stateJson,ranchStateVersion:version,ranchSaveId:payload.opId,ranchUpdatedAt:sdk.serverTimestamp()});
   batch.update(entry(id,user),{claimed:true,claimId:payload.opId,claimedAt:sdk.serverTimestamp(),rank,rewards,version});
   batch.set(receipt,{raceId:id,claimId:payload.opId,rank,rewards,baseVersion:payload.baseVersion,version,createdAt:sdk.serverTimestamp()});
   try{await batch.commit();}catch(error){const fresh=data(await sdk.getDocFromServer(entry(id,user)));if(fresh?.claimed)return confirmed(fresh);if((await latestSave()).version!==payload.baseVersion)throw fail('ranch-conflict','別の端末で牧場が更新されました。保存済みの進捗を読み直してください。');throw error;}
   return {ok:true,stateJson,version,saveId:payload.opId,rank,rewards,alreadyApplied:false};
  }
  return {status,enter,results,claim};
 }
 return {create};
});
