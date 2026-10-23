import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,realpathSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const barrier=vi.hoisted(()=>({active:false,entered:()=>{},wait:Promise.resolve()}));
vi.mock('node:fs/promises',async load=>{const fs=await load<typeof import('node:fs/promises')>();return {...fs,writeFile:async(...args:Parameters<typeof fs.writeFile>)=>{if(barrier.active&&String(args[0]).endsWith('materials-index.json')){barrier.active=false;barrier.entered();await barrier.wait;}return fs.writeFile(...args);}};});
import {MaterialRegistry} from '../../../src/runtime/task-host/material-registry.js';
const roots:string[]=[];afterEach(()=>{barrier.active=false;for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
it('cannot overwrite a newer complete index with an older delayed original async write',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'material-index-order-')));roots.push(root);const source=join(root,'source');mkdirSync(source);const a=join(source,'a.md'),b=join(source,'b.md');writeFileSync(a,'a');writeFileSync(b,'b');const workspace=join(root,'workspace'),store=new MaterialRegistry({workspaceRoot:workspace,maxBytes:1024});
 let release!:()=>void;const started=new Promise<'blocked'>(r=>barrier.entered=()=>r('blocked'));barrier.wait=new Promise<void>(r=>release=r);barrier.active=true;
 const first=store.importMaterial({taskId:'task',sourcePath:a,role:'customer_material',roleSource:'user'});const mode=await Promise.race([started,first.then(()=>'completed' as const)]);
 // Old async writes are deliberately reordered. Atomic commits finish before
 // the second producer starts and never enter this obsolete async write hook.
 if(mode==='completed')barrier.active=false;
 try{await store.importMaterial({taskId:'task',sourcePath:b,role:'customer_material',roleSource:'user'});}finally{release();}
 await first;await store.sealAndDrainInstanceMutations();const stored=JSON.parse(readFileSync(join(workspace,'materials-index.json'),'utf8'));expect(stored.records.map((r:{originalName:string})=>r.originalName).sort()).toEqual(['a.md','b.md']);
});
