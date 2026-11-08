import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {types} from 'node:util';
const platform=process.platform,nativeDlopen=process.dlopen,apply=Reflect.apply,descriptor=Object.getOwnPropertyDescriptor,own=Object.hasOwn,keys=Reflect.ownKeys;
const create=Object.create,define=Object.defineProperty,freeze=Object.freeze,NativeError=Error,isProxy=types.isProxy;
const artifact=join(dirname(fileURLToPath(import.meta.url)),'native','darwin-universal','root_resource_ledger_source.node');
const names=['captureExistingOriginalRootPoolLedger','closeOriginalRootPoolLedgerSource','holdExistingOriginalRootPoolLedger'];
interface Birth {module:object;raw?:unknown;partial?:unknown;namespace?:object;failure?:{raw:unknown}}
let birth:Birth|undefined;
/** Build-bound ordinary history Source only. This namespace contains neither
 * Main identity nor a session/mutation export. No caller path or fallback. */
export function loadOriginalRootLedgerSource():unknown {
 if(arguments.length!==0)throw new NativeError('ROOT_LEDGER_SOURCE_ARGUMENT_INVALID');
 if(platform!=='darwin')throw new NativeError('ROOT_RESOURCE_PLATFORM_UNAVAILABLE');
 if(birth){if(birth.failure)throw birth.failure.raw;if(!birth.namespace)throw new NativeError('ROOT_LEDGER_SOURCE_MODULE_LOADING');return birth.namespace;}
 const module=create(null) as object;define(module,'exports',{__proto__:null,value:create(null),writable:true} as PropertyDescriptor);
 const row:Birth={module};birth=row;
 try{
  row.raw=apply(nativeDlopen,process,[module,artifact]);
  if(row.raw!==undefined)throw new NativeError('ROOT_LEDGER_SOURCE_MODULE_UNCONFIRMED');
  const exported=descriptor(module,'exports');if(!exported||!own(exported,'value'))throw new NativeError('ROOT_LEDGER_SOURCE_MODULE_UNCONFIRMED');
  row.partial=exported.value;
  if(!row.partial||typeof row.partial!=='object'||isProxy(row.partial))throw new NativeError('ROOT_LEDGER_SOURCE_MODULE_UNCONFIRMED');
  const actual=keys(row.partial);if(actual.length!==names.length)throw new NativeError('ROOT_LEDGER_SOURCE_MODULE_UNCONFIRMED');
  for(let i=0;i<actual.length;i++){const name=actual[i];if(!names.includes(name as string))throw new NativeError('ROOT_LEDGER_SOURCE_MODULE_UNCONFIRMED');const d=descriptor(row.partial,name);if(!d||!own(d,'value')||typeof d.value!=='function'||isProxy(d.value))throw new NativeError('ROOT_LEDGER_SOURCE_MODULE_UNCONFIRMED');}
  row.namespace=freeze(row.partial);return row.namespace;
 }catch(raw){row.failure={raw};throw raw;}
}
