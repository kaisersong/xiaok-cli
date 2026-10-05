import {types} from 'node:util';

/** Inspect descriptors without executing caller accessors or Proxy traps. */
export function applicationDataDescriptors(value:unknown,maximumKeys=65536,error='application_data'):PropertyDescriptorMap {
 if(!value||typeof value!=='object'||types.isProxy(value))throw Error(error);
 const array=Array.isArray(value),prototype=Object.getPrototypeOf(value);
 if(array?prototype!==Array.prototype:prototype!==Object.prototype&&prototype!==null)throw Error(error);
 const keys=Reflect.ownKeys(value);
 if(keys.length>maximumKeys||keys.some(key=>typeof key!=='string'))throw Error(error);
 const descriptors=Object.getOwnPropertyDescriptors(value);
 if(Object.values(descriptors).some(entry=>!('value'in entry)))throw Error(error);
 return descriptors;
}
/** Count canonical JSON bytes before allocating escaped strings or a full clone.
 * This is only a data bound; it supplies no execution or approval authority. */
export function captureApplicationData(raw:unknown,limits:{maximumBytes:number;maximumNodes:number;maximumDepth?:number;invalid:string;limit:string}):any {
 const {maximumBytes,maximumNodes,maximumDepth=64,invalid,limit}=limits;
 if(!Number.isSafeInteger(maximumBytes)||maximumBytes<1||maximumBytes>128*1024**2||!Number.isSafeInteger(maximumNodes)||maximumNodes<1||!Number.isSafeInteger(maximumDepth)||maximumDepth<0||maximumDepth>128)throw Error('application_data_budget');
 const seen=new Set<object>();let nodes=0,bytes=0;
 const charge=(count:number)=>{bytes+=count;if(bytes>maximumBytes)throw Error(limit);};
 const string=(value:string)=>{
  charge(2);
  for(let i=0;i<value.length;i++){
   const code=value.charCodeAt(i);
   if(code===34||code===92)charge(2);
   else if(code<32)charge([8,9,10,12,13].includes(code)?2:6);
   else if(code>=0xd800&&code<=0xdbff&&i+1<value.length&&value.charCodeAt(i+1)>=0xdc00&&value.charCodeAt(i+1)<=0xdfff){charge(4);i++;}
   else if(code>=0xd800&&code<=0xdfff)charge(6);
   else charge(code<128?1:code<2048?2:3);
  }
 };
 const copy=(value:unknown,depth:number):any=>{
  if(++nodes>maximumNodes||depth>maximumDepth)throw Error(invalid);
  if(value===null){charge(4);return value;}
  if(typeof value==='string'){string(value);return value;}
  if(typeof value==='boolean'){charge(value?4:5);return value;}
  if(typeof value==='number'&&Number.isFinite(value)){charge(JSON.stringify(value).length);return value;}
  if(!value||typeof value!=='object'||types.isProxy(value)||seen.has(value))throw Error(invalid);
  const keys=Reflect.ownKeys(value);
  if(keys.length>maximumNodes-nodes+1)throw Error(invalid);
  const descriptors=applicationDataDescriptors(value,maximumNodes-nodes+1,invalid),array=Array.isArray(value);
  seen.add(value);
  try{
   charge(2);
   if(array){
    const length=descriptors.length?.value;
    if(!Number.isSafeInteger(length)||length<0||length>maximumNodes-nodes||keys.length!==length+1)throw Error(invalid);
    const result=[];
    for(let i=0;i<length;i++){if(i)charge(1);result.push(copy(descriptors[String(i)]?.value,depth+1));}
    return result;
   }
   const entries=Object.entries(descriptors),result:[string,unknown][]=[];
   for(let i=0;i<entries.length;i++){const [key,descriptor]=entries[i]!;if(i)charge(1);string(key);charge(1);result.push([key,copy(descriptor.value,depth+1)]);}
   return Object.fromEntries(result);
  }finally{seen.delete(value);}
 };
 return copy(raw,0);
}
