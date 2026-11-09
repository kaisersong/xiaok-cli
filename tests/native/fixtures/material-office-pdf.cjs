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
const ownProcesses = [];
let activePort,
  postCount = 0;
let fileReadCount = 0;
const fsPromises = require('node:fs/promises'),
  originalReadFile = fsPromises.readFile;
fsPromises.readFile = function (...args) {
  if (String(args[0]) === path.join(domain, 'actual.docx')) fileReadCount++;
  return Reflect.apply(originalReadFile, this, args);
};
require('node:module').syncBuiltinESMExports();
const writable = require('node:stream').Writable,
  originalEnd = writable.prototype.end;
writable.prototype.end = function (...args) {
  if (
    typeof args[0] === 'string' &&
    args[0].includes('absolutePath') &&
    args[0].includes('actual.docx')
  )
    postCount++;
  return Reflect.apply(originalEnd, this, args);
};
const childProcess = require('node:child_process'),
  originalSpawn = childProcess.spawn;
childProcess.spawn = function (...args) {
  const child = Reflect.apply(originalSpawn, this, args);
  if (
    mode === 'office-post-revoked' &&
    args[1]?.some((value) => String(value).endsWith('office-parser-worker.mjs'))
  )
    void activePort.drain().catch(() => {});
  const row = {
    pid: child.pid,
    command: args[0],
    argv: args[1],
    closed: false,
  };
  ownProcesses.push(row);
  child.once('close', (code, signal) => {
    row.closed = true;
    row.code = code;
    row.signal = signal;
    fs.writeFileSync(
      path.join(domain, 'owned-processes.json'),
      JSON.stringify(ownProcesses),
    );
  });
  fs.writeFileSync(
    path.join(domain, 'owned-processes.json'),
    JSON.stringify(ownProcesses),
  );
  return child;
};
function phase(value) {
  fs.writeFileSync(
    path.join(domain, 'await-phase.json'),
    JSON.stringify({ phase: value, pid: process.pid }),
  );
}
async function run() {
  phase('app-ready-before');
  await app.whenReady();
  phase('component-import-before');
  const api = await import(pathToFileURL(bundle).href);
  phase('component-import-after');
  const { createBrokerService } = await import(
    pathToFileURL(brokerService).href
  );
  const { createServer } = await import(pathToFileURL(brokerServer).href);
  phase('broker-import-after');
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
  phase('services-create-before');
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
  phase('services-create-after');
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
  cleanup.push(async () => {
    source.seal();
    let settled = false;
    // The component-only SDK row intentionally has no whole-domain fact.
    // Observe the real pending drain; never convert its wait into completion.
    const draining = source.drain();
    draining.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await new Promise((yes) => setTimeout(yes, 20));
    fs.writeFileSync(
      path.join(domain, 'component-drain.json'),
      JSON.stringify({ settled, wholeDomainKnown: false }),
    );
  });
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
  activePort = port;
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
  cleanup.push(async () => {
    let settled = false;
    const draining = port.drain();
    draining.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await new Promise((yes) => setTimeout(yes, 20));
    fs.writeFileSync(
      path.join(domain, 'native-port-drain.json'),
      JSON.stringify({ settled, wholeDomainKnown: false }),
    );
    if (mode === 'office-entered' || mode === 'pdf-entered')
      assert.equal(
        settled,
        false,
        'component-only P must not manufacture a completed Native parent drain',
      );
  });
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
  const officePath = path.join(domain, 'actual.docx');
  const counts = [];
  const hook = require('node:async_hooks').createHook({
    init(_id, type) {
      if (type !== (mode === 'pdf-entered' ? 'WORKER' : 'PROCESSWRAP')) return;
      const db = new (require('node:sqlite').DatabaseSync)(
        path.join(domain, 'root-resource-v1.sqlite'),
        { readOnly: true },
      );
      try {
        counts.push(
          db
            .prepare(
              "SELECT count(*) n FROM root_physical_resources WHERE resource_kind=2 AND state='reserved'",
            )
            .get().n,
        );
      } finally {
        db.close();
      }
    },
  });
  phase('office-parser-before');
  const parser =
    mode === 'office-entered'
      ? { parse: services.parseOfficeDocument }
      : api.createOfficeDocumentParser();
  let resultValue;
  hook.enable();
  try {
    if (mode === 'pdf-entered') {
      const bytes = fs.readFileSync(path.join(domain, 'actual.pdf'));
      try {
        resultValue = await api.runWithOriginalRootExecutionContext(
          parent,
          () => api.extractPdfText(new Uint8Array(bytes)),
        );
      } catch (error) {
        resultValue = {
          rejected: true,
          errorPresent: true,
          errorUndefined: error === undefined,
        };
      }
      assert.equal(resultValue, 'Actual original PDF file');
    } else if (mode === 'pending-no-source') {
      resultValue = await api.createSourceExtractor().extract({
        filePath: officePath,
        mimeType: 'application/octet-stream',
      });
      assert.equal(resultValue.ok, false);
      assert.match(
        resultValue.error,
        /MATERIAL_PENDING_RECOVERY_AUTHORITY_REQUIRED/,
      );
      assert.equal(fileReadCount, 0);
      assert.deepEqual(counts, []);
    } else if (mode === 'office-post-revoked') {
      try {
        await api.runWithOriginalRootExecutionContext(parent, () =>
          parser.parse({ absolutePath: officePath, maxOutputChars: 1000 }),
        );
        resultValue = { rejected: false };
      } catch {
        resultValue = { rejected: true };
      }
      assert.deepEqual(resultValue, { rejected: true });
      assert.equal(postCount, 0);
    } else if (mode === 'office-foreign-parent') {
      let traps = 0;
      const foreign = new Proxy(
        {},
        {
          get() {
            traps++;
            throw Error('get');
          },
          ownKeys() {
            traps++;
            throw Error('keys');
          },
          getOwnPropertyDescriptor() {
            traps++;
            throw Error('descriptor');
          },
        },
      );
      try {
        await api.runWithOriginalRootExecutionContext(foreign, () =>
          parser.parse({ absolutePath: officePath, maxOutputChars: 1000 }),
        );
        resultValue = { rejected: false, traps };
      } catch {
        resultValue = { rejected: true, traps };
      }
      assert.deepEqual(resultValue, { rejected: true, traps: 0 });
    } else if (mode === 'office-pre-spawn-held') {
      let release, arrived;
      const held = new Promise((yes) => {
          release = yes;
        }),
        entered = new Promise((yes) => {
          arrived = yes;
        });
      const cause = Error('actual original pre-spawn guard cause');
      Object.defineProperty(cause, Symbol('original held tail'), {
        value: held,
      });
      Object.defineProperty(cause, 'stack', {
        value: held,
        configurable: true,
      });
      let rejected = false;
      const beforeEffects = () => {
        const db = new (require('node:sqlite').DatabaseSync)(
          path.join(domain, 'root-resource-v1.sqlite'),
          { readOnly: true },
        );
        try {
          if (
            db
              .prepare(
                "SELECT count(*) n FROM root_physical_resources WHERE resource_kind=2 AND state='reserved'",
              )
              .get().n > 0
          ) {
            arrived();
            throw cause;
          }
        } finally {
          db.close();
        }
      };
      const running = api
        .runWithOriginalRootExecutionContext(parent, () =>
          parser.parse({
            absolutePath: officePath,
            maxOutputChars: 1000,
            beforeEffects,
          }),
        )
        .then(
          () => ({ rejected: false }),
          (error) => {
            rejected = true;
            return { rejected: true, sameCause: error === cause };
          },
        );
      await entered;
      await new Promise((yes) => setTimeout(yes, 20));
      assert.equal(rejected, false);
      assert.deepEqual(counts, []);
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
      release();
      resultValue = await running;
      assert.deepEqual(resultValue, { rejected: true, sameCause: true });
    } else if (mode === 'office-pre-spawn-negative') {
      const beforeEffects = () => {
        const db = new (require('node:sqlite').DatabaseSync)(
          path.join(domain, 'root-resource-v1.sqlite'),
          { readOnly: true },
        );
        try {
          if (
            db
              .prepare(
                "SELECT count(*) n FROM root_physical_resources WHERE resource_kind=2 AND state='reserved'",
              )
              .get().n > 0
          )
            throw undefined;
        } finally {
          db.close();
        }
      };
      try {
        await api.runWithOriginalRootExecutionContext(parent, () =>
          parser.parse({
            absolutePath: officePath,
            maxOutputChars: 1000,
            beforeEffects,
          }),
        );
        resultValue = { rejected: false };
      } catch (error) {
        resultValue = {
          rejected: true,
          errorPresent: true,
          errorUndefined: error === undefined,
        };
      }
    } else
      resultValue = await api.runWithOriginalRootExecutionContext(parent, () =>
        parser.parse({ absolutePath: officePath, maxOutputChars: 1000 }),
      );
  } finally {
    hook.disable();
  }
  fs.writeFileSync(
    path.join(domain, 'office-p-cut.json'),
    JSON.stringify({ counts, result: resultValue }),
  );
  if (mode === 'office-entered') {
    assert.equal(resultValue.ok, true);
    assert.equal(resultValue.engine, 'anydoc');
    assert.ok(
      ownProcesses.length > 0 &&
        ownProcesses.every((row) => row.closed && row.code === 0),
    );
  }
  if (
    mode === 'office-pre-spawn-negative' ||
    mode === 'office-pre-spawn-held' ||
    mode === 'office-foreign-parent' ||
    mode === 'pending-no-source'
  ) {
    assert.deepEqual(counts, []);
    if (mode === 'office-pre-spawn-negative')
      assert.deepEqual(resultValue, {
        rejected: true,
        errorPresent: true,
        errorUndefined: true,
      });
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
        0,
      );
    } finally {
      db.close();
    }
  } else {
    assert.ok(counts.length > 0, 'actual original material SDK must run');
    assert.ok(
      counts.every((value) => value === 1),
      'actual material SDK must own same Native P: ' + JSON.stringify(counts),
    );
  }
  assert.equal(effects, 0);
  return {
    actualMain: true,
    actualBroker: true,
    actualHostIdentity: identity.hostId,
    opaqueAcceptedSource: true,
    nativeConsumedOnce: true,
    modelEffects: effects,
    notProductNQualification: true,
    componentOnly: true,
    wholeDomainKnown: false,
    ownProcesses,
  };
}
run().then(
  async (facts) => {
    for (let i = cleanup.length - 1; i >= 0; i--) {
      fs.writeFileSync(
        path.join(domain, 'cleanup-phase.json'),
        JSON.stringify({ index: i }),
      );
      await cleanup[i]();
    }
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
