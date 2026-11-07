'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
module.exports = function createProbe({domain,bundle,mode,caseName}) {
  const probe = {go:[], closedReached:0, nativeClosedSeen:0, releases:[], traps:0, faultHits:0, cancelCalls:0, closedCalls:0,
    holdClosures:false, held:null, release:null, failure:undefined, controller:null, withdraw:null, withdrawal:null};
  if (!['glob','grep','queue'].includes(mode)) return probe;
  const originalDlopen = process.dlopen;
  process.dlopen = function(module,filename,...rest) {
    const returned = Reflect.apply(originalDlopen,process,[module,filename,...rest]);
    if (fs.realpathSync(filename) !== fs.realpathSync(path.join(path.dirname(bundle),'root_resource_authority_main.node')))
      return returned;
    const original = module.exports, descriptors = Object.getOwnPropertyDescriptors(original);
    const methods = Object.fromEntries(['prepareOriginalReadonlyLeaf','waitOriginalReadonlyLeafReady','bindOriginalReadonlyLeaf',
      'goOriginalReadonlyLeaf','cancelOriginalReadonlyLeaf','waitOriginalReadonlyLeafClosed'].map(name => [name,descriptors[name].value]));
    function replace(name,fn) {descriptors[name] = {...descriptors[name],value:fn};}
    replace('goOriginalReadonlyLeaf',function(...args) {
      const {DatabaseSync} = require('node:sqlite');
      const db = new DatabaseSync(path.join(domain,'root-resource-v1.sqlite'),{readOnly:true});
      try {probe.go.push({reserved:db.prepare("SELECT count(*) n FROM root_physical_resources WHERE resource_kind=2 AND state='reserved'").get().n,
        intents:db.prepare("SELECT count(*) n FROM root_physical_receipts WHERE kind='process_intent_v1'").get().n,
        bindings:db.prepare("SELECT count(*) n FROM root_physical_receipts WHERE kind='process_binding_v1'").get().n});}
      finally {db.close();}
      return Reflect.apply(methods.goOriginalReadonlyLeaf,original,args);
    });
    replace('prepareOriginalReadonlyLeaf',function(...args) {
      const raw = Reflect.apply(methods.prepareOriginalReadonlyLeaf,original,args);
      if (caseName === 'sdk-error' || caseName === 'sdk-undefined') {
        return Reflect.apply(methods.waitOriginalReadonlyLeafReady,original,args.slice(0,2)).then(() => {
          probe.faultHits++;
          if (caseName === 'sdk-undefined') return probe.held.then(() => {throw undefined;});
          throw probe.failure;
        });
      }
      if (caseName === 'source-revoke-before-ready') probe.withdrawal=probe.withdraw();
      if (caseName === 'sdk-function-tail') Object.defineProperty(descriptors.prepareOriginalReadonlyLeaf.value,Symbol('owned-sdk-function-tail'),{value:probe.held});
      if (caseName === 'sdk-raw-tail') {
        const promise = Promise.resolve(raw);
        Object.defineProperty(promise,Symbol('original-native-raw-tail'),{value:probe.held});
        return promise;
      }
      return raw;
    });
    replace('waitOriginalReadonlyLeafReady',function(...args) {
      const raw = Reflect.apply(methods.waitOriginalReadonlyLeafReady,original,args);
      if (caseName === 'abort-after-ready') return raw.then(value => {probe.controller.abort(probe.failure);return value;});
      if (caseName === 'source-revoke') return raw.then(value => {probe.withdrawal=probe.withdraw();return value;});
      return raw;
    });
    replace('bindOriginalReadonlyLeaf',function(...args) {
      const raw=Reflect.apply(methods.bindOriginalReadonlyLeaf,original,args);
      if(caseName==='source-revoke-after-bind')probe.withdrawal=probe.withdraw();
      return raw;
    });
    replace('cancelOriginalReadonlyLeaf',function(...args) {
      probe.cancelCalls++;
      return Reflect.apply(methods.cancelOriginalReadonlyLeaf,original,args);
    });
    replace('waitOriginalReadonlyLeafClosed',function(...args) {
      probe.closedCalls++;
      const raw = Reflect.apply(methods.waitOriginalReadonlyLeafClosed,original,args);
      const observer=raw.then(()=>{probe.nativeClosedSeen++;},()=>{probe.nativeClosedSeen++;});
      Object.defineProperty(raw,Symbol('owned-native-close-observer'),{value:observer});
      if (probe.holdClosures) return raw.then(value => {
        probe.closedReached++;
        return new Promise(yes => {probe.releases.push(() => yes(value));});
      });
      if (caseName === 'sdk-outcome-tail') return raw.then(value => {
        const error = Error('owned SDK outcome');
        Object.defineProperty(error,Symbol('original-native-outcome-tail'),{value:probe.held});
        Object.defineProperty(value,Symbol('original-native-outcome-error'),{value:error});
        return value;
      });
      if (caseName === 'unknown-raw') {probe.rawClosed=raw;return new Proxy({actualNativeClosed:raw}, {
        get(){probe.traps++;throw Error('unexpected Proxy getter');},
        ownKeys(){probe.traps++;throw Error('unexpected Proxy ownKeys');},
        getOwnPropertyDescriptor(){probe.traps++;throw Error('unexpected Proxy descriptor');},
      });}
      return raw;
    });
    Object.defineProperty(module,'exports',{value:Object.create(null,descriptors)});
    process.dlopen = originalDlopen;
    return returned;
  };
  probe.run = async function(runner,input) {
    if (caseName === 'success') return runner.search(input);
    probe.held = new Promise(yes => {probe.release=yes;});
    probe.failure = Error('ORIGINAL_NATIVE_LEAF_WRAPPER_FAILURE');
    Object.defineProperty(probe.failure,Symbol('original-native-error-tail'),{value:probe.held});
    probe.controller = new AbortController();
    let done = false;
    const pending = runner.search(input,caseName === 'abort-after-ready' ? probe.controller.signal : undefined)
      .then(value => ({ok:true,value}),error => ({ok:false,error}));
    pending.then(() => {done=true;});
    try {
      if (caseName === 'sdk-error' || caseName === 'sdk-undefined') {
        while (!probe.faultHits && !done) await new Promise(yes => setImmediate(yes));
        assert.equal(probe.faultHits,1);
      } else if (caseName !== 'unknown-raw') {
        while (!probe.nativeClosedSeen && !done) await new Promise(yes => setImmediate(yes));
      }
      if (caseName !== 'unknown-raw' && !caseName.startsWith('source-revoke')) {
        await new Promise(yes => setImmediate(yes));
        assert.equal(done,false,'original raw/outcome/Error tail must join before completion');
      }
      probe.release();
      const outcome = await pending;
      if (caseName === 'sdk-raw-tail' || caseName === 'sdk-outcome-tail' || caseName === 'sdk-function-tail') assert.equal(outcome.ok,true);
      else {
        assert.equal(outcome.ok,false);
        if (caseName === 'sdk-undefined') assert.equal(outcome.error,undefined);
        if (caseName === 'sdk-error' || caseName === 'abort-after-ready') assert.equal(outcome.error,probe.failure);
        assert.ok(probe.cancelCalls > 0,'every failed accepted leaf must enter owned negative cleanup');
        assert.ok(probe.closedCalls > 0);
      }
      if (probe.rawClosed) await probe.rawClosed;
      if (probe.withdrawal) await probe.withdrawal;
      assert.equal(probe.traps,0);
      return outcome.value;
    } finally {probe.release();if(probe.rawClosed)await probe.rawClosed;}
  };
  return probe;
};
