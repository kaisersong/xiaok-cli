import {test,expect} from 'vitest';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {LoopStore} from '../../electron/loop-store.js';
const expected=['assistant_analysis_selection','assistant_analysis_clock','assistant_analysis_runs','assistant_analysis_attempts','assistant_quality_context','assistant_quality_state','assistant_quality_assessments','assistant_source_runs','assistant_action_proposals','assistant_launch_drafts','assistant_launch_operations','assistant_active_work_claims','assistant_launch_draft_links','assistant_launch_confirmation_history','assistant_launch_events','assistant_periodic_policy','assistant_digest_clock','assistant_digest_deliveries','assistant_notification_revision_ledger'];
test('genuine LoopStore creates the complete fixed assistant product tables and indexes without replacing earlier tables',()=>{
 const root=mkdtempSync(join(tmpdir(),'xiaok-assistant-product-schema-'));const file=join(root,'loop-evidence.sqlite');const store=new LoopStore(file);let reader:DatabaseSync|undefined;
 try{reader=new DatabaseSync(file,{readOnly:true});const schema=reader.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_stat%' ORDER BY type,name").all();
 const tables=schema.filter(r=>r.type==='table').map(r=>String(r.name));for(const name of expected)expect(tables).toContain(name);
 expect(tables).toContain('loop_publication_attempts');expect(tables).toContain('assistant_derived_lineage');
 const selected=schema.filter(r=>expected.includes(String(r.tbl_name))).map(r=>({...r,sql:typeof r.sql==='string'?r.sql.replace(/\s+/g,' ').trim():r.sql}));
 const columns=Object.fromEntries(expected.map(name=>[name,reader!.prepare('PRAGMA table_info('+name+')').all().map(r=>({name:r.name,type:r.type,notnull:r.notnull===1}))]));
 if(process.env.XIAOK_ASSISTANT_CENSUS_OUT)writeFileSync(process.env.XIAOK_ASSISTANT_CENSUS_OUT,JSON.stringify({schema:selected,columns},null,2)+'\n',{flag:'wx',mode:0o600});
 expect(new Set(selected.filter(r=>r.type==='table').map(r=>r.name)).size).toBe(19);
 }finally{const failures:unknown[]=[];try{reader?.close();}catch(raw){failures.push(raw);}try{store.close();}catch(raw){failures.push(raw);}if(failures.length)throw new AggregateError(failures,'assistant_schema_close',{cause:failures[0]});rmSync(root,{recursive:true});}
});
