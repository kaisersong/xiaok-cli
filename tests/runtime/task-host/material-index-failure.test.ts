import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const fault=vi.hoisted(()=>({fail:false}));
vi.mock('../../../src/utils/atomic-file.js',async load=>{const real=await load<typeof import('../../../src/utils/atomic-file.js')>();return {...real,writeFileAtomicallySync:(...args:Parameters<typeof real.writeFileAtomicallySync>)=>{if(fault.fail&&args[0].endsWith('materials-index.json'))throw Error('fixture_index_failure');return real.writeFileAtomicallySync(...args);}};});
import {MaterialRegistry} from '../../../src/runtime/task-host/material-registry.js';
const roots:string[]=[];afterEach(()=>{fault.fail=false;for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture(){const root=mkdtempSync(join(tmpdir(),'material-index-failure-'));roots.push(root);const source=join(root,'source.md');writeFileSync(source,'original');return {root,store:new MaterialRegistry({workspaceRoot:join(root,'workspace'),maxBytes:1024}),input:{sourcePath:source,taskId:'task',role:'customer_material' as const,roleSource:'user' as const}};}
it('retains a completed unresolved index failure when the instance seals',async()=>{const {store,input}=fixture();fault.fail=true;await expect(store.importMaterial(input)).rejects.toThrow('fixture_index_failure');fault.fail=false;const close=store.sealAndDrainInstanceMutations();await expect(close).rejects.toThrow('material_index_close_unconfirmed');expect(store.sealAndDrainInstanceMutations()).toBe(close);});
it('allows an actual subsequent complete index commit to resolve the previous index failure before sealing',async()=>{const {root,store,input}=fixture();fault.fail=true;await expect(store.importMaterial(input)).rejects.toThrow('fixture_index_failure');fault.fail=false;await store.importMaterial(input);await store.sealAndDrainInstanceMutations();expect(JSON.parse(readFileSync(join(root,'workspace','materials-index.json'),'utf8')).records).toHaveLength(2);});
