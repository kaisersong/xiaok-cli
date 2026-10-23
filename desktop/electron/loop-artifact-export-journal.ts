import type {DatabaseSync} from 'node:sqlite';
export * from '../../src/runtime/loop/artifact-export-journal.js';
export function assertLoopArtifactExportDurability(db:DatabaseSync):void {
 const mode=db.prepare('PRAGMA journal_mode').get()?.journal_mode,sync=db.prepare('PRAGMA synchronous').get()?.synchronous;
 const main=db.prepare('PRAGMA database_list').all().find(row=>row.name==='main');
 if(!main?.file||!['wal','delete'].includes(String(mode))||![2,3].includes(Number(sync)))throw Error('loop_export_journal_durability');
}
export function migrateLoopArtifactExportJournal(db:DatabaseSync):void {
 db.exec(`CREATE TABLE IF NOT EXISTS loop_artifact_exports (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT CHECK(sequence BETWEEN 1 AND 9007199254740991),
  id TEXT NOT NULL UNIQUE, revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
  parent_device TEXT NOT NULL,parent_inode TEXT NOT NULL,temporary_name TEXT NOT NULL,
  record_json TEXT NOT NULL,record_hash TEXT NOT NULL,UNIQUE(parent_device,parent_inode,temporary_name));
  CREATE TRIGGER IF NOT EXISTS loop_artifact_export_immutable BEFORE UPDATE ON loop_artifact_exports
  WHEN NEW.sequence IS NOT OLD.sequence OR NEW.id IS NOT OLD.id OR NEW.parent_device IS NOT OLD.parent_device OR NEW.parent_inode IS NOT OLD.parent_inode OR NEW.temporary_name IS NOT OLD.temporary_name
  BEGIN SELECT RAISE(ABORT,'loop_export_journal_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS loop_artifact_export_no_delete BEFORE DELETE ON loop_artifact_exports
  BEGIN SELECT RAISE(ABORT,'loop_export_journal_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS loop_artifact_export_no_replace BEFORE INSERT ON loop_artifact_exports
  WHEN (NEW.sequence != -1 AND NEW.sequence <= (SELECT COALESCE(MAX(sequence),0) FROM loop_artifact_exports)) OR EXISTS(SELECT 1 FROM loop_artifact_exports WHERE id=NEW.id OR sequence=NEW.sequence OR (parent_device=NEW.parent_device AND parent_inode=NEW.parent_inode AND temporary_name=NEW.temporary_name))
  BEGIN SELECT RAISE(ABORT,'loop_export_journal_immutable'); END;`);
}
