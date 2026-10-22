import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { compileFunction } from 'node:vm';
import ts from 'typescript';
import { isTrustedDesktopRendererUrl } from '../../electron/security.js';

const MAIN_SHA = 'f25ac6d5034918fef0d3207780429bd7773adc1b7e932b0dc3707e4d8c1d5d40';
type Authority = { authorize(event: unknown): void; finer(event: unknown): unknown; setMain(value: unknown): void };
/** Executes the real broad and fine Main predicates from the same bound read. */
export function actualGoalSourceMainAuthority(window: unknown, recorder: unknown, services: unknown): Authority {
  const actual = readFileSync(new URL('../../electron/main.ts', import.meta.url));
  const reviewed = readFileSync(new URL('../fixtures/remediation-20261022-main-reviewed.txt', import.meta.url));
  if (!actual.equals(reviewed) || createHash('sha256').update(actual).digest('hex') !== MAIN_SHA)
    throw Error('goal_source_actual_Main_binding_NOT_READY');
  const tree = ts.createSourceFile('actual-main.ts', actual.toString('utf8'), ts.ScriptTarget.ES2022, true);
  const broad = tree.statements.filter((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === 'authorizeDesktopInvoke');
  const registrations: ts.CallExpression[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && n.expression.getText(tree) === 'registerDesktopIpc') registrations.push(n);
    ts.forEachChild(n, visit);
  };
  visit(tree);
  const options = registrations.length === 1 ? registrations[0]!.arguments[3] : undefined;
  const fine = options && ts.isObjectLiteralExpression(options)
    ? options.properties.filter((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText(tree) === 'multiAgentAuthorize') : [];
  if (broad.length !== 1 || fine.length !== 1 || !ts.isArrowFunction(fine[0]!.initializer))
    throw Error('goal_source_actual_Main_predicates_changed');
  const code = `let mainWindow = initialMain; const meetingRecorderController = { ownsWebContents: value => value === recorder };\n${broad[0]!.getText(tree)}\nconst finer = ${fine[0]!.initializer.getText(tree)};\nreturn { authorize: authorizeDesktopInvoke, finer, setMain(value) { mainWindow = value; } };`;
  const output = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }, reportDiagnostics: true });
  if (output.diagnostics?.some(d => d.category === ts.DiagnosticCategory.Error)) throw Error('goal_source_actual_Main_transpile_failed');
  const dirname = resolve('dist/main/desktop/electron');
  return compileFunction(output.outputText, ['initialMain', 'recorder', 'services', 'isTrustedDesktopRendererUrl', 'join', '__dirname', 'process', 'rendererFile', 'devServer'])(
    window, recorder, services, isTrustedDesktopRendererUrl, join, dirname, { env: {} }, join(dirname, '../../../renderer/index.html'), undefined,
  ) as Authority;
}
