import {readCapturedGroupsSchema} from '../verification/groups-source-schema.js';
import {DSH_A_PROFILE,DSH_A_DIGEST} from '../multi-agent/dsh-admission-data.js';
import { DatabaseSync } from 'node:sqlite';
import { join, resolve } from 'node:path';
import { readNativeSessionIdentity } from '../../ai/runtime/session-store/identity.js';
import type { ActivityThreadIdentity } from './service.js';

/** Existing identity repositories only, with no executor boot claim or mutation. */
export class ActivityNativeIdentityRepository {
  private db?: DatabaseSync;
  constructor(private readonly options: { profileId: string; kind: 'desktop' | 'cli'; path: string; instanceId?: string; workspaceRoot?: string }) {
    if (options.kind === 'desktop') {
      this.db = new DatabaseSync(options.path, { readOnly: true });
      try {
        const version = (this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
        if (version === 5) {
          const schema = this.db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all() as unknown as Parameters<typeof readCapturedGroupsSchema>[0];
          readCapturedGroupsSchema(schema, 5);
          const floor = this.db.prepare('SELECT profile,digest FROM dsh_a_profile WHERE singleton=1').get();
          if (floor?.profile !== DSH_A_PROFILE || floor.digest !== DSH_A_DIGEST) throw Error('activity_native_identity_schema_unsupported');
        }
        if (version !== 3 && version !== 4 && version !== 5) throw Error('activity_native_identity_schema_unsupported');
      } catch (error) {
        this.db.close();
        throw error;
      }
    }
  }
  getThread(threadId: string): ActivityThreadIdentity | null {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,255}$/.test(threadId)) return null;
    if (this.db) {
      const row = this.db.prepare('SELECT profile_id,workspace_id,delete_state FROM thread_bindings WHERE thread_id=?').get(threadId) as { profile_id: string; workspace_id: string; delete_state: ActivityThreadIdentity['deleteState'] } | undefined;
      return row && row.profile_id === this.options.profileId ? { threadId, profileId: row.profile_id, workspaceId: row.workspace_id, deleteState: row.delete_state } : null;
    }
    const identity = readNativeSessionIdentity(join(this.options.path, `${threadId}.json`));
    return identity?.sessionId === threadId && (!this.options.workspaceRoot || resolve(identity.cwd) === resolve(this.options.workspaceRoot)) ? { threadId, profileId: this.options.profileId, workspaceId: resolve(identity.cwd), deleteState: 'none' } : null;
  }
  authorizeProducer(threadId: string, instanceId = this.options.instanceId): boolean {
    const thread = this.getThread(threadId); if (!thread || thread.deleteState !== 'none') return false;
    if (this.db) return true;
    const identity = readNativeSessionIdentity(join(this.options.path, `${threadId}.json`));
    return Boolean(instanceId && identity?.ownership?.state === 'owned' && identity.ownership.ownerInstanceId === instanceId);
  }
  close(): void { this.db?.close(); }
}
