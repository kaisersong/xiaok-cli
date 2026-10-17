// @vitest-environment node
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {expect,it} from 'vitest';
import {normalizePath} from 'vite';
import config from '../../vitest.config.js';

const entry=normalizePath(resolve(__dirname,'../../electron/desktop-services.ts'));
const plugin=config.plugins!.find(value=>value && !Array.isArray(value) && 'name' in value && value.name==='real-private-finalization-test-entry') as {load(id:string):string|undefined};
const source=readFileSync(entry,'utf8');
it('loads the full actual finalization source through the default test configuration',()=>{
 expect(plugin).toBeDefined();
 expect(plugin.load(entry)).toBe(source+'\nexport {streamDesktopToolLoopFinalization as __testFinalization};\n');
});
it('uses the same actual source for query suffixed Vite requests',()=>{
 expect(plugin.load(entry+'?v=current')).toBe(plugin.load(entry));
});
it.each([entry+'.backup',entry+'/child','\0'+entry,normalizePath(resolve(__dirname,'../fixtures/desktop-services.ts'))])('never aliases a virtual or different source: %s',id=>{
 expect(plugin.load(id)).toBeUndefined();
});
it('keeps the test alias out of production source',()=>{
 expect(source).not.toMatch(/export\s*\{[^}]*__testFinalization/);
});
