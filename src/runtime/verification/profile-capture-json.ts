/** Captured metadata only: count canonical UTF-8 before allocating the wire body.
 * This is a memory bound, never an authority or persistent capacity receipt. */
function visit(v:unknown,emit:(part:string)=>void,depth=0):void {
  if(depth>32)throw Error('source_custody_manifest_shape');
  if(v===null||typeof v==='string'||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v)){emit(JSON.stringify(v));return;}
  if(!v||typeof v!=='object')throw Error('source_custody_manifest_shape');
  if(Array.isArray(v)){emit('[');for(let i=0;i<v.length;i++){if(i)emit(',');const d=Object.getOwnPropertyDescriptor(v,String(i));if(!d||!('value'in d))throw Error('source_custody_manifest_shape');visit(d.value,emit,depth+1);}emit(']');return;}
  if(Object.getPrototypeOf(v)!==Object.prototype)throw Error('source_custody_manifest_shape');emit('{');let first=true;
  for(const key of Object.keys(v).sort()){const d=Object.getOwnPropertyDescriptor(v,key);if(!d||!('value'in d))throw Error('source_custody_manifest_shape');if(!first)emit(',');first=false;emit(JSON.stringify(key));emit(':');visit(d.value,emit,depth+1);}emit('}');
}
export function countBoundedProfileCaptureJson(value:unknown,maximumBytes:number):number {
 if(!Number.isSafeInteger(maximumBytes)||maximumBytes<0||maximumBytes>128*1024**2)throw Error('source_custody_manifest_limit');
 let bytes=0;visit(value,part=>{const n=Buffer.byteLength(part);if(n>maximumBytes-bytes)throw Error('source_custody_manifest_limit');bytes+=n;});return bytes;
}
export function encodeBoundedProfileCaptureJson(value:unknown,maximumBytes:number):Buffer {
 const bytes=countBoundedProfileCaptureJson(value,maximumBytes);
 const result=Buffer.alloc(bytes);let offset=0;try{visit(value,part=>{const n=Buffer.byteLength(part);if(n>bytes-offset)throw Error('source_custody_manifest_changed');offset+=result.write(part,offset,n);});if(offset!==bytes)throw Error('source_custody_manifest_changed');return result;}catch(error){result.fill(0);throw error;}
}
