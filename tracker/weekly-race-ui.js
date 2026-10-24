(function(root){
 const $=id=>document.getElementById(id),W=root.kayoWeeklyRace;
 const rewards=[['crates','箱','assets/ref/items/woodbox_0.png'],['gems','ジェム','assets/ref/tactical_gem.png'],['energy','スタミナ','assets/ref/tactical_bolt.png']];
 function create({uid,view,service,operate,canOpen=()=>true,isCurrent=()=>true}){
  let state={eligible:true,...W.period()},offset=0,busy=false,flight=null,lastFetch=0,lastPhase='',result=null,seen=false,iframe=null,filmTimer=null,stopped=false,dialogMode='race';
  const now=()=>Date.now()+offset,dialog=$('weekly-race-dialog');
  const lucky=()=>root.FMV.luckyEventAt(now());
  function paintLuckyDialog(){
   const event=lucky();
   dialog.dataset.event='lucky';
   $('weekly-race-eyebrow').hidden=true;
   $('weekly-race-title').textContent=event.active?'ラッキー発生率2倍':'ラッキー発生率2倍は終了しました';
   $('weekly-race-copy').textContent='';$('weekly-race-copy').hidden=true;
   $('weekly-race-deadline').textContent='月曜日\n9:00〜9:30\n19:00〜19:30\n23:30〜23:59';
   $('weekly-race-dialog-time').hidden=true;
   $('weekly-race-action').hidden=true;
   $('weekly-race-rewatch').hidden=true;
  }
  function paint(){
   if(!isCurrent()||stopped)return;
   const n=W.notice(state,now()),period=W.period(now()),event=lucky(),tool=$('weekly-race-tool');
   tool.hidden=period.phase==='closed'&&!event.active;tool.dataset.event=event.active?'lucky':'race';
   $('weekly-lucky-icon').hidden=!event.active;$('weekly-race-marbles').hidden=event.active;
   if(event.active){
    $('weekly-race-label').textContent='ラッキー発生率\n2倍';$('weekly-race-attention').hidden=true;
    $('weekly-race-time').textContent=W.remaining(event.endsAt,now());
   }else if(period.phase!=='closed'){
    $('weekly-race-label').textContent=period.phase==='entry'?'ころころレース\nエントリー':'ころころレース\n結果';
    $('weekly-race-attention').hidden=!n.attention;$('weekly-race-time').textContent=W.remaining(period.phase==='entry'?period.resultsAt:period.expiresAt,now());
   }
   if(dialog.open&&!iframe){if(dialogMode==='lucky')paintLuckyDialog();else{$('weekly-race-deadline').textContent=W.DEADLINE_NOTE;$('weekly-race-dialog-time').textContent=period.phase==='closed'?'受取期限が終了しました':W.remaining(period.phase==='entry'?period.resultsAt:period.expiresAt,now());if(period.phase==='closed'){$('weekly-race-action').disabled=true;$('weekly-race-action').textContent='受取期限が終了しました';}}}
   const phase=period.raceId+period.phase;if(lastPhase&&lastPhase!==phase){result=null;seen=false;if(period.phase!=='closed')void refresh(true).then(()=>{if(dialog.open&&!iframe)show();}).catch(()=>{});}lastPhase=phase;
  }
  async function refresh(force=false){
   if(!isCurrent()||stopped)return;if(flight)return flight;if(!force&&Date.now()-lastFetch<60000)return;
   flight=(async()=>{const next=await service.status();if(!isCurrent()||stopped)return;state=next;offset=next.serverNow-Date.now();lastFetch=Date.now();paint();})().finally(()=>flight=null);return flight;
  }
  function icon(key,label,url,amount){const el=document.createElement('span'),im=document.createElement('img');im.src=root.ranchDeviceProfile?.image(url).url||url;im.alt=label;el.append(im,document.createTextNode('×'+amount));return el;}
  function clearFilm(){clearTimeout(filmTimer);filmTimer=null;iframe?.remove();iframe=null;dialog.dataset.playing='false';dialog.classList.remove('race-film');$('weekly-race-panel').hidden=false;$('weekly-race-close').hidden=false;}
  function showResults(){
   clearFilm();const records=result.record.records,own=records.find(p=>p.id===uid);if(!own)throw Error('自分の結果を確認できませんでした。');
   $('weekly-race-title').textContent=own.rank+'位おめでとう！';$('weekly-race-copy').textContent=own.rank<=3?'順位賞を獲得しました！':'参加賞を獲得しました！';
   $('weekly-race-rewards').replaceChildren(...rewards.map(([key,label,url])=>icon(key,label,url,W.prize(own.rank)[key])));
   const list=$('weekly-race-ranks');list.replaceChildren();
   for(const p of [...records].sort((a,b)=>a.rank-b.rank)){const row=document.createElement('li'),rank=document.createElement('b'),dot=document.createElement('span'),name=document.createElement('span');rank.textContent=p.rank+'位';dot.className='race-marble';dot.style.setProperty('--marble',p.color);name.textContent=p.name;row.append(rank,dot,name);row.classList.toggle('race-self',p.id===uid);list.append(row);}
   $('weekly-race-action').hidden=false;$('weekly-race-action').textContent=state.claimed?'受取済み':'報酬を受け取る';$('weekly-race-action').disabled=busy||state.claimed||W.period(now()).phase!=='results';
   $('weekly-race-action').onclick=()=>act(async()=>{await operate({raceId:result.raceId});state.claimed=true;await refresh(true);showResults();view.toast('レースの報酬を受け取りました');});paint();
   const rewatch=$('weekly-race-rewatch');rewatch.hidden=false;rewatch.disabled=busy||W.period(now()).phase!=='results';
   rewatch.onclick=()=>act(async()=>{play();});
  }
  function play(){
   dialog.classList.add('race-film');dialog.dataset.playing='true';$('weekly-race-panel').hidden=true;$('weekly-race-close').hidden=true;
   iframe=document.createElement('iframe');iframe.title='ころころレースの結果映像';iframe.src='race/?embedded';iframe.setAttribute('allow','');dialog.append(iframe);
   filmTimer=setTimeout(()=>{if(iframe){clearFilm();$('weekly-race-copy').textContent='映像を読み込めませんでした。結果一覧で順位を確認できます。';seen=true;showResults();}},30000);
  }
  async function act(task){if(busy)return;busy=true;$('weekly-race-action').disabled=true;$('weekly-race-error').textContent='';try{await task();}catch(e){if(!isCurrent())return;$('weekly-race-error').textContent=e.message||'通信を確認して、もう一度お試しください。';if(e.code==='race-expired')paint();}finally{busy=false;if(isCurrent()&&!iframe)show();}}
  function show(){
   if(!isCurrent()||stopped)return;
   $('weekly-race-rewatch').hidden=true;
   if(dialogMode==='lucky'){$('weekly-race-rewards').replaceChildren();$('weekly-race-ranks').replaceChildren();paintLuckyDialog();return;}
   dialog.dataset.event='race';
   $('weekly-race-eyebrow').hidden=false;$('weekly-race-copy').hidden=false;$('weekly-race-dialog-time').hidden=false;
   $('weekly-race-eyebrow').textContent='K/AYO RANCH · WEEKEND RACE';
   if(seen&&result){showResults();return;}
   const p=W.period(now());$('weekly-race-rewards').replaceChildren();$('weekly-race-ranks').replaceChildren();$('weekly-race-title').textContent='ころころレース';$('weekly-race-action').hidden=false;$('weekly-race-action').disabled=busy;
   if(p.phase==='entry'){
    $('weekly-race-copy').textContent=state.entered?'エントリー済みです。日曜日に結果を確認して、報酬を受け取ってください。':'完全運まかせの玉転がし！日曜日に結果が発表されます。';
    $('weekly-race-action').textContent=state.entered?'エントリー済み':'エントリーする';$('weekly-race-action').disabled=busy||state.entered;
    $('weekly-race-action').onclick=()=>act(async()=>{await service.enter();await refresh(true);});
   }else if(p.phase==='results'){
    $('weekly-race-copy').textContent=state.entered?(state.ready?'3位が決まるまでの映像のあと、全員の順位と自分の報酬を表示します。':'結果の映像を準備しています。混雑時は公開まで少し時間がかかります。'):'今週はエントリーしていません。次の土曜日にエントリーしてください。';
    $('weekly-race-action').hidden=!state.entered;$('weekly-race-action').textContent='結果を見る';$('weekly-race-action').disabled=busy||!state.ready;
    $('weekly-race-action').onclick=()=>act(async()=>{result=await service.results();if(!isCurrent())return;state.claimed=result.claimed;seen=false;play();});
   }else{$('weekly-race-copy').textContent='今週の受取期限は終了しました。次の土曜日にエントリーしてください。';$('weekly-race-action').hidden=true;}
   paint();
  }
  const receive=event=>{
   if(!iframe||event.source!==iframe.contentWindow||event.origin!==location.origin)return;
   if(event.data?.type==='kayo-race-ready'){clearTimeout(filmTimer);iframe.contentWindow.postMessage({type:'kayo-race-record',record:result.record},location.origin);filmTimer=setTimeout(()=>{if(iframe){seen=true;showResults();}},Math.max(120000,result.record.duration*2000+30000));}
   if(event.data?.type==='kayo-race-finished'||event.data?.type==='kayo-race-unavailable'){seen=true;showResults();}
  };
  const focus=()=>{if(!document.hidden&&isCurrent())void refresh(true).catch(()=>{});};
  root.addEventListener('message',receive);root.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);
  $('weekly-race-button').onclick=async()=>{if(busy||!canOpen())return;dialogMode=lucky().active?'lucky':'race';$('weekly-race-error').textContent='';dialog.showModal();show();if(dialogMode==='lucky')return;try{await refresh(true);show();}catch(e){$('weekly-race-error').textContent=e.message||'通信を確認してください。';}};
  $('weekly-race-close').onclick=()=>{if(!busy)dialog.close();};dialog.addEventListener('cancel',event=>{if(busy||iframe)event.preventDefault();});
  const ticker=setInterval(()=>{paint();if(!document.hidden&&W.period(now()).phase!=='closed'&&Date.now()-lastFetch>300000)void refresh().catch(()=>{});},1000);
  function stop(){stopped=true;clearInterval(ticker);clearFilm();dialog.close();root.removeEventListener('message',receive);root.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus);$('weekly-race-tool').hidden=true;}
  return {init:()=>refresh(true),stop};
 }
 root.kayoWeeklyRaceUI={create};
})(window);
