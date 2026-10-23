import {validateHeaderName,validateHeaderValue} from 'node:http';

export interface EgressProvisionTarget {
 readonly destination:string;readonly model:string;readonly protocol:string;
 readonly headers:Readonly<Record<string,string>>;readonly credentialId?:string;
}
export interface EgressProvisionBundle {
 readonly targets:Readonly<{version:1;targets:readonly EgressProvisionTarget[]}>;
 readonly credentials:Readonly<Record<string,Readonly<Record<string,string>>>>;
}
const limit=65536;
function reject():never{throw Error('egress_provision_input');}
function record(value:unknown):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return reject();
 const result:Record<string,unknown>=Object.create(null);
 for(const key of Reflect.ownKeys(value)){
  if(typeof key!=='string'||['__proto__','prototype','constructor'].includes(key))return reject();
  const property=Object.getOwnPropertyDescriptor(value,key);
  if(!property||!property.enumerable||!('value'in property))return reject();
  result[key]=property.value;
 }
 return result;
}
function keys(value:Record<string,unknown>,required:readonly string[],optional:readonly string[]=[]){
 if(required.some(key=>!Object.hasOwn(value,key))||Object.keys(value).some(key=>!required.includes(key)&&!optional.includes(key)))reject();
}
function text(value:unknown,max:number):string{
 if(typeof value!=='string'||!value.length||Buffer.byteLength(value)>max||/[\p{Cc}\p{Cf}]/u.test(value))return reject();return value;
}
function headers(value:unknown):Readonly<Record<string,string>>{
 const source=record(value),result:Record<string,string>=Object.create(null),seen=new Set<string>();
 if(Object.keys(source).length>128)reject();
 for(const [key,value]of Object.entries(source)){
  const name=text(key,256),body=text(value,16384),normalized=name.toLowerCase();
  if(seen.has(normalized))reject();
  try{validateHeaderName(name);validateHeaderValue(name,body);}catch{return reject();}
  seen.add(normalized);result[name]=body;
 }
 return Object.freeze(result);
}
/** Pure schema validation only: this does not authorize a request, write a
 * credential, install a service or certify an OS identity. Errors omit input. */
export function parseEgressProvisionBundle(value:unknown):EgressProvisionBundle{
 const source=record(value);keys(source,['version','targets','credentials']);
 if(source.version!==1||!Array.isArray(source.targets)||source.targets.length<1||source.targets.length>64)reject();
 const credentials:Record<string,Readonly<Record<string,string>>>=Object.create(null);
 for(const [key,body]of Object.entries(record(source.credentials))){
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(key))reject();credentials[key]=headers(body);
 }
 const seen=new Set<string>(),used=new Set<string>();
 const targets: EgressProvisionTarget[]=[];
 for(const original of source.targets){
  const target=record(original);keys(target,['destination','model','protocol','headers'],['credentialId']);
  const destination=text(target.destination,8192),model=text(target.model,256),protocol=text(target.protocol,128),publicHeaders=headers(target.headers);
  let url:URL;try{url=new URL(destination);}catch{return reject();}
  if(url.protocol!=='https:'||url.username||url.password||url.hash||!url.hostname)reject();
  const identity=JSON.stringify([destination,model,protocol]);if(seen.has(identity))reject();seen.add(identity);
  let credentialId:string|undefined;
  if(Object.hasOwn(target,'credentialId')){
   credentialId=text(target.credentialId,128);if(!Object.hasOwn(credentials,credentialId))reject();used.add(credentialId);
   const publicNames=new Set(Object.keys(publicHeaders).map(key=>key.toLowerCase()));
   if(Object.keys(credentials[credentialId]).some(key=>publicNames.has(key.toLowerCase())))reject();
  }
  targets.push(Object.freeze({destination,model,protocol,headers:publicHeaders,...(credentialId===undefined?{}:{credentialId})}));
 }
 if(Object.keys(credentials).some(key=>!used.has(key)))reject();
 const publicConfiguration=Object.freeze({version:1 as const,targets:Object.freeze(targets)}),privateConfiguration=Object.freeze(credentials);
 if(Buffer.byteLength(JSON.stringify(publicConfiguration)+'\n')>limit||Buffer.byteLength(JSON.stringify(privateConfiguration)+'\n')>limit)reject();
 return Object.freeze({targets:publicConfiguration,credentials:privateConfiguration});
}
