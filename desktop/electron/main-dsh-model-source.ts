import type {OriginalMainPhysicalPort} from './main-room-root-admission.js';
import {types} from 'node:util';
import {createHash,Hash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {loadConfigSync} from '../../src/utils/config.js';
import {resolveRuntimeModelBinding} from '../../src/ai/providers/control-plane.js';
import {buildDshBoundedRequest} from '../../src/runtime/admission/request-bounds.js';
import {buildDshAssessmentPrompt,parseDshAssessmentOutput,DSH_ASSESSMENT_PROMPT_VERSION} from '../../src/runtime/admission/assessment-output.js';
import {decodeDshChatCompletion} from '../../src/runtime/admission/model-response.js';
import {dshAHash,dshAJson} from '../../src/runtime/multi-agent/dsh-admission-data.js';
import {captureGithubOpaqueRecord} from '../../src/runtime/multi-agent/dsh-github-read-data.js';
import {createSingleRequestHttpsFetch,readSingleRequestOwnedReply,readOriginalSingleRequestPhysicalReceipt} from '../../src/runtime/sol-pi/single-request-https.js';
import {createIntrinsicSet,settleIntrinsicOperations} from '../../src/runtime/verification/intrinsic-async-collection.js';
import {retainSourceErrorTails} from '../../src/runtime/verification/source-error-tails.js';
import {assertStandardIpcPromise} from '../../src/runtime/verification/native-ipc-promise.js';
import {readOriginalDshAdmissionPort,readOriginalDshAssessmentRequest,readOriginalDshAssessmentSourceBody,assertOriginalDshAssessmentExecutionAuthority,type DshAssessmentRequestView} from './desktop-multi-agent-store.js';
import {readOriginalDshBudgetRuntimeBinding,readOriginalDshBudgetPort,readOriginalDshBudgetObservation,readOriginalDshBudgetAttemptReceipt,type OriginalDshBudgetRuntimeBinding} from './harness-optimization-service.js';
import {dshBudgetCommandDigest,parseDshInput} from './harness-dsh-budget-data.mjs';
import {readOriginalMainDshBudgetAuthoritySource,type MainDshBudgetAuthoritySource} from './main-dsh-budget-authority-source.js';
const apply=Reflect.apply,get=WeakMap.prototype.get,set=WeakMap.prototype.set,descriptor=Object.getOwnPropertyDescriptor,own=Object.hasOwn,freeze=Object.freeze,create=Object.create,define=Object.defineProperty;
const mapGet=Map.prototype.get,mapSet=Map.prototype.set,NativeAbort=AbortController,abort=AbortController.prototype.abort;
const NativeDecoder=TextDecoder,decode=TextDecoder.prototype.decode;
const NativePromise=Promise,then=Promise.prototype.then,NativeError=Error,isProxy=types.isProxy,isPromise=types.isPromise,now=Date.now,monotonicNative=performance.now,hashUpdate=Hash.prototype.update,hashDigest=Hash.prototype.digest;
function monotonic():number{const value=apply(monotonicNative,performance,[]);if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw new NativeError('DSH_MODEL_CLOCK_UNAVAILABLE',{cause:value});return value;}
const pricingUrl='https://api-docs.deepseek.com/quick_start/pricing/',pricingArticle='e62f4464fd5841dee1f32b31cdf43ca6a146b5638893f13d99bfa5e252d09903',endpoint='https://api.deepseek.com/chat/completions';
function fail(code='DSH_MODEL_SOURCE_UNAVAILABLE'):never{throw new NativeError(code);}
function sha(raw:string):string{const hash=createHash('sha256');apply(hashUpdate,hash,[raw,'utf8']);return apply(hashDigest,hash,['hex']) as string;}
function utf8(bytes:Uint8Array):string{return apply(decode,new NativeDecoder('utf-8',{fatal:true}),[bytes]) as string;}
function byteSha(raw:Uint8Array):string{const hash=createHash('sha256');apply(hashUpdate,hash,[raw]);return apply(hashDigest,hash,['hex']) as string;}
function data<T>(raw:unknown,key:string):T{if(!raw||typeof raw!=='object'||isProxy(raw))fail();const row=descriptor(raw,key);if(!row||!own(row,'value'))fail();return row.value as T;}
interface Attempt {
 store:object;source:object;runtime:object;budgetSource:object;attemptId:string;request:DshAssessmentRequestView;commands:Map<string,{input:unknown;current():void}>;
 bodyHash?:string;requestBody?:string;physicalReceipt?:object;budgetAttempt?:object;result?:DshAssessmentResultView;current():void;local():void;
}
const attempts=new WeakMap<object,Attempt>();
export interface OriginalDshModelResourceContext {
 readonly kind:'original_dsh_model_resource_context_v1';readonly executionClass:'admission_probe'|'live_preview';readonly executionRef:string;readonly bodyHash:string;
 readonly scope:Readonly<{profileId:string;workspaceId:string;principalId:string}>;assertCurrent():void;assertLocal():void;
}
export function readOriginalDshModelResourceContext(token:unknown,realm:unknown,store:unknown,runtime:unknown,budgetSource:unknown):OriginalDshModelResourceContext {
 const row=apply(get,attempts,[token]) as Attempt|undefined;
 if(!row||row.source!==realm||row.store!==store||row.runtime!==runtime||row.budgetSource!==budgetSource||!row.bodyHash)fail('DSH_MODEL_RESOURCE_CONTEXT_REQUIRED');
 row.local();return freeze({kind:'original_dsh_model_resource_context_v1',executionClass:row.request.purpose==='preview'?'live_preview':'admission_probe',executionRef:row.attemptId,bodyHash:row.bodyHash,scope:freeze({profileId:row.request.storageScope.profileId,workspaceId:row.request.storageScope.workspaceId,principalId:row.request.principalId}),assertCurrent:row.current,assertLocal:row.local});
}
export function readOriginalDshModelPhysicalReceipt(token:unknown,receipt:unknown,realm:unknown,store:unknown,runtime:unknown,budgetSource:unknown):Readonly<{attemptId:string;bodyHash:string;assertKnown():void}> {
 const row=apply(get,attempts,[token]) as Attempt|undefined;
 if(!row||row.source!==realm||row.store!==store||row.runtime!==runtime||row.budgetSource!==budgetSource||!row.bodyHash||row.physicalReceipt!==receipt)fail('DSH_MODEL_PHYSICAL_RECEIPT_REQUIRED');
 const physical=readOriginalSingleRequestPhysicalReceipt(receipt);
 if(physical.destination!==endpoint||physical.method!=='POST'||physical.requestBody!==row.requestBody)fail('DSH_MODEL_PHYSICAL_RECEIPT_CONFLICT');
 return freeze({attemptId:row.attemptId,bodyHash:row.bodyHash,assertKnown:physical.assertKnown});
}
export interface DshAssessmentResultView {
 readonly attemptId:string;readonly modelId:string;readonly promptVersion:string;readonly ruleVersion:string;readonly evidenceManifestHash:string;readonly dataEgressPolicyRef:string;readonly validUntil:number;readonly assessmentVersion:1|2;readonly purpose:'admission'|'preview';
 readonly result:Readonly<{suggestedIntent:'draft_request'|'followup'|'chat'|'ambiguous';evidenceRefs:readonly string[];uncertainty:string|null}>;
 assertCurrent():void;assertLocal():void;assertKnown():void;waitKnown():Promise<void>;
}
/** Private membership precedes all caller properties. A decides selection. */
export function readOriginalDshAssessmentResult(modelAttempt:unknown,exactStore:unknown,exactAuthoritySource:unknown,attemptId:string):DshAssessmentResultView {
 const row=apply(get,attempts,[modelAttempt]) as Attempt|undefined;
 if(!row||row.store!==exactStore||row.source!==exactAuthoritySource||row.attemptId!==attemptId||!row.result)fail('DSH_MODEL_RESULT_REQUIRED');row.result.assertKnown();return row.result;
}
/** Fixed handoff to the original budget Source; never accepts caller data as
 * an authority. Only commands already registered by this private attempt pass. */
export function readOriginalDshModelBudgetAuthority(modelAttempt:unknown,exactBudgetSource:unknown,purpose:string,input:unknown):Readonly<Record<string,unknown>> {
 const row=apply(get,attempts,[modelAttempt]) as Attempt|undefined;if(!row||row.budgetSource!==exactBudgetSource)fail('DSH_MODEL_ATTEMPT_REQUIRED');
 const command=apply(mapGet,row.commands,[purpose]) as {input:unknown;current():void}|undefined;if(!command||dshBudgetCommandDigest(purpose,parseDshInput(purpose,input))!==dshBudgetCommandDigest(purpose,command.input))fail('DSH_MODEL_BUDGET_COMMAND_REQUIRED');command.current();
 const request=row.request;
 return freeze({requestSource:'scheduler',actor:null,profileId:request.storageScope.profileId,workspaceId:request.storageScope.workspaceId,tenantId:request.tenantId,mandateId:request.mandateId,mandateRevision:request.mandateRevision,authorizationEpoch:request.authorizationEpoch,authorityHash:request.budgetAuthorityHash,commandDigest:dshBudgetCommandDigest(purpose,command.input),assertCurrent:command.current});
}
export interface MainDshModelSource {runAssessment(attemptId:string):Promise<object>;stopAccepting():void;close():Promise<void>}
export interface OriginalDshModelPricingEvidence {
 readonly kind:'original_dsh_model_pricing_evidence_v1';readonly providerId:'deepseek';readonly modelId:'deepseek-flash';readonly modelProfileId:'deepseek-flash-dsh-text-v1';readonly protocol:'openai_legacy';readonly destination:string;
 readonly contextTokenLimit:1048576;readonly maxOutputTokens:393216;readonly inputMicrosPerMillion:300000;readonly outputMicrosPerMillion:1200000;readonly currency:'USD';readonly scale:6;readonly validUntil:number;readonly pricingEvidenceHash:string;
 readonly contextSemantics:'input_and_output';readonly outputSemantics:'total_completion_tokens';assertCurrent():void;assertLocal():void;
}
interface OriginalModelSourceState {realm:object;store:object;runtime:object;budgetSource:object;local():void;pricing():OriginalDshModelPricingEvidence}
const modelSources=new WeakMap<object,OriginalModelSourceState>();
export interface OriginalDshModelPricingRequest {
 readonly realm:object;readonly store:object;readonly runtime:object;readonly budgetSource:object;
 readonly request:DshAssessmentRequestView;readonly signal:AbortSignal;readonly validUntil:number;
 assertCurrent():void;assertLocal():void;
}
const pricingRequests=new WeakMap<object,{source:object;view:OriginalDshModelPricingRequest}>();
/** Only an actual original assessment execution can create this request. The
 * empty token and this reader do not grant model/N permission or caller HTTP. */
export function readOriginalDshModelPricingRequest(source:unknown,token:unknown):OriginalDshModelPricingRequest {
 const original=apply(get,modelSources,[source]) as OriginalModelSourceState|undefined;
 const row=apply(get,pricingRequests,[token]) as {source:object;view:OriginalDshModelPricingRequest}|undefined;
 if(!original||!row||row.source!==source||row.view.realm!==original.realm||row.view.store!==original.store||row.view.runtime!==original.runtime||row.view.budgetSource!==original.budgetSource)fail('DSH_MODEL_PRICING_REQUEST_REQUIRED');
 return row.view;
}
/** Original already-closed GET evidence, not a new request or permission. The
 * draft consumer must independently authenticate its own A/B/N admission. */
export function readOriginalDshModelPricingEvidence(source:unknown,realm:unknown,store:unknown,runtime:unknown,budgetSource:unknown):OriginalDshModelPricingEvidence {
 const row=apply(get,modelSources,[source]) as OriginalModelSourceState|undefined;
 if(!row||row.realm!==realm||row.store!==store||row.runtime!==runtime||row.budgetSource!==budgetSource)fail('DSH_MODEL_PRICING_EVIDENCE_REQUIRED');
 row.local();const value=row.pricing();value.assertCurrent();return value;
}
/** Composition identity only; all per-attempt gates still run at SDK entry. */
export function readOriginalMainDshModelSource(source:unknown,realm:unknown,store:unknown,runtime:unknown,budgetSource:unknown):MainDshModelSource {
 const row=apply(get,modelSources,[source]) as {realm:object;store:object;runtime:object;budgetSource:object;local():void}|undefined;
 if(!row||row.realm!==realm||row.store!==store||row.runtime!==runtime||row.budgetSource!==budgetSource)fail('DSH_MODEL_ORIGINAL_SOURCE_REQUIRED');row.local();return source as MainDshModelSource;
}
/** Real Main composition only, fixed original readers and one physical HTTPS
 * transport. No caller verifier, fetch, provider URL, credential or body. */
export function createMainDshModelSource(raw:unknown):MainDshModelSource {
 const options=captureGithubOpaqueRecord(raw,['realm','store','runtime','budgetSource']);const names=Reflect.ownKeys(options);if(names.length!==4||!own(options,'realm')||!own(options,'store')||!own(options,'runtime')||!own(options,'budgetSource'))fail();
 const realm=options.realm as object,store=options.store as object,runtime=options.runtime as object,budgetSource=options.budgetSource as MainDshBudgetAuthoritySource;
 // Passive private membership only; Native and all external SDKs run below
 // after an owned Root has been registered.
 readOriginalDshAdmissionPort(store,realm);
 const roots=createIntrinsicSet<Promise<void>>(),tails=createIntrinsicSet<Promise<void>>(),observed=createIntrinsicSet<unknown>(),unknown=createIntrinsicSet<unknown>();
 const controllers=createIntrinsicSet<AbortController>();
 let accepting=true,closed=false,closing:Promise<void>|undefined,firstPresent=false,first:unknown;
 let latestPricing:OriginalDshModelPricingEvidence|undefined;
 const remember=(raw:unknown)=>{if(!firstPresent){firstPresent=true;first=raw;}};
 function inventory(raw:unknown):void{retainSourceErrorTails(raw,(value,kind)=>{if(kind==='unknown'){unknown.add(value);return;}if(observed.has(value))return;observed.add(value);let complete!:()=>void;const completion=new NativePromise<void>(yes=>{complete=yes;});tails.add(completion);try{assertStandardIpcPromise(value,'DSH_MODEL_SDK_UNKNOWN');apply(then,value,[(result:unknown)=>done(result,false),(error:unknown)=>done(error,true)]);}catch(error){remember(error);unknown.add(value);tails.delete(completion);complete();}function done(value:unknown,rejected:boolean){if(rejected)remember(value);try{inventory(value);}catch(error){remember(error);unknown.add(value);}finally{tails.delete(completion);complete();}}});}
 function hold(value:unknown):void{inventory(value);}
 let sdkSequence=0;
 function slot(holder:Record<string,unknown>,name:string):Record<string,unknown>{const value=create(null);define(holder,String(++sdkSequence),{__proto__:null,value,enumerable:true} as PropertyDescriptor);define(value,'name',{__proto__:null,value:name,enumerable:true} as PropertyDescriptor);return value;}
 function invoke<T>(holder:Record<string,unknown>,name:string,fn:Function,receiver:unknown,args:unknown[],voidResult=false):T {
  const owner=slot(holder,name);let result:unknown;try{result=apply(fn,receiver,args);define(owner,'raw',{__proto__:null,value:result,enumerable:true} as PropertyDescriptor);}catch(error){define(owner,'error',{__proto__:null,value:error,enumerable:true} as PropertyDescriptor);inventory(error);throw error;}
  if(isPromise(result)||result&&typeof result==='object'&&isProxy(result)){unknown.add(result);inventory(result);fail('DSH_MODEL_SDK_UNKNOWN');}if(voidResult&&result!==undefined){unknown.add(result);inventory(result);fail('DSH_MODEL_SDK_UNKNOWN');}return result as T;
 }
 function joined<T>(holder:Record<string,unknown>,name:string,fn:Function,receiver:unknown,args:unknown[]):Promise<{value:T}>{
  const owner=slot(holder,name);let raw:unknown;try{raw=apply(fn,receiver,args);define(owner,'raw',{__proto__:null,value:raw,enumerable:true} as PropertyDescriptor);assertStandardIpcPromise(raw,'DSH_MODEL_SDK_UNKNOWN');}catch(error){define(owner,'error',{__proto__:null,value:error,enumerable:true} as PropertyDescriptor);if(raw!==undefined){unknown.add(raw);inventory(raw);}inventory(error);return new NativePromise((_yes,no)=>no(error));}
  return new NativePromise((yes,no)=>{try{apply(then,raw,[(value:T)=>yes(freeze(Object.assign(create(null),{value}))),(error:unknown)=>{inventory(error);no(error);}]);}catch(error){unknown.add(raw);inventory(raw);inventory(error);no(error);}});
 }
 function runtimeMethod(name:string):{receiver:object;fn:Function}{const receiver=data<object>(runtime,'dsh'),fn=data<Function>(receiver,name);if(typeof fn!=='function'||isProxy(fn))fail();return{receiver,fn};}
 function guardRoot(){let complete!:()=>void;const row=new NativePromise<void>(yes=>{complete=yes;});roots.add(row);return()=>{roots.delete(row);complete();};}
 async function executeAssessment(attemptId:string):Promise<object>{
  if(!accepting||closed||unknown.size)fail();let complete!:()=>void;const completion=new NativePromise<void>(yes=>{complete=yes;});roots.add(completion);const controller=new NativeAbort();controllers.add(controller);const holder=create(null) as Record<string,unknown>;
  let physicalComposition:typeof import('./main-room-root-admission.js')|undefined;
  let physicalPort:OriginalMainPhysicalPort|undefined,physicalPermit:object|undefined,physicalSettlementFailure:unknown,physicalSettlementFailed=false,physicalConsumeEntered=false,physicalSettled=false;
  let token:object|undefined,request:DshAssessmentRequestView|undefined,withdrawn=false,budget:OriginalDshBudgetRuntimeBinding|undefined,reserved=false,settled=false;
  const local=()=>{if(closed||withdrawn||unknown.size)fail();};
  const current=()=>{const finish=guardRoot();try{local();if(!accepting)fail('DSH_MODEL_CLOSED');try{if(!physicalComposition)fail('DSH_MODEL_COMPOSITION_REQUIRED');invoke(holder,'composition',physicalComposition.assertOriginalMainDshPhysicalComposition,undefined,[realm,store,runtime,budgetSource]);invoke(holder,'execution',assertOriginalDshAssessmentExecutionAuthority,undefined,[realm,store,realm,attemptId],true);if(request){invoke(holder,'requestCurrent',request.assertCurrent,undefined,[],true);if(now()>=request.validUntil||now()>=request.deadline)fail('DSH_MODEL_REQUEST_EXPIRED');}if(budget){invoke(holder,'budgetCurrent',budget.assertCurrent,undefined,[],true);invoke(holder,'budgetLocal',budget.assertLocal,undefined,[],true);}if(request)invoke(holder,'requestLocalFinal',request.assertLocal,undefined,[],true);local();}catch(error){withdrawn=true;throw error;}}finally{finish();}};
  // Accounting accepted work remains recordable after permission withdrawal.
  const accounting=()=>{const finish=guardRoot();try{if(closed||unknown.size||!budget)fail();invoke(holder,'accountingCurrent',budget.assertCurrent,undefined,[],true);invoke(holder,'accountingLocal',budget.assertLocal,undefined,[],true);}finally{finish();}};
  const command=async(purpose:string,method:string,input:unknown,cleanup=false)=>{if(!token)fail();const row=apply(get,attempts,[token]) as Attempt;const parsed=parseDshInput(purpose,input);apply(mapSet,row.commands,[purpose,{input:parsed,current:cleanup?accounting:current}]);const proof=invoke<object>(holder,'budgetProof',budgetSource.openAssessmentBudget,budgetSource,[token,purpose,parsed]);if(purpose==='reserve'){const port=invoke<ReturnType<typeof readOriginalDshBudgetPort>>(holder,'attemptPort',readOriginalDshBudgetPort,undefined,[runtime,budgetSource]);const receipt=(await joined<object>(holder,'budgetAttempt',port.reserveAttempt,port,[parsed,proof])).value;const actual=invoke<ReturnType<typeof readOriginalDshBudgetAttemptReceipt>>(holder,'attemptReceipt',readOriginalDshBudgetAttemptReceipt,undefined,[port,receipt]);if(actual.disposition!=='newly_reserved')fail('DSH_MODEL_ATTEMPT_ALREADY_RESERVED');row.budgetAttempt=receipt;return receipt;}const selected=runtimeMethod(method);return(await joined<unknown>(holder,'budget:'+purpose,selected.fn,selected.receiver,[parsed,proof])).value;};
  try{
   invoke(holder,'budgetSourceBinding',readOriginalMainDshBudgetAuthoritySource,undefined,[budgetSource,realm,store]);const originalRequest=invoke<DshAssessmentRequestView>(holder,'request',readOriginalDshAssessmentRequest,undefined,[realm,store,realm,attemptId]);request=originalRequest;if(!Number.isSafeInteger(originalRequest.validUntil)||Object.is(originalRequest.validUntil,-0)||!Number.isSafeInteger(originalRequest.deadline)||Object.is(originalRequest.deadline,-0)||originalRequest.validUntil<0||originalRequest.deadline<0||originalRequest.validUntil>1e15||originalRequest.deadline>1e15||originalRequest.purpose!=='admission'&&originalRequest.purpose!=='preview')fail('DSH_MODEL_REQUEST_INVALID');physicalComposition=(await joined<typeof import('./main-room-root-admission.js')>(holder,'compositionModule',()=>import('./main-room-root-admission.js'),undefined,[])).value;current();budget=invoke<OriginalDshBudgetRuntimeBinding>(holder,'budget',readOriginalDshBudgetRuntimeBinding,undefined,[runtime,budgetSource]);current();
   if(originalRequest.promptVersion!==DSH_ASSESSMENT_PROMPT_VERSION||originalRequest.ruleVersion!=='github_issue_draft_v1'||originalRequest.assessmentVersion!==1&&originalRequest.assessmentVersion!==2)fail('DSH_MODEL_PROFILE_UNAVAILABLE');
   const config=invoke<ReturnType<typeof loadConfigSync>>(holder,'config',loadConfigSync,undefined,[]),binding=invoke<ReturnType<typeof resolveRuntimeModelBinding>>(holder,'modelBinding',resolveRuntimeModelBinding,undefined,[config,originalRequest.modelId]);
   if(binding.providerId!=='deepseek'||binding.providerType!=='first_party'||binding.protocol!=='openai_legacy'||binding.wireModel!=='deepseek-flash'||binding.baseUrl!=='https://api.deepseek.com'&&binding.baseUrl!=='https://api.deepseek.com/v1'||!binding.apiKey||Reflect.ownKeys(binding.headers).length)fail('DSH_MODEL_PROFILE_UNAVAILABLE');
   current();const sourceBodies=invoke<ReturnType<typeof readOriginalDshAssessmentSourceBody>>(holder,'sourceBody',readOriginalDshAssessmentSourceBody,undefined,[realm,store,realm,attemptId]);current();
   const refs=originalRequest.evidenceRefs;if(sourceBodies.length!==refs.length)fail('DSH_MODEL_EVIDENCE_MISMATCH');
   const envelope=data<object>(originalRequest.input,'envelope'),authScope=data<object>(envelope,'authScope'),recipient=data<string>(authScope,'providerAccountId');if(typeof recipient!=='string'||!recipient)fail('DSH_MODEL_ACTOR_UNCONFIRMED');
   const evidence:Array<{ref:string;authorProviderId:null;title:string;body:string}>=[];
   for(let i=0;i<refs.length;i++){let found:typeof sourceBodies[number]|undefined;for(let j=0;j<sourceBodies.length;j++)if(sourceBodies[j]!.inputId===refs[i]){if(found)fail('DSH_MODEL_EVIDENCE_MISMATCH');found=sourceBodies[j];}if(!found)fail('DSH_MODEL_EVIDENCE_MISMATCH');evidence[evidence.length]={ref:refs[i]!,authorProviderId:null,title:found.title??'',body:found.body??''};}
   const prompt=buildDshAssessmentPrompt({recipientProviderIds:[recipient],existingDraftContext:null,evidence});
   const started=monotonic(),quoteUntil=Math.min(now()+60000,(Math.floor(now()/3600000)+1)*3600000,originalRequest.validUntil,originalRequest.deadline);
   const hooks={beforeTransport(){current();if(monotonic()-started>=60000||now()>=quoteUntil)fail('DSH_MODEL_PRICE_EXPIRED');},observeRawFailure(raw:unknown){hold(raw);}};
   const pricingToken:object=freeze(create(null));
   apply(set,pricingRequests,[pricingToken,{source,view:freeze({realm,store,runtime,budgetSource,request:originalRequest,signal:controller.signal,validUntil:quoteUntil,assertCurrent:hooks.beforeTransport,assertLocal:local})}]);
   const pricingModule=(await joined<typeof import('./dsh-github-source-session.js')>(holder,'pricingModule',()=>import('./dsh-github-source-session.js'),undefined,[])).value;
   const pricingExport=descriptor(pricingModule,'readOriginalMainDshModelPricing');
   let pricingRead:Function|undefined;
   if(pricingExport&&own(pricingExport,'value'))pricingRead=pricingExport.value;
   else if(pricingExport&&typeof pricingExport.get==='function'&&!isProxy(pricingExport.get))pricingRead=invoke<Function>(holder,'pricingFixedExport',pricingExport.get,pricingModule,[]);
   if(typeof pricingRead!=='function'||isProxy(pricingRead))fail('DSH_MODEL_PRICING_SOURCE_UNAVAILABLE');
   const quote=(await joined<Awaited<ReturnType<typeof readSingleRequestOwnedReply>>>(holder,'meteredPricing',pricingRead,undefined,[source,pricingToken])).value;
   if(quote.ownUnknown){for(const value of quote.ownExtras)hold(value);unknown.add(quote);fail('DSH_MODEL_SDK_UNKNOWN');}if(quote.status!==200)fail('DSH_MODEL_PRICE_UNAVAILABLE');
   const html=utf8(quote.bytes),articles=[...html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/g)];if(articles.length!==1||sha(articles[0]![1]!)!==pricingArticle)fail('DSH_MODEL_PRICE_UNAVAILABLE');current();
   const quotePhysical=readOriginalSingleRequestPhysicalReceipt(quote);quotePhysical.assertKnown();
   if(quotePhysical.destination!==pricingUrl||quotePhysical.method!=='GET'||quotePhysical.requestBody!=='')fail('DSH_MODEL_PRICE_UNAVAILABLE');
   let invalidated=false;
   const priceCurrent=()=>{if(!accepting||closed||unknown.size||monotonic()-started>=60000||now()>=quoteUntil){invalidated=true;fail('DSH_MODEL_PRICING_EVIDENCE_EXPIRED');}if(invalidated)fail('DSH_MODEL_PRICING_EVIDENCE_EXPIRED');quotePhysical.assertKnown();};
   latestPricing=freeze({kind:'original_dsh_model_pricing_evidence_v1',providerId:'deepseek',modelId:'deepseek-flash',modelProfileId:'deepseek-flash-dsh-text-v1',protocol:'openai_legacy',destination:endpoint,contextTokenLimit:1048576,maxOutputTokens:393216,inputMicrosPerMillion:300000,outputMicrosPerMillion:1200000,currency:'USD',scale:6,validUntil:quoteUntil,pricingEvidenceHash:pricingArticle,contextSemantics:'input_and_output',outputSemantics:'total_completion_tokens',assertCurrent:priceCurrent,assertLocal:priceCurrent});

   const plan=buildDshBoundedRequest({quote:{version:1,providerId:binding.providerId,modelId:binding.wireModel,modelProfileId:'deepseek-flash-dsh-text-v1',protocol:'openai_legacy',destination:endpoint,contextTokenLimit:1048576,maxOutputTokens:393216,inputMicrosPerMillion:300000,outputMicrosPerMillion:1200000,currency:'USD',scale:6,validUntil:quoteUntil,pricingEvidenceHash:pricingArticle,contextSemantics:'input_and_output',outputSemantics:'total_completion_tokens'},purpose:originalRequest.purpose==='preview'?'preview':'assessment',systemText:prompt.systemText,userText:prompt.userText,maxOutputTokens:2048,sourceManifestHash:originalRequest.evidenceManifestHash},now());
   const actualToken:object=freeze(create(null));token=actualToken;const row:Attempt={store,source:realm,runtime,budgetSource,attemptId,request:originalRequest,bodyHash:plan.bodyHash,requestBody:plan.serializedBody,commands:new Map(),current,local};apply(set,attempts,[token,row]);
   // This Source executes one physical request per durable assessment intent;
   // assessment version 2 has its own operation key, not transport sequence 2.
   const sequence=1;if(sequence>originalRequest.maxAttempts)fail('DSH_MODEL_ATTEMPT_INVALID');
   const base={accountId:originalRequest.accountId,operationKey:originalRequest.operationKey,sequence,attemptId},marker={...base,bodyHash:plan.bodyHash};
   await command('reserve','reserveAttempt',{accountId:originalRequest.accountId,operation:{operationKey:originalRequest.operationKey,purpose:plan.purpose,inputId:originalRequest.inputId,evidenceHash:originalRequest.evidenceManifestHash,semanticHash:originalRequest.semanticPayloadHash,threadHash:dshAHash(originalRequest.evidenceManifest.thread),workId:null,maxAttempts:originalRequest.maxAttempts,deadline:originalRequest.deadline},attempt:{attemptId,sequence,bodyHash:plan.bodyHash,providerId:plan.providerId,modelId:plan.modelId,modelProfileId:plan.modelProfileId,pricingHash:plan.pricingHash,pricingKnown:true,maxInputTokens:plan.maxInputTokens,maxOutputTokens:plan.maxOutputTokens,maxTokens:plan.maxTokens,maxCostMicros:plan.maxCostMicros,toolRounds:0}});reserved=true;
   physicalPort=invoke<OriginalMainPhysicalPort>(holder,'physicalPort',physicalComposition!.readOriginalMainDshPhysicalPort,undefined,[realm,store,runtime,budgetSource]);
   physicalPermit=(await joined<object>(holder,'modelCapacity',physicalPort.acquireModel,physicalPort,[actualToken,attemptId,plan.bodyHash])).value;current();
   const bodyPermit=freeze({bodyHash:plan.bodyHash,body:plan.serializedBody});let consumed=false;
   const modelHooks={beforeTransport(phase:'connect'|'send'){hooks.beforeTransport();if(phase==='connect'){physicalConsumeEntered=true;invoke(holder,'consumeModel',physicalPort!.consumeModel,physicalPort,[physicalPermit!],true);}},observeRawFailure:hooks.observeRawFailure};
   await command('marker','markPreSend',marker);current();await command('sent','markSent',marker,true);current();
   const sendFetch=invoke<typeof fetch>(holder,'sendFetch',createSingleRequestHttpsFetch,undefined,[{destination:endpoint,expectedBody:bodyPermit.body,timeoutMs:Math.min(30000,quoteUntil-now()),maxResponseBytes:2*1024*1024,signal:controller.signal,trackPhysicalDrain:hold,sourceHooks:modelHooks}]);
   if(consumed)fail('DSH_MODEL_BODY_ALREADY_USED');consumed=true;current();
   const rawReply=(await joined<unknown>(holder,'providerReply',sendFetch,undefined,[endpoint,{method:'POST',headers:{authorization:'Bearer '+binding.apiKey,'content-type':'application/json'},body:bodyPermit.body}])).value;
   const reply=(await joined<Awaited<ReturnType<typeof readSingleRequestOwnedReply>>>(holder,'providerBody',readSingleRequestOwnedReply,undefined,[sendFetch,rawReply])).value;
   if(reply.ownUnknown){for(const value of reply.ownExtras)hold(value);unknown.add(reply);fail('DSH_MODEL_SDK_UNKNOWN');}row.physicalReceipt=reply;try{await joined<void>(holder,'settleModelCapacity',physicalPort.settleModel,physicalPort,[physicalPermit,reply]);physicalSettled=true;}catch(error){physicalSettlementFailed=true;physicalSettlementFailure=error;remember(error);inventory(error);}if(reply.status!==200)fail('DSH_MODEL_PROVIDER_REJECTED');
   const rawText=utf8(reply.bytes),decoded=decodeDshChatCompletion(rawText);if(decoded.usage.kind!=='reported')fail('DSH_MODEL_USAGE_UNKNOWN');
   await command('settle_conservative','settleConservative',{...base,actualTokens:decoded.usage.totalTokens,chargedCostUpperBoundMicros:decoded.usage.chargedCostUpperBoundMicros,pricingHash:plan.pricingHash,usageReceiptHash:byteSha(reply.bytes)},true);
   const readInput={accountId:originalRequest.accountId},readData=parseDshInput('read',readInput);apply(mapSet,row.commands,['read',{input:readData,current:accounting}]);
   const readProof=invoke<object>(holder,'budgetReadProof',budgetSource.openAssessmentBudget,budgetSource,[actualToken,'read',readData]);
   const budgetPort=invoke<ReturnType<typeof readOriginalDshBudgetPort>>(holder,'budgetPort',readOriginalDshBudgetPort,undefined,[runtime,budgetSource]);
   const observation=(await joined<object>(holder,'budgetObservation',budgetPort.observe,budgetPort,[readData,readProof])).value;
   const observed=invoke<ReturnType<typeof readOriginalDshBudgetObservation>>(holder,'budgetObserved',readOriginalDshBudgetObservation,undefined,[budgetPort,observation]);
   if(observed.ownerId!==budget.ownerId||observed.status.account.account_id!==originalRequest.accountId||observed.status.account.authority_hash!==originalRequest.budgetAuthorityHash||observed.status.account.authorization_epoch!==originalRequest.authorizationEpoch)fail('DSH_MODEL_SETTLEMENT_UNCONFIRMED');
   let billed:Record<string,unknown>|undefined;const receipts=data<readonly Record<string,unknown>[]>(observed.status,'costAccountingReceipts');if(!Array.isArray(receipts))fail('DSH_MODEL_SETTLEMENT_UNCONFIRMED');
   for(let i=0;i<receipts.length;i++)if(receipts[i]!.accountId===originalRequest.accountId&&receipts[i]!.operationKey===originalRequest.operationKey&&receipts[i]!.attemptId===attemptId&&receipts[i]!.sequence===sequence){if(billed)fail('DSH_MODEL_SETTLEMENT_UNCONFIRMED');billed=receipts[i];}
   let ledgerAttempt:typeof observed.status.attempts[number]|undefined;for(let i=0;i<observed.status.attempts.length;i++){const value=observed.status.attempts[i]!;if(value.attempt_id===attemptId){if(ledgerAttempt)fail('DSH_MODEL_SETTLEMENT_UNCONFIRMED');ledgerAttempt=value;}}
   if(!billed||!ledgerAttempt||billed.basis!=='conservative_upper_bound'||billed.actualTokens!==decoded.usage.totalTokens||billed.chargedCostUpperBoundMicros!==decoded.usage.chargedCostUpperBoundMicros||billed.pricingHash!==plan.pricingHash||billed.usageReceiptHash!==byteSha(reply.bytes)||ledgerAttempt.state!=='settled'||data(ledgerAttempt,'cost_basis')!=='conservative_upper_bound'||ledgerAttempt.actual_tokens!==decoded.usage.totalTokens||ledgerAttempt.actual_cost!==null||ledgerAttempt.body_hash!==plan.bodyHash||ledgerAttempt.operation_key!==originalRequest.operationKey||ledgerAttempt.attempt_sequence!==sequence||ledgerAttempt.settlement_revision!==billed.settlementRevision||!ledgerAttempt.settlement_hash)fail('DSH_MODEL_SETTLEMENT_UNCONFIRMED');settled=true;
   if(physicalSettlementFailed)throw new NativeError('DSH_MODEL_PHYSICAL_SETTLEMENT_UNCONFIRMED',{cause:physicalSettlementFailure});
   if(decoded.text.kind!=='complete')fail('DSH_MODEL_OUTPUT_INCOMPLETE');const suggestion=parseDshAssessmentOutput(decoded.text.content,prompt.evidenceRefs);
   const assertKnown=()=>{if(!settled)fail('DSH_MODEL_FATE_UNKNOWN');};assertKnown();
   const result:DshAssessmentResultView=freeze({attemptId,modelId:originalRequest.modelId,promptVersion:originalRequest.promptVersion,ruleVersion:originalRequest.ruleVersion,evidenceManifestHash:originalRequest.evidenceManifestHash,dataEgressPolicyRef:originalRequest.dataEgressPolicyRef,validUntil:originalRequest.validUntil,assessmentVersion:originalRequest.assessmentVersion,purpose:originalRequest.purpose,result:freeze({suggestedIntent:suggestion.suggestedIntent,evidenceRefs:suggestion.evidenceRefs,uncertainty:suggestion.uncertainty}),assertCurrent:assertKnown,assertLocal:assertKnown,assertKnown,waitKnown:async()=>{assertKnown();}});row.result=result;return actualToken;
  }catch(error){remember(error);inventory(error);
   // A failed request can still have a real, original physical close. Join
   // its discovered error tails first; billing remains independently unknown.
   if(physicalPort&&physicalPermit&&physicalConsumeEntered&&!physicalSettled&&token){
    while(tails.size)await settleIntrinsicOperations(tails.snapshot(),value=>value);
    let actual:ReturnType<typeof readOriginalSingleRequestPhysicalReceipt>|undefined;
    if(!unknown.size)try{actual=readOriginalSingleRequestPhysicalReceipt(error);}catch{/* Non-members and unknown physical fates remain held. */}
    if(actual){const row=apply(get,attempts,[token]) as Attempt;row.physicalReceipt=error as object;
     try{actual.assertKnown();await joined<void>(holder,'settleFailedModelCapacity',physicalPort.settleModel,physicalPort,[physicalPermit,error]);physicalSettled=true;}catch(cleanup){remember(cleanup);inventory(cleanup);}
    }
   }
   if(reserved&&!settled&&token&&request){try{await command('unknown','markUnknown',{accountId:request.accountId,operationKey:request.operationKey,sequence:1,attemptId,reason:'transport_unknown'},true);}catch(cleanup){remember(cleanup);inventory(cleanup);}}throw new NativeError('DSH_MODEL_ATTEMPT_FAILED',{cause:error});}
  finally{try{if(physicalPort&&physicalPermit&&!physicalConsumeEntered)await joined<void>(holder,'cancelUnusedModelCapacity',physicalPort.cancelModel,physicalPort,[physicalPermit]);}catch(error){remember(error);inventory(error);unknown.add(error);}finally{controllers.delete(controller);roots.delete(completion);complete();}}
 }
 const executions=new Map<string,Promise<object>>();
 function runAssessment(attemptId:string):Promise<object>{
  if(!accepting||closed||unknown.size)return new NativePromise((_yes,no)=>no(new NativeError('DSH_MODEL_CLOSED')));
  if(typeof attemptId!=='string'||!attemptId||attemptId.length>256)return new NativePromise((_yes,no)=>no(new NativeError('DSH_MODEL_ATTEMPT_INVALID')));
  const existing=apply(mapGet,executions,[attemptId]) as Promise<object>|undefined;if(existing)return existing;
  let yes!:(value:object)=>void,no!:(error:unknown)=>void;const result=new NativePromise<object>((resolve,reject)=>{yes=resolve;no=reject;});apply(mapSet,executions,[attemptId,result]);
  try{const raw=executeAssessment(attemptId);assertStandardIpcPromise(raw,'DSH_MODEL_EXECUTION_UNKNOWN');apply(then,raw,[yes,no]);}catch(error){inventory(error);no(error);}return result;
 }
 function stopAccepting(){accepting=false;const active=controllers.snapshot();for(let i=0;i<active.length;i++)try{apply(abort,active[i],[new NativeError('DSH_MODEL_CLOSED')]);}catch(error){remember(error);inventory(error);unknown.add(error);}}
 function close():Promise<void>{if(closing)return closing;stopAccepting();closing=(async()=>{while(roots.size||tails.size){await settleIntrinsicOperations(roots.snapshot(),value=>value);await settleIntrinsicOperations(tails.snapshot(),value=>value);}if(unknown.size)throw new NativeError('DSH_MODEL_FATE_UNKNOWN',{cause:first});closed=true;})();return closing;}
 const source=freeze({runAssessment,stopAccepting,close});apply(set,modelSources,[source,{realm,store,runtime,budgetSource,local(){if(!accepting||closed||unknown.size)fail('DSH_MODEL_CLOSED');},pricing(){if(!latestPricing)fail('DSH_MODEL_PRICING_EVIDENCE_UNAVAILABLE');return latestPricing;}}]);return source;
}
