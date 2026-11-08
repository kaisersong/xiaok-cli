// @vitest-environment node
// Structural wiring only; no Main/Native qualification.
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {it,expect} from 'vitest';
function source(path:string){return readFileSync(new URL('../../electron/'+path,import.meta.url),'utf8');}
it('Main binds exactly the original Services and Sources after composition before recovery',()=>{
 const text=source('main.ts'),ast=ts.createSourceFile('main.ts',text,ts.ScriptTarget.Latest,true),calls:ts.CallExpression[]=[];
 function visit(n:ts.Node){if(ts.isCallExpression(n))calls.push(n);ts.forEachChild(n,visit);}visit(ast);
 const bind=calls.filter(n=>n.expression.getText(ast)==='bindOriginalMainDshBrokerService');expect(bind).toHaveLength(1);expect(bind[0]!.arguments.map(n=>n.getText(ast))).toEqual(['services','dshSources']);
 const compose=calls.find(n=>n.expression.getText(ast)==='composeOriginalMainDshRuntime')!,recovery=calls.find(n=>n.expression.getText(ast)==='startOriginalMainDshServicesRecovery')!;
 expect(compose.pos).toBeLessThan(bind[0]!.pos);expect(bind[0]!.pos).toBeLessThan(recovery.pos);expect(text.slice(bind[0]!.pos,recovery.pos)).toContain('rejectOriginalMainDshRuntimeStartup');
});
it('all three fixed Native references are captured before the original issuer birth',()=>{
 const text=source('main-dsh-bootstrap-authority.ts'),birth=text.indexOf('const issuer=apply(birth,api,[])');
 for(const name of ['prepareOriginalBrokerChild','assertOriginalBrokerChildPort','assertOriginalBrokerChildTerminal'])expect(text.indexOf("optional('"+name+"')")).toBeLessThan(birth);
 expect(source('main-dsh-core-broker.ts')).toMatch(/export \{prepareOriginalMainDshBrokerChild\} from '\.\/main-dsh-bootstrap-authority\.js'/);
});
it('the fixed loader admits exactly the three semantic exports and no caller URL',()=>{
 const text=source('main-dsh-kswarm-service-ports-loader.ts');expect(text).toContain("['readOriginalMainDshServicesBinding','prepareOriginalMainDshSourceKSwarmChild','prepareOriginalMainDshSourceBrokerChild']");expect(text).toContain("import('./main-dsh-kswarm-service-ports.js')");
 const ports=source('main-dsh-kswarm-service-ports.ts'),ast=ts.createSourceFile('ports.ts',ports,ts.ScriptTarget.Latest,true);expect(ast.statements.filter(ts.isExportDeclaration)).toHaveLength(3);
});
