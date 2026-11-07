'use strict';
// SQL protocol fixture only. Native Main/session membership remains the gate;
// no permit/session escapes this function, and settle is not an SDK fate claim.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const intentFields = ['schemaVersion','kind','recordId','executionKey','executionClass','metadataDigest','issuerEpoch','acquireGeneration','claimToken','launchNonce','invocationId','specHash','launchStage'];
function intentMetadata(value) {
  const out = {};
  for (const key of intentFields) {
    assert.ok(Object.hasOwn(value, key), 'original intent field ' + key);
    assert.ok(typeof value[key] === 'string' || Number.isSafeInteger(value[key]));
    out[key] = value[key];
  }
  assert.match(out.launchNonce, /^[a-f0-9]{64}$/);
  assert.notEqual(out.launchNonce, out.claimToken);
  return out;
}
function runProtectedNmpSqlFixture(api, session, phase, root) {
  // Diagnostic misuse guard, not a replacement for the actual Native gates.
  assert.ok(process.type === 'browser' && process.versions.electron, 'ACTUAL_MAIN_REQUIRED');
  assert.ok(phase === 'fresh' || phase === 'restored', 'EXACT_BOOTSTRAP_PHASE_REQUIRED');
  assert.equal(typeof api.armProcessIntentWriteFailure, 'function', 'compile original finite facts header');
  const file = path.join(root, 'protected-nmp-sql-golden.json');
  const roomKey = api.takeOriginalRoomDiscussionSourceKey(session);
  const mainKey = api.takeOriginalMainTurnSourceKey(session);
  const mainContext = api.importOriginalPhysicalContext(mainKey, null, 'profile','workspace','principal','host','protected-nmp-main');
  const subject = index => api.importOriginalRoomTurnSubject(roomKey, 'profile','workspace','principal','host','room','message-'+index,'agent','turn-'+index,'payload','authorization');
  const facts = {kind:'protected_nmp_sql_fixture_v1',phase,sqlProtocolOnly:true,sdkInvocations:0,physicalFateEvidence:false,productionQualified:false};
  if (phase === 'fresh') {
    assert.equal(fs.existsSync(file), false, 'fresh golden cannot overwrite history');
    assert.equal(api.readPolicy(session).claimSeq, 0);
    const records = [], reservations = [];
    for (let i=0;i<6;i++) {
      const queued = api.enqueue(session, subject(i));
      assert.equal(queued.disposition, 'new_queued');
      records.push({executionKey:queued.record.executionKey});
      if (i<5) {
        const claim = api.claimNext(session); assert.ok(claim?.reservation);
        assert.equal(claim.record.executionKey, queued.record.executionKey);
        assert.equal(api.consumeLaunch(session, claim.reservation).newlyConsumed, true);
        assert.equal(api.consumeLaunch(session, claim.reservation).newlyConsumed, false);
        reservations.push(claim.reservation);
      }
    }
    assert.equal(api.claimNext(session), null, 'warm N5 is exhausted');
    assert.equal(api.readPolicy(session).claimSeq, 5);
    // Release one original SQL reservation before restart: cold now has a
    // free slot with which to prove that an old queued row is not eligible.
    assert.equal(api.finishOriginalRoot(session, reservations[4]).newlyFinished, true);
    assert.equal(api.finishOriginalRoot(session, reservations[4]).newlyFinished, false);
    const workflowKey = api.takeOriginalWorkflowRootSourceKey(session);
    const workflow = api.importOriginalPhysicalContext(workflowKey, reservations[0], 'profile','workspace','principal','host','protected-nmp-workflow');
    const vmQueued = api.enqueueOriginalWorkflowVmProcess(workflow, 'protected-vm', 'a'.repeat(64));
    const vm = api.claimOriginalProcess(session); assert.ok(vm?.permit);
    assert.equal(vm.record.executionKey, vmQueued.record.executionKey);
    assert.equal(vm.fixtureClaimWriteCount, 6);
    assert.ok(vm.fixtureClaimWriteCount <= 8);
    const vmIntent = intentMetadata(api.readOriginalProcessIntent(session, vm.permit).intent);
    assert.deepEqual(intentMetadata(api.readOriginalProcessIntent(session, vm.permit).intent), vmIntent);
    const childQueued = api.enqueueOriginalProcess(workflow, 'protected-child', 'b'.repeat(64));
    const child = api.claimOriginalProcess(session); assert.ok(child?.permit);
    assert.equal(child.record.executionKey, childQueued.record.executionKey);
    assert.equal(child.fixtureClaimWriteCount, 5);
    assert.ok(child.fixtureClaimWriteCount <= 8);
    const childIntent = intentMetadata(api.readOriginalProcessIntent(session, child.permit).intent);
    assert.equal(api.settleOriginalProcess(session, child.permit).newlySettled, true);
    assert.equal(api.settleOriginalProcess(session, child.permit).newlySettled, false);
    const released = api.readOriginalProcessIntent(session, child.permit);
    assert.equal(released.state, 'released');
    assert.deepEqual(intentMetadata(released.intent), childIntent);
    const directQueued = api.enqueueOriginalProcess(mainContext, 'protected-warm-blocked-p', 'c'.repeat(64));
    assert.equal(api.claimOriginalProcess(session), null, 'VM and capacity slot retain P2');
    assert.equal(api.readOriginalProcessHistory(session, directQueued.record.executionKey), null, 'queued P has no intent');
    api.enqueueOriginalModel(mainContext, 'protected-released-m', 'd'.repeat(64));
    const releasedModel = api.claimOriginalModel(session); assert.ok(releasedModel?.permit);
    assert.equal(api.settleOriginalModel(session, releasedModel.permit).newlySettled, true);
    assert.equal(api.settleOriginalModel(session, releasedModel.permit).newlySettled, false);
    for (let i=0;i<2;i++) {
      api.enqueueOriginalModel(mainContext, 'protected-held-m-'+i, 'e'.repeat(64));
      assert.ok(api.claimOriginalModel(session)?.permit);
    }
    const oldQueuedModel = api.enqueueOriginalModel(mainContext, 'protected-queued-m', 'f'.repeat(64));
    assert.equal(api.readPolicy(session).claimSeq, 5, 'M/P do not increment N claim sequence');
    const golden = {schemaVersion:1,kind:'protected_nmp_sql_golden_v1',records,vm:{key:vm.record.executionKey,intent:vmIntent},child:{key:child.record.executionKey,intent:childIntent},queuedModelKey:oldQueuedModel.record.executionKey};
    const pending = file+'.pending';
    fs.writeFileSync(pending, JSON.stringify(golden,null,2)+'\n', {flag:'wx',mode:0o600});
    assert.equal(fs.existsSync(file), false);
    fs.renameSync(pending,file);
    return {...facts,nWarmHighWater:5,nHeldAtExit:4,nQueuedAtExit:1,gangP2Held:true,modelHeldAtExit:2,processIntentReplayStable:true,processSqlSettledOnce:true,modelSqlSettledOnce:true,claimWriteCounts:[vm.fixtureClaimWriteCount,child.fixtureClaimWriteCount]};
  }
  const golden = JSON.parse(fs.readFileSync(file,'utf8'));
  assert.equal(golden.schemaVersion, 1); assert.equal(golden.kind, 'protected_nmp_sql_golden_v1');
  assert.equal(golden.records.length, 6);
  for (let i=0;i<6;i++) assert.equal(api.readRecord(session,golden.records[i].executionKey).state, i===4?'released':i===5?'queued':'reserved');
  assert.equal(api.claimNext(session), null, 'old N queued has no eligibility despite one free slot');
  assert.equal(api.enqueue(session,subject(5)).disposition, 'existing_queued');
  assert.equal(api.claimNext(session), null, 'same old N input does not restore eligibility');
  const newN = api.enqueue(session,subject(100));
  const claim = api.claimNext(session); assert.ok(claim?.reservation);
  assert.equal(claim.record.executionKey, newN.record.executionKey);
  assert.notEqual(claim.record.executionKey, golden.records[5].executionKey);
  assert.equal(api.consumeLaunch(session,claim.reservation).newlyConsumed, true);
  api.enqueue(session,subject(101)); assert.equal(api.claimNext(session), null, 'four old held plus one new fill N5');
  assert.equal(api.readPolicy(session).claimSeq, 6);
  for (const name of ['vm','child']) {
    const history = api.readOriginalProcessHistory(session,golden[name].key);
    assert.deepEqual(intentMetadata(history.intent),golden[name].intent);
    assert.equal(Object.hasOwn(history,'permit'),false);
    assert.equal(history.state,name==='vm'?'reserved':'released');
  }
  assert.equal(api.claimOriginalProcess(session),null, 'old P rows are not locally eligible');
  const newP = api.enqueueOriginalProcess(mainContext,'protected-cold-blocked-p','1'.repeat(64));
  assert.equal(api.claimOriginalProcess(session),null,'old VM plus slot still exhaust P2');
  assert.equal(api.readOriginalProcessHistory(session,newP.record.executionKey),null);
  assert.equal(api.claimOriginalModel(session),null,'old queued M has no eligibility');
  const replayM=api.enqueueOriginalModel(mainContext,'protected-queued-m','f'.repeat(64));
  assert.equal(replayM.record.executionKey,golden.queuedModelKey); assert.equal(replayM.disposition,'existing');
  assert.equal(api.claimOriginalModel(session),null);
  for(let i=0;i<2;i++) {
    const queued=api.enqueueOriginalModel(mainContext,'protected-cold-m-'+i,'2'.repeat(64));
    const model=api.claimOriginalModel(session);assert.ok(model?.permit);assert.equal(model.record.executionKey,queued.record.executionKey);
  }
  api.enqueueOriginalModel(mainContext,'protected-cold-m-full','3'.repeat(64));
  assert.equal(api.claimOriginalModel(session),null,'two historical plus two new fill M4');
  return {...facts,nOldHeld:4,nColdCapacity:5,nOldQueuedNotReissued:true,oldProcessIntentUnchanged:true,coldHistoryHasNoPermit:true,gangP2StillHeld:true,modelOldHeld:2,modelColdCapacity:4,modelOldQueuedNotReissued:true};
}
module.exports = {runProtectedNmpSqlFixture};
