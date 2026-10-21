import {isReadonlySandboxPolicy} from './policy.js';
import type { createSandboxPolicy } from './policy.js';

type SandboxPolicy = ReturnType<typeof createSandboxPolicy>;

const readonlyEnforcerProofs=new WeakMap<object,()=>boolean>();
export function isReadonlySandboxEnforcer(enforcer:unknown):boolean{
 if(!enforcer||typeof enforcer!=='object')return false;
 const proof=readonlyEnforcerProofs.get(enforcer);return proof?.()===true;
}
export function createSandboxEnforcer(policy: SandboxPolicy) {
  const enforcer = {
    enforceFile(path: string) {
      const decision = policy.checkPath(path);
      return decision.allowed
        ? { allowed: true as const }
        : { allowed: false as const, reason: decision.reason ?? 'path denied' };
    },

    enforceNetwork() {
      const decision = policy.checkNetworkAccess();
      return decision.allowed
        ? { allowed: true as const }
        : { allowed: false as const, reason: decision.reason ?? 'network denied' };
    },
  };
  const functions=Object.getOwnPropertyDescriptors(enforcer), prototype=Object.getPrototypeOf(enforcer);
  readonlyEnforcerProofs.set(enforcer,()=>{
    if(Object.getPrototypeOf(enforcer)!==prototype||Reflect.ownKeys(enforcer).length!==Reflect.ownKeys(functions).length||!isReadonlySandboxPolicy(policy))return false;
    for(const key of Object.keys(functions)){const current=Object.getOwnPropertyDescriptor(enforcer,key);if(!current||!('value' in current)||current.value!==functions[key].value)return false;}
    return true;
  });
  return enforcer;
}
