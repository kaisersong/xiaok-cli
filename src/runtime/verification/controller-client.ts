import {captureApplicationData} from './application-value-data.js';
import {METADATA_CAPACITY_METHODS,type AuthenticatedMetadataCapacityTransport} from './metadata-capacity-protocol.js';
import {parseMaterialPrepareRequest,parseMaterialRequestQuery,parseMaterialRequestObservation,parseMaterialPrepareResult} from './material-request.js';
import {parseVerificationOperationPrepareRequest,parseVerificationOperationRequestQuery,parseVerificationOperationRetireRequest,parseVerificationOperationRequestObservation} from './verification-operation-request.js';
import {parseVerificationObligationQuery,parseVerificationObligationObservation} from './verification-obligation-observation.js';
import {APPLICATION_METHODS,type AuthenticatedApplicationTransport} from './application-transport.js';
import {ARCHIVE_METHODS,type AuthenticatedArchiveTransport} from './archive-transport.js';
import { createHash, createPublicKey, randomBytes, verify, type KeyObject } from 'node:crypto';
import { readFileSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { canonicalVerificationJson } from './protocol.js';
import { callControllerIpc } from './controller-ipc.js';
import { assertRootProtectedFile, assertRootProtectedExecutable } from './installed-identity.js';
import { parseDeploymentPackageInventory, verifyDeploymentPackage } from './deployment-package.js';
import { parseInstalledDeploymentManifest } from './deployment-manifest.js';
import { COMPLETION_METHODS, type AuthenticatedCompletionTransport } from './completion-transport.js';
import { WORKER_POLICY_SHA256 } from '../isolated-execution/docker-request.js';
import type { ValidationMaterialAuthorizationClient, PreparedValidationMaterials, PrivateMaterialHandle } from './product-material-authorization.js';
import type { HostIssuedMountPlan, IsolatedExecutionPort, IsolatedExecutionResult } from '../isolated-execution/execution-port.js';
import type { PhysicalQuiescenceReceipt, QuiescenceExpectation } from '../isolated-execution/physical-quiescence.js';

export interface QualifiedExecutionFacts {
  authorityId: string; serviceEpoch: string; qualificationId: string;
  engineBinding: { engineId: string; incarnation: string };
  deploymentPackageHash: string; isolationPolicyHash: string;
  clock: { domainId: string; qualificationEpoch: number; evidenceHash: string };
  evidenceHashes: { osIdentity: string; engineInspection: string; escapeSuite: string };
  /** Wall-derived display/preflight bound only; server authority uses continuous clock. */
  validUntil: number;
}

function hash(value: unknown): string { return createHash('sha256').update(canonicalVerificationJson(value)).digest('hex'); }
function exact(a: unknown, b: unknown): boolean { return canonicalVerificationJson(a) === canonicalVerificationJson(b); }
function snapshot<T>(value: T): T {
  const result = JSON.parse(canonicalVerificationJson(value));
  const freeze = (item: any) => { if (item && typeof item === 'object') { Object.values(item).forEach(freeze); Object.freeze(item); } };
  freeze(result); return result;
}
function object(value: unknown, keys: string[]): asserts value is Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== keys.sort().join(',')) throw Error('controller_response_shape');
}
function handle(value: unknown): asserts value is PrivateMaterialHandle {
  object(value, ['id', 'secret']);
  if (typeof value.id !== 'string' || !value.id.length || value.id.length > 160 || typeof value.secret !== 'string' || value.secret.length < 32 || value.secret.length > 4096) throw Error('controller_handle');
}
function expectation(value: unknown): asserts value is QuiescenceExpectation {
  object(value, ['sessionIdentity', 'compoundOperationId', 'validationInvocationId', 'executionIdentity', 'scopeDigest']);
  for (const key of ['sessionIdentity', 'compoundOperationId', 'validationInvocationId', 'executionIdentity']) if (typeof value[key] !== 'string' || !value[key].length || Buffer.byteLength(value[key]) > 160) throw Error('controller_execution_identity');
  if (!/^[a-f0-9]{64}$/.test(value.scopeDigest)) throw Error('controller_execution_identity');
}
/** Signed protocol only. Production must use the fixed installed-manifest factory,
 * never accept a model-supplied key/socket or treat fixture signatures as OS qualification. */
export function createAuthenticatedControllerClient(options: {
  authorityId: string; publicKey: KeyObject;
  deploymentPackageHash?: string; isolationPolicyHash?: string;
  roundTrip(bytes: Buffer, signal?: AbortSignal): Promise<Buffer>;
  /** Real separate-process IPC; synchronous freshness check before a local P2 mutation boundary. */
  roundTripSync(bytes: Buffer): Buffer;
}): Readonly<{ metadataCapacityTransport:AuthenticatedMetadataCapacityTransport; materialRequestTransport:Readonly<{call(method:'materials.prepareRequest'|'materials.lookupRequest'|'materials.retireRequest',payload:unknown,signal?:AbortSignal):Promise<unknown>}>; applicationTransport: AuthenticatedApplicationTransport; maintenanceTransport: Readonly<{call(method:'maintenance.diagnose',payload:unknown,signal?:AbortSignal):Promise<unknown>}>; archiveTransport: AuthenticatedArchiveTransport; publicationTransport: Readonly<{call(method: 'publication.prepareRequest' | 'publication.lookupRequest' | 'publication.recoverRequest' | 'publication.recoverUnapproved' | 'publication.prepare' | 'publication.approve' | 'publication.reconcile' | 'publication.recoverExpired' | 'publication.observeIntentCompletion' | 'publication.observeIntentDependencies' | 'publication.observeLoopSet' | 'publication.observeOwner' | 'publication.readOwnerPayload' | 'publication.readCurrentOwnerPayload', payload: unknown, signal?: AbortSignal): Promise<unknown>}>; verificationTransport: Readonly<{call(method: 'verification.inspectObligation' | 'verification.prepareRequest' | 'verification.lookupRequest' | 'verification.retireRequest' | 'verification.recoverRequest' | 'verification.prepare' | 'verification.dispatch', payload: unknown, signal?: AbortSignal): Promise<unknown>}>; completionTransport: AuthenticatedCompletionTransport; materialAuthorization: ValidationMaterialAuthorizationClient; execution: IsolatedExecutionPort; requireQualifiedExecution(): Promise<Readonly<QualifiedExecutionFacts>>; wrapPreparedValidationInput(input: PreparedValidationMaterials): HostIssuedMountPlan; dispose(): void }> {
  const publicKey = options.publicKey.type === 'public' ? options.publicKey : createPublicKey(options.publicKey);
  if (publicKey.asymmetricKeyType !== 'ed25519' || !options.authorityId) throw Error('controller_identity');
  const authorityId = options.authorityId;
  const boundPackageHash = options.deploymentPackageHash, boundPolicyHash = options.isolationPolicyHash;
  const roundTrip = options.roundTrip, roundTripSync = options.roundTripSync;
  let serviceEpoch: string | undefined, invalidated = false;
  const lifetime = new AbortController();
  const prepared = new Map<string, PreparedValidationMaterials>();
  const executions = new Map<string, PrivateMaterialHandle>();
  const plans = new WeakMap<object, PreparedValidationMaterials>();
  const receipts = new WeakMap<object, { expected: QuiescenceExpectation; engineId: string; engineEpoch: string; serviceEpoch: string }>();
  function request(method: string, payload: unknown, requestTicket: string | null = null) {
    if (invalidated) throw Error('controller_instance_changed');
    const body = snapshot({ version: 1, domain: 'xiaok.controller.request.v1', authorityId, serviceEpoch: method === 'controller.identity' ? null : serviceEpoch ?? null, requestTicket, nonce: randomBytes(32).toString('hex'), method, requestHash: hash(payload), payload });
    const bytes = Buffer.from(canonicalVerificationJson(body)); if (bytes.length > 1024 ** 2) throw Error('controller_request_limit');
    return { body, bytes };
  }
  function response(bytes: Buffer, expected: ReturnType<typeof request>['body']): any {
    if (invalidated) throw Error('controller_instance_changed');
    if (bytes.length > 1024 ** 2) throw Error('controller_response_limit');
    const envelope = JSON.parse(bytes.toString('utf8')); object(envelope, ['payload', 'signature']);
    const payload = envelope.payload; object(payload, ['domain', 'authorityId', 'serviceEpoch', 'nonce', 'method', 'requestHash', 'result']);
    if (payload.domain !== 'xiaok.controller.response.v1' || payload.authorityId !== authorityId || payload.nonce !== expected.nonce || payload.method !== expected.method || payload.requestHash !== expected.requestHash || typeof payload.serviceEpoch !== 'string' || !payload.serviceEpoch.length || payload.serviceEpoch.length > 160) throw Error('controller_response_binding');
    if (typeof envelope.signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature) || !verify(null, Buffer.from(canonicalVerificationJson(payload)), publicKey, Buffer.from(envelope.signature, 'base64'))) throw Error('controller_response_signature');
    if (serviceEpoch && serviceEpoch !== payload.serviceEpoch) { invalidated = true; prepared.clear(); executions.clear(); lifetime.abort(); throw Error('controller_instance_changed'); }
    serviceEpoch = payload.serviceEpoch;
    if (payload.result && typeof payload.result === 'object' && Object.hasOwn(payload.result, 'error')) throw Error('controller_operation_rejected');
    return snapshot(payload.result);
  }
  async function call(method: string, payload: unknown, signal?: AbortSignal) {
    const active = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;
    active.throwIfAborted();
    const hello = request('controller.identity', {});
    const identity = response(await roundTrip(hello.bytes, active), hello.body); active.throwIfAborted();
    if (typeof identity.requestTicket !== 'string' || !/^[a-f0-9]{64}$/.test(identity.requestTicket)) throw Error('controller_identity_ticket');
    const outgoing = request(method, payload, identity.requestTicket);
    const reply = await roundTrip(outgoing.bytes, active); active.throwIfAborted();
    return response(reply, outgoing.body);
  }
  function callSync(method: string, payload: unknown) {
    const hello = request('controller.identity', {}), identity = response(roundTripSync(hello.bytes), hello.body);
    if (typeof identity.requestTicket !== 'string' || !/^[a-f0-9]{64}$/.test(identity.requestTicket)) throw Error('controller_identity_ticket');
    const outgoing = request(method, payload, identity.requestTicket); return response(roundTripSync(outgoing.bytes), outgoing.body);
  }

  function physical(result: any, expected: QuiescenceExpectation): PhysicalQuiescenceReceipt {
    object(result, ['expected', 'engineId', 'engineEpoch', 'quiescent']);
    if (result.quiescent !== true || !exact(result.expected, expected) || typeof result.engineId !== 'string' || !result.engineId || typeof result.engineEpoch !== 'string' || !result.engineEpoch) throw Error('controller_quiescence_unknown');
    const receipt = Object.freeze({}) as PhysicalQuiescenceReceipt;
    receipts.set(receipt, { expected: snapshot(expected), engineId: result.engineId, engineEpoch: result.engineEpoch, serviceEpoch: serviceEpoch! });
    return receipt;
  }
  const materialRequestTransport=Object.freeze({async call(method:'materials.prepareRequest'|'materials.lookupRequest'|'materials.retireRequest',payload:unknown,signal?:AbortSignal):Promise<unknown>{
    if(method==='materials.prepareRequest'){
      const request=parseMaterialPrepareRequest(payload),result=parseMaterialPrepareResult(await call(method,request,signal));
      if(result.requestId!==request.requestId)throw Error('material_request_binding');
      if(result.created){const {scopeDigest,engineBinding,...review}=result.canonicalReview;const draft={...review,materials:review.materials.map(({path,byteLimit})=>({path,byteLimit}))};if(!exact(draft,request.draft))throw Error('material_request_binding');}
      if(result.handoff&&!exact(result.handoff.invocation,request.draft.invocation))throw Error('material_request_binding');return result;
    }
    if(method!=='materials.lookupRequest'&&method!=='materials.retireRequest')throw Error('controller_material_request_method');
    const query=parseMaterialRequestQuery(payload,method==='materials.retireRequest'),result=parseMaterialRequestObservation(await call(method,query,signal));
    if(result.requestId!==query.requestId||result.handoff&&!exact(result.handoff.invocation,query.invocation))throw Error('material_request_binding');
    if(method==='materials.retireRequest'&&!['retired','not_prepared'].includes(result.state))throw Error('material_request_state');return result;
  }});
  const materialAuthorization = Object.freeze<ValidationMaterialAuthorizationClient>({
    async prepareMaterialAuthorizationRequest({requestId,draft},{signal}) { return parseMaterialPrepareResult(await materialRequestTransport.call('materials.prepareRequest',{requestId,requestSource:'user',draft},signal)); },
    async prepareMaterialAuthorization(draft, { signal }) { return call('materials.prepare', draft, signal); },
    async authorizeMaterialChallenge(challengeId, { signal }) { const result = await call('materials.authorize', { challengeId }, signal); handle(result); return result; },
    async prepareValidationInput(input, { signal }) {
      const result = await call('materials.stage', input, signal);
      object(result, ['mountPlanHandle', 'command', 'scopeDigest', 'invocation']); handle(result.mountPlanHandle);
      if (!exact(result.invocation, input.invocation) || !/^[a-f0-9]{64}$/.test(result.scopeDigest)) throw Error('controller_material_binding');
      if (prepared.size >= 4096) throw Error('controller_client_plan_limit');
      prepared.set(hash(result.mountPlanHandle), result as PreparedValidationMaterials); return result as PreparedValidationMaterials;
    },
  });
  const execution = Object.freeze<IsolatedExecutionPort>({
    async reserveExecution(input) {
      const { materializedInput, sessionIdentity, compoundOperationId, validationInvocationId, command, scopeDigest, signal } = input;
      const plan = plans.get(materializedInput); if (!plan || invalidated) throw Error('controller_mount_plan_unknown');
      // Consume before inspecting caller-owned tuples: even a Proxy trap can reenter.
      plans.delete(materializedInput);
      const invocation = { sessionIdentity, compoundOperationId, validationInvocationId };
      if (!exact(invocation, plan.invocation) || !exact(command, plan.command) || scopeDigest !== plan.scopeDigest) throw Error('controller_material_binding');
      const result = await call('execution.reserve', { mountPlanHandle: plan.mountPlanHandle, invocation, command: plan.command, scopeDigest: plan.scopeDigest }, signal);
      object(result, ['executionIdentity', 'expected', 'executionHandle']); expectation(result.expected); handle(result.executionHandle);
      if (result.executionIdentity !== result.expected.executionIdentity || result.expected.scopeDigest !== plan.scopeDigest || !exact({ sessionIdentity: result.expected.sessionIdentity, compoundOperationId: result.expected.compoundOperationId, validationInvocationId: result.expected.validationInvocationId }, invocation)) throw Error('controller_execution_identity');
      if (executions.size >= 4096 && !executions.has(hash(result.expected))) throw Error('controller_client_execution_limit');
      executions.set(hash(result.expected), result.executionHandle);
      return Object.freeze({ executionIdentity: result.executionIdentity as string, expected: result.expected as QuiescenceExpectation });
    },
    async dispatchExecution(expected, input = {}) {
      expectation(expected); const frozen = snapshot(expected);
      const executionHandle = executions.get(hash(frozen)); if (!executionHandle) throw Error('controller_execution_handle_missing');
      executions.delete(hash(frozen)); // Consume before I/O and user output callbacks, including timeout/error.
      const result = await call('execution.dispatch', { expected: frozen, executionHandle }, input.signal);
      object(result, ['expected', 'exitCode', 'termination', 'outputTruncated', 'stdout', 'stderr', 'physical']);
      if (!exact(result.expected, frozen) || !['terminal', 'unknown'].includes(result.termination) || (result.exitCode !== null && !Number.isSafeInteger(result.exitCode)) || typeof result.outputTruncated !== 'boolean' || typeof result.stdout !== 'string' || typeof result.stderr !== 'string' || Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) > 1024 ** 2) throw Error('controller_execution_result');
      input.onStdout?.(result.stdout); input.onStderr?.(result.stderr);
      const receipt = result.termination === 'terminal' ? physical(result.physical, frozen) : undefined;
      return Object.freeze({ exitCode: result.exitCode, termination: result.termination, outputTruncated: result.outputTruncated, ...(receipt ? { receipt } : {}) }) as IsolatedExecutionResult;
    },
    async inspectExecution(expected) { expectation(expected); const frozen = snapshot(expected); return physical(await call('execution.quiescence', { expected: frozen }), frozen); },
    assertQuiescent(receipt, expected) {
      expectation(expected); const record = receipts.get(receipt);
      if (invalidated || !record || record.serviceEpoch !== serviceEpoch || !exact(record.expected, expected)) throw Error('controller_quiescence_unknown');
      // Do not let a disconnected caller's stale epoch serve as current engine authority.
      const result = callSync('execution.quiescence', { expected: record.expected });
      if (result.engineId !== record.engineId || result.engineEpoch !== record.engineEpoch) throw Error('controller_quiescence_epoch');
      physical(result, expected);
    },
  });
  const completionTransport = Object.freeze<AuthenticatedCompletionTransport>({
    call(method, payload, signal) { if (!COMPLETION_METHODS.includes(method)) return Promise.reject(Error('controller_completion_method')); return call(method, payload, signal); },
    callSync(method, payload) { if (method !== 'completion.inspect' && method !== 'completion.open-owner') throw Error('controller_completion_method'); return callSync(method, payload); },
  });
  const verificationTransport=Object.freeze({async call(method:'verification.inspectObligation'|'verification.prepareRequest'|'verification.lookupRequest'|'verification.retireRequest'|'verification.recoverRequest'|'verification.prepare'|'verification.dispatch',payload:unknown,signal?:AbortSignal):Promise<unknown>{
    if(method==='verification.inspectObligation'){
      const query=parseVerificationObligationQuery(payload),result=parseVerificationObligationObservation(await call(method,query,signal));
      if(result.obligationId!==query.obligationId)throw Error('verification_observation_binding');return result;
    }
    if(method==='verification.prepareRequest'||method==='verification.lookupRequest'||method==='verification.retireRequest'||method==='verification.recoverRequest'){
      const query=method==='verification.prepareRequest'?parseVerificationOperationPrepareRequest(payload):(method==='verification.retireRequest'||method==='verification.recoverRequest')?parseVerificationOperationRetireRequest(payload):parseVerificationOperationRequestQuery(payload);
      const raw=await call(method,query,signal);
      const observed=(value:unknown)=>{const result=parseVerificationOperationRequestObservation(value);if(result.requestId!==query.requestId||result.obligationId!==query.obligationId||!exact(result.invocation,query.invocation))throw Error('verification_request_changed');return result;};
      if(method!=='verification.prepareRequest')return observed(raw);
      if(raw?.created===false){object(raw,['created','observation']);const observation=observed(raw.observation);if(!['preparing','operation'].includes(observation.state))throw Error('verification_request_state');return Object.freeze({created:false,observation});}
      object(raw,['created','operationHandle','attemptId','attemptEpoch','sourceRunId','runNonce']);handle(raw.operationHandle);
      if(raw.created!==true||!('expectedAttemptEpoch' in query)||typeof query.expectedAttemptEpoch!=='number'||!Number.isSafeInteger(raw.attemptEpoch)||raw.attemptEpoch!==query.expectedAttemptEpoch+1||[raw.attemptId,raw.sourceRunId,raw.runNonce].some(value=>typeof value!=='string'||!value||Buffer.byteLength(value)>160||/[\x00-\x1f\x7f]/.test(value)))throw Error('verification_request_response');return snapshot(raw);
    }
    if(method!=='verification.prepare'&&method!=='verification.dispatch')throw Error('controller_verification_method');return call(method,payload,signal);
  }});
  const publicationTransport=Object.freeze({call(method:'publication.prepareRequest' | 'publication.lookupRequest' | 'publication.recoverRequest' | 'publication.recoverUnapproved' | 'publication.prepare'|'publication.approve'|'publication.reconcile'|'publication.recoverExpired'|'publication.observeIntentCompletion' | 'publication.observeIntentDependencies' | 'publication.observeLoopSet' | 'publication.observeOwner'|'publication.readOwnerPayload'|'publication.readCurrentOwnerPayload',payload:unknown,signal?:AbortSignal):Promise<unknown>{if(!['publication.prepareRequest','publication.lookupRequest','publication.recoverRequest','publication.recoverUnapproved','publication.prepare','publication.approve','publication.reconcile','publication.recoverExpired','publication.observeIntentCompletion','publication.observeIntentDependencies','publication.observeLoopSet','publication.observeOwner','publication.readOwnerPayload','publication.readCurrentOwnerPayload'].includes(method))return Promise.reject(Error('controller_publication_method'));return call(method,payload,signal);}});
  const metadataCapacityTransport=Object.freeze<AuthenticatedMetadataCapacityTransport>({call(method,payload,signal){if(!METADATA_CAPACITY_METHODS.includes(method))return Promise.reject(Error('controller_metadata_method'));return call(method,payload,signal);},callSync(method,payload){if(!METADATA_CAPACITY_METHODS.includes(method))throw Error('controller_metadata_method');return callSync(method,payload);}});
  const applicationTransport=Object.freeze<AuthenticatedApplicationTransport>({call(method,payload,signal){if(!APPLICATION_METHODS.includes(method))return Promise.reject(Error('controller_application_method'));if(signal?.aborted)return Promise.reject(signal.reason);if(lifetime.signal.aborted)return Promise.reject(lifetime.signal.reason);let original:unknown;try{original=captureApplicationData(payload,{maximumBytes:1048576,maximumNodes:1048576,invalid:'controller_application_data',limit:'controller_request_limit'});}catch(error){return Promise.reject(error);}return call(method,original,signal);}});
  const maintenanceTransport=Object.freeze({call(method:'maintenance.diagnose',payload:unknown,signal?:AbortSignal):Promise<unknown>{if(method!=='maintenance.diagnose')return Promise.reject(Error('controller_maintenance_method'));return call(method,payload,signal);}});
  const archiveTransport=Object.freeze<AuthenticatedArchiveTransport>({call(method,payload,signal){if(!ARCHIVE_METHODS.includes(method))return Promise.reject(Error('controller_archive_method'));return call(method,payload,signal);}});
  return Object.freeze({ metadataCapacityTransport, materialRequestTransport, applicationTransport, maintenanceTransport, archiveTransport, completionTransport, verificationTransport, publicationTransport, materialAuthorization, execution,
    async requireQualifiedExecution(): Promise<Readonly<QualifiedExecutionFacts>> {
      const facts = await call('controller.qualification', {});
      object(facts, ['authorityId', 'serviceEpoch', 'qualificationId', 'engineBinding', 'deploymentPackageHash', 'isolationPolicyHash', 'clock', 'evidenceHashes', 'validUntil']);
      object(facts.engineBinding, ['engineId', 'incarnation']); object(facts.clock, ['domainId', 'qualificationEpoch', 'evidenceHash']); object(facts.evidenceHashes, ['osIdentity', 'engineInspection', 'escapeSuite']);
      if (facts.authorityId !== authorityId || facts.serviceEpoch !== serviceEpoch || !Number.isSafeInteger(facts.validUntil) || facts.validUntil <= Date.now() || !Number.isSafeInteger(facts.clock.qualificationEpoch) || facts.clock.qualificationEpoch < 0) throw Error('controller_qualification_invalid');
      if ((boundPackageHash && facts.deploymentPackageHash !== boundPackageHash) || (boundPolicyHash && facts.isolationPolicyHash !== boundPolicyHash)) throw Error('controller_qualification_binding');
      for (const field of [facts.qualificationId, facts.engineBinding.engineId, facts.engineBinding.incarnation, facts.clock.domainId]) if (typeof field !== 'string' || !field.length || field.length > 160) throw Error('controller_qualification_invalid');
      for (const field of [facts.deploymentPackageHash, facts.isolationPolicyHash, facts.clock.evidenceHash, ...Object.values(facts.evidenceHashes)]) if (typeof field !== 'string' || !/^[a-f0-9]{64}$/.test(field)) throw Error('controller_qualification_invalid');
      return facts as QualifiedExecutionFacts;
    },
    dispose() { invalidated = true; prepared.clear(); executions.clear(); lifetime.abort(); },
    wrapPreparedValidationInput(input: PreparedValidationMaterials): HostIssuedMountPlan {
      const key = hash(input.mountPlanHandle), record = prepared.get(key);
      if (invalidated || !record) throw Error('controller_mount_plan_unknown');
      prepared.delete(key);
      if (!exact(record, input)) throw Error('controller_mount_plan_unknown');
      const plan = Object.freeze({}) as HostIssuedMountPlan; plans.set(plan, record); return plan;
    },
  });
}

/** Fixed OS installation only: no caller-supplied endpoint, key, config path or environment override. */
export function createInstalledVerificationClient(): ReturnType<typeof createAuthenticatedControllerClient> {
  if (!['darwin', 'linux'].includes(process.platform)) throw Error('controller_installed_platform_unavailable');
  const base = process.platform === 'darwin' ? '/Library/Application Support/xiaok-verification' : '/var/lib/xiaok-verification';
  const manifestPath = join(base, 'deployment.json'); assertRootProtectedFile(manifestPath);
  if (lstatSync(manifestPath).size > 65536) throw Error('controller_deployment_manifest');
  const manifest = parseInstalledDeploymentManifest(JSON.parse(readFileSync(manifestPath, 'utf8')));
  if (manifest.serviceUid === process.getuid?.()) throw Error('controller_interactive_identity');
  const releaseRoot = join(base, 'releases', manifest.packageHash);
  const inventoryPath = join(base, 'releases', manifest.packageHash + '.json'); assertRootProtectedFile(inventoryPath);
  if (lstatSync(inventoryPath).size > 8 * 1024 ** 2) throw Error('controller_deployment_inventory');
  const inventory = parseDeploymentPackageInventory(JSON.parse(readFileSync(inventoryPath, 'utf8')));
  if (inventory.packageHash !== manifest.packageHash) throw Error('controller_deployment_inventory');
  verifyDeploymentPackage(releaseRoot, inventory);
  for (const file of inventory.files) assertRootProtectedFile(join(releaseRoot, ...file.path.split('/')));
  const node = join(releaseRoot, 'bin', 'node'), helper = join(releaseRoot, 'app', 'controller-transport.cjs');
  assertRootProtectedExecutable(node); assertRootProtectedFile(helper);
  const socketPath = join(base, 'public', 'controller.sock');
  return createAuthenticatedControllerClient({ authorityId: manifest.authorityId, publicKey: createPublicKey(manifest.publicKeyPem), deploymentPackageHash: manifest.packageHash, isolationPolicyHash: WORKER_POLICY_SHA256,
    roundTrip(bytes, signal) { return callControllerIpc(socketPath, bytes, { timeoutMs: 300000, signal }); },
    roundTripSync(bytes) {
      const result = spawnSync(node, [helper], { cwd: releaseRoot, env: { PATH: '/usr/bin:/bin', ELECTRON_RUN_AS_NODE: '1' },
        input: JSON.stringify({ socketPath, body: bytes.toString('base64') }), timeout: 7500, maxBuffer: 1024 ** 2 + 4096 });
      if (result.error || result.status !== 0 || result.signal || !Buffer.isBuffer(result.stdout)) throw Error('controller_transport_unknown');
      return result.stdout;
    },
  });
}
