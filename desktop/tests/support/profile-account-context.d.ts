import 'vitest';

/** Exact values provided by tests/support/profile-account.global.mjs. */
declare module 'vitest' {
  interface ProvidedContext {
    profileTestAccountRoot: string;
    installedSlidePythonRuntime: { python: string; marker: string };
  }
}
