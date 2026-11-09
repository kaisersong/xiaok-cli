import type {AdapterCredentialResolver} from '../../src/ai/providers/model-harness-profile.js';
import {readAssistantProviderStatus} from './assistant-analysis-failure.js';
import { createHash } from 'node:crypto';
import type { ConfigInput, Message } from '../../src/types.js';
import type { AssistantAnalysisPort } from '../../src/runtime/assistant/analysis-port.js';
import { createAdapterFromBinding } from '../../src/ai/models.js';
import { OpenAIAdapter } from '../../src/ai/adapters/openai.js';
import { resolveRuntimeModelBinding } from '../../src/ai/providers/control-plane.js';
import { streamStatelessSideCallProviderConversation } from '../../src/ai/runtime/provider-conversation-authorization.js';
import { resolveProductionCapacityProfile, measureRequestCapacity } from '../../src/runtime/sol-pi/capacity-admission.js';
import { inspectDeepSeekRecipeEnvironment, freezeDeepSeekRecipeCounter, type FrozenDeepSeekCounter } from '../../src/runtime/sol-pi/deepseek-capacity-profile.js';
import { join } from 'node:path';
import { readAssistantModelConfiguration } from '../../src/runtime/assistant/model-identity.js';
import type OpenAI from 'openai';

type NativeChunk = OpenAI.Chat.Completions.ChatCompletionChunk;
export interface AsyncAssistantAnalysisPort extends Omit<AssistantAnalysisPort, 'measureInput'> {
  measureInput(input: { systemPrompt: string; userMessage: string }): Promise<number>;
}
export class AssistantAnalysisProviderUnavailableError extends Error {
  readonly code = 'ASSISTANT_ANALYSIS_PROVIDER_UNAVAILABLE';
  constructor() { super('ASSISTANT_ANALYSIS_PROVIDER_UNAVAILABLE'); this.name = 'AssistantAnalysisProviderUnavailableError'; }
}
export class AssistantAnalysisProviderFailure extends Error {
  readonly code = 'ASSISTANT_ANALYSIS_PROVIDER_FAILURE';
  readonly status?: number;
  constructor(error?: unknown) {
    super('ASSISTANT_ANALYSIS_PROVIDER_FAILURE',{cause:error}); this.name = 'AssistantAnalysisProviderFailure';
    this.status=readAssistantProviderStatus(error);
  }
}
/** Main must retain actual usage and disable this contract after a breach. */
export class AssistantAnalysisProviderContractBreach extends Error {
  readonly code = 'ASSISTANT_ANALYSIS_PROVIDER_CONTRACT_BREACH';
  constructor(readonly usage: {inputTokens:number;outputTokens:number}) {
    super('ASSISTANT_ANALYSIS_PROVIDER_CONTRACT_BREACH');this.name='AssistantAnalysisProviderContractBreach';
  }
}
function deny(): never { throw new AssistantAnalysisProviderUnavailableError(); }
const fingerprint = (input: {systemPrompt:string;userMessage:string}) => createHash('sha256')
  .update(JSON.stringify([input.systemPrompt,input.userMessage])).digest('hex');
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const WIRE_MODELS = ['deepseek-flash'];
const TOKENIZER_ID='deepseek-recipe:0.1.1:v41:frozen';
export function checkDesktopAssistantAnalysisProviderSupport(config:ConfigInput,modelId:string):
  {supported:true;provider:string;model:string;modelId:string}|{supported:false;reason:'provider_contract_unavailable'} {
  try {
    const configured=(config as {models?:Record<string,{model?:unknown}>}).models?.[modelId];
    if(!modelId || !configured || typeof configured.model!=='string' || !configured.model) throw Error();
    const binding=resolveRuntimeModelBinding(config,modelId,false);
    if(binding.providerId!=='deepseek'||binding.providerType!=='first_party'||binding.protocol!=='openai_legacy'
      ||!WIRE_MODELS.includes(binding.wireModel)||!['https://api.deepseek.com','https://api.deepseek.com/v1'].includes(binding.baseUrl?.replace(/\/$/,'')??'')) throw Error();
    return {supported:true,provider:binding.providerId,model:binding.wireModel,modelId};
  } catch { return {supported:false,reason:'provider_contract_unavailable'}; }
}

/** Main-only bootstrap. No arbitrary IPC path, implicit fallback or config writes.
 * dataRoot contains the pinned wheel/tokenizer and dedicated extracted package.
 * Python must already exist; this never installs into its global site-packages. */
export async function bootstrapDesktopAssistantAnalysisProvider(input:{
  dataRoot:string;pythonExecutable:string;modelId:string;timeoutMs?:number;
}) {
  let snapshot;
  try {snapshot=readAssistantModelConfiguration();} catch {return deny();}
  const modelId=input.modelId;
  if(!checkDesktopAssistantAnalysisProviderSupport(snapshot.config,modelId).supported) deny();
  const environment={pythonExecutable:input.pythonExecutable,sitePackages:join(input.dataRoot,'site-packages'),
    tokenizerPath:join(input.dataRoot,'tokenizer.json'),wheelPath:join(input.dataRoot,'deepseek_recipe-0.1.1-cp310-abi3-macosx_11_0_arm64.whl')};
  let manifest;
  try {manifest=inspectDeepSeekRecipeEnvironment(environment);}catch{return deny();}
  const counter=freezeDeepSeekRecipeCounter({...environment,environmentManifest:manifest});
  const transport=snapshot.transportForModel(modelId);
  const port=createBoundAssistantAnalysisProvider({config:snapshot.config,modelId,counter,timeoutMs:input.timeoutMs},()=>{const actual=transport.resolve();assertCurrent();return actual;});
  const pinned=resolveRuntimeModelBinding(snapshot.config,modelId,false);
  // Binding equality is private; never export raw credentials or a hash of a key.
  const readCurrentModel=()=>{
    try {
      const current=readAssistantModelConfiguration();
      const actual=resolveRuntimeModelBinding(current.config,modelId,false);
      if(JSON.stringify(actual)!==JSON.stringify(pinned)) deny();
      return current.identity;
    } catch {return deny();}
  };
  const assertCurrent=()=>{
    const current=readCurrentModel();
    if(current.modelEpoch!==snapshot.identity.modelEpoch || current.configFingerprint!==snapshot.identity.configFingerprint) deny();
  };
  const contract=Object.freeze({...port.contract,id:`assistant-analysis-v1:${createHash('sha256').update(JSON.stringify({contract:port.contract,counterManifestSha256:manifest.sha256})).digest('hex')}`});
  const guardedPort:AsyncAssistantAnalysisPort=Object.freeze({...port,contract,
    async measureInput(request:Parameters<AssistantAnalysisPort['measureInput']>[0]){assertCurrent();const measured=await port.measureInput(request);assertCurrent();return measured;},
    async complete(request:Parameters<AssistantAnalysisPort['complete']>[0]){assertCurrent();const result=await port.complete(request);assertCurrent();return result;},
  });
  assertCurrent();
  const contractHash=createHash('sha256').update(JSON.stringify(contract)).digest('hex');
  return Object.freeze({modelId,port:guardedPort,identity:Object.freeze(snapshot.identity),readCurrentModel,knownSecrets:transport.knownSecrets,counterManifestSha256:manifest.sha256,contractHash});
}

/** Explicit model binding; existing SDK, credentials and conversation authorization only. */
type AnalysisProviderInput={config:ConfigInput;modelId:string;counter:FrozenDeepSeekCounter;timeoutMs?:number};
export function createDesktopAssistantAnalysisProvider(input:AnalysisProviderInput):AsyncAssistantAnalysisPort{return createBoundAssistantAnalysisProvider(input);}
// Only the fixed bootstrap above supplies the original selected-provider resolver.
function createBoundAssistantAnalysisProvider(input:AnalysisProviderInput,credentialResolver?:AdapterCredentialResolver):AsyncAssistantAnalysisPort {
  let binding;
  try {
    if (!input || typeof input.modelId !== 'string' || !input.modelId) deny();
    binding = resolveRuntimeModelBinding(input.config, input.modelId,!credentialResolver);
  } catch { return deny(); }
  if (!checkDesktopAssistantAnalysisProviderSupport(input.config,input.modelId).supported) deny();
  const pinned = structuredClone(binding);
  const timeoutMs = input.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) deny();
  const destination = `${pinned.baseUrl!.replace(/\/$/,'')}/chat/completions`;
  const profile = resolveProductionCapacityProfile({destination,model:'deepseek-flash',protocol:pinned.protocol,profileId:'generic-openai',counter:input.counter});
  if (!profile) deny();
  const measurements = new Map<string,number>(), attempts = new Set<string>();
  const messages = (text:string):Message[] => [{role:'user',content:[{type:'text',text}]}];
  const adapterFor = () => {
    const adapter = createAdapterFromBinding(pinned,credentialResolver);
    if (!(adapter instanceof OpenAIAdapter) || adapter.getOwnedHarnessProfileId() !== 'generic-openai') return deny();
    return adapter;
  };
  const preview = (adapter:OpenAIAdapter, request:{systemPrompt:string;userMessage:string}, maximum:number) => {
    if (typeof request.systemPrompt !== 'string' || typeof request.userMessage !== 'string') return deny();
    const wire = adapter.getObservationRequestPreview(messages(request.userMessage),[],request.systemPrompt,{maxOutputTokens:maximum,reasoningMode:'disabled'});
    if (!wire || Buffer.byteLength(wire.serializedBody)>1024*1024 || wire.destination !== destination) return deny();
    const parsed=JSON.parse(wire.serializedBody);
    if (parsed.thinking?.type !== 'disabled' || parsed.max_tokens !== maximum || parsed.tools !== undefined) return deny();
    return wire;
  };
  const count = (wire:{serializedBody:string;destination:string}) => {
    try {
      return measureRequestCapacity(profile,{...wire,model:pinned.wireModel}).inputTokenUpperBound; }
    catch { return deny(); }
  };
  return Object.freeze({
    contract:Object.freeze({id:`assistant-analysis-v1:${createHash('sha256').update(JSON.stringify({provider:pinned.providerId,model:pinned.wireModel,modelId:pinned.modelId,protocol:pinned.protocol,destination,tokenizer:TOKENIZER_ID,thinking:'disabled'})).digest('hex')}`,provider:pinned.providerId,model:pinned.wireModel,
      tokenizer:TOKENIZER_ID,protocolOverheadMeasured:true as const,maxOutputTokensEnforced:true as const,usageIncludesReasoningAndProtocol:true as const}),
    async measureInput(request: {systemPrompt:string;userMessage:string}) {
      const measured=count(preview(adapterFor(),request,8192));
      if (measurements.size >= 128) measurements.delete(measurements.keys().next().value!);
      measurements.set(fingerprint(request),measured);
      return measured;
    },
    async complete(request: Parameters<AssistantAnalysisPort['complete']>[0]): ReturnType<AssistantAnalysisPort['complete']> {
      if (!request.attemptId || request.attemptId.length > 256 || attempts.has(request.attemptId) || attempts.size >= 4096
        || !Number.isSafeInteger(request.maxOutputTokens) || request.maxOutputTokens < 1 || request.maxOutputTokens > 8192) deny();
      const bound=measurements.get(fingerprint(request)) ?? deny();
      const adapter=adapterFor(), wire=preview(adapter,request,request.maxOutputTokens);
      if (count(wire)>bound) deny();
      attempts.add(request.attemptId);
      if (request.signal?.aborted) return {text:'',usage:'unknown',finish:'cancelled'};
      const owner=new AbortController(), abort=()=>owner.abort();
      request.signal?.addEventListener('abort',abort,{once:true});
      let timedOut=false;
      const timer=setTimeout(()=>{timedOut=true;owner.abort();},timeoutMs);
      let nativeFinish:string|undefined;
      const facts:{usage:'unknown'|{inputTokens:number;outputTokens:number}}={usage:'unknown'};
      let text='', invoked=false;
      adapter.client=adapter.client.withOptions({maxRetries:0});
      const original=adapter.client.chat.completions.create.bind(adapter.client.chat.completions);
      // Only this owned instance changes. Native chunks are buffered before adapter
      // normalization so trailing usage cannot be replaced by a local estimate.
      Object.defineProperty(adapter.client.chat.completions,'create',{value:async (body:unknown, options:Record<string,unknown>)=>{
        if (invoked || JSON.stringify(body)!==wire.serializedBody) {owner.abort();throw new AssistantAnalysisProviderFailure();}
        invoked=true;
        try {
          const stream=await original(body as never,{...options,maxRetries:0} as never) as unknown as AsyncIterable<NativeChunk> & {controller?:AbortController};
          const buffered:NativeChunk[]=[];let bytes=0;
          let finalUsage:typeof facts.usage='unknown';
          try {
            for await (const chunk of stream) {
              owner.signal.throwIfAborted();bytes+=Buffer.byteLength(JSON.stringify(chunk));
              if(bytes>4*1024*1024 || chunk.model !== undefined && chunk.model !== pinned.wireModel && chunk.model !== 'deepseek-flash') throw new AssistantAnalysisProviderFailure();
              for(const choice of chunk.choices ?? []) {
                const delta=choice.delta as typeof choice.delta & {reasoning_content?:string};
                if(choice.index!==0 || delta?.tool_calls || delta?.refusal || delta?.reasoning_content) throw new AssistantAnalysisProviderFailure();
                if(choice.finish_reason) {if(nativeFinish) throw new AssistantAnalysisProviderFailure();nativeFinish=choice.finish_reason;}
              }
              if(chunk.usage && nativeFinish) {
                const u=chunk.usage;
                finalUsage=integer(u.prompt_tokens)&&integer(u.completion_tokens)&&integer(u.total_tokens)&&u.total_tokens===u.prompt_tokens+u.completion_tokens
                  ? {inputTokens:u.prompt_tokens,outputTokens:u.completion_tokens}:'unknown';
              }
              buffered.push(chunk);
            }
            if(!['stop','length'].includes(nativeFinish ?? '')) throw new AssistantAnalysisProviderFailure();
            facts.usage=finalUsage;
            return {controller:new AbortController(),async *[Symbol.asyncIterator](){yield* buffered;}};
          } finally {stream.controller?.abort();}
        } catch(error) {const failure=new AssistantAnalysisProviderFailure(error);owner.abort(failure);throw failure;}
      }});
      try {
        for await (const chunk of streamStatelessSideCallProviderConversation({adapter,messages:messages(request.userMessage),tools:[],systemPrompt:request.systemPrompt,
          invocationId:`assistant_${request.attemptId}`,options:{maxOutputTokens:request.maxOutputTokens,reasoningMode:'disabled',signal:owner.signal}})) {
          if(chunk.type==='text') text+=chunk.delta;
        }
        if(facts.usage!=='unknown' && (facts.usage.inputTokens>bound || facts.usage.outputTokens>request.maxOutputTokens)) throw new AssistantAnalysisProviderContractBreach(facts.usage);
        return {text,usage:facts.usage,finish:nativeFinish==='length'?'truncated':'complete'};
      } catch(error) {
        if(error instanceof AssistantAnalysisProviderContractBreach) throw error;
        if(facts.usage!=='unknown' && (facts.usage.inputTokens>bound || facts.usage.outputTokens>request.maxOutputTokens)) throw new AssistantAnalysisProviderContractBreach(facts.usage);
        if(timedOut || request.signal?.aborted) return {text:'',usage:facts.usage,finish:timedOut?'timeout':'cancelled'};
        if(nativeFinish==='length') return {text:'',usage:facts.usage,finish:'truncated'};
        throw new AssistantAnalysisProviderFailure(error);
      } finally {clearTimeout(timer);request.signal?.removeEventListener('abort',abort);owner.abort();}
    },
  });
}
