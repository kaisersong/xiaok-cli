import '../../support/installed-controller-fixture.js';
import {it,expect} from 'vitest';
import {verifiedOperationFixture} from '../../support/verified-operation-fixture.js';
import {canonicalVerificationJson} from '../../../src/runtime/verification/protocol.js';

// Ordinary original leaf-fixture controls; not genuine installed SDK/OS qualification.
it('keeps payload capture bytes detached from every caller copy',async()=>{
 const f=await verifiedOperationFixture();
 try{
  const staged=f.operations.stageVerifiedPayload(f.owner);
  const snapshot=f.composition.privateHost.payloads.capture(staged.payloadId,f.owner);
  const original=snapshot.readBytes(),caller=snapshot.readBytes();
  expect(caller).not.toBe(original);expect(caller.length).toBeGreaterThan(0);
  caller[0]=caller[0]!^1;
  expect(snapshot.readBytes()).toEqual(original);expect(caller).not.toEqual(original);
 }finally{await f.close();}
},120000);

it('rechecks the real payload row after a capture was issued',async()=>{
 const f=await verifiedOperationFixture();
 try{
  const staged=f.operations.stageVerifiedPayload(f.owner);
  const snapshot=f.composition.privateHost.payloads.capture(staged.payloadId,f.owner);
  snapshot.assertCurrent();
  f.database.prepare('UPDATE verified_publication_payloads SET payload_hash=? WHERE payload_id=?').run('0'.repeat(64),staged.payloadId);
  expect(()=>snapshot.assertCurrent()).toThrow('publication_payload_changed');
 }finally{await f.close();}
},120000);

it('rechecks the real pending Loop application after capture',async()=>{
 const f=await verifiedOperationFixture('loop-application');
 try{
  const staged=f.operations.stageVerifiedPayload(f.owner);
  const snapshot=f.composition.privateHost.payloads.capture(staged.payloadId,f.owner);
  snapshot.assertCurrent();
  const changed=f.database.prepare('UPDATE verification_application_pointers SET pending_id=? WHERE owner_key=?').run('pending-snapshot-control',canonicalVerificationJson(f.owner));
  expect(changed.changes).toBe(1);
  expect(()=>snapshot.assertCurrent()).toThrow('publication_application_pending');
 }finally{await f.close();}
},120000);

it('does not expose a capture-owned byte buffer to a later global copy interceptor',async()=>{
 const f=await verifiedOperationFixture();
 const descriptor=Object.getOwnPropertyDescriptor(Buffer,'from');
 if(!descriptor||typeof descriptor.value!=='function'){await f.close();throw Error('snapshot_control_buffer_descriptor');}
 try{
  const staged=f.operations.stageVerifiedPayload(f.owner);
  const snapshot=f.composition.privateHost.payloads.capture(staged.payloadId,f.owner);
  const expected=snapshot.readBytes(),seen:Buffer[]=[];
  try{
   Object.defineProperty(Buffer,'from',{...descriptor,value:(...args:unknown[])=>{
    if(Buffer.isBuffer(args[0]))seen.push(args[0]);
    return Reflect.apply(descriptor.value,Buffer,args);
   }});
   expect(snapshot.readBytes()).toEqual(expected);
  }finally{Object.defineProperty(Buffer,'from',descriptor);}
  let matching=0;
  for(const value of seen)if(value.length===expected.length&&value.equals(expected)){matching++;value.fill(0);}
  // The raw observation is not a zero-getter/whole-await or native identity claim.
  console.info('PAYLOAD_COPY_INTERCEPTOR '+JSON.stringify({observedBufferArguments:seen.length,matchingPayloadArguments:matching}));
  expect(snapshot.readBytes()).toEqual(expected);
 }finally{Object.defineProperty(Buffer,'from',descriptor);await f.close();}
},120000);
