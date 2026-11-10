'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const [bundle, domain, result, userData, repo, mode] = process.argv.slice(2);
let releaseRevalidation, enteredRevalidation;
const revalidationReady = new Promise((yes) => {
    enteredRevalidation = yes;
  }),
  revalidationHeld = new Promise((yes) => {
    releaseRevalidation = yes;
  });
if (mode === 'queued_cancel_reentry') {
  const fsp = require('node:fs/promises'),
    original = fsp.readFile;
  let reads = 0;
  fsp.readFile = function (file, ...args) {
    const raw = Reflect.apply(original, this, [file, ...args]);
    if (
      typeof file === 'string' &&
      file === path.join(domain, 'handoff-5.json') &&
      ++reads === 3
    ) {
      enteredRevalidation();
      const held = raw.then((value) => revalidationHeld.then(() => value));
      Object.defineProperty(held, 'originalRaw', { value: raw });
      return held;
    }
    return raw;
  };
  require('node:module').syncBuiltinESMExports();
}
let hostInvoked = 0,
  seenCarrier = false,
  originalApi,
  releaseWork;
const workHeld = new Promise((yes) => {
    releaseWork = yes;
  }),
  queuedMode = mode === 'queued_cancel' || mode === 'queued_cancel_reentry';
async function body({ api, service, services, owner, network, runtime }) {
  originalApi = api;
  const handoff = {
    kind: 'kswarm_task_handoff_v1',
    runId: 'original-direct-run',
    project: {
      id: 'project',
      name: 'Original project',
      goal: 'Metadata only',
      workFolder: network.workspace.path,
    },
    task: { id: 'original-direct-task', title: 'Original direct task' },
  };
  const handoffPath = path.join(domain, 'handoff.json');
  fs.writeFileSync(handoffPath, JSON.stringify(handoff));
  let submitted;
  const submittedReady = new Promise((yes) => {
    submitted = yes;
  });
  const bridge = api.createKSwarmRuntimeBridge({
    kswarmService: service,
    allowedRoots: [domain],
    runDesktopTask: services.runKSwarmHandoffTask,
    submitResult: async () => {
      submitted();
      return new Response('{"ok":true}', { status: 200 });
    },
  });
  if(mode==='installed_missing'||mode==='retired_missing'||mode==='installed_unowned_missing'){
    await api.bindOriginalMainRoomProjectAdmission(owner,runtime,service);
    if(mode==='retired_missing')await owner.drain();
  }else if(mode!=='legacy_uninstalled')await api.bindOriginalMainDirectAdmission(owner, bridge, service);
  await service.start();
  const actualIdentity=api.readOriginalKSwarmServiceIdentity(service);
  assert.equal(actualIdentity.ownedChild,mode!=='installed_unowned_missing');
  if(mode==='legacy_uninstalled'){
    assert.equal(api.hasOriginalMainSdkBridgeInstallation(),false);
    assert.deepEqual(await bridge.handleTaskHandoff({handoffPath,projectId:'project',taskId:'original-direct-task',runId:'original-direct-run'}),{ok:true});
    assert.equal(hostInvoked,1);assert.equal(seenCarrier,false);assert.equal(fs.existsSync(path.join(domain,'root-resource-v1.sqlite')),false);
    return{actualMain:true,actualOwnedService:true,actualHostInvoked:1,nativeInstalled:false,nativeRoots:0,legacyUninstalledPreserved:true,productQualification:false};
  }
  if(mode==='installed_missing'||mode==='retired_missing'||mode==='installed_unowned_missing'){
    assert.equal(api.hasOriginalMainSdkBridgeInstallation(),true);
    await assert.rejects(bridge.handleTaskHandoff({handoffPath,projectId:'project',taskId:'original-direct-task',runId:'original-direct-run'}),/ROOT_RESOURCE_DIRECT_COMPOSITION_REQUIRED/);
    assert.equal(hostInvoked,0);
    return{actualMain:true,actualOwnedService:actualIdentity.ownedChild,nativeInstalled:true,retired:mode==='retired_missing',unowned:mode==='installed_unowned_missing',missingDirectBindingRejected:true,actualHostInvoked:0,productQualification:false};
  }
  const read = () => {
    const db = new (require('node:sqlite').DatabaseSync)(
      path.join(domain, 'root-resource-v1.sqlite'),
      { readOnly: true },
    );
    try {
      return {
        policy: db
          .prepare(
            'SELECT capacity,claim_seq,human_burst FROM root_resource_policy',
          )
          .get(),
        rows: db
          .prepare('SELECT metadata_json,state FROM root_resources')
          .all(),
      };
    } finally {
      db.close();
    }
  };
  if (queuedMode) {
    const capacity = read().policy.capacity;
    assert.equal(capacity, 5);
    const invoke = (index, signal) => {
      const item = {
          ...handoff,
          runId: 'direct-queue-run-' + index,
          task: { ...handoff.task, id: 'direct-queue-task-' + index },
        },
        file = path.join(domain, 'handoff-' + index + '.json');
      fs.writeFileSync(file, JSON.stringify(item));
      return bridge.handleTaskHandoff({
        handoffPath: file,
        projectId: 'project',
        taskId: item.task.id,
        runId: item.runId,
        signal,
      });
    };
    const active = [];
    for (let i = 0; i < capacity; i++) active.push(invoke(i));
    const deadline = Date.now() + 5000;
    for (;;) {
      if (
        read().rows.filter((row) => row.state === 'reserved').length ===
        capacity
      )
        break;
      assert.ok(
        Date.now() < deadline,
        'first original Roots must consume before sixth arrival',
      );
      await new Promise((yes) => setTimeout(yes, 10));
    }
    const abort = new AbortController(),
      queued = invoke(capacity, abort.signal),
      queuedOutcome = queued.then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
    let before;
    try {
      for (;;) {
        before = read();
        if (before.rows.some((row) => row.state === 'queued')) break;
        assert.ok(Date.now() < deadline, 'original pool must saturate');
        await new Promise((yes) => setTimeout(yes, 10));
      }
      if (mode === 'queued_cancel_reentry') await revalidationReady;
      abort.abort(new DOMException('queued direct abort', 'AbortError'));
      if (mode === 'queued_cancel_reentry') {
        for (;;) {
          if (
            read().rows.some((row) => row.state === 'cancelled_before_launch')
          )
            break;
          assert.ok(
            Date.now() < deadline,
            'actual cancel must commit while read held',
          );
          await new Promise((yes) => setTimeout(yes, 5));
        }
        releaseRevalidation();
      }
      const cancelled = await queuedOutcome;
      assert.ok(
        cancelled.error ||
          cancelled.value?.error === 'task_cancelled:user_aborted',
      );
      const after = read();
      assert.equal(
        after.rows.filter((row) => row.state === 'cancelled_before_launch')
          .length,
        1,
      );
      assert.equal(after.policy.claim_seq, before.policy.claim_seq);
      assert.equal(after.policy.human_burst, before.policy.human_burst);
      assert.ok(hostInvoked <= capacity);
    } finally {
      releaseRevalidation();
      releaseWork();
      const outcomes = await Promise.allSettled(active);
      console.log(
        JSON.stringify({
          queuedCancelOutcomes: outcomes.map((item) =>
            item.status === 'fulfilled'
              ? { status: item.status, value: item.value }
              : { status: item.status, cause: String(item.reason) },
          ),
          physicalRows: read(),
        }),
      );
    }
    for (const value of await Promise.all(active))
      assert.deepEqual(value, { ok: true });
    const final = read();
    assert.equal(
      final.rows.filter((row) => row.state === 'released').length,
      capacity,
    );
    assert.equal(
      final.rows.filter((row) => row.state === 'cancelled_before_launch')
        .length,
      1,
    );
    return {
      actualMain: true,
      actualNativeOwner: true,
      capacity,
      hostInvoked,
      queuedCancelledBeforeLaunch: true,
      noClaimSeqBurn: true,
      allOriginalsReleased: true,
      productQualification: false,
    };
  }
  let releaseTail, enteredCallback;
  const callbackReady = new Promise((yes) => {
      enteredCallback = yes;
    }),
    tail = new Promise((yes) => {
      releaseTail = yes;
    });
  const onExecutionStarted =
    mode === 'held_callback'
      ? () => {
          enteredCallback();
          const raw = Promise.resolve();
          Object.defineProperty(raw, 'actualTail', { value: tail });
          return raw;
        }
      : undefined;
  let settled = false;
  const running = bridge.handleTaskHandoff({
    handoffPath,
    projectId: 'project',
    taskId: 'original-direct-task',
    runId: 'original-direct-run',
    onExecutionStarted,
  });
  void running.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  if (mode === 'held_callback') {
    await callbackReady;
    await submittedReady;
    await new Promise((yes) => setTimeout(yes, 25));
    try {
      assert.equal(
        settled,
        false,
        'original callback own child raw must remain physically held',
      );
      assert.equal(read().rows[0].state, 'reserved');
    } finally {
      releaseTail();
    }
  } else releaseTail();
  if (mode === 'negative')
    await assert.rejects(
      running,
      /desktop_task_failed: original-direct-known-negative/,
    );
  else assert.deepEqual(await running, { ok: true });
  assert.equal(hostInvoked, 1);
  const roots = read().rows.filter(
    (row) => JSON.parse(row.metadata_json).executionClass === 'kswarm_direct',
  );
  assert.equal(roots.length, 1);
  assert.equal(seenCarrier, true);
  assert.equal(roots[0].state, 'released');
  return {
    actualMain: true,
    actualNativeOwner: true,
    actualHostInvoked: hostInvoked,
    seenCarrier,
    directRootReleased: true,
    mode,
    heldCallbackJoined: mode === 'held_callback',
    knownNegativeJoined: mode === 'negative',
    productQualification: false,
  };
}
body.runner = async ({ emitRuntimeEvent, sessionId }) => {
  hostInvoked++;
  seenCarrier = !!originalApi.readCurrentOriginalRootExecutionContext();
  if (mode === 'negative') throw Error('original-direct-known-negative');
  if (queuedMode) await workHeld;
  await emitRuntimeEvent({
    type: 'receipt_emitted',
    sessionId,
    turnId: 'turn',
    intentId: 'intent',
    stepId: 'step',
    note: JSON.stringify({
      output: { summary: 'Original direct completed', artifacts: [] },
    }),
  });
};
require('./accepted-root-binding.cjs').run(body);
