import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import OpenAI from 'openai';
import {Completions} from 'openai/resources/chat/completions/completions.mjs';
import {observeKimiCompletions} from '../../scripts/diagnose-kimi-wire.mjs';

const privateText='PRIVATE_KEY_REASONING_AND_TOOL_CANARY';
const endpoint='https://api.kimi.com/coding/v1';
const frames=[
 {model:'k3',choices:[{delta:{reasoning_content:null,reasoning:privateText,content:privateText,tool_calls:[{index:0,id:'private-id',function:{name:privateText,arguments:privateText}}]},finish_reason:null}]},
 {model:'k3',choices:[{delta:{},finish_reason:'tool_calls'}]},
];
function client(baseURL=endpoint){
 return new OpenAI({apiKey:privateText,baseURL,maxRetries:0,fetch:async()=>new Response(
  frames.map(frame=>'data: '+JSON.stringify(frame)+'\n\n').join('')+'data: [DONE]\n\n',
  {headers:{'content-type':'text/event-stream'}},
 )});
}

test('observes the real SDK without changing APIPromise, Response or private chunks',async()=>{
 const records=[],original=Completions.prototype.create;let originalPromise;
 Completions.prototype.create=function(...args){originalPromise=original.apply(this,args);return originalPromise;};
 const restore=observeKimiCompletions(Completions,value=>records.push(value));
 try{
  const pending=client().chat.completions.create({model:'k3',stream:true,reasoning_effort:'high',messages:[{role:'user',content:privateText}]});
  assert.equal(pending,originalPromise);
  const {data:stream,response}=await pending.withResponse();
  assert.equal(response.status,200);
  const actual=[];for await(const chunk of stream)actual.push(chunk);
  assert.deepEqual(actual,frames);
  assert.equal(records.length,1);
  assert.equal(records[0].officialNull,true);
  assert.equal(records[0].officialString,false);
  assert.equal(records[0].alternateReasoning,true);
  assert.equal(records[0].sawTools,true);
  assert.equal(records[0].sawContent,true);
  assert.equal(records[0].finish,'tool_calls');
  assert.equal(records[0].responseModel,'requested');
  assert.equal(records[0].effort,'high');
  assert(!JSON.stringify(records).includes(privateText));
  assert(!JSON.stringify(records).includes('private-id'));
 }finally{restore();Completions.prototype.create=original;}
});

test('does not inspect non-official endpoints or non-K3 models',async()=>{
 const records=[],restore=observeKimiCompletions(Completions,value=>records.push(value));
 try{for(const [baseURL,model]of [['https://proxy.invalid/v1','k3'],[endpoint,'gpt-example'],['http://api.kimi.com/coding/v1','k3']]){
  const stream=await client(baseURL).chat.completions.create({model,stream:true,messages:[]});
  for await(const _ of stream){}
 }assert.deepEqual(records,[]);}finally{restore();}
});

test('keeps SDK controller cancellation and does not pull ahead',async()=>{
 let reads=0,cancels=0;const records=[];
 const sdk=new OpenAI({apiKey:privateText,baseURL:endpoint,maxRetries:0,fetch:async()=>new Response(new ReadableStream({
  start(controller){controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify(frames[0])+'\n\n'));},
  pull(){reads++;},cancel(){cancels++;},
 }),{headers:{'content-type':'text/event-stream'}})});
 const restore=observeKimiCompletions(Completions,value=>records.push(value));
 try{
  const stream=await sdk.chat.completions.create({model:'k3',stream:true,messages:[]});
  assert.equal(records.length,0);
  const iterator=stream[Symbol.asyncIterator]();await iterator.next();
  await new Promise(resolve=>setImmediate(resolve));
  const before=reads;await new Promise(resolve=>setImmediate(resolve));assert.equal(reads,before);
  await iterator.return();assert.equal(stream.controller.signal.aborted,true);
  assert.equal(cancels,1);assert.equal(records.length,1);assert.equal(records[0].phase,'return');
 }finally{restore();}
});

test('preserves iterator this and original next/throw exceptions',async()=>{
 const failure=Error(privateText),records=[];
 const iterator={async next(){assert.equal(this,iterator);throw failure;},async throw(error){assert.equal(this,iterator);throw error;}};
 const stream={[Symbol.asyncIterator](){assert.equal(this,stream);return iterator;}};
 class FakeCompletions{_client={baseURL:endpoint};create(){return Promise.resolve(stream);}}
 const restore=observeKimiCompletions(FakeCompletions,value=>records.push(value));
 try{
  const actual=await new FakeCompletions().create({model:'k3',stream:true});assert.equal(actual,stream);
  const observed=actual[Symbol.asyncIterator]();
  await assert.rejects(observed.next(),error=>error===failure);
  await assert.rejects(observed.throw(failure),error=>error===failure);
  assert.equal(records.length,1);assert.equal(records[0].phase,'error');
  assert(!JSON.stringify(records).includes(privateText));
 }finally{restore();}
});

test('diagnostic callback failure cannot change normal SDK output',async()=>{
 const restore=observeKimiCompletions(Completions,()=>{throw Error(privateText);});
 try{const stream=await client().chat.completions.create({model:'k3',stream:true,messages:[]});
 const actual=[];for await(const chunk of stream)actual.push(chunk);assert.deepEqual(actual,frames);
 }finally{restore();}
});

test('unsupported metadata cannot replace the original successful chunk',async()=>{
 const opaque={get model(){throw Error(privateText);}};let read=false;
 const stream={[Symbol.asyncIterator](){return {async next(){if(read)return {done:true};read=true;return {done:false,value:opaque};}};}};
 class FakeCompletions{_client={baseURL:endpoint};create(){return Promise.resolve(stream);}}
 const restore=observeKimiCompletions(FakeCompletions,()=>{});
 try{const actual=await new FakeCompletions().create({model:'k3',stream:true});const iterator=actual[Symbol.asyncIterator]();
 assert.equal((await iterator.next()).value,opaque);assert.equal((await iterator.next()).done,true);
 }finally{restore();}
});

test('unsupported SDK preload reports a fixed diagnostic and still starts the original CLI',()=>{
 const root=mkdtempSync(join(tmpdir(),'kimi-diagnostic-startup-'));
 try{
  mkdirSync(join(root,'dist'));writeFileSync(join(root,'package.json'),JSON.stringify({name:'xiaokcode',type:'module'}));
  const entry=join(root,'dist','index.js');writeFileSync(entry,'console.log("ORIGINAL_CLI_STARTED");');
  const result=spawnSync(process.execPath,['--import',new URL('../../scripts/diagnose-kimi-wire.mjs',import.meta.url).href,entry],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/ORIGINAL_CLI_STARTED/);
  assert.match(result.stderr,/SDK 不兼容/);assert(!result.stderr.includes('Error:'));
 }finally{rmSync(root,{recursive:true,force:true,maxRetries:3});}
});
