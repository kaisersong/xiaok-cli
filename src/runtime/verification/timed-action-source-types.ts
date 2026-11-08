import type {CapturedSqliteCell} from './source-sqlite-cell.js';
import type {TimedActionQueryId} from './timed-action-source-queries.js';
export interface TimedActionReference {readonly column:string;readonly domain:string;readonly value:CapturedSqliteCell;readonly referenceState:'declared'|'uninterpreted';readonly definition:boolean;readonly sameSource:boolean}
export type TimedActionCounts=Readonly<Record<TimedActionQueryId,number>>;
export type TimedActionSourceEvent=
 |Readonly<{kind:'source-start';sourceId:string;snapshotHash:string;format:'timed-actions-sqlite-v1'}>
 |Readonly<{kind:'row';sourceId:string;table:string;rowid:string;record:Readonly<Record<string,CapturedSqliteCell>>;references:readonly TimedActionReference[]}>
 |Readonly<{kind:'source-end';sourceId:string;counts:TimedActionCounts}>
 |Readonly<{kind:'complete';sources:readonly Readonly<{sourceId:string;snapshotHash:string;counts:TimedActionCounts}>[];digest:string}>;
