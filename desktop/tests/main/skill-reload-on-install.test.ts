/**
 * Skill install/uninstall must automatically invalidate the runner's skill
 * catalog so newly installed skills are usable without restarting the app.
 *
 * Design doc: docs/design/2026-07-28-desktop-skill-install-auto-reload.md
 *
 * Source-scan style follows tests/main/skill-routing.test.ts: the desktop
 * runner has no lightweight behavioral harness, so wiring is asserted on the
 * source while the invalidation mechanism itself is covered behaviorally in
 * skill-catalog-invalidation.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const servicesSource = readFileSync(join(__dirname, '../../electron/desktop-services.ts'), 'utf-8');
const mutationSource = readFileSync(join(__dirname, '../../electron/desktop-skill-mutation.ts'), 'utf-8');
const mainSource = readFileSync(join(__dirname, '../../electron/main.ts'), 'utf-8');

describe('skill install auto reload wiring', () => {
  it('bumps the shared catalog version from every install/uninstall entrance', () => {
    // Keep all four original entrances. Physical bump sites moved into the
    // shared Desktop domain helper; literals in the old file are no longer
    // evidence for its two callers. Real service behavior has separate controls.
    const servicesAst = ts.createSourceFile('desktop-services.ts', servicesSource, ts.ScriptTarget.Latest, true);
    const mutationAst = ts.createSourceFile('desktop-skill-mutation.ts', mutationSource, ts.ScriptTarget.Latest, true);
    function nodes<T extends ts.Node>(root: ts.Node, guard: (node: ts.Node) => node is T): T[] {
      const found: T[] = [];
      const visit = (node: ts.Node) => { if (guard(node)) found.push(node); ts.forEachChild(node, visit); };
      visit(root); return found;
    }
    function name(node: ts.PropertyName | undefined) {
      return node && (ts.isIdentifier(node) || ts.isStringLiteral(node)) ? node.text : undefined;
    }
    function property(object: ts.ObjectLiteralExpression, key: string) {
      return object.properties.find((node): node is ts.PropertyAssignment => ts.isPropertyAssignment(node) && name(node.name) === key)?.initializer;
    }
    function successfulBump(body: ts.Block, ast: ts.SourceFile, command: string, operand: string) {
      const result = nodes(body, ts.isVariableDeclaration).filter(node => ts.isIdentifier(node.name) && node.name.text === 'result');
      expect(result).toHaveLength(1);
      const call = result[0]!.initializer;
      expect(call && ts.isCallExpression(call)).toBe(true);
      if (!call || !ts.isCallExpression(call)) throw Error('skill_command_call_missing');
      expect(call.expression.getText(ast)).toBe(command);
      expect(call.arguments[0] && ts.isStringLiteral(call.arguments[0]) ? call.arguments[0].text : undefined).toBe('clawhub');
      const args = call.arguments[1];
      expect(args && ts.isArrayLiteralExpression(args)).toBe(true);
      if (!args || !ts.isArrayLiteralExpression(args)) throw Error('skill_command_argv_missing');
      expect(args.elements).toHaveLength(2);
      const operation = args.elements[0]!;
      expect(ts.isStringLiteral(operation) ? operation.text : operation.getText(ast)).toBe(operand);
      expect(args.elements[1]!.getText(ast)).toBe('skillName');
      const bumps = nodes(body, ts.isCallExpression).filter(call => ts.isIdentifier(call.expression) && call.expression.text === 'bumpSkillCatalogVersion');
      expect(bumps).toHaveLength(1);
      const bumpIndex = body.statements.findIndex(statement => ts.isExpressionStatement(statement) && statement.expression === bumps[0]);
      expect(bumpIndex).toBeGreaterThan(0);
      for (const condition of ['result.error', 'result.status !== 0']) {
        const index = body.statements.findIndex(statement => ts.isIfStatement(statement) && statement.expression.getText(ast) === condition);
        expect(index).toBeGreaterThanOrEqual(0); expect(index).toBeLessThan(bumpIndex);
        const statement = body.statements[index]!;
        if (!ts.isIfStatement(statement)) throw Error('skill_failure_guard_missing');
        const branch = statement.thenStatement;
        expect(ts.isReturnStatement(branch) || ts.isBlock(branch) && ts.isReturnStatement(branch.statements[branch.statements.length - 1]!)).toBe(true);
        expect(statement.elseStatement).toBeUndefined();
      }
      const success = body.statements[bumpIndex + 1]!;
      expect(ts.isReturnStatement(success)).toBe(true);
      const successDTO = nodes(success, ts.isObjectLiteralExpression).filter(dto => property(dto, 'success')?.kind === ts.SyntaxKind.TrueKeyword);
      expect(successDTO).toHaveLength(1);
    }
    const owners = nodes(servicesAst, ts.isFunctionDeclaration).filter(node => node.name?.text === 'createDesktopServices');
    expect(owners).toHaveLength(1);
    const methods = nodes(owners[0]!, ts.isMethodDeclaration);
    const registrations = methods.filter(node => name(node.name) === 'registerSkillTools');
    expect(registrations).toHaveLength(1);
    const entrancePopulation: string[] = [];
    for (const [toolName, operation] of [['skill_install', 'install'], ['skill_uninstall', 'uninstall']] as const) {
      const tools = nodes(registrations[0]!, ts.isObjectLiteralExpression).filter(tool => {
        const definition = property(tool, 'definition');
        if (!definition || !ts.isObjectLiteralExpression(definition)) return false;
        const id = property(definition, 'name'); return id && ts.isStringLiteral(id) && id.text === toolName;
      });
      expect(tools).toHaveLength(1);
      const executes = tools[0]!.properties.filter((node): node is ts.MethodDeclaration => ts.isMethodDeclaration(node) && name(node.name) === 'execute');
      expect(executes).toHaveLength(1); expect(executes[0]!.body).toBeDefined();
      successfulBump(executes[0]!.body!, servicesAst, 'spawnSync', operation);
      entrancePopulation.push(toolName);
    }
    const imports = servicesAst.statements.filter((node): node is ts.ImportDeclaration => ts.isImportDeclaration(node)
      && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === './desktop-skill-mutation.js');
    expect(imports).toHaveLength(1);
    const bindings = imports[0]!.importClause?.namedBindings;
    expect(bindings && ts.isNamedImports(bindings) && bindings.elements.some(node => node.name.text === 'runDesktopSkillMutation' && !node.propertyName)).toBe(true);
    for (const [methodName, operation] of [['installSkill', 'install'], ['uninstallSkill', 'uninstall']] as const) {
      const delegates = methods.filter(node => name(node.name) === methodName);
      expect(delegates).toHaveLength(1); expect(delegates[0]!.body?.statements).toHaveLength(1);
      const statement = delegates[0]!.body!.statements[0]!;
      expect(ts.isReturnStatement(statement)).toBe(true);
      const call = ts.isReturnStatement(statement) ? statement.expression : undefined;
      if (!call || !ts.isCallExpression(call)) throw Error('skill_desktop_delegate_missing');
      expect(call.expression.getText(servicesAst)).toBe('runDesktopSkillMutation');
      expect(call.arguments).toHaveLength(4);
      expect(ts.isStringLiteral(call.arguments[0]!) ? call.arguments[0]!.text : undefined).toBe(operation);
      expect(call.arguments.slice(1).map(node => node.getText(servicesAst))).toEqual(['skillName', 'context', 'process.cwd()']);
      entrancePopulation.push(methodName);
    }
    const helpers = mutationAst.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'runDesktopSkillMutation');
    expect(helpers).toHaveLength(1);
    expect(helpers[0]!.modifiers?.some(node => node.kind === ts.SyntaxKind.ExportKeyword)).toBe(true);
    expect(helpers[0]!.body).toBeDefined();
    successfulBump(helpers[0]!.body!, mutationAst, 'crossSpawn.sync', 'operation');
    expect(entrancePopulation).toEqual(['skill_install', 'skill_uninstall', 'installSkill', 'uninstallSkill']);
  });

  it('runner reloads the catalog when the shared version changes instead of a one-shot gate', () => {
    expect(servicesSource).not.toMatch(/let skillsLoaded = false/);
    expect(servicesSource).toContain('getSkillCatalogVersion()');
    expect(servicesSource).toMatch(/loadedSkillCatalogVersion\s*!==\s*getSkillCatalogVersion\(\)/);
  });

  it('registers the skill tool after a later reload even if the first task saw zero skills', () => {
    expect(servicesSource).toMatch(/skillToolAdded/);
  });

  it('main process broadcasts desktop:skillsChanged to the renderer on catalog change', () => {
    expect(mainSource).toContain('onSkillCatalogChanged');
    expect(mainSource).toContain("'desktop:skillsChanged'");
  });
});
