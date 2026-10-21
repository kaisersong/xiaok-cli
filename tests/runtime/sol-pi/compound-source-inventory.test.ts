import {mkdtempSync,rmSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {it,expect,afterEach} from 'vitest';
import {FileSessionStore} from '../../../src/ai/runtime/session-store/file-store.js';
import {AgentSessionState} from '../../../src/ai/runtime/session.js';
import {inspectCompoundSourceInventory} from '../../../src/runtime/sol-pi/compound-source-inventory.js';
const cleanup:Array<()=>void>=[];afterEach(()=>{for(const close of cleanup.splice(0).reverse())close();});
function fixture(){const root=mkdtempSync(join(tmpdir(),'compound-inventory-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));return root;}
it('reads actual persisted ordinary sessions without treating metadata inspection as a drain receipt',async()=>{
 const root=fixture(),store=new FileSessionStore(root),session=new AgentSessionState();session.restoreSnapshot({...session.exportSnapshot(),sessionId:'existing-ordinary',cwd:root});await store.save(session.exportSnapshot());
 const report=inspectCompoundSourceInventory([root]);expect(report.snapshots).toHaveLength(1);expect(report.snapshots[0]).toMatchObject({sessionId:'existing-ordinary',executionProtected:false});expect(report.bytesRead).toBeGreaterThan(0);
});
it('never overlooks a damaged snapshot or old deletion and migration namespace',()=>{
 const root=fixture();writeFileSync(join(root,'old.json'),'{broken');expect(()=>inspectCompoundSourceInventory([root])).toThrow();
 rmSync(join(root,'old.json'));mkdirSync(join(root,'.deletions'));mkdirSync(join(root,'.migrations'));
 const report=inspectCompoundSourceInventory([root]);expect(report.unclassifiedEntries).toHaveLength(2);expect(existsSync(join(root,'.deletions'))).toBe(true);
});
it('bounds root cardinality before opening source files and does not silently deduplicate overflow',()=>{
 const root=fixture();expect(()=>inspectCompoundSourceInventory(Array(17).fill(root))).toThrow(/limit/);
});
it('inventory includes source identity changes after inspection',()=>{
 const root=fixture(),report=inspectCompoundSourceInventory([root]);writeFileSync(join(root,'late.json'),'{}');expect(()=>report.assertUnchanged()).toThrow();
});

it('finds a real never-settled P2 journal in a second registered store root',async()=>{
 const root=fixture(),other=fixture(),store=new FileSessionStore(other),session=new AgentSessionState();
 session.restoreSnapshot({...session.exportSnapshot(),sessionId:'old-unresolved',cwd:other});await store.save(session.exportSnapshot());
 const {createSessionExecutionAuthority,createSessionExecutionContext}=await import('../../../src/ai/runtime/session-store/execution-authority.js');
 const {createCompoundSessionJournal}=await import('../../../src/runtime/sol-pi/compound-session-journal.js');
 const authority=createSessionExecutionAuthority({root:other,sessionIdentity:'old-unresolved',hostContext:createSessionExecutionContext({requestSource:'user',ownerId:'host',scopeId:'source-inventory'})});
 const lease=await authority.acquire({invocationId:'old-preparation',kind:'direct-mutation'});
 try{const journal=createCompoundSessionJournal({root:other,store,sessionIdentity:'old-unresolved',ownerId:'host',scopeId:'source-inventory',requestSource:'agent',assertCurrent(){}});
  await journal.createOrGetDirect({hostProviderInvocationId:'old-provider',originalToolUseId:'old-call',toolName:'write',inputHash:'a'.repeat(64),permissionGeneration:1},lease);
 }finally{await lease.releaseAfterDrain();authority.dispose();}
 const report=inspectCompoundSourceInventory([root,other]);
 expect(report.snapshots).toHaveLength(1);expect(report.snapshots[0]).toMatchObject({sessionId:'old-unresolved',executionProtected:true,hasCompoundLedger:true});
 expect(report.unclassifiedEntries.some(path=>path.endsWith('.session-execution'))).toBe(true);
});
