import 'vitest';

/** Exact values provided by tests/support/profile-account.global.mjs. */
declare module 'vitest' {
  interface ProvidedContext {
    profileTestAccountRoot: string;
    profileTestTempRoot: string | null;
    installedSlidePythonRuntime: { python: string; marker: string };
  }
}
