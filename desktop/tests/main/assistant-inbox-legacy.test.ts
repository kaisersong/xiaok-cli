import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {describe,it,expect} from 'vitest';
import {AssistantInboxStore} from '../../electron/assistant-inbox-store.js';
import {ATTENTION_ITEM_SCHEMA} from '../../shared/assistant-inbox-contract.js';
const judgment={model:'Songkai/K-IM-Deiction',evaluatedAt:100,scores:{category:{'求助/提问':0.2,'任务/待办':0.2,'决策/结论':0.1,'信息分享':0.1,'讨论观点':0.1,'闲聊寒暄':0.1,'无关/其他':0.1,unknown:0.1},category_top:'求助/提问',sentiment:{'积极':0.2,'中性':0.6,'消极':0.2},sentiment_top:'中性',importance:{dist:[0,0,1,0,0],expected:3},urgency:{dist:[0,0,1,0,0],expected:3},intensity:{dist:[0,0,1,0,0],expected:3},needs_attention:0.8,has_todo:0.6,unknown_prob:0.1}};
const raw={source:'mail' as const,accountKey:'a',sourceId:'m',title:'Review',summary:'Review',reason:'Request',nextStep:'Review',priority:'now' as const,observedAt:100};
function fixture(run:(file:string,item:any,original:string,brief:string)=>void){const root=mkdtempSync(join(tmpdir(),'inbox-legacy-'));const file=join(root,'inbox.sqlite');try{const s=new AssistantInboxStore(file);s.ingest([raw],[],'scheduler');const item={...s.allItems()[0],kimJudgment:structuredClone(judgment)};s.ensureBrief('Asia/Shanghai','2026-11-06',100,'user');const original=JSON.stringify(item);const brief=JSON.parse(String(s.db.prepare('SELECT data FROM attention_briefs').get()!.data));brief.needsYou=[item];const briefText=JSON.stringify(brief);s.db.prepare('UPDATE attention_items SET data=?').run(original);s.db.prepare('UPDATE attention_briefs SET data=?').run(briefText);s.close();run(file,item,original,briefText);}finally{rmSync(root,{recursive:true,force:true});}}
describe('persisted legacy Kim judgments',()=>{
 it('restores items and embedded briefs, preserving exact originals and business state',()=>fixture((file,item,original,brief)=>{const s=new AssistantInboxStore(file);try{expect(s.allItems()).toEqual([{...item,kimJudgment:undefined}]);expect(s.get(item.id)?.revision).toBe(item.revision);expect(s.snapshot(100).briefs[0].needsYou[0].kimJudgment).toBeUndefined();expect(s.ensureBrief('Asia/Shanghai','2026-11-06',100,'user').needsYou[0].id).toBe(item.id);expect(s.db.prepare('SELECT data FROM assistant_inbox_legacy_payloads').all().map(x=>x.data).sort()).toEqual([original,brief].sort());}finally{s.close();}const reopened=new AssistantInboxStore(file);try{expect(reopened.db.prepare('SELECT count(*) AS n FROM assistant_inbox_legacy_payloads').get()?.n).toBe(2);expect(reopened.allItems()[0].id).toBe(item.id);}finally{reopened.close();}}));
 it('keeps live input validation strict',()=>{expect(()=>ATTENTION_ITEM_SCHEMA.parse({...raw,id:'a'.repeat(64),revision:1,status:'suggested',updatedAt:100,kimJudgment:judgment})).toThrow();});
 for(const invalid of ['other_field','invalid_probability','invalid_business'])it(`rejects ${invalid} without partial migration`,()=>fixture((file,item,_original,brief)=>{const d=new DatabaseSync(file);const changed=structuredClone(item);if(invalid==='other_field')changed.kimJudgment.scores.other_field=1;if(invalid==='invalid_probability')changed.kimJudgment.scores.unknown_prob=2;if(invalid==='invalid_business')changed.revision=0;d.prepare('UPDATE attention_items SET data=?').run(JSON.stringify(changed));d.close();expect(()=>new AssistantInboxStore(file)).toThrow();const after=new DatabaseSync(file);try{expect(after.prepare('SELECT data FROM attention_briefs').get()?.data).toBe(brief);expect(after.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='assistant_inbox_legacy_payloads'").get()?.n).toBe(0);}finally{after.close();}}));
});
it('rolls back archive creation and earlier updates when a later write fails',()=>fixture((file,_item,original,brief)=>{const d=new DatabaseSync(file);d.exec("CREATE TRIGGER reject_brief_migration BEFORE UPDATE ON attention_briefs BEGIN SELECT RAISE(ABORT,'fixture_write_failure'); END");d.close();expect(()=>new AssistantInboxStore(file)).toThrow('fixture_write_failure');const after=new DatabaseSync(file);try{expect(after.prepare('SELECT data FROM attention_items').get()?.data).toBe(original);expect(after.prepare('SELECT data FROM attention_briefs').get()?.data).toBe(brief);expect(after.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='assistant_inbox_legacy_payloads'").get()?.n).toBe(0);}finally{after.close();}}));
for(const only of ['category','scores'])it(`accepts a single zero-valued legacy field in ${only}`,()=>fixture((file,item)=>{const d=new DatabaseSync(file);const old=structuredClone(item);if(only==='category'){delete old.kimJudgment.scores.unknown_prob;old.kimJudgment.scores.category.unknown=0;}else{delete old.kimJudgment.scores.category.unknown;old.kimJudgment.scores.unknown_prob=0;}d.prepare('UPDATE attention_items SET data=?').run(JSON.stringify(old));d.close();const s=new AssistantInboxStore(file);try{expect(s.get(item.id)?.kimJudgment).toBeUndefined();}finally{s.close();}}));
it('lets actual startup recovery mark an interrupted legacy attempt unknown',async()=>{const {AssistantInboxService}=await import('../../electron/assistant-inbox-service.js');fixture((file,item)=>{const d=new DatabaseSync(file);d.prepare('UPDATE attention_items SET data=?').run(JSON.stringify({...item,status:'working',attemptId:'10000000-1111-4111-8111-111111111111'}));d.close();const store=new AssistantInboxStore(file);const service=new AssistantInboxService({store,read:async()=>({records:[],coverage:[]}),triage:async()=>[],profile:()=>({active:true,timeZone:'Asia/Shanghai'}),launch:async()=>{throw Error('unexpected_launch');},outbox:{list:()=>[]}});try{expect(()=>service.recover([],'scheduler')).not.toThrow();expect(store.get(item.id)?.status).toBe('unknown');expect(store.db.prepare('SELECT count(*) n FROM assistant_inbox_legacy_payloads').get()?.n).toBe(2);}finally{service.dispose();store.close();}});});

it('keeps validated v4 judgments in items and briefs across reopen',()=>fixture((file,item)=>{
 const current={...item,kimJudgment:{...item.kimJudgment,scores:{...item.kimJudgment.scores,scoreVersion:4}}};
 const db=new DatabaseSync(file);
 const brief=JSON.parse(String(db.prepare('SELECT data FROM attention_briefs').get()!.data));
 brief.needsYou=[current];
 db.prepare('UPDATE attention_items SET data=?').run(JSON.stringify(current));
 db.prepare('UPDATE attention_briefs SET data=?').run(JSON.stringify(brief));
 db.close();
 const store=new AssistantInboxStore(file);
 try {
  expect(store.get(item.id)?.kimJudgment).toEqual(current.kimJudgment);
  expect(store.snapshot(100).briefs[0].needsYou[0].kimJudgment).toEqual(current.kimJudgment);
  expect(store.db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='assistant_inbox_legacy_payloads'").get()?.n).toBe(0);
 } finally {store.close();}
}));
it('rejects an uncalibrated current v4 judgment instead of treating it as legacy',()=>{
 const scores={...judgment.scores,scoreVersion:4,unknown_prob:0.9};
 expect(()=>ATTENTION_ITEM_SCHEMA.parse({...raw,id:'a'.repeat(64),revision:1,status:'suggested',updatedAt:100,
  kimJudgment:{...judgment,scores}})).toThrow();
});
