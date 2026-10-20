// @vitest-environment node
import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import { expect, it } from 'vitest';
import { contextDerivative } from '../fixtures/context-derivative.js';

it('requires an explicit knowledge DB path in every continuity fixture Desktop services constructor', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const files = readdirSync(here).filter(file => /^context-continuity.*\.test\.ts$/.test(file))
    .map(file => join(here, file)).concat(join(here, '..', 'fixtures', 'context-derivative.ts'));
  const missing: string[] = [];
  for (const file of files) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    function visit(node: ts.Node): void {
      if (ts.isCallExpression(node) && node.expression.getText(source) === 'createDesktopServices') {
        const options = node.arguments[0];
        if (!options || !ts.isObjectLiteralExpression(options)
          || !options.properties.some(property => property.name?.getText(source) === 'knowledgeDbPath')) {
          missing.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  expect(missing).toEqual([]);
});

it('opens the derivative fixture knowledge DB only in its own temporary root', async () => {
  const f = await contextDerivative();
  try {
    const db = (f.services.getKnowledgeBaseStore() as unknown as { _db: DatabaseSync })._db;
    const databases = db.prepare('PRAGMA database_list').all();
    const main = databases.find(database => database.name === 'main');
    expect(realpathSync(String(main?.file))).toBe(realpathSync(join(f.root, 'knowledge.test.sqlite')));
  } finally { await f.close(); }
});
