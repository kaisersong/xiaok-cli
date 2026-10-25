import {persistCompoundPublicationSnapshot} from '../../src/runtime/sol-pi/product-compound-coordinator.js';
import { dirname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { computeSessionHistoryDigest } from '../../src/ai/runtime/session-store/store.js';
import { assertDelegatedObservationOwner } from '../../src/runtime/sol-pi/delegated-session-owner.js';
import type { DesktopAgentExecutionContext, DesktopObservationChildPreparation } from './desktop-multi-agent-service.js';
import { DesktopMultiAgentService } from './desktop-multi-agent-service.js';
import type { GroupObservationReferenceTicket } from '../../src/runtime/task-host/task-runtime-host.js';
import { AgentSessionState } from '../../src/ai/runtime/session.js';
import type { ToolRegistry } from '../../src/ai/tools/index.js';
import { getObservationSessionOwnerHostBinding, bindObservationPublicationBarrier, type ObservationSessionOwner } from '../../src/runtime/sol-pi/observation-session-owner.js';
import { desktopObservationSessionId } from '../../src/runtime/task-host/protected-observation-store.js';
import type { DesktopExecutionPersistence } from '../../src/runtime/task-host/protected-observation-store.js';
import type { SemanticCompactionOwner, SemanticCompactionOutcome } from '../../src/runtime/sol-pi/semantic-compaction-owner.js';
import { describeCompoundExecutionStatus, type CompoundExecutionStatus } from '../../src/runtime/sol-pi/compound-status.js';
import type { SemanticCompactionStatus } from '../../src/runtime/sol-pi/semantic-status.js';
export interface DesktopObservationBinding { readonly opaqueDesktopObservationBinding: never }
interface Claims { delegated?: { service: DesktopMultiAgentService; context: DesktopAgentExecutionContext }; groupReference?: { service: DesktopMultiAgentService; ticket: GroupObservationReferenceTicket; context: DesktopAgentExecutionContext }; taskId: string; session: AgentSessionState; owner: ObservationSessionOwner; registry: ToolRegistry;
  semanticCompactionOwner?: SemanticCompactionOwner; semanticBoundaryPending?: boolean; semanticOutcome?: SemanticCompactionOutcome }
const bindings = new WeakMap<object, Claims>();
/** Main-only port; never exposed in IPC, tool arguments or persisted DTOs. */
export function bindDesktopObservationSession(input: Claims): DesktopObservationBinding {
  if (input.session.exportSnapshot().sessionId !== desktopObservationSessionId(input.taskId)) throw new Error('SOL_PI_DESKTOP_SESSION_MISMATCH');
  input.owner.assertSession(input.session);
  const binding = Object.freeze(Object.create(null)) as DesktopObservationBinding;
  bindings.set(binding, { ...input }); return binding;
}
export function requireDesktopObservationBinding(binding: DesktopObservationBinding, taskId: string, registry: ToolRegistry): Readonly<Claims> {
  const claims = bindings.get(binding);
  if (!claims || claims.taskId !== taskId || claims.registry !== registry) throw new Error('SOL_PI_DESKTOP_OBSERVATION_NOT_READY');
  if (claims.groupReference) {
    const facts = claims.groupReference.service.requirePublishedGroupObservationReference(claims.groupReference.ticket);
    if (facts.taskId !== taskId || facts.owner !== claims.owner || facts.session !== claims.session) throw new Error('SOL_PI_DESKTOP_OBSERVATION_NOT_READY');
  }
  if(claims.delegated){claims.delegated.service.assertInvocation(claims.delegated.context.actor,claims.delegated.context);assertDelegatedObservationOwner(claims.owner,claims.session,registry);}
  claims.owner.assertSession(claims.session); return claims;
}
/** Main group factory only: alternate task ids require the actual service's
 * completed reference journal, never a caller-provided canonical id or boolean. */
export function bindDesktopGroupObservationSession(input: { service: DesktopMultiAgentService; ticket: GroupObservationReferenceTicket;
  registry: ToolRegistry; semanticCompactionOwner?: SemanticCompactionOwner }): DesktopObservationBinding {
  if (!(input.service instanceof DesktopMultiAgentService)) throw new Error('SOL_PI_DESKTOP_OBSERVATION_NOT_READY');
  const facts = input.service.requirePublishedGroupObservationReference(input.ticket);
  const binding = Object.freeze(Object.create(null)) as DesktopObservationBinding;
  bindings.set(binding, { taskId: facts.taskId, session: facts.session, owner: facts.owner, registry: input.registry,
    semanticCompactionOwner: input.semanticCompactionOwner, groupReference: { service: input.service, ticket: input.ticket, context: facts.context } });
  return binding;
}
/** A real D1 child, not a structural observationOwner option. Prepared bindings
 * remain unusable until the service has committed and activated the actor. */
export function bindDesktopDelegatedObservationSession(input: { service: DesktopMultiAgentService; context: DesktopAgentExecutionContext;
  owner: ObservationSessionOwner; session: AgentSessionState; registry: ToolRegistry; preparation?: DesktopObservationChildPreparation }): DesktopObservationBinding {
  if (!(input.service instanceof DesktopMultiAgentService)) throw Error('SOL_PI_DESKTOP_OBSERVATION_NOT_READY');
  if (input.preparation) {
    if (input.service.assertObservationChildPreparation(input.preparation).context !== input.context) throw Error('SOL_PI_DESKTOP_OBSERVATION_NOT_READY');
  } else input.service.assertInvocation(input.context.actor, input.context);
  assertDelegatedObservationOwner(input.owner, input.session, input.registry);
  if (input.session.exportSnapshot().sessionId !== desktopObservationSessionId(input.context.agentId)) throw Error('SOL_PI_DESKTOP_SESSION_MISMATCH');
  const binding = Object.freeze(Object.create(null)) as DesktopObservationBinding;
  bindings.set(binding, { taskId: input.context.agentId, owner: input.owner, session: input.session, registry: input.registry,
    delegated: { service: input.service, context: input.context } });
  return binding;
}

/** Main host completion callback only. No renderer/model DTO may issue this event. */
export function notifyDesktopObservationSubtaskBoundary(binding:DesktopObservationBinding):void {
  const claims=bindings.get(binding);if(!claims)throw Error('SOL_PI_DESKTOP_OBSERVATION_NOT_READY');
  claims.owner.assertSession(claims.session);claims.semanticBoundaryPending=true;
}
export function takeDesktopSemanticBoundary(binding:DesktopObservationBinding):boolean {
  const claims=bindings.get(binding);if(!claims)throw Error('SOL_PI_DESKTOP_OBSERVATION_NOT_READY');
  const groupPending=claims.groupReference?claims.groupReference.service.takeGroupSubtaskBoundary({actor:claims.groupReference.context.actor,requestSource:'agent',ticket:claims.groupReference.ticket}):false;
  const pending=claims.semanticBoundaryPending===true||groupPending;claims.semanticBoundaryPending=false;return pending;
}
export function recordDesktopSemanticOutcome(binding:DesktopObservationBinding,outcome:SemanticCompactionOutcome):void {
  const claims=bindings.get(binding);if(!claims)throw Error('SOL_PI_DESKTOP_OBSERVATION_NOT_READY');
  claims.semanticOutcome=outcome;
}


type ProductOwner = Awaited<ReturnType<typeof import('../../src/runtime/sol-pi/product-bootstrap.js').createProductObservationOwner>>;
interface DesktopProductHost { compoundStorage?:import('../../src/runtime/sol-pi/compound-host-storage.js').CompoundHostStorage; prepareManagedChild(args:Parameters<import('../../src/runtime/sol-pi/product-compound-coordinator.js').ProductCompoundCoordinator['prepareManagedChild']>[0]):ReturnType<import('../../src/runtime/sol-pi/product-compound-coordinator.js').ProductCompoundCoordinator['prepareManagedChild']>; product: ProductOwner; session: AgentSessionState; persistHistory(snapshot: import('../../src/ai/runtime/session.js').AgentSessionSnapshot):Promise<void>; createTurnRegistry(extraTools?:readonly import('../../src/types.js').Tool[]): Promise<ToolRegistry>; releaseTurnRegistry(registry: ToolRegistry): Promise<void> }
const productHosts = new WeakMap<object, DesktopProductHost>();
/** Main-only introspection of an actual product factory result. */
export function requireDesktopProductHost(binding: DesktopObservationBinding): Readonly<DesktopProductHost> {
  const value = productHosts.get(binding);
  if (!value) throw Error('SOL_PI_DESKTOP_PRODUCT_UNKNOWN');
  value.product.owner.assertSession(value.session); return value;
}

/** Product factory: uses the same production policy/capacity/redactor as CLI. */
export async function createDesktopProductObservationBinding(input: {
  taskId: string; cwd: string; policy: import('../../src/runtime/sol-pi/product-bootstrap.js').ProductObservationPolicy;
  sourceRegistry: ToolRegistry; profileRoot: string; environmentRoot: string; credentialSecrets: string[];
  permissionMode: import('../../src/ai/permissions/manager.js').PermissionMode;
  onPrompt: import('../../src/ai/tools/index.js').RegistryOptions['onPrompt'];
  persist: (snapshot: import('../../src/ai/runtime/session.js').AgentSessionSnapshot) => Promise<void>;
  executionPersistence?: DesktopExecutionPersistence;
  onPublication?: () => Promise<void>;
  authorizeValidationMaterials?: Parameters<typeof import('../../src/runtime/sol-pi/product-validation-backend.js').createProductValidationBackend>[0]['authorize'];
}): Promise<{ binding: DesktopObservationBinding; registry: ToolRegistry; notifySubtaskBoundary():void; stopNewCapture(): void; revoke(): void; getMode(): 'active'|'recall-only'|'revoked'; diagnostics(): { projection: ReturnType<ObservationSessionOwner['getProjectionDiagnostics']>; protectedObservations: number; semantic?: SemanticCompactionStatus; compound?:CompoundExecutionStatus }; dispose(): Promise<void> }> {
  const { createProductObservationOwner, describeProductObservationPolicy } = await import('../../src/runtime/sol-pi/product-bootstrap.js');
  const session = new AgentSessionState();
  const sessionId = desktopObservationSessionId(input.taskId);
  session.restoreSnapshot({ ...session.exportSnapshot(), sessionId, cwd: input.cwd, lineage: [sessionId] });
  const allowed = new Set(['read','bash','edit','write','glob','grep','ls']);
  const nativeNames = input.sourceRegistry.getToolDefinitions().map(tool => tool.name).filter(name => allowed.has(name));
  const registry = input.sourceRegistry.forkForObservation([], nativeNames, { mode: input.permissionMode, onPrompt: input.onPrompt });
  let executionPersistence=input.executionPersistence;
  let compoundStorage:import('../../src/runtime/sol-pi/compound-host-storage.js').CompoundHostStorage|undefined;
  if(describeProductObservationPolicy(input.policy).compoundExecution){
    if(!executionPersistence?.routeCanonical)throw Error('SOL_PI_COMPOUND_CANONICAL_PERSISTENCE_REQUIRED');
    const {resolveCompoundHostStorage}=await import('../../src/runtime/sol-pi/compound-host-storage.js');
    compoundStorage=resolveCompoundHostStorage({configRoot:dirname(input.profileRoot),desktopDataRoot:dirname(dirname(executionPersistence.root))});
    executionPersistence=executionPersistence.routeCanonical(compoundStorage);
  }
  const hostPersist=input.persist, groupPublication=input.onPublication;
  const persistHistory=async(value:import('../../src/ai/runtime/session.js').AgentSessionSnapshot)=>{
    const basis=session.getPublishedHistoryBasis(),snapshot=structuredClone(value);
    if(!compoundStorage){await hostPersist(snapshot);session.notePublishedHistory(snapshot,basis);return;}
    const publication=persistCompoundPublicationSnapshot(session,snapshot);
    if(publication)await publication;else await executionPersistence!.store.save(snapshot);
    const durable=await executionPersistence!.store.load(snapshot.sessionId);
    if(!durable||durable.sessionId!==snapshot.sessionId||durable.storeRevision!==(snapshot.storeRevision??0)+1
      ||computeSessionHistoryDigest(durable)!==computeSessionHistoryDigest(snapshot)
      || !isDeepStrictEqual(durable.protectedObservationClosure,snapshot.protectedObservationClosure))throw Error('SOL_PI_CANONICAL_PUBLICATION_CHANGED');
    await hostPersist(durable);
    // The TaskHost barrier may await other work. Only this exact committed
    // history may advance the live publisher basis; metadata receipts cannot.
    const current=await executionPersistence!.store.load(snapshot.sessionId);
    if(!current||current.storeRevision!==durable.storeRevision||current.historyDigest!==durable.historyDigest
      ||computeSessionHistoryDigest(current)!==computeSessionHistoryDigest(durable))throw Error('SOL_PI_CANONICAL_PUBLICATION_CHANGED');
    session.notePublishedHistory(durable,basis);
  };
  let product: Awaited<ReturnType<typeof createProductObservationOwner>> | undefined;
  let verificationClient:Awaited<ReturnType<typeof import('../../src/runtime/verification/controller-client.js').createInstalledVerificationClient>>|undefined;
  let compoundCoordinator:import('../../src/runtime/sol-pi/product-compound-coordinator.js').ProductCompoundCoordinator|undefined;
  try {
    product = await createProductObservationOwner({ policy: input.policy, session,
      profileRoot: input.profileRoot, environmentRoot: input.environmentRoot, credentialSecrets: input.credentialSecrets,
      permissionManager: registry.getObservationPermissionRevisionPort(), persist: persistHistory, hostCwd: input.cwd, executionPersistence, compoundStorage });
    registry.registerTool(product.recallTool); registry.setAllowedTools([...nativeNames, 'observation_read']);
    if(product.summary.compoundExecution){
      if(!executionPersistence?.registerAlias||!product.compoundDomain||!product.executionAuthority)throw Error('SOL_PI_COMPOUND_PERSISTENCE_REQUIRED');
      const lease=await product.executionAuthority.acquire({invocationId:`desktop-alias:${sessionId}`,kind:'recovery'});
      try{await executionPersistence.registerAlias(product.compoundDomain,lease);}finally{await lease.releaseAfterDrain();}
      const {installProductCompoundCoordinator}=await import('../../src/runtime/sol-pi/product-compound-coordinator.js');
      let validationBackend:import('../../src/runtime/sol-pi/compound-validation.js').CompoundValidationBackend|undefined;
      if(input.authorizeValidationMaterials){
        const {createInstalledVerificationClient}=await import('../../src/runtime/verification/controller-client.js');
        const {createProductValidationBackend}=await import('../../src/runtime/sol-pi/product-validation-backend.js');
        verificationClient=await createInstalledVerificationClient();
        await verificationClient.requireQualifiedExecution();
        const active=product;
        const assertCurrent=()=>{active.executionSignal.throwIfAborted();active.owner.assertSession(session);
          if(active.getStatus().revoked||Date.now()>=active.summary.expiresAt)throw Error('SOL_PI_DESKTOP_VALIDATION_AUTHORIZATION_REVOKED');};
        assertCurrent();
        validationBackend=createProductValidationBackend({workspaceRoot:input.cwd,expiresAt:active.summary.expiresAt,
          client:verificationClient,authorize:input.authorizeValidationMaterials,assertCurrent});
      }
      if(!product.compoundDomain||!executionPersistence.getCompoundTreeStore)throw Error('SOL_PI_DESKTOP_COMPOUND_TREE_STORE_REQUIRED');
      compoundCoordinator=await installProductCompoundCoordinator({product,session,store:executionPersistence.getCompoundTreeStore(product.compoundDomain),root:executionPersistence.root,registry,validationBackend});
    }
    if(compoundStorage||groupPublication)bindObservationPublicationBarrier(product.owner,async facts=>{
      if(compoundStorage){
        const basis=session.getPublishedHistoryBasis();
        const durable=await executionPersistence!.store.load(facts.sessionId);
        if(!durable||durable.historyDigest!==basis||computeSessionHistoryDigest(durable)!==basis
          || session.getPublishedHistoryBasis()!==basis||!isDeepStrictEqual(durable.protectedObservationClosure,facts.closure))throw Error('SOL_PI_CANONICAL_PUBLICATION_CHANGED');
        await hostPersist(durable);
      }
      await groupPublication?.();
    });
    const binding = bindDesktopObservationSession({taskId:input.taskId,session,owner:product.owner,registry,semanticCompactionOwner:product.semanticCompactionOwner});
    const turnRegistries = new Map<ToolRegistry, readonly import('../../src/types.js').Tool[]>();
    let retainedRootRegistry: ToolRegistry | undefined;
    let ownerRetired = false;
    const stopOwnerRetirementObservation = getObservationSessionOwnerHostBinding(product.owner).onDispose(() => { ownerRetired = true; });
    const freshRootRegistry = (extraTools: readonly import('../../src/types.js').Tool[]) => {
      product!.owner.assertSession(session);
      const next = compoundCoordinator ? registry.forkForCompoundObservation([product!.recallTool], nativeNames)
        : registry.forkForObservation([product!.recallTool], nativeNames);
      try {
        for (const tool of extraTools) next.registerTool(tool);
        next.setAllowedTools([...nativeNames, product!.recallTool.definition.name, ...extraTools.map(tool => tool.definition.name)]);
        return next;
      } catch (error) { next.dispose(); throw error; }
    };
    productHosts.set(binding, Object.freeze({ product, session, persistHistory,compoundStorage, prepareManagedChild:async(args:Parameters<import('../../src/runtime/sol-pi/product-compound-coordinator.js').ProductCompoundCoordinator['prepareManagedChild']>[0])=>{if(!compoundCoordinator)throw Error('SOL_PI_DESKTOP_CHILD_COMPOUND_ADMISSION_REQUIRED');return compoundCoordinator.prepareManagedChild(args);}, async createTurnRegistry(extraTools:readonly import('../../src/types.js').Tool[]=[]) {
      const capturedTools = Object.freeze([...extraTools]);
      const next = freshRootRegistry(capturedTools);
      try {
        await compoundCoordinator?.rebindRegistry(next);
        retainedRootRegistry?.dispose(); retainedRootRegistry = undefined;
        turnRegistries.set(next, capturedTools); return next;
      } catch (error) { next.dispose(); throw error; }
    }, async releaseTurnRegistry(turn: ToolRegistry) {
      const capturedTools = turnRegistries.get(turn);
      if (!capturedTools) throw Error('SOL_PI_DESKTOP_TURN_REGISTRY_UNKNOWN');
      turnRegistries.delete(turn);
      let retained: ToolRegistry | undefined;
      try {
        if (compoundCoordinator) {
          // Drain the original turn even when whole-group close has retired
          // its owner. Only a still-live private Main owner restores a registry.
          const restored = await compoundCoordinator.retireCurrentRegistry(() => {
            if (ownerRetired) return undefined;
            retained = freshRootRegistry(capturedTools); return retained;
          });
          if (restored) { retainedRootRegistry = retained; retained = undefined; }
        }
      } finally { retained?.dispose(); turn.dispose(); }
    } }));
    let disposal:Promise<void>|undefined;
    return { binding, registry, notifySubtaskBoundary:()=>notifyDesktopObservationSubtaskBoundary(binding),
      stopNewCapture: () => product!.owner.stopNewCapture(), revoke: () => product!.revoke(), getMode: () => product!.getStatus().revoked ? 'revoked' : product!.owner.getMode(),
      diagnostics: () => {
        const value=bindings.get(binding)?.semanticOutcome,policy=product!.summary.semanticCompaction;
        const records=session.exportSnapshot().semanticCompaction?.reservations??[];
        const compound=product!.summary.compoundExecution?describeCompoundExecutionStatus(session.exportSnapshot().compoundOperations):undefined;
        const semantic:SemanticCompactionStatus|undefined=policy?{mode:policy.mode,state:value?.status??'waiting',
          ...(value?.reason?{reason:(value.reason==='insufficient_benefit'?'economics':value.reason==='stale_revision'?'changed':value.reason.includes('gain')?'no-gain':value.reason.includes('budget')?'budget':'unavailable') as SemanticCompactionStatus['reason']}:{ }),
          attempts:records.length,maxAttempts:policy.maxCalls,reservedCostUnits:records.reduce((sum,row)=>sum+row.maximumCostUnits,0),maxCostUnits:policy.maxCostUnits}:undefined;
        return {projection:product!.owner.getProjectionDiagnostics(),protectedObservations:session.getProtectedObservationClosure()?.observations.length??0,...(semantic?{semantic}:{}),...(compound?{compound}:{})};},
      dispose() { if(disposal)return disposal;bindings.delete(binding);productHosts.delete(binding);disposal=(async()=>{try{await compoundCoordinator?.dispose();}finally{try{verificationClient?.dispose();}finally{try{stopOwnerRetirementObservation();for(const turn of turnRegistries.keys())turn.dispose();turnRegistries.clear();retainedRootRegistry?.dispose();retainedRootRegistry=undefined;registry.dispose();}finally{await product!.dispose();}}}})();return disposal; } };
  } catch (error) { try{await compoundCoordinator?.dispose();}finally{try{verificationClient?.dispose();}finally{registry.dispose();await product?.dispose();}}throw error; }
}

export interface DesktopObservationTaskActivation {
  group?: Awaited<ReturnType<typeof import('./desktop-observation-group.js').createDesktopProductObservationGroup>>;
  authorizeValidationMaterials?: Parameters<typeof import('../../src/runtime/sol-pi/product-validation-backend.js').createProductValidationBackend>[0]['authorize'];
  policy: import('../../src/runtime/sol-pi/product-bootstrap.js').ProductObservationPolicy;
  profileRoot: string;
  environmentRoot: string;
  onPrompt: import('../../src/ai/tools/index.js').RegistryOptions['onPrompt'];
  live?: Pick<Awaited<ReturnType<typeof createDesktopProductObservationBinding>>, 'diagnostics'|'stopNewCapture'|'revoke'|'getMode'|'dispose'>;
  consumed: boolean;
  revoked?: boolean;
  diagnostics?: ReturnType<Awaited<ReturnType<typeof createDesktopProductObservationBinding>>['diagnostics']>;
}
