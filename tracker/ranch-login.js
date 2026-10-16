(function(root,factory){
  const api=factory();
  if(typeof module==='object' && module.exports)module.exports=api;
  if(root)root.kayoRanchLogin=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  async function create(sdk,auth,{hostname,mobile=false}){
    // Hosting and the auth helper share an origin on both Firebase domains.
    const sameOrigin=hostname===auth.config.authDomain;
    await sdk.setPersistence(auth,sdk.browserLocalPersistence);
    await sdk.getRedirectResult(auth);
    const provider=new sdk.GoogleAuthProvider();
    provider.setCustomParameters({prompt:'select_account'});
    return {
      observe:callback=>sdk.onAuthStateChanged(auth,callback),
      login:async()=>{
        if(mobile && sameOrigin)return sdk.signInWithRedirect(auth,provider);
        try{return await sdk.signInWithPopup(auth,provider);}
        catch(error){
          if(error.code==='auth/popup-blocked' && sameOrigin)return sdk.signInWithRedirect(auth,provider);
          throw error;
        }
      },
      logout:()=>sdk.signOut(auth)
    };
  }
  return {create};
});
