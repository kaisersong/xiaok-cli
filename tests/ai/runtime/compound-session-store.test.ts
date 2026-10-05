import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,expect,it} from 'vitest';
import {FileSessionStore} from '../../../src/ai/runtime/session-store/file-store.js';
import {SQLiteSessionStore} from '../../../src/ai/runtime/session-store/sqlite-store.js';
import {createSessionExecutionAuthority,createSessionExecutionContext} from '../../../src/ai/runtime/session-store/execution-authority.js';
import {createCompoundOperationLedger,createOrGetCompoundOperation} from '../../../src/runtime/sol-pi/compound-operation.js';
import {createOrGetDirectOperation,advanceDirectOperation} from '../../../src/runtime/sol-pi/compound-direct-operation.js';
const cleanup:Array<()=>void>=[];afterEach(()=>{for(const f of cleanup.splice(0).reverse())f();});
for(const kind of ['file','sqlite'] as const)it(`${kind}: compound journal only changes under live CAS and ordinary save preserves durable reservations`,async()=>{
 const root=mkdtempSync(join(tmpdir(),'compound-store-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));
 const store=kind==='file'?new FileSessionStore(root):new SQLiteSessionStore(join(root,'sessions.sqlite'));if(store instanceof SQLiteSessionStore)cleanup.push(()=>store.dispose());
 const sessionId='sess_compound';await store.save({sessionId,cwd:root,createdAt:1,updatedAt:1,lineage:[],messages:[],usage:{inputTokens:0,outputTokens:0},compactions:[],memoryRefs:[],approvalRefs:[],backgroundJobRefs:[]});
 const initial=(await store.load(sessionId))!;
 await expect(store.save({...initial,executionProtected:true})).rejects.toThrow('session_execution_marker_requires_cas');
 let ledger=createOrGetCompoundOperation(createCompoundOperationLedger(),{dispatch:{sessionIdentity:sessionId,hostProviderInvocationId:'provider:1',originalToolUseId:'tool1'},inputHash:'a'.repeat(64),toolName:'write',ownerId:'host',requestSource:'agent',scopeId:'scope',permissionGeneration:1}).ledger;
 const direct=createOrGetDirectOperation(ledger,{dispatch:{sessionIdentity:sessionId,hostProviderInvocationId:'provider:1',originalToolUseId:'bash1'},inputHash:'c'.repeat(64),toolName:'bash',ownerId:'host',requestSource:'agent',scopeId:'scope',permissionGeneration:1});
 ledger=advanceDirectOperation(direct.ledger,direct.operation.id,{stage:'started',finalInputHash:'d'.repeat(64)});
 await expect(store.save({...initial,compoundOperations:ledger} as any)).rejects.toThrow('compound_operation_requires_cas');
 const authority=createSessionExecutionAuthority({root,sessionIdentity:sessionId,hostContext:createSessionExecutionContext({requestSource:'user',ownerId:'host',scopeId:'scope'})});cleanup.push(()=>authority.dispose());
 const lease=await authority.acquire({invocationId:'create',kind:'compound'});
 try{await store.compareAndSave({expectedStoreRevision:initial.storeRevision!,expectedHistoryDigest:initial.historyDigest!,nextSnapshot:{...initial,compoundOperations:ledger} as any,lease});}finally{await lease.releaseAfterDrain();}
 const committed=(await store.load(sessionId))!;expect(committed.compoundOperations?.directOperations?.[0].stage).toBe('started');expect((committed as any).compoundOperations).toEqual(ledger);
 await store.save({...committed,compoundOperations:undefined} as any);const preserved=(await store.load(sessionId))!;expect((preserved as any).compoundOperations).toEqual(ledger);
 const next=await authority.acquire({invocationId:'stale',kind:'compound'});
 try{await expect(store.compareAndSave({expectedStoreRevision:preserved.storeRevision!,expectedHistoryDigest:preserved.historyDigest!,nextSnapshot:{...preserved,compoundOperations:createCompoundOperationLedger()} as any,lease:next})).rejects.toThrow();}finally{await next.releaseAfterDrain();}
});
