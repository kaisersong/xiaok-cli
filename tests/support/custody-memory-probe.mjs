// Private no-op lifecycle load. No app, credentials, user profile or SQLite opens.
import {setImmediate as tick} from 'node:timers/promises';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const {ContinuitySdkCustody}=await import(process.argv[2]);
if(typeof global.gc!=='function')throw Error('gc_probe_required');
let sdk=new ContinuitySdkCustody(),cleanup=async()=>{};const noop=()=>undefined;
if(process.argv[3]==='input'){
 const load=async relative=>{const url=new URL(relative,process.argv[2]);if(!existsSync(url))url.pathname=url.pathname.replace(/\.js$/,'.ts');return import(url.href);};
 const [{ContinuityInputSource},{FileTaskSnapshotStore},{MaterialRegistry}]=await Promise.all([load('../../../src/runtime/task-host/continuity-input-source.js'),load('../../../src/runtime/task-host/snapshot-store.js'),load('../../../src/runtime/task-host/material-registry.js')]);
 const root=mkdtempSync(join(tmpdir(),'input-custody-memory-')),store=new FileTaskSnapshotStore(join(root,'tasks')),materials=new MaterialRegistry({workspaceRoot:join(root,'materials'),maxBytes:1024});
 const source=new ContinuityInputSource({authorizeInputAdmission:noop},store,materials,noop,()=>{throw Error('unused_reservation');},()=>false,()=>false,(fn,args)=>Reflect.apply(fn,undefined,args));
 const snapshot={taskId:'task',sessionId:'session',status:'completed',prompt:'fixture',materials:[],events:[],createdAt:1,updatedAt:2};
 sdk={invokeSync:()=>source.admit(snapshot),invoke:async()=>source.admit(snapshot),waitKnown:()=>source.waitKnown()};
 cleanup=async()=>{await store.closeAndDrain();await materials.sealAndDrainInstanceMutations();rmSync(root,{recursive:true,force:true});};
}
await tick();global.gc();const before=process.memoryUsage().heapUsed;
for(let batch=0;batch<10;batch++){
 for(let n=0;n<1000;n++)sdk.invokeSync(noop,undefined,[]);
 for(let n=0;n<1000;n++)await sdk.invoke(noop,undefined,[]);
 await tick();
}
await sdk.waitKnown();await tick();global.gc();const after=process.memoryUsage().heapUsed;
console.log(JSON.stringify({calls:20000,before,after,growth:after-before,physicalKnown:true,productionQualified:false,mode:process.argv[3]??'sdk'}));
await cleanup();
