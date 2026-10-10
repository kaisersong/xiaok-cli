import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

function sqlitePaths(entry: string): string[][] {
  const visited = new Set<string>();
  const failures: string[][] = [];
  function visit(file: string, chain: string[]): void {
    if (visited.has(file)) return;
    visited.add(file);
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
      if (ts.isImportDeclaration(statement)) {
        const clause = statement.importClause;
        if (clause?.isTypeOnly) continue;
        if (clause && !clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings)
          && clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every(element => element.isTypeOnly)) continue;
      } else {
        if (statement.isTypeOnly) continue;
        if (statement.exportClause && ts.isNamedExports(statement.exportClause)
          && statement.exportClause.elements.length > 0 && statement.exportClause.elements.every(element => element.isTypeOnly)) continue;
      }
      const specifier = statement.moduleSpecifier;
      if (!specifier || !ts.isStringLiteral(specifier)) continue;
      const target = specifier.text;
      if (target === 'node:sqlite') failures.push([...chain, target]);
      if (!target.startsWith('.')) continue;
      const resolved = resolve(dirname(file), target.replace(/\.js$/, '.ts'));
      const dependency = [resolved, `${resolved}.ts`, join(resolved, 'index.ts')].find(existsSync);
      if (!dependency) throw new Error(`Unresolved static dependency: ${[...chain, target].join(' → ')}`);
      visit(dependency, [...chain, relative(process.cwd(), dependency).replace(/\\/g, '/')]);
    }
  }
  visit(resolve(process.cwd(), entry), [entry]);
  return failures;
}

describe('CLI static imports', () => {
  // index intentionally loads main dynamically; also inspect that startup root
  // to catch a reintroduced chat -> cli -> sqlite chain.
  it.each(['src/index.ts', 'src/main.ts'])('%s cannot statically reach node:sqlite', entry => {
    const paths = sqlitePaths(entry);
    expect(paths, paths.map(chain => chain.join(' → ')).join('\n')).toEqual([]);
  });
});
