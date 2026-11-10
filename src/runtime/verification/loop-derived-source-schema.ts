import {freezeCapturedData} from './captured-source-json.js';
/** Original fixed consent/derived extension comparison data; not executable SQL. */
export const LOOP_DERIVED_SOURCE_SCHEMA=freezeCapturedData([
 {type:'index',name:'sqlite_autoindex_assistant_calendar_memory_settings_1',tbl_name:'assistant_calendar_memory_settings',sql:null},
 {type:'index',name:'sqlite_autoindex_assistant_derived_lineage_1',tbl_name:'assistant_derived_lineage',sql:null},
 {type:'index',name:'sqlite_autoindex_assistant_derived_run_markers_1',tbl_name:'assistant_derived_run_markers',sql:null},
 {type:'table',name:'assistant_calendar_memory_settings',tbl_name:'assistant_calendar_memory_settings',sql:'CREATE TABLE assistant_calendar_memory_settings(owner_id TEXT NOT NULL,profile_id TEXT NOT NULL,enabled INTEGER NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(owner_id,profile_id))'},
 {type:'table',name:'assistant_derived_run_markers',tbl_name:'assistant_derived_run_markers',sql:'CREATE TABLE assistant_derived_run_markers(run_id TEXT PRIMARY KEY,profile_id TEXT NOT NULL)'},
 {type:'table',name:'assistant_derived_lineage',tbl_name:'assistant_derived_lineage',sql:'CREATE TABLE assistant_derived_lineage(run_id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,lineage_json TEXT NOT NULL)'},
] as const);
export const LOOP_DERIVED_COLUMN_TYPES=freezeCapturedData({
 assistant_calendar_memory_settings:[{name:'owner_id',type:'TEXT',notnull:1,pk:1},{name:'profile_id',type:'TEXT',notnull:1,pk:2},{name:'enabled',type:'INTEGER',notnull:1,pk:0},{name:'revision',type:'INTEGER',notnull:1,pk:0}],
 assistant_derived_run_markers:[{name:'run_id',type:'TEXT',notnull:0,pk:1},{name:'profile_id',type:'TEXT',notnull:1,pk:0}],
 assistant_derived_lineage:[{name:'run_id',type:'TEXT',notnull:0,pk:1},{name:'profile_id',type:'TEXT',notnull:1,pk:0},{name:'lineage_json',type:'TEXT',notnull:1,pk:0}],
} as const);
