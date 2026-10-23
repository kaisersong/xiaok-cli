// @vitest-environment node
import { expect, it } from 'vitest';
import { captureIpcData } from '../../electron/ipc-data-snapshot.js';
import { canonicalWorkspaceJson } from '../../electron/room-workspace-local.js';
const options = Object.freeze({ preserveDataPrototype: true });
it('preserves original plain root and nested templates for canonical Room storage when the host opts in', () => {
  const original = { roomId: 'room', templateEntries: [{ relativePath: 'file.txt', kind: 'file', content: 'normal' }] };
  const value = captureIpcData(original, 'room_input_invalid', options);
  expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
  expect(Object.getPrototypeOf(value.templateEntries[0])).toBe(Object.prototype);
  expect(value.templateEntries[0]).not.toBe(original.templateEntries[0]);
  expect(canonicalWorkspaceJson(value)).toBe(canonicalWorkspaceJson(original));
});
it('preserves rejected null root and nested canonical semantics without widening them to plain objects', () => {
  const original = Object.create(null); original.roomId = 'room';
  const root = captureIpcData(original, 'room_input_invalid', options);
  expect(Object.getPrototypeOf(root)).toBeNull(); expect(() => canonicalWorkspaceJson(root)).toThrow('workspace_noncanonical_json');
  const nested = captureIpcData({ roomId: 'room', meta: original }, 'room_input_invalid', options);
  expect(Object.getPrototypeOf(nested.meta)).toBeNull(); expect(() => canonicalWorkspaceJson(nested)).toThrow('workspace_noncanonical_json');
});
it('keeps default old callers on the original null-prototype object ABI', () => {
  const value = captureIpcData({ roomId: 'room', nested: { normal: true } });
  expect(Object.getPrototypeOf(value)).toBeNull(); expect(Object.getPrototypeOf(value.nested)).toBeNull();
});
it('defines an own __proto__ data slot without changing the preserved container prototype', () => {
  const original = JSON.parse('{"roomId":"room","__proto__":{"polluted":true}}');
  const value = captureIpcData(original, 'room_input_invalid', options);
  expect(Object.getPrototypeOf(value)).toBe(Object.prototype); expect(Object.hasOwn(value, '__proto__')).toBe(true);
  expect(value.polluted).toBeUndefined(); expect(canonicalWorkspaceJson(value)).toBe(canonicalWorkspaceJson(original));
});
it('refuses Proxy, accessor and serializer code without invoking it in the opt-in mode', () => {
  let effects = 0; const accessor = { roomId: 'room' };
  Object.defineProperty(accessor, 'bad', { enumerable: true, get() { effects++; return 'never'; } });
  for (const value of [accessor, { toJSON() { effects++; return {}; } }, new Proxy({}, { ownKeys() { effects++; throw Error('never'); } })])
    expect(() => captureIpcData(value, 'room_input_invalid', options)).toThrow('room_input_invalid');
  expect(effects).toBe(0);
});
