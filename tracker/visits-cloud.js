(function(root){
  function create(sdk,db,rules,V){
    const ref=(...p)=>sdk.doc(db,...p),saveRef=uid=>ref('googleRanches',uid),dirRef=uid=>ref('googleRanchDirectory',uid);
    const tripRef=(uid,id)=>ref('googleRanchTrips',uid,'visits',id),routeRef=(uid,target)=>ref('googleRanchRoutes',uid,'targets',target);
    const inboxRef=(uid,id)=>ref('googleRanchInbox',uid,'rewards',id);
    function permit(profile){const a=rules.access(profile);if(!a.ok||profile.kayoRanchUnlocked!==true)throw V.error(a.code||'ranch-locked',a.message||'牧場はまだ解放されていません。');}
    async function checked(tx,uid){const p=await tx.get(ref('googleUsers',uid));permit(p.exists()?p.data():null);return p.data();}
    function writeSave(tx,uid,plan){tx.set(saveRef(uid),{ranchStateJson:plan.stateJson,ranchStateVersion:plan.version,ranchSaveId:plan.saveId,ranchUpdatedAt:sdk.serverTimestamp()});}
    async function publish(uid){
      return sdk.runTransaction(db,async tx=>{const profile=await checked(tx,uid),s=await tx.get(saveRef(uid));if(!s.exists())return;
        tx.set(dirRef(uid),{...V.directory(uid,profile.nickname,s.data().ranchStateJson),updatedAt:sdk.serverTimestamp()});});
    }
    async function list(uid,cursor=null){
      const constraints=[sdk.orderBy(sdk.documentId()),sdk.limit(30)];if(cursor)constraints.push(sdk.startAfter(cursor));
      const page=await sdk.getDocs(sdk.query(sdk.collection(db,'googleRanchDirectory'),...constraints));
      const routes=await sdk.getDocs(sdk.collection(db,'googleRanchRoutes',uid,'targets'));
      const history=new Map(routes.docs.map(d=>[d.id,d.data()]));
      return {rows:page.docs.filter(d=>d.id!==uid).map(d=>({...d.data(),route:history.get(d.id)||null})),cursor:page.docs.length===30?page.docs.at(-1).id:null};
    }
    async function depart(uid,payload){
      if(!/^ranchtrip_[a-f0-9]{32}$/.test(payload.opId)||!payload.targetUid||uid===payload.targetUid)throw V.error('visit-invalid','訪問先を確認できませんでした。');
      return sdk.runTransaction(db,async tx=>{
        const profile=await checked(tx,uid),saved=await tx.get(saveRef(uid)),existing=await tx.get(tripRef(uid,payload.opId));
        if(existing.exists()){
          if(existing.data().targetUid!==payload.targetUid)throw V.error('visit-invalid','訪問先を確認できませんでした。');
          return {...rules.snapshotResult(saved.data()),trip:{...existing.data(),id:payload.opId},alreadyApplied:true};
        }
        const targetDoc=await tx.get(ref('googleUsers',payload.targetUid));
        const target=targetDoc.exists()?targetDoc.data():null;
        try{permit(target);}catch{throw V.error('visit-unavailable','この人の牧場には現在訪問できません。');}
        const remote=await tx.get(saveRef(payload.targetUid)),route=await tx.get(routeRef(uid,payload.targetUid));
        if(!remote.exists())throw V.error('visit-unavailable','この人はまだ牧場をプレイしていません。');
        const routeData=route.exists()?route.data():null,now=Date.now();
        const plan=V.depart(saved.data(),{...payload,uid},routeData?{...routeData,departedAt:routeData.departedAt.toMillis()}:null,remote.data().ranchStateJson,profile.nickname,target.nickname,now);
        const trip={...plan.trip,createdAt:sdk.serverTimestamp()};
        writeSave(tx,uid,plan);tx.set(tripRef(uid,payload.opId),trip);
        tx.set(routeRef(uid,payload.targetUid),{day:plan.trip.day,departedAt:sdk.serverTimestamp(),tripId:payload.opId});
        return {...plan,trip:{...plan.trip,id:payload.opId}};
      });
    }
    async function collect(uid,payload){
      if(payload.opId!==`${payload.tripId}_${payload.kind}`||!Object.hasOwn(V.REWARDS,payload.kind))throw V.error('visit-invalid','回収内容を確認できませんでした。');
      return sdk.runTransaction(db,async tx=>{
        await checked(tx,uid);const saved=await tx.get(saveRef(uid)),tr=await tx.get(tripRef(uid,payload.tripId));
        if(!tr.exists())throw V.error('visit-invalid','訪問データを確認できませんでした。');
        const trip=tr.data(),receiptRef=inboxRef(trip.targetUid,payload.opId),receipt=await tx.get(receiptRef);
        if(receipt.exists()&&trip.claimed[payload.kind])return {...rules.snapshotResult(saved.data()),trip:{...trip,id:payload.tripId},alreadyApplied:true};
        const plan=V.collect(saved.data(),payload,trip),next={...trip,claimed:{...trip.claimed,[payload.kind]:true}};
        writeSave(tx,uid,plan);tx.set(tripRef(uid,payload.tripId),next);
        tx.set(receiptRef,{visitorUid:uid,visitorName:trip.visitorName,tripId:payload.tripId,kind:payload.kind,amount:plan.amount,createdAt:sdk.serverTimestamp(),claimed:false,claimId:''});
        return {...plan,trip:{...next,id:payload.tripId}};
      });
    }
    async function resume(uid,id){const doc=await sdk.getDocFromServer(tripRef(uid,id));return doc.exists()?{...doc.data(),id}:null;}
    async function inbox(uid){const page=await sdk.getDocs(sdk.query(sdk.collection(db,'googleRanchInbox',uid,'rewards'),sdk.where('claimed','==',false),sdk.limit(60)));return page.docs.map(d=>({id:d.id,...d.data()}));}
    async function receive(uid,payload){
      if(!/^ranchgift_[a-f0-9]{32}$/.test(payload.opId)||!Array.isArray(payload.ids)||!payload.ids.length||payload.ids.length>3)throw V.error('visit-invalid','訪問報酬を確認できませんでした。');
      return sdk.runTransaction(db,async tx=>{
        await checked(tx,uid);const saved=await tx.get(saveRef(uid)),docs=[];
        for(const id of payload.ids)docs.push(await tx.get(inboxRef(uid,id)));
        if(docs.some(d=>!d.exists()))throw V.error('visit-invalid','訪問報酬を確認できませんでした。');
        const receipts=docs.map(d=>d.data());
        if(receipts.every(r=>r.claimed&&r.claimId===payload.opId))return {...rules.snapshotResult(saved.data()),alreadyApplied:true};
        if(new Set(payload.ids).size!==payload.ids.length||new Set(receipts.map(r=>r.tripId)).size!==1)throw V.error('visit-invalid','訪問報酬を確認できませんでした。');
        const plan=V.receive(saved.data(),payload,receipts);writeSave(tx,uid,plan);
        payload.ids.forEach((id,i)=>tx.set(inboxRef(uid,id),{...receipts[i],claimed:true,claimId:payload.opId,claimedAt:sdk.serverTimestamp()}));
        return plan;
      });
    }
    return {publish,list,depart,collect,resume,inbox,receive};
  }
  root.kayoRanchVisitsCloud={create};
  if(typeof module==='object'&&module.exports)module.exports={create};
})(typeof window!=='undefined'?window:globalThis);
