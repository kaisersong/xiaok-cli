import {readFileSync,realpathSync} from 'node:fs';
import {basename,dirname,join} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

const models=new Set(['k3','k3-256k','k3.1-pro','k3.1-pro-highspeed']);
const efforts=new Set(['low','high','max']);
const finishes=new Set(['stop','tool_calls','function_call','length','content_filter']);
function official(baseURL){
 try{const url=new URL(baseURL);return url.protocol==='https:'
  && ['api.kimi.com','api.kimi.ai'].includes(url.hostname)
  && url.pathname.replace(/\/+$/,'')==='/coding/v1';}catch{return false;}
}

/** Metadata-only observation. No extra reader, no request/response replacement. */
export function observeKimiCompletions(Completions,record){
 const original=Completions.prototype.create;let request=0;
 function observedCreate(body,...options){
  const pending=original.call(this,body,...options);
  if(body?.stream!==true||!models.has(body.model)||!official(this._client?.baseURL))return pending;
  const facts={request:++request,model:body.model,
   effort:efforts.has(body.reasoning_effort)?body.reasoning_effort:'unspecified_or_other',
   thinking:body.thinking?.type==='enabled'?'enabled':body.thinking?.type==='disabled'?'disabled':'unspecified_or_other',
   officialString:false,officialNull:false,officialOther:false,alternateReasoning:false,
   sawContent:false,sawTools:false,responseModel:'missing',finish:'missing',frames:0};
  // Register before the caller awaits the same APIPromise. Preserve .withResponse
  // and every other original Promise/SDK method instead of returning .then().
  void pending.then(stream=>{
   if(!stream||typeof stream[Symbol.asyncIterator]!=='function')return;
   const iterate=stream[Symbol.asyncIterator];let reported=false;
   const emit=phase=>{if(reported)return;reported=true;try{record({...facts,phase});}catch{}};
   stream[Symbol.asyncIterator]=function(){
    const iterator=iterate.call(this);
    return {
     async next(...args){
      try{const result=await iterator.next(...args);
       if(result.done){emit('eof');return result;}
       try{const chunk=result.value;facts.frames=Math.min(1000000,facts.frames+1);
       if(typeof chunk?.model==='string')facts.responseModel=chunk.model===facts.model?'requested':models.has(chunk.model)?'other_k3':'other';
       const choice=chunk?.choices?.[0],delta=choice?.delta;
       if(delta&&typeof delta==='object'){
        if(Object.hasOwn(delta,'reasoning_content')){
         if(typeof delta.reasoning_content==='string')facts.officialString=true;
         else if(delta.reasoning_content===null)facts.officialNull=true;else facts.officialOther=true;
        }
        if(['reasoning','reasoning_text','reasoning_details','thinking','thought'].some(key=>Object.hasOwn(delta,key)))facts.alternateReasoning=true;
        if(typeof delta.content==='string'&&delta.content.length>0)facts.sawContent=true;
        if(Array.isArray(delta.tool_calls)&&delta.tool_calls.length>0)facts.sawTools=true;
       }
       if(choice?.finish_reason)facts.finish=finishes.has(choice.finish_reason)?choice.finish_reason:'other';
       }catch{/* Unsupported metadata must not change the original chunk. */}
       return result;
      }catch(error){emit('error');throw error;}
     },
     async return(...args){try{return iterator.return?await iterator.return(...args):{done:true,value:args[0]};}finally{emit('return');}},
     async throw(error){try{if(iterator.throw)return await iterator.throw(error);throw error;}finally{emit('error');}},
     [Symbol.asyncIterator](){return this;},
    };
   };
  }).catch(()=>{/* Observation cannot change the original request failure. */});
  return pending;
 }
 Completions.prototype.create=observedCreate;
 return ()=>{if(Completions.prototype.create===observedCreate)Completions.prototype.create=original;};
}

// Explicit --import launch of a real xiaok entry only. Ordinary test imports do
// not install the observer, and no package/config file is written.
try{if(process.argv[1]){
 const entry=realpathSync(process.argv[1]);
 if(basename(entry)==='index.js'&&basename(dirname(entry))==='dist'){
  const root=dirname(dirname(entry)),manifest=join(root,'package.json');
  if(JSON.parse(readFileSync(manifest,'utf8')).name==='xiaokcode'){
   const require=createRequire(manifest),sdkModule=require.resolve('openai/resources/chat/completions/completions.mjs');
   const {Completions}=await import(pathToFileURL(sdkModule).href);
   const {createLogger}=await import(pathToFileURL(join(root,'dist','utils','logger.js')).href);
   const logger=createLogger('diagnostic:kimi-wire');
   observeKimiCompletions(Completions,facts=>logger.warn('kimiWireShape',facts));
   process.stderr.write('[xiaok] Kimi 字段诊断已启用，仅记录固定元数据。\n');
  }
 }
}}catch{
 try{process.stderr.write('[xiaok] Kimi 字段诊断未启用（SDK 不兼容）；普通启动继续。\n');}catch{}
}
