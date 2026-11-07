'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url'),
  { spawn } = require('node:child_process'),
  { app } = require('electron');
const [bundle, domain, result, userData, repo, mode = 'binding'] =
  process.argv.slice(2);
process.env.XIAOK_CONFIG_DIR=path.join(domain,'config');
fs.mkdirSync(process.env.XIAOK_CONFIG_DIR,{recursive:true,mode:0o700});
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
        if (url.port === '4400' && url.pathname === '/health' && !ownedChild && mode !== 'installed_unowned_missing')
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
    const runtime = api.createRoomWorkspaceRuntime({
      store: workspace,
      kswarmService: service,
      broker: { get: forbidden, request: forbidden },
      wake: { claimWake: forbidden, completeWake: forbidden },
      execute: services.runCollaborationRoomAgentTask,
      ensureProtocol: forbidden,
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
if (process.argv[1] === __filename)
  exports.run(async ({ api, service, services, runtime, owner, forbidden }) => {
    const bridge = api.createKSwarmRuntimeBridge({
      kswarmService: service,
      runDesktopTask: services.runKSwarmHandoffTask,
      submitResult: forbidden,
    });
    await api.bindOriginalMainDirectAdmission(owner, bridge, service);
    await api.bindOriginalMainRoomProjectAdmission(owner, runtime, service);
    const direct = api.readOriginalMainDirectAdmission(bridge, service),
      project = api.readOriginalMainRoomProjectAdmission(runtime, service);
    assert.equal(typeof direct.cancelQueued, 'function');
    let traps = 0;
    const foreign = new Proxy(
      {},
      {
        get() {
          traps++;
          throw Error('getter');
        },
      },
    );
    await assert.rejects(
      Promise.resolve().then(() => direct.cancelQueued(foreign)),
      /ORIGINAL|REQUIRED/,
    );
    assert.equal(traps, 0);
    assert.throws(
      () => api.readOriginalMainRoomProjectAdmission(bridge, service),
      /ORIGINAL_ACCEPTED_BINDING_REQUIRED/,
    );
    assert.throws(
      () => api.readOriginalMainDirectAdmission(runtime, service),
      /ORIGINAL_ACCEPTED_BINDING_REQUIRED/,
    );
    await api.cacheOriginalMainAcceptedAdmission(
      'kswarm_direct',
      bridge,
      service,
    );
    await api.cacheOriginalMainAcceptedAdmission(
      'room_project',
      runtime,
      service,
    );
    assert.equal(
      api.readOptionalOriginalMainAcceptedAdmission(
        'kswarm_direct',
        bridge,
        service,
      ),
      direct,
    );
    assert.equal(
      api.readOptionalOriginalMainAcceptedAdmission(
        'room_project',
        runtime,
        service,
      ),
      project,
    );
    assert.throws(
      () =>
        api.readOptionalOriginalMainAcceptedAdmission(
          'room_project',
          bridge,
          service,
        ),
      /ORIGINAL_ACCEPTED_BINDING_REQUIRED/,
    );
    assert.throws(
      () =>
        api.readOptionalOriginalMainAcceptedAdmission(
          'kswarm_direct',
          runtime,
          service,
        ),
      /ORIGINAL_ACCEPTED_BINDING_REQUIRED/,
    );
    assert.throws(
      () =>
        api.readOptionalOriginalMainAcceptedAdmission(
          'kswarm_direct',
          bridge,
          {},
        ),
      /ORIGINAL_ACCEPTED_BINDING_REQUIRED/,
    );
    assert.equal(
      api.readOptionalOriginalMainAcceptedAdmission(
        'kswarm_direct',
        foreign,
        service,
      ),
      null,
    );
    await assert.rejects(
      api.cacheOriginalMainAcceptedAdmission('kswarm_direct', foreign, service),
      /ORIGINAL_ACCEPTED_BINDING_REQUIRED/,
    );
    assert.equal(traps, 0);
    return {
      actualMain: true,
      actualNativeOwner: true,
      kindMismatchRejected: true,
      thinPrivateRead: true,
      proxyTraps: traps,
      effectsInvoked: 0,
      productQualification: false,
    };
  });
