import {beforeEach, expect, it, vi} from 'vitest';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import type {TaskSnapshot} from '../../../src/runtime/task-host/types.js';
import {canonicalVerificationJson as json} from '../../../src/runtime/verification/protocol.js';

// Component routing fixture only: these fixed reader outputs are data, never a
// Native/Source installation, completion capability, or production qualification.
const wire = vi.hoisted(() => ({
  routes: new Map<string, any>(),
  applications: new Map<string, any>(),
  publications: new Map<string, any>(),
  current: undefined as any,
  getter: undefined as (() => void) | undefined,
  reads: 0,
  getterReads: 0,
}));
vi.mock('../../../src/runtime/verification/installed-owner-state.js', () => ({
  readInstalledCurrentOwner: (owner: any) => wire.routes.get(owner.ownerId),
}));
vi.mock('../../../src/runtime/verification/installed-loop-application.js', () => ({
  createInstalledLoopApplicationClient: (binding: any) => ({
    async inspect() {
      return {state: 'active', current: wire.applications.get(binding.candidateId), pendingTransitionId: null, pendingTarget: null};
    },
    dispose() {},
  }),
}));
vi.mock('../../../src/runtime/verification/installed-completion-publication.js', () => ({
  createInstalledCompletionPublisher: (owner: any) => ({
    async prepareRequest() { wire.current = wire.publications.get(owner.ownerId); return wire.current.challenge; },
    async approve() { return wire.current.observation; },
    dispose() {},
  }),
}));
vi.mock('../../../src/runtime/loop/published-candidate.js', async original => ({
  ...await original<typeof import('../../../src/runtime/loop/published-candidate.js')>(),
  async readCurrentLoopPublishedCandidate(binding: any) {
    wire.reads++;
    const publication = [...wire.publications.values()].find(row => row.binding.candidateId === binding.candidateId);
    const {owner, businessRevision, operationId, fullTupleHash} = publication.observation;
    const application = wire.applications.get(binding.candidateId);
    const bytes = Buffer.from(json({version: 1, owner, dependencies: [], application, evaluations: []}));
    const payloadHash = createHash('sha256').update(bytes).digest('hex');
    // Match the real fixed reader's exact eight own fields and defensive getter.
    return Object.freeze({binding, application, owner, businessRevision, operationId, fullTupleHash, payloadHash,
      get bytes() { wire.getterReads++; wire.getter?.(); return Buffer.from(bytes); },
    });
  },
}));
vi.mock('../../../src/runtime/loop/published-set.js', async original => ({
  ...await original<typeof import('../../../src/runtime/loop/published-set.js')>(),
  async readCurrentLoopPublicationSet(bindings: any[]) {
    return {
      clock: {domainId: 'clock', qualificationEpoch: 1, lowerBound: 1000, upperBound: 1001, evidenceHash: 'a'.repeat(64)},
      publications: bindings.map(binding => {
        const publication = [...wire.publications.values()].find(row => row.binding.candidateId === binding.candidateId);
        const {owner, businessRevision, operationId, fullTupleHash} = publication.observation;
        return {owner, businessRevision, operationId, fullTupleHash, application: wire.applications.get(binding.candidateId)};
      }),
    };
  },
}));

import {LoopStore} from '../../electron/loop-store.js';
import {CompletionEvidenceStore} from '../../electron/completion-evidence-store.js';
import {createLoopPublicationWorkflow} from '../../electron/loop-publication-workflow.js';
import {createLoopBusinessPublicationHost} from '../../electron/loop-business-publication-host.js';
import {createLoopOutputService} from '../../electron/loop-output-service.js';
import {DesktopShutdownGate} from '../../electron/shutdown-aware-ipc-main.js';
import {loopHostSubjectOwner} from '../../../src/runtime/verification/loop-host-subject.js';
import {readLoopArtifactPage} from '../../electron/loop-published-artifacts.js';
import {readyLoopNative} from '../support/loop-publication-fixture.js';

beforeEach(() => {
  wire.routes.clear(); wire.applications.clear(); wire.publications.clear();
  wire.getter = undefined; wire.reads = 0; wire.getterReads = 0;
});

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'loop-output-payload-'));
  const store = new LoopStore(join(root, 'loop.sqlite'));
  const evidence = new CompletionEvidenceStore(join(root, 'loop.sqlite'));
  const loopId = 'template';
  store.createUserLoopTemplate({loopId, kind: 'task_completion', title: 'Original', prompt: 'Original task', now: 1});
  const definition = {version: 1, obligations: [{obligationId: 'original', predicateId: 'content', predicateVersion: '1',
    semantics: 'current-subject', recipe: {kind: 'artifact-content', checks: [{id: 'check', path: 'report', sha256: 'a'.repeat(64), structure: 'bytes'}]}}]};
  store.saveLoopPublicationConfiguration({loopId, expectedRevision: null, requestSource: 'user', now: 2,
    configuration: {version: 1, contract: {kind: 'user-template'}, verificationDefinitions: {run: definition, stages: {execute: definition, verify: definition}}}});
  const begin = store.beginLoopRun(loopId, {kind: 'manual'}, 3, 1000, {requestSource: 'user'});
  if (begin.status !== 'started') throw Error('fixture');
  const snapshot: TaskSnapshot = {taskId: 'actual-task', sessionId: 'session', status: 'completed', prompt: 'Original task', materials: [], events: [], createdAt: 4, updatedAt: 8};
  const producer = store.openLoopPublicationProducer(begin.run);
  const execute = store.startLoopStage(begin.run.id, loopId, 'execute', 4, {taskId: snapshot.taskId});
  producer.recordTemplateExecution({executeStageId: execute.id, taskSnapshot: snapshot, summary: 'Execution', evidenceIds: [], artifacts: [], now: 9});
  const verify = store.startLoopStage(begin.run.id, loopId, 'verify', 10, {taskId: snapshot.taskId});
  producer.recordTemplateTerminal({executeStageId: execute.id, verifyStageId: verify.id, summary: 'Verified', evidenceIds: [], artifacts: [], now: 11});
  const workflow = createLoopPublicationWorkflow({store, assertAdmission() {}, now: () => 40});
  try {
    for (const candidate of store.recoverLoopPublicationCandidates({runId: begin.run.id, requestSource: 'user'})) {
      const native = readyLoopNative({store, candidate});
      const owner = {profileId: 'profile', ...loopHostSubjectOwner(candidate.binding.subject)};
      const application = {binding: candidate.binding, bindingHash: candidate.bindingHash, revision: 1};
      const challenge = {challengeId: 'challenge-' + candidate.candidateId, owner, fullTupleHash: 'a'.repeat(64), deadline: {domainId: 'clock', qualificationEpoch: 1, notBefore: 1000, validUntil: 2000}};
      const observation = {owner, status: 'committed', operationId: 'operation-' + candidate.candidateId, fullTupleHash: 'a'.repeat(64), businessRevision: 1, currentVerification: 'valid'};
      wire.routes.set(owner.ownerId, {kind: 'protected-unregistered', authorityId: 'authority', owner});
      wire.applications.set(candidate.candidateId, application);
      wire.publications.set(owner.ownerId, {binding: candidate.binding, challenge, observation});
      await workflow.start({nativeAttemptId: native.attemptId, expectedLatestAttemptId: null, requestSource: 'user'});
    }
  } finally { await workflow.close(); }
  const taskPort = {async recoverTask() { return snapshot; }};
  const host = createLoopBusinessPublicationHost({store, assertAdmission() {}, now: () => 100, taskPort});
  await host.project({runId: begin.run.id, requestSource: 'user'});
  const gate = new DesktopShutdownGate();
  const service = createLoopOutputService({store, evidenceStore: evidence, gate, captureAdmission: () => () => {}, taskPort, openPath: async () => ''});
  const action = {runId: begin.run.id, requestSource: 'user' as const};
  async function close() {
    let failed = false, first: unknown;
    for (const operation of [() => service.close(), () => host.close(), () => evidence.close(), () => store.close()]) {
      try { await operation(); } catch (error) { if (!failed) { failed = true; first = error; } }
    }
    if (failed) throw first;
    rmSync(root, {recursive: true, force: true});
  }
  return {host, service, gate, action, loopId, close};
}

it('projects the fixed reader candidate into exact payload data before the actual protected output decoder', async () => {
  const f = await fixture();
  try {
    const output = await f.host.readUserTemplateOutput(f.action);
    const descriptors = Object.getOwnPropertyDescriptors(output.payload);
    expect(Reflect.ownKeys(descriptors).sort()).toEqual(['businessRevision', 'bytes', 'fullTupleHash', 'operationId', 'owner', 'payloadHash']);
    expect(Object.values(descriptors).every(descriptor => Object.hasOwn(descriptor, 'value'))).toBe(true);
    expect(Object.isFrozen(output.payload)).toBe(true);
    expect(readLoopArtifactPage(output.binding, output.payload, {offset: 0, identity: null})).toMatchObject({total: 0, items: []});
    output.payload.bytes.fill(0);
    const next = await f.host.readUserTemplateOutput(f.action);
    expect(readLoopArtifactPage(next.binding, next.payload, {offset: 0, identity: null}).total).toBe(0);
    await expect(f.service.listPublishedArtifacts({loopId: f.loopId, requestSource: 'user', page: {offset: 0, identity: null}})).resolves.toMatchObject({total: 0, items: []});
    expect(f.gate.outstanding).toBe(0);
  } finally { await f.close(); }
});

it('rechecks the original route after obtaining the fixed reader bytes', async () => {
  const f = await fixture();
  try {
    wire.getter = () => wire.routes.set(wire.publications.values().next().value.observation.owner.ownerId, {kind: 'ordinary'});
    await expect(f.host.readUserTemplateOutput(f.action)).rejects.toThrow('loop_projection_changed');
  } finally { await f.close(); }
});

it.each([Error('original bytes failure'), undefined])('preserves the exact fixed reader bytes failure, including undefined: %s', async original => {
  const f = await fixture();
  try {
    wire.getter = () => { throw original; };
    let rejected = false, first: unknown;
    try { await f.host.readUserTemplateOutput(f.action); } catch (error) { rejected = true; first = error; }
    expect(rejected).toBe(true); expect(first).toBe(original);
  } finally { await f.close(); }
});

it.each(['agent', 'scheduler'] as const)('rejects %s before fixed reader bytes access', async requestSource => {
  const f = await fixture();
  try {
    wire.reads = 0; wire.getterReads = 0;
    await expect(f.host.readUserTemplateOutput({...f.action, requestSource})).rejects.toThrow('loop_output_source');
    expect(wire.reads).toBe(0); expect(wire.getterReads).toBe(0);
  } finally { await f.close(); }
});
