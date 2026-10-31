import {spawnSync} from 'node:child_process';
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import {expect,it} from 'vitest';

const moduleUrl=new URL('../../../src/runtime/verification/registration-intrinsics.js',import.meta.url);
if(!existsSync(moduleUrl))moduleUrl.pathname=moduleUrl.pathname.replace(/\.js$/,'.ts');
const probe=String.raw`
const stdout=process.stdout,write=stdout.write.bind(stdout);
write(''); // Initialize the real proof-output stream before any prototype poison.
const nativeDefine=Object.defineProperty,nativeDescriptor=Object.getOwnPropertyDescriptor,NativeError=Error;
const {assertRegistrationIntrinsics:guard,assertRegistrationWeakMapIntrinsics:weak}=await import(process.argv[2]);
const mode=process.argv[3];let calls=0,error,accepted=false;
guard();
const getter=function(){calls++;return Map;},setter=function(){calls++;};
const length=nativeDescriptor(Map,'length'),species=nativeDescriptor(Map,Symbol.species);
if(mode.startsWith('sequence-')||mode==='object-reader'||mode==='reflect-reader'){
 const failures=[];
 const reject=()=>{try{guard();failures.push('accepted');}catch(failure){failures.push(failure.message);}};
 if(mode==='sequence-classes'){
  nativeDefine(Map,'length',{__proto__:null,configurable:true,enumerable:length.enumerable,get:getter});reject();nativeDefine(Map,'length',length);guard();
  nativeDefine(Map,Symbol.species,{__proto__:null,configurable:true,enumerable:species.enumerable,value:undefined,writable:false});reject();nativeDefine(Map,Symbol.species,species);guard();
 }else if(mode==='sequence-edges'){
  const prior=nativeDescriptor(Function.prototype,'apply');nativeDefine(Function.prototype,'apply',{__proto__:null,configurable:true,get:getter});reject();nativeDefine(Function.prototype,'apply',prior);guard();
 }else if(mode==='sequence-flags'){
  nativeDefine(Map,'length',{__proto__:null,...length,value:-0});reject();nativeDefine(Map,'length',length);guard();
  nativeDefine(Map,'length',{__proto__:null,...length,value:undefined});reject();nativeDefine(Map,'length',length);guard();
 }else if(mode==='sequence-weakmap'){
  const prior=nativeDescriptor(WeakMap.prototype,'get');weak();nativeDefine(WeakMap.prototype,'get',{__proto__:null,configurable:true,get:getter});
  try{weak();failures.push('accepted');}catch(failure){failures.push(failure.message);}nativeDefine(WeakMap.prototype,'get',prior);weak();guard();
 }else{
  const target=mode==='object-reader'?Object:Reflect,key='getOwnPropertyDescriptor',prior=nativeDescriptor(target,key);
  nativeDefine(target,key,{__proto__:null,...prior,value:function(){calls++;throw Error('replaced reader');}});reject();nativeDefine(target,key,prior);guard();
 }
 write(JSON.stringify({failures,calls,restored:true}));
}else{
if(mode.startsWith('inherited-'))nativeDefine(Object.prototype,mode.slice('inherited-'.length),{__proto__:null,configurable:true,get:getter});
else if(mode==='data-to-accessor')nativeDefine(Map,'length',{__proto__:null,configurable:true,enumerable:length.enumerable,get:getter});
else if(mode==='accessor-to-data')nativeDefine(Map,Symbol.species,{__proto__:null,configurable:true,enumerable:species.enumerable,value:undefined,writable:false});
else if(mode==='value-undefined')nativeDefine(Map,'length',{__proto__:null,...length,value:undefined});
else if(mode==='signed-zero')nativeDefine(Map,'length',{__proto__:null,...length,value:-0});
else if(mode==='writable')nativeDefine(Map,'length',{__proto__:null,...length,writable:!length.writable});
else if(mode==='enumerable')nativeDefine(Map,Symbol.species,{__proto__:null,...species,enumerable:!species.enumerable});
else if(mode==='configurable')nativeDefine(Map,'length',{__proto__:null,...length,configurable:false});
else if(mode==='get')nativeDefine(Map,Symbol.species,{__proto__:null,...species,get:getter});
else if(mode==='set')nativeDefine(Map,Symbol.species,{__proto__:null,...species,set:setter});
else if(mode==='get-undefined')nativeDefine(Map,Symbol.species,{__proto__:null,...species,get:undefined});
else if(mode==='unchanged-own-undefined-set')nativeDefine(Map,Symbol.species,{__proto__:null,...species,set:undefined});
else if(mode==='absent')delete Map.length;
else if(mode!=='normal')throw Error('unknown probe');
try{guard();accepted=true;}catch(failure){if(!(failure instanceof NativeError))throw failure;error=failure.message;}
write(JSON.stringify({accepted,error,calls}));
}
`;
const modes=['normal','data-to-accessor','accessor-to-data','value-undefined','signed-zero','writable','enumerable','configurable','get','set','get-undefined','unchanged-own-undefined-set','absent',...['value','get','set','writable','enumerable','configurable'].map(key=>'inherited-'+key),'sequence-classes','sequence-edges','sequence-flags','sequence-weakmap','object-reader','reflect-reader'];
it.each(modes)('actual native descriptor public guard: %s',mode=>{
 const root=mkdtempSync(join(tmpdir(),'registration-native-shape-'));
 try{
  let actual=moduleUrl;
  if(moduleUrl.pathname.endsWith('.ts')){
   const compiled=join(root,'intrinsics.mjs');
   writeFileSync(compiled,ts.transpileModule(readFileSync(moduleUrl,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
   actual=pathToFileURL(compiled);
  }
  const entry=join(root,'probe.mjs');writeFileSync(entry,probe);
  const child=spawnSync(process.execPath,[entry,actual.href,mode],{encoding:'utf8',timeout:4500});
  expect(child.status,child.stderr).toBe(0);const proof=JSON.parse(child.stdout);
  if(mode.startsWith('sequence-')||mode==='object-reader'||mode==='reflect-reader'){
   const count=mode==='sequence-classes'||mode==='sequence-flags'?2:1;
   expect(proof).toEqual({failures:Array(count).fill('application_registration_changed'),calls:0,restored:true});return;
  }
  const legal=mode==='normal'||mode==='unchanged-own-undefined-set'||mode.startsWith('inherited-');
  expect(proof,JSON.stringify(proof)).toEqual(legal?{accepted:true,calls:0}:{accepted:false,error:'application_registration_changed',calls:0});
 }finally{rmSync(root,{recursive:true,force:true,maxRetries:3});}
});
