import {freezeCapturedData} from './captured-source-json.js';
/** Fixed two-table readonly-calendar extension. Comparison data, not SQL to execute. */
export const LOOP_CALENDAR_SOURCE_SCHEMA=freezeCapturedData([
 {type:'index',name:'assistant_calendar_latest',tbl_name:'assistant_calendar_generations',sql:'CREATE INDEX assistant_calendar_latest ON assistant_calendar_generations(epoch,id DESC)'},
 {type:'table',name:'assistant_calendar_connection',tbl_name:'assistant_calendar_connection',sql:'CREATE TABLE assistant_calendar_connection(id INTEGER PRIMARY KEY CHECK(id=1),epoch INTEGER NOT NULL,enabled INTEGER NOT NULL,binary_path TEXT NOT NULL,account_hash TEXT NOT NULL)'},
 {type:'table',name:'assistant_calendar_generations',tbl_name:'assistant_calendar_generations',sql:'CREATE TABLE assistant_calendar_generations(id INTEGER PRIMARY KEY AUTOINCREMENT,epoch INTEGER NOT NULL,collected_at INTEGER NOT NULL,snapshot_json TEXT NOT NULL)'},
] as const);
export const LOOP_CALENDAR_COLUMN_TYPES=freezeCapturedData({
 assistant_calendar_connection:[{name:'id',type:'INTEGER',notnull:0,pk:1},{name:'epoch',type:'INTEGER',notnull:1,pk:0},{name:'enabled',type:'INTEGER',notnull:1,pk:0},{name:'binary_path',type:'TEXT',notnull:1,pk:0},{name:'account_hash',type:'TEXT',notnull:1,pk:0}],
 assistant_calendar_generations:[{name:'id',type:'INTEGER',notnull:0,pk:1},{name:'epoch',type:'INTEGER',notnull:1,pk:0},{name:'collected_at',type:'INTEGER',notnull:1,pk:0},{name:'snapshot_json',type:'TEXT',notnull:1,pk:0}],
} as const);
