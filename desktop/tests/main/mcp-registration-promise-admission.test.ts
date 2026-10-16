// @vitest-environment node
import { expect, it } from 'vitest';
import { actualMcpRegistrationFunction } from './mcp-registration-actual-main-fixture.js';

it.each(['global-accessor', 'global-value', 'species', 'constructor', 'then'] as const)('N7 actual Main %s admission invokes getter0 and callback effect0 before ownership/producer', mode => {
  // Load actual constants/witness/function and real ipc-native-promise dependency
  // while realm is standard. No test-written native/SDK witness is supplied.
  const start = actualMcpRegistrationFunction(), NativePromise = Promise;
  const own = Object.getOwnPropertyDescriptor, define = Object.defineProperty;
  const target = mode.startsWith('global') ? globalThis : mode === 'species' ? NativePromise : NativePromise.prototype;
  const key = mode.startsWith('global') ? 'Promise' : mode === 'species' ? Symbol.species : mode;
  const original = own(target, key); if (!original) throw Error('own_admission_descriptor_missing');
  const effects = { isOpen: 0, acquire: 0, release: 0, lifetime: 0, producer: 0, startBridge: 0, registrationLog: 0, ownershipLog: 0 };
  let getterReads = 0, replacementCalls = 0, caught: unknown, returned: unknown;
  const callbacks = {
    isOpen() { effects.isOpen++; return true; },
    acquireWriter() { effects.acquire++; return { release() { effects.release++; } }; },
    registerFinalLifetime() { effects.lifetime++; },
    async register() { effects.producer++; return { async dispose() {} }; },
    startBridge() { effects.startBridge++; },
    reportRegistrationFailure() { effects.registrationLog++; }, reportOwnershipFailure() { effects.ownershipLog++; },
  };
  function replacement() { replacementCalls++; throw Error('replacement_constructor_must_not_run'); }
  // No framework, async/await, logging or Promise creation inside poison window.
  try {
    if (mode === 'global-value') define(target, key, { configurable: true, enumerable: original.enumerable, writable: true, value: replacement });
    else define(target, key, { configurable: true, enumerable: original.enumerable, get() { getterReads++; return NativePromise; } });
    try { returned = start(callbacks); } catch (error) { caught = error; }
  } finally { define(target, key, original); }
  expect(caught).toBeInstanceOf(Error);
  expect(caught instanceof Error ? caught.message : undefined).toBe('mcp_registration_promise_contract');
  expect(returned).toBeUndefined(); expect(getterReads).toBe(0); expect(replacementCalls).toBe(0);
  expect(effects).toEqual({ isOpen: 0, acquire: 0, release: 0, lifetime: 0, producer: 0, startBridge: 0, registrationLog: 0, ownershipLog: 0 });
});
