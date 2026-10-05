import {isAbsolute,join,resolve} from 'node:path';
import {inspectCompoundSourceInventory} from './compound-source-inventory.js';

export interface CompoundHostStorage {
 readonly configRoot:string;
 readonly canonicalRoot:string;
 readonly sourceRoots:readonly string[];
}
const layouts=new WeakMap<object,readonly string[]>();
function hostPath(value:string):string {
 if(typeof value!=='string'||!value||Buffer.byteLength(value)>4096||!isAbsolute(value)||value.includes('\0'))throw Error('compound_host_storage_path');
 return resolve(value);
}
/** Host configuration routing only, not a user grant, legacy-drain proof, or a
 * durable root registration. No path is accepted from policy or model input.
 * Existing durable registered roots must be supplied by the host registry; the
 * fixed CLI/Desktop roots are always included and cannot be replaced. */
export function resolveCompoundHostStorage(input:{configRoot:string;desktopDataRoot?:string;registeredSourceRoots?:readonly string[]}):Readonly<CompoundHostStorage> {
 const configRoot=hostPath(input.configRoot),canonicalRoot=join(configRoot,'compound-sessions');
 const registered=input.registeredSourceRoots??[];
 if(!Array.isArray(registered)||registered.length>13)throw Error('compound_host_storage_root_limit');
 const sources=[canonicalRoot,join(configRoot,'sessions'),join(configRoot,'desktop','tasks','protected-observation-sessions')];
 if(input.desktopDataRoot!==undefined)sources.push(join(hostPath(input.desktopDataRoot),'tasks','protected-observation-sessions'));
 sources.push(...registered.map(hostPath));
 const sourceRoots=Object.freeze([...new Set(sources)]);
 if(sourceRoots.length>16)throw Error('compound_host_storage_root_limit');
 const layout=Object.freeze({configRoot,canonicalRoot,sourceRoots});
 layouts.set(layout,sourceRoots);return layout;
}
/** Inspects the exact host layout. A copied DTO cannot omit mandatory roots.
 * The report remains inspection evidence, never authorization to discard old
 * execution state or to activate a new domain. */
export function inspectCompoundHostSources(layout:CompoundHostStorage){
 const roots=layouts.get(layout);if(!roots)throw Error('compound_host_storage_invalid');
 return inspectCompoundSourceInventory(roots);
}

export function assertCompoundHostStorage(layout:CompoundHostStorage):Readonly<CompoundHostStorage>{
 if(!layouts.has(layout))throw Error('compound_host_storage_invalid');return layout;
}
