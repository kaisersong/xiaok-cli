'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url'),
  { spawn } = require('node:child_process'),
  { app } = require('electron');
const [bundle, domain, result, userData, repo, mode = 'room_success'] =
  process.argv.slice(2);
process.env.XIAOK_CONFIG_DIR = path.join(domain, 'config');
fs.mkdirSync(process.env.XIAOK_CONFIG_DIR, { recursive: true, mode: 0o700 });
app.setPath('userData', userData);
app.disableHardwareAcceleration();
exports.run = async function run(body) {
  const cleanup = [];
  let ownedChild, ownedClosed, networkChild, api;
  try {
    await app.whenReady();
    api = await import(pathToFileURL(bundle).href);
    const scope = { profileId: 'a'.repeat(64), workspaceId: 'b'.repeat(64) },
      forbidden = async () => {
        throw Error('fixture unintended SDK');
      };
    let network;
    if (mode !== 'binding') {
      process.env.ELECTRON_RUN_AS_NODE = '1';
      process.env.XIAOK_WORKFLOW_TEST_REPO_ROOT = repo;
      process.env.XIAOK_DISABLE_GLOBAL_PLUGINS = '1';
      process.env.KSWARM_SERVER_PATH = path.resolve(
        repo,
        '../kswarm/src/server/index.js',
      );
    }
    const service = api.createKSwarmService({
      desktopProjectScope: scope,
      ...(mode === 'binding'
        ? {}
        : {
            findPortOwner: async () => null,
            killStalePortOwner: forbidden,
            spawnProcess: (_exe, _args, opts) => {
              assert.equal(ownedChild, undefined);
              ownedChild = spawn(
                process.execPath,
                [
                  '--input-type=module',
                  '-e',
                  "process.on('message',()=>{});process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},10000);",
                ],
                {
                  ...opts,
                  env: { ...opts.env, ELECTRON_RUN_AS_NODE: '1' },
                  stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
                },
              );
              ownedClosed = new Promise((yes) =>
                ownedChild.once('close', (code, signal) =>
                  yes({ pid: ownedChild.pid, code, signal }),
                ),
              );
              return ownedChild;
            },
          }),
    });
    if (mode !== 'binding') {
      const module = await import(
        pathToFileURL(
          path.join(
            repo,
            'desktop/tests/support/owned-workflow-network-fixture.mjs',
          ),
        ).href
      );
      network = await module.createOwnedWorkflowNetworkFixture(null, {
        project: {
          id: 'project',
          name: 'Original direct task',
          goal: 'Metadata only',
        },
        desktopProjectScope: scope,
        desktopMutationToken: service.getDesktopMutationToken(),
      });
      globalThis.fetch = async (input, init) => {
        const url = new URL(String(input));
        if (
          url.port === '4400' &&
          url.pathname === '/health' &&
          !ownedChild &&
          mode !== 'installed_unowned_missing'
        )
          return new Response('{"ok":false}', { status: 503 });
        return network.forwardedFetch(input, init);
      };
      cleanup.push(async () => {
        await network.close();
        networkChild = network.getOwnedServerState();
        assert.equal(networkChild.exitCode, 0);
        assert.equal(networkChild.protectionTriggered, false);
      });
    }
    cleanup.push(() => api.sealAndDrainKSwarmServiceInstance(service));
    const runner = body.runner || forbidden;
    const services = api.createDesktopServices({
      dataRoot: path.join(domain, 'desktop'),
      kswarmService: service,
      runner,
    });
    cleanup.push(() => services.closeTaskSourceWritersForMigration());
    const workspace = new api.RoomWorkspaceLocalStore(
      path.join(domain, 'workspace.sqlite'),
    );
    cleanup.push(() => workspace.close());
    const physicalWorkspace = await api.prepareWorkspaceRoot(
      network.workspace.path,
    );
    workspace.prepareBinding({
      ...physicalWorkspace,
      bindingId: 'binding',
      roomId: 'room',
      workspaceId: 'workspace',
      hostId: 'host',
      generation: 1,
      requestId: 'binding-request',
      payloadDigest: 'fixture-binding',
      createdBy: 'user.local',
    });
    workspace.activateBinding('binding', {
      workspaceId: 'workspace',
      activeBindingId: 'binding',
      generation: 1,
    });
    const gateway = {
      async get() {
        return {
          ok: true,
          config: {
            activeBindingId: 'binding',
            workspaceId: 'workspace',
            originHostId: 'host',
            generation: 1,
            revision: 1,
            phase: 'active',
          },
          decisions: [],
        };
      },
      request(roomId, action, input) {
        if (action === 'release' && mode === 'room_release_held') {
          releaseEntered();
          const raw = Promise.resolve({ ok: true });
          Object.defineProperty(raw, 'physicalReleaseChild', {
            value: releaseTail,
          });
          return raw;
        }
        if (action === 'acquire')
          return {
            ok: true,
            claim: {
              ...input,
              roomId,
              bindingId: 'binding',
              workspaceId: 'workspace',
              originHostId: 'host',
              generation: 1,
              workspaceRevision: 1,
              protocolVersion: 1,
              hostIncarnation: 1,
              instructionsRevision: 0,
              claimId: 'claim-' + input.runId,
              mappingRevision: 1,
              executionState: 'admitted',
              authorizationState: 'valid',
            },
          };
        return { ok: true };
      },
    };
    const adapter = {
      async resolve() {
        return {
          mapping: {
            workFolder: network.workspace.path,
            artifactsDir: network.workspace.path,
            mappingRevision: 1,
          },
          task: { id: 'original-project-task' },
        };
      },
      async authorize() {
        return { mapping: { artifactsDir: network.workspace.path } };
      },
      async dispatch() {
        return { ok: true };
      },
      async submit() {
        return { ok: true };
      },
    };
    const runtime = api.createRoomWorkspaceRuntime({
      store: workspace,
      kswarmService: service,
      broker: gateway,
      wake: { claimWake: forbidden, completeWake: forbidden },
      execute: services.runCollaborationRoomAgentTask,
      ensureProtocol: async () => {},
      projectAdapter: adapter,
      executeProject: services.runWorkspaceProjectTask,
    });
    cleanup.push(() => runtime.shutdown());
    const client = api.createCollaborationRoomBrokerClient({
      token: 'fixture-unused',
      fetchImpl: forbidden,
    });
    const dispatcher = api.createCollaborationRoomWakeDispatcher({
      brokerClient: client,
      execute: services.runCollaborationRoomAgentTask,
      executeTurn: runtime.run,
      canExecute: async () => true,
    });
    const source = api.createOriginalRoomTurnSource({
      dispatcher,
      runtime,
      services,
      scope,
    });
    cleanup.push(() => source.drain());
    const store = new api.FileTaskSnapshotStore(path.join(domain, 'tasks')),
      population = api.createTaskSourceWriterPopulation(store);
    const host = population.createHost({
      materialRegistry: new api.MaterialRegistry({
        workspaceRoot: path.join(domain, 'workspace'),
        maxBytes: 1024,
      }),
      runner: forbidden,
    });
    cleanup.push(() => population.close());
    await api.readOriginalTaskHostIdentityIO(host, store).initialize();
    const owner = api.createOriginalMainRootAdmissionOwner({
      roomSource: source,
      host,
      store,
    });
    cleanup.push(() => owner.drain());
    const facts = await body({
      api,
      scope,
      service,
      services,
      runtime,
      owner,
      network,
      localStore: workspace,
      domain,
      mode,
      forbidden,
    });
    const failures = [];
    for (let i = cleanup.length - 1; i >= 0; i--)
      try {
        await cleanup[i]();
      } catch (error) {
        failures.push(String(error));
      }
    fs.writeFileSync(
      result,
      JSON.stringify({
        ok: failures.length === 0,
        pid: process.pid,
        ...facts,
        ownedChild: ownedClosed ? await ownedClosed : null,
        networkChild,
        cleanupFailures: failures,
      }),
    );
    app.exit(failures.length ? 1 : 0);
  } catch (error) {
    const failures = [];
    for (let i = cleanup.length - 1; i >= 0; i--)
      try {
        await cleanup[i]();
      } catch (raw) {
        failures.push(String(raw));
      }
    fs.writeFileSync(
      result,
      JSON.stringify({
        ok: false,
        pid: process.pid,
        error: String(error.stack || error),
        ownedChild: ownedClosed ? await ownedClosed : null,
        networkChild,
        cleanupFailures: failures,
      }),
    );
    app.exit(1);
  }
};
let roomRunnerCalls = 0,
  roomCarrier = false,
  originalApi,
  releaseRunnerTail,
  enteredRunner;
const runnerReady = new Promise((yes) => {
    enteredRunner = yes;
  }),
  runnerTail = new Promise((yes) => {
    releaseRunnerTail = yes;
  });
let releaseReleaseTail, releaseEntered;
const releaseTail = new Promise((yes) => {
    releaseReleaseTail = yes;
  }),
  releaseReady = new Promise((yes) => {
    releaseEntered = yes;
  });
async function roomBody({
  api,
  service,
  services,
  runtime,
  owner,
  network,
  localStore,
}) {
  originalApi = api;
  if (mode === 'room_installed_missing' || mode === 'room_retired_missing') {
    const producer = api.createKSwarmRuntimeBridge({
      kswarmService: service,
      runDesktopTask: services.runKSwarmHandoffTask,
      submitResult: async () => new Response('{}'),
    });
    await api.bindOriginalMainDirectAdmission(owner, producer, service);
    if (mode === 'room_retired_missing') await owner.drain();
  } else if (mode !== 'room_legacy')
    await api.bindOriginalMainRoomProjectAdmission(owner, runtime, service);
  await service.start();
  const prepared = await runtime.prepareProjectTask({
    roomId: 'room',
    projectId: 'project',
    taskId: 'original-project-task',
    logicalAgentId: 'xiaok-worker',
    requestId: 'original-project-request',
  });
  const record = localStore.getRecord('project-execution', prepared.claimId),
    context = record.context;
  const handoff = {
    kind: 'kswarm_task_handoff_v1',
    runId: context.runId,
    project: {
      id: 'project',
      name: 'Original project',
      goal: 'Controlled actual Executor',
      workFolder: context.effectiveCwd,
      artifactsDir: context.effectiveCwd,
    },
    task: { id: 'original-project-task', title: 'Original project task' },
    workspaceContext: context,
  };
  let settled = false;
  const running = runtime.runProjectTask({
    handoff,
    targetParticipantId: 'xiaok-worker',
  });
  void running.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  if (mode === 'room_held') {
    await runnerReady;
    await new Promise((yes) => setTimeout(yes, 30));
    try {
      assert.equal(settled, false);
    } finally {
      releaseRunnerTail();
    }
  } else releaseRunnerTail();
  if (mode === 'room_release_held') {
    await releaseReady;
    await new Promise((yes) => setTimeout(yes, 25));
    try {
      assert.equal(settled, false);
      assert.notEqual(
        localStore.getRecord('physical-claim', context.claimId).released,
        true,
      );
    } finally {
      releaseReleaseTail();
    }
  } else releaseReleaseTail();
  const result = await running;
  if (mode === 'room_installed_missing' || mode === 'room_retired_missing') {
    assert.equal(result.ok, false);
    assert.match(result.error, /COMPOSITION_REQUIRED/);
    assert.equal(roomRunnerCalls, 0);
    return {
      actualMain: true,
      installedMissingRejected: true,
      retired: mode === 'room_retired_missing',
      actualExecutorCalls: 0,
      productQualification: false,
    };
  }
  if (mode === 'room_negative')
    assert.deepEqual(result, { ok: false, error: 'undefined' });
  else assert.deepEqual(result, { ok: true });
  assert.equal(roomRunnerCalls, 1);
  if (mode === 'room_legacy') {
    assert.equal(roomCarrier, false);
    assert.equal(
      fs.existsSync(path.join(domain, 'root-resource-v1.sqlite')),
      false,
    );
    return {
      actualMain: true,
      legacyPreserved: true,
      actualExecutorCalls: 1,
      noFakeNativeRoot: true,
      productQualification: false,
    };
  }
  const db = new (require('node:sqlite').DatabaseSync)(
    path.join(domain, 'root-resource-v1.sqlite'),
    { readOnly: true },
  );
  let roots;
  try {
    roots = db
      .prepare('SELECT metadata_json,state FROM root_resources')
      .all()
      .filter(
        (row) =>
          JSON.parse(row.metadata_json).executionClass === 'room_project',
      );
  } finally {
    db.close();
  }
  assert.equal(roots.length, 1);
  assert.equal(roomCarrier, true);
  assert.equal(roots[0].state, 'released');
  assert.equal(
    localStore.getRecord('physical-claim', context.claimId).released,
    true,
  );
  return {
    actualMain: true,
    actualNativeOwner: true,
    actualExecutorCalls: roomRunnerCalls,
    sameCarrier: roomCarrier,
    nativeReleased: true,
    workspaceReleased: true,
    workspaceGateway: 'controlled_protocol_fixture',
    actualBExecutionStartGet: true,
    productQualification: false,
  };
}
roomBody.runner = () => {
  roomRunnerCalls++;
  roomCarrier = !!originalApi.readCurrentOriginalRootExecutionContext();
  enteredRunner();
  if (mode === 'room_negative') throw undefined;
  const raw = Promise.resolve();
  if (mode === 'room_held')
    Object.defineProperty(raw, 'physicalChild', { value: runnerTail });
  return raw;
};
exports.run(roomBody);
