import type { McpRuntimeToolResult } from '../../ai/mcp/runtime/client.js';

export interface CuaConnection {
  callToolResult(name: string, input: Record<string, unknown>): Promise<McpRuntimeToolResult>;
  dispose(): void;
}

export type CuaConnectionFactory = () => Promise<CuaConnection>;

export type CuaConnectionState = 'idle' | 'connecting' | 'connected' | 'closing' | 'failed';

export interface CuaConnectionManagerOptions {
  connectTimeoutMs?: number;
}

const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;

export class CuaConnectionManager {
  private _state: CuaConnectionState = 'idle';
  private _connection: CuaConnection | null = null;
  private _connectPromise: Promise<CuaConnection> | null = null;
  private _cancelled = false;
  private readonly _factory: CuaConnectionFactory;
  private readonly _connectTimeoutMs: number;

  constructor(factory: CuaConnectionFactory, options: CuaConnectionManagerOptions = {}) {
    this._factory = factory;
    this._connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  }

  get state(): CuaConnectionState {
    return this._state;
  }

  async callToolResult(name: string, input: Record<string, unknown>): Promise<McpRuntimeToolResult> {
    const connection = await this._ensureConnected();
    return connection.callToolResult(name, input);
  }

  async dispose(): Promise<void> {
    if (this._state === 'idle') return;

    if (this._state === 'connecting') {
      this._cancelled = true;
      try {
        await this._connectPromise;
      } catch {
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

  private _cleanup(): void {
    if (this._connection) {
      try {
        this._connection.dispose();
      } catch {
        // Best-effort cleanup
      }
      this._connection = null;
    }
    this._connectPromise = null;
    this._cancelled = false;
    this._state = 'idle';
  }

  private async _ensureConnected(): Promise<CuaConnection> {
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
    } catch (error) {
      if (this._cancelled) {
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
