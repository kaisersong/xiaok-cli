import { randomUUID } from 'node:crypto';

export type CapabilityOperation = 'read' | 'write-existing' | 'write-new' | 'open' | 'watch';

export const TTL_RANGE: Record<CapabilityOperation, { min: number; max: number; default: number }> = {
  'read':           { min: 60_000, max: 30 * 60_000, default: 5 * 60_000 },
  'write-existing': { min: 60_000, max: 30 * 60_000, default: 5 * 60_000 },
  'write-new':      { min: 60_000, max: 60 * 60_000, default: 30 * 60_000 },
  'open':           { min: 60_000, max: 30 * 60_000, default: 5 * 60_000 },
  'watch':          { min: 60_000, max: 24 * 3600_000, default: 24 * 3600_000 },
};

interface StoredToken {
  token: string;
  pathOrParent: string;
  operation: CapabilityOperation;
  webContentsId: number;
  expiresAt: number;
  consumed: boolean;
  oneShot: boolean;
}

const tokenStore = new Map<string, StoredToken>();
const watchHandles = new Map<string, { close: () => void; webContentsId: number }>();

export function issueCapabilityToken(opts: {
  pathOrParent: string;
  operation: CapabilityOperation;
  webContentsId: number;
  ttlMs?: number;
}): string {
  const range = TTL_RANGE[opts.operation];
  const ttl = Math.max(range.min, Math.min(range.max, opts.ttlMs ?? range.default));
  const token = randomUUID();
  const oneShot = opts.operation !== 'watch';
  tokenStore.set(token, {
    token,
    pathOrParent: opts.pathOrParent,
    operation: opts.operation,
    webContentsId: opts.webContentsId,
    expiresAt: Date.now() + ttl,
    consumed: false,
    oneShot,
  });
  return token;
}

export function consumeCapabilityToken(token: string, webContentsId: number): StoredToken {
  const stored = tokenStore.get(token);
  if (!stored) throw new Error('capability_token_invalid');
  if (stored.webContentsId !== webContentsId) throw new Error('capability_token_wrong_sender');
  if (stored.expiresAt < Date.now()) {
    tokenStore.delete(token);
    throw new Error('capability_token_expired');
  }
  if (stored.oneShot) {
    if (stored.consumed) throw new Error('capability_token_already_consumed');
    stored.consumed = true;
    tokenStore.delete(token);
  }
  return stored;
}

export function registerWatchHandle(token: string, webContentsId: number, close: () => void): void {
  watchHandles.set(token, { close, webContentsId });
}

export function releaseWatchHandle(token: string): void {
  const handle = watchHandles.get(token);
  if (handle) {
    try { handle.close(); } catch {}
    watchHandles.delete(token);
  }
}

export function releaseAllTokensFor(webContentsId: number): void {
  for (const [key, t] of tokenStore) {
    if (t.webContentsId === webContentsId) tokenStore.delete(key);
  }
  for (const [key, h] of watchHandles) {
    if (h.webContentsId === webContentsId) {
      try { h.close(); } catch {}
      watchHandles.delete(key);
    }
  }
}

export function getActiveTokenCount(): number {
  return tokenStore.size;
}

export function getActiveWatchHandleCount(): number {
  return watchHandles.size;
}

export function clearAllForTests(): void {
  tokenStore.clear();
  watchHandles.clear();
}
