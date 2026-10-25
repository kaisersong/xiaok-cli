/** Test-only materialization for existing small semantic fixtures. Production
 * consumers use the declaration stream and must not accumulate this shape. */
import {iterateCapturedSQLiteLoopSources} from '../../src/runtime/verification/captured-sqlite-loop-stream.js';
import {decodeCapturedLoopRow} from '../../src/runtime/verification/captured-sqlite-loop-values.js';
import {freezeCapturedData} from '../../src/runtime/verification/captured-source-json.js';
import type {CapturedLoopReference} from '../../src/runtime/verification/captured-sqlite-loop-row-semantics.js';
import type {CapturedLoopEmbeddedTask} from '../../src/runtime/verification/captured-sqlite-loop-results.js';
export {iterateCapturedSQLiteLoopSources};
type Row=Readonly<Record<string,unknown>>;
interface Source {sourceId:string;snapshotHash:string;tables:Record<string,Row[]>;json:Record<string,Row[]>;references:CapturedLoopReference[];embeddedTasks:CapturedLoopEmbeddedTask[]}
export function readCapturedSQLiteLoopSources(owner:object,token:object){
 const sources:Source[]=[];let current:Source|undefined,completed=false;
 for(const event of iterateCapturedSQLiteLoopSources(owner,token)){
  if(event.kind==='source-start'){current={sourceId:event.sourceId,snapshotHash:event.snapshotHash,tables:{},json:{},references:[],embeddedTasks:[]};sources.push(current);}
  else if(event.kind==='table-start'){current!.tables[event.table]=[];current!.json[event.table]=[];}
  else if(event.kind==='row'){current!.tables[event.table].push(decodeCapturedLoopRow(event.table,event.cells));current!.json[event.table].push(event.parsed);current!.references.push(...event.references);current!.embeddedTasks.push(...event.embeddedTasks);}
  else if(event.kind==='complete')completed=true;
 }
 if(!completed)throw Error('test_collector_incomplete');return freezeCapturedData({kind:'captured-loop-sqlite-declarations' as const,sources});
}
