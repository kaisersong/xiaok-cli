import {freezeCapturedData} from './captured-source-json.js';
import {BROKER_COMMON_SCHEMA} from './broker-room-common-schema-data.js';
import {BROKER_COMMON_COLUMNS} from './broker-room-common-columns-data.js';
import {BROKER_ADMISSION_SCHEMA,BROKER_ADMISSION_COLUMNS} from './broker-room-admission-schema-data.js';
export const BROKER_ROOM_TABLES=freezeCapturedData(['context_syncs','events','inbox_entries','intent_receipts','participant_cursors','participant_roles','room_admission_baselines','room_admission_heads','room_admission_receipts','room_disclosure_leases','room_disclosure_mutations','room_execution_audit','room_history_read_audit_meta','room_history_read_audits','room_members','room_membership_leases','room_message_deliveries','room_messages','room_recipient_cursors','room_schema_version','room_sequences','room_source_identity','room_workspace_records','rooms','sqlite_sequence'] as const);
export type BrokerRoomTable=typeof BROKER_ROOM_TABLES[number];
export type BrokerRoomQueryId=`brokerRoom:${BrokerRoomTable}`;
export const BROKER_ROOM_COLUMNS=freezeCapturedData({...BROKER_COMMON_COLUMNS,...BROKER_ADMISSION_COLUMNS});
const compare=(a:{type:string;name:string},b:{type:string;name:string})=>a.type<b.type?-1:a.type>b.type?1:a.name<b.name?-1:a.name>b.name?1:0;
export const BROKER_ROOM_LAYOUTS=freezeCapturedData([
 {version:8,schema:BROKER_COMMON_SCHEMA,tables:BROKER_ROOM_TABLES.filter(t=>Object.hasOwn(BROKER_COMMON_COLUMNS,t))},
 {version:9,schema:[...BROKER_COMMON_SCHEMA,...BROKER_ADMISSION_SCHEMA].sort(compare),tables:BROKER_ROOM_TABLES},
] as const);
export const BROKER_ROOM_QUERIES=(()=>{
 const queries:Record<BrokerRoomQueryId,{table:BrokerRoomTable;columns:readonly string[]}>=Object.create(null);
 for(const table of BROKER_ROOM_TABLES)queries[`brokerRoom:${table}`]={table,columns:BROKER_ROOM_COLUMNS[table]!.map(c=>c.name)};
 return freezeCapturedData(queries);
})();
