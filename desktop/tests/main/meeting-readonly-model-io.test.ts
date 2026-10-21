// @vitest-environment node
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,chmodSync} from 'node:fs';
import{tmpdir}from'node:os';import{join}from'node:path';import{createHash}from'node:crypto';
import{afterEach,expect,it,vi}from'vitest';
import{createMeetingModelService,type MeetingModelServiceOptions}from'../../electron/meeting-model-service.js';
const roots:string[]=[];afterEach(()=>{for(const r of roots.splice(0))rmSync(r,{recursive:true,force:true});});
function fixture(){const root=mkdtempSync(join(tmpdir(),'meeting-readonly-owned-'));roots.push(root);const cache=join(root,'cache');mkdirSync(cache);const data=Buffer.from('owned model'),sha=createHash('sha256').update(data).digest('hex'),download=vi.fn(async()=>{throw Error('readonly_must_not_download')});const options={cacheDir:cache,models:[{id:'owned',fileName:'owned.pt',url:'https://owned.invalid',expectedSizeBytes:data.length,expectedSha256:sha}],downloadFile:download};return{root,cache,data,download,options,strict:createMeetingModelService({...options,readonlyIoPolicy:'truthful'}as MeetingModelServiceOptions)};}
it('truthful listing rejects an actual access failure instead of claiming missing models',()=>{
 const f=fixture();writeFileSync(join(f.cache,'owned.pt'),f.data);chmodSync(f.cache,0);try{expect(()=>f.strict.listModels()).toThrow();}finally{chmodSync(f.cache,0o700);}expect(f.download).not.toHaveBeenCalled();
});
it('preserves complete absent and verified model metadata without downloading',()=>{
 const f=fixture();expect(f.strict.listModels()[0]).toMatchObject({id:'owned',downloaded:false,status:'not_downloaded',packageState:'missing',runtimeAutoDownloadAllowed:false});writeFileSync(join(f.cache,'owned.pt'),f.data);expect(f.strict.listModels()[0]).toMatchObject({id:'owned',downloaded:true,status:'downloaded',packageState:'verified',localSizeBytes:f.data.length});expect(f.download).not.toHaveBeenCalled();
});
it('default service retains its original tolerant existence decision',()=>{
 const f=fixture();writeFileSync(join(f.cache,'owned.pt'),f.data);chmodSync(f.cache,0);try{expect(createMeetingModelService(f.options).listModels()[0]).toMatchObject({status:'not_downloaded'});}finally{chmodSync(f.cache,0o700);}
});
