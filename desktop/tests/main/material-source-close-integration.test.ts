// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {MaterialRegistry} from '../../../src/runtime/task-host/material-registry.js';
import {ArtifactWorkspaceService} from '../../electron/artifact-workspace-service.js';
import {ArtifactWorkspaceFileManager} from '../../electron/artifact-workspace-files.js';
import {createDesktopServices,executeReadMaterialForDesktop} from '../../electron/desktop-services.js';
import type {KSwarmService} from '../../electron/kswarm-service.js';
const roots:string[]=[],prior=process.env.XIAOK_CONFIG_DIR;
afterEach(()=>{vi.restoreAllMocks();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});if(prior===undefined)delete process.env.XIAOK_CONFIG_DIR;else process.env.XIAOK_CONFIG_DIR=prior;});
function root(){const path=mkdtempSync(join(tmpdir(),'material-main-close-'));roots.push(path);return path;}
it('refuses late extractor output before writing any new material body',async()=>{
 const path=root(),file=join(path,'source.pdf');writeFileSync(file,'%PDF-1.7 fixture');const registry=new MaterialRegistry({workspaceRoot:join(path,'workspace'),maxBytes:1024}),record=await registry.importMaterial({sourcePath:file,taskId:'task',role:'customer_material',roleSource:'user'});
 let entered!:()=>void,release!:()=>void;const ready=new Promise<void>(r=>entered=r),wait=new Promise<void>(r=>release=r);
 const reading=executeReadMaterialForDesktop({materialId:record.materialId},{taskId:'task',materials:[record],materialRegistry:registry,pdfToText:async()=>{entered();await wait;return 'late text';}});await ready;await registry.sealAndDrainInstanceMutations();release();await expect(reading).rejects.toThrow('material_source_closed');
 expect(existsSync(join(dirname(record.workspacePath),record.materialId+'.txt'))).toBe(false);expect(existsSync(join(dirname(record.workspacePath),record.materialId+'.extracted.txt'))).toBe(false);expect(readFileSync(record.workspacePath,'utf8')).toBe('%PDF-1.7 fixture');
});
it('closes the two actual Main instances once and rejects a late Main material import',async()=>{
 const path=root();process.env.XIAOK_CONFIG_DIR=join(path,'config');const file=join(path,'source.md');writeFileSync(file,'original');
 const serviceClose=vi.spyOn(ArtifactWorkspaceService.prototype,'sealAndDrainInstanceMutations');
 const materialClose=vi.spyOn(MaterialRegistry.prototype,'sealAndDrainInstanceMutations'),artifactClose=vi.spyOn(ArtifactWorkspaceFileManager.prototype,'sealAndDrainInstanceMutations');
 const service=createDesktopServices({dataRoot:join(path,'data'),kswarmService:{getBaseUrl:()=> 'http://127.0.0.1:1',getDesktopMutationToken:()=> 'fixture',request:async()=>new Response('{}',{status:501})} as unknown as KSwarmService});
 try{const serviceClosing=service.sealAndDrainArtifactWorkspaceServiceInstance();expect(service.sealAndDrainArtifactWorkspaceServiceInstance()).toBe(serviceClosing);await serviceClosing;expect(serviceClose).toHaveBeenCalledTimes(2);await service.importMaterial({taskId:'task',filePath:file,role:'customer_material'});const close=service.closeMaterialRegistryAndArtifactFileManagerInstances();expect(service.closeMaterialRegistryAndArtifactFileManagerInstances()).toBe(close);await close;expect(materialClose).toHaveBeenCalledTimes(1);expect(artifactClose).toHaveBeenCalledTimes(1);await expect(service.importMaterial({taskId:'late',filePath:file,role:'customer_material'})).rejects.toThrow('material_source_closed');expect(existsSync(join(path,'data','workspace','late'))).toBe(false);}finally{await service.disposeMultiAgent();}
});
it('accepts the original extractor truncation suffix beyond two million characters',async()=>{
 const path=root(),file=join(path,'source.pdf');writeFileSync(file,'%PDF-1.7 fixture');const registry=new MaterialRegistry({workspaceRoot:join(path,'workspace'),maxBytes:1024}),record=await registry.importMaterial({sourcePath:file,taskId:'task',role:'customer_material',roleSource:'user'});
 const result=await executeReadMaterialForDesktop({materialId:record.materialId},{taskId:'task',materials:[record],materialRegistry:registry,pdfToText:async()=> 'x'.repeat(2_000_100)});expect(result.ok).toBe(true);const updated=registry.get(record.materialId)!;expect(updated.extractionTruncated).toBe(true);const body=readFileSync(updated.extractedTextPath!,'utf8');expect(body.length).toBeGreaterThan(2_000_000);expect(body.length).toBeLessThanOrEqual(2_000_256);await registry.sealAndDrainInstanceMutations();
});
