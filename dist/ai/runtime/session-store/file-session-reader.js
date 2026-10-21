import { existsSync, readFileSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir } from '../../../utils/config.js';
import { parseFileSessionSnapshot, parseSessionDeletionJournal } from './file-session-parser.js';
import { captureMigrationMarker } from './migration.js';
import { readSessionAliasBinding } from './aliases.js';
import { readCompoundDeletionBytes } from './compound-deletion-read.js';
function statIfPresent(path) {
    try {
        return lstatSync(path);
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return undefined;
        throw error;
    }
}
export class FileSessionReader {
    rootDir;
    constructor(rootDir = join(getConfigDir(), 'sessions')) {
        this.rootDir = rootDir;
    }
    async load(sessionId) {
        return this.loadSync(sessionId);
    }
    loadSync(sessionId) {
        return this.readSessionSnapshot(sessionId);
    }
    readSessionSnapshot(sessionId, preserveIntent = false) {
        if (this.readSessionMigration(sessionId))
            throw Error('MIGRATED_SESSION');
        const deletion = this.readDeletionJournal(sessionId);
        if (deletion?.state === 'pending')
            throw new Error('session_deletion_pending');
        if (deletion)
            return null;
        const filePath = this.getFilePath(sessionId);
        if (!existsSync(filePath)) {
            return null;
        }
        return parseFileSessionSnapshot(readFileSync(filePath, 'utf8'), sessionId, preserveIntent);
    }
    getFilePath(sessionId) {
        if (typeof sessionId !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(sessionId))
            throw new Error('invalid_session_id');
        return join(this.rootDir, `${sessionId}.json`);
    }
    migrationPath(sessionId) {
        this.getFilePath(sessionId);
        return join(this.rootDir, '.migrations', `${sessionId}.json`);
    }
    readSessionMigration(sessionId) {
        const file = this.migrationPath(sessionId);
        const stat = statIfPresent(file);
        if (!stat)
            return null;
        if (lstatSync(join(this.rootDir, '.migrations')).isSymbolicLink() || !stat.isFile() || stat.isSymbolicLink() || stat.size > 16384)
            throw Error('session_migration_invalid');
        const marker = captureMigrationMarker(JSON.parse(readFileSync(file, 'utf8')));
        if (marker.sessionId !== sessionId)
            throw Error('session_migration_invalid');
        return marker;
    }
    deletionDirectory() {
        const root = statIfPresent(this.rootDir);
        if (root && (!root.isDirectory() || root.isSymbolicLink()))
            throw new Error('session_delete_unsafe_root');
        const directory = join(this.rootDir, '.deletions');
        const stat = statIfPresent(directory);
        if (stat && (!stat.isDirectory() || stat.isSymbolicLink()))
            throw new Error('session_delete_unsafe_journal');
        return directory;
    }
    readDeletionJournal(sessionId, budget) {
        this.getFilePath(sessionId);
        const file = join(this.deletionDirectory(), `${sessionId}.json`);
        const stat = statIfPresent(file);
        if (!stat)
            return undefined;
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024)
            throw new Error('session_delete_invalid_journal');
        let value;
        try {
            value = JSON.parse((budget ? budget.read(file) : readCompoundDeletionBytes(file, 8 * 1024 * 1024)).toString('utf8'));
        }
        catch {
            throw new Error('session_delete_invalid_journal');
        }
        return parseSessionDeletionJournal(value, sessionId);
    }
    loadSessionAliasSync(holder) {
        const binding = readSessionAliasBinding(this.rootDir, holder);
        if (!binding)
            return null;
        const snapshot = this.readSessionSnapshot(binding.targetSessionId);
        if (!snapshot?.executionProtected)
            throw Error('session_alias_target_unavailable');
        return { binding, snapshot };
    }
}
