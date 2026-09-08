import type { ExecutionAuthorizationUserSnapshot, MultiAgentDesktopAPI } from '../../../shared/multi-agent-types';

export interface LocalExecutionState {
  phase: 'loading' | 'live' | 'error';
  authorization?: ExecutionAuthorizationUserSnapshot;
  workspace: { state: 'loading' | 'ready' | 'error'; cwd?: string };
}
const unavailable: LocalExecutionState = { phase: 'error', workspace: { state: 'error' } };
const owners = new WeakMap<MultiAgentDesktopAPI, LocalExecutionAuthorization>();
export function localExecutionAuthorization(api: MultiAgentDesktopAPI | undefined): LocalExecutionAuthorization | undefined {
  if (!api?.subscribeLocalExecutionAuthorization) return undefined;
  let owner = owners.get(api);
  if (!owner) { owner = new LocalExecutionAuthorization(api); owners.set(api, owner); }
  return owner;
}
export const unavailableLocalExecutionState = unavailable;

/** One push-only read owner per preload API, shared by settings and the right surface. */
export class LocalExecutionAuthorization {
  private state: LocalExecutionState = { phase: 'loading', workspace: { state: 'loading' } };
  private listeners = new Set<() => void>();
  private session?: { id: string; retiredBoots: Set<string> };
  private workspaceRead?: Promise<void>;
  constructor(readonly api: MultiAgentDesktopAPI) {}
  getSnapshot = (): LocalExecutionState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (!this.session) this.start();
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size && this.session) {
        const old = this.session; this.session = undefined;
        this.publish({ ...this.state, phase: 'loading' });
        void this.api.unsubscribeLocalExecutionAuthorization({ subscriptionId: old.id }).catch(() => {});
      }
    };
  };
  private publish(state: LocalExecutionState): void { this.state = state; for (const listener of this.listeners) listener(); }
  private accept(next: ExecutionAuthorizationUserSnapshot, session: NonNullable<LocalExecutionAuthorization['session']>): void {
    if (this.session !== session || session.retiredBoots.has(next.bootId)) return;
    const old = this.state.authorization;
    if (old?.bootId === next.bootId) {
      if (next.permissionRevision < old.permissionRevision) return;
      if (next.permissionRevision === old.permissionRevision) {
        if (old.persistenceState === 'confirmed' && (next.persistenceState !== 'confirmed' || next.executionAllowed !== old.executionAllowed)) return;
        if (old.persistenceState === 'unknown') {
          const pending = old.pendingOperation;
          if (next.persistenceState === 'confirmed' && pending?.executionAllowed === false && next.executionAllowed) return;
          if (next.persistenceState === 'unknown' && pending) {
            const incoming = next.pendingOperation;
            if (!incoming || incoming.operationId !== pending.operationId || incoming.expectedPermissionRevision !== pending.expectedPermissionRevision
              || incoming.executionAllowed !== pending.executionAllowed || incoming.confirm !== true) return;
          }
        }
      }
    } else if (old) session.retiredBoots.add(old.bootId);
    const authorization = { ...next, ...(next.persistenceState === 'confirmed' ? { pendingOperation: undefined } : {}) };
    this.publish({ ...this.state, phase: 'live', authorization });
  }
  private start(): void {
    const session = { id: `exec-auth-ui:${crypto.randomUUID()}`, retiredBoots: new Set<string>() };
    this.session = session;
    this.publish({ ...this.state, phase: 'loading' });
    const receive = (event: { subscriptionId: string; authorization: ExecutionAuthorizationUserSnapshot }) => {
      if (event.subscriptionId === session.id) this.accept(event.authorization, session);
    };
    void this.api.subscribeLocalExecutionAuthorization({ subscriptionId: session.id }, receive).then(receive).catch(() => {
      if (this.session === session) this.publish({ ...this.state, phase: 'error' });
    });
    this.workspaceRead ??= Promise.resolve().then(() => this.api.getLocalExecutionWorkspace({})).then(
      ({ cwd }) => this.publish({ ...this.state, workspace: { state: 'ready', cwd } }),
      () => this.publish({ ...this.state, workspace: { state: 'error' } }),
    );
  }
  refresh = async (): Promise<void> => {
    const session = this.session; if (!session) return;
    const next = await this.api.getLocalExecutionAuthorization({}); this.accept(next, session);
  };
}
