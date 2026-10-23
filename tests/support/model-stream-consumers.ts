import { relative, resolve } from 'node:path';
import ts from 'typescript';

/** Only the audited project-model wrapper may expose stream outside the owner. */
export function findUnauthorizedStreamConsumers(files: string[]): string[] {
  const program = ts.createProgram(files, {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    skipLibCheck: true,
    noEmit: true,
  });
  const checker = program.getTypeChecker();
  const wrapperPath = resolve('desktop/electron/project-agent-model.ts');
  const findings: string[] = [];
  for (const path of files) {
    const source = program.getSourceFile(path);
    if (!source) throw new Error(`Missing source: ${path}`);
    let occurrence = 0;
    const inspectCallee = (callee: ts.Expression): void => {
      if (ts.isParenthesizedExpression(callee)) return inspectCallee(callee.expression);
      if (ts.isConditionalExpression(callee)) {
        inspectCallee(callee.whenTrue);
        inspectCallee(callee.whenFalse);
        return;
      }
      const property = ts.isPropertyAccessExpression(callee) ? callee.name
        : ts.isElementAccessExpression(callee) ? callee.argumentExpression : undefined;
      const name = property && (ts.isIdentifier(property) || ts.isStringLiteral(property)) ? property.text : undefined;
      if (name !== 'stream') return;
      const symbol = ts.isPropertyAccessExpression(callee) ? checker.getSymbolAtLocation(callee.name)
        : ts.isElementAccessExpression(callee) ? checker.getTypeAtLocation(callee.expression).getProperty('stream') : undefined;
      const declarations = symbol?.getDeclarations();
      const authorized = declarations?.length && declarations.every(declaration =>
        ts.isMethodDeclaration(declaration) && resolve(declaration.getSourceFile().fileName) === wrapperPath);
      if (!authorized) findings.push(`${relative(process.cwd(), path).replace(/\\/g, '/')}#${++occurrence}`);
    };
    const inspectExpression = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) inspectCallee(node.expression);
      ts.forEachChild(node, inspectExpression);
    };
    const visit = (node: ts.Node): void => {
      if (ts.isForOfStatement(node) && node.awaitModifier) inspectExpression(node.expression);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return findings.sort();
}
