/** Test diagnostics only. These references never authorize or certify work. */
type Kind='kswarm_direct'|'room_project';
const create=Object.create,define=Object.defineProperty,descriptor=Object.getOwnPropertyDescriptor;
const records=create(null) as Record<string,{proof:unknown;previous:unknown}>;
function key(kind:Kind):void{if(kind!=='kswarm_direct'&&kind!=='room_project')throw Error('FIXTURE_CANDIDATE_KIND');}
/** Only the already-destructured local value is passed; never inspect it. */
export function recordOriginalCandidate(kind:Kind,proof:unknown):void{
 key(kind);const previous=descriptor(records,kind)?.value;
 const record=create(null);
 define(record,'proof',{value:proof});define(record,'previous',{value:previous});
 define(records,kind,{value:record,configurable:true});
}
export function readLastOriginalCandidate(kind:Kind):unknown{
 key(kind);const record=descriptor(records,kind)?.value;
 return record===undefined?undefined:descriptor(record,'proof')?.value;
}
