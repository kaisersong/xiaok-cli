import { assertStandardIpcPromise } from './ipc-native-promise.js';
import { isAllowedShellExternalUrl } from './security.js';
import type { MobileRelaySignInResult } from '../shared/mobile-signin-ipc-contract.js';
const NativePromise = Promise, nativeThen = Promise.prototype.then, apply = Reflect.apply;
function loginTarget(raw: unknown): string | 'unknown' | 'invalid' {
  if (raw === undefined || raw === null || raw === '') return 'unknown';
  if (typeof raw !== 'string') return 'invalid';
  try {
    const url = new URL(raw);
    if (!['ws:', 'wss:', 'http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname.includes('//')) return 'invalid';
    if (url.protocol === 'ws:') url.protocol = 'http:';
    if (url.protocol === 'wss:') url.protocol = 'https:';
    const prefix = url.pathname.replace(/\/+$/, '').replace(/\/ws$/, '');
    url.pathname = `${prefix}/auth/login`;
    return isAllowedShellExternalUrl(url.href) ? url.href : 'invalid';
  } catch { return 'invalid'; }
}
/** One Main-owned explicit user action; no credential or browser-login ownership. */
export function createMobileRelaySignInOwner(options: { getRelayUrl(): unknown; openExternal(url: string): unknown; onOpened?(): void }) {
  let pending: Promise<MobileRelaySignInResult> | null = null;
  return {
    open(requestSource?: 'user' | 'agent' | 'scheduler'): Promise<MobileRelaySignInResult> {
      if (requestSource !== 'user') return new NativePromise((_resolve, reject) => reject(Error('mobile_signin_request_source_forbidden')));
      if (pending) return pending;
      const operation = new NativePromise<MobileRelaySignInResult>((resolve, reject) => {
        try {
          const target = loginTarget(options.getRelayUrl());
          if (target === 'unknown' || target === 'invalid') { resolve({ ok: false, error: target === 'unknown' ? 'relay_url_unknown' : 'relay_url_invalid' }); return; }
          const boundary = options.openExternal(target);
          assertStandardIpcPromise(boundary, 'mobile_signin_operation_unknown');
          apply(nativeThen, boundary, [(value: unknown) => {
            if (value !== undefined) { reject(Error('mobile_signin_operation_unknown')); return; }
            try { options.onOpened?.(); } catch { /* Logging cannot reinterpret the OS completion. */ }
            resolve({ ok: true, url: target });
          }, reject]);
        } catch (error) { reject(error); }
      });
      pending = new NativePromise((resolve, reject) => apply(nativeThen, operation, [
        (result: MobileRelaySignInResult) => { pending = null; resolve(result); },
        (error: unknown) => { pending = null; reject(error); },
      ]));
      return pending;
    },
  };
}
