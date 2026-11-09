import test from 'node:test';
import assert from 'node:assert/strict';
import {runOriginalBrokerProtectedSource} from './helpers/broker-protected-source-fixture.mjs';
test('fixed Broker Source retains ordinary declaration callback metadata through actual Native terminal', {skip:process.platform!=='darwin',timeout:60000},async()=>{
 const result=await runOriginalBrokerProtectedSource('ordinary-functions');assert.equal(result.signal,null,result.stderr);assert.equal(result.code,0,result.stdout+'\n'+result.stderr);
 const facts=result.stdout.split('\n').filter(line=>line.startsWith('{')).map(line=>JSON.parse(line)).find(row=>row.kind==='broker-fixed-protected-source');
 assert.ok(facts);assert.equal(facts.actualNativeSqlite,true);assert.equal(facts.actualNativeTerminal,true);assert.equal(facts.sourceKnown,true);assert.equal(facts.heldUntilReleased,true);assert.equal(facts.getterCalls,0);assert.equal(facts.traps,0);assert.equal(facts.genuineMain,false);assert.equal(facts.productionQualified,false);
});
