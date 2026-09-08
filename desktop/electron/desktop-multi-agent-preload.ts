import type { MultiAgentDesktopAPI, MultiAgentTransport, MultiAgentSubscriptionResult, ExecutionAuthorizationTransport } from '../shared/multi-agent-types.js';

interface Ipc {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, listener: (event: unknown, data: unknown) => void): void;
  off(channel: string, listener: (event: unknown, data: unknown) => void): void;
}

/** Kept behavior-identical to sandboxed preload.cjs; parity BDD loads both entrypoints. */
function createSubscription<Push extends { subscriptionId: string }, Result>(ipc: Ipc, channel: string, subscribeKey: string, unsubscribeKey: string) {
  const subscriptions = new Map<string, (event: unknown, data: unknown) => void>();
  const pending = new Set<string>();
  return {
    async subscribe(input: { subscriptionId: string }, handler: (event: Push) => void): Promise<Result> {
      const id = input.subscriptionId;
      if (subscriptions.has(id) || pending.has(id)) throw new Error('duplicate multi-agent subscription');
      const listener = (_event: unknown, data: unknown) => {
        if (subscriptions.get(id) !== listener || !data || typeof data !== 'object' || (data as Push).subscriptionId !== id) return;
        handler(data as Push);
      };
      subscriptions.set(id, listener); pending.add(id); ipc.on(channel, listener);
      try {
        const result = await ipc.invoke(`desktop:${subscribeKey}`, input) as Result;
        if (subscriptions.get(id) !== listener) {
          await ipc.invoke(`desktop:${unsubscribeKey}`, { subscriptionId: id });
          throw new Error('multi-agent subscription cancelled');
        }
        return result;
      } catch (error) {
        if (subscriptions.get(id) === listener) {
          subscriptions.delete(id);
          void ipc.invoke(`desktop:${unsubscribeKey}`, { subscriptionId: id }).catch(() => undefined);
        }
        ipc.off(channel, listener); throw error;
      } finally { pending.delete(id); }
    },
    async unsubscribe(input: { subscriptionId: string }) {
      const listener = subscriptions.get(input.subscriptionId);
      if (listener) { subscriptions.delete(input.subscriptionId); ipc.off(channel, listener); }
      await ipc.invoke(`desktop:${unsubscribeKey}`, input);
    },
  };
}

export function createMultiAgentPreload(ipc: Ipc): MultiAgentDesktopAPI {
  const agents = createSubscription<MultiAgentTransport, MultiAgentSubscriptionResult>(ipc, 'desktop:multiAgentEvent', 'subscribeMultiAgents', 'unsubscribeMultiAgents');
  const authorization = createSubscription<ExecutionAuthorizationTransport, ExecutionAuthorizationTransport>(ipc,
    'desktop:localExecutionAuthorizationChanged', 'subscribeLocalExecutionAuthorization', 'unsubscribeLocalExecutionAuthorization');
  const invoke = <K extends keyof MultiAgentDesktopAPI>(key: K, input: unknown) =>
    ipc.invoke(`desktop:${key}`, input) as ReturnType<MultiAgentDesktopAPI[K]>;
  return {
    getLocalExecutionWorkspace: input => invoke('getLocalExecutionWorkspace', input),
    getMultiAgentApproval: input => invoke('getMultiAgentApproval', input),
    decideMultiAgentApproval: input => invoke('decideMultiAgentApproval', input),
    getLocalExecutionAuthorization: input => invoke('getLocalExecutionAuthorization', input),
    setLocalExecutionAuthorization: input => invoke('setLocalExecutionAuthorization', input),
    getLocalExecutionAuthorizationOperation: input => invoke('getLocalExecutionAuthorizationOperation', input),
    subscribeLocalExecutionAuthorization: authorization.subscribe,
    unsubscribeLocalExecutionAuthorization: authorization.unsubscribe,
    getMultiAgentSnapshot: input => invoke('getMultiAgentSnapshot', input),
    listMultiAgentGroups: input => invoke('listMultiAgentGroups', input),
    listMultiAgents: input => invoke('listMultiAgents', input),
    getMultiAgentEvents: input => invoke('getMultiAgentEvents', input),
    getAgentContent: input => invoke('getAgentContent', input),
    getMultiAgentOperation: input => invoke('getMultiAgentOperation', input),
    getMultiAgentResources: input => invoke('getMultiAgentResources', input),
    resolveMultiAgentResource: input => invoke('resolveMultiAgentResource', input),
    resetMultiAgentGroup: input => invoke('resetMultiAgentGroup', input),
    getMultiAgentThreadDeletion: input => invoke('getMultiAgentThreadDeletion', input),
    deleteMultiAgentThread: input => invoke('deleteMultiAgentThread', input),
    sendAgentMessage: input => invoke('sendAgentMessage', input),
    followupAgent: input => invoke('followupAgent', input),
    interruptAgent: input => invoke('interruptAgent', input),
    closeAgent: input => invoke('closeAgent', input),
    subscribeMultiAgents: agents.subscribe,
    unsubscribeMultiAgents: agents.unsubscribe,
  };
}
