(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.kayoWeeklyRace=api;})(typeof globalThis!=='undefined'?globalThis:this,()=>{
 'use strict';
 const DAY=86400000,JST=9*3600000;
 const DEADLINE_NOTE='日曜日を過ぎると報酬は受け取れません';
 const PRIZES=Object.freeze([{crates:300,gems:600,energy:300},{crates:150,gems:300,energy:150},{crates:100,gems:100,energy:100}]);
 const PARTICIPATION=Object.freeze({crates:30,gems:20,energy:20});
 function period(now=Date.now()){
  const local=new Date(now+JST),day=local.getUTCDay(),midnight=Math.floor((now+JST)/DAY)*DAY-JST;
  const start=midnight-((day+1)%7)*DAY,resultsAt=start+DAY,expiresAt=start+DAY*2;
  return {raceId:new Date(start+JST).toISOString().slice(0,10),start,resultsAt,expiresAt,phase:day===6?'entry':day===0?'results':'closed'};
 }
 function prize(rank){if(!Number.isSafeInteger(rank)||rank<1)throw Error('順位を確認できませんでした。');return {...(PRIZES[rank-1]||PARTICIPATION)};}
 function notice(status,now=Date.now()){
  const p=period(now);if(!status?.eligible||status.raceId!==p.raceId||p.phase==='closed')return {show:false,attention:false};
  const phase=p.phase,entered=status.entered===true,claimed=status.claimed===true;
  return {show:true,phase,attention:phase==='entry'?!entered:entered&&!claimed,
   label:phase==='entry'?'ころころレースエントリー':'ころころレース結果',
   deadline:phase==='entry'?p.resultsAt:p.expiresAt,entered,claimed};
 }
 function remaining(deadline,now=Date.now()){
  const seconds=Math.max(0,Math.ceil((deadline-now)/1000)),h=Math.floor(seconds/3600),m=Math.floor(seconds%3600/60),s=seconds%60;
  return `あと${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
 }
 function podiumEnd(replay){const count=Math.min(3,replay.participants.length);return count?Math.min(replay.duration,Math.ceil(replay.finish[count-1].time*replay.fps)/replay.fps):0;}
 return {DAY,JST,DEADLINE_NOTE,PRIZES,PARTICIPATION,period,prize,notice,remaining,podiumEnd};
});
