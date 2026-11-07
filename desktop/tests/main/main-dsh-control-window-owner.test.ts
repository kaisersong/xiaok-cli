// @vitest-environment node
import {EventEmitter} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {afterEach,expect,it,vi} from 'vitest';
import {DesktopApplicationWindowOwner} from '../../electron/desktop-application-window-owner.js';
import {DesktopMultiAgentStore} from '../../electron/desktop-multi-agent-store.js';
import {createMainDshControlSource,readOriginalMainDshControl} from '../../electron/main-dsh-control-source.js';
const native=vi.hoisted(()=>({windows:[] as any[]}));
vi.mock('electron',()=>{const BrowserWindow=Object.assign(function BrowserWindow(){},{getAllWindows:()=>native.windows,fromId:(id:number)=>native.windows.find(w=>w.id===id),fromWebContents:(wc:unknown)=>native.windows.find(w=>w.webContents===wc)});const value={app:{isReady:()=>true},BrowserWindow,webContents:{fromId:(id:number)=>native.windows.map(w=>w.webContents).find(w=>w.id===id)}};return {default:value,...value};});
const disposals:Array<()=>unknown>=[];
afterEach(async()=>{for(const close of disposals.splice(0).reverse())try{await close();}catch{}native.windows=[];vi.restoreAllMocks();});
function window(id:number){const contents=Object.assign(new EventEmitter(),{id:id*2,session:{},mainFrame:{url:'file:///owned/index.html'},isDestroyed:()=>false,isLoadingMainFrame:()=>false});return Object.assign(new EventEmitter(),{id,webContents:contents,isDestroyed:()=>false});}
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'xiaok-dsh-window-owner-')),first=window(1),second=window(2);let current:ReturnType<typeof window>|null=first,boots=0,views=0;
 const owner=new DesktopApplicationWindowOwner({current:()=>current,bootstrap:async()=>{boots++;return first;},createView:async()=>{views++;current=second;native.windows=[second];return second;}});
 const scope={profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)};native.windows=[first];
 const source=createMainDshControlSource({windowOwner:owner,scope,isTrustedUrl:url=>url==='file:///owned/index.html'} as any);
 const store=new DesktopMultiAgentStore(join(root,'groups.sqlite'),{dshAdmissionSource:source});source.bindStore(store);
 disposals.push(()=>rmSync(root,{recursive:true,force:true}),()=>store.close(),()=>source.drain());
 const open=(w=first)=>source.open({sender:w.webContents,senderFrame:w.webContents.mainFrame} as any,'mandate_control',{value:1},'user');
 const read=(frame:ReturnType<typeof open>)=>readOriginalMainDshControl(source,frame.proof,store,'mandate_control',frame.bodyHash);
 return {owner,source,store,first,second,open,read,counts:()=>({boots,views}),async replace(closeOriginal=true){await owner.open();current=null;if(closeOriginal)first.emit('closed');await owner.open();}};
}
it('reuses the original Source and Store across an original application window replacement',async()=>{
 const f=fixture(),old=f.open();f.read(old).assertCurrent();await f.replace();expect(old.signal.aborted).toBe(true);expect(()=>f.read(old)).toThrow();
 const next=f.open(f.second);expect(f.read(next).storageScope.profileId).toBe('a'.repeat(64));expect(f.read(next).principalId).toBe('desktop-user:'+'a'.repeat(64));
 expect(()=>f.open(f.first)).toThrow();expect(f.counts()).toEqual({boots:1,views:1});
 expect(f.first.listenerCount('closed')).toBe(0);expect(f.first.webContents.listenerCount('did-start-navigation')).toBe(0);
 expect(f.second.listenerCount('closed')).toBe(1);next.release();
});
it('keeps a failed original listener cleanup and its exact Error tail across replacement',async()=>{
 const f=fixture();let release!:()=>void;const tail=new Promise<void>(yes=>{release=yes;}),error=Error('original off failed');Object.defineProperty(error,Symbol('tail'),{value:tail});
 const original=f.first.webContents.off;f.first.webContents.off=function(...args:Parameters<typeof original>){Reflect.apply(original,this,args);throw error;};
 const old=f.open();
 await f.replace();expect(()=>f.open(f.second)).toThrow(error);expect(old.signal.aborted).toBe(true);expect(f.second.listenerCount('closed')).toBe(0);
 let done=false;const drain=f.source.drain().then(()=>{done=true;},()=>{done=true;});await new Promise(yes=>setImmediate(yes));expect(done).toBe(false);
 release();await drain;expect(done).toBe(true);expect(()=>f.open(f.second)).toThrow();
});
it('does not install a replacement when an original off callback reenters Source seal',async()=>{
 const f=fixture(),original=f.first.webContents.off;f.first.webContents.off=function(...args:Parameters<typeof original>){const value=Reflect.apply(original,this,args);f.source.seal();return value;};
 const old=f.open();await f.replace();expect(()=>f.open(f.second)).toThrow();expect(old.signal.aborted).toBe(true);expect(f.second.listenerCount('closed')).toBe(0);await f.source.drain();
});
it('withdraws the old frame at the pure local gate when the original owner starts another view without a close event',async()=>{
 const f=fixture(),old=f.open();await f.replace(false);expect(()=>old.assertLocal()).toThrow();expect(old.signal.aborted).toBe(true);
 const next=f.open(f.second);f.read(next).assertCurrent();expect(()=>f.read(old)).toThrow();
});
