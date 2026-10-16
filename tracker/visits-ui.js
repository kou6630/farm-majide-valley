(function(root){
  const $=id=>document.getElementById(id),V=root.kayoRanchVisits;
  const images={energy:'assets/ref/tactical_bolt.png',crates:'assets/ref/items/woodbox_0.png',coins:'assets/ref/tactical_coin.png'};
  const labels={energy:'スタミナ',crates:'箱',coins:'コイン'};
  const imageUrl=url=>root.ranchDeviceProfile?root.ranchDeviceProfile.image(url).url:url;
  const uuid=prefix=>prefix+crypto.randomUUID().replaceAll('-','');
  function create({uid,engine,view,service,operate,home,away}){
    const key='buriburi_ranch_active_trip_v1:'+uid;
    let trip=null,busy=false,rows=[],cursor=null,noticeQueue=[],ticker=null,rowButtons=[],inboxMore=false;
    const icon=(kind,n)=>{const el=document.createElement('span'),im=document.createElement('img');im.src=imageUrl(images[kind]);im.alt=labels[kind];el.append(im,document.createTextNode(String(n)));return el;};
    function controlBusy(value){busy=value;$('travel-picker').querySelectorAll('button').forEach(b=>b.disabled=value);$('visit-gift-collect').disabled=value;$('visit-home').disabled=value;}
    async function act(fn){if(busy)return;controlBusy(true);try{return await fn();}catch(e){view.toast(e.message||'通信を確認してください。');}finally{controlBusy(false);renderRows();}}
    function enter(next){
      trip=next;away();localStorage.setItem(key,trip.id);
      const remote=root.FMV.createEngine();if(!remote.load(JSON.parse(trip.stateJson).gameJson))throw Error('訪問先の牧場を読み込めませんでした。');
      view.showVisit(remote,trip);$('ranch-play').classList.add('visiting');$('visit-bar').hidden=false;
      $('visit-name').textContent=trip.targetName+'の牧場';updateTrip();
    }
    function updateTrip(){
      $('visit-rewards').replaceChildren();
      for(const kind of ['energy','crates','coins'])if(kind==='crates'||trip[kind+'Available']){
        const el=icon(kind,V.REWARDS[kind]*trip.multiplier);if(trip.claimed[kind])el.classList.add('visit-taken');
        const button=document.createElement('button');button.type='button';button.setAttribute('aria-label',labels[kind]+'の場所を表示');button.append(el);button.onclick=()=>view.focusVisitReward(kind);$('visit-rewards').append(button);
      }
      $('visit-bonus').hidden=trip.multiplier!==2;view.updateVisit(trip);
    }
    function renderRows(){
      if(!$('travel-picker').open)return;
      const box=$('travel-people'),scroll=box.scrollTop;box.replaceChildren();rowButtons=[];
      for(const person of rows){
        const row=document.createElement('article');row.className='travel-person';
        const title=document.createElement('h3');title.textContent=person.nickname;
        const level=document.createElement('p');level.textContent='レベル '+person.level;
        const rewards=document.createElement('div');rewards.className='travel-reward-list';
        const twice=!person.route||person.route.day!==V.day(Date.now());
        for(const kind of ['energy','crates','coins'])if(kind==='crates'||person[kind+'Available'])rewards.append(icon(kind,V.REWARDS[kind]*(twice?2:1)));
        row.append(title,level,rewards);
        if(twice){const badge=document.createElement('img');badge.className='travel-bonus';badge.src=imageUrl('assets/visits/bonus.png');badge.alt='当日初回 ×2';row.append(badge);}
        const left=Math.max(0,(person.route?.departedAt?.toMillis()||0)+V.COOLDOWN-Date.now());
        const go=document.createElement('button');go.type='button';go.disabled=busy||left>0||engine.state.flightTickets<1;
        go.textContent=left?'あと'+Math.ceil(left/60000)+'分':'出発する';
        rowButtons.push({go,person});
        go.onclick=()=>act(async()=>{const result=await operate('depart',{opId:uuid('ranchtrip_'),targetUid:person.uid});$('travel-picker').close();enter(result.trip);});
        row.append(go);box.append(row);
      }
      box.scrollTop=scroll;$('travel-more').hidden=!cursor;$('travel-more').disabled=busy;
      $('travel-count').textContent='チケット '+(engine.state.flightTickets||0)+' / 3';
      $('travel-empty').hidden=rows.length>0;
    }
    async function picker(){
      if(!engine.state.flightTickets){view.toast('箱から飛行機チケットを見つけて、タップで回収しよう');return;}
      $('travel-picker').showModal();rows=[];cursor=null;$('travel-empty').hidden=false;$('travel-empty').textContent='訪問先を読み込み中…';
      await act(async()=>{const page=await service.list(uid);rows=page.rows;cursor=page.cursor;$('travel-empty').textContent='訪問できる牧場はまだありません';});
      renderRows();
    }
    async function airport(kind){
      if(busy)return;
      if(!trip){if(kind==='ticket'||kind===null)await picker();return;}
      if(!kind){view.focusAirport();return;}
      if(kind==='energy'&&engine.state.energy>=50){view.toast('スタミナが50以上のため回収できません');return;}
      const origin=view.visitRewardOrigin(kind);
      await act(async()=>{const result=await operate('collect',{opId:trip.id+'_'+kind,tripId:trip.id,kind});trip=result.trip;view.playVisitCollection(kind,V.REWARDS[kind]*trip.multiplier,origin);updateTrip();view.toast(labels[kind]+'を'+V.REWARDS[kind]*trip.multiplier+'回収しました');});
    }
    function showGift(){
      if(!noticeQueue.length){$('visit-gift').close();return;}
      const group=noticeQueue[0];$('visit-gift-title').textContent=group[0].visitorName+'が遊びにきたよ！';
      $('visit-gift-items').replaceChildren(...group.map(r=>icon(r.kind,r.amount)));
      $('visit-gift').showModal();
    }
    async function notices(){
      const pending=await service.inbox(uid),groups=new Map();inboxMore=pending.length>=60;
      pending.sort((a,b)=>(a.createdAt?.toMillis()||0)-(b.createdAt?.toMillis()||0));
      for(const item of pending){if(!groups.has(item.tripId))groups.set(item.tripId,[]);groups.get(item.tripId).push(item);}
      noticeQueue=[...groups.values()];showGift();
    }
    $('travel-close').onclick=()=>{if(!busy)$('travel-picker').close();};
    $('travel-picker').addEventListener('cancel',e=>{if(busy)e.preventDefault();});
    $('travel-more').onclick=()=>act(async()=>{if(!cursor)return;const page=await service.list(uid,cursor);rows.push(...page.rows);cursor=page.cursor;});
    $('airport-focus').onclick=()=>view.focusAirport();
    $('visit-home').onclick=()=>{if(busy)return;trip=null;localStorage.removeItem(key);view.showHome();home();$('ranch-play').classList.remove('visiting');$('visit-bar').hidden=true;};
    $('visit-gift-collect').onclick=()=>act(async()=>{
      const group=noticeQueue[0];if(!group)return;
      await operate('receive',{opId:uuid('ranchgift_'),ids:group.map(r=>r.id)});
      noticeQueue.shift();if(!noticeQueue.length&&inboxMore)await notices();else showGift();
    });
    $('visit-gift-later').onclick=()=>{if(!busy)$('visit-gift').close();};
    $('visit-gift').addEventListener('cancel',e=>{if(busy)e.preventDefault();});
    async function init(){
      try{await service.publish(uid);}catch(e){view.toast('訪問先一覧への登録を更新できませんでした。');}
      const id=localStorage.getItem(key);
      if(id){const previous=await service.resume(uid,id);if(previous)enter(previous);else localStorage.removeItem(key);}
      if(!trip)await notices();
      // カウントダウンだけ更新し、スクロール位置や選択中のボタンを作り直さない。
      ticker=setInterval(()=>{for(const {go,person} of rowButtons){const left=Math.max(0,(person.route?.departedAt?.toMillis()||0)+V.COOLDOWN-Date.now());go.disabled=busy||left>0||engine.state.flightTickets<1;go.textContent=left?'あと'+Math.ceil(left/60000)+'分':'出発する';}},15000);
      root.addEventListener('pagehide',()=>clearInterval(ticker),{once:true});
    }
    return {init,airport};
  }
  root.kayoRanchVisitsUI={create};
})(window);
