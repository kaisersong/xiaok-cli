import { classifyCuaRuntimeFailure, isReplaySafeCuaCall, } from './cua-runtime-failure.js';
const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;
export class CuaConnectionManager {
    _state = 'idle';
    _connection = null;
    _connectPromise = null;
    _epoch = 0;
    _revivePromises = new Map();
    _factory;
    _connectTimeoutMs;
    constructor(factory, options = {}) {
        this._factory = factory;
        this._connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
        if (options.initialConnection) {
            this._connection = options.initialConnection;
            this._state = 'connected';
        }
    }
    get state() {
        return this._state;
    }
    async callToolResult(name, input) {
        const epoch = this._epoch;
        const connection = await this._ensureConnected(epoch);
        this._assertEpoch(epoch);
        const first = await invoke(connection, name, input);
        const failure = classifyCuaRuntimeFailure(first.ok ? first.result : first.error);
        if (!failure || failure.kind === 'authorization_denied') {
            return unwrap(first);
        }
        let recoveredConnection = connection;
        if (failure.kind === 'session_ended') {
            const revive = await this._reviveSession(connection, input, epoch);
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
        this._assertEpoch(epoch);
        if (!isReplaySafeCuaCall(name, input)) {
            throw new CuaConnectionReobserveRequiredError();
        }
        const retry = await invoke(recoveredConnection, name, input);
        const retryFailure = classifyCuaRuntimeFailure(retry.ok ? retry.result : retry.error);
        if (retryFailure && retryFailure.kind !== 'authorization_denied') {
            this._invalidateConnection(recoveredConnection);
        }
        return unwrap(retry);
    }
    async dispose() {
        this._epoch += 1;
        if (this._state === 'idle')
            return;
        if (this._state === 'connecting') {
            this._state = 'closing';
            try {
                await this._connectPromise;
            }
            catch {
                // Expected — cancelled or failed
            }
            this._cleanup();
            return;
        }
        if (this._state === 'connected' || this._state === 'failed') {
            this._cleanup();
            return;
        }
        if (this._state === 'closing') {
            return;
        }
    }
    _cleanup() {
        if (this._connection) {
            try {
                this._connection.dispose();
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
                connection.dispose();
                throw new Error('CUA connection cancelled during dispose');
            }
            this._connection = connection;
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
                    connection.dispose();
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
        this._invalidateConnection(connection);
        try {
            return await this._ensureConnected(epoch);
        }
        catch (error) {
            if (epoch !== this._epoch)
                throw error;
            throw new CuaConnectionRecoveryFailedError(error);
        }
    }
    _invalidateConnection(connection) {
        if (this._connection !== connection)
            return false;
        try {
            connection.dispose();
        }
        catch {
            // Best effort; the replacement must not retain the dead generation.
        }
        this._connection = null;
        this._connectPromise = null;
        this._revivePromises.clear();
        this._state = 'idle';
        return true;
    }
    _assertEpoch(epoch) {
        if (epoch !== this._epoch) {
            throw new Error('CUA connection recovery cancelled because the manager was disposed');
        }
    }
}
async function invoke(connection, name, input) {
    try {
        return { ok: true, result: await connection.callToolResult(name, input) };
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
