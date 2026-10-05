import type { createProfileDisclosureLedger } from './profile-disclosure-ledger.js';
import type { Tool } from '../../types.js';
import { ToolRegistry } from '../../ai/tools/index.js';
import type { AgentSessionState, AgentSessionSnapshot } from '../../ai/runtime/session.js';
import { createObservationReadTool, createObservationSessionOwner, getObservationSessionOwnerHostBinding, inheritDelegatedObservationProjections, adoptDelegatedObservationClosure, type ObservationSessionOwner } from './observation-session-owner.js';
import type { ObservationCaller, ObservationDelegation, ObservationDelegationApproval } from './observation-service.js';
import { createTransportAuthorizationError } from './transport-lease.js';

type BaseOptions = Parameters<typeof createObservationSessionOwner>[0];
const bindings = new WeakMap<object, { registries: WeakSet<ToolRegistry>; session: AgentSessionState; registry: ToolRegistry; allowedNativeToolNames?: readonly string[]; parentOwner: ObservationSessionOwner; sourceSnapshot: AgentSessionSnapshot; validate(): void }>();
function reject(): never { throw createTransportAuthorizationError(); }
function assertToolCeiling(registry: ToolRegistry, allowed?: readonly string[]) {
  if (allowed && registry.getToolDefinitions().some(tool => !allowed.includes(tool.name) && !['tool_search', 'observation_read'].includes(tool.name))) reject();
}

/** Host-only creation. Returned owners are ready only after durable consumer publication.
 * Its ALS handoff is limited to the exact parent. It does not authorize restricted tools or OS execution. */
export async function createDelegatedObservationSessionOwner(options: Omit<BaseOptions, 'caller' | 'fullSendCounter'> & {
  disclosureLedger?: ReturnType<typeof createProfileDisclosureLedger>;
  captureApproval?: { approval: ObservationDelegationApproval; approver: ObservationCaller };
  parentOwner: ObservationSessionOwner;
  capability: ObservationDelegation;
  recipient: ObservationCaller;
  registry: ToolRegistry;
  allowedNativeToolNames?: readonly string[];
}): Promise<ObservationSessionOwner> {
  const { parentOwner, service, capability, recipient, session, registry } = options;
  const destination = Object.freeze({ ...options.destination });
  const parent = getObservationSessionOwnerHostBinding(parentOwner);
  if (parent.service !== service || parent.session === session || session.getMessages().length
    || session.getProtectedObservationClosure() || !(registry instanceof ToolRegistry)) reject();
  const allowedNativeToolNames = options.allowedNativeToolNames && Object.freeze([...options.allowedNativeToolNames]);
  assertToolCeiling(registry, allowedNativeToolNames);
  if (allowedNativeToolNames) registry.setAllowedTools([...allowedNativeToolNames, 'observation_read']);
  const sourceSnapshot = structuredClone(parent.session.exportSnapshot());
  const sessionId = session.exportSnapshot().sessionId;
  const validate = () => {
    try {
      parentOwner.assertSession(parent.session);
      return service.inspectDelegation({ capability, recipient,
        parentCaller: parent.caller, sessionId, destination });
    } catch { reject(); }
  };
  const references = validate();
  // A subset grant cannot launder the rest of the parent's sticky provenance.
  const parentClosure = sourceSnapshot.protectedObservationClosure;
  if (parentClosure ? parentClosure.observations.some(ref => !references.some(item => item.id === ref.observationId
    && item.revision === ref.revision && item.contentHash === ref.contentHash)) : references.length !== 0) reject();
  if (parent.counter && !options.disclosureLedger) reject();
  const caller = service.bindDelegatedCaller({ capability, recipient });
  if (options.captureApproval) service.inheritDelegatedArchivePolicies({ requestSource: 'user', caller: options.captureApproval.approver,
    approval: options.captureApproval.approval, capability, recipient: caller });
  const account = options.disclosureLedger?.createAccount({ requestSource: 'user', caller, sessionId, destination });
  const owner = createObservationSessionOwner({ ...options, service, caller, session, destination, fullSendCounter: account });
  const unsubscribeParent = parent.onDispose(() => owner.dispose());
  const hostBinding = getObservationSessionOwnerHostBinding(owner);
  hostBinding.onDispose(unsubscribeParent);
  const unsubscribePermission = registry.getObservationPermissionRevisionPort().onRevisionChanged(() => owner.dispose());
  hostBinding.onDispose(unsubscribePermission);
  try {
    // Publication stores each exact source ref under the child's independent pin.
    // Body pages are not made visible by this initialization step.
    for (const ref of references) await owner.read(ref.id, 0, 4);
    validate(); owner.assertSession(session);
    inheritDelegatedObservationProjections(parentOwner, owner, sourceSnapshot);
    bindings.set(owner, { registries: new WeakSet([registry]), session, registry, allowedNativeToolNames, parentOwner, sourceSnapshot, validate });
    return owner;
  } catch (error) { owner.dispose(); throw error; }
}

export function assertDelegatedObservationOwner(owner: ObservationSessionOwner, session: AgentSessionState, registry: ToolRegistry): void {
  const binding = bindings.get(owner);
  if (!binding || binding.session !== session || binding.registry !== registry) reject();
  assertToolCeiling(registry, binding.allowedNativeToolNames);
  binding.validate(); owner.assertSession(session);
}

/** Only this frozen host view may seed a delegated conversation. Apply the actual
 * provider's completed-prefix/synthesized projection before setting messages. */
export function getDelegatedObservationHandoff(owner: ObservationSessionOwner): AgentSessionSnapshot {
  const binding = bindings.get(owner);
  if (!binding) reject();
  binding.validate(); owner.assertSession(binding.session);
  return structuredClone(binding.sourceSnapshot);
}

export function isAuthorizedDelegatedObservationHandoff(parent: object, child: object): boolean {
  const binding = bindings.get(child);
  if (!binding || binding.parentOwner !== parent) return false;
  binding.validate(); (child as ObservationSessionOwner).assertSession(binding.session);
  return true;
}

/** A host-local, single-consumer plan. A serialized option or tool argument has no authority. */
export type DelegatedObservationExecutionPlan = object;
export interface DelegatedChildExecutionInstallation {
  prepareManagedFollowup?(input: {preparation:unknown;pausedTicket:object}): Promise<import('./compound-managed-followup.js').PreparedManagedCompoundFollowup>;
  assertTurnInput?(): void;
  prepareInitialTurn?(): Promise<void>;
  activateInitialTurn?(): Promise<void>;
  prepareManagedChild?: import('./product-compound-coordinator.js').ProductCompoundCoordinator['prepareManagedChild'];
  dispose(): Promise<void>;
  bindRegistry(registry: ToolRegistry): Promise<void>;
}
type ExecutionPlanOptions = Omit<Parameters<typeof createDelegatedObservationSessionOwner>[0], 'registry'> & {
  /** Host plan factory only. Installs the child's own effect journal/authority before any execution. */
  installChildExecution?: (input: Readonly<{ owner: ObservationSessionOwner; session: AgentSessionState; registry: ToolRegistry; recallTool: Tool }>) => Promise<DelegatedChildExecutionInstallation>;
};
const executionPlans = new WeakMap<object, { options: ExecutionPlanOptions; source: string; used: boolean }>();
export function createDelegatedObservationExecutionPlan(options: ExecutionPlanOptions): DelegatedObservationExecutionPlan {
  const binding = getObservationSessionOwnerHostBinding(options.parentOwner);
  if (binding.service !== options.service) reject();
  const token = Object.freeze({});
  executionPlans.set(token, { options: { ...options, ...(options.allowedNativeToolNames ? { allowedNativeToolNames: Object.freeze([...options.allowedNativeToolNames]) } : {}), destination: Object.freeze({ ...options.destination }) },
    source: JSON.stringify(binding.session.exportSnapshot()), used: false });
  return token;
}
export async function consumeDelegatedObservationExecutionPlan(plan: DelegatedObservationExecutionPlan, registry: ToolRegistry) {
  const entry = executionPlans.get(plan);
  if (!entry || entry.used) reject();
  entry.used = true;
  const parent = getObservationSessionOwnerHostBinding(entry.options.parentOwner);
  if (JSON.stringify(parent.session.exportSnapshot()) !== entry.source) reject();
  const owner = await createDelegatedObservationSessionOwner({ ...entry.options, registry });
  let execution: DelegatedChildExecutionInstallation | undefined;
  const recallTool = createObservationReadTool(owner);
  try {
    registry.registerTool(recallTool);
    if (entry.options.installChildExecution) {
      const installed = await entry.options.installChildExecution(Object.freeze({ owner, session: entry.options.session, registry, recallTool }));
      if (!installed || typeof installed.dispose !== 'function') reject();
      const dispose = installed.dispose.bind(installed), bindRegistry = typeof installed.bindRegistry === 'function' ? installed.bindRegistry.bind(installed) : undefined;
      const prepareManagedFollowup = installed.prepareManagedFollowup?.bind(installed);
      const assertTurnInput = installed.assertTurnInput?.bind(installed);
      const prepareInitialTurn = installed.prepareInitialTurn?.bind(installed);
      const activateInitialTurn = installed.activateInitialTurn?.bind(installed);
      const prepareManagedChild = installed.prepareManagedChild?.bind(installed);
      let disposal: Promise<void> | undefined;
      execution = Object.freeze({
        dispose: () => disposal ??= Promise.resolve().then(dispose),
        prepareManagedFollowup: prepareManagedFollowup && (async (input: {preparation:unknown;pausedTicket:object}) => {
          if (disposal) reject();
          return prepareManagedFollowup(input);
        }),
        assertTurnInput: assertTurnInput && (() => { if (disposal) reject(); assertTurnInput(); }),
        prepareInitialTurn: prepareInitialTurn && (async () => {
          if (disposal) reject();
          await prepareInitialTurn();
          if (disposal) reject();
        }),
        activateInitialTurn: activateInitialTurn && (async () => {
          if (disposal) reject();
          await activateInitialTurn();
          if (disposal) reject();
        }),
        prepareManagedChild: prepareManagedChild && (async (input: Parameters<NonNullable<DelegatedChildExecutionInstallation['prepareManagedChild']>>[0]) => {
          if (disposal) reject();
          const result = await prepareManagedChild(input);
          if (disposal) reject();
          return result;
        }),
        bindRegistry: async (next: ToolRegistry) => {
          if (disposal) reject();
          const binding = bindings.get(owner)!;
          binding.validate(); owner.assertSession(binding.session); assertToolCeiling(next, binding.allowedNativeToolNames);
          if (!bindRegistry) reject();
          await bindRegistry(next);
          binding.validate(); owner.assertSession(binding.session); assertToolCeiling(next, binding.allowedNativeToolNames);
        },
      });
      if (!bindRegistry) reject();
    }
    assertDelegatedObservationOwner(owner, entry.options.session, registry);
    return Object.freeze({ owner, execution, recallTool, session: entry.options.session, source: getDelegatedObservationHandoff(owner),
      complete: (result: string) => publishDelegatedObservationResult(owner, result, entry.options.captureApproval?.approval) });
  } catch (error) {
    try { await execution?.dispose(); } finally { owner.dispose(); }
    throw error;
  }
}

const rotationTickets = new WeakMap<object, { owner: ObservationSessionOwner; binding: NonNullable<ReturnType<typeof bindings.get>>;
  definitions: string; permission: ReturnType<ToolRegistry['getObservationPermissionRevisionPort']>; revision: number; used: boolean }>();
export async function suspendDelegatedObservationOwner(owner: ObservationSessionOwner, registry: ToolRegistry): Promise<object> {
  const binding = bindings.get(owner);
  if (!binding || binding.registry !== registry) reject();
  binding.validate(); owner.assertSession(binding.session);
  const permission = registry.getObservationPermissionRevisionPort();
  const definitions = JSON.stringify(registry.getToolDefinitions()), revision = permission.getRevision();
  const host = getObservationSessionOwnerHostBinding(owner);
  await host.pauseTransport();
  binding.validate(); owner.assertSession(binding.session);
  if (permission.getRevision() !== revision) reject();
  const ticket = Object.freeze({});
  rotationTickets.set(ticket, { owner, binding, definitions, permission, revision, used: false });
  return ticket;
}
/** Host-only observation; does not consume or reactivate the original ticket. */
export function assertDelegatedObservationPaused(owner: ObservationSessionOwner, ticket: object): void {
  const entry=rotationTickets.get(ticket);
  if(!entry||entry.used||entry.owner!==owner||bindings.get(owner)!==entry.binding)reject();
  entry.binding.validate();owner.assertSession(entry.binding.session);
  if(entry.permission.getRevision()!==entry.revision)reject();
  getObservationSessionOwnerHostBinding(owner).assertTransportPaused();
}
export function resumeDelegatedObservationOwner(ticket: object, registry: ToolRegistry): void {
  const entry = rotationTickets.get(ticket);
  if (!entry || entry.used || !(registry instanceof ToolRegistry)) reject();
  entry.used = true;
  entry.binding.validate(); entry.owner.assertSession(entry.binding.session);
  if (entry.binding.registries.has(registry)) reject();
  const current = registry.getObservationPermissionRevisionPort();
  if (current.authority !== entry.permission.authority || current.getRevision() !== entry.revision
    || entry.permission.getRevision() !== entry.revision || JSON.stringify(registry.getToolDefinitions()) !== entry.definitions) reject();
  assertToolCeiling(registry, entry.binding.allowedNativeToolNames);
  if (entry.binding.allowedNativeToolNames) registry.setAllowedTools([...entry.binding.allowedNativeToolNames, 'observation_read']);
  getObservationSessionOwnerHostBinding(entry.owner).resumeTransport();
  entry.binding.registry = registry; entry.binding.registries.add(registry);
}

export async function publishDelegatedObservationResult(owner: ObservationSessionOwner, result: string, approval?: ObservationDelegationApproval): Promise<string> {
  const binding = bindings.get(owner);
  if (!binding || typeof result !== 'string') reject();
  binding.validate(); owner.assertSession(binding.session);
  const child = getObservationSessionOwnerHostBinding(owner), parent = getObservationSessionOwnerHostBinding(binding.parentOwner);
  const known = new Set(parent.session.getProtectedObservationClosure()?.observations.map(ref => ref.observationId) ?? []);
  const newIds = (binding.session.getProtectedObservationClosure()?.observations ?? []).filter(ref => !known.has(ref.observationId)).map(ref => ref.observationId);
  if (newIds.length) {
    if (!approval) reject();
    const capability = child.service.issueDelegationReturn({ requestSource: 'agent', caller: child.caller, approval, recipient: parent.caller,
      observationIds: newIds, destination: child.destination });
    child.service.attachDelegationReturn({ capability, recipient: parent.caller });
  }
  await adoptDelegatedObservationClosure(binding.parentOwner, owner);
  binding.validate(); owner.assertSession(binding.session);
  return result;
}
