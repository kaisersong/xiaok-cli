import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdirSync, realpathSync, lstatSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { syncDirectoryTreeStrict } from '../../utils/atomic-file.js';
import { canonicalVerificationJson } from './protocol.js';
import { ControllerGrantStore } from './controller-grants.js';
import { startControllerIpc } from './controller-ipc.js';
import { ExecutionJournal } from '../isolated-execution/execution-journal.js';
const methods = ['controller.status', 'execution.query', 'execution.reserve', 'execution.dispatch', 'execution.cancel', 'completion.query', 'completion.propose'];
export function encodeControllerRequest(request) { return Buffer.from(canonicalVerificationJson({ version: 1, ...request })); }
function parseRequest(body) {
    const input = JSON.parse(body.toString('utf8'));
    if (!input || Array.isArray(input) || Object.keys(input).sort().join(',') !== 'grant,method,payload,requestId,version' || input.version !== 1 || typeof input.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(input.requestId) || !methods.includes(input.method))
        throw Error('controller_request_schema');
    const grant = input.grant;
    if (!grant || Array.isArray(grant) || Object.keys(grant).sort().join(',') !== 'id,secret' || typeof grant.id !== 'string' || typeof grant.secret !== 'string')
        throw Error('controller_request_schema');
    // Canonical wire form rejects duplicates and invalid UTF-8 as well as signature-ambiguous encodings.
    if (!Buffer.from(canonicalVerificationJson(input)).equals(body))
        throw Error('controller_request_encoding');
    return input;
}
/** Actual daemon lifecycle and private capability boundary; qualification comes from installed factories. */
export async function createControllerDaemon(options) {
    mkdirSync(options.root, { recursive: true, mode: 0o700 });
    if (lstatSync(options.root).isSymbolicLink() || !lstatSync(options.root).isDirectory())
        throw Error('controller_root');
    const root = realpathSync(options.root);
    const lockPath = join(root, 'controller-owner.sqlite');
    for (const path of [lockPath, lockPath + '-journal', lockPath + '-wal', lockPath + '-shm'])
        if (existsSync(path) && (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink() || lstatSync(path).nlink !== 1))
            throw Error('controller_lock_path');
    if (existsSync(lockPath + '-wal') || existsSync(lockPath + '-shm'))
        throw Error('controller_lock_wal');
    const NativeDatabase = createRequire(import.meta.url)('better-sqlite3');
    const lock = new NativeDatabase(lockPath, { timeout: 0 });
    let grants;
    let journal;
    let ipc;
    try {
        lock.pragma('journal_mode=DELETE');
        lock.pragma('synchronous=FULL');
        const pageSize = lock.pragma('page_size', { simple: true });
        const maximumPages = Math.floor(1024 ** 2 / pageSize);
        if (lock.pragma(`max_page_count=${maximumPages}`, { simple: true }) > maximumPages)
            throw Error('controller_lock_limit');
        lock.exec('BEGIN EXCLUSIVE');
        syncDirectoryTreeStrict(root);
        const socketPath = process.platform === 'win32' ? '\\\\.\\pipe\\xiaok-verification-' + createHash('sha256').update(root.toLowerCase()).digest('hex').slice(0, 32) : join(root, 'controller.sock');
        if (process.platform !== 'win32' && existsSync(socketPath)) {
            const existing = lstatSync(socketPath);
            // Only under the actual exclusive lifetime lock may the service retire its own abandoned socket.
            if (!existing.isSocket() || existing.uid !== process.getuid?.())
                throw Error('controller_stale_endpoint_unknown');
            unlinkSync(socketPath);
            syncDirectoryTreeStrict(root);
        }
        grants = new ControllerGrantStore(root);
        journal = new ExecutionJournal(root);
        journal.recoverInterrupted();
        const hostGrants = grants;
        ipc = await startControllerIpc({ socketPath, requestTimeoutMs: 300000, dispatch: async (body, signal) => {
                let requestId;
                try {
                    const request = parseRequest(body);
                    requestId = request.requestId;
                    const caller = hostGrants.consume(request.grant, request.method, request.payload, Date.now());
                    if (signal.aborted)
                        throw Error('controller_request_aborted');
                    const result = request.method === 'controller.status'
                        ? { protocolVersion: 1, businessHandlersAvailable: !!options.handlers }
                        : options.handlers ? await options.handlers.invoke(request.method, request.payload, caller, signal) : (() => { throw Error('controller_handler_unavailable'); })();
                    return Buffer.from(canonicalVerificationJson({ version: 1, requestId, result }));
                }
                catch {
                    return Buffer.from(canonicalVerificationJson({ version: 1, ...(requestId ? { requestId } : {}), error: { code: 'controller_request_rejected' } }));
                }
            } });
        let closing;
        return Object.freeze({ socketPath,
            issueGrant(input) { if (closing)
                throw Error('controller_closing'); return hostGrants.issue(input, Date.now()); },
            revokePrincipal(principalId) { if (closing)
                throw Error('controller_closing'); hostGrants.revokePrincipal(principalId); },
            close() { return closing ??= (async () => { try {
                await ipc.close();
            }
            finally {
                try {
                    journal.close();
                }
                finally {
                    try {
                        hostGrants.close();
                    }
                    finally {
                        lock.close();
                    }
                }
            } })(); },
        });
    }
    catch (error) {
        try {
            await ipc?.close();
        }
        finally {
            try {
                journal?.close();
            }
            finally {
                try {
                    grants?.close();
                }
                finally {
                    lock.close();
                }
            }
        }
        throw error;
    }
}
