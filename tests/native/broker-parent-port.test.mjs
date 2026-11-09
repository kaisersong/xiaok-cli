import test from 'node:test';
import assert from 'node:assert/strict';
import {runOriginalBrokerParentPort} from './helpers/broker-parent-port-fixture.mjs';

for(const mode of ['cancel','launch','allocation-fault'])test(`original C++ Broker parent port: ${mode}`,{skip:process.platform!=='darwin',timeout:60000},async()=>{
 const result=await runOriginalBrokerParentPort(mode);
 assert.equal(result.signal,null);assert.equal(result.code,0,result.stdout+'\n'+result.stderr);
 const records=result.stdout.split('\n').filter(v=>v.startsWith('{')).map(v=>JSON.parse(v)),facts=records.find(v=>v.kind==='original-broker-parent-port');
 assert.ok(facts);assert.equal(facts.mode,mode);assert.equal(facts.proxyTraps,0);assert.equal(facts.productionQualified,false);assert.equal(facts.genuineMain,false);
 if(mode==='allocation-fault'){assert.equal(facts.rootCloseHeld,true);assert.equal(facts.secondPrepareDenied,true);assert.equal(records.find(v=>v.event==='reaped').unknown,true);return;}
 assert.equal(facts.rootClosed,true);assert.equal(facts.terminal,true);
 if(mode==='launch'){assert.equal(facts.actualChildKnown,true);assert.equal(facts.child.rows,1);assert.equal(facts.child.closed,true);}
});
