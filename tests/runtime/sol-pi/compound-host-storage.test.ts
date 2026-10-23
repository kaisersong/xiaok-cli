import {mkdtempSync,rmSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {it,expect,afterEach} from 'vitest';
import {FileSessionStore} from '../../../src/ai/runtime/session-store/file-store.js';
import {AgentSessionState} from '../../../src/ai/runtime/session.js';
import {resolveCompoundHostStorage,inspectCompoundHostSources} from '../../../src/runtime/sol-pi/compound-host-storage.js';
const cleanup:Array<()=>void>=[];
afterEach(()=>{for(const close of cleanup.splice(0).reverse())close();});
function root(){const value=mkdtempSync(join(tmpdir(),'compound-host-storage-'));cleanup.push(()=>rmSync(value,{recursive:true,force:true}));return value;}
it('maps CLI and main to one host namespace without making directories during resolution',()=>{
 const configRoot=root();
 const cli=resolveCompoundHostStorage({configRoot});
 const desktop=resolveCompoundHostStorage({configRoot,desktopDataRoot:join(configRoot,'desktop')});
 expect(cli.canonicalRoot).toBe(join(configRoot,'compound-sessions'));
 expect(desktop.canonicalRoot).toBe(cli.canonicalRoot);
 expect(cli.sourceRoots).toEqual([cli.canonicalRoot,join(configRoot,'sessions'),join(configRoot,'desktop','tasks','protected-observation-sessions')]);
 expect(existsSync(cli.canonicalRoot)).toBe(false);
 expect(Object.isFrozen(cli.sourceRoots)).toBe(true);
});
it('includes an actual trusted custom Desktop root in addition to all fixed legacy roots',async()=>{
 const configRoot=root(),desktopDataRoot=root();
 const layout=resolveCompoundHostStorage({configRoot,desktopDataRoot});
 const oldRoot=join(desktopDataRoot,'tasks','protected-observation-sessions');
 const old=new FileSessionStore(oldRoot),session=new AgentSessionState();
 session.restoreSnapshot({...session.exportSnapshot(),sessionId:'custom-desktop-old',cwd:desktopDataRoot});
 await old.save(session.exportSnapshot());
 const report=inspectCompoundHostSources(layout);
 expect(report.snapshots).toHaveLength(1);
 expect(report.snapshots[0].sessionId).toBe('custom-desktop-old');
 expect(layout.sourceRoots).toContain(join(configRoot,'sessions'));
 expect(layout.sourceRoots).toContain(oldRoot);
});
it('rejects a copied layout instead of accepting caller-selected empty roots as host inventory',()=>{
 const layout=resolveCompoundHostStorage({configRoot:root()});
 expect(()=>inspectCompoundHostSources({...layout,sourceRoots:[]})).toThrow(/host_storage/);
});
it('does not overlook a damaged ordinary legacy snapshot when canonical storage is empty',()=>{
 const configRoot=root(),layout=resolveCompoundHostStorage({configRoot});
 const store=new FileSessionStore(join(configRoot,'sessions'));
 // Instantiate the real store to create its normal root; corrupt existing disk
 // facts are preserved and must stop inventory, not be interpreted as no history.
 mkdirSync(join(configRoot,'sessions'),{recursive:true});
 writeFileSync(join(configRoot,'sessions','old.json'),'{');
 expect(()=>inspectCompoundHostSources(layout)).toThrow();
 expect(existsSync(join(configRoot,'sessions','old.json'))).toBe(true);
 void store;
});
