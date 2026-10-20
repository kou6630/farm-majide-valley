(function(F){
  F.createWednesdayUI=function({canOpen=()=>true}={}){
    const $=id=>document.getElementById(id),dialog=$('wednesday-dialog');let last='';
    function close(){if(dialog.open)dialog.close();}
    function update(){
      const time=Date.now(),event=F.crateEventAt(time),seconds=event.active?Math.max(0,Math.ceil((event.endsAt-time)/1000)):0;
      const key=event.active+':'+seconds;if(key===last)return;last=key;
      $('wednesday-tool').hidden=!event.active;
      $('wednesday-time').textContent=event.active?`残り ${Math.floor(seconds/3600)}:${String(Math.floor(seconds/60)%60).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`:'';
      if(!event.active)close();
    }
    $('wednesday-button').addEventListener('click',()=>{
      update();if(!canOpen()||!F.crateEventAt(Date.now()).active)return;
      dialog.showModal();$('wednesday-close').focus();
    });
    $('wednesday-close').addEventListener('click',close);
    update();return {update,close};
  };
})(window.FMV);
