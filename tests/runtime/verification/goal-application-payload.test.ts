import '../../support/installed-controller-fixture.js';
import {it,expect} from 'vitest';
import {verifiedOperationFixture} from '../../support/verified-operation-fixture.js';
it('freezes the native Goal application in actual verified payload bytes and rejects old payload after replacement',async()=>{
 const f=await verifiedOperationFixture('goal-application');try{
  const staged=await f.operations.stageVerifiedPayload(f.owner),host=f.composition.privateHost;
  const body=JSON.parse(host.payloads.read(staged.payloadId,f.owner).toString('utf8'));
  const captured=host.payloads.capture(staged.payloadId,f.owner);captured.assertCurrent();
  const original=host.authorityHost.inspectApplication(f.owner).current!;
    if(original.binding.kind!=='goal')throw Error('expected actual Goal application');
  expect(body.application).toEqual(original);
  expect(body.evaluations[0].application).toEqual(original);
  host.authorityHost.beginApplicationTransition({owner:f.owner,transitionId:'goal-second',previousBindingHash:original.bindingHash,binding:{...original.binding,epoch:2,objective:'replacement'},registrationHash:'a'.repeat(64)});
  expect(()=>host.payloads.read(staged.payloadId,f.owner)).toThrow();expect(()=>captured.assertCurrent()).toThrow();
  host.authorityHost.finishApplicationTransition(f.owner,'goal-second',()=>{});
  expect(()=>host.payloads.read(staged.payloadId,f.owner)).toThrow();expect(()=>captured.assertCurrent()).toThrow();
 }finally{await f.close();}
});
