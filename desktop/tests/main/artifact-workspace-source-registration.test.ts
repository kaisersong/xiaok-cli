import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {mkdtempSync,mkdirSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const fixture=vi.hoisted(()=>({home:''}));
vi.mock('node:os',async load=>{const actual=await load<typeof import('node:os')>();return {...actual,userInfo:()=>({...actual.userInfo(),homedir:fixture.home})};});
vi.mock('../../../src/runtime/verification/migration-markers.js',async load=>({...await load<typeof import('../../../src/runtime/verification/migration-markers.js')>(),readInstalledCurrentProfile:()=>({kind:'ordinary'})}));
vi.unmock('../../../src/runtime/verification/ordinary-source-writer-observation.js');
import {createDesktopServices} from '../../electron/desktop-services.js';
import {readOrdinaryProfileSources} from '../../../src/runtime/verification/ordinary-profile-source-registry.js';
import type {KSwarmService} from '../../electron/kswarm-service.js';
const root=realpathSync(mkdtempSync(join(tmpdir(),'artifact-main-source-'))),prior=process.env.XIAOK_CONFIG_DIR;
beforeAll(()=>{fixture.home=join(root,'account');mkdirSync(fixture.home);process.env.XIAOK_CONFIG_DIR=join(root,'config');});
afterAll(()=>{if(prior===undefined)delete process.env.XIAOK_CONFIG_DIR;else process.env.XIAOK_CONFIG_DIR=prior;rmSync(root,{recursive:true,force:true});});
it('registers the workspace source from the real Main service composition',async()=>{
 const kswarmService={start:async()=>{},stop:async()=>{},restart:async()=>{},getStatus:()=>({running:false,port:4400,pid:null,restartCount:0,lastError:null}),onStatusChange:()=>()=>{},getDesktopMutationToken:()=> 'fixture',request:async()=>new Response('{}',{status:501})} as unknown as KSwarmService;
 const dataRoot=join(root,'data'),services=createDesktopServices({dataRoot,workspaceRoot:root,pluginRootDir:join(root,'plugins'),kswarmService,now:()=>1700000000000});
 try{const sources=readOrdinaryProfileSources();expect(sources?.legacyInventoryRequired).toBe(true);expect(sources?.sources.some(source=>source.directory.canonicalPath===join(dataRoot,'artifact-workspace')&&source.database?.basename==='workspace.sqlite'&&source.snapshotFormat==='artifact-workspace-sqlite-v1')).toBe(true);}
 finally{await services.disposeMultiAgent();}
});
