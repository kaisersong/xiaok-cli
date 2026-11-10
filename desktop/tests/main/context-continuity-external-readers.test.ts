// @vitest-environment node
import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ContinuityService } from '../../electron/context-continuity/service.js';
import { digest } from '../../electron/context-continuity/store.js';
const actor={requestSource:'user' as const,profileId:'p',actorId:'desktop-user:p'};
let root:string,service:ContinuityService;
beforeEach(()=>{root=mkdtempSync(join(tmpdir(),'external-reader-'));service=new ContinuityService({dbPath:join(root,'store.sqlite'),profileId:'p'});});
afterEach(()=>{service.close();rmSync(root,{recursive:true,force:true});});
function fixture(text='source',state:'settled'|'unknown'='settled'){
 const hash=digest(text);const source=service.createConversation(actor,{operationId:`source-${hash}`}),target=service.createConversation(actor,{operationId:`target-${hash}`});
 service.recordMessage(actor,{conversationId:source.id,sourceKind:'desktop_task',sourceId:`task_${text.length}_${source.id}`,sourceDataEpoch:'epoch',sourceMessageId:'message',sourceRevision:1,role:'assistant',text,executionState:state});
 const c=service.getConversation(actor,source.id)!;const ref=service.createReference(actor,{conversationId:c.id,operationId:`ref-${hash}`,expectedRevision:c.revision});
 const {grantId}=service.attachReference(actor,{refId:ref.refId,targetConversationId:target.id,operationId:`grant-${hash}`});
 return {source,target,ref,grantId};
}
it('issues an independent scoped principal, stores only a secret hash, and rejects cross-reader cursors',()=>{
 const {target,ref}=fixture('"\\\n'.repeat(30000));
 const input={operationId:'issue',targetConversationId:target.id,refIds:[ref.refId]};
 const one=service.issueExternalReader(actor,input),two=service.issueExternalReader(actor,{...input,operationId:'issue2'});
 expect(one.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);expect(service.store.db.prepare('SELECT count(*) AS n FROM task_bindings').get()?.n).toBe(0);
 const principal=service.authenticateExternalReader(one.secret);const page=service.resolveExternalReference(principal,{refId:ref.refId});expect(page.messages.length).toBe(1);expect(page.nextCursor).toBeTruthy();
 expect(()=>service.resolveExternalReference(service.authenticateExternalReader(two.secret),{refId:ref.refId,cursor:page.nextCursor})).toThrow('invalid_cursor');
 expect(()=>service.issueExternalReader(actor,input)).toThrow('secret_already_issued');
 expect(()=>service.authenticateExternalReader('A'.repeat(43))).toThrow('not_readable');
 for(const suffix of ['', '-wal']){try{expect(readFileSync(join(root,`store.sqlite${suffix}`)).includes(Buffer.from(one.secret))).toBe(false);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
});
it('requires grants and an immutable allowlist; no user/task/target fields can widen it',()=>{
 const a=fixture('a'),b=fixture('b');
 expect(()=>service.issueExternalReader(actor,{operationId:'bad',targetConversationId:b.target.id,refIds:[a.ref.refId]})).toThrow('not_readable');
 const issued=service.issueExternalReader(actor,{operationId:'issue',targetConversationId:a.target.id,refIds:[a.ref.refId]});const principal=service.authenticateExternalReader(issued.secret);
 expect(()=>service.resolveExternalReference(principal,{refId:b.ref.refId})).toThrow('not_readable');
 expect(()=>service.resolveExternalReference({...principal,targetConversationId:b.target.id},{refId:a.ref.refId})).toThrow('not_readable');
 expect(()=>service.createConversation(principal as any,{operationId:'fake-user'})).toThrow();
 expect(()=>service.issueExternalReader({...actor,requestSource:'agent'},{operationId:'fake',targetConversationId:a.target.id,refIds:[a.ref.refId]})).toThrow();
});
it('persists revocation across restart and never launders a consumed dependency by regranting',()=>{
 const {target,ref,grantId}=fixture();const issued=service.issueExternalReader(actor,{operationId:'issue',targetConversationId:target.id,refIds:[ref.refId]});
 service.resolveExternalReference(service.authenticateExternalReader(issued.secret),{refId:ref.refId});service.revokeGrant(actor,{grantId});
 expect(service.listExternalReaders(actor)[0].revoked).toBe(true);
 service.attachReference(actor,{refId:ref.refId,targetConversationId:target.id,operationId:'newgrant'});
 service.close();service=new ContinuityService({dbPath:join(root,'store.sqlite'),profileId:'p'});
 expect(()=>service.authenticateExternalReader(issued.secret)).toThrow('not_readable');
 const fresh=service.issueExternalReader(actor,{operationId:'fresh',targetConversationId:target.id,refIds:[ref.refId]});
 expect(service.resolveExternalReference(service.authenticateExternalReader(fresh.secret),{refId:ref.refId}).messages[0].text).toBe('source');
 service.tombstoneConversation(actor,target.id);expect(()=>service.authenticateExternalReader(fresh.secret)).toThrow('not_readable');
});
it('does not disclose unknown execution or deleted source bodies and fails closed when dependency persistence fails',()=>{
 const a=fixture('unknown','unknown');const issued=service.issueExternalReader(actor,{operationId:'issue',targetConversationId:a.target.id,refIds:[a.ref.refId]});
 expect(()=>service.resolveExternalReference(service.authenticateExternalReader(issued.secret),{refId:a.ref.refId})).toThrow('not_readable');
 const b=fixture('known');const token=service.issueExternalReader(actor,{operationId:'known',targetConversationId:b.target.id,refIds:[b.ref.refId]});const principal=service.authenticateExternalReader(token.secret);
 service.store.db.exec("CREATE TRIGGER fail_dep BEFORE INSERT ON external_reader_dependencies BEGIN SELECT RAISE(ABORT,'storage_failed'); END;");
 expect(()=>service.resolveExternalReference(principal,{refId:b.ref.refId})).toThrow('storage_failed');
 service.store.db.exec('DROP TRIGGER fail_dep');service.tombstoneConversation(actor,b.source.id);
 expect(()=>service.resolveExternalReference(principal,{refId:b.ref.refId})).toThrow('not_readable');
});
