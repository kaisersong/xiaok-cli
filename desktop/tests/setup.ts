import '@testing-library/jest-dom/vitest'

class ResizeObserverMock {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  Object.assign(globalThis, { ResizeObserver: ResizeObserverMock });
}

// Vite injects these at build time; stub them for tests
(globalThis as any).__APP_VERSION__ = '0.0.0-test';
(globalThis as any).__APP_BUILD__ = 'test';
