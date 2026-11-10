'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  { pathToFileURL } = require('node:url'),
  assert = require('node:assert/strict');
const [bundle, domain, result, userData, brokerService, brokerServer, mode] =
  process.argv.slice(2);
// Isolate every default discovery writer before importing Source/Services.
const configRoot = path.join(domain, 'config');
fs.mkdirSync(configRoot, { recursive: true, mode: 0o700 });
process.env.XIAOK_CONFIG_DIR = configRoot;
const app = require('electron').app;
app.setPath('userData', userData);
app.disableHardwareAcceleration();
const cleanup = [];
const fsEffects = [];
let artifactFd,
  heldEntered = false,
  releaseHeld;
const sdkTail = new Promise((resolve) => {
  releaseHeld = resolve;
});
const fsPromises = fs;
for (const name of [
  'access',
  'open',
  'fstat',
  'read',
  'close',
  'realpath',
  'lstat',
]) {
  const original = fsPromises[name];
  fsPromises[name] = function (...args) {
    const inputPath = typeof args[0] === 'string' ? args[0] : null;
    const callback = args[args.length - 1];
    args[args.length - 1] = function (error, ...values) {
      if (
        name === 'open' &&
        inputPath === path.join(domain, 'actual-artifact.pdf') &&
        !error
      )
        artifactFd = values[0];
      if (
        name === 'read' &&
        args[0] === artifactFd &&
        mode === 'delivery-error-tail'
      ) {
        heldEntered = true;
        const failure = new Error('actual read callback wrapper fault');
        Object.defineProperty(failure, 'stack', { value: sdkTail });
        Object.defineProperty(failure, Symbol('actual-tail'), {
          value: sdkTail,
        });
        return callback(failure, ...values);
      }
      return callback(error, ...values);
    };
    const raw = Reflect.apply(original, fsPromises, args);
    fsEffects.push({ name, path: inputPath });
    if (
      name === 'close' &&
      args[0] === artifactFd &&
      mode === 'delivery-held'
    ) {
      heldEntered = true;
      return sdkTail;
    }
    return raw;
  };
}
require('node:module').syncBuiltinESMExports();
async function run() {
  await app.whenReady();
  const api = await import(pathToFileURL(bundle).href);
  const { createBrokerService } = await import(
    pathToFileURL(brokerService).href
  );
  const { createServer } = await import(pathToFileURL(brokerServer).href);
  const broker = createBrokerService({
    dbPath: path.join(domain, 'actual-broker.sqlite'),
  });
  const server = createServer({
    broker,
    roomService: broker.room,
    roomDesktopToken: 'actual-room-fixture',
  });
  await server.listen(0, '127.0.0.1');
  cleanup.push(async () => {
    await server.close();
    broker.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = api.createCollaborationRoomBrokerClient({
    token: 'actual-room-fixture',
    fetchImpl: (url, init) => fetch(base + new URL(String(url)).pathname, init),
  });
  const created = await client.createRoom({
    title: 'actual Native Room',
    memberAgentIds: ['agent-a', 'agent-b'],
  });
  assert.equal(created.ok, true);
  const sent = await client.sendRoomMessage({
    roomId: created.room.roomId,
    text: 'original source actual message',
    responsePolicy: 'mentioned',
    mentions: [
      { kind: 'agent', logicalAgentId: 'agent-a' },
      { kind: 'agent', logicalAgentId: 'agent-b' },
    ],
    idempotencyKey: 'original-native-message',
  });
  assert.equal(sent.ok, true);
  let effects = 0;
  const services = api.createDesktopServices({
    dataRoot: path.join(domain, 'desktop'),
    runner: async () => {
      effects++;
      throw Error('component must not execute');
    },
    kswarmService: {
      request: async () => new Response('{}'),
      getDesktopMutationToken: () => '',
    },
  });
  cleanup.push(() => services.closeTaskSourceWritersForMigration());
  const workspace = new api.RoomWorkspaceLocalStore(
    path.join(domain, 'workspace.sqlite'),
  );
  cleanup.push(() => workspace.close());
  const noClaim = async () => {
    throw Error('legacy direct runtime must not claim');
  };
  const runtime = api.createRoomWorkspaceRuntime({
    store: workspace,
    broker: { get: noClaim, request: noClaim },
    wake: { claimWake: noClaim, completeWake: noClaim },
    execute: services.runCollaborationRoomAgentTask,
    ensureProtocol: noClaim,
  });
  cleanup.push(() => runtime.shutdown());
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
    scope: { profileId: 'actual-profile', workspaceId: 'actual-workspace' },
  });
  cleanup.push(() => source.drain());
  const store = new api.FileTaskSnapshotStore(path.join(domain, 'tasks'));
  const population = api.createTaskSourceWriterPopulation(store);
  const hostRun = async () => {
    throw Error('Host SDK not authorized');
  };
  const host = population.createHost({
    materialRegistry: new api.MaterialRegistry({
      workspaceRoot: path.join(domain, 'workspace'),
      maxBytes: 1024,
    }),
    runner: (input) => hostRun(input),
  });
  cleanup.push(() => population.close());
  const identity = await api
    .readOriginalTaskHostIdentityIO(host, store)
    .initialize();
  const owner = api.createOriginalMainRootAdmissionOwner({
    roomSource: source,
    host,
    store,
  });
  const port = api.createOriginalMainRoomRootAdmissionPort({
    roomSource: source,
    host,
    store,
  });
  assert.equal(owner.room, port);
  assert.equal(typeof owner.physical, 'object');
  assert.equal(typeof owner.physical.acquireModel, 'function');
  assert.equal(typeof api.assertOriginalMainDshPhysicalComposition, 'function');
  let traps = 0;
  const foreign = new Proxy(
    {},
    {
      get() {
        traps++;
        throw Error('untrusted');
      },
      getOwnPropertyDescriptor() {
        traps++;
        throw Error('untrusted');
      },
    },
  );
  assert.throws(
    () =>
      api.assertOriginalMainDshPhysicalComposition(
        foreign,
        foreign,
        foreign,
        foreign,
      ),
    /COMPOSITION_REQUIRED/,
  );
  assert.equal(traps, 0);
  assert.equal(
    api.createOriginalMainRootAdmissionOwner({
      roomSource: source,
      host,
      store,
    }),
    owner,
  );
  assert.throws(
    () =>
      api.createOriginalMainRootAdmissionOwner({
        roomSource: source,
        host: { ...host },
        store,
      }),
    /OWNER_ALREADY_BOUND/,
  );
  cleanup.push(() => port.drain());
  const input = {
    roomId: created.room.roomId,
    roomMessageId: sent.message.messageId,
    logicalAgentIds: ['agent-a', 'agent-b'],
  };
  const proofs = await source.acceptMessage(input);
  assert.equal(proofs.length, 2);
  const first = await port.enqueueRoom(proofs[0]);
  const repeated = await port.enqueueRoom(proofs[0]);
  assert.equal(first.record.executionKey, repeated.record.executionKey);
  const second = await port.enqueueRoom(proofs[1]);
  assert.notEqual(first.record.executionKey, second.record.executionKey);
  const metadata = JSON.parse(first.record.metadataJson);
  assert.equal(metadata.hostId, identity.hostId);
  assert.equal(metadata.subject.messageId, input.roomMessageId);
  const reservation = await port.claimNext();
  assert.ok(reservation);
  const consumed = await port.consumeLaunch(reservation);
  assert.equal(consumed.newlyConsumed, true);
  assert.equal((await port.consumeLaunch(reservation)).newlyConsumed, false);
  const parent = api.readOriginalMainRootExecutionContext(owner, reservation);
  const siblingHost = population.createHost({
    materialRegistry: new api.MaterialRegistry({
      workspaceRoot: path.join(domain, 'sibling-materials'),
      maxBytes: 1024,
    }),
    runner: async () => {},
  });
  const foreignPopulation = api.createTaskSourceWriterPopulation(store),
    foreignHost = foreignPopulation.createHost({
      materialRegistry: new api.MaterialRegistry({
        workspaceRoot: path.join(domain, 'foreign-materials'),
        maxBytes: 1024,
      }),
      runner: async () => {},
    });
  const foreignStore = new api.FileTaskSnapshotStore(
    path.join(domain, 'foreign-store'),
  );
  const foreignProvider = new api.DesktopTaskObservationStore(
    path.join(domain, 'foreign-provider'),
  );
  const foreignVerifier = new api.DeliveryVerifier();
  const relationChecks = [];
  let privateTickets = 0;
  function checkReadonlyTicket() {
    const ticket = api.readCurrentOriginalHostWorkerTicket();
    assert.ok(ticket);
    privateTickets++;
    let traps = 0;
    const proxy = new Proxy(ticket, {
      get() {
        traps++;
        throw Error('unexpected ticket getter');
      },
      ownKeys() {
        traps++;
        throw Error('unexpected ticket keys');
      },
      getPrototypeOf() {
        traps++;
        throw Error('unexpected ticket prototype');
      },
    });
    const copy = { ...ticket };
    assert.equal(
      api.readOptionalOriginalTaskHostDeliveryWorkerRequest(proxy),
      undefined,
    );
    assert.equal(
      api.readOptionalOriginalTaskStoreProtectionWorkerRequest(proxy),
      undefined,
    );
    assert.equal(
      api.readOptionalOriginalTaskHostDeliveryWorkerRequest(copy),
      undefined,
    );
    assert.equal(
      api.readOptionalOriginalTaskStoreProtectionWorkerRequest(copy),
      undefined,
    );
    assert.equal(traps, 0);
    const delivery =
      api.readOptionalOriginalTaskHostDeliveryWorkerRequest(ticket);
    if (delivery) {
      assert.equal(
        api.readOptionalOriginalTaskHostDeliveryWorkerContext(
          ticket,
          siblingHost,
          store,
        ).pOnly,
        true,
      );
      assert.throws(
        () =>
          api.readOptionalOriginalTaskHostDeliveryWorkerContext(
            ticket,
            foreignHost,
            store,
          ),
        /CONTEXT_REQUIRED/,
      );
      assert.throws(
        () =>
          api.readOptionalOriginalTaskHostDeliveryWorkerContext(
            ticket,
            host,
            foreignStore,
          ),
        /CONTEXT_REQUIRED/,
      );
      // A real different verifier plus foreign snapshot/options cannot replay the
      // actual producer's ticket. The original in-method call checks the true tuple.
      assert.throws(
        () =>
          api.readOptionalOriginalTaskHostDeliveryWorkerRequest(
            ticket,
            foreignVerifier,
            {},
            {},
          ),
        /REQUEST_REQUIRED/,
      );
    } else {
      const request =
        api.readOptionalOriginalTaskStoreProtectionWorkerRequest(ticket);
      assert.ok(request);
      const taskId = request.options.workerData.taskId;
      assert.equal(
        api.readOptionalOriginalTaskStoreProtectionWorkerRequest(
          ticket,
          store.observations,
          taskId,
        ),
        request,
      );
      assert.throws(
        () =>
          api.readOptionalOriginalTaskStoreProtectionWorkerRequest(
            ticket,
            foreignProvider,
            taskId,
          ),
        /REQUEST_REQUIRED/,
      );
      assert.throws(
        () =>
          api.readOptionalOriginalTaskStoreProtectionWorkerRequest(
            ticket,
            store.observations,
            taskId + '-foreign',
          ),
        /REQUEST_REQUIRED/,
      );
      assert.equal(
        api.readOptionalOriginalTaskStoreProtectionWorkerContext(ticket, store)
          .pOnly,
        true,
      );
      assert.throws(
        () =>
          api.readOptionalOriginalTaskStoreProtectionWorkerContext(
            ticket,
            foreignStore,
          ),
        /CONTEXT_REQUIRED/,
      );
    }
    const rejected = owner.physical.acquireModel(
      ticket,
      'readonly-must-not-model-' + privateTickets,
      'a'.repeat(64),
    );
    relationChecks.push(
      assert.rejects(rejected, /ROOT_RESOURCE_MODEL_CONTEXT_REQUIRED/),
    );
    relationChecks.push(
      Promise.resolve().then(() =>
        assert.equal(api.readCurrentOriginalHostWorkerTicket(), null),
      ),
    );
  }
  if (mode.startsWith('delivery')) {
    const counts = [];
    const hook = require('node:async_hooks').createHook({
      init(_id, type) {
        if (type !== 'WORKER') return;
        checkReadonlyTicket();
        const db = new (require('node:sqlite').DatabaseSync)(
          path.join(domain, 'root-resource-v1.sqlite'),
          { readOnly: true },
        );
        try {
          counts.push(
            db
              .prepare(
                "SELECT COUNT(*) n FROM root_physical_resources WHERE resource_kind=2 AND state='reserved'",
              )
              .get().n,
          );
        } finally {
          db.close();
        }
      },
    });
    const artifact = path.join(domain, 'actual-artifact.pdf');
    fs.writeFileSync(
      artifact,
      '%PDF-1.4\nactual original file evidence\n%%EOF',
    );
    const deliveryReports = [];
    const deliveryHost = population.createHost({
      aheGuards: { artifactEvidence: true },
      materialRegistry: new api.MaterialRegistry({
        workspaceRoot: path.join(domain, 'delivery-materials'),
        maxBytes: 1024,
      }),
      runner: async (input) => {
        await input.emitRuntimeEvent({
          type: 'artifact_recorded',
          artifactId: 'actual-file',
          sessionId: input.sessionId,
          turnId: 'artifact-turn',
          intentId: 'artifact-intent',
          stageId: 'artifact-stage',
          kind: 'pdf',
          label: 'actual original PDF',
          path: pathToFileURL(artifact).href,
        });
      },
      getExecutionPolicy: () => ({ deliveryRepair: 'explicit' }),
      authorizePreparation: () => {},
      onDeliveryReport: async (report) => {
        deliveryReports.push(report);
        return report;
      },
    });
    deliveryHost.bindMultiAgentRecovery(Promise.resolve());
    const prepared = await deliveryHost.prepareTask(
      { prompt: 'Generate the actual PDF file artifact', materials: [] },
      {
        reservation: deliveryHost.reserveTaskIdentity(),
        marker: {
          groupId: 'fixture-g',
          rootEpoch: 1,
          rootTurnId: 'fixture-turn',
          preparationId: 'fixture-preparation',
          bootId: 'fixture-boot',
        },
      },
    );
    hook.enable();
    try {
      await api.runWithOriginalRootExecutionContext(parent, () =>
        deliveryHost.startTask(prepared.taskId),
      );
      let physicalDrained = false;
      const drain = deliveryHost.drain().then(() => {
        physicalDrained = true;
      });
      if (mode === 'delivery-held' || mode === 'delivery-error-tail') {
        for (let i = 0; i < 200 && !heldEntered; i++)
          await new Promise((resolve) => setTimeout(resolve, 5));
        assert.equal(heldEntered, true, 'actual SDK tail seam must run');
        await new Promise((resolve) => setTimeout(resolve, 30));
        assert.equal(
          physicalDrained,
          false,
          'held original SDK tail must keep Host physical pending',
        );
        const db = new (require('node:sqlite').DatabaseSync)(
          path.join(domain, 'root-resource-v1.sqlite'),
          { readOnly: true },
        );
        try {
          assert.equal(
            db
              .prepare(
                "SELECT count(*) n FROM root_physical_resources WHERE resource_kind=2 AND state='reserved'",
              )
              .get().n,
            1,
          );
        } finally {
          db.close();
        }
        releaseHeld();
      }
      // Fixture assertion timeout is only a diagnostic; it never certifies
      // an unfinished SDK tail or refunds its Native resource.
      let timer;
      try {
        await Promise.race([
          drain,
          new Promise((resolve) => {
            timer = setTimeout(resolve, 2500);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      fs.writeFileSync(
        path.join(domain, 'artifact-guard-cut.json'),
        JSON.stringify({
          physicalDrained,
          deliveryReports,
          artifactExists: fs.existsSync(artifact),
          fsEffects,
          heldEntered,
          heldNativeP: heldEntered,
        }),
      );
      assert.equal(
        physicalDrained,
        true,
        'actual artifact guard must physically drain',
      );
      assert.ok(
        fsEffects.some((row) => row.name === 'open' && row.path === artifact),
        'actual original FS open must run',
      );
      assert.ok(
        deliveryReports.some((report) => report.delivery?.status === 'passed'),
        JSON.stringify(deliveryReports),
      );
    } finally {
      hook.disable();
    }
    await Promise.all(relationChecks);
    assert.equal(privateTickets, counts.length);
    assert.ok(counts.length > 0);
    assert.ok(
      counts.every((n) => n === 1),
      JSON.stringify(counts),
    );
  }
  await foreignStore.closeAndDrain();
  assert.equal(effects, 0);
  return {
    actualMain: true,
    actualBroker: true,
    actualHostIdentity: identity.hostId,
    opaqueAcceptedSource: true,
    nativeConsumedOnce: true,
    modelEffects: effects,
    notProductNQualification: true,
    componentOnly: mode === 'process',
  };
}
run().then(
  async (facts) => {
    for (let i = cleanup.length - 1; i >= 0; i--) await cleanup[i]();
    fs.writeFileSync(
      result,
      JSON.stringify({ ok: true, pid: process.pid, ...facts }),
    );
    app.exit(0);
  },
  (error) => {
    fs.writeFileSync(
      result,
      JSON.stringify({
        ok: false,
        pid: process.pid,
        error: String(error?.stack ?? error),
        cleanupUnconfirmed: true,
      }),
    );
    app.exit(1); // failed fixture only; no product/Native physical-known assertion
  },
);
