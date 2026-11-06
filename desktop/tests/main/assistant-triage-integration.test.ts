import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDesktopAssistantInbox} from '../../electron/desktop-assistant-inbox.js';
const h=vi.hoisted(()=>({rows:Array.from({length:54},(_,i)=>({source:'yzj_message' as const,accountKey:'qa',sourceId:String(i),title:'Synthetic notice',summary:'Read-only test',reason:'',nextStep:'',priority:'later' as const,observedAt:100}))}));
vi.mock('../../electron/assistant-yzj-cli.js',()=>({AssistantYzjClient:class{async read(){return{records:h.rows,coverage:[{key:'yzj_message:qa',source:'yzj_message',state:'ok',checkedAt:100}]};}async identity(){return'qa';}}}));
const roots:string[]=[];afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
it('routes the real Desktop factory through bounded triage and preserves all real observations',async()=>{
 const root=mkdtempSync(join(tmpdir(),'xiaok-triage-test-'));roots.push(root);
 const complete=vi.fn(async input=>{const rows=JSON.parse(input.userMessage);if(rows.length>8)throw Error('loop_llm_timeout');return{text:JSON.stringify(rows.map((r:{key:string})=>({sourceKey:r.key,priority:'later',reason:'No decision needed',nextStep:'Review later'})))};});
 const owner=createDesktopAssistantInbox({dataRoot:root,crypto:{isEncryptionAvailable:()=>true,encryptString:()=>{throw Error('not_used');},decryptString:()=>{throw Error('not_used');}},mail:{list:()=>[]} as unknown as Parameters<typeof createDesktopAssistantInbox>[0]['mail'],llm:{complete},profile:()=>({active:true,timeZone:'UTC'}),search:async()=>'无搜索结果',launch:async()=>{throw Error('not_used');},canLaunch:()=>{},changed:()=>{},internal:async()=>[],facts:()=>[],reminders:{create:()=>{throw Error('not_used');},cancel:()=>{}}});
 try{const state=await owner.service.refresh('user');expect(state.items).toHaveLength(54);expect(state.coverage.find(c=>c.source==='yzj_message')).toMatchObject({state:'ok'});expect(complete.mock.calls.length).toBeGreaterThan(1);}finally{owner.dispose();await owner.drain();owner.close();}
});
