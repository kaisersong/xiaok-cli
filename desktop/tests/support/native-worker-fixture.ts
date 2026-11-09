import type {Worker} from 'node:worker_threads';

/** Node-only fixture metadata: does not grant SDK or production authority. */
export function preserveNativeWorkerGetters<T extends {prototype:object}>(original:{prototype:Worker},fixture:T):T {
  for(const name of ['stdout','stderr','stdin','threadId'] as const){
    const descriptor=Object.getOwnPropertyDescriptor(original.prototype,name);
    if(!descriptor?.get)throw Error('fixture_native_worker_getter_missing:'+name);
    const existing=Object.getOwnPropertyDescriptor(fixture.prototype,name);
    if(existing&&existing.get!==descriptor.get)throw Error('fixture_native_worker_getter_conflict:'+name);
    Object.defineProperty(fixture.prototype,name,descriptor);
  }
  return fixture;
}
