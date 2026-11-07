import {EventEmitter} from 'node:events';
import {afterEach,expect,it,vi} from 'vitest';
import {createDefaultDispatchBusinessController} from '../../electron/default-dispatch-business-controller.js';
import {createKSwarmService,sealAndDrainKSwarmServiceInstance} from '../../electron/kswarm-service.js';
import {createKSwarmWriterControlSource} from '../../electron/kswarm-writer-control-source.js';
import {createDesktopWriterControlLaunchCapsule} from '../../electron/kswarm-writer-control-native-bootstrap.js';
const native=vi.hoisted(()=>({ready:true,windows:[] as any[]}));
vi.mock('electron',()=>({app:{isReady(){return native.ready;}},BrowserWindow:{getAllWindows(){return native.windows;},fromId(id:number){return native.windows.find(w=>w.id===id);},fromWebContents(contents:unknown){return native.windows.find(w=>w.webContents===contents);}},webContents:{fromId(id:number){return native.windows.map(w=>w.webContents).find(c=>c.id===id);}}}));
const module=()=>import('../../electron/default-dispatch-native-bootstrap.js'),scope={profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)},cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();native.windows=[];native.ready=true;});
function fixture(allowControllerFailure=false){
 const contents=Object.assign(new EventEmitter(),{id:2,session:{},mainFrame:{url:'about:blank'},isDestroyed:()=>false,isLoadingMainFrame:()=>true}),window=Object.assign(new EventEmitter(),{id:1,webContents:contents,isDestroyed:()=>false});native.windows=[window];
 const controller=createDefaultDispatchBusinessController({window:window as never,scope,isTrustedUrl:()=>false}),configuration=createKSwarmWriterControlSource({getWindow:()=>window as never,getScope:()=>scope,isTrustedUrl:()=>false});
 const service=createKSwarmService({activityOwnerPending:true,desktopProjectScope:scope,ownedBusinessAdmission:controller.businessAdmission,ownedControlAdmission:configuration.admission});controller.bindService(service);configuration.bindService(service);
 cleanups.push(async()=>{controller.seal();configuration.seal();await sealAndDrainKSwarmServiceInstance(service);await configuration.drain();try{await controller.drain();}catch(error){if(!allowControllerFailure)throw error;}});return{window,contents,controller,configuration,service};
}
it('requires the original controller and service before touching supplied bootstrap properties',async()=>{
 const {createDesktopDispatchLaunchCapsule:mint}=await module();let hooks=0;const fake=new Proxy({},{get(){hooks++;throw Error('trap');},getOwnPropertyDescriptor(){hooks++;throw Error('trap');}});expect(()=>mint(fake,fake)).toThrow();const f=fixture();expect(()=>mint(f.controller,fake)).toThrow();expect(hooks).toBe(0);
});
it('mints a distinct opaque availability capsule while loading, without a user proof or adopted launch authority',async()=>{
 const {createDesktopDispatchLaunchCapsule:mint,consumeDesktopDispatchLaunchCapsule:consume}=await module(),f=fixture(),cap=mint(f.controller,f.service);expect(Reflect.ownKeys(cap)).toEqual([]);expect(Object.getPrototypeOf(cap)).toBeNull();expect(Object.isFrozen(cap)).toBe(true);
 expect(()=>mint(f.controller,f.service)).toThrow();expect(()=>consume({...cap},{})).toThrow();expect(()=>consume(cap,{})).toThrow();expect(()=>f.controller.businessAdmission(cap,{} as never)).toThrow();
 const cfg=createDesktopWriterControlLaunchCapsule({source:f.configuration,service:f.service,window:f.window as never});expect(()=>consume(cfg,{})).toThrow();
});
it('does not consume an original capsule for a forged original launch-state or invoke its getters',async()=>{
 const {createDesktopDispatchLaunchCapsule:mint,consumeDesktopDispatchLaunchCapsule:consume}=await module(),f=fixture(),cap=mint(f.controller,f.service);let hooks=0;const state=new Proxy({},{get(){hooks++;throw Error('trap');},getOwnPropertyDescriptor(){hooks++;throw Error('trap');}});expect(()=>consume(cap,state)).toThrow();expect(hooks).toBe(0);
});
it('owns an unexpected Native session raw before failing capsule mint',async()=>{
 const {createDesktopDispatchLaunchCapsule:mint}=await module(),f=fixture(true);let release!:(value:unknown)=>void;const raw=new Promise(yes=>{release=yes;});Object.defineProperty(f.contents,'session',{configurable:true,get(){return raw;}});expect(()=>mint(f.controller,f.service)).toThrow();let done=false;const drain=f.controller.drain().then(()=>{done=true;},()=>{done=true;});
 try{await new Promise<void>(yes=>setImmediate(yes));expect(done).toBe(false);}finally{release({});await drain;}
});
it('rejects a capsule when its last Native SDK synchronously seals the original controller',async()=>{
 const {createDesktopDispatchLaunchCapsule:mint}=await module(),f=fixture(true),session=f.contents.session;let reads=0;Object.defineProperty(f.contents,'session',{configurable:true,get(){if(++reads===2)f.controller.seal();return session;}});expect(()=>mint(f.controller,f.service)).toThrow();expect(reads).toBe(2);
});
it('does not consult a Buffer length hook installed by its original Native SDK while minting the nonce',async()=>{
 const {createDesktopDispatchLaunchCapsule:mint}=await module(),f=fixture(true),previous=Object.getOwnPropertyDescriptor(Buffer.prototype,'length'),nativeLength=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype),'length')!.get!,session=f.contents.session;let hooks=0;
 Object.defineProperty(f.contents,'session',{configurable:true,get(){Object.defineProperty(Buffer.prototype,'length',{configurable:true,get(){const length=Reflect.apply(nativeLength,this,[]);if(length===32){hooks++;f.controller.seal();}return length;}});return session;}});
 try{expect(()=>mint(f.controller,f.service)).not.toThrow();expect(hooks).toBe(0);}finally{if(previous)Object.defineProperty(Buffer.prototype,'length',previous);else delete (Buffer.prototype as any).length;}
});
