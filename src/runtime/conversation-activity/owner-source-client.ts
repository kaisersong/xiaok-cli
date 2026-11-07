import type { ConversationActivityOwnerClient } from './owner-client.js';
/** Hints only. The daemon independently reads the native facts. */
export class ConversationActivityAttachedSources {
  constructor(private readonly client: ConversationActivityOwnerClient) {}
  startWatch(_watchId: string): Promise<void> { return Promise.resolve(); }
  stopWatch(_watchId: string): void {}
  refreshGroup(workId: string, _changed = false): Promise<void> { return this.client.request('hint', { source: 'agent_group', workId }); }
  refreshProject(workId: string, _changed = false): Promise<void> {
    return this.client.hintProject(workId).catch(error=>{
      if(!this.client.isProjectForwardUnsupported(error))throw error;
      // A legacy hint is negative routing only. It cannot clear the new
      // client's dirty state or mint a project receive receipt.
      return this.client.request('hint',{source:'kswarm',workId});
    });
  }
  projectConnectionChanged(status: 'connected' | 'disconnected' | 'reconnecting'): Promise<void> { return this.client.projectConnectionChanged(status); }
  dispose(): void {}
}
