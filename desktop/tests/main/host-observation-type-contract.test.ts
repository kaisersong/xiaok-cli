import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const desktopRoot = resolve(__dirname, '../..');
const contract = resolve(desktopRoot, 'shared/host-observation-types.ts');
const names = ['AutomationRunHistoryItem', 'CompoundExecutionStatus', 'DesktopGoalNativeMutationProjection', 'GoalActivation', 'GoalCompletionObservation', 'GoalCreationInput', 'GoalEvidenceKind', 'GoalInput', 'GoalState', 'LoopRunObservationView', 'SemanticCompactionStatus'];
const source = () => readFileSync(contract, 'utf8');

describe('public host observation type contract', () => {
  it('exports only the explicit original public data types', () => {
    const file = ts.createSourceFile(contract, source(), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const exports: string[] = [];
    for (const node of file.statements) {
      expect(ts.isExportDeclaration(node)).toBe(true);
      if (!ts.isExportDeclaration(node)) throw new Error('unexpected runtime statement');
      expect(node.isTypeOnly).toBe(true);
      expect(node.exportClause && ts.isNamedExports(node.exportClause)).toBe(true);
      if (node.exportClause && ts.isNamedExports(node.exportClause)) exports.push(...node.exportClause.elements.map(item => item.name.text));
    }
    expect(exports.sort()).toEqual(names);
  });

  it.each([ts.ModuleKind.ESNext, ts.ModuleKind.NodeNext])('erases the actual canonical host references when compiled with module kind %i', module => {
    const result = ts.transpileModule(source(), { fileName: contract, compilerOptions: { module, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true });
    expect(result.diagnostics).toEqual([]);
    expect(result.outputText).not.toMatch(/\b(?:require|import)\s*\(/);
    expect(result.outputText).not.toContain('runtime/');
    expect(result.outputText).not.toContain('electron/');
    expect(result.outputText).not.toMatch(/export\s+(?:type|\*)/);
  });

  it('routes original preload and renderer DTO consumers including inline status siblings through the public type contract', () => {
    const privateSources = ['electron/loop-current-views.ts', 'electron/automation-overview.ts', 'electron/desktop-goal-coordinator.ts', '../src/runtime/goal/completion-observation.ts', '../src/runtime/goal/types.ts', '../src/runtime/sol-pi/compound-status.ts', '../src/runtime/sol-pi/semantic-status.ts'].map(path => resolve(desktopRoot, path));
    for (const path of ['electron/preload-api.ts', 'renderer/src/components/ChatShell.tsx', 'renderer/src/components/GoalBar.tsx', 'renderer/src/components/ObservationControls.tsx']) {
      const filename = resolve(desktopRoot, path), file = ts.createSourceFile(filename, readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, path.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      let publicImports = 0;
      const check = (node: ts.Node) => {
        let specifier: string | undefined;
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) specifier = node.moduleSpecifier.text;
        if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) specifier = node.argument.literal.text;
        if (specifier) {
          const target = resolve(dirname(filename), specifier).replace(/\.js$/, '').replace(/\.ts$/, '') + '.ts';
          expect(privateSources, filename + ' -> ' + specifier).not.toContain(target);
          if (target === contract) {
            publicImports++;
            if (ts.isImportDeclaration(node)) expect(node.importClause?.isTypeOnly).toBe(true);
            if (ts.isExportDeclaration(node)) expect(node.isTypeOnly).toBe(true);
          }
        }
        ts.forEachChild(node, check);
      };
      check(file);
      expect(publicImports, path).toBeGreaterThan(0);
    }
  });
});
