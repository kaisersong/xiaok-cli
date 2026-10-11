import type {BrowserWindow} from 'electron';

export function createLoopPublicationIpcAuthorizer(options:{window?:BrowserWindow;getWindow():BrowserWindow|null;isTrustedUrl(url:string):boolean}){
 return (raw:unknown):boolean=>{
  const current=options.getWindow(),original=options.window??current;
  if(!raw||typeof raw!=='object'||!original||current!==original||original.isDestroyed())return false;
  const event=raw as {sender?:unknown;senderFrame?:unknown};
  return event.sender===original.webContents&&event.senderFrame===original.webContents.mainFrame&&options.isTrustedUrl(original.webContents.mainFrame.url);
 };
}
export {registerLoopPublicationIpc} from './loop-publication-typed-ipc.js';
