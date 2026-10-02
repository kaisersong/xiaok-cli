import { classifyCuaRuntimeFailure, isReplaySafeCuaCall, } from './cua-runtime-failure.js';
const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;
export class CuaConnectionManager {
    _state = 'idle';
    _connection = null;
    _connectPromise = null;
    _epoch = 0;
    _generation = 0;
    _isReplaySafeCall;
    _pendingCloses = new Set();
    _revivePromises = new Map();
    _factory;
    _connectTimeoutMs;
    constructor(factory, options = {}) {
        this._factory = factory;
        this._connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
        this._isReplaySafeCall = options.isReplaySafeCall ?? isReplaySafeCuaCall;
        if (options.initialConnection) {
            this._connection = options.initialConnection;
            this._state = 'connected';
            this._generation += 1;
        }
    }
    get state() {
        return this._state;
    }
    get generation() { return this._generation; }
    async callToolResult(name, input, options) {
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
                if (reviveFailure?.kind === 'authorization_denied')
                    return unwrap(revive);
                if (!revive.ok || revive.result.isError) {
                    recoveredConnection = await this._replaceConnection(connection, epoch);
                }
                else if (this._connection !== connection) {
                    recoveredConnection = await this._ensureConnected(epoch);
                }
            }
            else {
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
        }
        catch (error) {
            options?.signal?.throwIfAborted();
            throw error;
        }
    }
    async dispose() {
        this._epoch += 1;
        this._generation += 1;
        if (this._state === 'idle') {
            await Promise.all(this._pendingCloses);
            return;
        }
        if (this._state === 'connecting') {
            this._state = 'closing';
            try {
                await this._connectPromise;
            }
            catch {
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
    _closeConnection(connection) {
        try {
            const pending = Promise.resolve(connection.dispose()).catch(() => undefined);
            this._pendingCloses.add(pending);
            void pending.finally(() => this._pendingCloses.delete(pending));
        }
        catch { /* A failed close does not retain the dead connection. */ }
    }
    _cleanup() {
        if (this._connection) {
            try {
                this._closeConnection(this._connection);
            }
            catch {
                // Best-effort cleanup
            }
            this._connection = null;
        }
        this._connectPromise = null;
        this._revivePromises.clear();
        this._state = 'idle';
    }
    async _ensureConnected(epoch) {
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
        }
        catch (error) {
            if (epoch !== this._epoch) {
                this._state = 'idle';
            }
            else {
                this._state = 'failed';
            }
            this._connectPromise = null;
            throw error;
        }
    }
    async _doConnect() {
        return new Promise((resolve, reject) => {
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
                if (settled)
                    return;
                settled = true;
                clearTimeout(timer);
                reject(error);
            });
        });
    }
    async _reviveSession(connection, originalInput, epoch) {
        this._assertEpoch(epoch);
        const session = normalizeSessionLabel(originalInput.session);
        const key = session ?? '<implicit>';
        const existing = this._revivePromises.get(key);
        if (existing)
            return existing;
        this._generation += 1;
        const promise = invoke(connection, 'start_session', session ? { session } : {});
        this._revivePromises.set(key, promise);
        try {
            return await promise;
        }
        finally {
            if (this._revivePromises.get(key) === promise)
                this._revivePromises.delete(key);
        }
    }
    async _replaceConnection(connection, epoch) {
        this._assertEpoch(epoch);
        await this._invalidateConnection(connection);
        try {
            return await this._ensureConnected(epoch);
        }
        catch (error) {
            if (epoch !== this._epoch)
                throw error;
            throw new CuaConnectionRecoveryFailedError(error);
        }
    }
    async _invalidateConnection(connection) {
        if (this._connection !== connection)
            return false;
        this._generation += 1;
        try {
            this._closeConnection(connection);
        }
        catch {
            // Best effort; the replacement must not retain the dead generation.
        }
        this._connection = null;
        this._connectPromise = null;
        this._revivePromises.clear();
        this._state = 'idle';
        await Promise.all(this._pendingCloses);
        return true;
    }
    _assertEpoch(epoch) {
        if (epoch !== this._epoch) {
            throw new Error('CUA connection recovery cancelled because the manager was disposed');
        }
    }
}
async function invoke(connection, name, input, options) {
    try {
        return { ok: true, result: await (options ? connection.callToolResult(name, input, options) : connection.callToolResult(name, input)) };
    }
    catch (error) {
        return { ok: false, error };
    }
}
function unwrap(outcome) {
    if (outcome.ok)
        return outcome.result;
    throw outcome.error;
}
function normalizeSessionLabel(value) {
    if (typeof value !== 'string')
        return null;
    const session = value.trim();
    if (!session || session.length > 128 || /[\u0000-\u001f\u007f]/.test(session))
        return null;
    return session;
}
export class CuaConnectionReobserveRequiredError extends Error {
    code = 'COMPUTER_USE_RECONNECTED_REOBSERVE_REQUIRED';
    constructor() {
        super('Computer Use connection recovered; re-observe before retrying the action');
        this.name = 'CuaConnectionReobserveRequiredError';
    }
}
export class CuaConnectionRecoveryFailedError extends Error {
    code = 'COMPUTER_USE_CONNECTION_RECOVERY_FAILED';
    constructor(cause) {
        super('Computer Use connection recovery failed', { cause });
        this.name = 'CuaConnectionRecoveryFailedError';
    }
}
