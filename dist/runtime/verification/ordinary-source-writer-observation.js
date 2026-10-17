import { realpathSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { readInstalledCurrentProfile } from './migration-markers.js';
import { registerOrdinaryProfileSource } from './ordinary-profile-source-registry.js';
/** Routing check only: no source completeness, ownership or custody grant. */
export function assertOrdinarySourceWriterRoute() {
    if (readInstalledCurrentProfile().kind !== 'ordinary')
        throw Error('ordinary_source_route');
}
/** Original directory writer discovery only; this grants no protected writer
 * or source custody. The caller must retain its own original mutation lock. */
export function observeOrdinaryDirectoryWriter(path, kind) {
    assertOrdinarySourceWriterRoute();
    if (process.platform === 'win32')
        return;
    registerOrdinaryProfileSource({ kind, directory: realpathSync(path) });
}
/** Called after the original SQLite open and before its first schema/data write.
 * Windows ordinary absence is verified first; its POSIX inventory stays unknown. */
export function observeOrdinarySQLiteWriter(path, snapshotFormat) {
    assertOrdinarySourceWriterRoute();
    if (process.platform === 'win32' || path === ':memory:' || path === '')
        return;
    const absolute = resolve(path);
    registerOrdinaryProfileSource({ kind: 'sqlite-db', directory: realpathSync(dirname(absolute)), databaseBasename: basename(absolute), snapshotFormat });
}
