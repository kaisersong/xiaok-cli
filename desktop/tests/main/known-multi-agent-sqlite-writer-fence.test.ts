// @vitest-environment node
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mkdirSync,mkdtempSync,realpathSync,readFileSync,readdirSync,rmSync,existsSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const fixture=vi.hoisted(()=>({home:'',denyAccount:false,reads:0}));
vi.mock('node:os',async load=>{const actual=await load<typeof import('node:os')>();return {...actual,userInfo:()=>{fixture.reads++;if(fixture.denyAccount)throw Error('unexpected_account_locator');return {...actual.userInfo(),homedir:fixture.home};}};});
vi.unmock('../../../src/runtime/verification/ordinary-source-writer-observation.js');
vi.mock('../../../src/runtime/verification/migration-markers.js',()=>({readInstalledCurrentProfile:()=>({kind:'ordinary'})}));
import {DesktopMultiAgentStore} from '../../electron/desktop-multi-agent-store.js';
import {createKnownDirectoryWriterFence} from '../../../src/runtime/verification/known-directory-writer-fence.js';
let root:string;const stores:DesktopMultiAgentStore[]=[];
beforeEach(()=>{root=realpathSync(mkdtempSync(join(tmpdir(),'known-multiagent-sqlite-')));fixture.home=join(root,'account');fixture.denyAccount=false;fixture.reads=0;mkdirSync(fixture.home,{mode:0o750});mkdirSync(join(fixture.home,'.xiaok'),{mode:0o755});mkdirSync(join(fixture.home,'.xiaok','profile-sources'),{mode:0o700});});
afterEach(()=>{for(const store of stores.splice(0).reverse())store.close();rmSync(root,{recursive:true,force:true});});
function open(path:string,options:ConstructorParameters<typeof DesktopMultiAgentStore>[1]={}){const store=new DesktopMultiAgentStore(path,options);stores.push(store);return store;}
function seeded(){const directory=join(root,'groups'),path=join(directory,'groups.db'),store=open(path);store.registerThread({threadId:'thread',profileId:'profile',workspaceId:'workspace',cwd:root});const group=store.createGroup('thread');return {directory,path,store,group};}
const fence=(dir:string)=>createKnownDirectoryWriterFence(dir,'sqlite-db').persist();
function files(path:string){return Object.fromEntries(['','-wal','-shm'].filter(s=>existsSync(path+s)).map(s=>[s,{bytes:readFileSync(path+s),inode:statSync(path+s).ino}]));}
const publicMethods=["claimBootOwnership", "settleBootOwnership", "reconcileAgentResources", "transaction", "registerThread", "initializeWorkspaceAuthorization", "compareAndSetWorkspaceAuthorization", "beginThreadDeletion", "updateThreadDeletion", "deleteThreadHistory", "createGroup", "putGroup", "clearActiveGroup", "putAgent", "appendEvent", "createActivityRun", "putActivityMember", "confirmActivityRootTerminal", "markActivityRunUnknown", "finalizeActivityRun", "sendMessage", "rerouteClosedHandoffs", "drainInput", "confirmApplied", "returnClaim", "putContent", "deleteUnreferencedContent", "reservePresentationOrdinal", "reserveManagedFollowupTurn", "putOperation", "commitApprovalRequest", "finalizeApproval", "putRootBinding", "putResource", "recoverPreviousBoot"],privateMethods=["finalizeApprovalRecord", "updateApprovalCount", "recoverApprovalRequests", "repairByteUsage", "putMessage", "write", "applySchema", "validateSchema"];
type Port={putGroup:DesktopMultiAgentStore['putGroup'];putAgent:DesktopMultiAgentStore['putAgent'];appendEvent:DesktopMultiAgentStore['appendEvent'];registerThread:DesktopMultiAgentStore['registerThread'];transaction<T>(action:(port:Port)=>T):T};
function transaction<T>(store:DesktopMultiAgentStore,action:(port:Port)=>T):T{return (store as unknown as {transaction<T>(action:(port:Port)=>T):T}).transaction(action);}
it('denies actual cached direct thread writes and transaction mutations after lowerlevel persistent target while retaining bytes and reads',()=>{
 const f=seeded(),original=f.store.getThread('thread'),before=files(f.path);fence(f.directory);expect(()=>f.store.registerThread({threadId:'new',profileId:'profile',workspaceId:'workspace',cwd:root})).toThrow('fenced');expect(()=>f.store.putGroup({...f.group,lastSeq:f.group.lastSeq})).toThrow('fenced');expect(f.store.getThread('new')).toBeNull();expect(f.store.getThread('thread')).toEqual(original);expect(files(f.path)).toEqual(before);
});
it('denies all35 real owner public entry points before DTO access after actual publication',()=>{
 const f=seeded();fence(f.directory);const before=files(f.path);let reads=0;const raw=new Proxy({}, {get(){reads++;throw Error('unexpected_input');}}),actual=f.store as unknown as Record<string,(...args:unknown[])=>unknown>,failures=[];for(const name of publicMethods){try{actual[name](raw,raw);failures.push([name,'unexpected success']);}catch(error){failures.push([name,String(error)]);}}expect(failures).toEqual(publicMethods.map(name=>[name,expect.stringContaining('fenced')]));expect(reads).toBe(0);expect(files(f.path)).toEqual(before);
});
it('denies all35public8private borrowed owners before any this/input getters',()=>{
 let reads=0;const fake=new Proxy({}, {get(){reads++;throw Error('unexpected_owner');}}),raw=new Proxy({}, {get(){reads++;throw Error('unexpected_input');}}),prototype=DesktopMultiAgentStore.prototype as unknown as Record<string,(...args:unknown[])=>unknown>,names=[...publicMethods,...privateMethods],failures=[];for(const name of names){try{prototype[name].call(fake,raw,raw);failures.push([name,'unexpected success']);}catch(error){failures.push([name,String(error)]);}}expect(failures).toEqual(names.map(name=>[name,expect.stringContaining('owner')]));expect(reads).toBe(0);
});
it('denies reconstructed and same-directory alternate database names before opening native databases',()=>{
 const f=seeded();fence(f.directory);const before=files(f.path),alternate=join(f.directory,'another.db');expect(()=>open(f.path)).toThrow('fenced');expect(()=>open(alternate)).toThrow('fenced');expect(existsSync(alternate)).toBe(false);expect(files(f.path)).toEqual(before);
});
it('keeps a genuine admitted callback port tail after real publication and rejects public reentry',()=>{
 const f=seeded();let accepted!:Port;transaction(f.store,port=>{expect(port).toBeDefined();accepted=port;expect(Object.isFrozen(port)).toBe(true);fence(f.directory);expect(()=>f.store.putGroup(f.group)).toThrow('fenced');port.putGroup({...f.group,lastSeq:f.group.lastSeq});port.registerThread({threadId:'accepted',profileId:'profile',workspaceId:'workspace',cwd:root});});expect(f.store.getThread('accepted')?.threadId).toBe('accepted');expect(()=>accepted.registerThread({threadId:'expired',profileId:'profile',workspaceId:'workspace',cwd:root})).toThrow(/port|owner|expired/);expect(f.store.getThread('expired')).toBeNull();
});
it('brands port method receivers before DTO getters and refuses copied or rewritten methods',()=>{
 const f=seeded();let reads=0;transaction(f.store,port=>{expect(port).toBeDefined();const method=port.registerThread,raw=new Proxy({}, {get(){reads++;throw Error('unexpected_input');}});expect(()=>method.call({} as Port,raw as never)).toThrow(/port|owner/);expect(()=>method.call({...port},raw as never)).toThrow(/port|owner/);expect(()=>Reflect.set(port,'registerThread',()=>{})).not.toThrow();expect(Reflect.set(port,'registerThread',()=>{})).toBe(false);expect(Object.hasOwn(port,'registerThread')).toBe(true);});expect(reads).toBe(0);
});
it('seals leaked callback ports before actual postcommit subscribers and prevents revival in later or nested transactions',()=>{
 const f=seeded();let leaked!:Port,calls=0;const listenerErrors:string[]=[];const stop=f.store.subscribe(()=>{calls++;try{leaked.registerThread({threadId:'listener',profileId:'profile',workspaceId:'workspace',cwd:root});listenerErrors.push('unexpected_success');}catch(error){listenerErrors.push(String(error));}});transaction(f.store,port=>{expect(port).toBeDefined();leaked=port;port.appendEvent(f.group.groupId,{kind:'cleanup',agentId:'root_'+f.group.groupId,payload:{actual:'event'}});});expect(calls).toBe(1);expect(listenerErrors).toEqual([expect.stringMatching(/port|owner|expired/)]);expect(f.store.getThread('listener')).toBeNull();transaction(f.store,port=>{expect(()=>leaked.registerThread({threadId:'later',profileId:'profile',workspaceId:'workspace',cwd:root})).toThrow(/port|owner|expired/);port.transaction(nested=>{expect(nested).not.toBe(port);expect(()=>leaked.registerThread({threadId:'nested',profileId:'profile',workspaceId:'workspace',cwd:root})).toThrow(/port|owner|expired/);});});stop();
});
for(const exit of ['throw','thenable'] as const)it(`seals an accepted callback port immediately on ${exit} while retaining original rollback`,()=>{
 const f=seeded(),failure=Error('original_body_failed');let port!:Port;const run=()=>transaction(f.store,current=>{expect(current).toBeDefined();port=current;current.registerThread({threadId:'rolled',profileId:'profile',workspaceId:'workspace',cwd:root});if(exit==='throw')throw failure;return Promise.resolve('forbidden');});expect(run).toThrow(exit==='throw'?failure:'synchronous');expect(()=>port.registerThread({threadId:'expired',profileId:'profile',workspaceId:'workspace',cwd:root})).toThrow(/port|owner|expired/);expect(f.store.getThread('rolled')).toBeNull();
});

for(const path of [':memory:',''])it(`retains actual ${JSON.stringify(path)} ephemeral writes and reads without a durable locator`,()=>{
 fixture.denyAccount=true;fixture.reads=0;const store=open(path);store.registerThread({threadId:'ephemeral',profileId:'profile',workspaceId:'workspace',cwd:root});const group=store.createGroup('ephemeral');expect(store.getGroup(group.groupId)?.groupId).toBe(group.groupId);expect(fixture.reads).toBe(0);expect(readdirSync(join(fixture.home,'.xiaok','profile-sources'))).toEqual([]);
});
it('retains the original Windows writer branch without added POSIX account lookup',()=>{
 fixture.denyAccount=true;fixture.reads=0;const platform=vi.spyOn(process,'platform','get').mockReturnValue('win32');try{const store=open(join(root,'windows','groups.db'));store.registerThread({threadId:'windows',profileId:'profile',workspaceId:'workspace',cwd:root});expect(store.getThread('windows')?.threadId).toBe('windows');expect(fixture.reads).toBe(0);}finally{platform.mockRestore();}
});
it('does not let a genuine other-owner port inherit a borrowed method or read its DTO',()=>{
 const first=seeded(),second=open(join(root,'second','groups.db'));let reads=0;transaction(first.store,left=>transaction(second,right=>{const raw=new Proxy({}, {get(){reads++;throw Error('unexpected_input');}});expect(()=>left.registerThread.call(right,raw as never)).toThrow(/port|owner/);}));expect(reads).toBe(0);
});
it('expires the callback port before the original thenable getter and rolls back accepted writes',()=>{
 const f=seeded();let port!:Port,seen=0;expect(()=>transaction(f.store,current=>{port=current;current.registerThread({threadId:'rolled',profileId:'profile',workspaceId:'workspace',cwd:root});return {get then(){seen++;expect(()=>port.registerThread({threadId:'then-getter',profileId:'profile',workspaceId:'workspace',cwd:root})).toThrow(/port|owner|expired/);return ()=>{};}};})).toThrow('synchronous');expect(seen).toBe(1);expect(f.store.getThread('rolled')).toBeNull();expect(f.store.getThread('then-getter')).toBeNull();
});
it('settles the actual original nested writer body when its production clock publishes the target after BEGIN',()=>{
 const directory=join(root,'clock'),path=join(directory,'groups.db');let armed=false,published=0;const store=open(path,{now:()=>{if(armed&&!published++){fence(directory);}return Date.now();}});store.registerThread({threadId:'clock',profileId:'profile',workspaceId:'workspace',cwd:root});armed=true;const group=store.createGroup('clock');expect(published).toBeGreaterThan(0);expect(store.getGroup(group.groupId)?.groupId).toBe(group.groupId);expect(store.getAgent(group.groupId,'root_'+group.groupId)?.id).toBe('root_'+group.groupId);expect(()=>store.registerThread({threadId:'new',profileId:'profile',workspaceId:'workspace',cwd:root})).toThrow('fenced');
});
