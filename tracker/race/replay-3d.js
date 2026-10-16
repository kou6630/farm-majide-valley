import * as THREE from './vendor/three.module.js';

const $=id=>document.getElementById(id),stage=$('stage'),canvas=$('race');
const embedded=new URLSearchParams(location.search).has('embedded')&&window.parent!==window;
if(embedded){document.title='ころころレース結果';document.querySelector('.film-brand small').textContent='WEEKEND RACE';}
let filmEnd=0,instanced=null;
const phone=matchMedia('(pointer:coarse)').matches||innerWidth<720;
let renderer,data,scene,camera,balls=[],rotors=[],rows=[],running=false,time=0,lastStamp=0,lastRank=-1,ended=false;
let activeCut=-1,cutElapsed=0,lastFocus=new THREE.Vector3(0,17,3),cameraTarget=new THREE.Vector3();
const v=new THREE.Vector3(),q=new THREE.Quaternion(),qa=new THREE.Quaternion(),qb=new THREE.Quaternion(),yAxis=new THREE.Vector3(0,1,0);
const materials={};
function material(color,extra={}){return new THREE.MeshStandardMaterial({color,roughness:.6,...extra});}
function mesh(geometry,mat,parent=scene){const m=new THREE.Mesh(geometry,mat);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
const boxGeo=new THREE.BoxGeometry(1,1,1);
function box(p,size,mat,rotation,parent=scene){const m=mesh(boxGeo,mat,parent);m.position.fromArray(p);m.scale.fromArray(size);if(rotation)m.quaternion.fromArray(rotation);return m;}
function rod(a,b,r,mat,parent=scene){const av=new THREE.Vector3(...a),bv=new THREE.Vector3(...b),delta=bv.clone().sub(av);const m=mesh(new THREE.CylinderGeometry(r,r,delta.length(),10),mat,parent);m.position.copy(av.add(bv).multiplyScalar(.5));m.quaternion.setFromUnitVectors(yAxis,delta.normalize());return m;}
function woodTexture(){const c=document.createElement('canvas');c.width=256;c.height=512;const g=c.getContext('2d');g.fillStyle='#ba8751';g.fillRect(0,0,256,512);let s=31;const rand=()=>{s=(s*16807)%2147483647;return s/2147483647;};for(let x=0;x<256;x+=2){g.strokeStyle=`rgba(91,55,29,${.03+rand()*.13})`;g.lineWidth=.4+rand();g.beginPath();for(let y=0;y<520;y+=8){const px=x+Math.sin(y*.018+x)*1.5;if(y===0)g.moveTo(px,y);else g.lineTo(px,y);}g.stroke();}for(let x=0;x<=256;x+=64){g.fillStyle='#79593855';g.fillRect(x,0,1,512);}const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;return t;}
function deckPoint(d,x,h,s){const a=Math.atan(d.slope);return[x,d.y+h*Math.cos(a)-s*Math.sin(a),d.z+h*Math.sin(a)+s*Math.cos(a)];}
function createCourse(c){
 materials.wood=material('#efd7a7',{map:woodTexture(),roughness:.8});materials.edge=material('#344b4b',{roughness:.48});materials.brass=material('#e3b362',{metalness:.58,roughness:.3});materials.mint=material('#71b6a1',{metalness:.25,roughness:.3,side:THREE.DoubleSide});materials.glass=material('#d7f8ea',{transparent:true,opacity:.085,depthWrite:false,roughness:.1,side:THREE.DoubleSide});materials.red=material('#e58c73');materials.cream=material('#f4e9cf');
 for(const s of c.shapes){
  if(s.kind==='rail'){
   // Clear safety walls keep the marbles visible from a low camera.
   const m=box(s.p,s.size,materials.glass,s.q);m.castShadow=false;
   const normal=new THREE.Vector3(0,1,0).applyQuaternion(new THREE.Quaternion(...s.q));
   for(const offset of [-s.size[1]/2+.13,s.size[1]/2]){const p=new THREE.Vector3(...s.p).addScaledVector(normal,offset);box(p.toArray(),[s.size[0],.12,s.size[2]],offset<0?materials.edge:materials.brass,s.q);}
  }else if(s.kind==='glass'){
   const m=box(s.p,s.size,materials.glass,s.q);m.castShadow=false;
  }else box(s.p,s.size,s.kind==='bumper'?materials.red:materials.wood,s.q);
 }
 for(const d of c.decks){
  const slopeQ=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),Math.atan(d.slope)).toArray();
  // Inlaid lane markers and sturdy legs make each tier read as a real object.
  for(let s=2;s<d.length;s+=3){for(const x of [-d.width/2+.3,d.width/2-.3])box(deckPoint(d,x,.015,s),[.07,.025,1],materials.brass,slopeQ);}
  for(const s of [2,d.length-2])for(const x of [-d.width/2+.5,d.width/2-.5]){const p=deckPoint(d,x,-.5,s);box([x,p[1]/2-.3,p[2]],[.5,Math.max(.5,p[1]),.5],materials.edge);box([x,.05,p[2]],[1,.15,1],materials.brass);}
  for(let s=1;s<d.length;s+=5)for(const x of [-d.width/2-.2,d.width/2+.2]){
   rod(deckPoint(d,x,.1,s),deckPoint(d,x,3.25,s),.045,materials.brass);
  }
 }
 for(const pin of c.pins){const m=mesh(new THREE.CylinderGeometry(pin.radius,pin.radius,.95,12),materials.brass);m.position.fromArray(pin.p);m.quaternion.fromArray(pin.q);const cap=mesh(new THREE.SphereGeometry(pin.radius,12,8),materials.mint);cap.position.copy(m.position).add(new THREE.Vector3(0,.48,0).applyQuaternion(m.quaternion));}
 const f=c.funnel,segments=80,verts=[],uvs=[],indices=[];
 for(const [r,y]of [[f.hole,f.bottomY],[f.radius,f.topY]])for(let i=0;i<=segments;i++){const a=i/segments*Math.PI*2;verts.push(Math.cos(a)*r,y,Math.sin(a)*r+f.z);uvs.push(i/segments,r===f.hole?0:1);}
 for(let i=0;i<segments;i++){const a=i,b=i+1,c=i+segments+1,d=c+1;indices.push(a,b,c,b,d,c);}
 const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geo.setIndex(indices);geo.computeVertexNormals();mesh(geo,materials.mint);
 for(const [r,y]of [[f.radius,f.topY],[f.hole,f.bottomY]]){const m=mesh(new THREE.TorusGeometry(r,.09,8,80),materials.brass);m.rotation.x=Math.PI/2;m.position.set(0,y,f.z);}
 // Painted radial stripes highlight the bowl's depth without hiding the marbles.
 for(let i=0;i<12;i++){const a=i/12*Math.PI*2;rod([Math.cos(a)*1.05,10.32,25.8+Math.sin(a)*1.05],[Math.cos(a)*7.3,13.85,25.8+Math.sin(a)*7.3],.025,materials.cream);}
 for(const def of c.rotors){
  const root=new THREE.Group();root.position.fromArray(def.p);scene.add(root);
  box([0,0,0],[def.length,.56,.34],materials.red,null,root);
  for(const x of [-def.length/2+.16,def.length/2-.16])box([x,0,0],[.22,.6,.4],materials.brass,null,root);
  const hub=mesh(new THREE.CylinderGeometry(.36,.4,.9,16),materials.brass,root);hub.position.y=.25;
  const cap=mesh(new THREE.SphereGeometry(.25,14,10),materials.cream,root);cap.position.y=.75;
  rotors.push({root,def});
 }
 // Starting gate, finish arch and chequerboard strip.
 const start=c.decks[0];for(const x of [-5.5,5.5])rod([x,17.9,1],[x,21,1],.13,materials.brass);
 box([0,21,1],[11.3,.8,.45],materials.edge);sign('START',[0,21,1.27],3.2,.65);
 const finishY=1.5;for(const x of [-8.4,8.4]){rod([x,0,70.6],[x,6,70.6],.16,materials.brass);box([x,3,70.6],[.45,5.8,.45],materials.edge);}
 box([0,6,70.6],[17.4,1.1,.5],materials.edge);sign('FINISH',[0,6,70.9],5,.85);
 for(let x=-8;x<8;x++)for(let s=0;s<2;s++)box(deckPoint(c.decks[2],x+.5,.024,20.2+s*.45),[1,.035,.45],(x+s)%2?materials.edge:materials.cream,new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),Math.atan(.11)).toArray());
}
function sign(text,p,w,h){const c=document.createElement('canvas');c.width=512;c.height=96;const g=c.getContext('2d');g.clearRect(0,0,512,96);g.fillStyle='#f4dcaa';g.font='600 60px sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillText(text,256,50);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;const m=mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({map:t,transparent:true,side:THREE.DoubleSide}));m.position.fromArray(p);return m;}
function environment(){
 scene.background=new THREE.Color('#9bb8b0');scene.fog=new THREE.Fog('#9bb8b0',65,155);
 mesh(new THREE.PlaneGeometry(300,300),material('#698d78')).rotation.x=-Math.PI/2;scene.children.at(-1).position.set(0,-.9,35);
 const trunkMat=material('#6b5940'),leafMats=['#b0b978','#6b9a7c','#d5ac67'].map(c=>material(c));
 for(let i=0;i<45;i++){const side=i%2?1:-1,x=side*(17+(i*13%27)),z=-15+(i*19%118),scale=.75+(i%4)*.18;const trunk=mesh(new THREE.CylinderGeometry(.2,.32,3*scale,7),trunkMat);trunk.position.set(x,.4,z);for(let j=0;j<2;j++){const m=mesh(new THREE.IcosahedronGeometry((1.9-j*.3)*scale,0),leafMats[i%3]);m.position.set(x,2.8*scale+j,z);}}
 // Barn and stacked hay bales frame the toy course in a quiet farm landscape.
 box([-20,2.1,50],[8,6,12],material('#aa6551'));const roof=mesh(new THREE.CylinderGeometry(0,6.4,3.3,4,1),materials.edge);roof.rotation.y=Math.PI/4;roof.scale.z=1.5;roof.position.set(-20,6.7,50);box([-20,.8,56.05],[3.1,3.5,.15],materials.cream);
 const hay=material('#cbb36c');for(let i=0;i<9;i++){const m=mesh(new THREE.CylinderGeometry(.9,.9,1.7,12),hay);m.rotation.z=Math.PI/2;m.position.set(15+(i%3)*1.8,.2+Math.floor(i/6)*1.8,64+Math.floor(i/3%2)*1.8);}
 // Soft hemispheric fill plus warm afternoon key light.
 scene.add(new THREE.HemisphereLight('#f4f5e9','#687a61',2.5));const sun=new THREE.DirectionalLight('#ffe2b3',3.4);sun.position.set(-24,48,30);sun.castShadow=true;sun.shadow.mapSize.set(phone?1024:2048,phone?1024:2048);Object.assign(sun.shadow.camera,{left:-40,right:40,top:60,bottom:-60,near:1,far:140});sun.target.position.set(0,7,35);scene.add(sun.target);sun.shadow.bias=-.0003;sun.shadow.normalBias=.03;scene.add(sun);
}
function ballTexture(p){const c=document.createElement('canvas');c.width=256;c.height=128;const g=c.getContext('2d');g.fillStyle=p.color;g.fillRect(0,0,256,128);g.fillStyle='#fff3d7';g.fillRect(0,52,256,23);for(const x of [64,192]){g.beginPath();g.arc(x,64,23,0,Math.PI*2);g.fill();g.fillStyle='#253b40';g.textAlign='center';g.textBaseline='middle';g.font='bold 26px sans-serif';g.fillText(p.number,x,65);g.fillStyle='#fff3d7';}const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;}
function progress(p){
 // The funnel can send a marble backwards in Z while still moving downhill.
 // Rank its depth in the bowl, then its distance along the lower tiers.
 if(p.y>14.4&&p.z<24)return p.z;
 if(p.y>=10&&p.z<34)return 23+(13.9-p.y)*2;
 if(p.z<50)return 32+Math.max(0,p.z-25.8);
 return 56.2+p.z-50;
}
function sectionAt(p){if(p.y>14.4&&p.z<24)return 1;if(p.y>=10&&p.z<34)return 2;return p.z<50?3:4;}
function rankAt(t){
 const finished=data.finish.filter(f=>f.time!==null&&f.time<=t),done=new Set(finished.map(f=>f.id));
 const current=data.participants.map((p,i)=>({id:p.id,i,z:progress(balls[i].position)}));
 return [...finished.map(f=>current.find(p=>p.id===f.id)),...current.filter(p=>!done.has(p.id)).sort((a,b)=>b.z-a.z||a.i-b.i)];
}
function updateRank(t,order){
 const unit=Math.max(30,($('rankings').clientHeight-8)/Math.min(12,data.participants.length));$('rankings').style.setProperty('--rank-height',data.participants.length*unit+'px');
 order.forEach((p,rank)=>{const row=rows[p.i];row.style.height=unit+'px';row.style.transform=`translateY(${rank*unit}px)`;row.dataset.rank=rank+1;row.dataset.finished=String(data.finish.some(f=>f.id===p.id&&f.time!==null&&f.time<=t));row.querySelector('.place').textContent=String(rank+1).padStart(2,'0');row.setAttribute('aria-label',`${rank+1}位 ${data.participants[p.i].name}`);});
 $('rankings').dataset.order=order.map(p=>p.id).join(',');
}
function sample(t){const n=data.participants.length,frame=t*data.fps,i=Math.min(data.frames.length-1,Math.floor(frame)),j=Math.min(data.frames.length-1,i+1),a=frame-i;for(let b=0;b<n;b++){const offset=b*7,p=data.frames[i],next=data.frames[j];balls[b].position.set(THREE.MathUtils.lerp(p[offset],next[offset],a),THREE.MathUtils.lerp(p[offset+1],next[offset+1],a),THREE.MathUtils.lerp(p[offset+2],next[offset+2],a));qa.fromArray(p,offset+3);qb.fromArray(next,offset+3);balls[b].quaternion.slerpQuaternions(qa,qb,a);if(instanced){balls[b].updateMatrix();instanced.setMatrixAt(b,balls[b].matrix);}}if(instanced)instanced.instanceMatrix.needsUpdate=true;for(const {root,def}of rotors){root.quaternion.fromArray(def.baseQ).multiply(q.setFromAxisAngle(yAxis,t*def.speed+def.phase));}}
function caption(section){const zone=[['01','THE MARBLE GARDEN','ピンの庭'],['02','THE SPIRAL BOWL','漏斗の渦'],['03','WINDMILL CROSSING','回転する交差点'],['04','THE FINAL RUN','最後の坂道']][section-1];if($('sceneCaption').dataset.zone!==zone[0]){$('sceneCaption').dataset.zone=zone[0];$('sceneCaption').replaceChildren();const num=document.createElement('span');num.textContent=zone[0];const text=document.createElement('div');text.textContent=zone[1];const sub=document.createElement('small');sub.textContent=zone[2];text.append(sub);$('sceneCaption').append(num,text);}}
function cameraWork(t,dt,order){
 const unfinished=order.filter(p=>!data.finish.some(f=>f.id===p.id&&f.time!==null&&f.time<=t));
 const lead=balls[(unfinished[0]||order[0]).i].position;
 const narrow=camera.aspect<.8,range=narrow?1.4:1;
 let pos=new THREE.Vector3(),target=new THREE.Vector3(),cut;
 if(!running){pos.set(38,46,79);target.set(0,9,30);cut=-1;}
 else if(t<3){pos.set(9*range,24,14);target.set(0,18,3);cut=0;}
 else if(t>=filmEnd-2){const leader=balls[order.find(p=>!data.finish.some(f=>f.id===p.id&&f.time!==null&&f.time<=t))?.i??order[0].i].position;pos.copy(leader).add(new THREE.Vector3(-8*range,5,8));target.copy(leader);cut=99;}
 else{
  const section=sectionAt(lead);
  const angle=Math.floor((t-3)/6)%3;cut=section*10+angle;
  // Smooth the observed target, but cut between explicitly authored camera rigs.
  lastFocus.lerp(lead,1-Math.exp(-dt*4));target.copy(lastFocus);
  if(section===2){const theta=.4+(t*.1);pos.set(Math.cos(theta)*15*range,22,25.8+Math.sin(theta)*13);target.set(0,12.2,25.8);}
  else if(section===3&&lead.z<40)pos.copy(target).add(new THREE.Vector3((angle===1?-10:10)*range,5,12*range));
  else if(angle===0)pos.copy(target).add(new THREE.Vector3(9*range,7,10*range));
  else if(angle===1)pos.copy(target).add(new THREE.Vector3(-8*range,4,6*range));
  else pos.copy(target).add(new THREE.Vector3(3*range,10,-8*range));
  target.y+=.25;caption(section);
 }
 if(cut!==activeCut){activeCut=cut;cutElapsed=0;camera.position.copy(pos);cameraTarget.copy(target);}else{cutElapsed+=dt;camera.position.lerp(pos,1-Math.exp(-dt*2.4));cameraTarget.lerp(target,1-Math.exp(-dt*5));}
 camera.lookAt(cameraTarget);stage.dataset.camera=String(cut);
}
function resize(){if(!renderer)return;const width=stage.clientWidth,height=stage.clientHeight;renderer.setSize(width,height,false);renderer.setPixelRatio(Math.min(devicePixelRatio,phone?1.25:1.75));camera.aspect=width/height;camera.fov=camera.aspect<.8?62:48;camera.updateProjectionMatrix();if(data)updateRank(time,rankAt(time));}
function animate(stamp){requestAnimationFrame(animate);if(phone&&stamp-lastStamp<31)return;const dt=lastStamp?Math.min((stamp-lastStamp)/1000,.15):0;lastStamp=stamp;
 if(running&&!ended)time=Math.min(filmEnd,time+dt);
 sample(time);const order=rankAt(time);if(time-lastRank>.12||lastRank<0){updateRank(time,order);lastRank=time;}
 cameraWork(time,dt,order);$('countdown').textContent=running&&time<3?String(Math.max(1,Math.ceil(3-time))):'';
 if(running&&time>=filmEnd&&!ended){ended=true;if(embedded)parent.postMessage({type:'kayo-race-finished'},location.origin);else showPreviewResults();}
 stage.dataset.replayTime=time.toFixed(2);renderer.render(scene,camera);
}
async function boot(){
 try{
  renderer=new THREE.WebGLRenderer({canvas,antialias:!phone,alpha:false,powerPreference:'high-performance'});renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.08;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  if(embedded){data=await new Promise((resolve,reject)=>{const receive=event=>{if(event.source!==parent||event.origin!==location.origin||event.data?.type!=='kayo-race-record')return;removeEventListener('message',receive);try{resolve(window.kayoRaceReplay.decode(event.data.record));}catch(e){reject(e);}};addEventListener('message',receive);parent.postMessage({type:'kayo-race-ready'},location.origin);});}else{const response=await fetch('race-3d-replay.json?v=3d2');if(!response.ok)throw new Error('record load');data=await response.json();}
  filmEnd=window.kayoWeeklyRace.podiumEnd(data);scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(48,1,.1,220);createCourse(data.course);environment();
  const sphere=new THREE.SphereGeometry(data.course.radius,phone?20:32,phone?14:24);
  if(data.participants.length>40){instanced=new THREE.InstancedMesh(sphere,material('#ffffff',{roughness:.17,metalness:.12}),data.participants.length);instanced.castShadow=true;scene.add(instanced);}
  for(const p of data.participants){if(instanced){instanced.setColorAt(balls.length,new THREE.Color(p.color));balls.push(new THREE.Object3D());}else balls.push(mesh(sphere,material('#ffffff',{map:ballTexture(p),roughness:.17,metalness:.12})));const row=document.createElement('li');row.className='rank-row';row.style.setProperty('--color',p.color);row.dataset.id=p.id;row.innerHTML='<span class="place"></span><span class="marble-dot"></span><span class="person-name"></span><span class="finished"></span>';row.querySelector('.person-name').textContent=p.name;rows.push(row);$('rankings').append(row);}
  document.querySelector('.standings footer').firstChild.textContent=data.participants.length+' MARBLES';
  resize();sample(0);updateRank(0,rankAt(0));$('watch').disabled=false;$('watch').textContent='結果を見る';requestAnimationFrame(animate);
  const play=()=>{running=true;time=0;lastRank=-1;activeCut=-2;lastFocus.set(0,17,3);$('startScreen').hidden=true;};$('watch').addEventListener('click',play);if(embedded)play();
  addEventListener('resize',resize);canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();running=false;$('startScreen').hidden=false;$('watch').disabled=true;$('watch').textContent='映像を停止しました';$('error').textContent='画面を再読み込みすると、初めから映像を確認できます。';});canvas.addEventListener('webglcontextrestored',()=>location.reload());
 }catch(e){console.error(e);if(embedded)parent.postMessage({type:'kayo-race-unavailable'},location.origin);$('watch').textContent='読み込めませんでした';$('error').textContent='WebGLに対応したブラウザで再読み込みしてください。';}
}
function showPreviewResults(){
 const own=data.finish.find(f=>f.id==='preview_0')||data.finish[0],prize=window.kayoWeeklyRace.prize(own.rank);$('preview-congrats').textContent=own.rank+'位おめでとう！';
 for(const [key,asset,label]of [['crates','box.png','箱'],['gems','gem.png','ジェム'],['energy','energy.png','スタミナ']]){const el=document.createElement('span'),im=document.createElement('img');im.src='assets/'+asset;im.alt=label;el.append(im,document.createTextNode('×'+prize[key]));$('preview-prizes').append(el);}
 for(const f of data.finish){const p=data.participants.find(p=>p.id===f.id),li=document.createElement('li');li.textContent=f.rank+'位　'+p.name;li.style.borderLeft='4px solid '+p.color;$('preview-final-ranks').append(li);}
 $('preview-result').hidden=false;$('preview-claim').onclick=()=>{$('preview-claim').disabled=true;$('preview-claim').textContent='受取画面の確認完了';$('preview-claim-note').textContent='確認用の表示です。実際の報酬は加算していません。';};
}
boot();
