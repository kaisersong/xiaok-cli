import type {DatabaseSync} from 'node:sqlite';
import type {WorkProjection,WorkWatch} from './types.js';
import {createOrdinaryAttentionFacts,type OrdinaryStateWitness} from './ordinary-attention-facts.js';

/** Fixed SQL primitives on the original store handle, inside its transaction. */
export function saveActivityProjectionLocked(db:DatabaseSync,watch:WorkWatch,next:WorkProjection,witness?:OrdinaryStateWitness|false):void {
 const previous=db.prepare('SELECT data_json FROM work_projections WHERE watch_id=?').get(watch.watchId) as {data_json:string}|undefined;
 createOrdinaryAttentionFacts(db).advance(watch,previous?.data_json??null,next,witness);
 db.prepare('INSERT INTO work_projections VALUES(?,?) ON CONFLICT(watch_id) DO UPDATE SET data_json=excluded.data_json').run(watch.watchId,JSON.stringify(next));
}
export function refreshActivityCardLocked(db:DatabaseSync,watch:WorkWatch,projection:WorkProjection):void {
 const id=`created:${watch.watchId}`,row=db.prepare('SELECT data_json FROM conversation_activities WHERE activity_id=?').get(id) as {data_json:string}|undefined;
 if(!row)return;
 db.prepare('UPDATE conversation_activities SET data_json=? WHERE activity_id=?').run(JSON.stringify({...JSON.parse(row.data_json),projection}),id);
}
