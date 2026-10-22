import {readFileSync,writeSync as initialWriteSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {LOADER_PREFIX} from './loop-read-error-diagnostic-core.mjs';

export const TARGETS=Object.freeze([
 {path:'src/runtime/loop/published-candidate.ts',site:'reader',sha256:'e6552719c62c6c8fc2df2414d7f48702a4acd8aa29263fcedabcb94a6d2f8766'},
 {path:'desktop/electron/loop-completion-consumer.ts',site:'consumer',sha256:'d8b4d645bddb0a7fad4619788a3e7ae4d3bd8122d139e11cc2086d6e2b8f706f'},
 {path:'desktop/electron/loop-output-service.ts',site:'output',sha256:'497fb772a76e4c509d62a212907fb6edeed28e018a461a129fda7bdca73b9a23'},
]);
const digest=source=>createHash('sha256').update(source).digest('hex');
const normalize=path=>path.replace(/\\/g,'/');
const writeSync=initialWriteSync,stringify=JSON.stringify,byteLength=Buffer.byteLength;
const fail=()=>{throw Error('loop_read_error_diagnostic_assembly');};
export function parseDiagnosticMode(value){if(value===undefined)return false;if(value==='1')return true;throw Error('loop_read_error_diagnostic_configuration');}
function target(path){const found=TARGETS.find(t=>t.path===path);if(!found)fail();return found;}
export function applyExactTransforms(source,pairs){for(const {from,to} of pairs){if(source.split(from).length!==2)fail();source=source.replace(from,to);}return source;}
function pairs(path){
 if(target(path).site==='reader')return [
  {from:' const deadline=new AbortController()',to:' const __loopReadDiagnosticReader=__loopReadDiagnostic.readerBegin();\n const deadline=new AbortController()'},
  {from:"setTimeout(()=>deadline.abort(Error('loop_publication_read_timeout')),10000)",to:"setTimeout(()=>{__loopReadDiagnostic.timerFired(__loopReadDiagnosticReader);deadline.abort(Error('loop_publication_read_timeout'));},10000)"},
  {from:'async function wait<T>(read:()=>Promise<T>)',to:'async function wait<T>(phase:string,read:()=>Promise<T>)'},
  {from:'  active.throwIfAborted();\n  try{const value=await read();active.throwIfAborted();return value;}',to:'  __loopReadDiagnostic.waitBegin(__loopReadDiagnosticReader,phase);\n  active.throwIfAborted();\n  try{const value=await read();active.throwIfAborted();__loopReadDiagnostic.waitEnd(__loopReadDiagnosticReader,phase);return value;}'},
  {from:'const before=await wait(()=>application!.inspect(active))',to:"const before=await wait('inspect-before',()=>application!.inspect(active))"},
  {from:'const observed=await wait(()=>publisher!.observe(active))',to:"const observed=await wait('observe-before',()=>publisher!.observe(active))"},
  {from:'const payload=await wait(()=>publisher!.readPayload(observed,active))',to:"const payload=await wait('payload',()=>publisher!.readPayload(observed,active))"},
  {from:'const afterApplication=await wait(()=>application!.inspect(active))',to:"const afterApplication=await wait('inspect-after',()=>application!.inspect(active))"},
  {from:'const afterPublication=await wait(()=>publisher!.observe(active))',to:"const afterPublication=await wait('observe-after',()=>publisher!.observe(active))"},
  {from:'  return Object.freeze({binding,application:originalApplication as',to:'  __loopReadDiagnostic.returnReady(__loopReadDiagnosticReader);\n  return Object.freeze({binding,application:originalApplication as'},
  {from:' }finally{\n  clearTimeout(timer);',to:' }catch(__loopReadDiagnosticError){__loopReadDiagnostic.readerFailure(__loopReadDiagnosticReader,__loopReadDiagnosticError);throw __loopReadDiagnosticError;}finally{\n  clearTimeout(timer);'},
  {from:'  try{publisher?.dispose();}finally{application?.dispose();}',to:'  let __loopReadDiagnosticCleanupFailed=true;\n  try{try{publisher?.dispose();}finally{application?.dispose();}__loopReadDiagnosticCleanupFailed=false;}finally{__loopReadDiagnostic.readerSettled(__loopReadDiagnosticReader,__loopReadDiagnosticCleanupFailed);}'},
 ];
 if(target(path).site==='consumer')return [{from:'}catch{signal?.throwIfAborted();return false;}',to:'}catch(__loopReadDiagnosticError){__loopReadDiagnostic.consumerCatch(__loopReadDiagnosticError);signal?.throwIfAborted();return false;}'}];
 return [{from:'void work.then(()=>pending.delete(work),()=>pending.delete(work));return work;',to:'void work.then(()=>pending.delete(work),__loopReadDiagnosticError=>{__loopReadDiagnostic.outputRejection(kind,__loopReadDiagnosticError);return pending.delete(work);});return work;'}];
}
function prefix(path,client){return `import {loopReadDiagnostic as __loopReadDiagnostic} from ${JSON.stringify(normalize(client))};\n__loopReadDiagnostic.siteLoaded('${target(path).site}');\n`;}
export function instrumentSource(path,source,client){
 if(digest(source)!==target(path).sha256)fail();
 const changed=prefix(path,client)+applyExactTransforms(source,pairs(path));
 if(restoreSource(path,changed,client)!==source)fail();
 return changed;
}
export function restoreSource(path,source,client){
 source=applyExactTransforms(source,[{from:prefix(path,client),to:''}]);
 source=applyExactTransforms(source,pairs(path).reverse().map(({from,to})=>({from:to,to:from})));
 if(digest(source)!==target(path).sha256)fail();return source;
}
export function createDiagnosticPlugin({repoRoot,mode,onLoaderReceipt}={}){
 if(!parseDiagnosticMode(mode))return null; // No source reads/hashes in off mode.
 const byPath=new Map(TARGETS.map(t=>[normalize(resolve(repoRoot,t.path)),t]));
 const client=normalize(resolve(repoRoot,'desktop/tests/fixtures/loop-read-error-diagnostic-client.mjs')),loaded=new Set();
 const emit=onLoaderReceipt??(value=>{const line=LOADER_PREFIX+stringify(value)+'\n';if(writeSync(1,line)!==byteLength(line,'utf8'))fail();});
 return {name:'temporary-loop-read-error-diagnostic',enforce:'pre',load(id){
  const item=byPath.get(normalize(id.split('?')[0]));if(!item)return;
  const original=readFileSync(resolve(repoRoot,item.path),'utf8'),changed=instrumentSource(item.path,original,client);
  if(!loaded.has(item.site)){
   try{emit({schemaVersion:1,site:item.site,sourceSha256:digest(original),transformedSha256:digest(changed),recorderModuleIdSha256:digest(client)});}catch{fail();}
   loaded.add(item.site);
  }
  return changed;
 }};
}
