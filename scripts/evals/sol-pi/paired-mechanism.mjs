import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyRecipeEnvironment } from './paired-environment.mjs';

/** Host fixture authorization. This module never constructs an observation body. */
export async function createPairedMechanism({sourceRoot,runDirectory,workspace,task,session,destination,protocol,profileId,recipeEnvironment,command}){
 const load=file=>import(pathToFileURL(join(sourceRoot,file)).href);
 const [{createObservationService},{createObservationSessionOwner,createObservationReadTool,describeObservationSource},{createFullSendCounter},{FileSessionStore},{resolveProductionCapacityProfile}]=await Promise.all([
  load('src/runtime/sol-pi/observation-service.ts'),load('src/runtime/sol-pi/observation-session-owner.ts'),load('src/runtime/sol-pi/full-send-counter.ts'),load('src/ai/runtime/session-store/file-store.ts'),load('src/runtime/sol-pi/capacity-admission.ts')]);
 const environment=await verifyRecipeEnvironment({sourceRoot,...recipeEnvironment,expected:recipeEnvironment,loadProduction:load});
 const capacityProfile=resolveProductionCapacityProfile({destination:destination.url,model:destination.model,protocol,profileId,counter:environment.counter});
 if(!capacityProfile)throw Error('SOLPI_PAIRED_MECHANISM_NOT_QUALIFIED');
 const profileRoot=join(runDirectory,'observation-profile');let service,counter,owner;
 const facts={qualified:false,captures:0,finalized:[],recallCalls:0,recallCompleted:0,recallRejected:0,projection:null,counters:[],profileQualification:'official-deepseek-recipe',environment:environment.identity};
 try{
  service=createObservationService({profileRoot,profileId:'paired-v8',reservedProfileBytes:4*1024*1024,redactor:{version:'paired-fixtures-v1',redact:text=>text}});
  counter=createFullSendCounter({root:join(profileRoot,'full-send-counter'),sessionId:session.exportSnapshot().sessionId});
  const claims={sessionId:session.exportSnapshot().sessionId,ownerAgentId:'paired-cli-owner',scopeId:'fixture-workspace',permissionGeneration:1,surface:'ordinary-owner'};
  const user=service.bindCaller({...claims,requestSource:'user'}),caller=service.bindCaller({...claims,requestSource:'agent'});
  const base={version:1,revision:1,scopeId:claims.scopeId,expiresAt:Date.now()+180000,localPersistence:true,allowUnclassifiedText:true,allowIncomplete:true,destinations:[destination]};
  service.setArchivePolicy({caller:user,requestSource:'user',policy:{...base,id:'fixture-read',sourceAdapterId:'native.read.v1',sourceDescriptors:[],readFileScopes:Object.keys(task.files).map(filePath=>({filePath:resolve(workspace,filePath),startLine:1}))}});
  if(command)service.setArchivePolicy({caller:user,requestSource:'user',policy:{...base,id:'fixture-bash',sourceAdapterId:'native.bash.v1',sourceDescriptors:[describeObservationSource({toolName:'bash',source:{command,workdir:'.'}})]}});
  const observedService=new Proxy(service,{get(target,key){
   if(key==='begin')return input=>{const capture=target.begin(input);facts.captures++;return capture;};
   if(key==='finalize')return input=>{const ref=target.finalize(input);facts.finalized.push({id:ref.id,revision:ref.revision,complete:ref.complete,outcome:ref.outcome,byteLength:ref.byteLength,contentHash:ref.contentHash});return ref;};
   return Reflect.get(target,key);
  }});
  const store=new FileSessionStore(join(runDirectory,'observation-sessions'));
  owner=createObservationSessionOwner({service:observedService,caller,session,destination,capacityProfile,fullSendCounter:counter,persist:snapshot=>store.save(snapshot)});
  const nativeRecallTool=createObservationReadTool(owner),execute=nativeRecallTool.execute;
  const recallTool={...nativeRecallTool};
  recallTool.execute=async(...args)=>{facts.recallCalls++;try{const result=await execute(...args);facts.recallCompleted++;return result;}catch(error){facts.recallRejected++;throw error;}};
  facts.qualified=true;
  return {owner,recallTool,diagnostics(){return {...facts,finalized:[...facts.finalized],projection:owner.getProjectionDiagnostics(),counters:[...new Set(facts.finalized.map(ref=>ref.id))].map(id=>({id,fullLogicalSendCount:counter.read(id)}))};},dispose(){try{owner.dispose();}finally{try{counter.dispose();}finally{service.dispose();}}}};
 }catch(error){try{owner?.dispose();}finally{try{counter?.dispose();}finally{service?.dispose();}}throw error;}
}
