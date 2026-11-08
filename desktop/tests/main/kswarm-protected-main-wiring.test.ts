// @vitest-environment node
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {describe,it,expect} from 'vitest';
const source=readFileSync(process.env.XIAOK_KSWARM_MAIN_WIRING_SOURCE??new URL('../../electron/main.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);
function nodes<T extends ts.Node>(pick:(node:ts.Node)=>node is T):T[]{const out:T[]=[];function visit(node:ts.Node){if(pick(node))out.push(node);ts.forEachChild(node,visit);}visit(ast);return out;}
describe('actual Main fixed KS Native binding wiring (structural contract only)',()=>{
 it('preserves activity delegation for ordinary startup and narrows only after original Sources prepared',()=>{
  const setting=nodes(ts.isPropertyAssignment).find(node=>node.name.getText(ast)==='activityOwnerPending');
  expect(setting?.initializer.getText(ast)).toBe("!dshPrepared && process.env.XIAOK_CONVERSATION_ACTIVITY !== '0'");
  const attach=nodes(ts.isConditionalExpression).find(node=>node.whenTrue.getText(ast).includes('services.attachConversationActivityOwner(config)'));
  expect(attach?.condition.getText(ast)).toBe("!dshSources && process.env.XIAOK_CONVERSATION_ACTIVITY !== '0'");
  expect(source.indexOf('await prepareOriginalMainDshServiceSources(')).toBeLessThan(setting!.pos);
 });
 it('binds the same actual Services/Sources after composition before any real recovery or KS start',()=>{
  const calls=nodes(ts.isCallExpression),binds=calls.filter(node=>node.expression.getText(ast)==='bindOriginalMainDshKSwarmService');
  expect(binds).toHaveLength(1);const bind=binds[0]!;
  expect(bind.arguments.map(node=>node.getText(ast))).toEqual(['services','dshSources']);
  const compose=calls.find(node=>node.expression.getText(ast)==='composeOriginalMainDshRuntime')!;
  const recovery=calls.find(node=>node.expression.getText(ast)==='startOriginalMainDshServicesRecovery')!;
  expect(compose.pos).toBeLessThan(bind.pos);expect(bind.pos).toBeLessThan(recovery.pos);
  expect(source.slice(bind.pos,recovery.pos)).toContain('rejectOriginalMainDshRuntimeStartup');
 });
});
