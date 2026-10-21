// @vitest-environment node
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mkdtempSync,realpathSync,rmSync,readdirSync,statSync,writeFileSync,mkdirSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {BrowserWindow} from 'electron';
import {EventEmitter} from 'node:events';
import * as picker from '../../electron/loop-artifact-save-picker.js';
import {DesktopShutdownCoordinator} from '../../electron/desktop-shutdown-coordinator.js';
import {DesktopShutdownGate} from '../../electron/shutdown-aware-ipc-main.js';
vi.mock('electron',()=>({dialog:{showSaveDialog:vi.fn()}}));
import {dialog} from 'electron';
import {pickLoopArtifactDestination} from '../../electron/loop-artifact-save-picker.js';
const show=vi.mocked(dialog.showSaveDialog);let root:string;
beforeEach(()=>{root=realpathSync(mkdtempSync(join(tmpdir(),'loop-picker-')));show.mockReset();});
afterEach(()=>rmSync(root,{recursive:true,force:true,maxRetries:4}));
function input(){const controller=new AbortController(),isDestroyed=vi.fn(()=>false),hide=vi.fn(),close=vi.fn(),destroy=vi.fn(()=>{isDestroyed.mockReturnValue(true);}),webContents=new EventEmitter(),windowEvents=new EventEmitter(),window={isDestroyed,hide,close,destroy,webContents,on:windowEvents.on.bind(windowEvents),removeListener:windowEvents.removeListener.bind(windowEvents)} as unknown as BrowserWindow,current=vi.fn(()=>{});
 return {controller,isDestroyed,current,hide,close,destroy,webContents,windowEvents,options:{window,requestSource:'user' as 'user'|'agent'|'scheduler',suggestedName:'reports/original.bin',labels:{title:'Save verified artifact',message:'Choose a new file; existing files cannot be replaced.',buttonLabel:'Save'},signal:controller.signal,assertCurrent:current}};
}
it('uses the actual native choice and real parent identity without writing a file',async()=>{
 const f=input(),filePath=join(root,'chosen.bin');show.mockResolvedValue({canceled:false,filePath});const result=await pickLoopArtifactDestination(f.options),parent=statSync(root,{bigint:true});
 expect(result).toEqual({parent:root,parentIdentity:{device:String(parent.dev),inode:String(parent.ino)},targetName:'chosen.bin'});expect(Object.isFrozen(result)).toBe(true);expect(Object.isFrozen(result?.parentIdentity)).toBe(true);
 expect(show).toHaveBeenCalledWith(f.options.window,expect.objectContaining({defaultPath:'original.bin',securityScopedBookmarks:false,properties:['showOverwriteConfirmation','dontAddToRecent']}));expect(readdirSync(root)).toEqual([]);
});
it('returns null for actual cancellation and never creates a file',async()=>{const f=input();show.mockResolvedValue({canceled:true,filePath:''});expect(await pickLoopArtifactDestination(f.options)).toBeNull();expect(readdirSync(root)).toEqual([]);});
it.each(['agent','scheduler'] as const)('rejects %s before opening any dialog',async source=>{const f=input();f.options.requestSource=source;await expect(pickLoopArtifactDestination(f.options)).rejects.toThrow('loop_export_picker_source');expect(show).not.toHaveBeenCalled();});
it.each(['file','directory','symlink'])('rejects existing %s without modifying it',async kind=>{const f=input(),filePath=join(root,'exists');if(kind==='file')writeFileSync(filePath,'keep');else if(kind==='directory')mkdirSync(filePath);else symlinkSync(join(root,'missing'),filePath);show.mockResolvedValue({canceled:false,filePath});await expect(pickLoopArtifactDestination(f.options)).rejects.toThrow('loop_export_target_exists');expect(readdirSync(root)).toEqual(['exists']);});
it.each(['relative.bin','','/has\0nul'])('rejects invalid actual picker path %s',async filePath=>{const f=input();show.mockResolvedValue({canceled:false,filePath});await expect(pickLoopArtifactDestination(f.options)).rejects.toThrow('loop_export_picker_path');expect(readdirSync(root)).toEqual([]);});
it('rejects a parent that is not a directory',async()=>{const f=input();writeFileSync(join(root,'file'),'keep');show.mockResolvedValue({canceled:false,filePath:join(root,'file','out.bin')});await expect(pickLoopArtifactDestination(f.options)).rejects.toThrow();expect(readdirSync(root)).toEqual(['file']);});
it.each(['abort','window','admission'])('waits for the actual dialog after %s then rejects a late location',async kind=>{
 const f=input();let resolve!:(v:Electron.SaveDialogReturnValue)=>void;show.mockReturnValue(new Promise(r=>{resolve=r;}));let settled=false;const work=pickLoopArtifactDestination(f.options);void work.then(()=>{settled=true;},()=>{settled=true;});
 if(kind==='abort')f.controller.abort(Error('closed'));else if(kind==='window')f.isDestroyed.mockReturnValue(true);else f.current.mockImplementation(()=>{throw Error('changed');});
 await Promise.resolve();await Promise.resolve();expect(settled).toBe(false);resolve({canceled:false,filePath:join(root,'late.bin')});await expect(work).rejects.toThrow();expect(readdirSync(root)).toEqual([]);
});
it('rejects a cancelled dialog result after the source lifetime changed',async()=>{const f=input();show.mockImplementation(async()=>{f.controller.abort(Error('closed'));return {canceled:true,filePath:''};});await expect(pickLoopArtifactDestination(f.options)).rejects.toThrow('closed');});
it('rejects asynchronous currentness checks before dialog',async()=>{const f=input();f.current.mockImplementation(async()=>{});await expect(pickLoopArtifactDestination(f.options)).rejects.toThrow('loop_export_picker_current_sync');expect(show).not.toHaveBeenCalled();});
it('preserves actual native dialog failure',async()=>{const f=input();show.mockRejectedValue(Error('native unavailable'));await expect(pickLoopArtifactDestination(f.options)).rejects.toThrow('native unavailable');expect(readdirSync(root)).toEqual([]);});
it('rejects a destroyed owner before dialog',async()=>{const f=input();f.isDestroyed.mockReturnValue(true);await expect(pickLoopArtifactDestination(f.options)).rejects.toThrow('loop_export_picker_closed');expect(show).not.toHaveBeenCalled();});

it('shutdown hides and requests native close once, retaining the actual window until dialog settlement',async()=>{
 const f=input();let resolve!:(v:Electron.SaveDialogReturnValue)=>void;show.mockReturnValue(new Promise(r=>{resolve=r;}));const work=pickLoopArtifactDestination(f.options);const outcome=work.then(()=>null,error=>error);let done=false;void outcome.then(()=>{done=true;});
 try{
  expect(picker.deferLoopArtifactPickerWindowDestroy(f.options.window)).toBe(true);expect(picker.deferLoopArtifactPickerWindowDestroy(f.options.window)).toBe(true);expect(f.hide).toHaveBeenCalledTimes(1);expect(f.close).toHaveBeenCalledTimes(1);expect(f.destroy).not.toHaveBeenCalled();
  const event={preventDefault:vi.fn()};f.webContents.emit('will-prevent-unload',event);expect(event.preventDefault).toHaveBeenCalledTimes(1);await Promise.resolve();expect(done).toBe(false);
 }finally{resolve({canceled:false,filePath:join(root,'late.bin')});}
 expect(await outcome).toBeInstanceOf(Error);expect(f.destroy).toHaveBeenCalledTimes(1);expect(f.webContents.listenerCount('will-prevent-unload')).toBe(0);expect(picker.deferLoopArtifactPickerWindowDestroy(f.options.window)).toBe(false);
});
it('does not touch a window without an actual pending native picker',()=>{const f=input();expect(picker.deferLoopArtifactPickerWindowDestroy(f.options.window)).toBe(false);expect(f.close).not.toHaveBeenCalled();expect(f.hide).not.toHaveBeenCalled();expect(f.destroy).not.toHaveBeenCalled();});
it('rejects a second native picker for the same window',async()=>{
 const f=input();let resolve!:(v:Electron.SaveDialogReturnValue)=>void;show.mockReturnValue(new Promise(r=>{resolve=r;}));const first=pickLoopArtifactDestination(f.options),second=pickLoopArtifactDestination(f.options).then(()=>null,error=>error);resolve({canceled:true,filePath:''});expect(await first).toBeNull();expect((await second)?.message).toBe('loop_export_picker_busy');expect(show).toHaveBeenCalledTimes(1);
});
it('keeps actual ownership when native close throws and only destroys after native rejection',async()=>{
 const f=input();let reject!:(e:Error)=>void;show.mockReturnValue(new Promise((_r,no)=>{reject=no;}));const work=pickLoopArtifactDestination(f.options).catch(error=>error);f.close.mockImplementation(()=>{throw Error('close failed');});
 try{expect(picker.deferLoopArtifactPickerWindowDestroy(f.options.window)).toBe(true);expect(f.destroy).not.toHaveBeenCalled();expect(picker.deferLoopArtifactPickerWindowDestroy(f.options.window)).toBe(true);expect(f.close).toHaveBeenCalledTimes(1);}finally{reject(Error('native failed'));}
 expect((await work).message).toBe('native failed');expect(f.destroy).toHaveBeenCalledTimes(1);
});
it('real shutdown gate prevents store close until the native picker actually ends',async()=>{
 const f=input(),gate=new DesktopShutdownGate(),token=gate.acquire('external','loop-output-consumer');let resolve!:(v:Electron.SaveDialogReturnValue)=>void;show.mockReturnValue(new Promise(r=>{resolve=r;}));const work=pickLoopArtifactDestination(f.options).catch(error=>error).finally(()=>token.release()),closeStore=vi.fn(async()=>{});
 const coordinator=new DesktopShutdownCoordinator({gate,providerRuntime:{beginShutdown:()=>({leases:[],waitForSettled:async()=>true}),hideAndAbortNonProtected(){},closeOrdinaryProviders:async()=>({cleanupFailed:[]})},ingressOwners:[{name:'picker',stopAccepting(){f.controller.abort(Error('shutdown'));},abortAllActive(){},drain:ms=>gate.drain(ms)}],durableStores:[{name:'store',close:closeStore}],destroyWindows(){if(!picker.deferLoopArtifactPickerWindowDestroy(f.options.window))f.destroy();},disposeLifetimeResources:async()=>{},releaseMainSourcePin:async()=>{},continuation(){}});
 let shutdown:ReturnType<DesktopShutdownCoordinator['onBeforeQuit']>|undefined;
 try{shutdown=coordinator.onBeforeQuit();expect(gate.isOpen).toBe(false);expect(f.hide).toHaveBeenCalledTimes(1);expect(f.destroy).not.toHaveBeenCalled();await Promise.resolve();expect(closeStore).not.toHaveBeenCalled();}finally{resolve({canceled:true,filePath:''});await work;}
 const report=await shutdown!.shutdown;expect(report.storesClosed).toBe(true);expect(f.destroy).toHaveBeenCalledTimes(1);expect(closeStore).toHaveBeenCalledTimes(1);
});

it('vetoes actual parent close until the native promise settles, even when close would destroy it',async()=>{
 const f=input();let resolve!:(v:Electron.SaveDialogReturnValue)=>void;show.mockReturnValue(new Promise(r=>{resolve=r;}));f.close.mockImplementation(()=>{let prevented=false;f.windowEvents.emit('close',{preventDefault(){prevented=true;}});if(!prevented)f.destroy();});const work=pickLoopArtifactDestination(f.options).catch(error=>error);
 try{expect(picker.deferLoopArtifactPickerWindowDestroy(f.options.window)).toBe(true);expect(f.destroy).not.toHaveBeenCalled();}finally{resolve({canceled:true,filePath:''});await work;}
 expect(f.destroy).toHaveBeenCalledTimes(1);expect(f.windowEvents.listenerCount('close')).toBe(0);
});
