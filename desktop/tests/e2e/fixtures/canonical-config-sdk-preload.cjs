const fs=require('node:fs'),path=require('node:path');
const root=process.env.CANONICAL_SDK_FIXTURE_ROOT,mode=process.env.CANONICAL_SDK_FIXTURE_MODE;
const send=process.send?.bind(process),NativePromise=Promise,then=Promise.prototype.then,iterator=Array.prototype[Symbol.iterator],apply=Reflect.apply;
const mark=(name,value)=>{const target=path.join(root,name),pending=target+'.pending';fs.writeFileSync(pending,JSON.stringify(value),{mode:0o600});fs.renameSync(pending,target);};
if(root&&send){
 const sdk=function(frame,callback){
  if(frame?.protocol!=='activity_desktop_config_v1'||frame.type!=='daemon_hello')return send(frame,callback);
  let release,releaseRaw,armed=false,callbackReleased=false,rawReleased=mode!=='raw';
  const result=send(frame,error=>{release=()=>callback(error);mark('sdk-hello-held.json',{pid:process.pid});});
  const timer=setInterval(()=>{
   if(!armed&&fs.existsSync(path.join(root,'arm-sdk-hook'))){armed=true;
    if(mode==='then')Promise.prototype.then=function(yes){if(typeof yes==='function')yes();return new NativePromise(()=>{});};
    if(mode==='iterator')Array.prototype[Symbol.iterator]=function(){if(this.length===2&&this[0]?.[0]==='message'&&this[1]?.[0]==='disconnect'){mark('cleanup-iterator-hook.json',{pid:process.pid});return {next(){return {done:true};}};}return apply(iterator,this,[]);};
    mark('sdk-hook-armed.json',{pid:process.pid,mode});
   }
   if(!callbackReleased&&release&&fs.existsSync(path.join(root,'release-sdk-hello'))){callbackReleased=true;if(mode==='then')Promise.prototype.then=then;mark('sdk-hello-released.json',{pid:process.pid});release();}
   if(!rawReleased&&releaseRaw&&fs.existsSync(path.join(root,'release-sdk-raw'))){rawReleased=true;mark('sdk-raw-released.json',{pid:process.pid});releaseRaw();}
   if(callbackReleased&&rawReleased){clearInterval(timer);setTimeout(()=>{mark('sdk-after-drain-listeners.json',{pid:process.pid,message:process.listenerCount('message'),disconnect:process.listenerCount('disconnect')});Array.prototype[Symbol.iterator]=iterator;},60);}
  },5);
  if(mode==='raw'){const raw=new NativePromise(yes=>{releaseRaw=yes;});Object.defineProperty(raw,'then',{get(){mark('sdk-then-read.json',{pid:process.pid});throw Error('unexpected own SDK then getter');}});mark('sdk-raw-held.json',{pid:process.pid});return raw;}
  if(mode==='thenable')return {get then(){mark('sdk-then-read.json',{pid:process.pid});throw Error('unexpected unknown SDK then getter');}};
  if(mode==='throw'){mark('sdk-send-threw.json',{pid:process.pid});throw Error('original canonical SDK send threw after real send');}
  return mode==='false'?false:result;
 };
 if(mode==='async'||mode==='bound-async'){const asyncSend=async(...args)=>{mark('sdk-forbidden-body.json',{pid:process.pid});return sdk(...args);};process.send=mode==='async'?asyncSend:asyncSend.bind(process);}
 else if(mode==='proxy')process.send=new Proxy(sdk,{apply(){mark('sdk-forbidden-body.json',{pid:process.pid});throw Error('forbidden proxy SDK body');},getPrototypeOf(){mark('sdk-forbidden-body.json',{pid:process.pid});throw Error('forbidden proxy SDK prototype');}});
 else process.send=sdk;
}
