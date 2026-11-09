import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import {Completions} from 'openai/resources/chat/completions';
import {Messages} from '@anthropic-ai/sdk/resources/messages';
import {createProviderDisclosureFetch,type ProviderDisclosureContext} from '../../runtime/sol-pi/provider-disclosure.js';
import * as OpenAiErrors from 'openai/core/error';
import * as AnthropicErrors from '@anthropic-ai/sdk/core/error';
import {APIPromise as AnthropicAPIPromise} from '@anthropic-ai/sdk/core/api-promise';
import {Stream as AnthropicStream} from '@anthropic-ai/sdk/core/streaming';
import {createIntrinsicSet} from '../../runtime/verification/intrinsic-async-collection.js';
import {APIPromise} from 'openai/core/api-promise';
import {Stream} from 'openai/core/streaming';
import {assertStandardIpcPromise} from '../../runtime/verification/native-ipc-promise.js';
import {createHash,randomUUID} from 'node:crypto';
import {types} from 'node:util';
import {readOptionalOriginalMainSdkBridge,type OriginalMainSdkPhysicalBridge} from '../../runtime/verification/original-main-sdk-bridge.js';
import {readCurrentOriginalRootExecutionContext} from '../../runtime/verification/original-root-execution-context.js';
import {readCurrentOriginalTaskRunnerResourceContext} from '../../runtime/task-host/task-runtime-host.js';
import {createRoomTurnCustody,type RoomTurnCustody} from '../../runtime/verification/original-sdk-custody.js';
import {readOriginalSemanticSummaryModelTransport} from '../../runtime/sol-pi/semantic-summary-attempt.js';
import {attachOriginalSingleRequestResourceGate,createSingleRequestHttpsFetch,isOriginalSingleRequestResponse,readOriginalSingleRequestStreamPhysicalReceipt,readOriginalSingleRequestPhysicalReceipt} from '../../runtime/sol-pi/single-request-https.js';

const NativeWeakMap=WeakMap,weakGet=WeakMap.prototype.get,weakSet=WeakMap.prototype.set;
const apply=Reflect.apply,freeze=Object.freeze,create=Object.create;
const NativeAbortController=AbortController,abort=AbortController.prototype.abort,signalAny=AbortSignal.any;
const NativePromise=Promise,nativeThen=Promise.prototype.then;
const NativeError=Error,NativeURL=URL;
const isProxy=types.isProxy,descriptor=Object.getOwnPropertyDescriptor,keys=Reflect.ownKeys,own=Object.hasOwn,prototype=Object.getPrototypeOf,define=Object.defineProperty;
const apiPromisePrototype=APIPromise.prototype,sdkStreamPrototype=Stream.prototype;
const openAiProfile={promisePrototype:apiPromisePrototype,streamPrototype:sdkStreamPrototype,iterator:descriptor(sdkStreamPrototype,Symbol.asyncIterator)!.value as Function};
const anthropicProfile={promisePrototype:AnthropicAPIPromise.prototype,streamPrototype:AnthropicStream.prototype,iterator:descriptor(AnthropicStream.prototype,Symbol.asyncIterator)!.value as Function};
const openAiWithOptions=OpenAI.prototype.withOptions,anthropicWithOptions=Anthropic.prototype.withOptions;
const openAiCreate=Completions.prototype.create,anthropicCreate=Messages.prototype.create;
const responseJson=Response.prototype.json,responseText=Response.prototype.text;
const responseHeaders=descriptor(Response.prototype,'headers')!.get!,responseStatus=descriptor(Response.prototype,'status')!.get!;
const nativeError=types.isNativeError;
interface ErrorExports {APIError:{prototype:object};BadRequestError:{prototype:object};AuthenticationError:{prototype:object};PermissionDeniedError:{prototype:object};NotFoundError:{prototype:object};ConflictError:{prototype:object};UnprocessableEntityError:{prototype:object};RateLimitError:{prototype:object};InternalServerError:{prototype:object};APIConnectionError:{prototype:object};APIUserAbortError:{prototype:object}}
function errorProfile(errors:ErrorExports){return {base:errors.APIError.prototype,badRequest:errors.BadRequestError.prototype,authentication:errors.AuthenticationError.prototype,permission:errors.PermissionDeniedError.prototype,notFound:errors.NotFoundError.prototype,conflict:errors.ConflictError.prototype,unprocessable:errors.UnprocessableEntityError.prototype,rateLimit:errors.RateLimitError.prototype,internal:errors.InternalServerError.prototype,connection:errors.APIConnectionError.prototype,abort:errors.APIUserAbortError.prototype};}
const openAiErrorProfile=errorProfile(OpenAiErrors),anthropicErrorProfile=errorProfile(AnthropicErrors);
function httpErrorPrototype(status:number,profile:typeof openAiErrorProfile):object {
 if(status===400)return profile.badRequest;if(status===401)return profile.authentication;if(status===403)return profile.permission;if(status===404)return profile.notFound;if(status===409)return profile.conflict;if(status===422)return profile.unprocessable;if(status===429)return profile.rateLimit;if(status>=500)return profile.internal;return profile.base;
}
const exampleGenerator=(async function*(){})();
const generatorPrototype=prototype(prototype(exampleGenerator));
const generatorNext=descriptor(generatorPrototype,'next')!.value as Function;
const generatorReturn=descriptor(generatorPrototype,'return')!.value as Function;

interface Frame {
 context:object;permit?:object;attemptId:string;requestDigest:string;
 network:RoomTurnCustody;control:RoomTurnCustody;bridge:OriginalMainSdkPhysicalBridge;
 used:boolean;closed:boolean;unknown:boolean;fetch?:typeof globalThis.fetch;response?:Response;
 physical?:object;wireError?:unknown;receipt?:object;close?:Promise<void>;settleCapacity?:Function;
}
interface Receipt {frame:Frame;sdk:RoomTurnCustody}
const receipts=new NativeWeakMap<object,Receipt>();
const active=createIntrinsicSet<object>();
const transports=new NativeWeakMap<object,()=>Promise<void>>();
const unconfirmed=()=>new NativeError('MODEL_SDK_PHYSICAL_UNCONFIRMED');
export function readOriginalGenericModelSdkPhysicalReceipt(context:unknown,permit:unknown,receipt:unknown):Readonly<{attemptId:string;requestDigest:string;assertKnown():void}> {
 const row=apply(weakGet,receipts,[receipt]) as Receipt|undefined;
 if(!row||row.frame.context!==context||row.frame.permit!==permit)throw new NativeError('MODEL_SDK_ORIGINAL_PHYSICAL_RECEIPT_REQUIRED');
 const assertKnown=()=>{
  const frame=row.frame;
  if(!frame.closed||frame.unknown||!frame.physical)throw unconfirmed();
  readOriginalSingleRequestPhysicalReceipt(frame.physical).assertKnown();
  frame.network.assertPhysicalKnown();row.sdk.assertPhysicalKnown();
 };
 assertKnown();return freeze({attemptId:row.frame.attemptId,requestDigest:row.frame.requestDigest,assertKnown});
}
export interface OriginalModelSdkAttemptTransport {
 readonly fetch:typeof globalThis.fetch;
 createOpenAI(client:unknown,request:unknown):Promise<unknown>;
 createAnthropic(client:unknown,request:unknown):Promise<unknown>;
 readJSON(response:unknown):Promise<unknown>;
 readText(response:unknown):Promise<string>;
 finish():Promise<void>;
}
/** One existing SDK operation, with one M for each actual HTTP invocation.
 * This is a resource gate, never provider disclosure or a business grant. */
export function createOriginalModelSdkAttemptTransport(signal?:AbortSignal,disclosure?:ProviderDisclosureContext,limits?:{timeoutMs:number;maxResponseBytes:number},originalSemanticTransport?:unknown):OriginalModelSdkAttemptTransport|null {
 const originalBridge=readOptionalOriginalMainSdkBridge();if(!originalBridge)return null;
 const semantic=originalSemanticTransport===undefined?undefined:readOriginalSemanticSummaryModelTransport(originalSemanticTransport);
 const bridge:OriginalMainSdkPhysicalBridge=originalBridge;
 const timeoutMs=limits?.timeoutMs??600000,maxResponseBytes=limits?.maxResponseBytes??16*1024*1024;
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>2147483647||!Number.isSafeInteger(maxResponseBytes)||maxResponseBytes<1||maxResponseBytes>256*1024*1024)throw unconfirmed();
 const context=readCurrentOriginalTaskRunnerResourceContext()??readCurrentOriginalRootExecutionContext();
 if(!context)throw new NativeError('MODEL_SDK_ORIGINAL_SOURCE_CONTEXT_REQUIRED');
 const sdk=createRoomTurnCustody(),frames:Frame[]=[],controller=new NativeAbortController();
 const holder=freeze(create(null));
 const sdkResources:Array<{value:object;consume:Function}>=[];
 const rawSdkValues:unknown[]=[];
 const failures=createIntrinsicSet<unknown>();
 const resourceBirths=createIntrinsicSet<object>();
 function rememberResource(value:object,consume:Function):void{if(!resourceBirths.has(value)){resourceBirths.add(value);sdkResources[sdkResources.length]={value,consume};}}
 const sdkBirths=new NativeWeakMap<object,object>();
 const group={holder,sdk,frames,sdkResources,rawSdkValues};active.add(group);
 let sealed=false,closing:Promise<void>|undefined,sdkUnknown=false;
 function ownValue(value:object,name:string):unknown {
  const row=descriptor(value,name);if(!row||!own(row,'value'))throw unconfirmed();return row.value;
 }
 async function readSdk(raw:unknown,client:unknown,profile:{promisePrototype:object;streamPrototype:object;iterator:Function},errorProfile:typeof openAiErrorProfile):Promise<unknown>{
  rawSdkValues[rawSdkValues.length]=raw;
  if(sealed||!raw||typeof raw!=='object'||isProxy(raw)||apply(weakGet,sdkBirths,[raw])!==profile||prototype(raw)!==profile.promisePrototype){sdkUnknown=true;sdk.inventory(raw);throw unconfirmed();}
  // Never assimilate the SDK Promise subclass: its super Promise resolves null.
  // The fixed original parser consumes its genuine responsePromise instead.
  let responsePromise:unknown,parseOpenAi:unknown;
  try{responsePromise=ownValue(raw,'responsePromise');assertStandardIpcPromise(responsePromise,'MODEL_SDK_PROMISE_UNCONFIRMED');parseOpenAi=ownValue(raw,'parseResponse');if(typeof parseOpenAi!=='function'||isProxy(parseOpenAi))throw unconfirmed();}
  catch(error){sdkUnknown=true;sdk.inventory(raw);throw error;}
  // The original create() also installs a request-specific parser closure
  // (SDK response-attempt/deadline ownership). Capture that actual own data
  // function; replacing it with a generic parser would discard those tails.

  const projection=create(null) as object;
  function capture(){
   const names=keys(raw as object);
   for(let i=0;i<names.length;i++){
    const name=names[i]!,row=descriptor(raw as object,name);if(!row){sdkUnknown=true;continue;}
    const shell=create(null) as PropertyDescriptor;
    // Preserve accessors as descriptors; the common resource collector records
    // unknown and sibling raw tails without evaluating any accessor.
    if(own(row,'value')){shell.value=row.value;shell.writable=true;}
    else{shell.get=row.get;shell.set=row.set;}
    shell.configurable=true;shell.enumerable=true;define(projection,name,shell);
   }
  }
  const closeProjection=function(){capture();};
  const closeProps=function(){};
  const closeFailure=function(){};
  const failureResource={strictProxyGraph:true,consumer:closeFailure,accept(value:unknown):boolean{
   if(!value||typeof value!=='object'||isProxy(value)||!nativeError(value))return false;
   const status=descriptor(value,'status'),headers=descriptor(value,'headers'),cause=descriptor(value,'cause');
   for(let i=0;i<frames.length;i++){
    const frame=frames[i]!;if(!frame.closed||!frame.physical)continue;
    try{readOriginalSingleRequestPhysicalReceipt(frame.physical).assertKnown();}catch{return false;}
    let accepted=false;
    if(frame.response&&frame.fetch&&isOriginalSingleRequestResponse(frame.fetch,frame.response)&&status&&own(status,'value')&&headers&&own(headers,'value')){
     const actualStatus=apply(responseStatus,frame.response,[]) as number;
     accepted=actualStatus>=300&&status.value===actualStatus&&headers.value===apply(responseHeaders,frame.response,[])&&prototype(value)===httpErrorPrototype(actualStatus,errorProfile);
    }
    if(!accepted&&frame.wireError!==undefined&&cause&&own(cause,'value')&&cause.value===frame.wireError&&(prototype(value)===errorProfile.connection||prototype(value)===errorProfile.abort))accepted=true;
    if(accepted){failures.add(value);rememberResource(value,closeFailure);return true;}
   }
   return false;
  }};
  const acceptProps=(value:unknown)=>{
   if(!value||typeof value!=='object'||isProxy(value))return false;
   const response=descriptor(value,'response');if(!response||!own(response,'value'))return false;
   for(let i=0;i<frames.length;i++){const frame=frames[i]!;if(frame.fetch&&isOriginalSingleRequestResponse(frame.fetch,response.value)){rememberResource(value as object,closeProps);return true;}}
   return false;
  };
  // First observation of the real responsePromise has its resource consumer,
  // before the full own/symbol projection can encounter that same Promise.
  const pending=sdk.sdk<object>(()=>responsePromise,undefined,[],{accept:acceptProps,consumer:closeProps,strictProxyGraph:true,failureResource});
  apply(nativeThen,pending,[undefined,()=>{}]);
  capture();await sdk.sdk(()=>projection,undefined,[],{accept(value){if(value!==projection)return false;rememberResource(projection,closeProjection);return true;},consumer:closeProjection,strictProxyGraph:true});
  const props=await pending;
  const closeStream=function(this:object){
   const originalController=ownValue(this,'controller');apply(abort,originalController,[]);
  };
  const stream=await sdk.sdk<object>(parseOpenAi as Function,undefined,[client,props],{
   accept(value){if(!value||typeof value!=='object'||isProxy(value)||prototype(value)!==profile.streamPrototype)return false;rememberResource(value,closeStream);return true;},
   consumer:closeStream,strictProxyGraph:true,failureResource,
  });
  let returned:Promise<unknown>|undefined;
  function closeIterator(this:object):Promise<unknown>{
   if(returned)return returned;
   const original=apply(generatorReturn,this,[]) as Promise<unknown>;returned=original;return original;
  }
  const iterator=await sdk.sdk<object>(profile.iterator,stream,[],{
   accept(value){if(!value||typeof value!=='object'||isProxy(value))return false;rememberResource(value,closeIterator);return true;},consumer:closeIterator,strictProxyGraph:true,failureResource,
  });
  // The SDK iterator, next/return raw promises and their own/symbol/outcomes
  // remain private. The adapter gets a fixed consumer, never a foreign await.
  const consumed=freeze({
   next:()=>sdk.sdk<IteratorResult<unknown>>(generatorNext,iterator,[]),
   return:()=>sdk.consumeResource<IteratorResult<unknown>>(closeIterator,iterator,[]),
  });
  return freeze({[Symbol.asyncIterator](){return consumed;}});
 }
 const fetch:typeof globalThis.fetch=async(input,init)=>{
  if(sealed)throw new NativeError('MODEL_SDK_ATTEMPT_CLOSED');
  // SDKs serialize model requests before their physical fetch. A Request or
  // coercible caller object is not a substitute for this exact request body.
  if(typeof input!=='string'||!init||init.method!=='POST'||typeof init.body!=='string')throw new NativeError('MODEL_SDK_REQUEST_INVALID');
  const destination=new NativeURL(input);
  if(destination.href!==input||destination.username||destination.password||destination.hash||destination.protocol!=='https:'&&destination.protocol!=='http:')throw new NativeError('MODEL_SDK_REQUEST_INVALID');
  const attemptId=`model-sdk:${randomUUID()}`;
  const requestDigest=createHash('sha256').update(JSON.stringify(['original-model-sdk-request-v1',input,'POST',init.body])).digest('hex');
  const frame:Frame={context,attemptId,requestDigest,network:createRoomTurnCustody(),control:createRoomTurnCustody(),bridge,used:false,closed:false,unknown:false};
  frames[frames.length]=frame;
  // The fixed consumer can only settle this frame's original cap/receipt, or
  // cancel it before physical entry. Failed SDK calls still run this cleanup.
  function settleCapacity():Promise<void>{
   if(!frame.permit)throw unconfirmed();
   if(!frame.used)return bridge.cancelModel(frame.permit);
   if(!frame.receipt)throw unconfirmed();
   return bridge.settleModel(frame.permit,frame.receipt);
  }
  frame.settleCapacity=settleCapacity;
  let response:Response|undefined;
  try{
   await frame.control.root(async()=>{
    await frame.control.sdk(()=>bridge,undefined,[],{accept:value=>value===bridge,consumer:settleCapacity});
    frame.permit=await frame.control.sdk<object>(bridge.acquireModel,bridge,[context,attemptId,requestDigest]);
   });
   await frame.network.root(async()=>{
    function beforeSource(phase:'connect'|'send'):void {
     if(!frame.permit)throw unconfirmed();frame.control.syncVoid(bridge.assertModelCurrent,bridge,[frame.permit]);
     if(phase==='connect'){frame.control.syncVoid(bridge.consumeModel,bridge,[frame.permit]);frame.used=true;}
    }
    function afterSourceLocal():void {if(!frame.permit)throw unconfirmed();frame.control.syncVoid(bridge.assertModelLocal,bridge,[frame.permit]);}
    function observeRawFailure(raw:unknown):void {frame.network.inventory(raw);}
    const transport=semantic?.physicalFetch??createSingleRequestHttpsFetch({destination:input,expectedBody:init.body as string,transportProfile:'model_stream_v1',timeoutMs,maxResponseBytes,signal:controller.signal});
    attachOriginalSingleRequestResourceGate(transport,{beforeSource,afterSourceLocal,observeRawFailure});
    frame.fetch=transport;
    const signals:AbortSignal[]=[];if(signal)signals[signals.length]=signal;if(init.signal)signals[signals.length]=init.signal;
    response=await frame.network.sdk<Response>(semantic?.fetch??transport,undefined,[input,{...init,signal:apply(signalAny,AbortSignal,[signals]) as AbortSignal}],{
     accept:value=>isOriginalSingleRequestResponse(transport,value),
     consumer:consumeResponse,
    });
    frame.response=response;
    // Register this original resource consumer before the SDK sees Response.
    frame.close=frame.network.consumeResource<void>(consumeResponse,response,[]);
    apply(nativeThen,frame.close,[undefined,()=>{}]);
   });
  }catch(error){
   if(frame.fetch){
    try{frame.physical=await readOriginalSingleRequestStreamPhysicalReceipt(frame.fetch,error);frame.wireError=error;frame.closed=true;}
    catch{frame.unknown=frame.used;}
   }
   throw error;
  }
  return response!;
  async function consumeResponse(this:Response):Promise<void>{
   if(!frame.fetch||!isOriginalSingleRequestResponse(frame.fetch,this))throw unconfirmed();
   try{frame.physical=await readOriginalSingleRequestStreamPhysicalReceipt(frame.fetch,this);frame.closed=true;}
   catch(error){frame.unknown=true;throw error;}
  }
 };
 function finish():Promise<void>{
  if(closing)return closing;sealed=true;
  closing=(async()=>{
   const failures:unknown[]=[];
   for(let i=sdkResources.length-1;i>=0;i--){
    const resource=sdkResources[i]!;
    try{await sdk.consumeResource(resource.consume,resource.value,[]);}catch(error){failures[failures.length]=error;}
   }
   // Abort is cleanup, independent of effect authority or a failed sibling.
   try{apply(abort,controller,[]);}catch(error){sdk.inventory(error);failures[failures.length]=error;}
   for(let i=0;i<frames.length;i++){
    const frame=frames[i]!;
    if(frame.close)try{await frame.close;}catch(error){failures[failures.length]=error;}
   }
   try{await sdk.waitPhysicalKnown();}catch(error){failures[failures.length]=error;}
   for(let i=0;i<frames.length;i++){
    const frame=frames[i]!;
    try{
     if(frame.used){
      if(sdkUnknown)throw unconfirmed();
      await frame.network.waitPhysicalKnown();
      const receipt=freeze(create(null));frame.receipt=receipt;apply(weakSet,receipts,[receipt,{frame,sdk}]);
      readOriginalGenericModelSdkPhysicalReceipt(context,frame.permit,receipt).assertKnown();
     }
     if(frame.permit)await frame.control.consumeResource<void>(frame.settleCapacity!,bridge,[]);
    }catch(error){frame.unknown=true;failures[failures.length]=error;}
   }
   if(failures.length)throw new AggregateError(failures,'MODEL_SDK_PHYSICAL_UNCONFIRMED',{cause:failures[0]});
   active.delete(group);
  })();
  // Register the original promise immediately; the caller still receives and
  // must await its same sticky completion. No rejected detached bookkeeping.
  apply(nativeThen,closing,[undefined,()=>{}]);return closing;
 }
 async function readBody(response:unknown,text:boolean):Promise<unknown>{
  if(sealed)throw unconfirmed();
  let found=false;for(let i=0;i<frames.length;i++){const frame=frames[i]!;if(frame.response===response&&frame.fetch&&isOriginalSingleRequestResponse(frame.fetch,response)){found=true;break;}}
  if(!found)throw unconfirmed();return sdk.sdk(text?responseText:responseJson,response,[]);
 }
 async function createSdk(client:unknown,request:unknown,anthropic:boolean):Promise<unknown>{
  let value:unknown,failure:{raw:unknown}|undefined;
  await sdk.root(async()=>{
   let entered=false,returned=false,cloneEntered=false,cloneReturned=false;
   try{
    const sentinel=new NativePromise<void>(yes=>yes());assertStandardIpcPromise(sentinel,'MODEL_SDK_PROMISE_METADATA_UNCONFIRMED');
    const expected=anthropic?Anthropic:OpenAI;
    if(!client||typeof client!=='object'||isProxy(client)||prototype(client)!==expected.prototype)throw unconfirmed();
    const constructor=descriptor(client,'constructor'),inheritedConstructor=descriptor(expected.prototype,'constructor');
    if(constructor&&(!own(constructor,'value')||constructor.value!==expected)||!inheritedConstructor||!own(inheritedConstructor,'value')||inheritedConstructor.value!==expected)throw unconfirmed();
    const guarded=disclosure?createProviderDisclosureFetch(disclosure,fetch):fetch;
    cloneEntered=true;const clone=apply(anthropic?anthropicWithOptions:openAiWithOptions,client,[{fetch:guarded,maxRetries:0}]);cloneReturned=true;
    const receiver=anthropic?ownValue(clone,'messages'):ownValue(ownValue(clone,'chat') as object,'completions');
    if(!receiver||typeof receiver!=='object'||isProxy(receiver)||prototype(receiver)!==(anthropic?Messages.prototype:Completions.prototype)||ownValue(receiver,'_client')!==clone)throw unconfirmed();
    entered=true;
    const raw=apply(anthropic?anthropicCreate:openAiCreate,receiver,[request,{signal,...(anthropic?{headers:{'x-stainless-helper-method':'stream'}}:{})}]);returned=true;
    if(raw&&typeof raw==='object')apply(weakSet,sdkBirths,[raw,anthropic?anthropicProfile:openAiProfile]);
    value=await readSdk(raw,clone,anthropic?anthropicProfile:openAiProfile,anthropic?anthropicErrorProfile:openAiErrorProfile);
   }catch(raw){rawSdkValues[rawSdkValues.length]=raw;if(entered&&!returned||cloneEntered&&!cloneReturned)sdkUnknown=true;if(!failures.has(raw))sdk.inventory(raw);failure={raw};}
  });
  if(failure)throw failure.raw;return value;
 }
 const transport=freeze({fetch,
  createOpenAI:(client:unknown,request:unknown)=>createSdk(client,request,false),
  createAnthropic:(client:unknown,request:unknown)=>createSdk(client,request,true),
  readJSON:(response:unknown)=>readBody(response,false),
  readText:(response:unknown)=>readBody(response,true) as Promise<string>,
  finish});apply(weakSet,transports,[transport,finish]);return transport;
}

/** Preserve the original SDK first cause while joining its actual cleanup.
 * Only a private transport born above can supply this completion function. */
export async function finishOriginalModelSdkAttempt(transport:unknown,first?:{raw:unknown}):Promise<void>{
 if(transport===null)return;
 const finish=apply(weakGet,transports,[transport]) as (()=>Promise<void>)|undefined;
 if(!finish)throw unconfirmed();
 try{await finish();}catch(error){if(first)throw new AggregateError([first.raw,error],'MODEL_SDK_PHYSICAL_UNCONFIRMED',{cause:first.raw});throw error;}
}
