import {sessionReadSdk,sessionReadStatKind,sessionReadMissing} from './source-read-sdk.js';
import {assertSourceSyncCustodyContext} from '../../../runtime/task-host/source-sync-custody.js';
import {existsSync,readFileSync,lstatSync} from 'node:fs';import {join} from 'node:path';
import {getConfigDir} from '../../../utils/config.js';
import {parseFileSessionSnapshot,parseSessionDeletionJournal,type SessionDeletionJournal} from './file-session-parser.js';
import {captureMigrationMarker,type SessionMigrationMarker} from './migration.js';
import {readSessionAliasBinding} from './aliases.js';
import {readCompoundDeletionBytes} from './compound-deletion-read.js';
import type {CompoundDeletionBudget} from './compound-deletion-census.js';
import type {StoredSessionSnapshot} from './store.js';
function statIfPresent(path: string,context?:object) {
  try { return sessionReadSdk(context,'stat',lstatSync,[path]); } catch (error) { if (sessionReadMissing(error)) return undefined; throw error; }
}
const originalReaders=new WeakSet<object>(),readerHas=WeakSet.prototype.has,readerAdd=WeakSet.prototype.add,apply=Reflect.apply;
export class FileSessionReader {readonly #rootDir:string;constructor(rootDir=join(getConfigDir(),'sessions')){this.#rootDir=rootDir;apply(readerAdd,originalReaders,[this]);}
async load(sessionId: string): Promise<StoredSessionSnapshot | null> {
    return this.loadSync(sessionId);
  }
loadSync(sessionId: string): StoredSessionSnapshot | null {
    return this.#readSessionSnapshot(sessionId);
  }
#readSessionSnapshot(sessionId: string, preserveIntent = false,context?:object): StoredSessionSnapshot | null {
    if (this.#readSessionMigration(sessionId,context)) throw Error('MIGRATED_SESSION');
    const deletion = this.#readDeletionJournal(sessionId,undefined,context);
    if (deletion?.state === 'pending') throw new Error('session_deletion_pending');
    if (deletion) return null;
    const filePath = this.#getFilePath(sessionId);
    if (!sessionReadSdk(context,'boolean',existsSync,[filePath])) {
      return null;
    }

    return parseFileSessionSnapshot(sessionReadSdk(context,'string',readFileSync,[filePath,'utf8']), sessionId, preserveIntent);
  }
#getFilePath(sessionId: string): string {
    if (typeof sessionId !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(sessionId)) throw new Error('invalid_session_id');
    return join(this.#rootDir, `${sessionId}.json`);
  }
#migrationPath(sessionId: string): string {
    this.#getFilePath(sessionId); return join(this.#rootDir, '.migrations', `${sessionId}.json`);
  }
#readSessionMigration(sessionId: string,context?:object): SessionMigrationMarker | null {
    const file = this.#migrationPath(sessionId); const stat = statIfPresent(file,context);
    if (!stat) return null;
    if (sessionReadStatKind(sessionReadSdk(context,'stat',lstatSync,[join(this.#rootDir,'.migrations')]),'symlink') || !sessionReadStatKind(stat,'file') || sessionReadStatKind(stat,'symlink') || stat.size > 16384) throw Error('session_migration_invalid');
    const marker = captureMigrationMarker(JSON.parse(sessionReadSdk(context,'string',readFileSync,[file,'utf8'])));
    if (marker.sessionId !== sessionId) throw Error('session_migration_invalid'); return marker;
  }
#deletionDirectory(context?:object): string {
    const root = statIfPresent(this.#rootDir,context);
    if (root && (!sessionReadStatKind(root,'directory') || sessionReadStatKind(root,'symlink'))) throw new Error('session_delete_unsafe_root');
    const directory = join(this.#rootDir, '.deletions'); const stat = statIfPresent(directory,context);
    if (stat && (!sessionReadStatKind(stat,'directory') || sessionReadStatKind(stat,'symlink'))) throw new Error('session_delete_unsafe_journal');
    return directory;
  }
#readDeletionJournal(sessionId: string,budget?:CompoundDeletionBudget,context?:object): SessionDeletionJournal | undefined {
    this.#getFilePath(sessionId);
    const file = join(this.#deletionDirectory(context), `${sessionId}.json`); const stat = statIfPresent(file,context);
    if (!stat) return undefined;
    if (!sessionReadStatKind(stat,'file') || sessionReadStatKind(stat,'symlink') || stat.size > 8 * 1024 * 1024) throw new Error('session_delete_invalid_journal');
    let value: SessionDeletionJournal;
    try { value = JSON.parse((budget?budget.read(file):readCompoundDeletionBytes(file,8*1024*1024,context)).toString('utf8')) as SessionDeletionJournal; } catch (cause) { throw new Error('session_delete_invalid_journal',{cause}); }
    return parseSessionDeletionJournal(value,sessionId);
  }
#loadSessionAliasSync(holder: { holderRoot: string; holderId: string },context?:object) {
    const binding = readSessionAliasBinding(this.#rootDir, holder,context);
    if (!binding) return null;
    const snapshot = this.#readSessionSnapshot(binding.targetSessionId,false,context);
    if (!snapshot?.executionProtected) throw Error('session_alias_target_unavailable');
    return { binding, snapshot };
  }
readSessionSnapshot(sessionId:string,preserveIntent=false,context?:object){return this.#readSessionSnapshot(sessionId,preserveIntent,context);}
getFilePath(sessionId:string){return this.#getFilePath(sessionId);}
migrationPath(sessionId:string){return this.#migrationPath(sessionId);}
readSessionMigration(sessionId:string){return this.#readSessionMigration(sessionId);}
deletionDirectory(){return this.#deletionDirectory();}
readDeletionJournal(sessionId:string,budget?:CompoundDeletionBudget,context?:object){return this.#readDeletionJournal(sessionId,budget,context);}
loadSessionAliasSync(holder:{holderRoot:string;holderId:string},context?:object){return this.#loadSessionAliasSync(holder,context);}

}
const originalRead=FileSessionReader.prototype.readSessionSnapshot,originalAlias=FileSessionReader.prototype.loadSessionAliasSync;
export function readOriginalSessionReader(reader:unknown,sessionId:string,context:object):StoredSessionSnapshot|null{
 if(!apply(readerHas,originalReaders,[reader]))throw Error('ORIGINAL_SESSION_READER_REQUIRED');
 assertSourceSyncCustodyContext(context);
 return apply(originalRead,reader,[sessionId,false,context]);
}
export function readOriginalSessionReaderAlias(reader:unknown,holder:{holderRoot:string;holderId:string},context:object){
 if(!apply(readerHas,originalReaders,[reader]))throw Error('ORIGINAL_SESSION_READER_REQUIRED');
 assertSourceSyncCustodyContext(context);
 return apply(originalAlias,reader,[holder,context]);
}
