'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url'),{createServer}=require('node:http');
const [bundle,domain,result,userData,protocol='openai']=process.argv.slice(2);
const fixtureConfig=path.join(fs.realpathSync(domain),'fixture-config');fs.mkdirSync(fixtureConfig,{recursive:true,mode:0o700});process.env.XIAOK_CONFIG_DIR=fixtureConfig;
const app=require('electron').app;app.setPath('userData',userData);app.disableHardwareAcceleration();const cleanup=[];let owner,requests=0;
let preconsumeArmed=false,preconsumeHits=0,preconsumeRelease,preconsumeOutcomeRelease;const preconsumeTail=new Promise(yes=>{preconsumeRelease=yes;}),preconsumeOutcome=new Promise(yes=>{preconsumeOutcomeRelease=yes;});
const preconsumeRaw=protocol==='openai-preconsume-undefined'?undefined:Error('ORIGINAL_MODEL_NATIVE_PRE_CONSTRUCT_FAILURE');
if(protocol==='openai-preconsume')Object.defineProperty(preconsumeRaw,Symbol('original-model-native-tail'),{value:preconsumeTail});
if(protocol.startsWith('openai-preconsume')){
 const originalDlopen=process.dlopen;process.dlopen=function(module,filename,...rest){const result=Reflect.apply(originalDlopen,this,[module,filename,...rest]);if(path.basename(filename)!=='root_resource_authority_main.node')return result;const original=module.exports,descriptors=Object.getOwnPropertyDescriptors(original),verify=descriptors.assertOriginalModelSdkBridge.value;descriptors.assertOriginalModelSdkBridge={...descriptors.assertOriginalModelSdkBridge,value:function(...args){const value=Reflect.apply(verify,original,args);if(preconsumeArmed&&new Error().stack.includes('consumeModel')){preconsumeArmed=false;preconsumeHits++;if(protocol==='openai-preconsume-return')return preconsumeTail;throw preconsumeRaw;}return value;}};Object.defineProperty(module,'exports',{value:Object.create(null,descriptors)});process.dlopen=originalDlopen;return result;};
}

function cause(raw,depth=0){if(depth>8||!raw||typeof raw!=='object'||require('node:util').types.isProxy(raw))return null;const out={};for(const name of ['message','code','terminal','unknown','secondaryKinds']){const d=Object.getOwnPropertyDescriptor(raw,name);if(d&&Object.hasOwn(d,'value')&&(typeof d.value==='string'||typeof d.value==='boolean'||name==='secondaryKinds'&&Array.isArray(d.value)))out[name]=d.value;}for(const name of ['cause','errors']){const d=Object.getOwnPropertyDescriptor(raw,name);if(d&&Object.hasOwn(d,'value'))out[name]=Array.isArray(d.value)?d.value.map(v=>cause(v,depth+1)):cause(d.value,depth+1);}return out;}
async function run(){
 await app.whenReady();let nativeOrigin,nativeSecureOrigin;
 if(protocol.startsWith('native-')){
  const originalFetch=globalThis.fetch;globalThis.fetch=(input,init)=>{const url=new URL(String(input));assert.equal(url.origin,'https://api.openai.com');return originalFetch(new URL(url.pathname,nativeOrigin),init);};
  const https=require('node:https'),originalRequest=https.request,cert=fs.readFileSync(path.join(process.cwd(),'tests/fixtures/sol-pi-tls/cert.pem'));
  https.request=(url,options,callback)=>{assert.equal(url.origin,'https://api.openai.com');return originalRequest(new URL(url.pathname,nativeSecureOrigin),{...options,ca:cert},callback);};require('node:module').syncBuiltinESMExports();
 }
 const api=await import(pathToFileURL(bundle).href);let faultCalls=0,priorHttpHeaders;
 if(protocol.startsWith('openai-error-')){
  const original=api.OriginalOpenAiApiError.generate;
  api.OriginalOpenAiApiError.generate=function(status,payload,message,headers){
   const suppliedHeaders=protocol==='openai-error-copy'?new Headers(headers):protocol==='openai-error-other-frame'&&priorHttpHeaders?priorHttpHeaders:headers;priorHttpHeaders=headers;
   const result=Reflect.apply(original,this,[status,payload,message,suppliedHeaders]);
   if(protocol==='openai-error-getter')Object.defineProperty(result,'headers',{get(){faultCalls++;throw Error('forbidden headers getter');},enumerable:true,configurable:true});
   if(protocol==='openai-error-proxy')result[Symbol('raw-sdk-extra')]=new Proxy({}, {ownKeys(){faultCalls++;throw Error('forbidden proxy ownKeys');},get(){faultCalls++;throw Error('forbidden proxy get');},getOwnPropertyDescriptor(){faultCalls++;throw Error('forbidden proxy descriptor');}});
   return result;
  };
 }
 let sdkHook,tagged=0,sdkGetterCalls=0,releaseSdkTail,releaseOutcomeTail;
 const sdkTail=new Promise(yes=>{releaseSdkTail=yes;}),outcomeTail=new Promise(yes=>{releaseOutcomeTail=yes;});
 if(protocol==='openai-sdk-tail'||protocol==='openai-sdk-constructor-getter'||(protocol==='openai-sdk-rp-constructor-getter'||protocol==='openai-sdk-rp-species-getter')){
  if((protocol==='openai-sdk-rp-constructor-getter'||protocol==='openai-sdk-rp-species-getter')){
   Object.defineProperty(api.OriginalOpenAiApiPromise.prototype,'responsePromise',{configurable:true,set(value){
    Object.defineProperty(this,'responsePromise',{value,writable:true,configurable:true,enumerable:true});
    if(protocol==='openai-sdk-rp-species-getter'){const ctor={};Object.defineProperty(ctor,Symbol.species,{get(){sdkGetterCalls++;throw Error('RPC species getter must not run');}});Object.defineProperty(value,'constructor',{value:ctor,configurable:true});}
    else Object.defineProperty(value,'constructor',{get(){sdkGetterCalls++;throw Error('RPC constructor getter must not run');},configurable:true});
    queueMicrotask(()=>{Object.defineProperty(value,'constructor',{value:Promise,configurable:true});Promise.prototype.then.call(value,()=>{},()=>{});delete api.OriginalOpenAiApiPromise.prototype.responsePromise;});
   }});
  }
  sdkHook=require('node:async_hooks').createHook({init(_id,type,_trigger,resource){
   if(type!=='PROMISE'||Object.getPrototypeOf(resource)!==api.OriginalOpenAiApiPromise.prototype)return;
   tagged++;Object.defineProperty(resource,Symbol('original-sdk-tail'),{value:sdkTail});
   if(protocol==='openai-sdk-constructor-getter')Object.defineProperty(resource,'constructor',{get(){sdkGetterCalls++;throw Error('SDK constructor getter must not run');},configurable:true});
  }});sdkHook.enable();
 }
 const scope={profileId:'model-profile',workspaceId:'model-workspace'},forbidden=async()=>{throw Error('fixture unintended effect');};
 const slowResponses=[];
 const server=createServer((req,res)=>{requests++;req.resume();if(protocol.startsWith('native-')){res.setHeader('content-type','application/json');res.end(JSON.stringify({id:'native-response-fixture',object:protocol==='native-compact'?'response.compaction':'response',created_at:1,output:protocol==='native-compact'?[{type:'compaction',encrypted_content:'fixture-data'}]:[{type:'message',content:[{type:'output_text',text:'actual SDK output'}]}],usage:{input_tokens:2,output_tokens:3,total_tokens:5}}));return;}if(protocol.startsWith('openai-error')){res.statusCode=400;res.setHeader('content-type','application/json');res.end(JSON.stringify({error:{message:'fixture bounded rejection',type:'invalid_request_error'}}));return;}if(protocol==='responses'){res.setHeader('content-type','application/json');res.end(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'actual SDK output'}]}],usage:{input_tokens:2,output_tokens:3}}));return;}if(protocol==='system-one'){res.setHeader('content-type','application/json');res.end(JSON.stringify({answers:{reply:{choice:'actual SDK output'}}}));return;}res.setHeader('content-type','text/event-stream');if(protocol==='openai-m4'||protocol==='openai-iterator-return'){res.write('data: {"choices":[{"index":0,"delta":{"content":"actual SDK output"},"finish_reason":null}]}\n\n');slowResponses.push(res);return;}if(protocol==='openai-tool'){const chunks=[{choices:[{index:0,delta:{tool_calls:[{index:0,id:'call-fixture',type:'function',function:{name:'fixture_tool',arguments:JSON.stringify({x:1})}}]},finish_reason:null}]},{choices:[{index:0,delta:{},finish_reason:'tool_calls'}]}];res.end(chunks.map(chunk=>`data: ${JSON.stringify(chunk)}\n\n`).join('')+'data: [DONE]\n\n');return;}if(protocol.startsWith('anthropic')){const events=[{type:'message_start',message:{id:'fixture-msg',type:'message',role:'assistant',model:'claude-opus-4-6',content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:2,output_tokens:0}}},{type:'content_block_start',index:0,content_block:protocol==='anthropic-tool'?{type:'tool_use',id:'call-fixture',name:'fixture_tool',input:{}}:{type:'text',text:''}},{type:'content_block_delta',index:0,delta:protocol==='anthropic-tool'?{type:'input_json_delta',partial_json:JSON.stringify({x:1})}:{type:'text_delta',text:'actual SDK output'}},{type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:3}},{type:'message_stop'}];if(protocol==='anthropic-thinking')events.splice(1,0,{type:'content_block_start',index:1,content_block:{type:'thinking',thinking:'',signature:''}},{type:'content_block_delta',index:1,delta:{type:'thinking_delta',thinking:'hidden fixture reasoning'}},{type:'content_block_stop',index:1});res.end(events.map(event=>`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''));return;}res.end('data: {"choices":[{"index":0,"delta":{"content":"actual SDK output"},"finish_reason":null}]}\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');});await new Promise(yes=>server.listen(0,'127.0.0.1',yes));cleanup.push(()=>new Promise(yes=>server.close(yes)));
 if(protocol.startsWith('native-')){
  nativeOrigin=`http://127.0.0.1:${server.address().port}`;
  const tls=require('node:https').createServer({cert:fs.readFileSync(path.join(process.cwd(),'tests/fixtures/sol-pi-tls/cert.pem')),key:fs.readFileSync(path.join(process.cwd(),'tests/fixtures/sol-pi-tls/key.pem'))},server.listeners('request')[0]);await new Promise(yes=>tls.listen(0,'127.0.0.1',yes));nativeSecureOrigin=`https://127.0.0.1:${tls.address().port}`;cleanup.push(()=>new Promise(yes=>tls.close(yes)));
 }

 const services=api.createDesktopServices({dataRoot:path.join(domain,'desktop'),runner:forbidden,kswarmService:{request:forbidden,getDesktopMutationToken:()=>''}});cleanup.push(()=>services.closeTaskSourceWritersForMigration());
 const workspace=new api.RoomWorkspaceLocalStore(path.join(domain,'workspace.sqlite'));cleanup.push(()=>workspace.close());const runtime=api.createRoomWorkspaceRuntime({store:workspace,broker:{get:forbidden,request:forbidden},wake:{claimWake:forbidden,completeWake:forbidden},execute:services.runCollaborationRoomAgentTask,ensureProtocol:forbidden});cleanup.push(()=>runtime.shutdown());
 const client=api.createCollaborationRoomBrokerClient({token:'fixture-unused',fetchImpl:forbidden}),dispatcher=api.createCollaborationRoomWakeDispatcher({brokerClient:client,execute:services.runCollaborationRoomAgentTask,executeTurn:runtime.run,canExecute:async()=>true}),source=api.createOriginalRoomTurnSource({dispatcher,runtime,services,scope});cleanup.push(()=>source.drain());
 const store=new api.FileTaskSnapshotStore(path.join(domain,'tasks')),population=api.createTaskSourceWriterPopulation(store);cleanup.push(()=>population.close());let completed,fail;const done=new Promise((yes,no)=>{completed=yes;fail=no;});let captured;
 const host=population.createHost({materialRegistry:new api.MaterialRegistry({workspaceRoot:path.join(domain,'workspace'),maxBytes:1024}),runner:async input=>{
  try{
   captured=api.readCurrentOriginalTaskRunnerResourceContext();assert.ok(captured);
   const baseUrl=`http://127.0.0.1:${server.address().port}/v1`;
   const makeAdapter=()=>protocol==='responses'?new api.OpenAIResponsesAdapter('fixture-no-real-key','example',baseUrl):protocol==='system-one'?new api.SystemOneAdapter({apiKey:'fixture-no-real-key',model:'jev',baseUrl}):protocol.startsWith('anthropic')?new api.ClaudeAdapter('fixture-no-real-key','claude-opus-4-6',baseUrl):new api.OpenAIAdapter({apiKey:'fixture-no-real-key',harnessContext:api.buildOpenAIHarnessContext({identity:{providerId:'fixture',providerType:'custom',protocol:'openai_legacy',canonicalBaseUrl:baseUrl,wireModel:'example',capabilities:['tools']},flags:api.resolveKimiHarnessFeatureFlags({})})});
   const runOne=async()=>{
    let text='',sdkError;const calls=[];
    try{for await(const chunk of makeAdapter().stream([{role:'user',content:[{type:'text',text:'bounded fixture request'}]}],protocol.endsWith('-tool')?[{name:'fixture_tool',description:'fixture only',inputSchema:{type:'object',properties:{x:{type:'number'}}}}]:[],'fixture system',{signal:input.signal})){
     if(chunk.type==='text'){text+=chunk.delta;if(protocol==='openai-iterator-return')break;}
     if(chunk.type==='tool_use')calls.push(chunk);
    }}catch(raw){sdkError=raw;}
    if(protocol.startsWith('openai-error'))assert.ok(sdkError);
    else{if(sdkError)throw sdkError;if(protocol.endsWith('-tool')){assert.equal(calls.length,1);assert.equal(calls[0].name,'fixture_tool');assert.deepEqual(calls[0].input,{x:1});}else assert.equal(text,protocol==='system-one'?'reply: actual SDK output':'actual SDK output');}
   };
   if(protocol.startsWith('openai-preconsume')){
    preconsumeArmed=true;let finished=false;const work=runOne().then(()=>{finished=true;return{ok:true};},error=>{finished=true;return{ok:false,error};});const deadline=Date.now()+4000;
    while(preconsumeHits===0){assert.ok(Date.now()<deadline);await new Promise(yes=>setTimeout(yes,5));}
    if(protocol==='openai-preconsume'||protocol==='openai-preconsume-return'){await new Promise(yes=>setTimeout(yes,20));assert.equal(finished,false);const db=new(require('node:sqlite').DatabaseSync)(path.join(domain,'root-resource-v1.sqlite'),{readOnly:true});try{assert.equal(db.prepare("SELECT count(*) n FROM root_physical_resources WHERE state='reserved'").get().n,1);}finally{db.close();}}
    if(protocol==='openai-preconsume-return'){preconsumeRelease({[Symbol('native-outcome-tail')]:preconsumeOutcome});await new Promise(yes=>setTimeout(yes,20));assert.equal(finished,false);preconsumeOutcomeRelease();}else preconsumeRelease();assert.equal((await work).ok,false);assert.equal(preconsumeHits,1);assert.equal(requests,0);
   }else if(protocol==='openai-m4'){
    const work=Array.from({length:5},()=>runOne()),deadline=Date.now()+4000;
    while(requests<4){assert.ok(Date.now()<deadline);await new Promise(yes=>setTimeout(yes,5));}
    await new Promise(yes=>setTimeout(yes,15));assert.equal(requests,4);
    const db=new(require('node:sqlite').DatabaseSync)(path.join(domain,'root-resource-v1.sqlite'),{readOnly:true});try{assert.equal(db.prepare("SELECT count(*) n FROM root_physical_resources WHERE state='reserved'").get().n,4);assert.equal(db.prepare("SELECT count(*) n FROM root_physical_resources WHERE state='queued'").get().n,1);}finally{db.close();}
    slowResponses[0].end('data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
    while(requests<5){assert.ok(Date.now()<deadline);await new Promise(yes=>setTimeout(yes,5));}
    for(let i=1;i<slowResponses.length;i++)slowResponses[i].end('data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');await Promise.all(work);
   }else if(protocol==='openai-sdk-tail'||protocol==='openai-sdk-constructor-getter'||(protocol==='openai-sdk-rp-constructor-getter'||protocol==='openai-sdk-rp-species-getter')){
    let settled=false;const work=runOne().then(()=>{settled=true;},error=>{settled=true;throw error;});
    const deadline=Date.now()+4000;while(tagged===0){assert.ok(Date.now()<deadline);await new Promise(yes=>setTimeout(yes,5));}
    await new Promise(yes=>setTimeout(yes,20));assert.equal(settled,false);assert.equal(sdkGetterCalls,0);
    releaseSdkTail({[Symbol('outcome-tail')]:outcomeTail});await new Promise(yes=>setTimeout(yes,20));assert.equal(settled,false);
    releaseOutcomeTail();
    if(protocol==='openai-sdk-constructor-getter'||(protocol==='openai-sdk-rp-constructor-getter'||protocol==='openai-sdk-rp-species-getter')){await assert.rejects(work);assert.equal(sdkGetterCalls,0);}else await work;
    sdkHook.disable();assert.ok(tagged>=1);
   }else if(protocol.startsWith('native-')){
    const options={apiKey:'fixture-no-real-key',baseUrl:'https://api.openai.com/v1',model:'example',input:[{role:'user',content:'fixture-only'}],signal:input.signal,timeoutMs:300000};
    const result=await (protocol==='native-compact'?api.compactOpenAIResponsesContext(options):api.createStatelessOpenAIResponse(options));assert.equal(result.responseId,'native-response-fixture');
   }else{await runOne();if(protocol==='openai-error-other-frame')await runOne();}
   completed();
  }catch(error){fail(error);throw error;}
 }});await api.readOriginalTaskHostIdentityIO(host,store).initialize();owner=api.createOriginalMainRootAdmissionOwner({roomSource:source,host,store});await owner.room.claimNext();assert.ok(api.readOptionalOriginalMainSdkBridge());
 await host.createTask({prompt:'Bounded fixture answer',materials:[]});await done;await host.drain();
 const db=new(require('node:sqlite').DatabaseSync)(path.join(domain,'root-resource-v1.sqlite'),{readOnly:true});let rows;try{rows=db.prepare('SELECT resource_kind,execution_class,state FROM root_physical_resources').all();}finally{db.close();}
 if(protocol.startsWith('openai-preconsume')){assert.equal(rows.length,1);assert.equal(rows[0].state,'released');await owner.drain();return{actualMain:true,actualPopulationHost:true,requests,models:rows,preconsumeHits,actualNativeVerifyBeforeFault:true,notProductionQualification:true};}
 if(protocol==='openai-sdk-constructor-getter'||(protocol==='openai-sdk-rp-constructor-getter'||protocol==='openai-sdk-rp-species-getter')){assert.equal(sdkGetterCalls,0);assert.ok(rows.every(row=>row.state==='reserved'||row.state==='released'));if(requests>0)assert.ok(rows.every(row=>row.state==='reserved'));return{actualMain:true,actualPopulationHost:true,requests,models:rows,sdkGetterCalls,tagged,invalidSdkMetadataRejected:true,notProductionQualification:true};}assert.equal(requests,protocol==='openai-m4'?5:protocol==='openai-error-other-frame'?2:1);assert.equal(rows.length,requests,'each actual production SDK request requires original M');assert.equal(rows[0].resource_kind,1);assert.equal(rows[0].execution_class,'main_turn');if(protocol==='openai-error-copy'||protocol==='openai-error-getter'||protocol==='openai-error-proxy'||protocol==='openai-error-other-frame'){if(protocol==='openai-error-other-frame')assert.equal(rows[0].state,'released');assert.equal(rows[rows.length-1].state,'reserved');assert.equal(faultCalls,0);return{actualMain:true,actualPopulationHost:true,requests,models:rows,invalidSdkFateHeld:true,faultCalls,notProductionQualification:true};}for(const row of rows)assert.equal(row.state,'released');await owner.drain();return{actualMain:true,actualPopulationHost:true,actualOpenAISdk:true,requests,models:rows,notProductionQualification:true};
}
run().then(async facts=>{for(const close of cleanup.reverse())await close();fs.writeFileSync(result,JSON.stringify({ok:true,pid:process.pid,...facts}));app.exit(0);},async error=>{fs.writeFileSync(result,JSON.stringify({ok:false,pid:process.pid,requests,cause:cause(error)}));app.exit(1);});
