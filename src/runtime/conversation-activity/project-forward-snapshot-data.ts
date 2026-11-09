import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {z} from 'zod/v3';

const limit=2*1024*1024;
function invalid():never{throw Error('activity_project_forward_data_invalid');}
/** Closed JSON data only. A digest never confers Source or caller authority. */
function capture(value:unknown,budget={nodes:0,bytes:0},parents=new Set<object>(),depth=0):unknown{
 if(++budget.nodes>100000||depth>64)invalid();
 if(value===null||typeof value==='boolean')return value;
 if(typeof value==='number'){if(!Number.isFinite(value))invalid();return value;}
 if(typeof value==='string'){budget.bytes+=Buffer.byteLength(value);if(budget.bytes>limit)invalid();return value;}
 if(!value||typeof value!=='object'||types.isProxy(value)||parents.has(value)||Object.getOwnPropertySymbols(value).length)invalid();
 const array=Array.isArray(value),prototype=Object.getPrototypeOf(value);
 if(array?prototype!==Array.prototype||value.length>100000:prototype!==Object.prototype&&prototype!==null)invalid();
 if(Object.getOwnPropertyDescriptor(Object.prototype,'toJSON')||Object.getOwnPropertyDescriptor(Array.prototype,'toJSON'))invalid();
 const fields=Object.getOwnPropertyDescriptors(value),names=Object.keys(fields);
 if(names.length>100001||array&&(names.length!==value.length+1||names.some(name=>name!=='length'&&!/^(0|[1-9][0-9]*)$/.test(name))))invalid();
 if(array)for(let index=0;index<value.length;index++)if(!Object.hasOwn(fields,String(index)))invalid();
 const result:Record<string,unknown>|unknown[]=array?[]:Object.create(null);parents.add(value);
 for(const name of array?names:names.sort()){
  if(array&&name==='length')continue;
  const field=fields[name]!;if(!Object.hasOwn(field,'value')||!field.enumerable)invalid();
  budget.bytes+=Buffer.byteLength(name);if(budget.bytes>limit)invalid();
  Object.defineProperty(result,name,{value:capture(field.value,budget,parents,depth+1),enumerable:true});
 }
 parents.delete(value);return Object.freeze(result);
}
export function captureProjectForwardData(raw:unknown):unknown{return capture(raw);}
export function projectForwardDigest(raw:unknown):string{
 const bytes=JSON.stringify(capture(raw));if(Buffer.byteLength(bytes)>limit)invalid();
 return createHash('sha256').update(bytes).digest('hex');
}
const stampSchema=z.object({protocol:z.literal(1),watchId:z.string().min(1).max(256),demandId:z.string().uuid(),
 stateDigest:z.string().regex(/^[a-f0-9]{64}$/),viewDigest:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export type ProjectForwardStamp=Readonly<z.infer<typeof stampSchema>>;
export function parseProjectForwardStamp(raw:unknown):ProjectForwardStamp{return Object.freeze(stampSchema.parse(capture(raw)));}
