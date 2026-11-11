import {setProfileTestHome} from '../../support/profile-home-env.js';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {copyFileSync,mkdtempSync,mkdirSync,realpathSync,renameSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
const state=vi.hoisted(()=>({home:'',directorySyncs:[] as string[],failDirectorySync:false,descriptorPaths:new Map<number,string>()}));
vi.mock('node:fs',async load=>{const actual=await load<typeof import('node:fs')>();return{...actual,
 openSync:((path:any,...args:any[])=>{const fd=(actual.openSync as Function)(path,...args);state.descriptorPaths.set(fd,String(path));return fd;}) as typeof actual.openSync,
 closeSync:(fd:number)=>{state.descriptorPaths.delete(fd);actual.closeSync(fd);},
 fsyncSync:(fd:number)=>{if(actual.fstatSync(fd).isDirectory()){state.directorySyncs.push(state.descriptorPaths.get(fd)??'?');if(state.failDirectorySync)throw Error('actual registry directory sync failed');}actual.fsyncSync(fd);}};});
vi.mock('node:os',async load=>{const actual=await load<typeof import('node:os')>();return{...actual,userInfo:()=>({...actual.userInfo(),homedir:state.home})};});
vi.mock('../../../src/runtime/verification/migration-markers.js',()=>({readInstalledCurrentProfile:()=>({kind:'ordinary'})}));
import {registerOrdinaryProfileSource,readOrdinaryProfileSources} from '../../../src/runtime/verification/ordinary-profile-source-registry.js';
let root:string;
beforeEach(()=>{root=realpathSync(mkdtempSync(join(tmpdir(),'profile-source-durable-')));state.home=join(root,'account');setProfileTestHome(state.home);mkdirSync(state.home);state.directorySyncs=[];state.failDirectorySync=false;});
afterEach(()=>{rmSync(root,{recursive:true,force:true});vi.unstubAllEnvs();});
function source(name:string){const p=join(root,name);mkdirSync(p);return p;}
function registryRoot(){return join(state.home,'.xiaok','profile-sources');}
/** syncDirectoryTreeStrict fsyncs the registry root and every ancestor up to the filesystem root. */
function tree(){const dirs:string[]=[];for(let d=registryRoot();;d=dirname(d)){dirs.push(d);if(dirname(d)===d)return dirs;}}
function syncs(work:()=>void){state.directorySyncs=[];work();return [...state.directorySyncs];}

it('skips the directory barrier only for unchanged bytes this process already made durable', () => {
 const a=source('a'),b=source('b');
 const first=syncs(()=>registerOrdinaryProfileSource({kind:'session-root',directory:a}));
 expect(first).toEqual(expect.arrayContaining(tree()));expect(first.length).toBeGreaterThanOrEqual(tree().length);
 // Unchanged: zero directory fsyncs, same bytes and generation.
 expect(syncs(()=>registerOrdinaryProfileSource({kind:'session-root',directory:a}))).toEqual([]);
 expect(readOrdinaryProfileSources()!.generation).toBe('1');
 // Changed content: every directory of the tree is synced again.
 const changed=syncs(()=>registerOrdinaryProfileSource({kind:'task-root',directory:b}));
 expect(readOrdinaryProfileSources()!.generation).toBe('2');
 expect(changed).toEqual(expect.arrayContaining(tree()));
 expect(syncs(()=>registerOrdinaryProfileSource({kind:'task-root',directory:b}))).toEqual([]);
});

it('syncs again after an external replacement with identical bytes and after a failed barrier', () => {
 const a=source('a');registerOrdinaryProfileSource({kind:'session-root',directory:a});
 const file=join(registryRoot(),'registry.json'),copy=file+'.copy';copyFileSync(file,copy);renameSync(copy,file);
 expect(syncs(()=>registerOrdinaryProfileSource({kind:'session-root',directory:a}))).toEqual(expect.arrayContaining(tree()));
 const replacedAgain=file+'.again';copyFileSync(file,replacedAgain);renameSync(replacedAgain,file);
 state.failDirectorySync=true;expect(()=>registerOrdinaryProfileSource({kind:'session-root',directory:a})).toThrow('actual registry directory sync failed');
 state.failDirectorySync=false;
 expect(syncs(()=>registerOrdinaryProfileSource({kind:'session-root',directory:a}))).toEqual(expect.arrayContaining(tree()));
 expect(syncs(()=>registerOrdinaryProfileSource({kind:'session-root',directory:a}))).toEqual([]);
});
