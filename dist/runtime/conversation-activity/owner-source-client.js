/** Hints only. The daemon independently reads the native facts. */
export class ConversationActivityAttachedSources {
    client;
    constructor(client) {
        this.client = client;
    }
    startWatch(_watchId) { return Promise.resolve(); }
    stopWatch(_watchId) { }
    refreshGroup(workId, _changed = false) { return this.client.request('hint', { source: 'agent_group', workId }); }
    refreshProject(workId, _changed = false) { return this.client.request('hint', { source: 'kswarm', workId }); }
    projectConnectionChanged(_status) { return Promise.resolve(); }
    dispose() { }
}
