import {AsyncLocalStorage} from 'node:async_hooks';
const NativeStorage=AsyncLocalStorage,apply=Reflect.apply;
const run=NativeStorage.prototype.run,get=NativeStorage.prototype.getStore;
const carrier=new NativeStorage<object>();
/** Carrier only, never an authority/role/classifier. Every effect consumer must
 * recognize the object in the original Main owner's private membership map.
 * A caller may carry a forged object; it must be rejected, not downgraded. */
export function runWithOriginalRootExecutionContext<T>(context:object,work:()=>T):T {
    return apply(run,carrier,[context,work]) as T;
}
export function readCurrentOriginalRootExecutionContext():object|null {
    return (apply(get,carrier,[]) as object|undefined)??null;
}
