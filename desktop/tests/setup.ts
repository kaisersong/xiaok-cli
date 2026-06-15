import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'

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
