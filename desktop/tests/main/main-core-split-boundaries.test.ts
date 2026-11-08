// @vitest-environment node
import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {createOriginalMainDshOperationalClock} from '../../electron/main-dsh-bootstrap-clock.js';
import type {GithubProviderDateFact} from '../../electron/dsh-github-source-session.js';
const read=(name:string)=>readFileSync(new URL('../../electron/'+name,import.meta.url),'utf8');
it('accessors only read the two bound private maps; their factory cannot mutate or publish either map',()=>{
 const source=read('main-dsh-core-accessors.ts'),ast=ts.createSourceFile('accessors.ts',source,ts.ScriptTarget.Latest,true);
 const factory=ast.statements.filter((node):node is ts.FunctionDeclaration=>ts.isFunctionDeclaration(node)&&node.name?.text==='createOriginalMainDshCoreAccessors');expect(factory).toHaveLength(1);
 expect(factory[0]!.parameters.map(p=>p.name.getText(ast))).toEqual(['realms','installedPools']);
 const accesses:string[]=[];const mutations:string[]=[];const tables:string[]=[];
 const walk=(node:ts.Node)=>{
  if(ts.isPropertyAccessExpression(node)&&node.expression.getText(ast)==='WeakMap.prototype')accesses.push(node.name.text);
  if(ts.isCallExpression(node)&&['set','delete','clear'].includes(node.expression.getText(ast)))mutations.push(node.getText(ast));
  if(ts.isReturnStatement(node)&&node.expression&&node.parent===factory[0]!.body){const returned=node.expression;expect(ts.isCallExpression(returned)&&returned.expression.getText(ast)==='Object.freeze').toBe(true);if(ts.isCallExpression(returned))for(const argument of returned.arguments){expect(ts.isObjectLiteralExpression(argument)).toBe(true);if(ts.isObjectLiteralExpression(argument))for(const property of argument.properties){expect(ts.isShorthandPropertyAssignment(property)).toBe(true);if(ts.isShorthandPropertyAssignment(property))tables.push(property.name.text);}}}
  ts.forEachChild(node,walk);
 };walk(ast);expect(accesses).toEqual(['get']);expect(mutations).toEqual([]);expect(tables.length).toBeGreaterThan(15);expect(tables).not.toContain('realms');expect(tables).not.toContain('installedPools');
 const main=read('main-dsh-bootstrap-authority.ts');expect(main).toContain('const realms=new NativeWeakMap<object,State>()');expect(main).toContain('const installedPools=new NativeWeakMap<object,InstalledPool>()');expect(main).toContain('createOriginalMainDshCoreAccessors(realms,installedPools)');
 for(const name of ['main-dsh-core-accessors.ts','main-dsh-bootstrap-data.ts','main-dsh-bootstrap-clock.ts','main-dsh-core-kswarm-cleanup.ts']){const text=read(name);expect(text).not.toContain('createOriginalMainIssuer');expect(text).not.toContain('requireNative');}
});
function cut(wallMs=100000,lower=1000000000n,upper=1000000000n){return Object.freeze({kind:'main_kernel_clock_cut_v1' as const,domainId:'a'.repeat(64),continuousLowerNs:String(lower),continuousUpperNs:String(upper),wallMs});}
function fact(wallMs=100000){return {factRef:'original-response',exclusiveSecondUpperBound:new Date(wallMs).toISOString(),localClockCut:{before:cut(wallMs),after:cut(wallMs)}} as GithubProviderDateFact;}
it('operational clock keeps the original five-minute sanity window, Native freshness and sticky loss',()=>{
 let native=cut();const clock=createOriginalMainDshOperationalClock(()=>native,()=>{},()=>{});expect(clock.clockView().projection.state).toBe('unverified');clock.observeClock(fact());const original=clock.clockView();expect(original.projection.state).toBe('verified');
 native=cut(100001,1000000000n,2000000000n);original.assertCurrent();native=cut(100001,1000000000n,2000000001n);expect(()=>original.assertCurrent()).toThrow();expect(clock.clockView().projection.state).toBe('unverified');
 const boundary=createOriginalMainDshOperationalClock(()=>cut(400000),()=>{},()=>{});boundary.observeClock({...fact(),localClockCut:{before:cut(400000),after:cut(400000)}} as GithubProviderDateFact);expect(boundary.clockView().projection.state).toBe('verified');
 const outside=createOriginalMainDshOperationalClock(()=>cut(400001),()=>{},()=>{});outside.observeClock({...fact(),localClockCut:{before:cut(400001),after:cut(400001)}} as GithubProviderDateFact);expect(outside.clockView().projection.state).toBe('unverified');
});
it('clock kernel DTO capture rejects Proxy/getters without invoking them and preserves the original bounds',async()=>{
 const {captureOriginalMainDshClockCut}=await import('../../electron/main-dsh-bootstrap-data.js');let hits=0;const p=new Proxy(cut(),{ownKeys(){hits++;throw 0;},get(){hits++;throw 0;}});expect(()=>captureOriginalMainDshClockCut(p)).toThrow();
 expect(()=>captureOriginalMainDshClockCut(Object.defineProperty({...cut()},'wallMs',{get(){hits++;throw 0;}}))).toThrow();expect(hits).toBe(0);expect(captureOriginalMainDshClockCut(cut(1,0n,1000000000n))).toEqual(cut(1,0n,1000000000n));expect(()=>captureOriginalMainDshClockCut(cut(1,0n,1000000001n))).toThrow();
});

it('fixed KSwarm cleanup cannot receive caller API, issuer, tables, callbacks or verifiers',()=>{
 const source=read('main-dsh-core-kswarm-cleanup.ts'),ast=ts.createSourceFile('cleanup.ts',source,ts.ScriptTarget.Latest,true),factory=ast.statements.filter((node):node is ts.FunctionDeclaration=>ts.isFunctionDeclaration(node)&&node.name?.text==='createOriginalMainDshKSwarmCleanup');expect(factory).toHaveLength(1);expect(factory[0]!.parameters).toHaveLength(0);
 const forbidden:string[]=[];const walk=(node:ts.Node)=>{if(ts.isIdentifier(node)&&['issuer','api','realms','installedPools','requireNative','WeakMap'].includes(node.text))forbidden.push(node.text);ts.forEachChild(node,walk);};walk(ast);expect(forbidden).toEqual([]);
});
