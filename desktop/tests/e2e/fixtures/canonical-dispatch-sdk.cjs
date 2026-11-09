// SDK faults in the real canonical Node process; this supplies no authority.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {syncBuiltinESMExports}=require('node:module');
const root=process.env.CONTROL_CONFIG_ROOT,mode=process.env.BUSINESS_SDK_MODE;
const on=process.on,off=process.off,send=process.send,spawn=cp.spawn,kill=process.kill,apply=Reflect.apply;
const P=Promise,interval=setInterval,clear=clearInterval,iterator=Array.prototype[Symbol.iterator];
const mark=(name,data)=>{const file=path.join(root,name+'.json'),tmp=file+'.pending';fs.writeFileSync(tmp,JSON.stringify(data),{mode:0o600});fs.renameSync(tmp,file);};
function wait(name,run){const timer=interval(()=>{if(fs.existsSync(path.join(root,'release-'+name))){clear(timer);run();}},5);}
let closingOff=false;
if(root&&mode==='late-close'){
 process.prependListener('message',frame=>{if(closingOff&&frame?.protocol==='activity_dispatch_business_v1')mark('business-late-message',{pid:process.pid});});
 process.off=function(event,handler){
  if(event==='message'&&String(handler).includes('activity_business_transfer_handle_unknown')){closingOff=true;mark('held-business-off',{pid:process.pid});return new P(yes=>wait('business-off',()=>{apply(off,process,[event,handler]);yes();}));}
  return apply(off,process,[event,handler]);
 };
 process.send=function(frame,callback){
  if(frame?.protocol==='activity_dispatch_business_v1'&&frame.type==='fault'){mark('business-fault-invoked',{pid:process.pid});return apply(send,process,[frame,error=>{mark('held-business-fault',{pid:process.pid});wait('business-fault',()=>callback(error));}]);}
  return apply(send,process,[frame,callback]);
 };
}
if(root&&mode==='constructor-close')process.send=function(frame,callback){
 if(frame?.protocol!=='activity_dispatch_business_v1'||frame.type!=='response')return apply(send,process,[frame,callback]);
 const result=apply(send,process,[frame,error=>{mark('held-business-response',{pid:process.pid});wait('business-response',()=>callback(error));}]);
 const previous=Object.getOwnPropertyDescriptor(P.prototype,'constructor');
 Object.defineProperty(P.prototype,'constructor',{configurable:true,get(){mark('business-forbidden-constructor',{pid:process.pid});return P;}});
 try{process.emit('SIGTERM');}finally{Object.defineProperty(P.prototype,'constructor',previous);}
 return result;
};
if(root&&mode==='held-response')process.send=function(frame,callback){
 if(frame?.protocol==='activity_dispatch_business_v1'&&frame.type==='response')return apply(send,process,[frame,error=>{mark('held-business-response',{pid:process.pid});wait('business-response',()=>callback(error));}]);
 return apply(send,process,[frame,callback]);
};
if(root&&mode==='held-preparation-response')process.send=function(frame,callback){
 if(frame?.protocol==='activity_dispatch_business_v1'&&frame.type==='response'&&frame.family==='preparation')return apply(send,process,[frame,error=>{mark('held-preparation-response',{pid:process.pid,op:frame.op});wait('preparation-response',()=>callback(error));}]);
 return apply(send,process,[frame,callback]);
};
if(root&&mode==='late-attach')process.on=function(event,handler){
 if(event==='message'&&String(handler).includes('activity_business_transfer_handle_unknown')){
  mark('held-business-setup',{pid:process.pid});
  return new P(yes=>wait('business-setup',()=>{apply(on,process,[event,handler]);mark('business-late-attached',{pid:process.pid});yes();}));
 }
 return apply(on,process,[event,handler]);
};
if(root&&mode==='late-attach')process.off=function(event,handler){
 const result=apply(off,process,[event,handler]);
 if(event==='message'&&String(handler).includes('activity_business_transfer_handle_unknown'))mark('business-listeners-after-off',{count:process.listeners('message').filter(fn=>String(fn).includes('activity_business_transfer_handle_unknown')).length,lateAttachObserved:fs.existsSync(path.join(root,'business-late-attached.json'))});
 return result;
};
if(root&&mode==='late-handle')process.off=function(event,handler){
 if(event==='message'&&String(handler).includes('activity_business_transfer_handle_unknown')){
  mark('held-business-off',{pid:process.pid});
  setImmediate(()=>{const handle=new P(yes=>wait('business-handle',yes));mark('held-business-handle',{pid:process.pid,notNativeTransferredHandle:true});process.emit('message',{protocol:'activity_dispatch_business_v1',type:'late-handle'},handle);});
  return new P(yes=>wait('business-off',()=>{apply(off,process,[event,handler]);yes();}));
 }
 return apply(off,process,[event,handler]);
};
if(root)cp.spawn=function(...args){
 const child=apply(spawn,this,args);
 if(!args[1]?.some(value=>String(value).replace(/\\/g,'/').endsWith('/kswarm/src/server/index.js')))return child;
 const originalSend=child.send;let disconnected=false,directAdmissions=0;
 if(mode==='preparation-late-fault'){
  const childOn=child.on;let attached=false,fired=false;
  child.on=function(event,handler){
   const result=apply(childOn,child,[event,handler]);
   if(!attached&&event==='message'&&String(handler).includes('DISPATCH_BUSINESS_TRANSFER_HANDLE_UNCONFIRMED')){
    attached=true;apply(childOn,child,['message',frame=>{if(!fired&&frame?.protocol==='kswarm_dispatch_business_v1'&&frame.family==='preparation'&&frame.type==='response'&&frame.result?.ok){fired=true;queueMicrotask(()=>{mark('preparation-delivery-fault',{pid:child.pid});child.emit('message',{protocol:'kswarm_dispatch_business_v1',type:'fault',error:{name:'Error',message:'controlled original lower delivery failure',code:'CONTROLLED_LOWER_FAULT',durableCommitted:false}});});}}]);
   }
   return result;
  };
 }
 if(mode==='held-response'){
  child.prependListener('message',frame=>{if(frame?.protocol==='kswarm_dispatch_business_v1'&&frame.type==='prefix_drained')mark('business-lower-prefix-drained',{pid:child.pid});});
  process.kill=function(pid,signal){if(pid===child.pid&&signal==='SIGTERM')mark('business-lower-signaled',{pid});return apply(kill,process,[pid,signal]);};
 }
 if(mode==='last-current'||mode==='command-failure'){
  let connected=child.connected;
  Object.defineProperty(child,'connected',{configurable:true,get(){
   const stack=Error().stack||'';
   if(mode==='last-current'&&!disconnected&&/at (?:Object\.)?admit \(/.test(stack)&&!stack.includes('fromAudience')&&!stack.includes('assertCurrent')&&++directAdmissions===8){disconnected=true;mark('business-last-current',{stack});process.emit('disconnect');}
   return connected;
  },set(value){connected=value;}});
 }
 child.send=function(frame,callback){
  if(frame?.protocol==='kswarm_dispatch_business_v1'&&frame.type==='request'&&disconnected)mark('business-request-after-revoke',{op:frame.op});
  if(mode==='audience-iterator'&&frame?.protocol==='kswarm_dispatch_business_v1'&&frame.type==='hello'){
   Array.prototype[Symbol.iterator]=function*(){
    if(this.length===3&&this[0]?.[0]==='scope'&&this[1]?.[0]==='targetGeneration'&&this[2]?.[0]==='childBoot'){
     mark('business-audience-iterator',{pid:process.pid});yield ['scope',this[0][1]];yield ['targetGeneration',987654321];yield ['childBoot','9'.repeat(64)];return;
    }
    yield* apply(iterator,this,[]);
   };
  }
  return apply(originalSend,child,[frame,callback]);
 };
 return child;
};
syncBuiltinESMExports();
