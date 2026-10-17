import {afterEach,expect,it} from 'vitest';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {FileSessionStore} from '../../../src/ai/runtime/session-store/file-store.js';
import {createEmptySessionIntentLedger} from '../../../src/runtime/intent-delegation/store.js';
import {readNativeSessionIdentity} from '../../../src/ai/runtime/session-store/identity.js';
const roots:string[]=[];afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
it('actual protected FileSessionStore serialization puts original identity and ownership before large message bodies',async()=>{
 const root=mkdtempSync(join(tmpdir(),'session-identity-prefix-'));roots.push(root);const sessionId='sess_activity_header',store=new FileSessionStore(root);
 const intentDelegation=createEmptySessionIntentLedger(sessionId,1);
 await store.save({messages:[{role:'user',content:[{type:'text',text:'local reference '.repeat(10000)}]}],sessionId,cwd:root,createdAt:1,updatedAt:1,lineage:[sessionId],usage:{inputTokens:0,outputTokens:0},compactions:[],memoryRefs:[],approvalRefs:[],backgroundJobRefs:[],intentDelegation});
 const file=join(root,sessionId+'.json'),identity=readNativeSessionIdentity(file);
 expect(identity).toMatchObject({schemaVersion:1,sessionId,cwd:root,ownership:{state:'released'}});
 const loaded=await store.load(sessionId);expect(loaded?.messages[0].content[0]).toMatchObject({type:'text',text:'local reference '.repeat(10000)});expect(loaded?.intentDelegation).toEqual(intentDelegation);
 expect(readFileSync(file).length).toBeGreaterThan(65536);
});
