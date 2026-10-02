import type { McpInvocationOptions, McpRuntimeToolResult } from '../../ai/mcp/runtime/client.js';
import {
  classifyCuaRuntimeFailure,
  isReplaySafeCuaCall,
} from './cua-runtime-failure.js';

export interface CuaConnection {
  callToolResult(name: string, input: Record<string, unknown>, options?: McpInvocationOptions): Promise<McpRuntimeToolResult>;
  dispose(): void | Promise<void>;
}

export type CuaConnectionFactory = () => Promise<CuaConnection>;

export type CuaConnectionState = 'idle' | 'connecting' | 'connected' | 'closing' | 'failed';

export interface CuaConnectionManagerOptions {
  connectTimeoutMs?: number;
  initialConnection?: CuaConnection;
  isReplaySafeCall?: (operation: string, input: Readonly<Record<string, unknown>>) => boolean;
}

const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;

export class CuaConnectionManager {
  private _state: CuaConnectionState = 'idle';
  private _connection: CuaConnection | null = null;
  private _connectPromise: Promise<CuaConnection> | null = null;
  private _epoch = 0;
  private _generation = 0;
  private readonly _isReplaySafeCall: NonNullable<CuaConnectionManagerOptions['isReplaySafeCall']>;
  private readonly _pendingCloses = new Set<Promise<void>>();
  private readonly _revivePromises = new Map<string, Promise<CallOutcome>>();
  private readonly _factory: CuaConnectionFactory;
  private readonly _connectTimeoutMs: number;

  constructor(factory: CuaConnectionFactory, options: CuaConnectionManagerOptions = {}) {
    this._factory = factory;
    this._connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    this._isReplaySafeCall = options.isReplaySafeCall ?? isReplaySafeCuaCall;
    if (options.initialConnection) {
      this._connection = options.initialConnection;
      this._state = 'connected';
      this._generation += 1;
    }
  }

  get state(): CuaConnectionState {
    return this._state;
  }
  get generation(): number { return this._generation; }

  async callToolResult(name: string, input: Record<string, unknown>, options?: McpInvocationOptions): Promise<McpRuntimeToolResult> {
    options?.signal?.throwIfAborted();
    try {
    const epoch = this._epoch;
    const connection = await this._ensureConnected(epoch);
    options?.signal?.throwIfAborted();
    this._assertEpoch(epoch);

    const first = await invoke(connection, name, input, options);
    options?.signal?.throwIfAborted();
    const failure = classifyCuaRuntimeFailure(first.ok ? first.result : first.error);
    if (!failure || failure.kind === 'authorization_denied') {
      return unwrap(first);
    }

    let recoveredConnection = connection;
    if (failure.kind === 'session_ended') {
      const revive = await this._reviveSession(connection, input, epoch);
      options?.signal?.throwIfAborted();
      this._assertEpoch(epoch);
      const reviveFailure = classifyCuaRuntimeFailure(revive.ok ? revive.result : revive.error);
      if (reviveFailure?.kind === 'authorization_denied') return unwrap(revive);
      if (!revive.ok || revive.result.isError) {
        recoveredConnection = await this._replaceConnection(connection, epoch);
      } else if (this._connection !== connection) {
        recoveredConnection = await this._ensureConnected(epoch);
      }
    } else {
      recoveredConnection = await this._replaceConnection(connection, epoch);
    }

    options?.signal?.throwIfAborted();
    this._assertEpoch(epoch);
    if (!this._isReplaySafeCall(name, input)) {
      throw new CuaConnectionReobserveRequiredError();
    }

    const retry = await invoke(recoveredConnection, name, input, options);
    options?.signal?.throwIfAborted();
    const retryFailure = classifyCuaRuntimeFailure(retry.ok ? retry.result : retry.error);
    if (retryFailure && retryFailure.kind !== 'authorization_denied') {
      await this._invalidateConnection(recoveredConnection);
    }
    return unwrap(retry);
    } catch (error) {
      options?.signal?.throwIfAborted();
      throw error;
    }
  }

  async dispose(): Promise<void> {
    this._epoch += 1;
    this._generation += 1;
    if (this._state === 'idle') { await Promise.all(this._pendingCloses); return; }

    if (this._state === 'connecting') {
      this._state = 'closing';
      try {
        await this._connectPromise;
      } catch {
        // Expected — cancelled or failed
      }
      this._cleanup();
      await Promise.all(this._pendingCloses);
      return;
    }

    if (this._state === 'connected' || this._state === 'failed') {
      this._cleanup();
      await Promise.all(this._pendingCloses);
      return;
    }

    if (this._state === 'closing') {
      await Promise.all(this._pendingCloses);
      return;
    }
  }

  private _closeConnection(connection: CuaConnection): void {
    try {
      const pending = Promise.resolve(connection.dispose()).catch(() => undefined);
      this._pendingCloses.add(pending);
      void pending.finally(() => this._pendingCloses.delete(pending));
    } catch { /* A failed close does not retain the dead connection. */ }
  }

  private _cleanup(): void {
    if (this._connection) {
      try {
        this._closeConnection(this._connection);
      } catch {
        // Best-effort cleanup
      }
      this._connection = null;
    }
    this._connectPromise = null;
    this._revivePromises.clear();
    this._state = 'idle';
  }

  private async _ensureConnected(epoch: number): Promise<CuaConnection> {
    this._assertEpoch(epoch);
    if (this._state === 'connected' && this._connection) {
      return this._connection;
    }

    if (this._state === 'connecting' && this._connectPromise) {
      return this._connectPromise;
    }

    this._state = 'connecting';

    this._connectPromise = this._doConnect();

    try {
      const connection = await this._connectPromise;
      if (epoch !== this._epoch) {
        this._closeConnection(connection);
        throw new Error('CUA connection cancelled during dispose');
      }
      this._connection = connection;
      this._generation += 1;
      this._state = 'connected';
      return connection;
    } catch (error) {
      if (epoch !== this._epoch) {
        this._state = 'idle';
      } else {
        this._state = 'failed';
      }
      this._connectPromise = null;
      throw error;
    }
  }

  private async _doConnect(): Promise<CuaConnection> {
    return new Promise<CuaConnection>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        settled = true;
        reject(new Error(`CUA connection timeout after ${this._connectTimeoutMs}ms`));
      }, this._connectTimeoutMs);

      this._factory()
        .then((connection) => {
          if (settled) {
            this._closeConnection(connection);
            return;
          }
          settled = true;
          clearTimeout(timer);
          resolve(connection);
        })
        .catch((error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  private async _reviveSession(
    connection: CuaConnection,
    originalInput: Readonly<Record<string, unknown>>,
    epoch: number,
  ): Promise<CallOutcome> {
    this._assertEpoch(epoch);
    const session = normalizeSessionLabel(originalInput.session);
    const key = session ?? '<implicit>';
    const existing = this._revivePromises.get(key);
    if (existing) return existing;

    this._generation += 1;
    const promise = invoke(connection, 'start_session', session ? { session } : {});
    this._revivePromises.set(key, promise);
    try {
      return await promise;
    } finally {
      if (this._revivePromises.get(key) === promise) this._revivePromises.delete(key);
    }
  }

  private async _replaceConnection(connection: CuaConnection, epoch: number): Promise<CuaConnection> {
    this._assertEpoch(epoch);
    await this._invalidateConnection(connection);
    try {
      return await this._ensureConnected(epoch);
    } catch (error) {
      if (epoch !== this._epoch) throw error;
      throw new CuaConnectionRecoveryFailedError(error);
    }
  }

  private async _invalidateConnection(connection: CuaConnection): Promise<boolean> {
    if (this._connection !== connection) return false;
    this._generation += 1;
    try {
      this._closeConnection(connection);
    } catch {
      // Best effort; the replacement must not retain the dead generation.
    }
    this._connection = null;
    this._connectPromise = null;
    this._revivePromises.clear();
    this._state = 'idle';
    await Promise.all(this._pendingCloses);
    return true;
  }

  private _assertEpoch(epoch: number): void {
    if (epoch !== this._epoch) {
      throw new Error('CUA connection recovery cancelled because the manager was disposed');
    }
  }
}

type CallOutcome =
  | { ok: true; result: McpRuntimeToolResult }
  | { ok: false; error: unknown };

async function invoke(
  connection: CuaConnection,
  name: string,
  input: Record<string, unknown>,
  options?: McpInvocationOptions,
): Promise<CallOutcome> {
  try {
    return { ok: true, result: await (options ? connection.callToolResult(name, input, options) : connection.callToolResult(name, input)) };
  } catch (error) {
    return { ok: false, error };
  }
}

function unwrap(outcome: CallOutcome): McpRuntimeToolResult {
  if (outcome.ok) return outcome.result;
  throw outcome.error;
}

function normalizeSessionLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const session = value.trim();
  if (!session || session.length > 128 || /[\u0000-\u001f\u007f]/.test(session)) return null;
  return session;
}

export class CuaConnectionReobserveRequiredError extends Error {
  readonly code = 'COMPUTER_USE_RECONNECTED_REOBSERVE_REQUIRED';

  constructor() {
    super('Computer Use connection recovered; re-observe before retrying the action');
    this.name = 'CuaConnectionReobserveRequiredError';
  }
}

export class CuaConnectionRecoveryFailedError extends Error {
  readonly code = 'COMPUTER_USE_CONNECTION_RECOVERY_FAILED';

  constructor(cause: unknown) {
    super('Computer Use connection recovery failed', { cause });
    this.name = 'CuaConnectionRecoveryFailedError';
  }
}
