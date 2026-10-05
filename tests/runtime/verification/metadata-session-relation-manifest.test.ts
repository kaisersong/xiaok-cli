import { expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { LoopStore } from '../../../desktop/electron/loop-store.js';
import { CompletionEvidenceStore } from '../../../desktop/electron/completion-evidence-store.js';
import { METADATA_SESSION_QUERIES } from '../../../src/runtime/verification/metadata-session-query-manifest.js';
import { metadataSessionRelationManifest } from '../../../src/runtime/verification/metadata-session-relation-manifest.js';

it('all 29 fixed relations compile against actual original Loop and Completion constructors', () => {
 const root = mkdtempSync(join(tmpdir(), 'loop-relations-'));
 const path = join(root, 'source.sqlite');
 const loop = new LoopStore(path);
 const completion = new CompletionEvidenceStore(path);
 const db = new DatabaseSync(path);
 try {
  const originalLoopRelations=Object.entries(metadataSessionRelationManifest).filter(([id])=>id.startsWith('loop:')).map(([,relation])=>relation);
  expect(originalLoopRelations).toHaveLength(29);
  for (const relation of originalLoopRelations) {
   const projection = METADATA_SESSION_QUERIES[relation.queryId];
   const columns: readonly string[] = projection.columns;
   for (const column of [...relation.whereEqual, ...relation.orderBy]) expect(columns).toContain(column);
   const quote = (s: string) => `"${s}"`;
   const query = `SELECT ${columns.map(quote).join(',')} FROM ${quote(projection.table)} WHERE ${relation.whereEqual.map(c => `${quote(c)} = ?`).join(' AND ')} ORDER BY ${relation.orderBy.map(c => `${quote(c)} COLLATE BINARY`).join(',')}, rowid`;
   expect(db.prepare(query).all(...relation.boundKeyTypes.map(() => "' OR 1=1 --"))).toEqual([]);
   expect(Object.isFrozen(relation)).toBe(true);
   for (const value of [relation.whereEqual, relation.orderBy, relation.boundKeyTypes]) expect(Object.isFrozen(value)).toBe(true);
  }
  expect(Object.isFrozen(metadataSessionRelationManifest)).toBe(true);
 } finally { db.close(); completion.close(); loop.close(); rmSync(root, { recursive: true, force: true }); }
});
