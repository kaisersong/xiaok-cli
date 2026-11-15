import {describe, it, expect} from 'vitest';
import {generateKeyPairSync, createHash} from 'node:crypto';
import {mkdtempSync, rmSync} from 'node:fs';
import {createServer, type Socket} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {VerificationReceiverStore} from '../../../src/runtime/verification/receiver-store.js';
import {startReceiverService} from '../../../src/runtime/verification/receiver-service.js';
import {createReceiverTransport} from '../../../src/runtime/verification/receiver-transport.js';
import {createReceiverReplyVerifier} from '../../../src/runtime/verification/receiver-authentication.js';
import {createReceiverUploadVerifier} from '../../../src/runtime/verification/receiver-upload-authentication.js';
import {startControllerIpc, callControllerIpc} from '../../../src/runtime/verification/controller-ipc.js';
import {canonicalVerificationJson as json, parseVerificationTuple, hashVerificationTuple} from '../../../src/runtime/verification/protocol.js';

// Real sockets, clocks, SQLite and signatures. Peer/account clock leaves are
// injected contract fixtures, never installed OS or Native qualification.
const waitReal = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const elapsed = (start: bigint) => Number(process.hrtime.bigint() - start) / 1e6;
function tupleFor(payload: string) {
  const h = 'a'.repeat(64);
  return parseVerificationTuple({schemaVersion: 1, profileId: 'profile', ownerKind: 'task', ownerId: 'task1',
    migrationEpoch: 1, expectedBusinessRevision: 2, obligationSetRevision: 3, obligationSetHash: h,
    obligations: [{obligationId: 'check1', predicateId: 'original', predicateVersion: '1', definitionHash: h,
      activeAttemptId: 'attempt1', attemptEpoch: 1, sourceRunId: 'run1', runNonce: 'nonce1', subjectId: 'subject1',
      contentRoot: h, coreId: 'core1', coreHash: h, coreFinalRevision: 1, proofId: 'proof1', proofHash: h,
      proofRevision: 1, requiredScopeId: 'scope1', scopeRevision: 1, invalidationEpoch: 1}],
    operationId: 'operation1', immutablePayloadHash: createHash('sha256').update(payload).digest('hex'),
    receiverId: 'receiver1', receiverProtocolVersion: 1, receiverInstanceEpoch: 1,
    reservationId: 'reservation1', nonce: 'nonce2', notBefore: 1000, validUntil: 2000,
    clockDomainId: 'clock1', clockQualificationEpoch: 1});
}
async function fixture(stageDelay = 0) {
  const root = mkdtempSync(join(tmpdir(), 'receiver-liveness-'));
  const socketPath = join(root, 'r.sock'), keys = generateKeyPairSync('ed25519');
  const identity = {receiverId: 'receiver1', receiverInstanceEpoch: 1, keyId: 'key'};
  let stages = 0;
  class DelayedStore extends VerificationReceiverStore {
    override stage(...args: Parameters<VerificationReceiverStore['stage']>) {
      stages++;
      // Inside actual dispatch: both endpoint deadlines have already started.
      if (stages === 1 && stageDelay) waitReal(stageDelay);
      return super.stage(...args);
    }
  }
  const store = new DelayedStore({root: join(root, 'state'), ...identity,
    clock: () => ({domainId: 'clock1', qualificationEpoch: 1, lowerBound: 1500, upperBound: 1500, evidenceHash: 'e'.repeat(64)})});
  const service = await startReceiverService({socketPath, controllerServiceUid: 501, identity,
    privateKey: keys.privateKey, store, assertCurrent() {},
    readPeer: () => ({uid: 501, gid: 501, auditSessionId: 1, pid: 123})});
  const verifier = createReceiverReplyVerifier({...identity, publicKey: keys.publicKey});
  const uploadVerifier = createReceiverUploadVerifier({...identity, publicKey: keys.publicKey});
  const transports: ReturnType<typeof createReceiverTransport>[] = [];
  function transportAt(path = socketPath) {
    const transport = createReceiverTransport({socketPath: path, receiverServiceUid: 700, identity,
      verifier, uploadVerifier, assertCurrent() {}, readPeer: () => ({uid: 700, gid: 700, auditSessionId: 1, pid: 234})});
    transports.push(transport);
    return transport;
  }
  const tuple = tupleFor('artifact'), fullTupleHash = hashVerificationTuple(tuple), challenge = 'c'.repeat(64);
  const request = {tuple, fullTupleHash, challenge, payload: 'artifact'};
  return {root, socketPath, store, verifier, tuple, fullTupleHash, request, transportAt,
    get stages() { return stages; },
    async close() {
      const results = await Promise.allSettled([...transports.map(transport => transport.close()), service.close()]);
      const failures = results.filter((value): value is PromiseRejectedResult => value.status === 'rejected');
      if (failures.length) throw new AggregateError(failures.map(value => value.reason), 'receiver_fixture_close_unknown');
      store.close();
      rmSync(root, {recursive: true, force: true});
      console.info('receiver-liveness-cleanup', JSON.stringify({serviceCloseJoined: true, fixtureSpawnedProcesses: 0, notNativeQualification: true}));
    }};
}
function stageFrame(f: Awaited<ReturnType<typeof fixture>>) {
  return Buffer.from(json({version: 1, domain: 'xiaok.receiver.request.v1', method: 'stage', ...f.request}));
}
async function failureOf(call: Promise<unknown>) {
  const outcome = await call.then(value => ({ok: true as const, value}), error => ({ok: false as const, error}));
  expect(outcome.ok).toBe(false);
  if (outcome.ok) throw Error('expected_receiver_failure');
  expect(outcome.error).toBeInstanceOf(Error);
  return outcome.error as Error;
}

describe.skipIf(process.platform === 'win32')('receiver real liveness contract', () => {
  it('returns a signed prepared result after 18 real seconds of finite service work', async () => {
    const f = await fixture(18000), transport = f.transportAt(), start = process.hrtime.bigint();
    try {
      const reply = await transport.call('stage', f.request);
      expect(f.verifier.read(reply.authenticated).result.status).toBe('prepared');
      expect(f.store.query(f.tuple, f.fullTupleHash)?.status).toBe('prepared');
      expect(f.stages).toBe(1);
      expect(elapsed(start)).toBeGreaterThanOrEqual(18000);
      expect(elapsed(start)).toBeLessThan(30000);
      console.info('receiver-finite-work-ms', elapsed(start));
    } finally { await f.close(); }
  }, 45000);

  it('rejects a 32-second before-send callback before any business request is written', async () => {
    const f = await fixture(), transport = f.transportAt(), start = process.hrtime.bigint();
    let returned = false;
    try {
      const error = await failureOf(transport.call('stage', f.request, undefined, () => { waitReal(32000); returned = true; }));
      expect(returned).toBe(true);
      expect(error.message).toMatch(/^controller_ipc_(timeout|closed)_unknown$/);
      expect(f.stages).toBe(0);
      expect(f.store.query(f.tuple, f.fullTupleHash)).toBeUndefined();
      expect(elapsed(start)).toBeGreaterThanOrEqual(32000);
      console.info('receiver-deadline-rejection', JSON.stringify({elapsedMs: elapsed(start), error: error.message,
        stack: error.stack, callbackReturnedAfterDeadline: true, noRollbackClaim: true}));
    } finally { await f.close(); }
  }, 45000);

  it('honors caller abort while a real peer is unresponsive and joins its actual close', async () => {
    const f = await fixture(), path = join(f.root, 'idle.sock'), sockets = new Set<Socket>();
    const closers: Promise<void>[] = [];
    let accepted!: () => void;
    const admitted = new Promise<void>(resolve => { accepted = resolve; });
    const server = createServer(socket => {
      sockets.add(socket);
      closers.push(new Promise<void>(resolve => socket.once('close', () => { sockets.delete(socket); resolve(); })));
      socket.on('error', () => {});
      socket.on('data', () => {});
      accepted();
    });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(path, resolve); });
    try {
      const transport = f.transportAt(path), abort = new AbortController(), start = process.hrtime.bigint();
      const outcome = failureOf(transport.call('stage', f.request, abort.signal));
      await admitted;
      abort.abort();
      const error = await outcome;
      expect(error.message).toBe('controller_ipc_aborted_unknown');
      await Promise.all(closers);
      expect(sockets.size).toBe(0);
      expect(elapsed(start)).toBeLessThan(10000);
      expect(f.stages).toBe(0);
    } finally {
      for (const socket of sockets) socket.destroy();
      await Promise.all(closers);
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await f.close();
    }
  }, 15000);

  it('keeps the explicit 15-second generic client bound independent of the receiver service', async () => {
    const f = await fixture(18000), start = process.hrtime.bigint();
    try {
      const error = await failureOf(callControllerIpc(f.socketPath, stageFrame(f), {timeoutMs: 15000}));
      expect(error.message).toBe('controller_ipc_timeout_unknown');
      expect(f.stages).toBe(1);
      expect(f.store.query(f.tuple, f.fullTupleHash)?.status).toBe('prepared');
      expect(elapsed(start)).toBeLessThan(30000);
      console.info('receiver-asymmetric-client', JSON.stringify({error: error.message, elapsedMs: elapsed(start),
        stack: error.stack, clientMs: 15000, preparedIsNotRollback: true}));
    } finally { await f.close(); }
  }, 45000);

  it('rejects an explicit 15-second relay server before the receiver client deadline', async () => {
    const f = await fixture(18000), relayPath = join(f.root, 'relay.sock');
    let dispatched = 0;
    // Opaque framing relay; actual service/store/signers perform all business work.
    const relay = await startControllerIpc({socketPath: relayPath, requestTimeoutMs: 15000,
      dispatch(bytes, signal) { dispatched++; return callControllerIpc(f.socketPath, bytes, {timeoutMs: 30000, signal}); }});
    const transport = f.transportAt(relayPath), start = process.hrtime.bigint();
    try {
      const error = await failureOf(transport.call('stage', f.request));
      expect(error.message).toBe('controller_ipc_closed_unknown');
      expect(dispatched).toBe(1);
      expect(f.stages).toBe(1);
      expect(f.store.query(f.tuple, f.fullTupleHash)?.status).toBe('prepared');
      expect(elapsed(start)).toBeGreaterThanOrEqual(14000);
      expect(elapsed(start)).toBeLessThan(30000);
      console.info('receiver-asymmetric-server', JSON.stringify({error: error.message, elapsedMs: elapsed(start),
        serverMs: 15000, clientNotExpired: true, preparedIsNotRollback: true}));
    } finally { await relay.close(); await f.close(); }
  }, 45000);
});
