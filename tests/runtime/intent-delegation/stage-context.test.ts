import {it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FileSessionStore} from '../../../src/ai/runtime/session-store/file-store.js';
import {SQLiteSessionStore} from '../../../src/ai/runtime/session-store/sqlite-store.js';
import {captureIntentStageContext,assertIntentStagePrefix} from '../../../src/runtime/intent-delegation/stage-context.js';
it.each(['file','sqlite'] as const)('original durable %s full prefix detects same-count replacement/truncation and preserves suffix',async kind=>{
 const root=mkdtempSync(join(tmpdir(),'intent-stage-context-')),store=kind==='file'?new FileSessionStore(root):new SQLiteSessionStore(join(root,'sessions.db'));
 try{
 await store.save({sessionId:'original',cwd:root,createdAt:1,updatedAt:1,lineage:['original'],messages:[{role:'user',content:[{type:'text',text:'whole original archive'}]}],usage:{inputTokens:0,outputTokens:0},compactions:[],memoryRefs:[],approvalRefs:[],backgroundJobRefs:[]});
 const original=store.loadSync('original')!,context=captureIntentStageContext(original,'stage-two');
 const replaced=structuredClone(original);replaced.messages[0].content=[{type:'text',text:'other original archive'}];expect(()=>assertIntentStagePrefix(replaced,context)).toThrow('intent_stage_context_prefix');
 expect(()=>assertIntentStagePrefix({...original,messages:[]},context)).toThrow('intent_stage_context_prefix');
 const suffix={...original,messages:[...original.messages,{role:'user' as const,content:[{type:'text' as const,text:'actual next input'}]}]};expect(assertIntentStagePrefix(suffix,context)).toEqual(suffix.messages);expect(store.loadSync('original')!.messages).toEqual(original.messages);
 let calls=0;const getter=structuredClone(original);Object.defineProperty(getter.messages[0].content[0],'text',{get(){calls++;return 'forged';},enumerable:true});expect(()=>captureIntentStageContext(getter,'stage-two')).toThrow();expect(calls).toBe(0);
 }finally{if(store instanceof SQLiteSessionStore)store.dispose();rmSync(root,{recursive:true,force:true});}
});
