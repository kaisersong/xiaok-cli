import type {BrowserWindow} from 'electron';
import type {IpcHandleRegistrar} from './shutdown-aware-ipc-main.js';
import type {DesktopLoopPublicationService} from './loop-desktop-publication-service.js';
import {captureExecutionValue,executionIdentity} from './loop-verification-execution.js';
import type {LoopPublicationAction} from '../shared/loop-publication-types.js';

export function createLoopPublicationIpcAuthorizer(options:{window?:BrowserWindow;getWindow():BrowserWindow|null;isTrustedUrl(url:string):boolean}){
 return (raw:unknown):boolean=>{
  const current=options.getWindow(),original=options.window??current;
  if(!raw||typeof raw!=='object'||!original||current!==original||original.isDestroyed())return false;
  const event=raw as {sender?:unknown;senderFrame?:unknown};
  return event.sender===original.webContents&&event.senderFrame===original.webContents.mainFrame&&options.isTrustedUrl(original.webContents.mainFrame.url);
 };
}
/** Only this fixed Main renderer ingress can label a request as user sourced. */
export function registerLoopPublicationIpc(ipc:IpcHandleRegistrar,service:DesktopLoopPublicationService,authorize:(event:unknown)=>boolean):void{
 function check(event:unknown,args:unknown[]){if(!authorize(event))throw Error('loop_publication_ipc_denied');if(args.length!==1)throw Error('loop_publication_ipc_input');}
 ipc.handle('desktop:loops:getPublicationConfiguration',(event,...args)=>{check(event,args);executionIdentity(args[0]);return service.getConfiguration(args[0]);});
 ipc.handle('desktop:loops:getPublicationState',(event,...args)=>{check(event,args);executionIdentity(args[0]);return service.getState(args[0]);});
 ipc.handle('desktop:loops:performPublicationAction',(event,...args)=>{
  check(event,args);const input=captureExecutionValue(args[0]);
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.hasOwn(input,'requestSource'))throw Error('loop_publication_ipc_input');
  return service.perform({...input as LoopPublicationAction,requestSource:'user'});
 });
}
