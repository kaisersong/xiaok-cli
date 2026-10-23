import {afterEach,expect,it} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,readdirSync,symlinkSync,renameSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ArtifactWorkspaceFileManager} from '../../electron/artifact-workspace-files.js';
const roots:string[]=[];afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture(){const root=mkdtempSync(join(tmpdir(),'artifact-file-close-'));roots.push(root);const source=join(root,'source'),managed=join(root,'managed');mkdirSync(source);const file=join(source,'index.html');writeFileSync(file,'<h1>original</h1>');return {root,source,managed,file,store:new ArtifactWorkspaceFileManager({managedRoot:managed})};}
it('seals all four original mutations while preserving readable content',async()=>{
 const {store,source,file,managed}=fixture(),one={sourcePath:file,allowedRoot:source,stagingId:'one',kind:'html'},staged=store.ingestSingleFile(one),close=store.sealAndDrainInstanceMutations();expect(store.sealAndDrainInstanceMutations()).toBe(close);await close;
 expect(()=>store.ingestSingleFile({...one,stagingId:'late'})).toThrow('artifact_workspace_source_closed');expect(()=>store.ingestSealedPackage({sourceDirectory:source,allowedRoot:source,stagingId:'package',entryRef:'index.html',kind:'html'})).toThrow('artifact_workspace_source_closed');expect(()=>store.finalize(staged)).toThrow('artifact_workspace_source_closed');expect(()=>store.removeManagedRef(staged.stagingRef)).toThrow('artifact_workspace_source_closed');
 expect(readdirSync(join(managed,'staging'))).toEqual(['one']);expect(readFileSync(store.resolveManagedRef(staged.stagingRef),'utf8')).toContain('original');expect(readdirSync(join(managed,'versions'))).toEqual([]);
});
it('preserves original successful package/finalize/remove behavior before seal',async()=>{
 const {store,source}=fixture(),staged=store.ingestSealedPackage({sourceDirectory:source,allowedRoot:source,stagingId:'package',entryRef:'index.html',kind:'html'}),final=store.finalize(staged);expect(store.verifyManagedArtifact(final)).toBe(true);store.removeManagedRef(final.fileRef);expect(existsSync(store.resolveManagedRef(final.fileRef))).toBe(false);await store.sealAndDrainInstanceMutations();
});
it('waits for a synchronous admitted call that reenters close through an input getter',async()=>{
 const {store,source,file}=fixture();let close:Promise<void>|undefined;const staged=store.ingestSingleFile({sourcePath:file,allowedRoot:source,stagingId:'one',get kind(): string {close=store.sealAndDrainInstanceMutations();return 'html';}});await close;expect(store.verifyManagedArtifact({...staged,fileRef:staged.stagingRef})).toBe(true);expect(()=>store.finalize(staged)).toThrow('artifact_workspace_source_closed');
});
it('preserves a synchronous in-flight failure in the reentrant close Promise',async()=>{
 const {store,source,file}=fixture();let close:Promise<void>|undefined;expect(()=>store.ingestSingleFile({sourcePath:file,allowedRoot:source,stagingId:'one',get kind(): string {close=store.sealAndDrainInstanceMutations();throw Error('getter_failure');}})).toThrow('getter_failure');await expect(close).rejects.toThrow('artifact_workspace_source_close_unconfirmed');expect(store.sealAndDrainInstanceMutations()).toBe(close);
});
it('rejects forged constructor instances',()=>{const {store}=fixture();expect(()=>store.sealAndDrainInstanceMutations.call({...store})).toThrow('artifact_workspace_source_owner');});
it.each(['staging','versions'])('refuses deleting the complete %s namespace',namespace=>{
 const {store,source,file}=fixture();const staged=store.ingestSingleFile({sourcePath:file,allowedRoot:source,stagingId:'keep',kind:'document'});expect(()=>store.removeManagedRef(namespace)).toThrow();expect(existsSync(store.resolveManagedRef(staged.stagingRef))).toBe(true);
});
it('rejects copied and cross-manager finalize tickets before renaming',()=>{
 const {store,source,file,root}=fixture(),staged=store.ingestSingleFile({sourcePath:file,allowedRoot:source,stagingId:'keep',kind:'document'}),other=new ArtifactWorkspaceFileManager({managedRoot:join(root,'other')});
 expect(()=>store.finalize({...staged})).toThrow();expect(()=>other.finalize(staged)).toThrow();expect(existsSync(store.resolveManagedRef(staged.stagingRef))).toBe(true);const final=store.finalize(staged);expect(existsSync(store.resolveManagedRef(final.fileRef))).toBe(true);expect(()=>store.finalize(staged)).toThrow();
});

it.each(['staging','versions'])('rejects existing %s namespace symlinks before ingest',namespace=>{
 const {store,source,file,root,managed}=fixture(),outside=join(root,'outside');mkdirSync(outside);rmSync(join(managed,namespace),{recursive:true});symlinkSync(outside,join(managed,namespace));expect(()=>store.ingestSingleFile({sourcePath:file,allowedRoot:source,stagingId:'late',kind:'document'})).toThrow();expect(readdirSync(outside)).toEqual([]);
});
it('refuses final destination replacement even when the original destination is empty',()=>{
 const {store,source,file,managed}=fixture(),staged=store.ingestSingleFile({sourcePath:file,allowedRoot:source,stagingId:'same',kind:'document'});mkdirSync(join(managed,'versions','same'));expect(()=>store.finalize(staged)).toThrow('already exists');expect(existsSync(store.resolveManagedRef(staged.stagingRef))).toBe(true);
});
it('refuses middle-directory symlinks during managed cleanup',()=>{
 const {store,root,managed}=fixture(),outside=join(root,'outside');mkdirSync(outside);writeFileSync(join(outside,'keep.txt'),'keep');symlinkSync(outside,join(managed,'staging','pointer'));expect(()=>store.removeManagedRef('staging/pointer/keep.txt')).toThrow();expect(readFileSync(join(outside,'keep.txt'),'utf8')).toBe('keep');
});
it('binds finalize to the original staged directory identity and DTO',()=>{
 const {store,source,file,managed}=fixture(),staged=store.ingestSingleFile({sourcePath:file,allowedRoot:source,stagingId:'one',kind:'document'});staged.finalRef='versions/other/index.html';expect(()=>store.finalize(staged)).toThrow('metadata changed');staged.finalRef='versions/one/index.html';renameSync(join(managed,'staging','one'),join(managed,'staging','original'));mkdirSync(join(managed,'staging','one'));expect(()=>store.finalize(staged)).toThrow('directory changed');expect(existsSync(join(managed,'staging','original','index.html'))).toBe(true);
});
it.skipIf(process.platform==='win32').each(['a:b.txt','CON','name.'])('preserves actual historical POSIX filename %s for ingest, finalize and cleanup',name=>{
 const {store,source}=fixture(),path=join(source,name);writeFileSync(path,'original POSIX');const staged=store.ingestSingleFile({sourcePath:path,allowedRoot:source,stagingId:'historical',kind:'document'}),final=store.finalize(staged);expect(readFileSync(store.resolveManagedRef(final.fileRef),'utf8')).toBe('original POSIX');store.removeManagedRef(final.fileRef);expect(existsSync(store.resolveManagedRef(final.fileRef))).toBe(false);
});
it('refuses a modified original staging ticket even with a custom toJSON',()=>{
 const {store,source,file}=fixture(),staged=store.ingestSingleFile({sourcePath:file,allowedRoot:source,stagingId:'one',kind:'document'}),original={...staged};staged.finalRef='versions/other/index.html';Object.defineProperty(staged,'toJSON',{value:()=>original});expect(()=>store.finalize(staged)).toThrow('metadata changed');expect(existsSync(store.resolveManagedRef(original.stagingRef))).toBe(true);
});
