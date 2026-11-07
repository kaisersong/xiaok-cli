const NativePromise=Promise,then=Promise.prototype.then,apply=Reflect.apply,NativeError=Error;
function deferred(){
  let yes!:()=>void,no!:(raw:unknown)=>void,done=false;
  const promise=new NativePromise<void>((resolve,reject)=>{yes=resolve;no=reject;});
  apply(then,promise,[()=>undefined,()=>undefined]);
  return {promise,resolve(){if(!done){done=true;yes();}},reject(raw:unknown){if(!done){done=true;no(raw);}}};
}
/** Bookkeeping only. This object cannot authorize startup; the Services private
 * member and fixed original runtime completion reader are checked separately. */
export function createMainDshServicesStartupState(){
  const construction=deferred(),recovery=deferred(),remote=deferred();
  let closed=false,localStarted=false,remoteStarted=false,remoteOpen=false,failure:{raw:unknown}|undefined;
  const current=()=>{if(failure)throw failure.raw;if(closed)throw new NativeError('DSH_MAIN_SERVICES_STARTUP_CLOSED');};
  return Object.freeze({
    constructionReady:construction.promise,recoveryReady:recovery.promise,remoteReady:remote.promise,
    current,
    constructionDone(){current();construction.resolve();},
    constructionFailed(raw:unknown){failure??={raw};construction.reject(raw);recovery.reject(raw);remote.reject(raw);},
    beginRecovery(){current();if(localStarted)return false;localStarted=true;return true;},
    recoveryDone(){current();recovery.resolve();},
    recoveryFailed(raw:unknown){failure??={raw};recovery.reject(raw);remote.reject(raw);},
    beginRemote(){current();if(remoteStarted)return false;remoteStarted=true;return true;},
    openRemote(){current();if(!remoteStarted)throw new NativeError('DSH_MAIN_SERVICES_STARTUP_REQUIRED');remoteOpen=true;},
    assertRemoteOpen(){current();if(!remoteOpen)throw new NativeError('DSH_MAIN_SERVICES_REMOTE_NOT_READY');},
    isRemoteOpen(){return !closed&&!failure&&remoteOpen;},
    remoteDone(){current();remote.resolve();},
    remoteFailed(raw:unknown){failure??={raw};remote.reject(raw);},
    close(){
      closed=true;remoteOpen=false;const raw=new NativeError('DSH_MAIN_SERVICES_STARTUP_CLOSED');
      construction.reject(raw);
      if(!localStarted)recovery.reject(raw);
      if(!remoteStarted)remote.reject(raw);
    },
  });
}
export type MainDshServicesStartupState=ReturnType<typeof createMainDshServicesStartupState>;
