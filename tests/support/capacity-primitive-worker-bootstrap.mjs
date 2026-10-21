import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
/** Explicit child-process test boundary. Only the two fixed authority modules
 * are mocked; SQLite and the production ledger implementation remain real.
 * No installed startup/issuer/OS qualification is represented by this worker. */
const key=Symbol.for('xiaok.test.capacityPrimitiveWorker'),contexts=new WeakMap();
globalThis[key]=(name,args)=>{
 const [token,...rest]=args,c=contexts.get(token);if(!c)throw Error('primitive worker authority');
 switch(name){
  case 'claimInstalledCapacityLayer':if(rest[0]!=='ledger'||c.claimed)throw Error('primitive worker layer');c.claimed=true;c.options.host.assertCurrent();return {database:c.options.database,authorityId:c.options.authorityId};
  case 'readInstalledCapacityAuthority':c.options.host.assertCurrent();return {database:c.options.database,authorityId:c.options.authorityId};
  case 'finishInstalledCapacityLayer':case 'failInstalledCapacityLayer':return;
  case 'readSharedCapacityOwner':return c.options.host.inspectOwner(rest[0]);
  case 'readSharedCapacityOwners':return rest[0].map(binding=>c.options.host.inspectOwner(binding));
  case 'assertSharedCapacityReleased':return c.options.host.assertReleased(...rest);
  case 'assertInstalledCapacityReplacement':throw Error('shared_capacity_replacement_unavailable');
  default:throw Error('primitive worker unsupported boundary '+name);
 }
};
const sources=new Map();
for(const name of ['installed-controller','shared-blob-capacity']){
 const url=new URL('../../src/runtime/verification/'+name+'.ts',import.meta.url),source=readFileSync(url,'utf8');
 const names=[...source.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)].map(m=>m[1]);
 const stub=names.map(name=>`export function ${name}(...args){return globalThis[Symbol.for('xiaok.test.capacityPrimitiveWorker')](${JSON.stringify(name)},args);}`).join('\n');
 sources.set(url.href,stub);sources.set(new URL('../../src/runtime/verification/'+name+'.js',import.meta.url).href,stub);
}
registerHooks({load(url,context,nextLoad){const source=sources.get(url);return source===undefined?nextLoad(url,context):{format:'module',source,shortCircuit:true};}});
export function createPrimitiveWorkerAuthority(options){const token=Object.freeze({});contexts.set(token,{options,claimed:false});return token;}
