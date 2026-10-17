import {dialog,type BrowserWindow} from 'electron';
import {lstat,stat} from 'node:fs/promises';
import {basename,dirname,isAbsolute} from 'node:path';
import {assertPublishedArtifactPath} from '../../src/runtime/verification/published-artifact-selection.js';
import type {ArtifactExportFileIdentity} from './artifact-export-process.js';
interface PickerInput {
 window:BrowserWindow;requestSource:'user'|'agent'|'scheduler';suggestedName:string;
 labels:Readonly<{title:string;message:string;buttonLabel:string}>;
 signal:AbortSignal;assertCurrent():void;
}
interface NativePicker {closing:boolean;removeUnload?:()=>void;removeClose?:()=>void;closeFailures:unknown[]}
const nativePickers=new Map<BrowserWindow,NativePicker>();
/** Only the real app shutdown owner calls this after synchronously closing its
 * admission gate. close() cancels the sheet; destroy() must wait for its promise. */
export function deferLoopArtifactPickerWindowDestroy(window:BrowserWindow):boolean {
 const picker=nativePickers.get(window);if(!picker)return false;if(picker.closing)return true;picker.closing=true;
 try{const retain=(event:{preventDefault():void})=>event.preventDefault();window.on('close',retain);picker.removeClose=()=>{window.removeListener('close',retain);};}catch(error){picker.closeFailures.push(error);}
 try{
  const contents=window.webContents,allow=(event:{preventDefault():void})=>event.preventDefault();
  contents.on('will-prevent-unload',allow);picker.removeUnload=()=>{contents.removeListener('will-prevent-unload',allow);};
 }catch(error){picker.closeFailures.push(error);}
 try{window.hide();}catch(error){picker.closeFailures.push(error);}
 try{window.close();}catch(error){picker.closeFailures.push(error);}
 // A thrown/vetoed close is not settlement. Keep the window and gate owner
 // until the actual native promise ends; never fall back to premature destroy.
 return true;
}
export interface LoopArtifactDestination {readonly parent:string;readonly parentIdentity:Readonly<ArtifactExportFileIdentity>;readonly targetName:string}
/** Fixed Main UI adapter only. The helper must still establish its own held,
 * no-follow directory identity before any durable prepare/create handshake. */
export async function pickLoopArtifactDestination(input:PickerInput):Promise<Readonly<LoopArtifactDestination>|null>{
 if(input.requestSource!=='user')throw Error('loop_export_picker_source');
 const {window,signal}=input,current=input.assertCurrent.bind(input),destroyed=window.isDestroyed.bind(window);
 if(!(signal instanceof AbortSignal))throw Error('loop_export_picker_signal');
 assertPublishedArtifactPath(input.suggestedName);const defaultPath=basename(input.suggestedName),labels={...input.labels},pending:NativePicker={closing:false,closeFailures:[]};
 function check(){
  signal.throwIfAborted();if(pending.closing||destroyed())throw Error('loop_export_picker_closed',{cause:pending.closeFailures.length?new AggregateError(pending.closeFailures):undefined});
  const result:unknown=current();if(result!==undefined){void Promise.resolve(result).catch(()=>{});throw Error('loop_export_picker_current_sync');}
  signal.throwIfAborted();if(destroyed())throw Error('loop_export_picker_closed');
 }
 check();if(nativePickers.has(window))throw Error('loop_export_picker_busy');nativePickers.set(window,pending);
 // Electron 39 has no AbortSignal option for SaveDialog. Keep ownership until
 // the actual promise settles; an abort never certifies that the UI has closed.
 let result:Electron.SaveDialogReturnValue;
 try{result=await dialog.showSaveDialog(window,{defaultPath,...labels,properties:['showOverwriteConfirmation','dontAddToRecent'],securityScopedBookmarks:false});}
 finally{
  if(nativePickers.get(window)===pending)nativePickers.delete(window);
  try{pending.removeUnload?.();}finally{try{pending.removeClose?.();}finally{if(pending.closing&&!destroyed())window.destroy();}}
 }
 check();
 if(result.canceled)return null;
 const path=result.filePath;if(typeof path!=='string'||!path||!isAbsolute(path)||path.includes('\0'))throw Error('loop_export_picker_path');
 const parent=dirname(path),targetName=basename(path);if(!targetName||['.','..'].includes(targetName))throw Error('loop_export_picker_path');
 let exists=false;try{await lstat(path);exists=true;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}check();
 if(exists)throw Error('loop_export_target_exists');
 const directory=await stat(parent,{bigint:true});check();if(!directory.isDirectory())throw Error('loop_export_parent_directory');
 return Object.freeze({parent,parentIdentity:Object.freeze({device:String(directory.dev),inode:String(directory.ino)}),targetName});
}
