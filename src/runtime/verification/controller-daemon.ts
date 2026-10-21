import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdirSync, realpathSync, lstatSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { Database } from 'better-sqlite3';
import { syncDirectoryTreeStrict } from '../../utils/atomic-file.js';
import { canonicalVerificationJson } from './protocol.js';
import { ControllerGrantStore, type ControllerGrant, type ControllerCaller, type ControllerRequestSource } from './controller-grants.js';
import { startControllerIpc } from './controller-ipc.js';
import { ExecutionJournal } from '../isolated-execution/execution-journal.js';

const methods = ['controller.status', 'execution.query', 'execution.reserve', 'execution.dispatch', 'execution.cancel', 'completion.query', 'completion.propose'] as const;
export type ControllerMethod = typeof methods[number];
export interface ControllerRequest { requestId: string; method: ControllerMethod; payload: unknown; grant: ControllerGrant }
export function encodeControllerRequest(request: ControllerRequest): Buffer { return Buffer.from(canonicalVerificationJson({ version: 1, ...request })); }
function parseRequest(body: Buffer): ControllerRequest {
  const input = JSON.parse(body.toString('utf8')) as Record<string, unknown>;
  if (!input || Array.isArray(input) || Object.keys(input).sort().join(',') !== 'grant,method,payload,requestId,version' || input.version !== 1 || typeof input.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(input.requestId) || !methods.includes(input.method as ControllerMethod)) throw Error('controller_request_schema');
  const grant = input.grant as ControllerGrant;
  if (!grant || Array.isArray(grant) || Object.keys(grant).sort().join(',') !== 'id,secret' || typeof grant.id !== 'string' || typeof grant.secret !== 'string') throw Error('controller_request_schema');
  // Canonical wire form rejects duplicates and invalid UTF-8 as well as signature-ambiguous encodings.
  if (!Buffer.from(canonicalVerificationJson(input)).equals(body)) throw Error('controller_request_encoding');
  return input as unknown as ControllerRequest;
}
export interface ControllerHandlers {
  invoke(method: Exclude<ControllerMethod, 'controller.status'>, payload: unknown, caller: ControllerCaller, signal: AbortSignal): Promise<unknown>;
}
/** Actual daemon lifecycle and private capability boundary; qualification comes from installed factories. */
export async function createControllerDaemon(options: { root: string; handlers?: ControllerHandlers }): Promise<{
  readonly socketPath: string;
  issueGrant(input: { principalId: string; requestSource: ControllerRequestSource; method: ControllerMethod; payload: unknown; expiresAt: number }): ControllerGrant;
  revokePrincipal(principalId: string): void;
  close(): Promise<void>;
}> {
  mkdirSync(options.root, { recursive: true, mode: 0o700 });
  if (lstatSync(options.root).isSymbolicLink() || !lstatSync(options.root).isDirectory()) throw Error('controller_root');
  const root = realpathSync(options.root);
  const lockPath = join(root, 'controller-owner.sqlite');
  for (const path of [lockPath, lockPath + '-journal', lockPath + '-wal', lockPath + '-shm']) if (existsSync(path) && (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink() || lstatSync(path).nlink !== 1)) throw Error('controller_lock_path');
  if (existsSync(lockPath + '-wal') || existsSync(lockPath + '-shm')) throw Error('controller_lock_wal');
  const NativeDatabase = createRequire(import.meta.url)('better-sqlite3') as typeof import('better-sqlite3');
  const lock: Database = new NativeDatabase(lockPath, { timeout: 0 });
  let grants: ControllerGrantStore | undefined; let journal: ExecutionJournal | undefined;
  let ipc: Awaited<ReturnType<typeof startControllerIpc>> | undefined;
  try {
    lock.pragma('journal_mode=DELETE'); lock.pragma('synchronous=FULL');
    const pageSize = lock.pragma('page_size', { simple: true }) as number;
    const maximumPages = Math.floor(1024 ** 2 / pageSize);
    if ((lock.pragma(`max_page_count=${maximumPages}`, { simple: true }) as number) > maximumPages) throw Error('controller_lock_limit');
    lock.exec('BEGIN EXCLUSIVE'); syncDirectoryTreeStrict(root);
    const socketPath = process.platform === 'win32' ? '\\\\.\\pipe\\xiaok-verification-' + createHash('sha256').update(root.toLowerCase()).digest('hex').slice(0, 32) : join(root, 'controller.sock');
    if (process.platform !== 'win32' && existsSync(socketPath)) {
      const existing = lstatSync(socketPath);
      // Only under the actual exclusive lifetime lock may the service retire its own abandoned socket.
      if (!existing.isSocket() || existing.uid !== process.getuid?.()) throw Error('controller_stale_endpoint_unknown');
      unlinkSync(socketPath); syncDirectoryTreeStrict(root);
    }
    grants = new ControllerGrantStore(root); journal = new ExecutionJournal(root); journal.recoverInterrupted();
    const hostGrants = grants;
    ipc = await startControllerIpc({ socketPath, requestTimeoutMs: 300000, dispatch: async (body, signal) => {
      let requestId: string | undefined;
      try {
        const request = parseRequest(body); requestId = request.requestId;
        const caller = hostGrants.consume(request.grant, request.method, request.payload, Date.now());
        if (signal.aborted) throw Error('controller_request_aborted');
        const result = request.method === 'controller.status'
          ? { protocolVersion: 1, businessHandlersAvailable: !!options.handlers }
          : options.handlers ? await options.handlers.invoke(request.method, request.payload, caller, signal) : (() => { throw Error('controller_handler_unavailable'); })();
        return Buffer.from(canonicalVerificationJson({ version: 1, requestId, result }));
      } catch {
        return Buffer.from(canonicalVerificationJson({ version: 1, ...(requestId ? { requestId } : {}), error: { code: 'controller_request_rejected' } }));
      }
    } });
    let closing: Promise<void> | undefined;
    return Object.freeze({ socketPath,
      issueGrant(input: { principalId: string; requestSource: ControllerRequestSource; method: ControllerMethod; payload: unknown; expiresAt: number }) { if (closing) throw Error('controller_closing'); return hostGrants.issue(input, Date.now()); },
      revokePrincipal(principalId: string) { if (closing) throw Error('controller_closing'); hostGrants.revokePrincipal(principalId); },
      close() { return closing ??= (async () => { try { await ipc!.close(); } finally { try { journal!.close(); } finally { try { hostGrants.close(); } finally { lock.close(); } } } })(); },
    });
  } catch (error) { try { await ipc?.close(); } finally { try { journal?.close(); } finally { try { grants?.close(); } finally { lock.close(); } } } throw error; }
}
