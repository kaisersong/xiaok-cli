const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;
export class CuaConnectionManager {
    _state = 'idle';
    _connection = null;
    _connectPromise = null;
    _cancelled = false;
    _factory;
    _connectTimeoutMs;
    constructor(factory, options = {}) {
        this._factory = factory;
        this._connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    }
    get state() {
        return this._state;
    }
    async callToolResult(name, input) {
        const connection = await this._ensureConnected();
        return connection.callToolResult(name, input);
    }
    async dispose() {
        if (this._state === 'idle')
            return;
        if (this._state === 'connecting') {
            this._cancelled = true;
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
        this._cancelled = false;
        this._state = 'idle';
    }
    async _ensureConnected() {
        if (this._state === 'connected' && this._connection) {
            return this._connection;
        }
        if (this._state === 'connecting' && this._connectPromise) {
            return this._connectPromise;
        }
        this._state = 'connecting';
        this._cancelled = false;
        this._connectPromise = this._doConnect();
        try {
            const connection = await this._connectPromise;
            if (this._cancelled) {
                connection.dispose();
                throw new Error('CUA connection cancelled during dispose');
            }
            this._connection = connection;
            this._state = 'connected';
            return connection;
        }
        catch (error) {
            if (this._cancelled) {
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
            const timer = setTimeout(() => {
                reject(new Error(`CUA connection timeout after ${this._connectTimeoutMs}ms`));
            }, this._connectTimeoutMs);
            this._factory()
                .then((connection) => {
                clearTimeout(timer);
                resolve(connection);
            })
                .catch((error) => {
                clearTimeout(timer);
                reject(error);
            });
        });
    }
}
