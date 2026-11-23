import {it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSessionExecutionAuthority,createSessionExecutionContext} from '../../../src/ai/runtime/session-store/execution-authority.js';
import {openPrivateVerificationDatabase} from '../../../src/runtime/verification/private-database.js';
// Selected only by the Windows matrix step. Native Windows owner tests qualify
// their separate supported route; this route has always required directory fsync.
it.runIf(process.platform==='win32')('does not issue an execution lease when Windows directory durability is unsupported',async()=>{
 expect(process.platform).toBe('win32');const root=mkdtempSync(join(tmpdir(),'windows-execution-refusal-'));
 const authority=createSessionExecutionAuthority({root,sessionIdentity:'refusal',hostContext:createSessionExecutionContext({requestSource:'user',ownerId:'host',scopeId:'scope'})});
 try{await expect(authority.acquire({invocationId:'first',kind:'compound'})).rejects.toThrow('directory sync durability unsupported on Windows');await expect(authority.acquire({invocationId:'again',kind:'compound'})).rejects.toThrow('directory sync durability unsupported on Windows');}finally{authority.dispose();rmSync(root,{recursive:true,force:true});}
});
it.runIf(process.platform==='win32')('does not mint private native registration access without directory durability',()=>{
 expect(process.platform).toBe('win32');const root=mkdtempSync(join(tmpdir(),'windows-census-refusal-'));
 try{expect(()=>openPrivateVerificationDatabase(root)).toThrow('directory sync durability unsupported on Windows');}finally{rmSync(root,{recursive:true,force:true});}
});
