import { expect, it } from 'vitest';
import { withObservationExecutionOwner, resolveObservationProviderDisclosure, hasObservationExecutionOwner } from '../../../src/runtime/sol-pi/observation-execution-scope.js';
import { scanTaskStoreSdkChildren } from '../../../src/runtime/task-host/source-sdk-children.js';

it('keeps the original async owner private while preserving disclosure identity and unknown SDK siblings', async () => {
  const disclosure = Object.freeze({}) as never;
  const owner = { prepareProviderDisclosure: () => disclosure, ownsDisclosure: (value: object) => value === disclosure, hasDependencies: () => true };
  await withObservationExecutionOwner(owner, async () => {
    await Promise.resolve();
    expect(hasObservationExecutionOwner()).toBe(true);
    expect(resolveObservationProviderDisclosure()).toBe(disclosure);
    expect(resolveObservationProviderDisclosure(disclosure)).toBe(disclosure);
    expect(() => withObservationExecutionOwner(undefined, () => undefined)).toThrow(/HANDOFF/);
    const raw = Promise.resolve('original');
    expect(scanTaskStoreSdkChildren(raw, true)).toEqual({ promises: [], unknowns: [] });
    const tail = Promise.resolve('tail'), foreignCallback = () => undefined;
    Object.defineProperty(raw, Symbol('caller-tail'), { value: tail });
    Object.defineProperty(raw, Symbol('caller-callback'), { value: foreignCallback });
    const inventory = scanTaskStoreSdkChildren(raw, true);
    expect(inventory.promises).toContain(tail);
    expect(inventory.unknowns).toContain(foreignCallback);
    expect(await raw).toBe('original');
  });
  expect(hasObservationExecutionOwner()).toBe(false);
  expect(resolveObservationProviderDisclosure()).toBeUndefined();
});
