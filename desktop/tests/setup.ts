import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import fs from 'node:fs'

// Windows holds transient locks on just-written files / just-closed SQLite
// handles, so recursive temp-dir cleanup in test teardown frequently throws
// EPERM/EBUSY *after* the assertions have already passed. That used to surface
// as dozens of spurious red tests. Make recursive directory removal resilient
// on Windows only: always retry, and treat transient lock errors during a
// recursive delete as best-effort (the OS reclaims the temp entry anyway).
// Single-file removals stay strict so real failures are never masked.
if (process.platform === 'win32') {
  const TRANSIENT = new Set(['EPERM', 'EBUSY', 'ENOTEMPTY', 'EACCES'])
  const isRecursive = (options: unknown): boolean =>
    typeof options === 'object' && options !== null && (options as { recursive?: boolean }).recursive === true

  const originalRmSync = fs.rmSync.bind(fs)
  fs.rmSync = ((path: fs.PathLike, options?: fs.RmOptions) => {
    if (!isRecursive(options)) return originalRmSync(path, options)
    const opts: fs.RmOptions = { maxRetries: 10, retryDelay: 100, ...options }
    try {
      return originalRmSync(path, opts)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code
      if (code && TRANSIENT.has(code)) return undefined
      throw err
    }
  }) as typeof fs.rmSync

  const originalRm = fs.promises.rm.bind(fs.promises)
  fs.promises.rm = (async (path: fs.PathLike, options?: fs.RmOptions) => {
    if (!isRecursive(options)) return originalRm(path, options)
    const opts: fs.RmOptions = { maxRetries: 10, retryDelay: 100, ...options }
    try {
      return await originalRm(path, opts)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code
      if (code && TRANSIENT.has(code)) return undefined
      throw err
    }
  }) as typeof fs.promises.rm
}

// Reset the desktop API cache between tests so window.xiaokDesktop mocks take effect
import { _resetDesktopApiCache } from '../renderer/src/shared/desktop';
afterEach(() => { _resetDesktopApiCache(); });

class ResizeObserverMock {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  Object.assign(globalThis, { ResizeObserver: ResizeObserverMock });
}

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

for (const storageName of ['localStorage', 'sessionStorage'] as const) {
  const current = (globalThis as any)[storageName];
  if (!current || typeof current.getItem !== 'function' || typeof current.setItem !== 'function' || typeof current.clear !== 'function') {
    Object.defineProperty(globalThis, storageName, {
      value: createMemoryStorage(),
      configurable: true,
      writable: true,
    });
    if (typeof window !== 'undefined') {
      Object.defineProperty(window, storageName, {
        value: (globalThis as any)[storageName],
        configurable: true,
        writable: true,
      });
    }
  }
}

// Vite injects these at build time; stub them for tests
(globalThis as any).__APP_VERSION__ = '0.0.0-test';
(globalThis as any).__APP_BUILD__ = 'test';
