const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=process.env.RELAY_SDK_TEST_ROOT,mode=process.env.RELAY_SDK_TEST_MODE;
const mark=(name,value)=>{const file=path.join(root,name),temp=file+'.pending';fs.writeFileSync(temp,JSON.stringify(value),{mode:0o600});fs.renameSync(temp,file);};
let preparationSource,preparationAdmission,preparationNativeSource,preparationClientCount=0,preparationNativeQueries=0,dormantChecked=false;
if(root&&(mode==='prep-method-prototype'||mode==='prep-dormant')){
 const set=WeakMap.prototype.set,descriptor=Object.getOwnPropertyDescriptor;
 WeakMap.prototype.set=function(key,value){
  const result=Reflect.apply(set,this,[key,value]);
  if(!preparationSource&&value&&typeof value==='object'){
   const ports=descriptor(value,'ports');const source=ports&&Object.hasOwn(ports,'value')&&ports.value&&descriptor(ports.value,'transportSource');
   const candidate=source&&Object.hasOwn(source,'value')?source.value:undefined;
   if(candidate&&Object.getPrototypeOf(candidate)===null&&Object.isFrozen(candidate)&&Object.getOwnPropertyNames(candidate).length===3&&typeof descriptor(candidate,'resolveWork')?.value==='function'&&typeof descriptor(candidate,'observeWork')?.value==='function'&&typeof descriptor(candidate,'sealWork')?.value==='function'){
    preparationSource=candidate;preparationAdmission=descriptor(ports.value,'transportAdmission')?.value;mark('prep-source-captured.json',{pid:process.pid});
   }
  }
  if(mode==='prep-dormant'&&value&&typeof value==='object'){
   if(descriptor(value,'composition')?.value&&descriptor(value,'read')?.value&&descriptor(value,'assertBirth')?.value)preparationNativeSource=key;
   if(preparationSource&&descriptor(value,'preparationSource')?.value===preparationSource&&descriptor(value,'preparationAdmission')?.value===preparationAdmission&&descriptor(value,'preparationFacet')?.value){
    preparationClientCount++;const facet=descriptor(value,'preparationFacet').value;
    if(!dormantChecked){dormantChecked=true;queueMicrotask(()=>{void(async()=>{
     try{
      let rejection;try{facet.openWork('fixture-missing-project',{childKey:'default-dispatch-child:'+'1'.repeat(64),payloadHash:'2'.repeat(64)},{requestSource:'scheduler',preparationProof:Object.freeze(Object.create(null)),signal:new AbortController().signal});}catch(error){rejection=error?.message;}
      const native=await import(require('node:url').pathToFileURL(path.resolve(__dirname,'../../../dist/main/desktop/electron/default-dispatch-preparation-native-source.js')).href);
      let birthDenied=false;try{native.readDefaultDispatchPreparationNativeBirth(preparationNativeSource);}catch{birthDenied=true;}
      mark('prep-dormant-observed.json',{pid:process.pid,preparationClientCount,rejection,birthDenied,preparationNativeQueries});
     }catch(error){mark('prep-dormant-observed.json',{pid:process.pid,diagnosticError:error?.message});}
    })();});}
   }
  }
  return result;
 };
 if(mode==='prep-dormant'){
  const electron=require('electron'),ready=electron.app.isReady,windows=electron.BrowserWindow.getAllWindows;
  const count=()=>{if((new Error().stack||'').includes('default-dispatch-preparation-native-source'))preparationNativeQueries++;};
  electron.app.isReady=function(...args){count();return Reflect.apply(ready,this,args);};electron.BrowserWindow.getAllWindows=function(...args){count();return Reflect.apply(windows,this,args);};
 }
}
if(root&&mode){mark('relay-sdk-fixture-loaded.json',{pid:process.pid});if(mode==='register-message'||mode==='register-error'){const report=console.error;console.error=function(...args){if(typeof args[0]==='string'&&args[0].includes('[main] Activity owner attach failed'))mark('ordinary-fallback.json',{pid:process.pid,message:args[0]});return Reflect.apply(report,this,args);};}if(mode==='unknown-held'||mode==='source-unknown-held'){const OriginalError=Error;global.Error=new Proxy(OriginalError,{apply(target,receiver,args){const error=Reflect.apply(target,receiver,args);if(args[0]==='WRITER_CONTROL_SOURCE_TAIL_UNKNOWN')mark('source-unknown-close-rejected.json',{pid:process.pid});if(args[0]==='WRITER_CONFIG_TAIL_UNKNOWN')mark('unknown-close-rejected.json',{pid:process.pid});return error;},construct(target,args){const error=Reflect.construct(target,args);if(args[0]==='WRITER_CONTROL_SOURCE_TAIL_UNKNOWN')mark('source-unknown-close-rejected.json',{pid:process.pid});if(args[0]==='WRITER_CONFIG_TAIL_UNKNOWN')mark('unknown-close-rejected.json',{pid:process.pid});return error;}});}if(mode==='startup-observer'){const set=WeakMap.prototype.set,descriptor=Object.getOwnPropertyDescriptor(Promise.prototype,'constructor');let armed=false;WeakMap.prototype.set=function(key,value){const result=Reflect.apply(set,this,[key,value]);if(!armed&&value&&Object.hasOwn(value,'workDone')&&Object.hasOwn(value,'promise')&&Object.hasOwn(value,'source')){armed=true;Object.defineProperty(Promise.prototype,'constructor',{...descriptor,value:function UnsafePromiseConstructor(){}});mark('startup-observer-poisoned.json',{pid:process.pid});queueMicrotask(()=>{Object.defineProperty(Promise.prototype,'constructor',descriptor);mark('startup-observer-restored.json',{pid:process.pid});});}return result;};}if(mode==='native-error-cause'){const OriginalAggregateError=AggregateError;global.AggregateError=class extends OriginalAggregateError{constructor(errors,message,options){super(errors,message,options);if(message==='WRITER_CONFIG_PREFIX_UNCONFIRMED')mark('relay-prefix-failure.json',{pid:process.pid,errors:this.errors.map(error=>({message:error?.message,cause:error?.cause}))});}};}const original=cp.spawn;cp.spawn=function(...args){const child=Reflect.apply(original,this,args);if(!Array.isArray(args[1])||!args[1].some(arg=>typeof arg==='string'&&arg.endsWith('owner-entry.js'))||!child.send)return child;
 if(mode==='startup-observer')mark('forbidden-owner-spawn.json',{pid:process.pid,daemonPid:child.pid});const send=child.send;let armed=false;let iteratorPoisoned=false;child.on('message',frame=>{if(mode==='wrong-session'&&frame?.type==='command_challenge'&&frame.op==='prepare_initial_plan_writer'){frame.ownerEpoch='foreign-owner-epoch';const iterator=Array.prototype[Symbol.iterator];Array.prototype[Symbol.iterator]=function(){if(this.length===5&&this[0]==='protocol'&&this[1]==='daemonBoot'&&this[4]==='configConnectionIncarnation')return {next(){return {done:true};}};return Reflect.apply(iterator,this,[]);};mark('foreign-session-injected.json',{pid:process.pid});iteratorPoisoned=true;}if((mode==='unknown-held'||mode==='source-unknown-held')&&frame?.type==='command_result'&&frame.op==='prepare_initial_plan_writer'&&frame.result){mark('actual-success-ack.json',{pid:process.pid,result:frame.result});if(mode==='source-unknown-held'){const window=require('electron').BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().includes('/dist/renderer/index.html'));if(!window)throw Error('original Main window missing');Object.defineProperty(window,'then',{configurable:true,get(){mark('forbidden-window-then.json',{pid:process.pid});throw Error('Native window then getter must not execute');}});mark('original-window-poisoned.json',{pid:process.pid});}}if(mode==='native-error-cause'&&frame?.type==='command_result'&&frame.error)mark('actual-late-native-error.json',{pid:process.pid,error:frame.error});if(frame?.protocol==='activity_desktop_config_v1'&&frame.type==='command_challenge'&&frame.op==='prepare_initial_plan_writer'){armed=true;mark('original-prepare-challenge.json',{pid:process.pid,daemonPid:child.pid});}});
 if(mode==='wrong-session')child.send=function(frame,callback){if(frame?.type==='invoke'&&frame.op==='prepare_initial_plan_writer')mark('foreign-session-forwarded.json',{pid:process.pid,ownerEpoch:frame.ownerEpoch});return Reflect.apply(send,child,[frame,callback]);};
 if(mode==='prep-dormant'){
  const sessions=new Set();let preparationRequests=0,userReads=0;
  child.send=function(frame,callback){if(frame?.protocol==='activity_dispatch_business_v1'){
   const nonce=frame.mainLaunchNonce;if(typeof nonce==='string'&&/^[a-f0-9]{64}$/.test(nonce))sessions.add(nonce);
   if(frame.family==='preparation')preparationRequests++;if(frame.op==='read_plan')userReads++;
   mark('prep-dormant-wire-facts.json',{pid:process.pid,businessSessions:sessions.size,preparationRequests,userReads});
  }return Reflect.apply(send,child,[frame,callback]);};
 }
 if(mode==='prep-method-prototype'){
  const on=child.on;let poisoned=false;
  child.on=function(event,listener){const result=Reflect.apply(on,this,[event,listener]);if(!poisoned&&event==='message'){
   if(!preparationSource)throw Error('actual preparation Source was not captured');poisoned=true;
   Object.setPrototypeOf(preparationSource.resolveWork,Object.getPrototypeOf(async function(){}));
   mark('prep-source-prototype-poisoned.json',{pid:process.pid,daemonPid:child.pid});
  }return result;};
  child.send=function(frame,callback){if(frame?.protocol==='activity_dispatch_business_v1'&&frame.op==='read_plan')mark('old-user-read-issued.json',{pid:process.pid,id:frame.id,op:frame.op});return Reflect.apply(send,child,[frame,callback]);};
 }
 if(mode==='register-message'){const on=child.on;let failed=false;child.on=function(event,listener){const result=Reflect.apply(on,this,[event,listener]);if(!failed&&event==='message'){failed=true;mark('original-registration-failure.json',{pid:process.pid,event});throw Error('original relay message registration threw after native add');}return result;};}
 if(mode==='register-error'){const once=child.once;let failed=false;child.once=function(event,listener){const result=Reflect.apply(once,this,[event,listener]);if(!failed&&event==='error'&&listener.name!=='onError'){failed=true;mark('original-registration-failure.json',{pid:process.pid,event});throw Error('original spawn diagnostic registration threw after native add');}return result;};}
 if(mode==='cleanup-throw'){const off=child.off;let failed=false;child.off=function(event,listener){mark('cleanup-'+event+'.json',{pid:process.pid});const result=Reflect.apply(off,this,[event,listener]);if(!failed&&event==='message'){failed=true;throw Error('original relay message cleanup threw after native removal');}return result;};}
 if(mode==='seal-observer-held'){
  const off=child.off;child.off=function(event,listener){if(event==='message')mark('seal-receiver-removed.json',{pid:process.pid,callbackReleased:fs.existsSync(path.join(root,'seal-sdk-callback-released.json'))});return Reflect.apply(off,this,[event,listener]);};
  child.send=function(frame,callback){if(frame?.type!=='seal_prefix')return Reflect.apply(send,child,[frame,callback]);
   Reflect.apply(send,child,[frame,error=>{mark('seal-sdk-callback-held.json',{pid:process.pid});const timer=setInterval(()=>{if(fs.existsSync(path.join(root,'release-sdk'))){clearInterval(timer);mark('seal-sdk-callback-released.json',{pid:process.pid});callback(error);}},5);}]);
   const descriptor=Object.getOwnPropertyDescriptor(Promise.prototype,'constructor');Object.defineProperty(Promise.prototype,'constructor',{...descriptor,value:function UnsafeSealObserverConstructor(){}});mark('seal-observer-poisoned.json',{pid:process.pid});setTimeout(()=>{Object.defineProperty(Promise.prototype,'constructor',descriptor);mark('seal-observer-restored.json',{pid:process.pid});},50);
   return {get then(){mark('forbidden-seal-then.json',{pid:process.pid});throw Error('unknown seal raw getter must not run');}};
  };
 }
 const asyncSend=(async function(frame,callback){mark('forbidden-async-body.json',{pid:process.pid,daemonPid:child.pid});await new Promise(yes=>{const timer=setInterval(()=>{if(fs.existsSync(path.join(root,'release-sdk'))){clearInterval(timer);yes();}},5);});const raw=Reflect.apply(send,child,[frame,callback]);mark('late-sdk-issued.json',{pid:process.pid});return raw;}).bind(child);
 if(mode==='unknown-held'||mode==='source-unknown-held')child.send=function(frame,callback){if(frame?.type!=='invoke'||frame.op!=='prepare_initial_plan_writer')return Reflect.apply(send,child,[frame,callback]);Reflect.apply(send,child,[frame,error=>{mark('original-sdk-callback-held.json',{pid:process.pid});const timer=setInterval(()=>{if(fs.existsSync(path.join(root,'release-sdk'))){clearInterval(timer);mark('original-sdk-callback-released.json',{pid:process.pid});callback(error);}},5);}]);if(mode==='source-unknown-held')return true;return {get then(){mark('forbidden-sdk-then.json',{pid:process.pid});throw Error('SDK then getter must not execute');}};};
 if(mode==='native-error-cause')child.send=function(frame,callback){const raw=Reflect.apply(send,child,[frame,callback]);if(frame?.type==='invoke'&&frame.op==='prepare_initial_plan_writer')mark('actual-prepare-invoke-issued.json',{pid:process.pid});return raw;};
 if(mode==='bound-async')Object.defineProperty(child,'send',{configurable:true,get(){if(armed){mark('invoke-sdk-getter.json',{pid:process.pid});return asyncSend;}return send;}});
 return child;};require('node:module').syncBuiltinESMExports();}
