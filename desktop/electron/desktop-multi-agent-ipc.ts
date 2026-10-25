import { registerIpcHandler, type IpcStageHelpers } from './ipc-runtime.js';
import { captureIpcData } from './ipc-data-snapshot.js';
import { multiAgentWireSchema, multiAgentInputSchema, readMultiAgentId, readMultiAgentInteger, type MultiAgentWireRecord } from './multi-agent-ipc-input.js';
import { MULTI_AGENT_OUTPUT_SCHEMAS, MULTI_AGENT_RISK_TAGS, type MultiAgentIpcKey } from './multi-agent-ipc-contract.js';
import type { DesktopMultiAgentService, DesktopMultiAgentUserAccess, DesktopWorkspaceUserAccess } from './desktop-multi-agent-service.js';
import type { MultiAgentEnvelope } from '../shared/multi-agent-types.js';

export interface MultiAgentIpcSender {
  id: number; mainFrame: object; isDestroyed(): boolean; send(channel: string, data: unknown): void;
  on(name: string, listener: (...args: any[]) => void): unknown;
  removeListener(name: string, listener: (...args: any[]) => void): unknown;
}
export interface MultiAgentIpcEvent { sender: MultiAgentIpcSender; senderFrame: object | null }
export interface MultiAgentIpcBoundary { service: DesktopMultiAgentService; ready: Promise<void>; profileId: string; workspaceId: string; cwd: string }
interface Subscription { sender: MultiAgentIpcSender; id: string; access: DesktopMultiAgentUserAccess | DesktopWorkspaceUserAccess; unsubscribe(): void }

/** The Electron adapter must authenticate an exact main-known renderer URL. */
export function registerDesktopMultiAgentIpc(
  ipc: { handle(channel: string, handler: (event: MultiAgentIpcEvent, input: unknown) => unknown): void },
  boundary: MultiAgentIpcBoundary | null | undefined,
  options: { authorize(event: MultiAgentIpcEvent): { actorId: string } | null },
): () => void {
  const subscriptions = new Map<string, Subscription>();
  const viewers = new Map<number, { sender: MultiAgentIpcSender; navigation: (...args: any[]) => void; destroyed: () => void }>();
  let disposed = false;
  const authenticate = (event: MultiAgentIpcEvent) => {
    const principal = !disposed && !event.sender.isDestroyed() && event.senderFrame === event.sender.mainFrame && options.authorize(event);
    if (!principal) throw new Error('multi_agent_unauthorized_sender');
    return principal;
  };
  const releaseViewer = (sender: MultiAgentIpcSender) => {
    const viewer = viewers.get(sender.id);
    if (viewer && viewer.sender === sender && ![...subscriptions.values()].some(item => item.sender === sender)) {
      try { sender.removeListener('did-start-navigation', viewer.navigation); }
      finally { sender.removeListener('destroyed', viewer.destroyed); if (viewers.get(sender.id) === viewer) viewers.delete(sender.id); }
    }
  };
  const remove = (key: string) => {
    const owned = subscriptions.get(key); if (!owned) return;
    try { owned.unsubscribe(); }
    finally { if (subscriptions.get(key) === owned) subscriptions.delete(key); releaseViewer(owned.sender); }
  };
  const removeViewer = (sender: MultiAgentIpcSender) => {
    let firstError: unknown; let failed = false;
    for (const [key, subscription] of [...subscriptions]) if (subscription.sender === sender) {
      try { remove(key); } catch (error) { if (!failed) { firstError = error; failed = true; } else console.error('[multi-agent-ipc] viewer cleanup failed', error); }
    }
    releaseViewer(sender);
    if (failed) throw firstError;
  };
  const watchViewer = (sender: MultiAgentIpcSender) => {
    const existing = viewers.get(sender.id); if (existing) return { viewer: existing, created: false };
    const navigation = (_event: unknown, _url: string, _inPlace: boolean, mainFrame: boolean) => { if (mainFrame) removeViewer(sender); };
    const destroyed = () => removeViewer(sender);
    const viewer = { sender, navigation, destroyed };
    viewers.set(sender.id, viewer); sender.on('did-start-navigation', navigation); sender.on('destroyed', destroyed);
    return { viewer, created: true };
  };
  const id = readMultiAgentId, integer = readMultiAgentInteger;
  const ownedSubscription = (sender: MultiAgentIpcSender, key: string, helpers: IpcStageHelpers<MultiAgentWireRecord>) => {
    const lease = watchViewer(sender);
    let owned: Subscription | undefined;
    helpers.onFailure(() => {
      try {
        if (owned && subscriptions.get(key) === owned) {
          try { owned.unsubscribe(); } finally { if (subscriptions.get(key) === owned) subscriptions.delete(key); }
        }
      } finally {
        if (viewers.get(sender.id) === lease.viewer && ![...subscriptions.values()].some(item => item.sender === sender)) {
          sender.removeListener('did-start-navigation', lease.viewer.navigation);
          sender.removeListener('destroyed', lease.viewer.destroyed);
          viewers.delete(sender.id);
        }
      }
    });
    return { install(subscription: Subscription) { owned = subscription; subscriptions.set(key, subscription); } };
  };
  const register = (
    key: MultiAgentIpcKey, fields: string[], staged: boolean,
    action: (input: MultiAgentWireRecord, event: MultiAgentIpcEvent, helpers?: IpcStageHelpers<MultiAgentWireRecord>) => Promise<unknown>,
  ) => {
    const wireInput = multiAgentWireSchema(fields), input = multiAgentInputSchema(key, fields);
    registerIpcHandler({
      registrar: ipc as never, channel: `desktop:${key}`, input: staged ? input : wireInput.pipe(input),
      ...(staged ? { wireInput, inputStage: 'afterHostAuthorization' as const } : {}),
      output: MULTI_AGENT_OUTPUT_SCHEMAS[key], sourceFile: 'desktop/electron/desktop-multi-agent-ipc.ts', rolloutRound: 5,
      riskTags: MULTI_AGENT_RISK_TAGS[key],
      beforeInput: event => { authenticate(event as unknown as MultiAgentIpcEvent); },
      ...(staged ? {
        beforeOutput: (event: import('electron').IpcMainInvokeEvent): undefined => { authenticate(event as unknown as MultiAgentIpcEvent); },
        outputCheck: (result: unknown): undefined => { if (result !== undefined && Buffer.byteLength(JSON.stringify(result)) > 64 * 1024) throw new Error('multi_agent_wire_limit_exceeded'); },
      } : {}),
      captureOutput: result => captureIpcData(result),
      outputError: (): never => { throw new Error('ipc_contract_violation'); },
      handler: (input, event, helpers) => action(input, event as unknown as MultiAgentIpcEvent, helpers),
    });
  };
  const handler = (key: MultiAgentIpcKey, fields: string[], action: (input: MultiAgentWireRecord, access: DesktopMultiAgentUserAccess, event: MultiAgentIpcEvent, helpers?: IpcStageHelpers<MultiAgentWireRecord>) => unknown) => {
    register(key, fields, true, async (wire, event, helpers) => {
      if (!boundary) throw new Error('multi_agent_unsupported_runner');
      await boundary.ready;
      const principal = authenticate(event); const threadId = id(wire.threadId)!;
      await boundary.service.registerThreadWithOwnership({ threadId, profileId: boundary.profileId, workspaceId: boundary.workspaceId, cwd: boundary.cwd }, 'user');
      authenticate(event);
      const access = boundary.service.createUserAccess({ requestSource: 'user', actorId: principal.actorId, threadId, profileId: boundary.profileId, workspaceId: boundary.workspaceId });
      const input = helpers!.parseInput(wire);
      return await action(input, access, event, helpers);
    });
  };
  const workspaceHandler = (key: MultiAgentIpcKey, fields: string[], action: (input: MultiAgentWireRecord, access: DesktopWorkspaceUserAccess, event: MultiAgentIpcEvent, helpers?: IpcStageHelpers<MultiAgentWireRecord>) => unknown) => {
    register(key, fields, true, async (wire, event, helpers) => {
      if (!boundary) throw new Error('multi_agent_unsupported_runner');
      await boundary.ready;
      const principal = authenticate(event);
      const access = boundary.service.createWorkspaceUserAccess({ requestSource: 'user', actorId: principal.actorId,
        profileId: boundary.profileId, workspaceId: boundary.workspaceId });
      const input = helpers!.parseInput(wire);
      return await action(input, access, event, helpers);
    });
  };
  workspaceHandler('getLocalExecutionAuthorization', [], (_input, access) => boundary!.service.getExecutionAuthorizationForUser({ access, requestSource: 'user' }));
  workspaceHandler('getLocalExecutionWorkspace', [], (_input, access) => boundary!.service.getExecutionWorkspaceForUser({ access, requestSource: 'user' }));
  workspaceHandler('getLocalExecutionAuthorizationOperation', ['operationId'], (input, access) => boundary!.service.getExecutionAuthorizationOperation({ access, requestSource: 'user', operationId: id(input.operationId)! }));
  workspaceHandler('setLocalExecutionAuthorization', ['operationId', 'expectedPermissionRevision', 'executionAllowed', 'confirm'], (input, access) => {
    if (input.confirm !== true) throw new Error('execution authorization requires explicit confirmation');
    if (typeof input.executionAllowed !== 'boolean') throw new Error('invalid authorization argument');
    return boundary!.service.setExecutionAuthorization({ access, requestSource: 'user', operationId: id(input.operationId)!,
      expectedPermissionRevision: integer(input.expectedPermissionRevision), executionAllowed: input.executionAllowed, confirm: true });
  });
  workspaceHandler('subscribeLocalExecutionAuthorization', ['subscriptionId'], (input, access, event, helpers) => {
    const subscriptionId = id(input.subscriptionId)!, key = `${event.sender.id}:${subscriptionId}`;
    if (subscriptions.has(key)) throw new Error('duplicate multi-agent subscription');
    if (subscriptions.size >= 512 || [...subscriptions.values()].filter(item => item.sender === event.sender).length >= 50) throw new Error('multi_agent_subscription_limit');
    const owned = ownedSubscription(event.sender, key, helpers!);
    try {
    const unsubscribe = boundary!.service.subscribeExecutionAuthorization({ access, requestSource: 'user' }, authorization => {
      try { authenticate(event); }
      catch { removeViewer(event.sender); return; }
      // The service has already generated the original user's private
      // projection; no raw pending intent is broadcast across principals.
      event.sender.send('desktop:localExecutionAuthorizationChanged', { subscriptionId, authorization });
    });
    owned.install({ sender: event.sender, id: subscriptionId, access, unsubscribe });
    return { subscriptionId, authorization: boundary!.service.getExecutionAuthorizationForUser({ access, requestSource: 'user' }) };
    } catch (error) { return helpers!.fail(error); }
  });
  register('unsubscribeLocalExecutionAuthorization', ['subscriptionId'], false, async (input, event) => {
    remove(`${event.sender.id}:${id(input.subscriptionId)!}`); return { unsubscribed: true };
  });
  const scope = ['threadId', 'groupId'];
  handler('getMultiAgentSnapshot', scope, (input, access) => boundary!.service.getSnapshot({ access, groupId: id(input.groupId, true) }));
  handler('getMultiAgentApproval', [...scope, 'approvalId', 'inputOffset'], (input, access) => boundary!.service.getApproval({
    access, requestSource: 'user', groupId: id(input.groupId)!, approvalId: id(input.approvalId)!,
    ...(input.inputOffset === undefined ? {} : { inputOffset: integer(input.inputOffset) }),
  }));
  handler('decideMultiAgentApproval', [...scope, 'approvalId', 'operationId', 'decision'], (input, access) => {
    if (input.decision !== 'approve' && input.decision !== 'approve_for_task' && input.decision !== 'deny') throw new Error('invalid approval decision');
    return boundary!.service.decideApproval({ access, requestSource: 'user', groupId: id(input.groupId)!,
      approvalId: id(input.approvalId)!, operationId: id(input.operationId)!, decision: input.decision });
  });
  handler('listMultiAgentGroups', ['threadId', 'cursor'], (input, access) => boundary!.service.listGroups({ access, cursor: id(input.cursor, true) }));
  handler('listMultiAgents', [...scope, 'cursor'], (input, access) => boundary!.service.readAgents({ access, groupId: id(input.groupId)!, cursor: id(input.cursor, true) }));
  handler('getMultiAgentEvents', [...scope, 'afterSeq', 'limit'], (input, access) => boundary!.service.readEvents({ access, groupId: id(input.groupId)!, afterSeq: integer(input.afterSeq, 0), limit: integer(input.limit, 100) }));
  handler('getAgentContent', [...scope, 'contentId', 'offset'], (input, access) => boundary!.service.readContent({ access, groupId: id(input.groupId)!, contentId: id(input.contentId)!, offset: integer(input.offset, 0) }));
  handler('getMultiAgentOperation', [...scope, 'operationId'], (input, access) => boundary!.service.readOperation({ access, groupId: id(input.groupId)!, operationId: id(input.operationId)! }));
  handler('getMultiAgentResources', [...scope, 'cursor'], (input, access) => boundary!.service.readResources({ access, groupId: id(input.groupId)!, cursor: id(input.cursor, true) }));
  handler('resolveMultiAgentResource', [...scope, 'resourceId', 'action', 'operationId'], (input, access) => {
    if (input.action !== 'keep' && input.action !== 'retryCleanup') throw new Error('invalid resource action');
    return boundary!.service.resolveResource({ access, requestSource: 'user', groupId: id(input.groupId)!, resourceId: id(input.resourceId)!, action: input.action, operationId: id(input.operationId)! });
  });
  handler('resetMultiAgentGroup', ['threadId', 'expectedGroupId', 'confirmTerminate', 'operationId'], (input, access) => {
    if (input.confirmTerminate !== true) throw new Error('group reset requires explicit confirmation');
    return boundary!.service.resetGroup({ access, requestSource: 'user', expectedGroupId: input.expectedGroupId === null ? null : id(input.expectedGroupId)!,
      confirmTerminate: true, operationId: id(input.operationId)! });
  });
  handler('getMultiAgentThreadDeletion', ['threadId'], (_input, access) => boundary!.service.readThreadDeletion({ access }));
  handler('deleteMultiAgentThread', ['threadId', 'expectedThreadRevision', 'confirmTerminate', 'operationId'], (input, access) => {
    if (input.confirmTerminate !== true) throw new Error('thread deletion requires explicit confirmation');
    return boundary!.service.deleteThread({ access, requestSource: 'user', operationId: id(input.operationId)!,
      expectedThreadRevision: integer(input.expectedThreadRevision), confirmTerminate: true });
  });
  for (const [name, method, needsMessage] of [
    ['sendAgentMessage', 'userSend', true], ['followupAgent', 'userFollowup', true], ['interruptAgent', 'userInterrupt', false], ['closeAgent', 'userClose', false],
  ] as const) handler(name, [...scope, 'agentId', 'operationId', 'expectedTurn', ...(needsMessage ? ['message'] : [])], (input, access) => {
    const control = { access, requestSource: 'user' as const, groupId: id(input.groupId)!, agentId: id(input.agentId)!, operationId: id(input.operationId)!, expectedTurn: integer(input.expectedTurn) };
    if (needsMessage) {
      if (typeof input.message !== 'string' || Buffer.byteLength(input.message) > 16 * 1024) throw new Error('invalid multi-agent message');
      return boundary!.service[method]({ ...control, message: input.message });
    }
    return boundary!.service[method](control);
  });
  handler('subscribeMultiAgents', [...scope, 'subscriptionId', 'afterSeq'], (input, access, event, helpers) => {
    const subscriptionId = id(input.subscriptionId)!; integer(input.afterSeq, 0);
    const groupId = id(input.groupId, true); const key = `${event.sender.id}:${subscriptionId}`;
    if (subscriptions.has(key)) throw new Error('duplicate multi-agent subscription');
    if (subscriptions.size >= 512 || [...subscriptions.values()].filter(item => item.sender === event.sender).length >= 50) throw new Error('multi_agent_subscription_limit');
    const owned = ownedSubscription(event.sender, key, helpers!);
    try {
    const publish = (envelope: MultiAgentEnvelope) => {
      try { authenticate(event); } catch { removeViewer(event.sender); return; }
      const threadApprovalFailure = envelope.channel === 'runtime_error' && envelope.code === 'multi_agent_approval_persistence_failed'
        && envelope.approvalPersistenceState === 'unknown' && typeof envelope.bootId === 'string' && envelope.threadId === input.threadId;
      if ('groupId' in envelope && groupId && envelope.groupId !== groupId && !threadApprovalFailure) return;
      const transport = { subscriptionId, envelope };
      if (Buffer.byteLength(JSON.stringify(transport)) > 64 * 1024) {
        event.sender.send('desktop:multiAgentEvent', { subscriptionId, envelope: { channel: 'resync_required', groupId: 'groupId' in envelope ? envelope.groupId : groupId } }); return;
      }
      event.sender.send('desktop:multiAgentEvent', transport);
    };
    // Main subscribes and captures S without any await between these operations.
    const unsubscribe = boundary!.service.subscribe(access, publish);
    owned.install({ sender: event.sender, id: subscriptionId, access, unsubscribe });
    return { subscriptionId, snapshot: boundary!.service.getSnapshot({ access, groupId }) };
    } catch (error) { return helpers!.fail(error); }
  });
  register('unsubscribeMultiAgents', ['subscriptionId'], false, async (input, event) => {
    remove(`${event.sender.id}:${id(input.subscriptionId)!}`); return { unsubscribed: true };
  });
  return () => {
    disposed = true; let firstError: unknown; let failed = false;
    for (const viewer of [...viewers.values()]) {
      try { removeViewer(viewer.sender); } catch (error) { if (!failed) { firstError = error; failed = true; } else console.error('[multi-agent-ipc] viewer cleanup failed', error); }
    }
    if (failed) throw firstError;
  };
}
