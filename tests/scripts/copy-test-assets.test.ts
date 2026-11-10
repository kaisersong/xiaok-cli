import {afterEach,expect,it} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const originalScript=resolve('scripts/copy-test-assets.mjs');
const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true,maxRetries:3});});
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'copy-test-assets-'));roots.push(root);
 for(const rel of ['tests','src','scripts','desktop/electron','desktop/native/artifact-export-helper'])mkdirSync(join(root,rel),{recursive:true});
 for(const name of ['go.mod','main.go','identity_unix.go','identity_windows.go'])writeFileSync(join(root,'desktop/native/artifact-export-helper',name),'original fixed helper fixture\n');
 return {root,run:()=>{const child=spawnSync(process.execPath,[originalScript],{cwd:root,encoding:'utf8'});console.log(JSON.stringify({kind:'owned-copy-test-assets',pid:child.pid,status:child.status,signal:child.signal,root}));return child;}};
}
it('copies only fixed plain desktop runtime assets through the original script without replacing emitted JS or traversing other trees',()=>{
 const f=fixture(),runtime=join(f.root,'desktop/electron');
 const bytes=new Map([['harness-dsh-source-read-budget.mjs','export const originalSourceReadBudget = 1;\n'],['worker.cjs','module.exports = 2;\n']]);
 for(const [name,body] of bytes)writeFileSync(join(runtime,name),body);
 for(const name of ['private.json','settings.env','source.ts','.private.mjs'])writeFileSync(join(runtime,name),'not a runtime carrier');
 for(const name of ['node_modules','build','nested']){mkdirSync(join(runtime,name));writeFileSync(join(runtime,name,'must-not-copy.mjs'),'outside fixed file population');}
 if(process.platform!=='win32')symlinkSync(join(runtime,'worker.cjs'),join(runtime,'linked.cjs'));
 mkdirSync(join(f.root,'.test-dist/desktop/electron'),{recursive:true});writeFileSync(join(f.root,'.test-dist/desktop/electron/compiled.js'),'original tsc bytes');
 const result=f.run();expect(result.status,result.stderr).toBe(0);expect(result.stdout).toContain('desktopRuntime=2');
 for(const [name,body] of bytes)expect(readFileSync(join(f.root,'.test-dist/desktop/electron',name),'utf8')).toBe(body);
 expect(readFileSync(join(f.root,'.test-dist/desktop/electron/compiled.js'),'utf8')).toBe('original tsc bytes');
 for(const name of ['private.json','settings.env','source.ts','.private.mjs','node_modules','build','nested','linked.cjs'])expect(existsSync(join(f.root,'.test-dist/desktop/electron',name))).toBe(false);
 for(const name of ['go.mod','main.go','identity_unix.go','identity_windows.go'])expect(readFileSync(join(f.root,'.test-dist/desktop/native/artifact-export-helper',name),'utf8')).toBe('original fixed helper fixture\n');
});
it('refuses a symlinked runtime output directory before overwriting any outside file',()=>{
 const f=fixture(),outside=join(f.root,'outside');mkdirSync(outside);writeFileSync(join(outside,'worker.mjs'),'original outside bytes');writeFileSync(join(f.root,'desktop/electron/worker.mjs'),'candidate carrier');mkdirSync(join(f.root,'.test-dist/desktop'),{recursive:true});symlinkSync(outside,join(f.root,'.test-dist/desktop/electron'),process.platform==='win32'?'junction':'dir');
 const result=f.run();expect(result.status).not.toBe(0);expect(result.stderr).toContain('test_asset_desktop_runtime_target_not_plain');expect(readFileSync(join(outside,'worker.mjs'),'utf8')).toBe('original outside bytes');
});
