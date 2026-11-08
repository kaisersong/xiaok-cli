// @vitest-environment node
import {afterEach,expect,it} from 'vitest';
import {copyFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const cleanup:string[]=[];
afterEach(()=>{for(const root of cleanup.splice(0))rmSync(root,{recursive:true,force:true});});
async function isolated(){
 const root=mkdtempSync(join(tmpdir(),'windows-source-fixture-'));cleanup.push(root);
 const relative=['desktop/tests/support/prepare-windows-source-absence.mjs','scripts/verification/copy-windows-absence.mjs',
  'src/runtime/verification/native/windows-installation-absence.c','src/runtime/verification/native/windows-installation-absence-core.h',
  ...['exe','json'].map(ext=>`data/verification/windows/win32-${process.arch}/windows-installation-absence.${ext}`)];
 for(const name of relative){mkdirSync(dirname(join(root,name)),{recursive:true});copyFileSync(join(repo,name),join(root,name));}
 const entry=join(root,relative[0]!);
 const api=await import(/* @vite-ignore */ pathToFileURL(entry).href);
 const source=join(root,'data/verification/windows',`win32-${process.arch}`),destination=join(root,'src/runtime/verification/native',`win32-${process.arch}`);
 return {root,source,destination,api};
}
it('prepares the verified source-layout pair once, preserving locked source bytes',async()=>{
 const {source,destination,api}=await isolated();
 const before=readFileSync(join(source,'windows-installation-absence.exe'));
 const first=api.prepareWindowsSourceAbsence(),second=api.prepareWindowsSourceAbsence();
 expect(first).toEqual(second);expect(Object.isFrozen(first)).toBe(true);
 expect(readFileSync(join(destination,'windows-installation-absence.exe'))).toEqual(before);
 expect(readFileSync(join(source,'windows-installation-absence.exe'))).toEqual(before);
 expect(readFileSync(join(destination,'windows-installation-absence.json'))).toEqual(readFileSync(join(source,'windows-installation-absence.json')));
});
it('rejects corrupt locked bytes before publishing any destination',async()=>{
 const {source,destination,api}=await isolated();writeFileSync(join(source,'windows-installation-absence.exe'),'corrupt');
 expect(()=>api.prepareWindowsSourceAbsence()).toThrow('Windows absence SHA mismatch');expect(existsSync(destination)).toBe(false);
});
it('rejects a stale manifest source hash before publishing',async()=>{
 const {root,destination,api}=await isolated();writeFileSync(join(root,'src/runtime/verification/native/windows-installation-absence.c'),'changed source');
 expect(()=>api.prepareWindowsSourceAbsence()).toThrow('Windows absence source mismatch');expect(existsSync(destination)).toBe(false);
});
it('refuses a partial preexisting pair without overwriting or completing it',async()=>{
 const {destination,api}=await isolated();mkdirSync(destination);writeFileSync(join(destination,'windows-installation-absence.exe'),'original');
 expect(()=>api.prepareWindowsSourceAbsence()).toThrow('Windows absence artifact missing');
 expect(readFileSync(join(destination,'windows-installation-absence.exe'),'utf8')).toBe('original');expect(readdirSync(destination)).toEqual(['windows-installation-absence.exe']);
});
it('refuses a non-directory destination and caller options without reading them',async()=>{
 const {destination,api}=await isolated();writeFileSync(destination,'original');
 expect(()=>api.prepareWindowsSourceAbsence()).toThrow();expect(readFileSync(destination,'utf8')).toBe('original');
 let traps=0;const foreign=new Proxy({},{get(){traps++;throw Error('trap');}});
 expect(()=>api.prepareWindowsSourceAbsence(foreign)).toThrow('windows_source_fixture_arguments');expect(traps).toBe(0);
});
