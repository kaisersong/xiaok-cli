import type {DatabaseSync} from 'node:sqlite';
import type {DesktopMultiAgentStore} from '../../electron/desktop-multi-agent-store.js';
import {encodeCapturedSqliteCell,type CapturedSqliteCell} from '../../../src/runtime/verification/source-sqlite-cell.js';
import {readCapturedGroupsRow} from '../../../src/runtime/verification/captured-sqlite-groups-row.js';
import {declareCapturedGroupsRow} from '../../../src/runtime/verification/captured-sqlite-groups-references.js';

/** Test-only read of the real Main writer's stored row. No capture authority. */
export function declaredMainGroupsRows(store:DesktopMultiAgentStore,table:'events'|'operations'){
 const db=(store as unknown as {db:DatabaseSync}).db;
 const query=db.prepare(table==='events'?'SELECT rowid,* FROM events':'SELECT rowid,* FROM operations');query.setReadBigInts(true);
 return query.all().map(raw=>{
  const cells:Record<string,CapturedSqliteCell>={};
  for(const[key,value]of Object.entries(raw))if(key!=='rowid'){
   const kind=value===null?'null':typeof value==='bigint'?'integer':typeof value==='number'?'real':typeof value==='string'?'text':'blob';
   cells[key]=encodeCapturedSqliteCell(kind,kind==='blob'?Buffer.from(value as Uint8Array):value,typeof value==='string'?Buffer.from(value):undefined,'UTF-8');
  }
  const row=readCapturedGroupsRow(table,{rowid:String(raw.rowid),record:cells});
  return{body:row.json.data_json as Record<string,unknown>,...declareCapturedGroupsRow(row)};
 });
}
