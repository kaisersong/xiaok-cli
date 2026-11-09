import assert from 'node:assert/strict';
import {populateBrokerRuntimeFixture} from '../fixtures/broker-runtime-fixture.js';
import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {shipBrokerRuntime}=require('../../scripts/pack-broker-runtime.cjs');
it('packager verifies provenance and binary before copying only one target and fails closed on mutation',()=>{
 const root=mkdtempSync(join(tmpdir(),'broker-runtime-pack-'));
 try{
  const target='darwin-arm64',cache=join(root,'cache'),source=join(cache,target),resources=join(root,'resources');mkdirSync(source,{recursive:true});mkdirSync(resources);
  const {command}=populateBrokerRuntimeFixture(source,target);const binary=readFileSync(command);
  const result=shipBrokerRuntime({cacheRoot:cache,resources,target});expect(result.target).toBe(target);
  assert.deepStrictEqual(readFileSync(join(resources,'services','intent-broker','runtime',target,'node')),binary);
  expect(()=>shipBrokerRuntime({cacheRoot:cache,resources,target})).toThrow();
  writeFileSync(join(source,'node'),'tampered');expect(()=>shipBrokerRuntime({cacheRoot:cache,resources,target})).toThrow(/broker_runtime/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
