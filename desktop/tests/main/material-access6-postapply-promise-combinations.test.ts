// @vitest-environment node
// POSTAPPLY ONLY: imports candidate modules that do not exist in current production.
// This tests actual typed registrar/serializer/witness/physical IPC token, not OS business.
// The original 98-case source-before suite supplies actual registerDesktopIpc/service business.
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileFunction } from 'node:vm';
import ts from 'typescript';
import { afterEach, expect, it } from 'vitest';
import { registerMaterialAccessIpc } from '../../electron/material-access-typed-ipc.js';
import { captureMaterialAccessInput, assertMaterialAccessEnvironment } from '../../electron/material-access-data.js';
import { DesktopShutdownGate, ShutdownAwareIpcMain, type IpcHandlerListener } from '../../electron/shutdown-aware-ipc-main.js';
import { isTrustedDesktopRendererUrl } from '../../electron/security.js';
const methods=['readClipboardImage','selectDirectory','selectMaterials','importMaterial','openArtifact','selectHtmlEditMedia'] as const;
const roots:string[]=[];afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true,maxRetries:3});});
function fixture(style:'plain-sync'|'plain-async'|'held-native'|'own-then'|'bad-constructor'|'witness-species',selected:string){
 const root=mkdtempSync(join(tmpdir(),'files6-promise-owned-'));roots.push(root);
 const args:Record<string,unknown[]>={readClipboardImage:[],selectDirectory:[],selectMaterials:[],importMaterial:[{taskId:'pre_task',filePath:join(root,'source.md'),role:'customer_material'}],openArtifact:[{artifactId:'legacy_artifact'}],selectHtmlEditMedia:[{kind:'svg'}]};
 const outputs:Record<string,unknown>={readClipboardImage:join(root,'clipboard.png'),selectDirectory:{filePath:root},selectMaterials:{filePaths:[join(root,'source.md')]},importMaterial:{materialId:'owned_material',originalName:'source.md',role:'customer_material',parseStatus:'pending',parseSummary:undefined},openArtifact:undefined,selectHtmlEditMedia:{canceled:false,filePath:join(root,'source.svg'),content:'<svg></svg>'}};
 const text=readFileSync(new URL('../../electron/main.ts',import.meta.url),'utf8'),ast=ts.createSourceFile('main.ts',text,ts.ScriptTarget.Latest,true),declaration=ast.statements.find((n):n is ts.FunctionDeclaration=>ts.isFunctionDeclaration(n)&&n.name?.text==='authorizeDesktopInvoke');expect(declaration).toBeDefined();
 const dirname=resolve('dist/main/desktop/electron'),frame={url:pathToFileURL(join(dirname,'../../../renderer/index.html')).href},sender={mainFrame:frame,isDestroyed:()=>false};
 const code=ts.transpileModule('let mainWindow=initialMain,meetingRecorderController=undefined;\n'+declaration!.getText(ast)+'\nreturn authorizeDesktopInvoke;', {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 const authorize=compileFunction(code,['initialMain','isTrustedDesktopRendererUrl','join','__dirname','process'])({webContents:sender,isDestroyed:()=>false},isTrustedDesktopRendererUrl,join,dirname,{env:{}});
 let effects=0,reads=0,release!:(value:unknown)=>void;
 const held=new Promise<unknown>(yes=>release=yes),bindings=new Map<string,IpcHandlerListener>();
 const producers:Record<string,IpcHandlerListener>={};
 for(const method of methods){
  // Plain callbacks: no vi.fn/mockImplementation wraps a returned Promise.
  if(style==='plain-async'||style==='witness-species')producers[method]=async function(_event,...payload){effects++;expect(payload).toEqual(args[method]);return outputs[method];};
  else producers[method]=function(_event,...payload){effects++;expect(payload).toEqual(args[method]);if(method!==selected||style==='plain-sync')return outputs[method];if(style==='held-native')return held;const result=Promise.resolve(outputs[method]);Object.defineProperty(result,style==='own-then'?'then':'constructor',{configurable:true,get(){reads++;throw Error('fixture_accessor_must_not_run');}});return result;};
  bindings.set('desktop:'+method,producers[method]!);
 }
 const listeners=new Map<string,IpcHandlerListener>(),gate=new DesktopShutdownGate(),ipc=new ShutdownAwareIpcMain({handle:(name,listener)=>listeners.set(name,listener)},gate,authorize);
 registerMaterialAccessIpc(ipc,bindings);
 const invoke=()=>listeners.get('desktop:'+selected)!({sender,senderFrame:frame} as never,...args[selected]!);
 return {args,outputs,selected,invoke,gate,getEffects:()=>effects,getReads:()=>reads,release:()=>release(outputs[selected])};
}
for(const method of methods) for(const style of ['plain-sync','plain-async','held-native','own-then','bad-constructor','witness-species'] as const) it(method+' actual registrar/physical-token '+style,async()=>{
 const f=fixture(style,method);
 expect(captureMaterialAccessInput(method,f.args[method]!)).toEqual(f.args[method]);
 assertMaterialAccessEnvironment(); // Real module witness in the normal environment.
 if(style==='witness-species'){
  const before=Object.getOwnPropertyDescriptor(Promise,Symbol.species)!;let speciesReads=0,pending:unknown;
  try{Object.defineProperty(Promise,Symbol.species,{configurable:true,get(){speciesReads++;return Promise;}});pending=f.invoke();}
  finally{Object.defineProperty(Promise,Symbol.species,before);}
  await expect(pending).rejects.toThrow('material_access_projection_unavailable');
  expect(speciesReads).toBe(0);expect(f.getEffects()).toBe(0);expect(f.gate.outstanding).toBe(0);return;
 }
 const pending=f.invoke();
 if(style==='held-native'){try{expect(f.gate.outstanding).toBe(1);f.gate.close();expect(await f.gate.drain(1)).toBe(false);}finally{f.release();}}
 if(style==='bad-constructor')await expect(pending).rejects.toThrow('material_access_projection_unavailable');
 else await expect(pending).resolves.toEqual(f.outputs[method]);
 expect(f.getReads()).toBe(0);expect(f.getEffects()).toBe(1);expect(f.gate.outstanding).toBe(0);
});
