import {assertInstalledAssemblyDatabase,assertInstalledBlackboxExecution,readInstalledApprovedRecipe,readInstalledVerificationPlan,readInstalledVerificationSignal,ensureInstalledVerificationQualification,registerInstalledCaseExecution,recordInstalledCaseResult,recordInstalledCaseCancellation} from './installed-controller.js';
import {consumeExecutionCommandContext} from '../isolated-execution/docker-runner.js';
import type {ExecutionWriteContext} from './execution-command-dispatch.js';
import {createHash} from 'node:crypto';
import type {Database} from 'better-sqlite3';
import {assertDockerRunnerDatabase,type createDockerRunner} from '../isolated-execution/docker-runner.js';
import type {HostIssuedMountPlan} from '../isolated-execution/execution-port.js';
import type {QuiescenceAuthority,QuiescenceExpectation,PhysicalQuiescenceReceipt} from '../isolated-execution/physical-quiescence.js';
import {extractSingleArtifact} from '../isolated-execution/artifact-export.js';
import type {ApprovedBlackboxStager} from './approved-blackbox-stager.js';
import type {createVerificationCompletionComposition} from './completion-composition.js';
import type {RecipeBinding,BlackboxObservation} from './independent-recipes.js';
import {canonicalVerificationJson as json} from './protocol.js';
import {runVerificationTransaction} from './storage-budget.js';
type Raw=ReturnType<typeof createDockerRunner>;
type Result={expected:QuiescenceExpectation;output:object;receipt:PhysicalQuiescenceReceipt};
const blackboxCommands=new WeakMap<object,{owner:ReturnType<typeof createApprovedBlackboxExecutor>;raw:object;database:Database}>();
export function inspectBlackboxPreparationCommand(command:object,raw:object,database:Database):boolean{const facts=blackboxCommands.get(command);if(!facts)return false;if(facts.raw!==raw||facts.database!==database)throw Error('blackbox_command_binding');return true;}
export function executeBlackboxPreparationCommand(command:object,context:ExecutionWriteContext):boolean{const facts=blackboxCommands.get(command);if(!facts)return false;facts.owner.commitPreparedCase(command,context);return true;}

function sync(value:unknown){if(value!==undefined){void Promise.resolve(value).catch(()=>{});throw Error('blackbox_executor_synchronous_port');}}
/** Controller-private execution only. The parent operation supplies its actual
 * producer admission and signal; neither cases nor this adapter issue OS authority. */
export function createApprovedBlackboxExecutor(input:{assembly:object;database:Database;raw:Raw;caseStager:ApprovedBlackboxStager;quiescence:QuiescenceAuthority}){
 const {assembly,database,raw,caseStager}=input;assertInstalledAssemblyDatabase(assembly,database);assertDockerRunnerDatabase(raw,database);
 const readApprovedRecipeBinding=(binding:RecipeBinding)=>readInstalledApprovedRecipe(assembly,binding),getOriginalPlan=(binding:RecipeBinding)=>readInstalledVerificationPlan(assembly,binding),signalForBinding=(binding:RecipeBinding)=>readInstalledVerificationSignal(assembly,binding),ensureQualified=(signal:AbortSignal)=>ensureInstalledVerificationQualification(assembly,signal),registerCaseExecution=(binding:RecipeBinding,expected:QuiescenceExpectation,database:Database)=>registerInstalledCaseExecution(assembly,binding,expected,database),onActualResult=(result:Result)=>recordInstalledCaseResult(assembly,result),onActualCancellation=(result:Omit<Result,'output'>)=>recordInstalledCaseCancellation(assembly,result);
 const inspect=input.quiescence.inspectExecution.bind(input.quiescence),assertQuiescent=input.quiescence.assertQuiescent.bind(input.quiescence);
 const lifetime=new AbortController(),pending=new Set<Promise<BlackboxObservation>>();let closed=false;
 type CaseFacts={binding:RecipeBinding;plan:HostIssuedMountPlan;signal:AbortSignal;originalApproval:string;expected?:QuiescenceExpectation};const preparing=new Map<object,CaseFacts>();
 function assertCaseLive(facts:CaseFacts){facts.signal.throwIfAborted();assertInstalledBlackboxExecution(assembly,database,raw,caseStager,input.quiescence);if(json(readApprovedRecipeBinding(facts.binding))!==facts.originalApproval)throw Error('blackbox_executor_approval_changed');caseStager.getManifest(facts.plan);}
 function commitPreparedCase(command:object,context:ExecutionWriteContext):void{const facts=preparing.get(command);if(!facts||blackboxCommands.get(command)?.owner!==executor)throw Error('blackbox_command_brand');const transaction=consumeExecutionCommandContext(context,raw,database,command);assertCaseLive(facts);const manifest=caseStager.getManifest(facts.plan);facts.expected=raw.reserveExecution({...manifest.invocation,ownerKey:raw.readOwnerKey(facts.binding.expected),scopeDigest:manifest.scopeDigest,command:manifest.command,materializedInput:facts.plan},transaction).expected;sync(registerCaseExecution(facts.binding,facts.expected,database));assertCaseLive(facts);}

 async function execute(request:{binding:RecipeBinding;caseId:string;caseInvocationId:string;input:Buffer}):Promise<BlackboxObservation>{
  if(closed)throw Error('blackbox_executor_closed');assertInstalledBlackboxExecution(assembly,database,raw,caseStager,input.quiescence);if(database.inTransaction)throw Error('blackbox_executor_outer_transaction');
  const provided=request.input;if(!Buffer.isBuffer(provided)||provided.length>2*1024**2)throw Error('blackbox_executor_input_budget');
  const binding=JSON.parse(json(request.binding)) as RecipeBinding,caseId=request.caseId,caseInvocationId=request.caseInvocationId,bytes=Buffer.from(provided);
  const signal=AbortSignal.any([lifetime.signal,signalForBinding(binding)]);signal.throwIfAborted();
  const approval=readApprovedRecipeBinding(binding);if(approval.recipe.kind!=='blackbox')throw Error('blackbox_executor_recipe');
  const test=approval.recipe.cases.find(c=>c.id===caseId);if(!test||!bytes.equals(Buffer.from(test.inputBase64,'base64')))throw Error('blackbox_executor_case');
  const originalApproval=json(approval),effects=JSON.parse(json(test.sideEffects)) as {path:string;sha256:string}[];
  const originalPlan=getOriginalPlan(binding),plan=caseStager.prepareCase({originalPlan,binding,caseId,caseInvocationId,input:bytes});
  function live(){signal.throwIfAborted();if(json(readApprovedRecipeBinding(binding))!==originalApproval)throw Error('blackbox_executor_approval_changed');caseStager.getManifest(plan);}
  await ensureQualified(signal);live();let expected:QuiescenceExpectation|undefined;
  try{
   try{const command=Object.freeze({}),facts:CaseFacts={binding,plan,signal,originalApproval};preparing.set(command,facts);blackboxCommands.set(command,{owner:executor,raw,database});try{raw.reserveCommand(command);}finally{expected=facts.expected;preparing.delete(command);blackboxCommands.delete(command);}}
   catch(error){if(expected){raw.discardUncommittedExecution(expected);expected=undefined;}throw error;}
   live();const result=await raw.dispatchExecution(expected!,{signal}),receipt=await inspect(expected!);sync(assertQuiescent(receipt,expected!));
   // Preserve actual captured facts before a post-execution material revocation
   // check. This callback grants no model disclosure or new resource reads.
   sync(onActualResult({expected:expected!,output:result.output,receipt}));
   const captured=raw.readCapturedOutput(result.output,{expected:expected!});live();raw.assertOutputDisclosure(result.output,{expected:expected!});
   const sideEffects:Record<string,Buffer>=Object.create(null);let total=captured.stdout.length+captured.stderr.length;
   for(const effect of effects){live();const maxBytes=Math.min(16*1024**2,256*1024**2-total);if(maxBytes<1)throw Error('blackbox_executor_output_budget');const tar=await raw.readArchive(result.output,effect.path,{expected:expected!,signal,maxBytes});live();const body=extractSingleArtifact(tar,effect.path);if(body.length>maxBytes)throw Error('blackbox_executor_output_budget');total+=body.length;sideEffects[effect.path]=body;}
   sync(assertQuiescent(receipt,expected!));live();
   const observation:BlackboxObservation={binding,caseId,inputHash:createHash('sha256').update(bytes).digest('hex'),expected:expected!,receipt,exitCode:result.exitCode,outputTruncated:captured.truncated||!captured.complete,stdout:captured.stdout,sideEffects};
   await raw.cleanupExecution(expected!);live();sync(assertQuiescent(receipt,expected!));return observation;
  }catch(error){
   if(expected){
    const state=raw.readExecution(expected);
    if(state.state==='prepared'){raw.cancelPreparedExecution(expected);await raw.cleanupExecution(expected);const receipt=await inspect(expected);sync(assertQuiescent(receipt,expected));sync(onActualCancellation({expected,receipt}));}
    else if(state.cancelledBeforeStart){await raw.cleanupExecution(expected);const receipt=await inspect(expected);sync(assertQuiescent(receipt,expected));sync(onActualCancellation({expected,receipt}));}
    // A durable physical terminal permits factual guest cleanup even if the
    // capture sink rejected. Its missing observation remains unknown, not pass.
    else if(state.state==='terminal')await raw.cleanupExecution(expected);
   }
   throw error;
  }
 }
 const executor=Object.freeze({commitPreparedCase,runBlackbox(request:Parameters<typeof execute>[0]){const work=execute(request);pending.add(work);void work.finally(()=>pending.delete(work)).catch(()=>{});return work;},async close(){if(!closed){closed=true;lifetime.abort(Error('blackbox_executor_closed'));}await Promise.allSettled([...pending]);}});return executor;
}
