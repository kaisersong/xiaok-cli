import {readOriginalMainDshBrokerControlSource} from './main-dsh-broker-control-source.js';
import type { IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { types } from 'node:util';
import { createIntrinsicSet } from '../../src/runtime/verification/intrinsic-async-collection.js';
import { retainSourceErrorTails } from '../../src/runtime/verification/source-error-tails.js';
import { assertStandardIpcPromise } from '../../src/runtime/verification/native-ipc-promise.js';
import {
  captureGithubReadData,
  captureGithubOpaqueRecord,
  githubReadRecord as record,
  githubReadFields as fields,
  githubReadText as text,
  githubReadId as id,
  githubReadHash as hash,
  githubReadFreeze as freeze,
  githubReadSort as sort,
  githubReadMap as map,
  githubReadTest as test,
} from '../../src/runtime/multi-agent/dsh-github-read-data.js';
import { parseGithubRepositoryCandidate } from '../../src/runtime/multi-agent/dsh-github-setup-data.js';
import { dshSourceScopeKey } from '../../src/runtime/multi-agent/dsh-source-configuration.js';
import type { DshARecord as R } from '../../src/runtime/multi-agent/dsh-admission-data.js';
import type {
  DshDesktopState,
  DshDesktopMode,
  DshDesktopSourceSelection,
  DshDesktopSetModeInput,
  DshDesktopConfigureSetupInput,
  DshDesktopConnectInput,
  DshDesktopDisconnectInput,
  DshDesktopReconcileInput,
  DshDesktopConfigureBudgetInput,
  DshDesktopPublishMandateInput,
  DshDesktopPublishEgressPolicyInput,
} from '../../src/shared/dsh-desktop.js';
import {
  readOriginalDshAdmissionPort,
  readOriginalDshUserControlPort,
  readOriginalDshDesktopState,
  readOriginalDshGithubReadAuthority,
  readOriginalDshAutoAdmissionWindow,
  readOriginalDshAutoAdmissionWindowBaseline,
} from './desktop-multi-agent-store.js';
import {
  readOriginalMainGithubSourceConnectionOwner,
  readOriginalMainGithubSourceConnectionPopulation,
  type MainGithubSourceConnectionOwner,
  type GithubSessionStatus,
} from './dsh-github-source-session.js';
import {
  readOriginalMainDshBudgetAuthoritySource,
  type MainDshBudgetAuthoritySource,
} from './main-dsh-budget-authority-source.js';
import {
  readOriginalDshBudgetPort,
  readOriginalDshBudgetObservation,
} from './harness-optimization-service.js';
import { parseDshUsdAmount } from '../../src/runtime/admission/money.js';
import { parseMandateProjection } from '../../src/runtime/admission/parse.js';
import { hashA2Data } from '../../src/runtime/admission/hash.js';
import type { MainDshBootstrapAuthority } from './main-dsh-bootstrap-authority.js';
import type {
  MainDshControlSource,
  MainDshControlFrame,
} from './main-dsh-control-source.js';
import {
  collectGithubSourceScan,
  readOriginalGithubSourceScan,
} from './dsh-github-source-scan.js';
import {
  readOriginalMainDshBusinessSource,
  readOriginalMainDshBusinessDelivery,
  type MainDshBusinessDelivery,
} from './main-dsh-business-source.js';
import {
  createRoomTurnCustody,
  type RoomTurnCustody,
} from './original-room-turn-custody.js';
import { readOriginalMainDshAdmissionCoordinator } from './main-dsh-admission-coordinator.js';
import type { IngressOwner } from './desktop-shutdown-coordinator.js';
const apply = Reflect.apply,
  descriptor = Object.getOwnPropertyDescriptor,
  own = Object.hasOwn,
  isArray = Array.isArray,
  isProxy = types.isProxy,
  isPromise = types.isPromise,
  isError = types.isNativeError,
  NativePromise = Promise,
  then = Promise.prototype.then,
  NativeError = Error,
  now = performance.now,
  safe = Number.isSafeInteger;
const dateParse = Date.parse,
  NativeDate = Date,
  dateIso = Date.prototype.toISOString,
  stringSlice = String.prototype.slice;
const setTimer = setTimeout,
  clearTimer = clearTimeout;
function fail(code: string): never {
  throw new NativeError(code);
}
function integer(raw: unknown, min = 0): number {
  if (typeof raw !== 'number' || !safe(raw) || raw < min)
    fail('DSH_DESKTOP_INPUT_INVALID');
  return raw;
}
function instant(raw: unknown): number {
  if (
    typeof raw !== 'string' ||
    !test(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/, raw)
  )
    fail('DSH_DESKTOP_INPUT_INVALID');
  const value = dateParse(raw);
  if (
    !safe(value) ||
    value < 0 ||
    apply(dateIso, new NativeDate(value), []) !==
      (raw.length === 20
        ? (apply(stringSlice, raw, [0, -1]) as string) + '.000Z'
        : raw)
  )
    fail('DSH_DESKTOP_INPUT_INVALID');
  return value;
}
function array(raw: unknown): unknown[] {
  if (!isArray(raw)) fail('DSH_DESKTOP_STATE_UNCONFIRMED');
  return raw;
}
function method(receiver: object, key: string): Function {
  const row = descriptor(receiver, key);
  if (
    !row ||
    !own(row, 'value') ||
    typeof row.value !== 'function' ||
    isProxy(row.value)
  )
    fail('DSH_DESKTOP_OWNER_UNAVAILABLE');
  return row.value;
}
function selection(raw: unknown): DshDesktopSourceSelection {
  const r = record(raw);
  if (r.kind === 'issue_ids') {
    fields(r, ['kind', 'issueIds']);
    const ids = sort(map(array(r.issueIds), id));
    if (!ids.length || ids.length > 1000) fail('DSH_DESKTOP_INPUT_INVALID');
    for (let i = 1; i < ids.length; i++)
      if (ids[i] === ids[i - 1]) fail('DSH_DESKTOP_INPUT_INVALID');
    return freeze({ kind: 'issue_ids', issueIds: ids });
  }
  fields(r, ['kind', 'match', 'labelIds']);
  if (r.kind !== 'label_ids' || r.match !== 'all')
    fail('DSH_DESKTOP_INPUT_INVALID');
  const ids = sort(map(array(r.labelIds), id));
  if (!ids.length || ids.length > 1000) fail('DSH_DESKTOP_INPUT_INVALID');
  for (let i = 1; i < ids.length; i++)
    if (ids[i] === ids[i - 1]) fail('DSH_DESKTOP_INPUT_INVALID');
  return freeze({ kind: 'label_ids', match: 'all', labelIds: ids });
}
export interface DshDesktopController {
  getState(): Promise<DshDesktopState>;
  setMode(
    event: IpcMainInvokeEvent,
    input: DshDesktopSetModeInput,
  ): Promise<DshDesktopState>;
  configureSetup(
    event: IpcMainInvokeEvent,
    input: DshDesktopConfigureSetupInput,
  ): Promise<DshDesktopState>;
  connect(
    event: IpcMainInvokeEvent,
    input: DshDesktopConnectInput,
  ): Promise<DshDesktopState>;
  disconnect(
    event: IpcMainInvokeEvent,
    input: DshDesktopDisconnectInput,
  ): Promise<DshDesktopState>;
  reconcile(
    event: IpcMainInvokeEvent,
    input: DshDesktopReconcileInput,
  ): Promise<DshDesktopState>;
  configureBudget(
    event: IpcMainInvokeEvent,
    input: DshDesktopConfigureBudgetInput,
  ): Promise<DshDesktopState>;
  publishEgressPolicy(
    event: IpcMainInvokeEvent,
    input: DshDesktopPublishEgressPolicyInput,
  ): Promise<DshDesktopState>;
  publishMandate(
    event: IpcMainInvokeEvent,
    input: DshDesktopPublishMandateInput,
  ): Promise<DshDesktopState>;
  tick(): Promise<void>;
  readonly ingress: IngressOwner;
  close(): Promise<void>;
}
const originalControllerChecks=new WeakMap<object,()=>void>(),controllerGet=WeakMap.prototype.get,controllerSet=WeakMap.prototype.set;
/** Pure original-owner check. It creates no Source or execution permission. */
export function assertOriginalDshDesktopControllerAccepting(controller:unknown):void {
  const check=apply(controllerGet,originalControllerChecks,[controller]) as (()=>void)|undefined;
  if(!check)fail('DSH_DESKTOP_OWNER_UNAVAILABLE');
  check();
}
/** Original Main composition only. No callback authority, network engine, timer or durable state owner. */
export function createDshDesktopController(raw: unknown): DshDesktopController {
  if (!raw || typeof raw !== 'object' || isProxy(raw))
    fail('DSH_DESKTOP_OWNER_UNAVAILABLE');
  const options = captureGithubOpaqueRecord(raw, [
    'scope',
    'realm',
    'store',
    'userSource',
    'runtime',
    ...(descriptor(raw, 'sourcePopulation') ? ['sourcePopulation'] : ['sourceOwner']),
    'budgetSource',
    ...(descriptor(raw, 'businessSource') ? ['businessSource'] : []),
    ...(descriptor(raw, 'brokerSource') ? ['brokerSource'] : []),
    ...(descriptor(raw, 'admissionCoordinator')
      ? ['admissionCoordinator']
      : []),
  ]);
  const scope = record(captureGithubReadData(options.scope));
  const populationMode = own(options, 'sourcePopulation');
  fields(scope, populationMode ? ['profileId', 'workspaceId'] : ['profileId', 'tenantId', 'workspaceId']);
  text(scope.profileId);
  if (!populationMode) text(scope.tenantId);
  text(scope.workspaceId);
  const realm = options.realm as MainDshBootstrapAuthority,
    store = options.store as object,
    user = options.userSource as MainDshControlSource,
    runtime = options.runtime as object;
  const population = populationMode ? readOriginalMainGithubSourceConnectionPopulation(
      options.sourcePopulation, realm, store, user, runtime,
    ) : null;
  const source = populationMode ? null : readOriginalMainGithubSourceConnectionOwner(
      options.sourceOwner,
      realm,
      store,
      user,
      runtime,
    );
  const knownSources = createIntrinsicSet<MainGithubSourceConnectionOwner>();
  if (source) knownSources.add(source);
  function sourceForProof(proof: object, kind: 'source_setup'|'source_binding') {
    const original = source ?? (kind === 'source_setup'
      ? population!.readSetupOwner(proof) : population!.readBindingOwner(proof));
    knownSources.add(original);
    return original;
  }
  function statusFor(bindingId: string): GithubSessionStatus | null {
    if (population) {
      const all=population.getStatuses();
      for(let i=0;i<all.length;i++) if(all[i]!.status.sourceBindingId===bindingId) return all[i]!.status;
      return null;
    }
    const sources = knownSources.snapshot();
    for (let i = 0; i < sources.length; i++) {
      const status = sources[i]!.getSession().getStatus();
      if (status.sourceBindingId === bindingId) return status;
    }
    return null;
  }
  function abortSessions(reason?: string): void {
    if (population) {population.abortAllActive();return;}
    const sources = knownSources.snapshot();
    for (let i = 0; i < sources.length; i++) sources[i]!.getSession().abortAllActive(reason);
  }
  function stopSessions(): void {
    if (population) {population.stopAccepting();return;}
    const sources = knownSources.snapshot();
    for (let i = 0; i < sources.length; i++) sources[i]!.getSession().stopAccepting();
  }
  function candidateTenant(value: unknown): string {
    if (value === undefined && !populationMode) return text(scope.tenantId);
    const tenant = text(value);
    if (!populationMode && tenant !== scope.tenantId) fail('DSH_DESKTOP_TENANT_MISMATCH');
    return tenant;
  }
  const budgetSource = options.budgetSource as MainDshBudgetAuthoritySource;
  readOriginalMainDshBudgetAuthoritySource(budgetSource, realm, store);
  const business =
      options.businessSource === undefined || options.businessSource === null
        ? null
        : readOriginalMainDshBusinessSource(
            options.businessSource,
            realm,
            runtime,
            budgetSource,
            store,
          ),
    prepareBusiness = business ? method(business, 'prepareOwner') : null;
  const broker=options.brokerSource===undefined||options.brokerSource===null?null:readOriginalMainDshBrokerControlSource(options.brokerSource,realm,store),prepareBroker=broker?method(broker,'prepareOwner'):null,releaseBroker=broker?method(broker,'release'):null;
  const coordinator =
      options.admissionCoordinator === undefined ||
      options.admissionCoordinator === null
        ? null
        : readOriginalMainDshAdmissionCoordinator(
            options.admissionCoordinator,
            realm,
            store,
            runtime,
            budgetSource,
          ),
    coordinateScan = coordinator ? method(coordinator, 'runScan') : null,
    reconcileOwners = coordinator
      ? method(coordinator, 'reconcileOwners')
      : null,
    stopCoordinator = coordinator ? method(coordinator, 'stopAccepting') : null,
    closeCoordinator = coordinator ? method(coordinator, 'close') : null;
  const budgetPort = readOriginalDshBudgetPort(runtime, budgetSource),
    budgetOpen = method(budgetSource, 'openUserBudget'),
    budgetObserve = method(budgetPort, 'observe');
  const dshRow = descriptor(runtime, 'dsh');
  if (
    !dshRow ||
    !own(dshRow, 'value') ||
    !dshRow.value ||
    typeof dshRow.value !== 'object'
  )
    fail('DSH_DESKTOP_OWNER_UNAVAILABLE');
  const runtimeDsh = dshRow.value as object,
    openAccount = method(runtimeDsh, 'openAccount');
  const port = readOriginalDshAdmissionPort(store, realm);
  readOriginalDshUserControlPort(store, user);
  const openUser = method(user, 'open'),
    applyControl = method(port, 'applyControl'),
    enroll = method(port, 'enrollAuthority');
  const storageScope = freeze({
    profileId: scope.profileId as string,
    workspaceId: scope.workspaceId as string,
  });
  const roots = createIntrinsicSet<object>(),
    tails = createIntrinsicSet<object>(),
    observed = createIntrinsicSet<unknown>(),
    unknown = createIntrinsicSet<unknown>(),
    waiters = createIntrinsicSet<() => void>();
  const businessResources = createIntrinsicSet<RoomTurnCustody>();
  const lastScans: Record<
      string,
      {
        scanId: string;
        sourceSnapshotAt: string;
        pagination: 'complete' | 'partial' | 'unknown';
        checkpointRevision: number | null;
      }
    > = Object.create(null),
    lastStarted: Record<string, number> = Object.create(null);
  let accepting = true,
    closing: Promise<void> | undefined,
    ticking: Promise<void> | undefined,
    firstPresent = false,
    first: unknown,
    lastErrorCode: string | null = null;
  const wake = () => {
    const rows = waiters.snapshot();
    for (let i = 0; i < rows.length; i++) rows[i]!();
  };
  const remember = (raw: unknown) => {
    if (!firstPresent) {
      firstPresent = true;
      first = raw;
    }
  };
  function inventory(raw: unknown): void {
    retainSourceErrorTails(raw, (value, kind) => {
      if (kind === 'unknown') {
        unknown.add(value);
        return;
      }
      if (observed.has(value)) return;
      observed.add(value);
      const root = {};
      tails.add(root);
      try {
        assertStandardIpcPromise(value, 'DSH_DESKTOP_SDK_UNCONFIRMED');
        const done = (outcome: unknown) => {
          try {
            inventory(outcome);
          } catch (error) {
            remember(error);
            unknown.add(error);
          } finally {
            tails.delete(root);
            wake();
          }
        };
        apply(then, value, [done, done]);
      } catch (error) {
        remember(error);
        unknown.add(value);
        unknown.add(error);
        tails.delete(root);
        wake();
      }
    });
  }
  const local = () => {
    if (!accepting) fail('DSH_DESKTOP_CLOSED');
    if (unknown.size) fail('DSH_DESKTOP_UNCONFIRMED');
  };
  function operation<T>(work: () => Promise<T> | T): Promise<T> {
    const root = {};
    roots.add(root);
    return (async () => {
      try {
        local();
        return await work();
      } catch (error) {
        remember(error);
        inventory(error);
        lastErrorCode = 'DSH_DESKTOP_OPERATION_FAILED';
        throw new NativeError(lastErrorCode, { cause: error });
      } finally {
        roots.delete(root);
        wake();
      }
    })();
  }
  function rawState() {
    return readOriginalDshDesktopState(realm, store, realm, storageScope);
  }
  function configurations(state: ReturnType<typeof rawState>): R[] {
    const out: R[] = [];
    for (let i = 0; i < state.sourceConfigurations.length; i++)
      out[out.length] = record(state.sourceConfigurations[i]);
    return out;
  }
  function configured(
    state: ReturnType<typeof rawState>,
    bindingId: unknown,
    revision: unknown,
  ): R {
    const rows = configurations(state);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!,
        configuration = record(row.configuration),
        binding = record(configuration.binding);
      if (binding.bindingId === bindingId) {
        if (row.revision !== revision) fail('DSH_DESKTOP_CONFIGURATION_STALE');
        return row;
      }
    }
    fail('DSH_DESKTOP_SOURCE_NOT_FOUND');
  }
  function project(): DshDesktopState {
    const state = rawState(),
      modes: DshDesktopState['modes'][number][] = [],
      setups: DshDesktopState['setups'][number][] = [],
      sources: DshDesktopState['sources'][number][] = [];
    const authority = state.authority;
    for (let i = 0; i < state.modes.length; i++) {
      const value = record(state.modes[i]),
        identity = record(value.identity),
        mode = record(value.value).mode;
      if (mode !== 'off' && mode !== 'observe' && mode !== 'auto_draft')
        fail('DSH_DESKTOP_STATE_UNCONFIRMED');
      const kind =
        identity.kind === 'sourceBinding' ? 'source_binding' : identity.kind;
      if (
        kind !== 'global' &&
        kind !== 'tenant' &&
        kind !== 'workspace' &&
        kind !== 'source_binding' &&
        kind !== 'mandate'
      )
        continue;
      modes[modes.length] = {
        scopeKind: kind,
        ...(kind === 'global' ? {} : {tenantId:text(identity.tenantId)}),
        sourceBindingId:
          kind === 'source_binding' || kind === 'mandate'
            ? text(identity.sourceBindingId)
            : null,
        ...(kind === 'mandate' ? { mandateId: text(identity.mandateId) } : {}),
        mode,
        epoch: integer(value.epoch, 1),
        revision: integer(value.revision, 1),
        status:
          value.status === 'effective'
            ? 'effective'
            : value.status === 'accepted_pending_owner_fence'
              ? 'accepted_pending_owner_fence'
              : fail('DSH_DESKTOP_MODE_STATUS_UNCONFIRMED'),
      };
    }
    for (let i = 0; i < state.sourceSetups.length; i++) {
      const row = record(state.sourceSetups[i]),
        c = record(row.configuration);
      setups[setups.length] = {
        setupId: text(c.setupId),
        tenantId: text(c.tenantId),
        configurationRevision: integer(row.revision, 1),
        candidateRepository: parseGithubRepositoryCandidate(
          c.candidateRepository,
        ),
        selection: selection(c.selection),
        minimumIntervalMs: integer(c.minimumIntervalMs, 1000),
        mode: c.mode === 'off' ? 'off' : 'observe',
      };
    }
    const rows = configurations(state);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!,
        c = record(row.configuration),
        binding = record(c.binding),
        auth = record(binding.authScope),
        repository = record(c.repository),
        bindingId = text(binding.bindingId),
        status = statusFor(bindingId);
      let observed = lastScans[bindingId] ?? null;
      for (let j = 0; j < state.sourceCheckpoints.length; j++) {
        const cold = record(state.sourceCheckpoints[j]);
        if (
          cold.bindingId === bindingId &&
          (!observed || text(cold.sourceSnapshotAt) > observed.sourceSnapshotAt)
        ) {
          if (cold.pagination !== 'complete')
            fail('DSH_DESKTOP_CHECKPOINT_METADATA_INVALID');
          observed = {
            scanId: text(cold.scanId),
            sourceSnapshotAt: text(cold.sourceSnapshotAt),
            pagination: 'complete',
            checkpointRevision: integer(cold.revision, 1),
          };
        }
      }
      let mode = c.mode as DshDesktopMode;
      for (let j = 0; j < modes.length; j++) {
        const m = modes[j]!;
        if (m.scopeKind === 'mandate') continue;
        if (m.scopeKind !== 'global' && m.tenantId !== auth.tenantId) continue;
        if (
          m.scopeKind !== 'source_binding' ||
          m.sourceBindingId === bindingId
        ) {
          if (m.mode === 'off') mode = 'off';
          else if (m.mode === 'observe' && mode === 'auto_draft')
            mode = 'observe';
        }
      }
      sources[sources.length] = {
        sourceBindingId: bindingId,
        tenantId: text(auth.tenantId),
        configurationRevision: integer(row.revision, 1),
        credentialEpoch: integer(auth.credentialEpoch, 1),
        repository: {
          repositoryId: text(repository.repositoryId),
          owner: text(repository.owner),
          repo: text(repository.repo),
        },
        selection: selection(c.selection),
        minimumIntervalMs: integer(c.minimumIntervalMs, 1000),
        mode,
        connection:
          status?.sourceBindingId === bindingId
            ? status.state === 'connected'
              ? 'connected'
              : status.state === 'validating'
                ? 'validating'
                : status.state === 'unknown'
                  ? 'unknown'
                  : status.state === 'closing'
                    ? 'closing'
                    : status.state === 'closed'
                      ? 'closed'
                      : 'credential_required'
            : 'credential_required',
        lastScan: observed,
      };
    }
    return freeze({
      schemaVersion: 1,
      executionQualified: state.executionQualified,
      availability: unknown.size ? 'unknown' : !accepting ? 'closing' : 'ready',
      domain: authority
        ? {
            revision: integer(authority.revision, 1),
            authorityEpoch: integer(authority.authorityEpoch, 1),
            state: text(authority.state),
          }
        : null,
      modes,
      setups,
      sources,
      authorizations: {
        budgetAccountId: authority?.budget
          ? text(record(authority.budget).accountId)
          : null,
        mandates: map(state.authorizations.publishedMandates, (raw) => {
          const row = record(raw),
            document = record(record(row.projection).document);
          return {
            mandateId: text(document.mandateId),
            sourceBindingId: text(document.sourceBindingId),
            revision: integer(document.revision, 1),
            headRevision: integer(row.headRevision, 1),
            status: text(document.status),
            validUntil: text(document.validUntil),
          };
        }),
        egressPolicyState: state.authorizations.egressPolicies.length
          ? 'configured'
          : 'unknown',
        egressPolicies: map(state.authorizations.egressPolicies, (raw) => {
          const row = record(raw),
            policy = record(row.value),
            identity = record(row.identity);
          return {
            policyRef: text(policy.policyRef),
            sourceBindingId: text(identity.sourceBindingId),
            mandateId: text(identity.mandateId),
            provider: text(policy.provider),
            modelIds: map(array(policy.modelIds), text),
            destinationRef: text(policy.destinationRef),
            purposes: policy.purposes as ('admission' | 'preview' | 'draft')[],
            enabled: policy.enabled as boolean,
            validUntil: text(policy.validUntil),
            epoch: integer(row.epoch, 1),
            revision: integer(row.revision, 1),
          };
        }),
      },
      lastErrorCode,
    });
  }
  async function userAction<T>(
    event: IpcMainInvokeEvent,
    purpose: 'policy_control' | 'enroll_authority' | 'mandate_control',
    body: unknown,
    action: (frame: MainDshControlFrame) => Promise<T> | T,
  ): Promise<T> {
    const frame = apply(openUser, user, [
      event,
      purpose,
      body,
      'user',
    ]) as MainDshControlFrame;
    let result: T | undefined,
      primaryPresent = false,
      primary: unknown;
    try {
      frame.assertCurrent();
      frame.assertLocal();
      result = await action(frame);
    } catch (error) {
      primaryPresent = true;
      primary = error;
      remember(error);
      inventory(error);
    }
    try {
      frame.release();
    } catch (error) {
      remember(error);
      inventory(error);
      unknown.add(error);
      if (!primaryPresent) {
        primaryPresent = true;
        primary = error;
      }
    }
    if (primaryPresent) throw primary;
    return result!;
  }
  async function ensureDomain(event: IpcMainInvokeEvent) {
    if (rawState().authority) return;
    const body = {
      schemaVersion: 1,
      expectedDomainRevision: 0,
      ownerDomainIds: [],
    };
    await userAction(event, 'enroll_authority', body, (frame) =>
      apply(enroll, port, [
        frame.proof,
        {
          requestSource: 'user',
          bodyHash: frame.bodyHash,
          bootstrapAuthority: realm,
        },
      ]),
    );
  }
  async function prepareBrokerOwner():Promise<void>{
    if(!broker||!prepareBroker||!releaseBroker)return;
    const custody=createRoomTurnCustody();businessResources.add(custody);let reply:object|undefined,failure:{raw:unknown}|undefined;
    try{reply=await custody.sdk<object>(prepareBroker,broker,[new AbortController().signal]);await sdk(apply(method(port,'registerBrokerOwnerDomain'),port,[reply,{requestSource:'scheduler',bootstrapAuthority:realm}]));}catch(raw){failure={raw};remember(raw);inventory(raw);}
    if(reply)try{custody.syncVoid(releaseBroker,broker,[reply]);}catch(raw){failure??={raw};remember(raw);inventory(raw);}
    try{await custody.waitPhysicalKnown();businessResources.delete(custody);}catch(raw){failure??={raw};unknown.add(raw);remember(raw);inventory(raw);}
    if(failure)throw failure.raw;
  }
  async function prepareWorkOwner(): Promise<void> {
    if (!business || !prepareBusiness){await prepareBrokerOwner();return;}
    const signal = new AbortController(),
      custody = createRoomTurnCustody();
    businessResources.add(custody);
    let delivery: MainDshBusinessDelivery | undefined;
    let primary: unknown,
      present = false;
    const consume = async function (this: object) {
      const actual = readOriginalMainDshBusinessDelivery(business, this),
        release = method(actual, 'release');
      let error: unknown,
        failed = false;
      try {
        await sdk(
          apply(method(port, 'registerOwnerDomain'), port, [
            actual.reply,
            { requestSource: 'scheduler', bootstrapAuthority: realm },
          ]),
        );
      } catch (raw) {
        failed = true;
        error = raw;
        remember(raw);
        inventory(raw);
      }
      try {
        const raw = apply(release, actual, []);
        custody.inventory(raw);
        if (raw !== undefined) {
          unknown.add(raw);
          fail('DSH_DESKTOP_OWNER_RELEASE_UNCONFIRMED');
        }
      } catch (raw) {
        remember(raw);
        inventory(raw);
        unknown.add(raw);
        if (!failed) {
          failed = true;
          error = raw;
        }
      }
      if (failed) throw error;
    };
    try {
      await custody.sdk(prepareBusiness, business, [signal.signal], {
        accept(value) {
          delivery = readOriginalMainDshBusinessDelivery(business, value);
          return true;
        },
        consumer: consume,
      });
    } catch (error) {
      present = true;
      primary = error;
      remember(error);
      inventory(error);
    }
    if (delivery)
      try {
        await custody.consumeResource(consume, delivery, []);
      } catch (error) {
        remember(error);
        inventory(error);
        if (!present) {
          present = true;
          primary = error;
        }
      }
    try {
      await custody.waitPhysicalKnown();
      businessResources.delete(custody);
    } catch (error) {
      unknown.add(error);
      remember(error);
      inventory(error);
      if (!present) {
        present = true;
        primary = error;
      }
    }
    if (present) throw primary;
    await prepareBrokerOwner();
  }
  const parse = (raw: unknown, names: string[]) => {
    const r = record(captureGithubReadData(raw));
    fields(r, names);
    if (r.schemaVersion !== 1) fail('DSH_DESKTOP_INPUT_INVALID');
    return r;
  };
  function bindingContext(bindingId: string, revision: number, scanId: string) {
    const proof = realm.openGithubSourceRead({
      bindingId,
      configurationRevision: revision,
    });
    const original = sourceForProof(proof,'source_binding');
    return { proof, source:original, session:original.getSession(), context: original.openBindingContext(proof, scanId) };
  }
  async function scanBinding(
    bindingId: string,
    revision: number,
  ): Promise<void> {
    const current = rawState(),
      row = configured(current, bindingId, revision),
      c = record(row.configuration),
      scanId = 'github-scan:' + randomUUID(),
      ctx = bindingContext(bindingId, revision, scanId),
      session = ctx.session,
      view = readOriginalDshGithubReadAuthority(
        realm,
        store,
        realm,
        ctx.proof,
        'source_binding',
      );
    if (view.kind !== 'source_binding') fail('DSH_DESKTOP_SOURCE_UNQUALIFIED');
    const extended = current as unknown as { sourceCheckpoints?: readonly R[] },
      checkpointRows = extended.sourceCheckpoints;
    if (!checkpointRows) fail('DSH_DESKTOP_CHECKPOINT_METADATA_UNAVAILABLE');
    let previous = 0;
    for (let i = 0; i < checkpointRows.length; i++)
      if (checkpointRows[i]!.bindingId === bindingId)
        previous = integer(checkpointRows[i]!.revision, 1);
    const identity = record(c.selection),
      issueRefs =
        identity.kind === 'label_ids'
          ? []
          : array(
              (view as unknown as { verifiedIssueRefs?: unknown })
                .verifiedIssueRefs,
            );
    const result = await collectGithubSourceScan(
      session,
      {
        schemaVersion: 1,
        scanId,
        bindingId,
        bindingRevision: view.sourceBindingRevision,
        boundRepository: view.repository,
        authScope: view.authScope,
        sourceBindingVersion: view.sourceBindingVersion,
        actorMappingVersion: view.actorMappingVersion,
        provenanceVersion: view.provenanceVersion,
        selection: view.selection,
        issueRefs,
        candidateIssueRefs: view.candidateIssueRefs,
        previousCheckpointRevision: previous,
        since: null,
      },
      ctx.context,
    );
    const receipt = readOriginalGithubSourceScan(session, result.token);
    if (receipt.qualification !== 'budget_qualified')
      fail('DSH_DESKTOP_SOURCE_UNQUALIFIED');
    const commit = method(port, 'commitGithubSourceScan');
    const raw = apply(commit, port, [
      session,
      result.token,
      { requestSource: 'scheduler', bootstrapAuthority: realm },
    ]);
    inventory(raw);
    const response = record(captureGithubReadData(raw));
    if (response.ok !== true) fail('DSH_DESKTOP_SCAN_COMMIT_UNCONFIRMED');
    lastScans[bindingId] = {
      scanId,
      sourceSnapshotAt: receipt.data.completedAt,
      pagination: receipt.data.selected.pagination,
      checkpointRevision: receipt.data.contentCheckpoint ? previous + 1 : null,
    };
    lastStarted[bindingId] = apply(now, performance, []) as number;
    if (receipt.providerDateFact && receipt.data.contentCheckpoint) {
      const state = rawState();
      for (let i = 0; i < state.authorizations.publishedMandates.length; i++) {
        const document = record(
          record(record(state.authorizations.publishedMandates[i]).projection)
            .document,
        );
        if (
          document.sourceBindingId !== bindingId ||
          document.status !== 'active'
        )
          continue;
        const mandateId = text(document.mandateId);
        let requested = false;
        for (let j = 0; j < state.modes.length; j++) {
          const mode = record(state.modes[j]),
            identity = record(mode.identity);
          if (
            identity.kind === 'mandate' &&
            identity.sourceBindingId === bindingId &&
            identity.mandateId === mandateId &&
            record(mode.value).mode === 'auto_draft'
          )
            requested = true;
        }
        if (!requested) continue;
        try {
          if (
            readOriginalDshAutoAdmissionWindow(
              realm,
              store,
              realm,
              bindingId,
              mandateId,
            )
          )
            continue;
          const baseline = readOriginalDshAutoAdmissionWindowBaseline(
            realm,
            store,
            realm,
            bindingId,
            mandateId,
          );
          baseline.assertCurrent();
          const proof = realm.openAdmissionWindow(
            {
              schemaVersion: 1,
              sourceBindingId: bindingId,
              mandateId,
              expectedPrefixModeHash: baseline.expectedPrefixModeHash,
            },
            { providerDateFact: receipt.providerDateFact },
          );
          baseline.assertLocal();
          const reply = apply(method(port, 'establishWindow'), port, [
            proof,
            { requestSource: 'scheduler' },
          ]);
          inventory(reply);
          if (record(captureGithubReadData(reply)).ok !== true)
            fail('DSH_DESKTOP_WINDOW_UNCONFIRMED');
        } catch (error) {
          inventory(error);
          if (
            !error ||
            typeof error !== 'object' ||
            isProxy(error) ||
            !isError(error)
          )
            throw error;
          const row = descriptor(error, 'message');
          if (!row || !own(row, 'value')) throw error;
          const code = row.value;
          if (
            code !== 'DSH_A_WINDOW_UNCONFIRMED' &&
            code !== 'DSH_A_WINDOW_REBASELINE_REQUIRED' &&
            code !== 'DSH_A_WINDOW_TIME_UNCONFIRMED' &&
            code !== 'DSH_A_WINDOW_GUARD_CHANGED' &&
            code !== 'DSH_A_WINDOW_AUTO_REQUIRED' &&
            code !== 'DSH_A_MODE_OFF' &&
            code !== 'DSH_A_SCOPE_POLICY_DENIED' &&
            code !== 'DSH_A_MANDATE_CLOSED' &&
            code !== 'DSH_A_SOURCE_BINDING_CLOSED' &&
            code !== 'DSH_A_BASELINE_UNCONFIRMED' &&
            code !== 'DSH_A_OWNER_DOMAIN_REQUIRED' &&
            code !== 'DSH_A_BROKER_DOMAIN_REQUIRED' &&
            code !== 'DSH_A_BROKER_REBASELINE_REQUIRED'
          )
            throw error;
          lastErrorCode = 'DSH_DESKTOP_WINDOW_UNCONFIRMED';
        }
      }
    }
    if (coordinator && coordinateScan)
      await sdk(apply(coordinateScan, coordinator, [result.token]));
  }
  function sdk(raw: unknown): Promise<{ value: unknown }> {
    inventory(raw);
    assertStandardIpcPromise(raw, 'DSH_DESKTOP_SDK_UNCONFIRMED');
    return new NativePromise((yes, no) =>
      apply(then, raw, [
        (value: unknown) => {
          try {
            inventory(value);
            yes({ value });
          } catch (error) {
            no(error);
          }
        },
        (error: unknown) => {
          remember(error);
          inventory(error);
          no(error);
        },
      ]),
    );
  }
  function accountId(mandateId: string) {
    return (
      'dsh-main-account:' +
      hash('dsh-desktop-budget-account-v1', [storageScope, mandateId])
    );
  }
  async function consentPolicies(
    event: IpcMainInvokeEvent,
    configuration: R,
    mandateId: string,
  ): Promise<void> {
    const binding = record(configuration.binding),
      auth = record(binding.authScope),
      sourceIdentity = {
        kind: 'sourceBinding',
        tenantId: auth.tenantId,
        workspaceId: auth.workspaceId,
        provider: 'github',
        repositoryId: auth.repositoryId,
        sourceBindingId: binding.bindingId,
      };
    const identities: R[] = [
      { kind: 'global' },
      { kind: 'tenant', tenantId: auth.tenantId },
      {
        kind: 'workspace',
        tenantId: auth.tenantId,
        workspaceId: auth.workspaceId,
      },
      sourceIdentity,
      { ...sourceIdentity, kind: 'mandate', mandateId },
    ];
    for (let i = 0; i < identities.length; i++)
      for (const axis of ['mandate', 'egress', 'privacy', 'readonly']) {
        const state = rawState() as ReturnType<typeof rawState> & {
          scopePolicies?: readonly R[];
        };
        if (!state.scopePolicies)
          fail('DSH_DESKTOP_POLICY_METADATA_UNCONFIRMED');
        const identity = identities[i]!,
          scopeKey = dshSourceScopeKey(storageScope, identity);
        let epoch = 1,
          expectedRevision = 0;
        for (let j = 0; j < state.scopePolicies.length; j++) {
          const old = record(state.scopePolicies[j]);
          if (old.scopeKey === scopeKey && old.axis === axis) {
            epoch = integer(old.epoch, 1) + 1;
            expectedRevision = integer(old.revision, 1);
          }
        }
        const body = {
          control: {
            kind: 'scope_policy',
            identity,
            axis,
            allowed: true,
            epoch,
          },
          expectedRevision,
        };
        await userAction(event, 'policy_control', body, (frame) =>
          apply(applyControl, port, [
            frame.proof,
            {
              requestSource: 'user',
              bodyHash: frame.bodyHash,
              bootstrapAuthority: realm,
            },
          ]),
        );
      }
  }
  const controller: DshDesktopController = {
    getState() {
      return operation(() => project());
    },
    configureBudget(event, input) {
      return operation(async () => {
        const captured=record(captureGithubReadData(input));
        const r = parse(captured, [
          'schemaVersion',
          'mandateId',
          'mandateRevision',
          'tokenLimit',
          'costLimitUsd',
          'validUntil',
          ...(own(captured,'tenantId') ? ['tenantId'] : []),
        ]);
        const tenantId = candidateTenant(r.tenantId);
        text(r.mandateId);
        integer(r.mandateRevision, 1);
        integer(r.tokenLimit, 1);
        text(r.validUntil);
        const cost = parseDshUsdAmount(r.costLimitUsd);
        if (cost < 1) fail('DSH_DESKTOP_INPUT_INVALID');
        await ensureDomain(event);
        const body = {
          schemaVersion: 1,
          kind: 'budget_config',
          account: {
            accountId: accountId(text(r.mandateId)),
            tokenLimit: r.tokenLimit,
            costLimitMicros: cost,
            currency: 'USD',
            scale: 6,
            validUntil: instant(r.validUntil),
          },
          mandate: {
            tenantId,
            mandateId: r.mandateId,
            mandateRevision: r.mandateRevision,
          },
        };
        await userAction(event, 'policy_control', body, async (frame) => {
          const request = apply(budgetOpen, budgetSource, [
            frame.proof,
            frame.bodyHash,
          ]) as ReturnType<MainDshBudgetAuthoritySource['openUserBudget']>;
          frame.assertCurrent();
          await sdk(
            apply(openAccount, runtimeDsh, [
              request.account,
              request.openProof,
            ]),
          );
          const observation = (
            await sdk(
              apply(budgetObserve, budgetPort, [
                request.readInput,
                request.readProof,
              ]),
            )
          ).value;
          readOriginalDshBudgetObservation(budgetPort, observation as object);
          frame.assertCurrent();
          const pin = method(port, 'pinBudget'),
            reply = apply(pin, port, [
              observation,
              { requestSource: 'scheduler', bootstrapAuthority: realm },
            ]);
          inventory(reply);
          if (record(captureGithubReadData(reply)).ok !== true)
            fail('DSH_DESKTOP_BUDGET_PIN_UNCONFIRMED');
        });
        return project();
      });
    },
    publishEgressPolicy(event, input) {
      return operation(async () => {
        const r = parse(input, [
            'schemaVersion',
            'sourceBindingId',
            'mandateId',
            'policyRef',
            'provider',
            'modelIds',
            'destinationRef',
            'purposes',
            'enabled',
            'validUntil',
            'expectedRevision',
          ]),
          state = rawState();
        integer(r.expectedRevision);
        text(r.sourceBindingId);
        text(r.mandateId);
        text(r.policyRef);
        text(r.provider);
        text(r.destinationRef);
        instant(r.validUntil);
        if (typeof r.enabled !== 'boolean') fail('DSH_DESKTOP_INPUT_INVALID');
        const modelIds = sort(map(array(r.modelIds), text)),
          purposes = sort(map(array(r.purposes), text));
        if (
          !modelIds.length ||
          modelIds.length > 16 ||
          !purposes.length ||
          purposes.length > 3
        )
          fail('DSH_DESKTOP_INPUT_INVALID');
        for (let i = 0; i < modelIds.length; i++)
          if (i && modelIds[i] === modelIds[i - 1])
            fail('DSH_DESKTOP_INPUT_INVALID');
        for (let i = 0; i < purposes.length; i++)
          if (
            (purposes[i] !== 'admission' &&
              purposes[i] !== 'preview' &&
              purposes[i] !== 'draft') ||
            (i && purposes[i] === purposes[i - 1])
          )
            fail('DSH_DESKTOP_INPUT_INVALID');
        let epoch = 1;
        for (let i = 0; i < state.authorizations.egressPolicies.length; i++) {
          const old = record(state.authorizations.egressPolicies[i]),
            identity = record(old.identity),
            value = record(old.value);
          if (
            identity.sourceBindingId === r.sourceBindingId &&
            identity.mandateId === r.mandateId &&
            value.policyRef === r.policyRef
          )
            epoch = integer(old.epoch, 1) + 1;
        }
        const body = {
          sourceBindingId: r.sourceBindingId,
          mandateId: r.mandateId,
          policy: {
            policyRef: r.policyRef,
            epoch,
            provider: r.provider,
            modelIds,
            destinationRef: r.destinationRef,
            bodyClasses: ['source_title_body_v1'],
            purposes,
            enabled: r.enabled,
            validUntil: r.validUntil,
          },
          expectedRevision: r.expectedRevision,
        };
        await userAction(event, 'policy_control', body, (frame) =>
          apply(method(port, 'publishEgressPolicy'), port, [
            frame.proof,
            {
              requestSource: 'user',
              bodyHash: frame.bodyHash,
              bootstrapAuthority: realm,
            },
          ]),
        );
        return project();
      });
    },
    publishMandate(event, input) {
      return operation(async () => {
        const r = parse(input, [
          'schemaVersion',
          'mandateId',
          'sourceBindingId',
          'expectedHeadRevision',
          'workProfile',
          'scopePolicyConsent',
          'allowedActorProviderIds',
          'allowedActions',
          'validUntil',
          'maxInputBytes',
          'limits',
          'dataEgressPolicyRef',
          'followup',
        ]);
        text(r.mandateId);
        integer(r.expectedHeadRevision);
        if (typeof r.scopePolicyConsent !== 'boolean')
          fail('DSH_DESKTOP_INPUT_INVALID');
        if (r.workProfile !== 'model_text_only_v1')
          fail('DSH_DESKTOP_READONLY_QUALIFICATION_REQUIRED');
        await prepareWorkOwner();
        const state = rawState(),
          domain = state.authority;
        if (!domain) fail('DSH_DESKTOP_DOMAIN_REQUIRED');
        const sources = configurations(state);
        let c: R | undefined;
        for (let i = 0; i < sources.length; i++) {
          const value = record(sources[i]!.configuration);
          if (record(value.binding).bindingId === r.sourceBindingId) c = value;
        }
        if (!c) fail('DSH_DESKTOP_SOURCE_NOT_FOUND');
        const selected = selection(c.selection),
          limits = record(r.limits);
        fields(limits, [
          'maxActiveWorks',
          'maxDraftRunsPerWork',
          'maxTokens',
          'maxCostUsd',
          'executionDeadline',
        ]);
        const follow = record(r.followup);
        fields(follow, ['enabled', 'observationEndsAt']);
        const owners = map(state.authorizations.ownerDomains, (raw) => {
          const value = record(raw);
          return { domainId: text(value.domainId), kind: value.kind };
        });
        let revision = 1,
          authorizationEpoch = integer(domain.authorityEpoch, 1);
        for (
          let i = 0;
          i < state.authorizations.publishedMandates.length;
          i++
        ) {
          const old = record(state.authorizations.publishedMandates[i]),
            doc = record(record(old.projection).document);
          if (doc.mandateId === r.mandateId) {
            revision = integer(doc.revision, 1) + 1;
            authorizationEpoch = integer(doc.authorizationEpoch, 1) + 1;
          }
        }
        const projection = parseMandateProjection({
          document: {
            schemaVersion: 1,
            mandateId: r.mandateId,
            sourceBindingId: r.sourceBindingId,
            revision,
            authorizationEpoch,
            status: 'active',
            issuedByUserId: text(domain.principalId),
            allowedActorProviderIds: sort(
              map(array(r.allowedActorProviderIds), id),
            ),
            allowedActions: sort(map(array(r.allowedActions), text)),
            ruleVersion: 'github_issue_draft_v1',
            selection:
              selected.kind === 'issue_ids'
                ? { issueIds: selected.issueIds }
                : { labelIds: selected.labelIds },
            validUntil: r.validUntil,
            maxInputBytes: r.maxInputBytes,
            budgetRef: accountId(text(r.mandateId)),
            limits: {
              maxActiveWorks: limits.maxActiveWorks,
              maxDraftRunsPerWork: limits.maxDraftRunsPerWork,
              maxTokens: limits.maxTokens,
              maxCostMinor: parseDshUsdAmount(limits.maxCostUsd),
              currency: 'USD',
              executionDeadline: limits.executionDeadline,
            },
            dataEgressPolicyRef: r.dataEgressPolicyRef,
            ownerDomains: owners,
            ownerDomainsHash: hashA2Data(['dsh-owner-domains-v1', owners]),
            followup: {
              enabled: follow.enabled,
              observationEndsAt: follow.observationEndsAt,
              completionPredicate: 'draft_ready',
              resumeAfterCompletion: false,
            },
          },
          assessmentProfile: 'model_text_only_v1',
          workProfile: {
            state: 'known',
            value: {
              executionProfile: 'model_text_only_v1',
              schemaVersion: 1,
              snapshotHash: null,
              snapshotPolicyDigest: null,
              approvalRef: null,
            },
          },
          contentHash: null,
        });
        if (
          r.scopePolicyConsent &&
          !(
            rawState() as ReturnType<typeof rawState> & {
              scopePolicies?: readonly R[];
            }
          ).scopePolicies
        )
          fail('DSH_DESKTOP_POLICY_METADATA_UNCONFIRMED');
        const body = {
          projection,
          expectedHeadRevision: r.expectedHeadRevision,
        };
        await userAction(event, 'mandate_control', body, (frame) =>
          apply(method(port, 'putMandate'), port, [
            frame.proof,
            {
              requestSource: 'user',
              bodyHash: frame.bodyHash,
              bootstrapAuthority: realm,
            },
          ]),
        );
        if (r.scopePolicyConsent)
          await consentPolicies(event, c, text(r.mandateId));
        return project();
      });
    },
    setMode(event, input) {
      return operation(async () => {
        const captured = record(captureGithubReadData(input)),
          r = parse(captured, [
            'schemaVersion',
            'scopeKind',
            'sourceBindingId',
            'mode',
            'expectedRevision',
            ...(captured.scopeKind === 'mandate' ? ['mandateId'] : []),
            ...(own(captured,'tenantId') ? ['tenantId'] : []),
          ]);
        if (own(r,'tenantId') && r.scopeKind !== 'tenant' && r.scopeKind !== 'workspace') fail('DSH_DESKTOP_INPUT_INVALID');
        if (r.mode !== 'off' && r.mode !== 'observe' && r.mode !== 'auto_draft')
          fail('DSH_DESKTOP_INPUT_INVALID');
        integer(r.expectedRevision);
        if (
          r.scopeKind !== 'source_binding' &&
          r.scopeKind !== 'mandate' &&
          r.sourceBindingId !== null
        )
          fail('DSH_DESKTOP_INPUT_INVALID');
        await ensureDomain(event);
        const state = rawState();
        if (r.mode === 'auto_draft' && !state.executionQualified)
          fail('DSH_DESKTOP_EXECUTION_UNQUALIFIED');
        let identity: R;
        if (r.scopeKind === 'global') identity = { kind: 'global' };
        else if (r.scopeKind === 'tenant')
          identity = { kind: 'tenant', tenantId: candidateTenant(r.tenantId) };
        else if (r.scopeKind === 'workspace')
          identity = {
            kind: 'workspace',
            tenantId: candidateTenant(r.tenantId),
            workspaceId: scope.workspaceId,
          };
        else if (
          r.scopeKind === 'source_binding' ||
          r.scopeKind === 'mandate'
        ) {
          const rows = configurations(state);
          let found: R | undefined;
          for (let i = 0; i < rows.length; i++) {
            const c = record(rows[i]!.configuration),
              b = record(c.binding);
            if (b.bindingId === r.sourceBindingId) found = b;
          }
          if (!found) fail('DSH_DESKTOP_SOURCE_NOT_FOUND');
          const a = record(found.authScope);
          identity = {
            kind: 'sourceBinding',
            tenantId: a.tenantId,
            workspaceId: a.workspaceId,
            provider: 'github',
            repositoryId: a.repositoryId,
            sourceBindingId: found.bindingId,
          };
          if (r.scopeKind === 'mandate') {
            let matched = false;
            for (
              let i = 0;
              i < state.authorizations.publishedMandates.length;
              i++
            ) {
              const document = record(
                record(
                  record(state.authorizations.publishedMandates[i]).projection,
                ).document,
              );
              if (
                document.mandateId === r.mandateId &&
                document.sourceBindingId === r.sourceBindingId
              )
                matched = true;
            }
            if (!matched) fail('DSH_DESKTOP_MANDATE_NOT_FOUND');
            identity = {
              ...identity,
              kind: 'mandate',
              mandateId: text(r.mandateId),
            };
          }
        } else fail('DSH_DESKTOP_INPUT_INVALID');
        const scopeKey = dshSourceScopeKey(storageScope, identity);
        let epoch = 1;
        for (let i = 0; i < state.modes.length; i++)
          if (state.modes[i]!.scopeKey === scopeKey)
            epoch = integer(state.modes[i]!.epoch, 1) + 1;
        const body = {
          control: { kind: 'mode', identity, mode: r.mode, epoch },
          expectedRevision: r.expectedRevision,
        };
        await userAction(event, 'policy_control', body, (frame) => {
          if (r.mode === 'off' || r.mode === 'observe')
            abortSessions('dsh_mode_narrowed');
          return apply(applyControl, port, [
            frame.proof,
            {
              requestSource: 'user',
              bodyHash: frame.bodyHash,
              bootstrapAuthority: realm,
            },
          ]);
        });
        return project();
      });
    },
    configureSetup(event, input) {
      return operation(async () => {
        const captured=record(captureGithubReadData(input));
        const r = parse(captured, [
          'schemaVersion',
          'setupId',
          'candidateRepository',
          'selection',
          'issueRefs',
          'minimumIntervalMs',
          'expectedRevision',
          ...(own(captured,'tenantId') ? ['tenantId'] : []),
        ]);
        const tenantId=candidateTenant(r.tenantId);
        text(r.setupId);
        integer(r.expectedRevision);
        const candidateRepository = parseGithubRepositoryCandidate(
            r.candidateRepository,
          ),
          selected = selection(r.selection),
          interval = integer(r.minimumIntervalMs, 1000);
        if (interval > 86400000) fail('DSH_DESKTOP_INPUT_INVALID');
        const refs = array(r.issueRefs);
        for (let i = 0; i < refs.length; i++) {
          const ref = record(refs[i]);
          fields(ref, ['issueId', 'issueNumber']);
          id(ref.issueId);
          integer(ref.issueNumber, 1);
        }
        if (selected.kind === 'label_ids' && refs.length)
          fail('DSH_DESKTOP_INPUT_INVALID');
        await ensureDomain(event);
        const stored=rawState().sourceSetups;
        let previousSetup:R|undefined;
        for(let i=0;i<stored.length;i++){
          const row=record(stored[i]),existing=record(row.configuration);
          if(existing.setupId===r.setupId){
            if(row.revision!==r.expectedRevision)fail('DSH_DESKTOP_CONFIGURATION_STALE');
            if(hash('dsh-desktop-setup-target-v1',[existing.tenantId,existing.candidateRepository])!==hash('dsh-desktop-setup-target-v1',[tenantId,candidateRepository]))fail('DSH_DESKTOP_SETUP_TARGET_IMMUTABLE');
            previousSetup=existing;
          }
        }
        if(!previousSetup&&r.expectedRevision!==0)fail('DSH_DESKTOP_CONFIGURATION_STALE');
        await prepareWorkOwner();
        const setup = {
          schemaVersion: 1,
          setupId: r.setupId,
          tenantId,
          candidateRepository,
          mode: 'observe',
          accountId: previousSetup ? text(previousSetup.accountId) :
            'dsh-source-setup-account:' +
            hash(populationMode ? 'dsh-desktop-source-setup-account-v2' : 'dsh-desktop-source-setup-account-v1', [
              storageScope,
              ...(populationMode ? [tenantId] : []),
              candidateRepository,
            ]),
          minimumIntervalMs: interval,
          selection: selected,
          issueRefs: refs,
        };
        const body = {
          control: { kind: 'source_setup', setup },
          expectedRevision: r.expectedRevision,
        };
        await userAction(event, 'policy_control', body, (frame) =>
          apply(applyControl, port, [
            frame.proof,
            {
              requestSource: 'user',
              bodyHash: frame.bodyHash,
              bootstrapAuthority: realm,
            },
          ]),
        );
        return project();
      });
    },
    connect(event, input) {
      return operation(async () => {
        const captured = record(captureGithubReadData(input)),
          kind = captured.kind,
          r = parse(
            captured,
            kind === 'setup'
              ? [
                  'schemaVersion',
                  'kind',
                  'setupId',
                  'configurationRevision',
                  'operationId',
                  'secret',
                ]
              : [
                  'schemaVersion',
                  'kind',
                  'sourceBindingId',
                  'configurationRevision',
                  'operationId',
                  'secret',
                ],
          );
        if (
          (kind !== 'setup' && kind !== 'source_binding') ||
          typeof r.secret !== 'string' ||
          r.secret.length < 1 ||
          r.secret.length > 4096
        )
          fail('DSH_DESKTOP_INPUT_INVALID');
        text(r.operationId);
        integer(r.configurationRevision, 1);
        const state = rawState();
        let body: R;
        if (kind === 'setup') {
          let row: R | undefined;
          for (let i = 0; i < state.sourceSetups.length; i++)
            if (
              record(record(state.sourceSetups[i]).configuration).setupId ===
              r.setupId
            )
              row = record(state.sourceSetups[i]);
          if (!row || row.revision !== r.configurationRevision)
            fail('DSH_DESKTOP_CONFIGURATION_STALE');
          body = {
            control: { kind: 'source_setup', setup: row.configuration },
            expectedRevision: row.revision,
          };
        } else {
          const row = configured(
            state,
            r.sourceBindingId,
            r.configurationRevision,
          );
          body = {
            control: {
              kind: 'source_config',
              configuration: row.configuration,
            },
            expectedRevision: row.revision,
          };
        }
        await userAction(event, 'policy_control', body, async (frame) => {
          const scanId = 'github-connect:' + randomUUID();
          let context: object, selectedSource: MainGithubSourceConnectionOwner;
          if (kind === 'setup') {
            const setup = record(record(body.control).setup),
              proof = realm.openGithubSourceSetup(
                {
                  setupId: r.setupId,
                  bodyHash: frame.bodyHash,
                  candidateRepository: setup.candidateRepository,
                  expectedConfigurationRevision: r.configurationRevision,
                },
                { userControlProof: frame.proof },
              );
            selectedSource=sourceForProof(proof,'source_setup');
            context = selectedSource.openSetupContext(proof, scanId);
          } else {
            const selected = bindingContext(
              text(r.sourceBindingId),
              r.configurationRevision as number,
              scanId,
            );
            selectedSource=selected.source;context=selected.context;
          }
          await selectedSource.getSession().connect(
            {
              operationId: r.operationId,
              secret: r.secret,
              expectedConfigurationRevision: r.configurationRevision,
            },
            context,
          );
        });
        return project();
      });
    },
    disconnect(event, input) {
      return operation(async () => {
        const r = parse(input, [
            'schemaVersion',
            'sourceBindingId',
            'configurationRevision',
          ]),
          state = rawState(),
          row = configured(state, r.sourceBindingId, r.configurationRevision),
          body = {
            control: {
              kind: 'source_config',
              configuration: row.configuration,
            },
            expectedRevision: row.revision,
          };
        await userAction(event, 'policy_control', body, (frame) =>
          (population ?? source!).disconnectUser(
            frame.proof,
            frame.bodyHash,
            text(r.sourceBindingId),
          ),
        );
        return project();
      });
    },
    reconcile(event, input) {
      return operation(async () => {
        const r = parse(input, [
            'schemaVersion',
            'sourceBindingId',
            'configurationRevision',
          ]),
          row = configured(
            rawState(),
            r.sourceBindingId,
            r.configurationRevision,
          ),
          body = {
            control: {
              kind: 'source_config',
              configuration: row.configuration,
            },
            expectedRevision: row.revision,
          };
        await userAction(event, 'policy_control', body, () =>
          scanBinding(
            text(r.sourceBindingId),
            integer(r.configurationRevision, 1),
          ),
        );
        return project();
      });
    },
    tick() {
      if (ticking) return ticking;
      ticking = operation(async () => {
        if (coordinator && reconcileOwners)
          await sdk(apply(reconcileOwners, coordinator, []));
        const state = rawState(),
          rows = configurations(state);
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i]!,
            c = record(row.configuration),
            binding = record(c.binding),
            bindingId = text(binding.bindingId),
            status = statusFor(bindingId);
          if (
            c.mode === 'off' ||
            status?.state !== 'connected' ||
            status.sourceBindingId !== bindingId ||
            (lastScans[bindingId] &&
              lastScans[bindingId]!.pagination !== 'complete')
          )
            continue;
          const last = lastStarted[bindingId];
          if (
            last !== undefined &&
            (apply(now, performance, []) as number) - last <
              integer(c.minimumIntervalMs, 1000)
          )
            continue;
          await scanBinding(bindingId, integer(row.revision, 1));
        }
      });
      const actual = ticking;
      void apply(then, actual, [
        () => {
          ticking = undefined;
        },
        () => {
          ticking = undefined;
        },
      ]);
      return actual;
    },
    ingress: freeze({
      name: 'dsh-desktop-source',
      stopAccepting() {
        accepting = false;
        if (coordinator && stopCoordinator) {
          const raw = apply(stopCoordinator, coordinator, []);
          inventory(raw);
          if (raw !== undefined) unknown.add(raw);
        }
        stopSessions();
      },
      abortAllActive(reason: string) {
        abortSessions(reason);
      },
      drain(deadlineMs: number) {
        return new NativePromise<boolean>((yes) => {
          let timer: ReturnType<typeof setTimeout>;
          const check = () => {
            if (roots.size || tails.size) return;
            waiters.delete(check);
            clearTimer(timer);
            yes(!unknown.size);
          };
          timer = setTimer(
            () => {
              waiters.delete(check);
              yes(false);
            },
            Math.max(0, deadlineMs),
          );
          waiters.add(check);
          check();
        });
      },
    }),
    close() {
      if (!closing) {
        accepting = false;
        stopSessions();
        abortSessions();
        closing = (async () => {
          if (coordinator && closeCoordinator)
            await sdk(apply(closeCoordinator, coordinator, []));
          await (population ?? source!).close();
          await new NativePromise<void>((yes) => {
            const check = () => {
              if (roots.size || tails.size) return;
              waiters.delete(check);
              yes();
            };
            waiters.add(check);
            check();
          });
          if (unknown.size) {
            if (firstPresent) throw first;
            fail('DSH_DESKTOP_UNCONFIRMED');
          }
        })();
      }
      return closing;
    },
  };
  apply(controllerSet,originalControllerChecks,[controller,local]);
  return freeze(controller);
}
