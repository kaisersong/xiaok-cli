import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const nativeDlopen=process.dlopen,apply=Reflect.apply;
const create=Object.create,define=Object.defineProperty,descriptor=Object.getOwnPropertyDescriptor,own=Object.hasOwn;
const NativeError=Error;
// Main's bundled entry and the reviewed addon are colocated. No caller path,
// environment override, require.cache verifier, Desktop JS, or CLI fallback.
const artifact=join(dirname(fileURLToPath(import.meta.url)),'root_resource_authority_main.node');
interface Birth {module:object;raw?:unknown;namespace?:unknown;failure?:{raw:unknown}}
let birth:Birth|undefined;
export function loadOriginalMainResourceAuthority():unknown {
    if(birth){
        if(birth.failure)throw birth.failure.raw;
        if(birth.namespace===undefined)throw new NativeError('ROOT_RESOURCE_MAIN_MODULE_LOADING');
        return birth.namespace;
    }
    const module=create(null) as object;
    define(module,'exports',{__proto__:null,value:create(null),writable:true} as PropertyDescriptor);
    const row:Birth={module};birth=row;
    try{
        // This one original Native load precedes caching the private namespace.
        // The original module/raw/partial outcome remain held on any failure.
        row.raw=apply(nativeDlopen,process,[module,artifact]);
        if(row.raw!==undefined)throw new NativeError('ROOT_RESOURCE_MAIN_MODULE_LOAD_UNCONFIRMED');
        const outcome=descriptor(module,'exports');
        if(!outcome||!own(outcome,'value')||!outcome.value||typeof outcome.value!=='object')throw new NativeError('ROOT_RESOURCE_MAIN_MODULE_LOAD_UNCONFIRMED');
        row.namespace=outcome.value;return row.namespace;
    }catch(raw){row.failure={raw};throw raw;}
}
