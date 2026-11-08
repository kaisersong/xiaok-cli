const assert=require('node:assert/strict');
const native=require('./runtime/protected_sqlite.node');
assert.equal(native.readOriginalBrokerSource(),undefined);
assert.throws(()=>native.consumeOriginalBrokerSource(),/original namespace reference unconfirmed/);
assert.throws(()=>native.readOriginalBrokerSource(),/original fixed birth/);
// The entered original client exists even though its JS ref never published.
// This is negative cleanup, never a new consumer or a failed-state grant.
assert.equal(native.finishOriginalBrokerSource(),undefined);
assert.throws(()=>native.consumeOriginalBrokerSource(),/original fixed birth/);
console.log(JSON.stringify({kind:'broker-fixed-native-node-ref-fault',pid:process.pid,node:process.versions.node,negativeFinishBeforeReference:true,failedNotRevived:true,productionQualified:false}));
