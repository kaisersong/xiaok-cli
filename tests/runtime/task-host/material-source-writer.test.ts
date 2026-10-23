import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,realpathSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const gates=vi.hoisted(()=>new Map<string,{entered():void;wait:Promise<void>;fail?:boolean}>());
vi.mock('node:fs/promises',async load=>{const fs=await load<typeof import('node:fs/promises')>();return {...fs,copyFile:async(...args:Parameters<typeof fs.copyFile>)=>{const gate=gates.get(String(args[0]));if(gate){gate.entered();await gate.wait;if(gate.fail)throw Error('copy_fixture_failure');}return fs.copyFile(...args);}};});
import {MaterialRegistry} from '../../../src/runtime/task-host/material-registry.js';
const roots:string[]=[];
afterEach(()=>{gates.clear();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture(){const root=realpathSync(mkdtempSync(join(tmpdir(),'material-close-')));roots.push(root);const source=join(root,'source');mkdirSync(source);const a=join(source,'a.md'),b=join(source,'b.md');writeFileSync(a,'first');writeFileSync(b,'second');const options={workspaceRoot:join(root,'workspace'),maxBytes:1024*1024},store=new MaterialRegistry(options);expect(typeof store.sealAndDrainInstanceMutations).toBe('function');return {root,a,b,options,store};}
function block(path:string,fail=false){let entered!:()=>void,release!:()=>void;const started=new Promise<void>(r=>entered=r),wait=new Promise<void>(r=>release=r);gates.set(path,{entered,wait,fail});return {started,release};}
const input=(sourcePath:string)=>({sourcePath,taskId:'task',role:'customer_material' as const,roleSource:'user' as const});
it('seals before any new mutation and retains the same close Promise',async()=>{
 const {store,a,options}=fixture(),close=store.sealAndDrainInstanceMutations();expect(store.sealAndDrainInstanceMutations()).toBe(close);await close;
 await expect(store.importMaterial(input(a))).rejects.toThrow('material_source_closed');await expect(store.updateMaterialExtraction('missing',{parseStatus:'failed'})).rejects.toThrow('material_source_closed');expect(existsSync(options.workspaceRoot)).toBe(false);
});
it('waits for original copy/hash/index tails and isolates previously returned objects, options and inputs',async()=>{
 const {store,a,b,options,root}=fixture(),record=await store.importMaterial(input(a)),fromGet=store.get(record.materialId)!,fromList=store.list('task')[0]!,originalRoot=options.workspaceRoot,gate=block(b),request=input(b),pending=store.importMaterial(request);await gate.started;
 let ended=false;const close=store.sealAndDrainInstanceMutations();void close.then(()=>ended=true);expect(store.sealAndDrainInstanceMutations()).toBe(close);
 record.originalName='wrong-import';fromGet.originalName='wrong-get';fromList.originalName='wrong-list';options.workspaceRoot=join(root,'wrong-root');request.taskId='wrong-task';await Promise.resolve();expect(ended).toBe(false);
 await expect(store.importMaterial(input(a))).rejects.toThrow('material_source_closed');gate.release();const imported=await pending;await close;
 expect(imported.taskId).toBe('task');expect(readFileSync(imported.workspacePath,'utf8')).toBe('second');expect(existsSync(options.workspaceRoot)).toBe(false);
 const index=JSON.parse(readFileSync(join(originalRoot,'materials-index.json'),'utf8'));expect(index.records.map((r:{originalName:string})=>r.originalName)).toEqual(['a.md','b.md']);expect(store.get(record.materialId)!.originalName).toBe('a.md');
});
it('isolates loaded unknown nested JSON as well as extraction results',async()=>{
 const {options,a,store:seed}=fixture();const base=await seed.importMaterial(input(a));await seed.sealAndDrainInstanceMutations();writeFileSync(join(options.workspaceRoot,'materials-index.json'),JSON.stringify({records:[{...base,nested:{value:1}}]}));
 const store=new MaterialRegistry(options),legacy=store.get(base.materialId)! as unknown as {nested:{value:number}};legacy.nested.value=9;
 const imported=await store.importMaterial(input(a)),updated=await store.updateMaterialExtraction(imported.materialId,{parseStatus:'parsed',parseSummary:'original'});updated.parseSummary='changed';await store.sealAndDrainInstanceMutations();
 expect((store.get(base.materialId)! as unknown as {nested:{value:number}}).nested.value).toBe(1);expect(store.get(imported.materialId)!.parseSummary).toBe('original');
});
it('waits for all pending operations before reporting one failure and preserves failed close',async()=>{
 const {store,a,b}=fixture(),first=block(a,true),second=block(b),one=store.importMaterial(input(a)),two=store.importMaterial(input(b));const failed=expect(one).rejects.toThrow('copy_fixture_failure');await Promise.all([first.started,second.started]);
 const close=store.sealAndDrainInstanceMutations(),closing=expect(close).rejects.toThrow('material_source_close_unconfirmed');let settled=false;void close.then(()=>settled=true,()=>settled=true);first.release();await failed;await Promise.resolve();expect(settled).toBe(false);second.release();await two;await closing;expect(store.sealAndDrainInstanceMutations()).toBe(close);
});
it('registers admission before a producer callback can reenter close',async()=>{
 const {a,options}=fixture();let close:Promise<void>|undefined;let store:MaterialRegistry;store=new MaterialRegistry({...options,now:()=>{close=store.sealAndDrainInstanceMutations();return 123;}});
 const record=await store.importMaterial(input(a));await close;expect(record.createdAt).toBe(123);expect(JSON.parse(readFileSync(join(options.workspaceRoot,'materials-index.json'),'utf8')).records).toHaveLength(1);await expect(store.importMaterial(input(a))).rejects.toThrow('material_source_closed');
});
it('requires the actual constructor instance for close and mutation',async()=>{
 const {store,a}=fixture();expect(()=>store.sealAndDrainInstanceMutations.call({...store})).toThrow('material_source_owner');await expect(store.importMaterial.call({...store},input(a))).rejects.toThrow('material_source_owner');
});
