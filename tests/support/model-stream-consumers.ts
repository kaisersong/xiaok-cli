import { relative, resolve } from 'node:path';
import ts from 'typescript';

/** Audit actual stream references, including stored iterators and method aliases. */
export function findUnauthorizedStreamConsumers(files: string[], root = process.cwd()): string[] {
  const program = ts.createProgram(files, {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    skipLibCheck: true,
    noEmit: true,
  });
  const checker = program.getTypeChecker();
  const wrapperPath = resolve(root, 'desktop/electron/project-agent-model.ts');
  const ownerPath = resolve(root, 'src/ai/runtime/provider-conversation-authorization.ts');
  const denySmokePath = resolve(root, 'desktop/electron/kimi-packaged-smoke.ts');
  const findings: string[] = [];
  for (const path of files) {
    const source = program.getSourceFile(path);
    if (!source) throw new Error(`Missing source: ${path}`);
    let occurrence = 0;
    const withinAuditedFunction = (node: ts.Node): boolean => {
      for (let parent: ts.Node | undefined = node; parent; parent = parent.parent) {
        if (ts.isFunctionDeclaration(parent) && parent.name) {
          return resolve(path) === ownerPath && parent.name.text === 'streamOwnedProviderConversation'
            || resolve(path) === denySmokePath && parent.name.text === 'verifyAuthorizationDeny';
        }
        // A nested function does not inherit an outer function's authority.
        if (ts.isArrowFunction(parent) || ts.isFunctionExpression(parent) || ts.isMethodDeclaration(parent)) return false;
      }
      return false;
    };
    const visit = (node: ts.Node): void => {
      const property = ts.isPropertyAccessExpression(node) ? node.name
        : ts.isElementAccessExpression(node) ? node.argumentExpression : undefined;
      let name = ts.isPropertyAccessExpression(node) ? node.name.text : undefined;
      if (ts.isElementAccessExpression(node) && property) {
        const keyType = checker.getTypeAtLocation(property);
        if (keyType.isStringLiteral()) name = keyType.value;
        else if (checker.getTypeAtLocation(node.expression).getProperty('stream')) {
          // Nonliteral keys on a known stream-capable receiver can select stream.
          const maySelectStream = keyType.isUnion()
            ? keyType.types.some(part => !part.isStringLiteral() || part.value === 'stream')
            : true;
          if (maySelectStream) name = 'stream';
        }
      }
      const type = property ? checker.getTypeAtLocation(node) : undefined;
      const callableOrUnknown = type && (type.getCallSignatures().length > 0
        || (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0);
      // Writable stream objects and string-valued event.stream are data.
      if (name === 'stream' && callableOrUnknown) {
        const symbol = ts.isPropertyAccessExpression(node) ? checker.getSymbolAtLocation(node.name)
          : ts.isElementAccessExpression(node) ? checker.getTypeAtLocation(node.expression).getProperty('stream') : undefined;
        const declarations = symbol?.getDeclarations();
        const authorizedWrapper = declarations?.length && declarations.every(declaration =>
          ts.isMethodDeclaration(declaration) && resolve(declaration.getSourceFile().fileName) === wrapperPath
          && ts.isIdentifier(declaration.name) && declaration.name.text === 'stream'
          && ts.isObjectLiteralExpression(declaration.parent)
          && ts.isReturnStatement(declaration.parent.parent)
          && ts.isBlock(declaration.parent.parent.parent)
          && ts.isFunctionDeclaration(declaration.parent.parent.parent.parent)
          && declaration.parent.parent.parent.parent.name?.text === 'createProjectAgentModel');
        // Leaf SDK streaming is not a ModelAdapter.stream consumer. Resolve the
        // actual SDK declaration rather than exempting the adapter source file.
        const leafSdk = declarations?.length && declarations.every(declaration =>
          declaration.getSourceFile().fileName.replace(/\\/g, '/').includes('/node_modules/@anthropic-ai/sdk/'));
        if (!authorizedWrapper && !leafSdk && !withinAuditedFunction(node)) {
          findings.push(`${relative(root, path).replace(/\\/g, '/')}#${++occurrence}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return findings.sort();
}
