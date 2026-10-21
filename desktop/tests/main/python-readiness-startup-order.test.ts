import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

describe('production Python readiness startup order', () => {
  it('starts Python preparation only after the renderer load completes', () => {
    const source = readFileSync(join(__dirname, '../../electron/main.ts'), 'utf8');
    const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.ES2022, true);
    const windowFactory = ast.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'createInitialWindowResources');
    if (!windowFactory?.body) throw Error('real_window_factory_missing');
    const loads: ts.AwaitExpression[] = [], loaded: ts.CallExpression[] = [], prepares: ts.CallExpression[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isAwaitExpression(node) && ts.isCallExpression(node.expression) && ts.isPropertyAccessExpression(node.expression.expression)
        && node.expression.expression.expression.getText(ast) === 'window' && ['loadURL', 'loadFile'].includes(node.expression.expression.name.text)) loads.push(node);
      if (ts.isCallExpression(node) && node.expression.getText(ast) === 'debugMain' && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === 'createWindow:loaded') loaded.push(node);
      if (ts.isCallExpression(node) && node.expression.getText(ast) === 'prepareBundledPluginPythonRuntime') prepares.push(node);
      ts.forEachChild(node, visit);
    };
    visit(windowFactory.body);
    expect(loads).toHaveLength(2); expect(loaded).toHaveLength(1); expect(prepares).toHaveLength(1);
    for (const load of loads) expect(loaded[0].getStart(ast)).toBeGreaterThan(load.end);
    expect(prepares[0].getStart(ast)).toBeGreaterThan(loaded[0].end);
  });

  it('does not publish managed Python readiness through process.env', () => {
    const source = readFileSync(join(__dirname, '../../electron/main.ts'), 'utf8');
    expect(source).not.toContain('process.env.XIAOK_PYTHON_CMD =');
  });
});
