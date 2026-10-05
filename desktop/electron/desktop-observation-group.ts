import {waitForCompoundFinalPublication} from '../../src/runtime/sol-pi/compound-publication-producer.js';
import { describeProductObservationPolicy } from '../../src/runtime/sol-pi/product-bootstrap.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { DesktopMultiAgentService, type DesktopAgentExecutionContext } from './desktop-multi-agent-service.js';
import { InProcessTaskRuntimeHost } from '../../src/runtime/task-host/task-runtime-host.js';
import { DesktopTaskObservationStore } from '../../src/runtime/task-host/protected-observation-store.js';
import { createDesktopProductObservationBinding, requireDesktopProductHost, bindDesktopGroupObservationSession,
  notifyDesktopObservationSubtaskBoundary, type DesktopObservationBinding } from './desktop-observation-owner.js';
import { createDesktopObservationGroupLifetime } from './desktop-observation-group-lifetime.js';
import type { ToolRegistry } from '../../src/ai/tools/index.js';
import type { PermissionMode } from '../../src/ai/permissions/manager.js';

type OrdinaryInput = Parameters<typeof createDesktopProductObservationBinding>[0];
export interface DesktopObservationGroupTurn {
  binding: DesktopObservationBinding; registry: ToolRegistry; signal: AbortSignal; publishHistory():Promise<void>; notifySubtaskBoundary(): void;
}
/** One actual product/native session per authorized Desktop group. No model DTO
 * can supply a service actor, source store, grant or publisher implementation. */
export async function createDesktopProductObservationGroup(input: Omit<OrdinaryInput, 'persist'|'executionPersistence'> & {
  service: DesktopMultiAgentService; host: InProcessTaskRuntimeHost; observationStore: DesktopTaskObservationStore;
  context: DesktopAgentExecutionContext;
}) {
  const { service, host, observationStore, context, taskId, permissionMode } = input;
  if (!(service instanceof DesktopMultiAgentService) || !(host instanceof InProcessTaskRuntimeHost)
    || !(observationStore instanceof DesktopTaskObservationStore) || !describeProductObservationPolicy(input.policy).ordinaryChildren)
    throw Error('SOL_PI_DESKTOP_GROUP_AUTHORIZATION_REQUIRED');
  service.assertInvocation(context.actor, context);
  service.assertFreshObservationGroup(context);
  if (context.sourceTaskId !== taskId) throw Error('SOL_PI_DESKTOP_GROUP_TASK_MISMATCH');
  const invocation = new AsyncLocalStorage<Readonly<{ context: DesktopAgentExecutionContext; taskId: string }>>();
  let groupAuthority: ReturnType<DesktopMultiAgentService['bindObservationGroupLifetime']> | undefined;
  const assertCurrent = () => { if (groupAuthority) groupAuthority.assertCurrent(); else service.assertInvocation(context.actor, context); };
  const persistence = observationStore.getExecutionPersistence(taskId, () => {
    if (groupAuthority) groupAuthority.assertIdentity(); else service.assertInvocation(context.actor, context);
  });
  let publishReference:(()=>Promise<void>)|undefined;
  const live = await createDesktopProductObservationBinding({ ...input, executionPersistence: persistence,
    onPublication:async()=>{if(!publishReference)throw Error('SOL_PI_DESKTOP_GROUP_PUBLICATION_NOT_READY');await publishReference();},
    persist: async snapshot => { assertCurrent(); if(!observationStore.publishCanonicalFacts(taskId,snapshot))await observationStore.persistSession(taskId, snapshot); assertCurrent(); } });
  const privateHost = requireDesktopProductHost(live.binding), { product, session } = privateHost;
  const lifetime = createDesktopObservationGroupLifetime({ owner: product.owner, registry: live.registry, dispose: () => live.dispose() });
  let disposal: Promise<void> | undefined;
  let rootTail: Promise<unknown> = Promise.resolve();
  const publish = async () => {
    assertCurrent();
    const current = invocation.getStore();
    if (!current) throw Error('SOL_PI_DESKTOP_GROUP_PUBLICATION_CONTEXT_REQUIRED');
    service.assertInvocation(current.context.actor, current.context);
    const ticket = service.prepareGroupObservationReference({ actor: current.context.actor, requestSource: 'agent',
      taskId: current.taskId, operationId: randomUUID() });
    await host.publishGroupObservationReference(ticket);
    assertCurrent(); return ticket;
  };
  try {
    service.registerGroupObservationOwner({ actor: context.actor, requestSource: 'agent', owner: product.owner, canonicalTaskId: taskId });
    groupAuthority = service.bindObservationGroupLifetime(context.actor, product.owner);
    publishReference=async()=>{await publish();};
    session.addProtectedObservationReferences([]);
    await privateHost.persistHistory(session.exportSnapshot());
    const stop = () => { lifetime.revoke(); void groupAuthority!.requestClose().catch(() => {}); };
    groupAuthority.signal.addEventListener('abort', stop, { once: true });
    if (groupAuthority.signal.aborted) stop();
    function dispose(): Promise<void> {
      return disposal ??= (async () => { groupAuthority!.signal.removeEventListener('abort', stop); product.executionSignal.removeEventListener('abort', stop);
        await lifetime.dispose(); groupAuthority!.release();
      })();
    }
    groupAuthority.onClose(dispose);
    product.executionSignal.addEventListener('abort', stop, { once: true });
    if (product.executionSignal.aborted) stop();
    return Object.freeze({
      groupId: groupAuthority.groupId,
      product,
      productBinding: live.binding,
      observationStore,
      session,
      diagnostics: live.diagnostics,
      stopNewCapture: live.stopNewCapture,
      revoke() { product.revoke(); lifetime.revoke(); },
      getMode: live.getMode,
      dispose: () => groupAuthority!.requestClose(),
      holdChildPreparation(preparation: import('./desktop-multi-agent-service.js').DesktopObservationChildPreparation) {
        const facts=service.assertObservationChildPreparation(preparation);assertCurrent();
        if(facts.context.groupId!==groupAuthority!.groupId)throw Error('SOL_PI_DESKTOP_GROUP_TASK_MISMATCH');
        return lifetime.holdPreparation();
      },
      runChild: lifetime.runChild,
      runChildTurn<T>(childContext: DesktopAgentExecutionContext, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
        assertCurrent();service.assertInvocation(childContext.actor,childContext);
        if(childContext.groupId!==groupAuthority!.groupId)throw Error('SOL_PI_DESKTOP_GROUP_TASK_MISMATCH');
        return lifetime.runChild(signal=>invocation.run(Object.freeze({context:childContext,taskId}),()=>work(signal)));
      },
      async runRootTurn<T>(next: DesktopAgentExecutionContext, mode: PermissionMode, signal: AbortSignal,
        work: (turn: DesktopObservationGroupTurn) => Promise<T>,extraTools:readonly import('../../src/types.js').Tool[]=[]): Promise<T> {
        const capturedTools=Object.freeze([...extraTools]);
        const pending = rootTail.then(async () => {
        assertCurrent(); service.assertInvocation(next.actor, next);
        if (next.groupId !== groupAuthority!.groupId || !next.sourceTaskId) throw Error('SOL_PI_DESKTOP_GROUP_TASK_MISMATCH');
        if (mode !== permissionMode) { product.revoke(); throw Error('SOL_PI_DESKTOP_GROUP_PERMISSION_CHANGED'); }
        await waitForCompoundFinalPublication(product.owner,signal);
        assertCurrent();service.assertInvocation(next.actor,next);
        const registry = await privateHost.createTurnRegistry(capturedTools);
        try { return await lifetime.runRootTurn(registry, signal, bound => invocation.run(Object.freeze({ context: next, taskId: next.sourceTaskId! }), async () => {
          const ticket = await publish();
          const binding = bindDesktopGroupObservationSession({ service, ticket, registry, semanticCompactionOwner: product.semanticCompactionOwner });
          let publishedRevision:number|undefined;
          const publishHistory=async()=>{assertCurrent();await privateHost.persistHistory(session.exportSnapshot());await publish();publishedRevision=session.planCompaction().sourceRevision;};
          const result = await work({ binding, registry, signal: bound, publishHistory, notifySubtaskBoundary: () => notifyDesktopObservationSubtaskBoundary(binding) });
          assertCurrent();if(publishedRevision!==session.planCompaction().sourceRevision)await publishHistory();
          return result;
        })); } finally { await privateHost.releaseTurnRegistry(registry); }
        });
        rootTail = pending.catch(() => {});
        return pending;
      },
    });
  } catch (error) { await lifetime.dispose(); groupAuthority?.release(); throw error; }
}
