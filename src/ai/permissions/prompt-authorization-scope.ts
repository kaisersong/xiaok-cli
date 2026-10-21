import { AsyncLocalStorage } from 'node:async_hooks';
import { isDeepStrictEqual, types } from 'node:util';
import type { PermissionChoice } from '../../types.js';

export interface PromptRememberPlan {
  applyRule(rule: string, apply: () => void): void;
  finish(persistenceFailed: boolean): void;
}

/** Internal host scope, never a tool argument, permission grant, or revision override. */
export interface PromptAuthorizationScope {
  begin(name: string, input: Record<string, unknown>, choice: Extract<PermissionChoice, { rule: string }>): PromptRememberPlan;
  invalidate(): void;
}

const activePrompt = new AsyncLocalStorage<PromptAuthorizationScope>();
const isProxy = types.isProxy;

/** Clone/freeze only data descriptors; do not execute approval/input getters. */
export function snapshotPromptData<T>(value: T): T {
  const seen = new Set<object>();
  const copy = (item: unknown): unknown => {
    if (item === null || typeof item !== 'object') {
      if (['function', 'symbol', 'bigint'].includes(typeof item)) throw new Error('invalid_prompt_data');
      return item;
    }
    if (isProxy(item)) throw new Error('invalid_prompt_data');
    const array = Array.isArray(item);
    const prototype = Object.getPrototypeOf(item);
    if (seen.has(item) || (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null)) throw new Error('invalid_prompt_data');
    seen.add(item);
    const result: object = array ? [] : Object.create(Object.getPrototypeOf(item));
    for (const key of Reflect.ownKeys(item)) {
      if (array && key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (typeof key !== 'string' || !descriptor || !('value' in descriptor) || !descriptor.enumerable) throw new Error('invalid_prompt_data');
      Object.defineProperty(result, key, { value: copy(descriptor.value), enumerable: true });
    }
    seen.delete(item);
    return Object.freeze(result);
  };
  return copy(value) as T;
}

export function withinPromptAuthorization<T>(scope: PromptAuthorizationScope, run: () => Promise<T>): Promise<T> {
  return activePrompt.run(scope, run);
}

export function isCurrentPromptAuthorization(scope: PromptAuthorizationScope): boolean {
  return activePrompt.getStore() === scope;
}

/** An actual unowned mutation may target a manager with no pending transaction. */
export function invalidateCurrentPromptAuthorization(): void {
  activePrompt.getStore()?.invalidate();
}

/** Snapshot before the terminal producer first reads choice.action. */
export function snapshotTerminalPromptChoice(choice: PermissionChoice): PermissionChoice | undefined {
  const scope = activePrompt.getStore();
  if (!scope) return choice;
  try { return snapshotPromptData(choice); }
  catch { scope.invalidate(); return undefined; }
}

/** Called only by the real terminal-choice producer, after its race has settled. */
export async function capturePromptRememberChoice(name: string, input: Record<string, unknown>, choice: PermissionChoice | undefined): Promise<{
  choice: PermissionChoice | undefined; plan?: PromptRememberPlan;
}> {
  const scope = activePrompt.getStore();
  if (!scope) return { choice };
  try {
    const snapshot = snapshotPromptData(choice);
    if (!snapshot || snapshot.action === 'allow_once' || snapshot.action === 'deny') return { choice: snapshot };
    const capturedInput = snapshotPromptData(input);
    // Keep PermissionManager's module initialization independent of terminal UI.
    const { buildPermissionPromptOptions, deriveRule } = await import('../../ui/permission-prompt.js');
    const canonical = buildPermissionPromptOptions(deriveRule(name, capturedInput), name, capturedInput);
    if (!canonical.some(option => isDeepStrictEqual(option.choice, snapshot))) throw new Error('invalid_prompt_remember_choice');
    return { choice: snapshot, plan: scope.begin(name, capturedInput, snapshot) };
  } catch {
    scope.invalidate();
    // Do not persist an unvalidated choice; the registry will fail closed.
    return { choice: undefined };
  }
}
