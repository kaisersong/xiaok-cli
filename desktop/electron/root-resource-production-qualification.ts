import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {types} from 'node:util';
import {retainSourceErrorTails} from '../../src/runtime/verification/source-error-tails.js';
import {createIntrinsicSet} from '../../src/runtime/verification/intrinsic-async-collection.js';
const nativeRequire=createRequire(import.meta.url),artifact=join(dirname(fileURLToPath(import.meta.url)),'root_resource_authority.node');
const descriptor=Object.getOwnPropertyDescriptor,own=Object.hasOwn,apply=Reflect.apply,create=Object.create,freeze=Object.freeze,define=Object.defineProperty;
const isProxy=types.isProxy,isPromise=types.isPromise;
/** Fixed product gate, not a caller/environment option; safe passive legacy check. */
export const ORIGINAL_PRODUCTION_ROOT_RESOURCE_QUALIFIED=false as const;
// Read-only SDK startup inventory. This module publishes no physical-drain
// certificate and never drops a rejected/unknown Native loader return.
const retained=createIntrinsicSet<unknown>();
let loaded=false,api:unknown,loadError:unknown;
function hold(raw:unknown){retained.add(raw);retainSourceErrorTails(raw,value=>retained.add(value));}
export interface OriginalProductionRootResourceQualification {
    readonly kind:'root_resource_production_qualification_v1';
    readonly qualified:typeof ORIGINAL_PRODUCTION_ROOT_RESOURCE_QUALIFIED;
    readonly state:'unavailable';
    readonly reason:'ROOT_RESOURCE_NATIVE_UNAVAILABLE'|'ROOT_RESOURCE_NATIVE_UNCONFIRMED'|'ROOT_RESOURCE_P4_INCOMPLETE';
    readonly nativeProfile:string|null;readonly nativeSemanticDigest:string|null;
}
function result(reason:OriginalProductionRootResourceQualification['reason'],profile:string|null=null,digest:string|null=null):OriginalProductionRootResourceQualification {
    const out=create(null);const rows=[['kind','root_resource_production_qualification_v1'],['qualified',ORIGINAL_PRODUCTION_ROOT_RESOURCE_QUALIFIED],['state','unavailable'],['reason',reason],['nativeProfile',profile],['nativeSemanticDigest',digest]] as const;
    for(let i=0;i<rows.length;i++)define(out,rows[i]![0],{__proto__:null,value:rows[i]![1],enumerable:true} as PropertyDescriptor);
    return freeze(out);
}
/** No UI/env/argument opt-in. Main role is not P4. Only the original installed
 * Native component is inspected; no DB/session/factory/subject is opened. */
export function readOriginalProductionRootResourceQualification():OriginalProductionRootResourceQualification {
    if(arguments.length)throw Error('ROOT_RESOURCE_QUALIFICATION_ARGUMENT_INVALID');
    if(!loaded){loaded=true;try{api=nativeRequire(artifact);hold(api);}catch(error){loadError=error;hold(error);}}
    if(loadError!==undefined||!api)return result('ROOT_RESOURCE_NATIVE_UNAVAILABLE');
    if(typeof api!=='object'||isProxy(api)||isPromise(api))return result('ROOT_RESOURCE_NATIVE_UNCONFIRMED');
    const method=descriptor(api,'buildInfo');
    if(!method||!own(method,'value')||typeof method.value!=='function'||isProxy(method.value))return result('ROOT_RESOURCE_NATIVE_UNCONFIRMED');
    let raw:unknown;
    try {
        raw=apply(method.value,api,[]);hold(raw);
        if(!raw||typeof raw!=='object'||isProxy(raw)||isPromise(raw))return result('ROOT_RESOURCE_NATIVE_UNCONFIRMED');
        const profile=descriptor(raw,'profile'),digest=descriptor(raw,'semanticDigest'),qualified=descriptor(raw,'nativeQualified'),kind=descriptor(raw,'buildKind');
        if(!profile||!digest||!qualified||!kind||!own(profile,'value')||!own(digest,'value')||!own(qualified,'value')||!own(kind,'value')||typeof profile.value!=='string'||typeof digest.value!=='string'||typeof qualified.value!=='boolean'||kind.value!=='production_component')return result('ROOT_RESOURCE_NATIVE_UNCONFIRMED');
        // The current original C contract explicitly reports nativeQualified=0.
        // Even a future component flag is insufficient until the all14/SDK/
        // old-writer/VFS/physical product profile is implemented and installed.
        return result('ROOT_RESOURCE_P4_INCOMPLETE',profile.value,digest.value);
    }catch(error){hold(error);return result('ROOT_RESOURCE_NATIVE_UNCONFIRMED');}
}
