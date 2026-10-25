import {it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createKbStoreSqlite} from '../../electron/kb-store-sqlite.js';
it.each(['  原始正文\n\n第二段  \n','a '.repeat(2000),'第一段\n\n'.repeat(300),'🙂\t中文字\n'.repeat(500)])('stores actual complete whitespace/unicode body through existing chunker: %#',text=>{
 const dir=mkdtempSync(join(tmpdir(),'assistant-kb-independent-')),store=createKbStoreSqlite(join(dir,'kb.db'));try{const collectionId=store.createCollection({name:'original',embeddingModelId:'m',embeddingDim:384}, 'user').id;
 const source=store.ensureAssistantSource!({sourceId:'assistant-source:original',clientRequestKey:'assistant-candidate:original',collectionId,kind:'paste',title:'Original',text,parseStatus:'pending',metadata:{assistantCandidateId:'original',assistantRunId:'run',assistantEvidenceRefs:[{kind:'task',id:'actual'}]}},'user');expect(store.listChunks(source.id).map(c=>c.text).join('')).toBe(text);expect(source.byteSize).toBe(Buffer.byteLength(text));}finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
