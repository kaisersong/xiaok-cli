import test from 'node:test';
import assert from 'node:assert/strict';
import {runOriginalBrokerProtectedSource} from './helpers/broker-protected-source-fixture.mjs';
for(const mode of ['held','unknown'])test(`fixed Broker Source joins actual Native child and ${mode} callbacks`,{skip:process.platform!=='darwin',timeout:60000},async()=>{
 const result=await runOriginalBrokerProtectedSource(mode);assert.equal(result.signal,null,result.stderr);assert.equal(result.code,0,result.stdout+'\n'+result.stderr);
 const facts=result.stdout.split('\n').filter(v=>v.startsWith('{')).map(v=>JSON.parse(v)).find(v=>v.kind==='broker-fixed-protected-source');
 assert.ok(facts);assert.equal(facts.actualNativeSqlite,true);assert.equal(facts.actualNativeTerminal,true);assert.equal(facts.traps,0);assert.equal(facts.getterCalls,0);assert.equal(facts.sourceKnown,mode==='held');assert.equal(facts.genuineMain,false);assert.equal(facts.productionQualified,false);
 if(mode==='unknown')assert.match(result.stdout,/"event":"reaped"[^\n]*"unknown":true/);
});
