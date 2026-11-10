import {createRequire} from 'node:module';
import {types} from 'node:util';

type EntryConstructor = typeof import('@napi-rs/keyring').Entry;
const sourceRequire = createRequire(import.meta.url);
const descriptor = Object.getOwnPropertyDescriptor;
const isProxy = types.isProxy;

function unavailable(): never {throw Error('credential_store_unavailable');}

function data(value: unknown, key: string): unknown {
  if (!value || (typeof value !== 'object' && typeof value !== 'function') || isProxy(value)) unavailable();
  const field = descriptor(value, key);
  if (!field) return undefined;
  if (!('value' in field)) unavailable();
  return field.value;
}

function version(value: unknown): void {
  if (data(value, 'version') !== '2.1.2') unavailable();
}

function entry(value: unknown): EntryConstructor {
  const ctor = data(value, 'Entry');
  if (typeof ctor !== 'function' || isProxy(ctor)) unavailable();
  return ctor as EntryConstructor;
}

function libc(): 'gnu' | 'musl' {
  const report = process.report?.getReport();
  const header = data(report, 'header');
  const glibc = data(header, 'glibcVersionRuntime');
  if (typeof glibc === 'string' && glibc.length > 0) return 'gnu';
  const shared = data(report, 'sharedObjects');
  if (!Array.isArray(shared) || isProxy(shared)) unavailable();
  for (let i = 0; i < shared.length; i++) {
    const path = data(shared, String(i));
    if (typeof path === 'string' && (path.includes('libc.musl-') || path.includes('ld-musl-'))) return 'musl';
  }
  return unavailable();
}

/** Fixed locked Native packages only. No generated JS loader or env-selected path. */
export function loadFixedKeyringEntry(): EntryConstructor {
  if ((process as NodeJS.Process & {type?: string}).type === 'browser') throw Error('credential_worker_required');
  if (process.env.NAPI_RS_NATIVE_LIBRARY_PATH || process.env.NAPI_RS_WASI_FLAVOR
      || process.env.NAPI_RS_FORCE_WASI === 'true' || process.env.NAPI_RS_FORCE_WASI === 'error') unavailable();
  // Every require remains literal, and version validation precedes Native load.
  // A missing platform package is unavailable; never retry an unrelated backend.
  try {
    // Keep optional packages owned by the locked core, including nested installs.
    const require = createRequire(sourceRequire.resolve('@napi-rs/keyring/package.json'));
    if (process.platform === 'darwin') {
      if (process.arch === 'arm64') {
        version(require('@napi-rs/keyring-darwin-arm64/package.json'));
        return entry(require('@napi-rs/keyring-darwin-arm64'));
      }
      if (process.arch === 'x64') {
        version(require('@napi-rs/keyring-darwin-x64/package.json'));
        return entry(require('@napi-rs/keyring-darwin-x64'));
      }
    } else if (process.platform === 'win32') {
      const variables = data(process.config, 'variables');
      if (data(variables, 'shlib_suffix') === 'dll.a' || data(variables, 'node_target_type') === 'shared_library') unavailable();
      if (process.arch === 'x64') {
        version(require('@napi-rs/keyring-win32-x64-msvc/package.json'));
        return entry(require('@napi-rs/keyring-win32-x64-msvc'));
      }
      if (process.arch === 'arm64') {
        version(require('@napi-rs/keyring-win32-arm64-msvc/package.json'));
        return entry(require('@napi-rs/keyring-win32-arm64-msvc'));
      }
      if (process.arch === 'ia32') {
        version(require('@napi-rs/keyring-win32-ia32-msvc/package.json'));
        return entry(require('@napi-rs/keyring-win32-ia32-msvc'));
      }
    } else if (process.platform === 'linux') {
      const kind = libc();
      if (process.arch === 'x64') {
        if (kind === 'gnu') {
          version(require('@napi-rs/keyring-linux-x64-gnu/package.json'));
          return entry(require('@napi-rs/keyring-linux-x64-gnu'));
        }
        version(require('@napi-rs/keyring-linux-x64-musl/package.json'));
        return entry(require('@napi-rs/keyring-linux-x64-musl'));
      }
      if (process.arch === 'arm64') {
        if (kind === 'gnu') {
          version(require('@napi-rs/keyring-linux-arm64-gnu/package.json'));
          return entry(require('@napi-rs/keyring-linux-arm64-gnu'));
        }
        version(require('@napi-rs/keyring-linux-arm64-musl/package.json'));
        return entry(require('@napi-rs/keyring-linux-arm64-musl'));
      }
      if (process.arch === 'arm' && kind === 'gnu') {
        version(require('@napi-rs/keyring-linux-arm-gnueabihf/package.json'));
        return entry(require('@napi-rs/keyring-linux-arm-gnueabihf'));
      }
      if (process.arch === 'riscv64' && kind === 'gnu') {
        version(require('@napi-rs/keyring-linux-riscv64-gnu/package.json'));
        return entry(require('@napi-rs/keyring-linux-riscv64-gnu'));
      }
    } else if (process.platform === 'freebsd' && process.arch === 'x64') {
      version(require('@napi-rs/keyring-freebsd-x64/package.json'));
      return entry(require('@napi-rs/keyring-freebsd-x64'));
    }
  } catch {
    unavailable();
  }
  return unavailable();
}
