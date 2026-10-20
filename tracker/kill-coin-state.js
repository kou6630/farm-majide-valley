(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.killCoinState=api;})(typeof globalThis==='undefined'?this:globalThis,function(){
  const DAY_MS=86400000,JST=32400000,MAX=1e12;
  function period(time=Date.now()){
    const day=Math.floor((time+JST)/DAY_MS),active=(day+4)%7===2;
    return {day:String(day),active,endsAt:(day+1)*DAY_MS-JST};
  }
  function dayFromDate(date){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date)))return '';
    const time=Date.parse(date+'T00:00:00+09:00');
    if(!Number.isFinite(time)||new Date(time+JST).toISOString().slice(0,10)!==date)return '';
    const p=period(time);return p.active?p.day:'';
  }
  function awards(raw){
    const out={};if(!raw||typeof raw!=='object'||Array.isArray(raw))return out;
    for(const [day,n]of Object.entries(raw))if(/^\d{1,7}$/.test(day)&&(Number(day)+4)%7===2&&Number.isSafeInteger(n)&&n>=0&&n<=MAX)out[day]=n;
    return out;
  }
  function roll(kp,date,random=Math.random){
    const day=dayFromDate(date),trials=Number.isSafeInteger(kp)&&kp>0?kp:0;let coins=0;
    if(day)for(let i=0;i<trials;i++)if(random()<.5)coins++;
    return {day,trials:day?trials:0,coins};
  }
  return {period,dayFromDate,awards,roll,MAX};
});
