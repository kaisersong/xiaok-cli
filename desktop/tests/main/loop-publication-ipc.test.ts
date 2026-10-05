import {expect,it,vi} from 'vitest';
import {registerLoopPublicationIpc,createLoopPublicationIpcAuthorizer} from '../../electron/loop-publication-ipc.js';
it('checks exact Main window, sender, main frame and trusted URL before every operation',async()=>{
 const frame={url:'app://trusted'},sender={mainFrame:frame},window={webContents:sender,isDestroyed:()=>false};let current:any=window;
 const authorize=createLoopPublicationIpcAuthorizer({window:window as any,getWindow:()=>current,isTrustedUrl:url=>url==='app://trusted'});
 const good={sender,senderFrame:frame};expect(authorize(good)).toBe(true);
 for(const event of [{sender:{},senderFrame:frame},{sender,senderFrame:{url:frame.url}},{sender}])expect(authorize(event)).toBe(false);
 frame.url='https://untrusted';expect(authorize(good)).toBe(false);frame.url='app://trusted';current={...window};expect(authorize(good)).toBe(false);current=window;window.isDestroyed=()=>true;expect(authorize(good)).toBe(false);
});
it('dispatches only semantic methods with fixed user and rejects source injection/extra arguments',async()=>{
 const handlers=new Map<string,Function>(),service={getConfiguration:vi.fn(()=>null),getState:vi.fn(()=>({historyOnly:true})),perform:vi.fn(async()=>({kind:'inspect'}))};let allowed=true;
 registerLoopPublicationIpc({handle:(name,fn)=>{handlers.set(name,fn);}},service as any,()=>allowed);
 const perform=handlers.get('desktop:loops:performPublicationAction')!;
 await perform({}, {kind:'inspect',runId:'run'});expect(service.perform).toHaveBeenCalledWith({kind:'inspect',runId:'run',requestSource:'user'});
 expect(()=>perform({}, {kind:'inspect',runId:'run',requestSource:'scheduler'})).toThrow();expect(()=>perform({}, {kind:'inspect',runId:'run'},'extra')).toThrow();
 allowed=false;expect(()=>perform({}, {kind:'inspect',runId:'run'})).toThrow();expect(()=>handlers.get('desktop:loops:getPublicationState')!({},'run')).toThrow();expect(service.perform).toHaveBeenCalledTimes(1);
});
it('allows a replacement Main view while rejecting retained events from the original view',()=>{const make=()=>({webContents:{mainFrame:{url:'app://trusted'}},isDestroyed:()=>false});const first=make(),second=make();let current=first;const authorize=createLoopPublicationIpcAuthorizer({getWindow:()=>current as any,isTrustedUrl:url=>url==='app://trusted'});const event=(w:typeof first)=>({sender:w.webContents,senderFrame:w.webContents.mainFrame});expect(authorize(event(first))).toBe(true);current=second;expect(authorize(event(first))).toBe(false);expect(authorize(event(second))).toBe(true);});
