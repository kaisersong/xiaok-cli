const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const [root,sourceRoot,indexText]=process.argv.slice(2),index=Number(indexText);
const session=JSON.parse(fs.readFileSync(path.join(root,'session.json'),'utf8'));
for(const p of ['electron-user-data','electron-session','plugins'])fs.mkdirSync(path.join(root,p),{recursive:true,mode:0o700});
app.setPath('userData',path.join(root,'electron-user-data'));app.setPath('sessionData',path.join(root,'electron-session'));app.disableHardwareAcceleration();
process.env.XIAOK_CONFIG_DIR=path.join(root,'config');process.env.XIAOK_CONVERSATION_ACTIVITY='0';process.env.XIAOK_ASSISTANT_LOCAL_LAUNCH_PILOT='1';
const output={schemaVersion:1,pid:process.pid,startedAt:new Date().toISOString(),executionClass:'real_backend_current_morning_and_C_not_UI_or_pilot',humanOperations:null,userElapsedMs:null,requests:[],rows:[],errors:[],manualReview:'unreviewed',pilotPassed:false};
const save=(name,value)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});
save('live-worker-pid.json',{pid:process.pid,startedAt:output.startedAt});
const config=JSON.parse(fs.readFileSync(path.join(root,'config','config.json'),'utf8')),provider=Object.values(config.providers)[0],endpoint=new URL(provider.baseUrl),originalFetch=globalThis.fetch;
const redact=text=>String(text).split(provider.apiKey).join('[credential-redacted]');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
let networkFence=null,requestBytes=0;const captures=[];
globalThis.fetch=async(input,init)=>{
 if(networkFence)throw Error('live_network_fenced_after_failure');
 const request=new Request(input,init),url=new URL(request.url);
 if(url.origin!==endpoint.origin||!url.pathname.endsWith('/chat/completions')||request.method!=='POST')throw Error('live_non_model_network_denied');
 if(output.requests.length>=8)throw Error('live_model_request_budget');
 const body=JSON.parse(await request.clone().text()),tools=(body.tools??[]).map(tool=>tool.function?.name);
 if(tools.some(name=>name!=='read'))throw Error('live_tool_scope_breach');
 const cap=Math.min(body.max_tokens??body.max_completion_tokens??1200,1200);
 body.max_tokens=cap; // Real provider-enforced transport cap, never a fabricated response.
 const serialized=JSON.stringify(body),bytes=Buffer.byteLength(serialized);if(requestBytes+bytes>100000){networkFence='input_byte_budget';throw Error('live_input_byte_budget');}requestBytes+=bytes;
 const row={ordinal:output.requests.length+1,at:new Date().toISOString(),model:body.model,tools,maxOutputTokens:cap,inputBytes:bytes,requestSha256:hash(JSON.stringify(body)),usage:null};output.requests.push(row);
 save(`request-${row.ordinal}.json`,body);
 let response;
 try{response=await originalFetch(request.url,{method:'POST',headers:request.headers,body:JSON.stringify(body),signal:request.signal,redirect:'error'});}catch(error){networkFence='transport_unknown';throw error;}
 row.httpStatus=response.status;if(!response.ok)networkFence=response.status===429?'quota_or_rate_limit':'provider_error';
 const capture=import('./provider-capture.mjs').then(({captureProviderResponse})=>captureProviderResponse(response,{file:path.join(root,`response-${row.ordinal}.sse`),redact})).then(captured=>Object.assign(row,captured)).catch(error=>{row.capture='unknown';row.captureError={name:error.name,detail:redact(error.message).slice(0,160)};});captures.push(capture);return response;
};
let services,kswarm,store,evidence,publication,launch;const taskIds=[];
(async()=>{try{
 const {register}=await import('tsx/esm/api');register();await app.whenReady();
 const {createDesktopReadonlyAuditProfile}=await import('../../desktop/electron/desktop-readonly-audit.ts');
 const profile=createDesktopReadonlyAuditProfile(root);
 const {createDesktopServices}=await import('../../desktop/electron/desktop-services.ts');const {createKSwarmService}=await import('../../desktop/electron/kswarm-service.ts');
 kswarm=createKSwarmService();services=createDesktopServices({readonlyAuditProfile:profile,dataRoot:session.dataRoot,workspaceRoot:fs.realpathSync(session.workspace),kswarmService:kswarm,knowledgeDbPath:path.join(root,'data','knowledge.db'),pluginRootDir:path.join(root,'plugins'),computerUsePreferencePath:path.join(root,'data','computer-use.json')});
 await services.assistantTaskAdmission.domain();
 const {LoopStore}=await import('../../desktop/electron/loop-store.ts'),{CompletionEvidenceStore}=await import('../../desktop/electron/completion-evidence-store.ts');
 const {createAssistantRuntime}=await import('../../desktop/electron/assistant-runtime.ts'),{createDesktopLoopLLMPort}=await import('../../desktop/electron/loop-llm-port-impl.ts');
 const {createAssistantDesktopSnapshotReader}=await import('../../desktop/electron/assistant-desktop-snapshot.ts'),{readAssistantTaskMetadata}=await import('../../desktop/electron/assistant-task-source.ts');
 const {createDesktopLoopPublicationService}=await import('../../desktop/electron/loop-desktop-publication-service.ts'),{createAssistantPublicationContextReader}=await import('../../desktop/electron/assistant-publication-context.ts');
 const {AssistantLaunchService}=await import('../../desktop/electron/assistant-launch-service.ts');
 const {readInstalledCurrentOwner}=await import('../../src/runtime/verification/installed-owner-state.ts'),{completionConsumerOwner}=await import('../../src/runtime/verification/completion-consumer-owner.ts');
 const {ASSISTANT_MORNING_LOOP_ID,DEFAULT_PERSONAL_ASSISTANT_ID}=await import('../../desktop/electron/assistant-types.ts');
 const previous=JSON.parse(fs.readFileSync(path.join(sourceRoot,'prepared-prepare.json'),'utf8')),caseRow=previous.rows[index];
 if(!caseRow)throw Error('real_prepared_source_missing');
 const now=Date.now();store=new LoopStore(path.join(root,'data','loop-evidence.sqlite'));evidence=new CompletionEvidenceStore(path.join(root,'data','completion.sqlite'));
 store.ensureBuiltInLoops(now);store.ensureAssistantProfile({id:DEFAULT_PERSONAL_ASSISTANT_ID,status:'active',locale:'zh',timeZone:'UTC',eveningTime:'22:30',morningTime:'08:30',workdays:[0,1,2,3,4,5,6],quietHours:{start:'23:00',end:'07:00'},dataScopes:['tasks'],createdAt:now,updatedAt:now});store.setLoopStatus(ASSISTANT_MORNING_LOOP_ID,'active',now);
 const forbidden=()=>{throw Error('disabled_source_must_not_be_read');};
 const reader=createAssistantDesktopSnapshotReader({listTaskSnapshots:query=>{const receipt=readAssistantTaskMetadata(path.join(sourceRoot,'data'),query);return {...receipt,items:receipt.items.filter(item=>item.id===caseRow.taskId)};},listKSwarmProjects:forbidden,listTimedActions:forbidden,listMeetingMetadata:forbidden,listKnowledgeSourceMetadata:forbidden});
 const runtime=createAssistantRuntime({loopStore:store,evidenceStore:evidence,llmPort:createDesktopLoopLLMPort(),collect:async input=>{
  const snapshot=await reader.collect(input);if(!snapshot.items.some(item=>item.reference.id===caseRow.taskId))throw Error('real_source_not_in_snapshot');save('morning-source-snapshot.json',snapshot);
  return {current:snapshot,evaluationContext:{authorizedReadonlyRequest:previous.rows[index].checkpoint.prompt,sourcePath:JSON.parse(fs.readFileSync(path.join(root,'plan.json'),'utf8')).rows.find(row=>row.caseId===caseRow.caseId).instruction,workspace:fs.realpathSync(session.workspace),instruction:'用户已授权只读源码审查。建议只引用该真实准备中断任务，整理其原始审查要求为一个可确认的review任务，明确需要在当前workspace中使用read读取源码；不要修复原任务或修改任何数据。最多一条。'}};
 }});
 const morning=await runtime.runLoopNow(ASSISTANT_MORNING_LOOP_ID,undefined,AbortSignal.timeout(65000),{requestSource:'user'});save('morning-receipt.json',morning);if(morning.status!=='success'||networkFence)throw Error('real_morning_unconfirmed');
 await Promise.all(captures);if(output.requests.some(row=>!row.usage||row.capture!=='complete'))throw Error('morning_usage_unknown_stop');
 publication=createDesktopLoopPublicationService({store,sessionRoot:path.join(root,'data','publication'),workspaceRoot:fs.realpathSync(session.workspace),captureAdmission:()=>services.captureLoopPublicationAdmission(),taskPort:{recoverTask:taskId=>services.assistantTaskAdmission.lookup(taskId)}});
 const context=createAssistantPublicationContextReader({store,evidenceStore:evidence,publication});
 const source=await context.readMorningActionSource('user');if(!source)throw Error('formal_current_source_unavailable');
 save('current-source-observation.json',{runId:source.runId,sourceVector:source.sourceVector,publishedAt:source.publishedAt,recommendations:source.recommendations,isCurrentObserved:source.isCurrent()});
 const proposals=store.projectAssistantActions(source,Date.now());if(proposals.length!==1)throw Error('single_real_proposal_required');
 launch=new AssistantLaunchService({store,port:services.assistantTaskAdmission,readSource:()=>context.readMorningActionSource('user'),isSourceLaunchable:value=>process.env.XIAOK_ASSISTANT_LOCAL_LAUNCH_PILOT==='1'&&!store.getLoopRunPublicationBasis(value.runId)&&readInstalledCurrentOwner(completionConsumerOwner({ownerKind:'loop_run',ownerId:value.runId})).kind==='ordinary'});
 const draft=await launch.prepare({proposalId:proposals[0].id,expectedRevision:proposals[0].revision,requestSource:'user'});save('launch-draft.json',draft);
 const started=performance.now(),operation=await launch.confirm({draftId:draft.id,instruction:draft.instruction,requestSource:'user'});save('launch-confirm-receipt.json',operation);if(!operation.taskId)throw Error('launch_task_unknown');taskIds.push(operation.taskId);
 let needsInput=null;
 for await(const event of services.subscribeTask(operation.taskId,{signal:AbortSignal.timeout(130000)})){
  if(event.type==='needs_user'){needsInput={questionId:event.question.questionId};break;}
  if(event.type==='task_terminal')break;
 }
 const lookup=await launch.get({draftId:draft.id,requestSource:'user'}),snapshot=await services.assistantTaskAdmission.lookup(operation.taskId);save('launch-final-lookup.json',lookup);save('actual-task-snapshot.json',snapshot);
 await Promise.all(captures);
 const readEvents=snapshot?.events.filter(event=>event.type.includes('tool'))??[];
 output.rows.push({path:'C',caseId:caseRow.caseId,taskId:operation.taskId,operationId:operation.operationId,threadId:operation.threadId,draftId:draft.id,instruction:draft.instruction,status:needsInput?'needs_input':snapshot?.status??'unknown',needsInput,autogrant:false,assistantBindingMatches:snapshot?.assistantBinding?.operationId===operation.operationId,toolEventCount:readEvents.length,backendElapsedMs:performance.now()-started,humanOperations:null,userElapsedMs:null,usage:snapshot?.usage??'unknown',manualReview:'unreviewed'});
 if(needsInput)throw Error('needs_input');if(snapshot?.status!=='completed'||snapshot?.usage?.known!==true||networkFence)throw Error('task_or_usage_unconfirmed_stop');
 if(!readEvents.length)throw Error('no_real_tool_evidence_stop');
 }catch(error){output.errors.push({name:error.name,code:/^[a-z_]+$/.test(error.message)?error.message:'runtime_or_provider_failure',detail:redact(error.message).slice(0,400)});}
 finally{
  if(services){for(const taskId of taskIds){try{const snapshot=await services.assistantTaskAdmission.lookup(taskId);if(snapshot&&!['completed','failed','cancelled'].includes(snapshot.status))await services.cancelTask(taskId,'owned_eval_cleanup');}catch{output.errors.push({code:'task_cleanup_unconfirmed'});}}}
  if(publication)await publication.close().catch(()=>output.errors.push({code:'publication_close_unconfirmed'}));
  if(services){for(const close of [()=>services.closeTaskSourceWritersForMigration(),()=>services.disposeMultiAgent(),()=>services.closeMaterialRegistryAndArtifactFileManagerInstances()])try{await close();}catch{output.errors.push({code:'service_close_unconfirmed'});}}
  await Promise.allSettled(captures);if(evidence)evidence.close();if(store)store.close();
  output.networkFence=networkFence;output.kswarmStatus=kswarm?.getStatus();output.finishedAt=new Date().toISOString();save('live-result.json',output);
  console.log(JSON.stringify({rows:output.rows.map(row=>({path:row.path,status:row.status,taskId:row.taskId})),requests:output.requests.length,errors:output.errors.map(error=>error.code),pilotPassed:false}));app.exit(output.errors.length?2:0);
 }
})();
