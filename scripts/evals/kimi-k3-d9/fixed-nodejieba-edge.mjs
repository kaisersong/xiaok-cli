import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

// This is a single emitted module's closed loader form, not constant folding.
const FIXED_PATTERN = "require(join(dirname(require.resolve('nodejieba')), 'build', 'Release', 'nodejieba.node'))";
const PROTECTED = new Set(['require', 'createRequire', 'join', 'dirname']);

function fail(reason) {
  throw new Error(`KIMI_D9_FIXED_NODEJIEBA_${reason}`);
}

function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, child => walk(child, visit));
}

function bindingNames(name, add) {
  if (ts.isIdentifier(name)) add(name);
  else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) bindingNames(element.name, add);
    }
  }
}

function originalImport(identifier, name, moduleName) {
  const specifier = identifier.parent;
  if (!ts.isImportSpecifier(specifier) || specifier.propertyName
      || specifier.name !== identifier || identifier.text !== name) return false;
  const declaration = specifier.parent.parent.parent;
  return ts.isImportDeclaration(declaration)
    && ts.isStringLiteral(declaration.moduleSpecifier)
    && declaration.moduleSpecifier.text === moduleName;
}

function originalRequire(identifier, sourceFile) {
  const declaration = identifier.parent;
  return ts.isVariableDeclaration(declaration)
    && declaration.name === identifier
    && ts.isVariableDeclarationList(declaration.parent)
    && (declaration.parent.flags & ts.NodeFlags.Const) !== 0
    && ts.isVariableStatement(declaration.parent.parent)
    && declaration.parent.parent.parent === sourceFile
    && declaration.initializer?.getText(sourceFile) === 'createRequire(import.meta.url)';
}

function directCall(identifier) {
  const call = identifier.parent;
  return ts.isCallExpression(call) && call.expression === identifier
    && !call.questionDotToken;
}

function propertyNameOnly(identifier) {
  const parent = identifier.parent;
  return (ts.isPropertyAccessExpression(parent) && parent.name === identifier)
    || ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent)
      || ts.isGetAccessorDeclaration(parent) || ts.isSetAccessorDeclaration(parent))
      && parent.name === identifier);
}

function proveBindings(sourceFile, outer) {
  const bindings = new Map([...PROTECTED].map(name => [name, []]));
  const add = identifier => bindings.get(identifier.text)?.push(identifier);
  walk(sourceFile, node => {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node)) bindingNames(node.name, add);
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)
        || ts.isClassDeclaration(node) || ts.isClassExpression(node)) && node.name) add(node.name);
    if (ts.isImportSpecifier(node) || ts.isNamespaceImport(node)
        || ts.isImportEqualsDeclaration(node)) add(node.name);
    if (ts.isImportClause(node) && node.name) add(node.name);
    if ((ts.isIdentifier(node) && !propertyNameOnly(node)
        && ['eval', 'Function', 'syncBuiltinESMExports'].includes(node.text))
        || (ts.isImportDeclaration(node) && node.moduleSpecifier.text === 'node:vm')) fail('DYNAMIC_LOADER');
  });
  const originals = new Set();
  for (const [name, identifiers] of bindings) {
    if (identifiers.length !== 1) fail('BINDING');
    const identifier = identifiers[0];
    const original = name === 'require'
      ? originalRequire(identifier, sourceFile)
      : originalImport(identifier, name, name === 'createRequire' ? 'node:module' : 'node:path');
    if (!original) fail('BINDING');
    originals.add(identifier);
  }
  const requireDeclaration = bindings.get('require')[0].parent;
  walk(sourceFile, node => {
    if (!ts.isIdentifier(node) || !PROTECTED.has(node.text)
        || originals.has(node) || propertyNameOnly(node)) return;
    if (node.text === 'createRequire') {
      if (requireDeclaration.initializer?.expression !== node) fail('ESCAPE');
      return;
    }
    if (node.text === 'join' || node.text === 'dirname') {
      if (!directCall(node)) fail('ESCAPE');
      return;
    }
    if (directCall(node)) {
      if (node.parent === outer) return;
      if (node.parent.arguments.length === 1
          && ts.isStringLiteral(node.parent.arguments[0])
          && node.parent.arguments[0].text === 'nodejieba') return;
      fail('ESCAPE');
    }
    const access = node.parent;
    if (ts.isPropertyAccessExpression(access) && access.expression === node
        && access.name.text === 'resolve' && !access.questionDotToken
        && directCall(access) && access.parent.arguments.length === 1
        && ts.isStringLiteral(access.parent.arguments[0])
        && access.parent.arguments[0].text === 'nodejieba') return;
    fail('ESCAPE');
  });
}

export function deriveFixedNodejiebaEdges(importerPath, sourceFile) {
  const normalized = resolve(importerPath).split(sep).join('/');
  if (!normalized.endsWith('/dist/ai/memory/segment.js')) return new Map();
  const candidates = [];
  walk(sourceFile, node => {
    if (ts.isStringLiteral(node) && node.text === 'nodejieba.node') candidates.push(node);
  });
  if (candidates.length === 0) return new Map();
  if (candidates.length !== 1) fail('FORM');
  const outer = candidates[0].parent.parent;
  // Comparing original text rejects optional/bracket/spread/escaped tokens too.
  if (!ts.isCallExpression(outer) || outer.getText(sourceFile) !== FIXED_PATTERN) fail('FORM');
  proveBindings(sourceFile, outer);
  const canonicalImporter = realpathSync(importerPath);
  const closureRoot = dirname(dirname(dirname(dirname(canonicalImporter))));
  const expectedEntry = join(closureRoot, 'node_modules', 'nodejieba', 'index.js');
  let entry;
  try {
    entry = createRequire(pathToFileURL(importerPath)).resolve('nodejieba');
  } catch {
    fail('TARGET');
  }
  // Exports redirects, nearer packages and ambient NODE_PATH cannot choose a target.
  if (entry !== expectedEntry) fail('TARGET');
  const target = relative(dirname(canonicalImporter), join(dirname(entry), 'build', 'Release', 'nodejieba.node'));
  return new Map([[outer, [target.split(sep).join('/')]]]);
}
