import { DatabaseSync } from 'node:sqlite';
import { join, resolve } from 'node:path';
import { readNativeSessionIdentity } from '../../ai/runtime/session-store/identity.js';
/** Existing identity repositories only, with no executor boot claim or mutation. */
export class ActivityNativeIdentityRepository {
    options;
    db;
    constructor(options) {
        this.options = options;
        if (options.kind === 'desktop') {
            this.db = new DatabaseSync(options.path, { readOnly: true });
            const version = this.db.prepare('PRAGMA user_version').get().user_version;
            if (![3, 4].includes(version)) {
                this.db.close();
                throw new Error('activity_native_identity_schema_unsupported');
            }
        }
    }
    getThread(threadId) {
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,255}$/.test(threadId))
            return null;
        if (this.db) {
            const row = this.db.prepare('SELECT profile_id,workspace_id,delete_state FROM thread_bindings WHERE thread_id=?').get(threadId);
            return row && row.profile_id === this.options.profileId ? { threadId, profileId: row.profile_id, workspaceId: row.workspace_id, deleteState: row.delete_state } : null;
        }
        const identity = readNativeSessionIdentity(join(this.options.path, `${threadId}.json`));
        return identity?.sessionId === threadId && (!this.options.workspaceRoot || resolve(identity.cwd) === resolve(this.options.workspaceRoot)) ? { threadId, profileId: this.options.profileId, workspaceId: resolve(identity.cwd), deleteState: 'none' } : null;
    }
    authorizeProducer(threadId, instanceId = this.options.instanceId) {
        const thread = this.getThread(threadId);
        if (!thread || thread.deleteState !== 'none')
            return false;
        if (this.db)
            return true;
        const identity = readNativeSessionIdentity(join(this.options.path, `${threadId}.json`));
        return Boolean(instanceId && identity?.ownership?.state === 'owned' && identity.ownership.ownerInstanceId === instanceId);
    }
    close() { this.db?.close(); }
}
