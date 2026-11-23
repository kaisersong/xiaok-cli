import {createHash} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {ATTENTION_ITEM_SCHEMA,ASSISTANT_BRIEF_SCHEMA} from '../shared/assistant-inbox-contract.js';
const object=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function currentItem(value:unknown):{value:unknown;changed:boolean} {
  if(!object(value))return {value:ATTENTION_ITEM_SCHEMA.parse(value),changed:false};
  const judgment=value.kimJudgment,scores=object(judgment)?judgment.scores:undefined;
  if(!object(scores)||Object.hasOwn(scores,'scoreVersion'))return {value:ATTENTION_ITEM_SCHEMA.parse(value),changed:false};
  const category=scores.category,categoryLegacy=object(category)&&Object.hasOwn(category,'unknown'),scoreLegacy=Object.hasOwn(scores,'unknown_prob');
  if(!categoryLegacy&&!scoreLegacy)return {value:ATTENTION_ITEM_SCHEMA.parse(value),changed:false};
  for(const legacy of [...(categoryLegacy?[category.unknown]:[]),...(scoreLegacy?[scores.unknown_prob]:[])])if(typeof legacy!=='number'||!Number.isFinite(legacy)||legacy<0||legacy>1)throw Error('assistant_legacy_judgment_invalid');
  const cleaned=structuredClone(value),cleanScores=(cleaned.kimJudgment as Record<string,unknown>).scores as Record<string,unknown>;
  if(categoryLegacy)delete (cleanScores.category as Record<string,unknown>).unknown;
  if(scoreLegacy)delete cleanScores.unknown_prob;
  // Validate the rest before retiring old eight-category scores, never certify them as current.
  ATTENTION_ITEM_SCHEMA.parse(cleaned);delete cleaned.kimJudgment;
  return {value:ATTENTION_ITEM_SCHEMA.parse(cleaned),changed:true};
}
/** Storage compatibility only; current IPC/input contracts remain strict. */
export function migrateLegacyInboxJudgments(db:DatabaseSync):number {
  db.exec('BEGIN IMMEDIATE');
  try {
    const updates:Array<{table:'attention_items'|'attention_briefs';id:string;original:string;next:string}>=[];
    for(const table of ['attention_items','attention_briefs'] as const)for(const row of db.prepare(`SELECT id,data FROM ${table}`).all()) {
      const original=String(row.data),raw:unknown=JSON.parse(original);let result:{value:unknown;changed:boolean};
      if(table==='attention_items')result=currentItem(raw);
      else {
        if(!object(raw))throw Error('assistant_legacy_brief_invalid');
        const next=structuredClone(raw);let changed=false;
        for(const key of ['needsYou','canWait','calendar']) {
          if(!Array.isArray(next[key]))throw Error('assistant_legacy_brief_invalid');
          next[key]=next[key].map(item=>{const decoded=currentItem(item);changed ||= decoded.changed;return decoded.value;});
        }
        result={value:ASSISTANT_BRIEF_SCHEMA.parse(next),changed};
      }
      if(result.changed)updates.push({table,id:String(row.id),original,next:JSON.stringify(result.value)});
    }
    if(updates.length) {
      db.exec('CREATE TABLE IF NOT EXISTS assistant_inbox_legacy_payloads(source_table TEXT NOT NULL,source_id TEXT NOT NULL,digest TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(source_table,source_id,digest))');
      const archive=db.prepare('INSERT INTO assistant_inbox_legacy_payloads(source_table,source_id,digest,data) VALUES(?,?,?,?)');
      for(const row of updates) {
        archive.run(row.table,row.id,createHash('sha256').update(row.original).digest('hex'),row.original);
        const receipt=db.prepare(`UPDATE ${row.table} SET data=? WHERE id=? AND data=?`).run(row.next,row.id,row.original);
        if(receipt.changes!==1)throw Error('assistant_legacy_row_changed');
      }
    }
    db.exec('COMMIT');return updates.length;
  } catch(error) {
    try {db.exec('ROLLBACK');}catch(cleanup){throw new AggregateError([error,cleanup],'assistant_legacy_rollback_failed',{cause:error});}
    throw error;
  }
}
