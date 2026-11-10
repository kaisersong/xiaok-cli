import ts from 'typescript';
import {readFileSync,existsSync,realpathSync} from 'node:fs';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const PLAN='7254fc52300c3dde48aa466bd1d17985695b91e30ef0e263a39a5f8a5bb68f74';
const RETAINED_COUNT=535,RETAINED_SHA='10e986ea49590c790d8153cce102e32c4e8057aeadb9e4d1fafc158e6b66e3b3';
const sha=value=>createHash('sha256').update(value).digest('hex');
const fail=message=>{throw Error('DSH_PRODUCER_REGISTRATION: '+message);};
function stringSet(values,label){if(!Array.isArray(values)||values.some(x=>typeof x!=='string'||!x)||new Set(values).size!==values.length)fail(label+' must contain unique nonempty strings');return new Set(values);}
function exact(actual,expected,label){const a=stringSet(actual,label+' actual'),b=stringSet(expected,label+' registered');const missing=[...a].filter(x=>!b.has(x)),stale=[...b].filter(x=>!a.has(x));if(missing.length||stale.length)fail(label+' missing='+missing.join(',')+' stale='+stale.join(','));}
function ast(text,file){const sf=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);if(sf.parseDiagnostics.length)fail(file+' syntax invalid');return sf;}
export function readRegistrationLiteral(text){
 const sf=ast(text,'hub-producer-registration.js');let value;
 function walk(node){if(ts.isVariableDeclaration(node)&&node.name.getText(sf)==='HUB_PRODUCER_REGISTRATION'){
  if(value||!ts.isCallExpression(node.initializer)||node.initializer.expression.getText(sf)!=='deepFreeze'||node.initializer.arguments.length!==1||!ts.isObjectLiteralExpression(node.initializer.arguments[0]))fail('registration must be one fixed data literal');
  try{value=JSON.parse(node.initializer.arguments[0].getText(sf));}catch{fail('registration must be strict JSON data');}
 }ts.forEachChild(node,walk);}walk(sf);if(!value)fail('registration missing');return value;
}
export function readHubRegistrationFacts(text){
 const sf=ast(text,'hub.js'),facts={mutations:[],explicitPublic:[],publicAssignments:[],restoreProtocols:[],recoveryForwards:[],recoveryTargets:[],targetCases:[],executionReference:false,migrationReference:false};
 function walk(node){
  if(ts.isVariableDeclaration(node)&&node.name.getText(sf)==='mutations'){
   if(!ts.isObjectLiteralExpression(node.initializer))fail('mutation table must be an original fixed object');
   for(const p of node.initializer.properties){if(!p.name||ts.isComputedPropertyName(p.name))fail('computed/spread mutation requires explicit owner review');facts.mutations.push(p.name.getText(sf));}
  }
  if(ts.isVariableDeclaration(node)&&node.name.getText(sf)==='publicApi'&&ts.isObjectLiteralExpression(node.initializer))for(const p of node.initializer.properties)if(p.name){if(ts.isComputedPropertyName(p.name))fail('computed public API requires explicit registration');facts.explicitPublic.push(p.name.getText(sf));}
  if(ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.EqualsToken&&ts.isPropertyAccessExpression(node.left)&&node.left.expression.getText(sf)==='publicApi')facts.publicAssignments.push(node.left.name.text);
  if(ts.isPropertyAccessExpression(node)&&node.expression.getText(sf)==='HUB_PRODUCER_REGISTRATION'){
   if(node.name.text==='executionStart')facts.executionReference=true;if(node.name.text==='migrationSafe')facts.migrationReference=true;
  }
  if(ts.isBinaryExpression(node)&&ts.isPropertyAccessExpression(node.left)&&node.left.getText(sf)==='p.requiredProtocol'&&ts.isStringLiteral(node.right)&&!facts.restoreProtocols.includes(node.right.text))facts.restoreProtocols.push(node.right.text);
  if(ts.isSwitchStatement(node)&&node.expression.getText(sf)==='registration.target')for(const clause of node.caseBlock.clauses)if(ts.isCaseClause(clause)&&ts.isStringLiteral(clause.expression))facts.targetCases.push(clause.expression.text);
  if(ts.isIfStatement(node)&&ts.isBinaryExpression(node.expression)&&node.expression.left.getText(sf)==='name'&&ts.isStringLiteral(node.expression.right)&&ts.isReturnStatement(node.thenStatement)&&node.thenStatement.expression&&ts.isCallExpression(node.thenStatement.expression)){
   facts.recoveryForwards.push(node.expression.right.text);facts.recoveryTargets.push({name:node.expression.right.text,target:node.thenStatement.expression.expression.getText(sf)});
  }
  ts.forEachChild(node,walk);
 }walk(sf);if(!facts.mutations.length||!facts.explicitPublic.length)fail('original Hub tables not located');return facts;
}
/** Pure diagnostics only. Passing a fabricated surface grants no runtime role. */
export function validateHubProducerRegistration(registration,surface,facts){
 if(registration?.schemaVersion!==1)fail('unsupported registration schema');
 if(!stringSet(registration.requiredRuntimeCases,'required runtime cases').size)fail('required runtime cases cannot be empty');
 exact(surface.publicKeys,registration.publicKeys,'public API');exact(surface.mutations,registration.mutations,'runtime mutations');exact(facts.mutations,registration.mutations,'source mutations');
 const keys=stringSet(registration.publicKeys,'public keys');for(const name of [...facts.explicitPublic,...facts.publicAssignments])if(!keys.has(name))fail('unregistered explicit public API '+name);
 exact(Object.keys(surface.ports),Object.keys(registration.ports),'public ports');for(const name of Object.keys(surface.ports))exact(surface.ports[name],registration.ports[name],'port '+name);
 exact(facts.restoreProtocols,registration.restoreProtocols,'restored protocols');
 for(const tag of ['executionStart','recovery','migrationSafe','ordinarySpecialMutations'])for(const name of stringSet(registration[tag],tag))if(!keys.has(name))fail(tag+' references an unknown public API '+name);
 if(!facts.executionReference||!facts.migrationReference)fail('original runtime must consume the same execution/migration registry');
 const recovery=stringSet(registration.recovery,'recovery');for(const name of facts.recoveryForwards)if(!recovery.has(name))fail('unregistered early recovery '+name);
 for(const row of facts.recoveryTargets)if(row.name!==row.target)fail('early recovery must preserve its original registered handler '+row.name);
 for(const name of ['handleRecoverSubmission','handleResetTaskForRecovery','handleResumeTaskForRecovery','handleResumeSuspendedRuns','recoverInterruptedTaskWorkflows'])if(!recovery.has(name))fail('original recovery omitted '+name);
 for(const name of ['mutateProjectState','dispatchWorkspaceTask','applyWorkspaceMapping','submitWorkspaceTaskResult'])if(!registration.ordinarySpecialMutations.includes(name))fail('original mutation sibling omitted '+name);
 const producerNames=[...registration.publicKeys];for(const name of Object.keys(registration.ports))for(const method of registration.ports[name])producerNames.push(name+'.'+method);
 if(!Array.isArray(registration.producers))fail('explicit producer descriptors missing');exact(registration.producers.map(row=>row.name),producerNames,'producer descriptors');
 const targetKinds=new Set(['project_arg0','workflow_run_arg0','workflow_proposal_arg0','object_workflow_run_id','domain','none']),policies=new Set(['deny','original_owner','original_reader']);
 exact(facts.targetCases,[...targetKinds],'runtime closed target cases');
 const classes=new Set(['control','room_discussion','room_project','kswarm_direct','workflow_root','dsh_draft','nested_subagent','admission_probe','live_preview','snapshot_prep','tool_worker','main_turn','goal_turn','material_turn','canvas_turn']);
 const mutations=new Set([...registration.mutations,...registration.ordinarySpecialMutations]);
 for(const row of registration.producers){
  exact(Object.keys(row),['name','surfaces','target','dsh','executionClass','requirementRefs','positiveTests','negativeTests'],'descriptor fields '+row.name);
  const expected=['public'];if(mutations.has(row.name))expected.push('mutation');if(registration.executionStart.includes(row.name))expected.push('execution_start');if(registration.recovery.includes(row.name))expected.push('recovery');exact(row.surfaces,expected,'descriptor surfaces '+row.name);
  if(!targetKinds.has(row.target)||!policies.has(row.dsh)||!classes.has(row.executionClass))fail('unknown descriptor tag '+row.name);
  if(mutations.has(row.name)&&(row.dsh!=='deny'||row.target==='none'||row.target==='domain'))fail('original mutation guard downgraded '+row.name);
  for(const key of ['requirementRefs','positiveTests','negativeTests']){if(!stringSet(row[key],key+' '+row.name).size)fail('empty descriptor '+key);for(const ref of row[key])if(!registration[key].includes(ref))fail('dangling descriptor '+key+' '+ref);}
 }
 return {publicApi:surface.publicKeys.length,mutations:surface.mutations.length,ports:Object.keys(surface.ports).length};
}
/** Check the actual returned surface as well as the pre-wrapper private
 * snapshot: a late Object.assign must not disappear from CI coverage. */
export function validateReturnedHubProducerSurface(hub,surface){
 exact(Reflect.ownKeys(hub),surface.publicKeys,'returned public API');
 for(const name of Object.keys(surface.ports)){
  const slot=Object.getOwnPropertyDescriptor(hub,name);if(!slot||!Object.hasOwn(slot,'value')||!slot.value||typeof slot.value!=='object')fail('returned port descriptor '+name);
  exact(Reflect.ownKeys(slot.value),surface.ports[name],'returned port '+name);
  for(const key of surface.ports[name]){const d=Object.getOwnPropertyDescriptor(slot.value,key);if(!d||!Object.hasOwn(d,'value')||typeof d.value!=='function')fail('returned port method '+name+'.'+key);}
 }
}
export function validateRetainedEntrypoints(manifest){
 if(manifest.approvedPlanSha256!==PLAN||manifest.complete!==false||manifest.currentAutoEligible!==false||!Array.isArray(manifest.entries))fail('inventory must retain the frozen plan and unqualified status');
 const additions=stringSet(manifest.producerRegistrationChecks?.[0]?.newEntrypointKeys??[],'new entrypoint keys'),keys=manifest.entries.map(row=>JSON.stringify([row.repo,row.file,row.entrypoint]));stringSet(keys,'entrypoint identity');
 for(const key of additions)if(!keys.includes(key))fail('new entrypoint identity missing from manifest');const retained=keys.filter(key=>!additions.has(key)).sort();
 if(retained.length!==RETAINED_COUNT||sha(retained.join('\n')+'\n')!==RETAINED_SHA)fail('original 535 entrypoint identities changed or dropped');return retained.length;
}
export function assertExecutedRegistrationCases(tap,required){
 const passed=new Set();for(const line of tap.split('\n')){const match=/^ok\s+\d+\s+-\s+(.+)$/.exec(line.trim());if(match&&!/\s#\s*(?:SKIP|TODO)\b/i.test(match[1]))passed.add(match[1]);}
 for(const name of stringSet(required,'required runtime cases'))if(!passed.has(name))fail('required original runtime case did not pass: '+name);
 return required.length;
}
function inside(root,file){const path=resolve(root,file);if(!existsSync(path))fail('missing registered file '+file);const real=realpathSync(path),rel=relative(root,real);if(!rel||rel.startsWith('..')||isAbsolute(rel))fail('outside registered file '+file);return real;}
export async function checkDshProducerRegistration({kswarmRoot,docsRoot}){
 if(!kswarmRoot||!docsRoot)fail('explicit kswarmRoot and docsRoot are required; no primary fallback');
 const [major,minor]=process.versions.node.split('.').map(Number);if(major<22||major===22&&minor<22)fail('actual KSwarm surface requires its declared minimum Node 22.22.0');
 kswarmRoot=realpathSync(kswarmRoot);docsRoot=realpathSync(docsRoot);
 const registrationPath=inside(kswarmRoot,'src/core/hub-producer-registration.js'),hubPath=inside(kswarmRoot,'src/core/hub.js'),registrationBytes=readFileSync(registrationPath),hubBytes=readFileSync(hubPath),registration=readRegistrationLiteral(registrationBytes.toString()),facts=readHubRegistrationFacts(hubBytes.toString());
 const manifest=JSON.parse(readFileSync(inside(docsRoot,'design/dsh-implementation/entrypoint-manifest.json'),'utf8')),retained=validateRetainedEntrypoints(manifest),check=manifest.producerRegistrationChecks?.[0];
 if(check?.id!=='kswarm.hub_producer_v1'||check.registryFile!=='src/core/hub-producer-registration.js'||check.registrySha256!==sha(registrationBytes))fail('manifest registry reference is missing or stale');
 const catalog=JSON.parse(readFileSync(inside(docsRoot,'design/dsh-implementation/requirements-catalog.json'),'utf8')),contract=JSON.parse(readFileSync(inside(docsRoot,'design/dsh-implementation/contract-index.json'),'utf8'));
 if(catalog.source?.sha256!==PLAN||contract.source?.sha256!==PLAN)fail('catalog plan identity changed');
 for(const ref of stringSet(registration.requirementRefs,'requirement refs')){const a=catalog.blocks.find(row=>row.id===ref),b=contract.requirements.find(row=>row.id===ref);if(!a||!b||a.sha256!==b.sha256||a.line!==b.sourceLine)fail('missing/mismatched original requirement '+ref);}
 for(const name of ['positiveTests','negativeTests']){if(!registration[name]?.length)fail('missing '+name);for(const file of stringSet(registration[name],name))inside(kswarmRoot,file);}
 // Actual original constructor + fixed private metadata reader covers spreads;
 // a literal reference search cannot supply this fact.
 const api=await import(pathToFileURL(hubPath).href+'?producer-registration='+sha(hubBytes));let hub,result;
 try{hub=api.createHub({silent:true});const surface=api.readOriginalHubProducerSurface(hub);validateReturnedHubProducerSurface(hub,surface);result=validateHubProducerRegistration(registration,surface,facts);}finally{hub?.closePersistence();}
 if(sha(readFileSync(hubPath))!==sha(hubBytes)||sha(readFileSync(registrationPath))!==sha(registrationBytes))fail('source changed during the check');
 return {schemaVersion:1,...result,retainedEntrypoints:retained,registrySha256:sha(registrationBytes),sourceSha256:sha(hubBytes),hubBoundaryRegistrationComplete:true,semanticClosureComplete:false,currentAutoEligible:false};
}
export function runOriginalProducerRegressions(kswarmRoot){
 const root=realpathSync(kswarmRoot),registration=readRegistrationLiteral(readFileSync(inside(root,'src/core/hub-producer-registration.js'),'utf8'));
 const run=spawnSync(process.execPath,['--test','--test-reporter=tap',inside(root,'test/hub-producer-registration.test.js')],{cwd:root,encoding:'utf8',timeout:60000,maxBuffer:8*1024*1024});
 process.stdout.write(run.stdout??'');if(run.stderr)process.stderr.write(run.stderr);if(run.error||run.status!==0||run.signal)fail('original producer regression failed');
 return assertExecutedRegistrationCases(run.stdout,registration.requiredRuntimeCases);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{const args=process.argv.slice(2),runTests=args.length===5&&args[4]==='--run-regression';if(args.length!==4&&!runTests||args[0]!=='--kswarm-root'||args[2]!=='--docs-root')fail('usage: --kswarm-root <explicit path> --docs-root <explicit xiaok docs path> [--run-regression]');const result=await checkDshProducerRegistration({kswarmRoot:args[1],docsRoot:args[3]});if(runTests)result.executedRequiredCases=runOriginalProducerRegressions(args[1]);console.log(JSON.stringify(result));}catch(raw){console.error(raw.message);process.exitCode=1;}
}
