/**
 * `cross-spawn` ships no type declarations. Design v58 §3.4 pins it as a direct
 * dependency of both the root CLI and Desktop because the controlled stdio
 * transport must keep the SDK's Windows shim resolution semantics.
 */
declare module 'cross-spawn' {
  import type { ChildProcess, SpawnOptions } from 'node:child_process';

  function spawn(command: string, args?: readonly string[], options?: SpawnOptions): ChildProcess;

  export = spawn;
}
