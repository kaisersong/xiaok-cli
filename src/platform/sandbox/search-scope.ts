import type {ToolExecutionContext} from '../../types.js';
import {inheritNativeReadonlyExecutionContext, isNativeReadonlyExecutionContext} from '../../ai/tools/native-readonly-context.js';
import {isReadonlySandboxEnforcer, type createSandboxEnforcer} from './enforcer.js';

export type SearchPathGuard = (path:string)=>boolean;
const scopes = new WeakMap<object, SearchPathGuard>();

/** Per-invocation host binding. Model input and same-named context properties
 * cannot install a search policy or bypass an existing one. */
export function withSandboxSearchScope(context:ToolExecutionContext|undefined,
  enforcer:ReturnType<typeof createSandboxEnforcer>):ToolExecutionContext {
  const derived:ToolExecutionContext = context
    ? Object.create(Object.getPrototypeOf(context),Object.getOwnPropertyDescriptors(context)) : {};
  inheritNativeReadonlyExecutionContext(context,derived);
  const readonly = isNativeReadonlyExecutionContext(context);
  scopes.set(derived,path=>{
    context?.signal?.throwIfAborted();
    context?.assertPermissionApproval?.();
    // Recheck after every worker await, before invoking possibly changed code.
    if(readonly && !isReadonlySandboxEnforcer(enforcer)) throw Error('native_readonly_sandbox_changed');
    return enforcer.enforceFile(path).allowed;
  });
  if(context && Object.isFrozen(context)) Object.freeze(derived);
  return derived;
}

export function getSandboxSearchGuard(context?:ToolExecutionContext):SearchPathGuard|undefined {
  return context && scopes.get(context);
}
