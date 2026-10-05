/** Private comparison data only. No SQL/current result or authorization is cached. */
export function captureRegistrationSnapshot<T>(input:T,freeze=true):T{
 const ancestors=new Set<object>();
 const visit=(value:unknown):unknown=>{
  if(value===null||typeof value==='string'||typeof value==='boolean')return value;
  if(typeof value==='number'&&Number.isFinite(value))return value===0?0:value;
  if(!value||typeof value!=='object'||(!Array.isArray(value)&&![Object.prototype,null].includes(Object.getPrototypeOf(value))))throw Error('verification_invalid_record');
  if(ancestors.has(value))throw Error('verification_invalid_record');
  ancestors.add(value);
  try{
   const descriptors=Object.getOwnPropertyDescriptors(value);
   for(const descriptor of Object.values(descriptors))if(!('value' in descriptor))throw Error('verification_accessor_denied');
   let result:unknown[]|Record<string,unknown>;
   if(Array.isArray(value)){
    result=[];
    for(let i=0;i<value.length;i++){const descriptor=descriptors[String(i)];if(!descriptor||!('value' in descriptor))throw Error('verification_invalid_record');result.push(visit(descriptor.value));}
   }else{
    result={};
    for(const key of Object.keys(value))Object.defineProperty(result,key,{value:visit(descriptors[key]!.value),enumerable:true,writable:true,configurable:true});
   }
   return freeze?Object.freeze(result):result;
  }finally{ancestors.delete(value);}
 };
 return visit(input) as T;
}
