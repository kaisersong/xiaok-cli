import {basename,dirname} from 'node:path';
import {registerOrdinarySQLiteLayout} from '../../src/runtime/verification/ordinary-profile-source-registry.js';
import {describeLoopDatabaseSource,type LoopDatabaseSource} from './loop-database-owner.js';
/** A discovery observation only. No historical completeness, custody or capacity grant. */
export function registerLoopDatabaseSourceObservation(source:LoopDatabaseSource):void {
 const facts=describeLoopDatabaseSource(source);
 registerOrdinarySQLiteLayout({kind:'sqlite-db',directory:dirname(facts.path),databaseBasename:basename(facts.path),snapshotFormat:'loop-sqlite-v1'},
  {version:1,components:facts.components,layoutRevision:facts.layoutRevision,layoutHash:facts.layoutHash},facts.physicalIdentity);
 const current=describeLoopDatabaseSource(source);
 if(current.physicalIdentity!==facts.physicalIdentity||current.path!==facts.path)throw Error('loop_database_metadata_identity');
}
