(function(F){
  F.createKillCoinUI=function(engine,{canOpen=()=>true,save=()=>{},deploy=()=>engine.deployKillBox(),toast=()=>{}}={}){
    const $=id=>document.getElementById(id),dialog=$('kill-coin-dialog');let last='';
    function update(){
      const info=engine.killCoinInfo(),seconds=Math.max(0,Math.ceil((info.endsAt-Date.now())/1000));
      const key=[info.active,info.coins,seconds].join(':');if(key===last)return;last=key;
      $('kill-coin-tool').hidden=!info.active;
      $('kill-coin-attention').hidden=!info.coins;
      $('kill-coin-time').textContent=`残り ${Math.floor(seconds/3600)}:${String(Math.floor(seconds/60)%60).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
      $('kill-coin-count').textContent=info.coins.toLocaleString();
      $('kill-coin-deploy').disabled=!info.active||info.coins<1;
      $('kill-coin-ended').hidden=info.active;
    }
    function close(){dialog.close();}
    $('kill-coin-button').addEventListener('click',()=>{if(!canOpen()||!engine.killCoinInfo().active)return;update();$('kill-coin-message').textContent='';dialog.showModal();$('kill-coin-close').focus();});
    $('kill-coin-close').addEventListener('click',close);
    $('kill-coin-deploy').addEventListener('click',()=>{
      if(!dialog.open||!canOpen())return;
      const result=deploy();update();
      if(!result.ok){$('kill-coin-message').textContent=result.reason==='full'?'空きマスがありません。':result.reason==='empty'?'コインがありません。':'イベントは終了しました。';return;}
      save();close();toast(`銅コイン ${result.coins}枚入りのKILL箱を置きました`);
    });
    update();return {update,close};
  };
})(window.FMV);
