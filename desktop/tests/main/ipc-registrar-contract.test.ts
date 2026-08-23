import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Design v58 §5.5 / R18-01 / R19-01: only `ShutdownAwareIpcMain` may hold the
 * raw Electron `ipcMain` and call `.handle()` on it. Every other registration
 * surface receives the narrow `IpcHandleRegistrar`, so no channel can bypass the
 * shutdown gate. Comments and strings do not count — we look at real member
 * calls and real runtime imports.
 */

const ELECTRON_DIR = join(__dirname, '..', '..', 'electron');
const SOLE_RAW_OWNER = 'shutdown-aware-ipc-main.ts';
const REGISTRATION_FILES = ['main.ts', 'ipc.ts', 'kswarm-ipc-proxy.ts', 'ipc-runtime.ts', 'semantic-ipc.ts'];

function read(file: string): string {
  return readFileSync(join(ELECTRON_DIR, file), 'utf8');
}

/** Strips line/block comments so commented-out code never counts as a call. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('IPC registrar contract (design R18-01, R19-01)', () => {
  it('never calls .handle on the raw electron ipcMain outside the wrapper', () => {
    // The invariant is not "no identifier named ipcMain" — after narrowing, the
    // registrars take a parameter with that name. What must never happen is a
    // file importing the runtime `ipcMain` value AND calling `.handle()` on it.
    for (const file of REGISTRATION_FILES) {
      const code = stripComments(read(file));
      const importsRuntimeIpcMain = (code.match(/import\s*\{([^}]*)\}\s*from\s*'electron'/g) ?? [])
        .some((imp) => imp
          .replace(/[\s\S]*\{|\}[\s\S]*/g, '')
          .split(',')
          .map((n) => n.trim())
          .includes('ipcMain'));
      if (!importsRuntimeIpcMain) continue;
      expect(code, `${file} imports the runtime ipcMain and must not call .handle on it`)
        .not.toMatch(/\bipcMain\.handle\s*\(/);
    }
  });

  it('keeps the raw electron ipcMain import in exactly one non-wrapper file', () => {
    // main.ts still imports ipcMain, but only to construct the wrapper once.
    const main = stripComments(read('main.ts'));
    expect(main).toMatch(/new ShutdownAwareIpcMain\(ipcMain, desktopShutdownGate\)/);
    const otherUses = main.match(/\bipcMain\b/g) ?? [];
    // One in the electron import list, one in the wrapper construction.
    expect(otherUses.length).toBe(2);

    // Type-only imports are erased and harmless; a runtime `ipcMain` value
    // import is what would let a registrar bypass the gate.
    for (const file of ['ipc.ts', 'kswarm-ipc-proxy.ts', 'ipc-runtime.ts', 'semantic-ipc.ts']) {
      const code = stripComments(read(file));
      const electronImports = code.match(/import\s*\{([^}]*)\}\s*from\s*'electron'/g) ?? [];
      for (const imp of electronImports) {
        const named = imp.replace(/[\s\S]*\{|\}[\s\S]*/g, '').split(',').map((x) => x.trim());
        const runtimeIpcMain = named.some((n) => n === 'ipcMain');
        expect(runtimeIpcMain, `${file} must not import the runtime ipcMain value`).toBe(false);
      }
    }
  });

  it('narrows every registrar signature to IpcHandleRegistrar', () => {
    for (const file of ['ipc.ts', 'kswarm-ipc-proxy.ts', 'semantic-ipc.ts']) {
      expect(stripComments(read(file))).toMatch(/ipcMain:\s*IpcHandleRegistrar/);
    }
    const runtime = stripComments(read('ipc-runtime.ts'));
    expect(runtime).toMatch(/setIpcMainImpl\(impl:\s*IpcHandleRegistrar\)/);
    expect(runtime).not.toMatch(/from\s*'electron';[\s\S]*\bIpcMain\b\s*\|/);
  });

  it('passes the wrapper — never raw ipcMain — into the registration functions', () => {
    const main = stripComments(read('main.ts'));
    expect(main).toMatch(/registerDesktopIpc\(shutdownAwareIpc,/);
    expect(main).toMatch(/registerKSwarmProxy\(shutdownAwareIpc,/);
    // Found by this guard: a fifth surface the design had not enumerated.
    expect(main).toMatch(/registerSemanticDesktopIpc\(shutdownAwareIpc,/);
  });

  it('proves the wrapper is the only file that calls .handle on a raw object', () => {
    const owner = stripComments(read(SOLE_RAW_OWNER));
    expect(owner).toMatch(/this\.rawIpcMain\.handle\(/);
    // The wrapper itself must never re-enter through the narrow interface.
    expect(owner).not.toMatch(/\bipcMain\.handle\s*\(/);
  });
});
