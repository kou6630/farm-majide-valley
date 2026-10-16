(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.kayoRaceReplay=api;})(typeof globalThis!=='undefined'?globalThis:this,()=>{
 function decode(record){
  const records=record?.records;if(!Array.isArray(records)||!records.length||!record.course||!(record.fps>0)||!Number.isFinite(record.duration))throw Error('レースの記録を読み込めませんでした。');
  const count=records[0].frames;if(!Number.isSafeInteger(count)||count<1||count*records.length*7>32000000)throw Error('レースの記録が大きすぎます。結果一覧を確認してください。');
  const frames=Array.from({length:count},()=>new Array(records.length*7));
  records.forEach((p,i)=>{
   if(p.frames!==count||typeof p.trajectory!=='string')throw Error('レースの記録を確認できませんでした。');
   const bytes=typeof Buffer!=='undefined'?new Uint8Array(Buffer.from(p.trajectory,'base64')):Uint8Array.from(atob(p.trajectory),c=>c.charCodeAt(0));
   if(bytes.length!==count*14)throw Error('レースの記録を確認できませんでした。');const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
   for(let f=0;f<count;f++)for(let c=0;c<7;c++)frames[f][i*7+c]=view.getInt16((f*7+c)*2,true)/(c<3?100:10000);
  });
  return {...record,participants:records.map(({id,name,color,number})=>({id,name,color,number})),finish:records.map(({id,rank,time})=>({id,rank,time})).sort((a,b)=>a.rank-b.rank),frames};
 }
 return {decode};
});
