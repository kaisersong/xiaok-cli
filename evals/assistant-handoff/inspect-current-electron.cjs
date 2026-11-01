// No model call: inspect an already-successful real morning, then actual prepare.
const {app}=require('electron'),fs=require('node:fs'),path=require('node:path');
const root=fs.realpathSync(process.argv[2]),session=JSON.parse(fs.readFileSync(path.join(root,'session.json'),'utf8'));
app.setPath('userData',path.join(root,'electron-user-data'));app.setPath('sessionData',path.join(root,'electron-session'));app.disableHardwareAcceleration();
process.env.XIAOK_CONFIG_DIR=path.join(root,'config');process.env.XIAOK_CONVERSATION_ACTIVITY='0';process.env.XIAOK_ASSISTANT_LOCAL_LAUNCH_PILOT='1';
const result={pid:process.pid,modelRequests:0,networkAttempts:0,executionClass:'real_morning_current_reader_and_prepare_only',confirmInvoked:false,errors:[]};
const save=(name,value)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});
save('inspect-current-pid.json',{pid:process.pid,startedAt:new Date().toISOString()});
globalThis.fetch=async()=>{result.networkAttempts++;throw Error('inspection_network_forbidden');};
let services,store,evidence,publication;
(async()=>{try{
 const {register}=await import('tsx/esm/api');register();await app.whenReady();
 const {createDesktopServices}=await import('../../desktop/electron/desktop-services.ts'),{createKSwarmService}=await import('../../desktop/electron/kswarm-service.ts'),{createDesktopReadonlyAuditProfile}=await import('../../desktop/electron/desktop-readonly-audit.ts');
 const kswarm=createKSwarmService();services=createDesktopServices({readonlyAuditProfile:createDesktopReadonlyAuditProfile(root),dataRoot:session.dataRoot,workspaceRoot:fs.realpathSync(session.workspace),kswarmService:kswarm,knowledgeDbPath:path.join(root,'data','knowledge.db'),pluginRootDir:path.join(root,'plugins'),computerUsePreferencePath:path.join(root,'data','computer-use.json')});await services.assistantTaskAdmission.domain();
 const {LoopStore}=await import('../../desktop/electron/loop-store.ts'),{CompletionEvidenceStore}=await import('../../desktop/electron/completion-evidence-store.ts'),{createDesktopLoopPublicationService}=await import('../../desktop/electron/loop-desktop-publication-service.ts'),{createAssistantPublicationContextReader}=await import('../../desktop/electron/assistant-publication-context.ts'),{AssistantLaunchService}=await import('../../desktop/electron/assistant-launch-service.ts');
 const {readInstalledCurrentOwner}=await import('../../src/runtime/verification/installed-owner-state.ts'),{completionConsumerOwner}=await import('../../src/runtime/verification/completion-consumer-owner.ts');
 store=new LoopStore(path.join(root,'data','loop-evidence.sqlite'));evidence=new CompletionEvidenceStore(path.join(root,'data','completion.sqlite'));
 publication=createDesktopLoopPublicationService({store,sessionRoot:path.join(root,'data','publication'),workspaceRoot:fs.realpathSync(session.workspace),captureAdmission:()=>services.captureLoopPublicationAdmission(),taskPort:{recoverTask:id=>services.assistantTaskAdmission.lookup(id)}});
 const reader=createAssistantPublicationContextReader({store,evidenceStore:evidence,publication}),source=await reader.readMorningActionSource('user');if(!source)throw Error('formal_current_source_unavailable');
 result.source={runId:source.runId,sourceVector:source.sourceVector,publishedAt:source.publishedAt,isCurrentObserved:source.isCurrent(),recommendations:source.recommendations};
 const proposal=store.projectAssistantActions(source,Date.now())[0];if(!proposal)throw Error('real_proposal_missing');
 const launch=new AssistantLaunchService({store,port:services.assistantTaskAdmission,readSource:()=>reader.readMorningActionSource('user'),isSourceLaunchable:value=>process.env.XIAOK_ASSISTANT_LOCAL_LAUNCH_PILOT==='1'&&!store.getLoopRunPublicationBasis(value.runId)&&readInstalledCurrentOwner(completionConsumerOwner({ownerKind:'loop_run',ownerId:value.runId})).kind==='ordinary'});
 result.draft=await launch.prepare({proposalId:proposal.id,expectedRevision:proposal.revision,requestSource:'user'});result.operation=(await launch.get({draftId:result.draft.id,requestSource:'user'})).operation;
 if(result.operation)throw Error('prepare_unexpectedly_created_operation');result.kswarmStatus=kswarm.getStatus();
 }catch(error){result.errors.push({name:error.name,code:/^[a-z_]+$/.test(error.message)?error.message:'inspection_failed'});}
 finally{if(publication)await publication.close().catch(()=>result.errors.push({code:'publication_close_unconfirmed'}));if(services)for(const close of [()=>services.closeTaskSourceWritersForMigration(),()=>services.disposeMultiAgent(),()=>services.closeMaterialRegistryAndArtifactFileManagerInstances()])try{await close();}catch{result.errors.push({code:'service_close_unconfirmed'});}if(evidence)evidence.close();if(store)store.close();save('inspect-current-result.json',result);console.log(JSON.stringify({sourceObserved:!!result.source,draftPrepared:!!result.draft,confirmInvoked:false,networkAttempts:result.networkAttempts,errors:result.errors}));app.exit(result.errors.length?2:0);}
})();
