import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,copyFileSync,lstatSync,realpathSync} from 'node:fs';
import {join,resolve,dirname,relative,isAbsolute} from 'node:path';
import {tmpdir,homedir} from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

export const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
export const digest=value=>createHash('sha256').update(value).digest('hex');
export const readJson=path=>JSON.parse(readFileSync(path,'utf8'));
export function save(path,value){writeFileSync(path,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});}
export function inside(root,path){const rel=relative(realpathSync(root),realpathSync(path));return rel!==''&&!rel.startsWith('..')&&!isAbsolute(rel);}
export function protocol(){return readJson(join(repo,'evals/assistant-handoff/cases.json'));}
// Freeze these rules before any measurement. Planned human actions are never measured actions.
export function makePlan(cases=protocol().cases){
 const rows=[];
 for(const c of cases)for(const path of ['A','B','C'])rows.push({id:`abc-${c.id}-${path}`,caseId:c.id,path,cohort:'abc',scenario:'ordinary',status:'not_run',instruction:c.instruction,instructionDigest:digest(c.instruction)});
 const scenarios=['ordinary','double_confirm','lookup_after_reply_loss','restart_lookup','blocked_repair'];
 for(let i=0;i<20;i++){const c=cases[i%cases.length];rows.push({id:`handoff-${String(i+1).padStart(2,'0')}-${c.id}`,caseId:c.id,path:'C',cohort:'handoff',scenario:scenarios[Math.floor(i/4)],status:'not_run',instruction:c.instruction,instructionDigest:digest(c.instruction)});}
 return {schemaVersion:1,createdAt:new Date().toISOString(),dataClass:'planned_real_repo_cases_not_executed',rows,
  budgets:{maxRootAdmissions:50,maxConcurrent:1,maxTaskMs:120000,maxWallMs:7200000,maxToolIterations:6,maxKnownTotalTokens:100000,maxKnownCostUsd:5,unknownUsage:'stop_before_next_admission',unknownPrice:'no_currency_claim',note:'These are harness stop limits, not a provider token or currency hard cap. C currently has no per-task iteration limit port; gate required.'},
  metrics:{humanOperations:'observed semantic user actions; unknown without real UI trace',apiCalls:'separate from human operations',elapsedMs:'monotonic service duration; UI duration separately observed',cost:'provider usage plus frozen pricing; unknown is not zero'},
  acceptance:{abc:'10 matched case triplets with same instruction/workspace/criteria and real user interaction evidence',handoff:'20 authorized attempts, with genuine rejection/block/repair/restart evidence; do not count 20 successful ordinary calls as coverage',duplicateActualExecutions:0,noFalseSuccess:true,unknowns:'locatable or manual_repair',benefit:'only paired, human-observed and accepted outputs; never API timing as UI benefit'}};
}

export async function preflight(){
 const evidence=[];
 const capture=(file,start,end,claim)=>{const bytes=readFileSync(join(repo,file));const lines=bytes.toString('utf8').split('\n');evidence.push({file,sha256:digest(bytes),start,end,claim,source:lines.slice(start-1,end).map((v,i)=>`${start+i}: ${v}`).join('\n')});};
 // Locate current lines because other agents may be editing this worktree.
 const locate=(file,needle,after,claim)=>{const lines=readFileSync(join(repo,file),'utf8').split('\n'),i=lines.findIndex(x=>x.includes(needle));if(i<0)throw Error('source_evidence_changed_requires_review');capture(file,i+1,Math.min(lines.length,i+1+after),claim);};
 locate('desktop/electron/desktop-services.ts','const registry = auditRegistry?.registry',1,'Ordinary registry remains unchanged; isolated eval composes a branded closed native readonly registry.');
 locate('desktop/electron/desktop-services.ts','const defaultDesktopModelRunner =',22,'Real default model runner composition and audit admission guard.');
 locate('desktop/electron/desktop-services.ts','if (!nativeReadonlyOnly && !runnerOptions.restrictedArtifactGeneration)',25,'Ordinary runner registers project/report/notebook tools.');
 locate('desktop/electron/desktop-multi-agent-catalog-bridge.ts','for (const item of this.slots.values()) if (item.present)',0,'Root authorizes all present capability slots.');
 locate('desktop/electron/assistant-desktop-admission.ts',"permissionMode:'default'",1,'Assistant admission forces default permission, not a read-only tool ceiling.');
 locate('desktop/electron/desktop-services.ts','type KSwarmScopedTaskOptions',12,'nativeReadonlyOnly belongs to separate scoped KSwarm host construction.');
 locate('src/utils/config.ts','tightenBestEffort(path);',8,'Production config loader can chmod/backup original config; do not invoke it on user config.');
 let model={status:'unavailable'};
 const configPath=join(process.env.XIAOK_CONFIG_DIR??join(homedir(),'.xiaok'),'config.json');
 try{
  // Direct read only: no loadConfig(), no chmod, migration, adapter, or request.
  const raw=readJson(configPath);
  const {resolveRuntimeModelBinding}=await import('../../src/ai/providers/control-plane.ts');
  const binding=resolveRuntimeModelBinding(raw);
  model={status:'configured_not_called',providerId:binding.providerId,providerType:binding.providerType,modelId:binding.modelId,wireModel:binding.wireModel,protocol:binding.protocol,credentialPresent:!!binding.apiKey};
 }catch{model={status:'configuration_unavailable_or_unresolved',reason:'inspect_config_in_main_without_logging_secrets'};}
 return {schemaVersion:1,at:new Date().toISOString(),repo,head:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),sourceState:'working_tree_hashes_are_authoritative',model,modelCalls:0,ready:false,
  blockers:[
   {code:'live_usage_unknown_expansion_stopped',required:'First real morning completed HTTP200 but transport capture did not prove usage. Retain unknown cost; do not expand or replay to fill counts.'},
   {code:'profile_requires_private_main_composition',required:'Use live-run private selected-model config and the branded audit profile; no IPC/task input mode selector.'},
   {code:'live_provider_usage_required',required:'Audit runner has six tool iterations/120s and maxOutputTokens1000; real transport/usage evidence is still required before expansion.'},
   {code:'real_ui_observation_missing',required:'main harness touchpoints plus actual user/browser/native UI trace for A/B/C operation counts; no simulated clicks'},
   {code:'real_current_proposal_missing',required:'C must use current ordinary publication/context reader with genuine refs; synthetic source callbacks cannot count as full real C'}],evidence};
}

export function prepare(outParent=tmpdir()){
 const root=mkdtempSync(join(resolve(outParent),'assistant-handoff-'));
 const workspace=join(root,'workspace'),dataRoot=join(root,'data'),configDir=join(root,'config');
 for(const dir of [workspace,dataRoot,configDir])mkdirSync(dir,{mode:0o700});
 const manifest=[];
 // Snapshot only the ten explicitly authorized review files, never .git, keys, symlinks or user data.
 for(const c of protocol().cases){const source=join(repo,c.source);if(!inside(repo,source)||!lstatSync(source).isFile()||lstatSync(source).isSymbolicLink())throw Error('unsafe_case_source');const target=join(workspace,c.source);mkdirSync(dirname(target),{recursive:true,mode:0o700});copyFileSync(source,target);manifest.push({caseId:c.id,path:c.source,sha256:digest(readFileSync(source))});}
 const plan=makePlan();save(join(root,'plan.json'),plan);save(join(root,'source-manifest.json'),manifest);
 save(join(root,'session.json'),{schemaVersion:1,root,workspace,dataRoot,configDir,createdAt:new Date().toISOString(),credentialsCopied:false,servicesStarted:false,modelCalls:0,sourceManifestDigest:digest(JSON.stringify(manifest)),pid:process.pid,ownership:'Only this dedicated root may be changed. No source repo permissions modified.'});
 return root;
}

export function summarize(root){
 const plan=readJson(join(root,'plan.json'));
 let events=[];try{events=readFileSync(join(root,'events.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);}catch(error){if(error.code!=='ENOENT')throw error;}
 const terminals=events.filter(e=>e.type==='measurement');
 const byId=new Map();for(const e of terminals){if(byId.has(e.rowId))throw Error('duplicate_measurement_record');byId.set(e.rowId,e);}
 for(const e of terminals)if(!plan.rows.some(r=>r.id===e.rowId))throw Error('unplanned_row');
 const actual=terminals.filter(e=>e.dataClass==='real_model_execution'&&e.terminalStatus==='completed'&&e.acceptance?.reviewed===true&&e.acceptance?.passed===true);
 const human=actual.filter(e=>e.humanObservation?.kind==='real_ui_trace'&&e.humanObservation?.operations!==null);
 return {schemaVersion:1,planned:plan.rows.length,recorded:terminals.length,notRun:plan.rows.length-byId.size,realCompletedReviewed:actual.length,humanObserved:human.length,modelRequests:'unknown_unless_provider_evidence',uiEfficiencyBenefit:null,benefitReason:'Do not calculate benefit from API duration, planned clicks, incomplete triplets or unreviewed outputs.',rows:plan.rows.map(r=>({id:r.id,path:r.path,cohort:r.cohort,scenario:r.scenario,result:byId.get(r.id)??{status:'not_run',usage:'unknown',humanOperations:null}}))};
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 const [command,arg]=process.argv.slice(2);
 if(command==='preflight'){const result=await preflight();if(arg)save(resolve(arg),result);console.log(JSON.stringify(result,null,2));process.exitCode=result.ready?0:2;}
 else if(command==='prepare')console.log(prepare(arg));
 else if(command==='report'&&arg)console.log(JSON.stringify(summarize(resolve(arg)),null,2));
 else{console.error('node --import tsx evals/assistant-handoff/harness.mjs preflight [new-output.json] | prepare [existing-output-parent] | report <session-root>');process.exitCode=1;}
}
