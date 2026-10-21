import {createHash} from 'node:crypto';
import {canonicalVerificationJson as json} from './protocol.js';
import type {RecipeBinding} from './independent-recipes.js';
import type {createVerificationCompletionComposition} from './completion-composition.js';
import type {HostIssuedMountPlan} from '../isolated-execution/execution-port.js';
import type {DockerRunnerStager} from '../isolated-execution/docker-runner.js';
type Approval=ReturnType<typeof createVerificationCompletionComposition>['privateHost']['readApprovedRecipeBinding'];
const hash=(x:string|Buffer)=>createHash('sha256').update(x).digest('hex');
function frozen<T>(value:T):T{const v=JSON.parse(json(value));const visit=(x:any)=>{if(x&&typeof x==='object'){Object.values(x).forEach(visit);Object.freeze(x);}};visit(v);return v;}
const capacityLineage=new WeakMap<object,()=>Readonly<{originalPlan:HostIssuedMountPlan;scopeDigest:string}>>();
export function readApprovedBlackboxCapacityLineage(plan:object){return capacityLineage.get(plan)?.();}
/** Private controller case materialization; no public arbitrary case/command issuer.
 * Actual committed recipe and original material authority remain live on every read. */
export interface ApprovedBlackboxStager extends DockerRunnerStager {prepareCase(raw:{originalPlan:HostIssuedMountPlan;binding:RecipeBinding;caseId:string;caseInvocationId:string;input:Buffer}):HostIssuedMountPlan;readStdin(plan:HostIssuedMountPlan):Buffer;close():void}
export function createApprovedBlackboxStager(input:{stager:Pick<DockerRunnerStager,'getManifest'|'readFile'>;readApprovedRecipeBinding:Approval}):ApprovedBlackboxStager{
 const getOriginal=input.stager.getManifest.bind(input.stager),readOriginal=input.stager.readFile.bind(input.stager),approved=input.readApprovedRecipeBinding;
 type Record={originalPlan:HostIssuedMountPlan;binding:RecipeBinding;approval:string;original:string;manifest:ReturnType<DockerRunnerStager['getManifest']>;bytes:Buffer};
 const cases=new WeakMap<object,Record>();let closed=false;
 function current(){if(closed)throw Error('blackbox_stager_closed');}
 function originalApproval(binding:RecipeBinding){current();const value=approved(binding);if(!value||typeof (value as unknown as {then?:unknown}).then==='function'){void Promise.resolve(value).catch(()=>{});throw Error('blackbox_stager_approval');}if(json(value.attempt.expected)!==json(binding.expected))throw Error('blackbox_stager_binding');return frozen(value);}
 function record(plan:HostIssuedMountPlan){current();const r=cases.get(plan);if(!r)throw Error('blackbox_stager_case_identity');if(json(originalApproval(r.binding))!==r.approval||json(getOriginal(r.originalPlan))!==r.original)throw Error('blackbox_stager_original_changed');return r;}
 return Object.freeze({
  prepareCase(raw:{originalPlan:HostIssuedMountPlan;binding:RecipeBinding;caseId:string;caseInvocationId:string;input:Buffer}):HostIssuedMountPlan{
   current();const originalPlan=raw.originalPlan,binding=frozen(raw.binding),caseId=raw.caseId,caseInvocationId=raw.caseInvocationId,provided=raw.input;
   if(!Buffer.isBuffer(provided)||provided.length>2*1024**2||typeof caseInvocationId!=='string'||!caseInvocationId||caseInvocationId.length>160||/[\x00-\x1f\x7f]/.test(caseInvocationId)||caseInvocationId===binding.expected.validationInvocationId)throw Error('blackbox_stager_case');const bytes=Buffer.from(provided),approval=originalApproval(binding),original=frozen(getOriginal(originalPlan));
   if(approval.recipe.kind!=='blackbox')throw Error('blackbox_stager_recipe');const test=approval.recipe.cases.find(c=>c.id===caseId);if(!test||!bytes.equals(Buffer.from(test.inputBase64,'base64')))throw Error('blackbox_stager_case_input');
   const invocation={sessionIdentity:binding.expected.sessionIdentity,compoundOperationId:binding.expected.compoundOperationId,validationInvocationId:binding.expected.validationInvocationId};if(json(original.invocation)!==json(invocation)||original.scopeDigest!==binding.expected.scopeDigest||original.stdin)throw Error('blackbox_stager_original_scope');
   const descriptor={sha256:hash(bytes),bytes:bytes.length},scopeDigest=hash(json({originalScope:original.scopeDigest,recipeHash:hash(json(approval.recipe)),binding,caseId,caseInvocationId,stdin:descriptor}));
   const manifest=frozen({...original,invocation:{...original.invocation,validationInvocationId:caseInvocationId},scopeDigest,stdin:descriptor}),plan=Object.freeze({}) as HostIssuedMountPlan;
   if(json(originalApproval(binding))!==json(approval)||json(getOriginal(originalPlan))!==json(original))throw Error('blackbox_stager_original_changed');cases.set(plan,{originalPlan,binding,approval:json(approval),original:json(original),manifest,bytes});capacityLineage.set(plan,()=>{const actual=record(plan);return Object.freeze({originalPlan:actual.originalPlan,scopeDigest:actual.manifest.scopeDigest});});return plan;
  },
  getManifest(plan:HostIssuedMountPlan){current();return cases.has(plan)?record(plan).manifest:getOriginal(plan);},
  readFile(plan:HostIssuedMountPlan,path:string){current();if(!cases.has(plan))return readOriginal(plan,path);const r=record(plan);if(!r.manifest.files.some(f=>f.path===path))throw Error('blackbox_stager_file');const bytes=readOriginal(r.originalPlan,path);record(plan);return bytes;},
  readStdin(plan:HostIssuedMountPlan){const r=record(plan);return Buffer.from(r.bytes);},
  close(){closed=true;},
 });
}
