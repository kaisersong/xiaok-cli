import test from 'node:test';
import assert from 'node:assert/strict';
import {runOriginalBrokerNode} from './helpers/broker-authority-node-fixture.mjs';
const options={skip:process.platform!=='darwin'};
test('real Node Broker consumes only its original Native namespace and closes original SQLite',options,async()=>{
 const rows=await runOriginalBrokerNode();const node=rows.find(x=>x.kind==='broker-fixed-native-node');assert.ok(node);assert.equal(node.rows,1);assert.equal(node.udf,true);assert.equal(node.closed,true);assert.equal(node.productionQualified,false);const parent=rows.find(x=>x.kind==='broker-fixed-native-core-component');assert.ok(parent);assert.equal(parent.failure,0);assert.equal(parent.rootFilesClosed,true);assert.equal(parent.unknown,false);
});
test('Native reference publication failure keeps negative close reachable before a JS ref exists',options,async()=>{
 const rows=await runOriginalBrokerNode({referenceFault:true});const node=rows.find(x=>x.kind==='broker-fixed-native-node-ref-fault');assert.ok(node);assert.equal(node.negativeFinishBeforeReference,true);assert.equal(node.failedNotRevived,true);const parent=rows.find(x=>x.kind==='broker-fixed-native-core-component');assert.ok(parent);assert.equal(parent.failure,0);assert.equal(parent.rootFilesClosed,true);assert.equal(parent.unknown,false);
});
test('fixed Broker module without inherited Native birth remains ordinary null and rejects consume',options,async()=>{
 assert.deepEqual(await runOriginalBrokerNode({withoutBirth:true}),[{kind:'broker-no-seed-rejected',nativeConsumed:false,productionQualified:false}]);
});
