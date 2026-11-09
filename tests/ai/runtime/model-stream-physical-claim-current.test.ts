import {expect,it} from 'vitest';
import {ModelStreamPhysicalOwner} from '../../../src/ai/runtime/model-stream-physical-owner.js';

it('an original claim remains current after stop and retires only at its own finish',async()=>{
 const owner=new ModelStreamPhysicalOwner(),reason={original:'physical stop'},run=owner.admit();
 try{
  expect(Object.isFrozen(run)).toBe(true);
  expect(owner.hasPending()).toBe(true);
  expect(()=>run.assertCurrent()).not.toThrow();
  owner.stop(reason);
  expect(owner.signal.reason).toBe(reason);
  const originalClosing=owner.waitForStopped();
  expect(owner.waitForStopped()).toBe(originalClosing);
  let settled=false;void originalClosing.then(()=>{settled=true;});
  expect(()=>run.assertCurrent()).not.toThrow();
  expect(()=>run.assertCurrent()).not.toThrow();
  await Promise.resolve();
  expect(settled).toBe(false);
  expect(owner.hasPending()).toBe(true);
  expect(owner.hasFailure()).toBe(false);
  run.finish();
  expect(()=>run.assertCurrent()).toThrow('agent_model_claim_retired');
  expect(owner.hasPending()).toBe(false);
  await originalClosing;
  expect(settled).toBe(true);
  expect(owner.hasFailure()).toBe(false);
 }finally{
  run.finish();owner.stop(reason);await owner.waitForStopped();
 }
});
