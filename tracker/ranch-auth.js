import {initializeApp} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import * as authentication from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import * as firestore from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

try {
const hostname=location.hostname;
const authDomain=['kayo-ranch.firebaseapp.com','kayo-ranch.web.app','ishibashi-tracker.firebaseapp.com','ishibashi-tracker.web.app'].includes(hostname)?hostname:'kayo-ranch.firebaseapp.com';
const app=initializeApp({
  apiKey:'AIzaSyDIiwhzuEXucBro2-PpFYNh9-BB37imLMI',
  authDomain,projectId:'ishibashi-tracker',
  storageBucket:'ishibashi-tracker.firebasestorage.app',messagingSenderId:'472088950213',
  appId:'1:472088950213:web:7c511bb46c1710464107ac'
});
const auth=authentication.getAuth(app);
const login=await window.kayoRanchLogin.create(authentication,auth,{
  hostname,mobile:matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod/.test(navigator.userAgent)
});
window.kayoRanchBrowser.start({
  cloud:window.kayoRanchCloud.create(firestore,firestore.getFirestore(app),window.kayoRanchState),
  visits:window.kayoRanchVisitsCloud.create(firestore,firestore.getFirestore(app),window.kayoRanchState,window.kayoRanchVisits),
  race:window.kayoWeeklyRaceCloud.create(firestore,firestore.getFirestore(app),()=>auth.currentUser?.uid,window.kayoRanchState,window.kayoWeeklyRace),
  ...login
});
} catch(error){window.kayoRanchBrowser.fail(error);}
