import { createRequire } from 'node:module';
import { mkdirSync, lstatSync, realpathSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { VERIFICATION_BUDGET } from './protocol.js';
import { syncDirectoryTreeStrict } from '../../utils/atomic-file.js';
const privateFreeze = Object.freeze;
const privateCreate = Object.create, privateApply = Reflect.apply, privateDescriptor = Object.getOwnPropertyDescriptor, privatePrototype = Object.getPrototypeOf;
const privateRequire = createRequire(import.meta.url);
const NativeDatabase = privateRequire('better-sqlite3');
const privateCppSymbol = privateRequire(join(dirname(privateRequire.resolve('better-sqlite3')), 'util.js')).cppdb;
const nativeConnections = new WeakMap();
/** Only the actual no-verbose private opener mints this code/data-access context. No authority is supplied. */
export function readPrivateDatabaseNativeAccess(db) { return nativeConnections.get(db); }
/** Bounded private storage, not evidence that its enclosing OS identity is qualified. */
export function openPrivateVerificationDatabase(inputRoot) {
    mkdirSync(inputRoot, { recursive: true, mode: 0o700 });
    if (lstatSync(inputRoot).isSymbolicLink() || !lstatSync(inputRoot).isDirectory())
        throw Error('verification_database_path');
    const root = realpathSync(inputRoot), path = join(root, 'authority.sqlite');
    for (const name of [path, path + '-journal', path + '-wal', path + '-shm']) {
        if (existsSync(name) && (lstatSync(name).isSymbolicLink() || !lstatSync(name).isFile() || lstatSync(name).nlink !== 1))
            throw Error('verification_database_path');
    }
    if (existsSync(path + '-wal') || existsSync(path + '-shm'))
        throw Error('verification_database_wal');
    const options = privateCreate(null);
    options.timeout = 0;
    options.verbose = null;
    options.nativeBinding = null;
    const db = new NativeDatabase(path, options);
    const cpp = privateDescriptor(db, privateCppSymbol).value, cppPrototype = privatePrototype(cpp), databasePrototype = privatePrototype(db);
    const prepare = privateDescriptor(cppPrototype, 'prepare').value;
    const probe = privateApply(prepare, cpp, ['SELECT 1', db, false, false]), statementPrototype = privatePrototype(probe);
    const statement = {};
    for (const key of ['raw', 'get', 'all', 'columns', 'safeIntegers'])
        statement[key] = privateDescriptor(statementPrototype, key).value;
    const fingerprints = [];
    for (const target of [db, databasePrototype, cpp, cppPrototype])
        for (const key of ['prepare', 'pragma', 'open'])
            fingerprints.push({ target, key, descriptor: privateDescriptor(target, key) });
    for (const key of Object.keys(statement))
        fingerprints.push({ target: statementPrototype, key, descriptor: privateDescriptor(statementPrototype, key) });
    const access = privateFreeze({ cpp, symbol: privateCppSymbol, prepare, open: privateDescriptor(cpp, 'open').get, statement: privateFreeze(statement), databasePrototype, cppPrototype, statementPrototype, fingerprints: privateFreeze(fingerprints.map(entry => privateFreeze({ ...entry, descriptor: entry.descriptor ? privateFreeze({ ...entry.descriptor }) : undefined }))) });
    try {
        db.pragma('journal_mode=DELETE');
        db.pragma('synchronous=FULL');
        const max = Math.floor(VERIFICATION_BUDGET.controlDatabaseBytes / db.pragma('page_size', { simple: true }));
        if (db.pragma(`max_page_count=${max}`, { simple: true }) > max || db.pragma('page_count', { simple: true }) > max)
            throw Error('verification_capacity_exhausted');
        syncDirectoryTreeStrict(root);
        nativeConnections.set(db, access);
        return db;
    }
    catch (error) {
        db.close();
        throw error;
    }
}
