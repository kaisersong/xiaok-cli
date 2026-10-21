import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {chmodSync,mkdirSync,mkdtempSync,realpathSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const boundary=vi.hoisted(()=>({home:''}));
vi.mock('node:os',async load=>{const actual=await load<typeof import('node:os')>();return {...actual,userInfo:()=>({...actual.userInfo(),homedir:boundary.home})};});
vi.mock('../../../src/runtime/verification/migration-markers.js',()=>({readInstalledCurrentProfile:()=>({kind:'ordinary'})}));
import {FileGoalStore} from '../../../src/runtime/goal/file-store.js';
import {createGoalState} from '../../../src/runtime/goal/reducer.js';
let root:string;
beforeEach(()=>{root=realpathSync(mkdtempSync(join(tmpdir(),'known-goal-fence-')));boundary.home=join(root,'account');mkdirSync(boundary.home,{mode:0o750});chmodSync(boundary.home,0o750);mkdirSync(join(boundary.home,'.xiaok'),{mode:0o755});chmodSync(join(boundary.home,'.xiaok'),0o755);mkdirSync(join(boundary.home,'.xiaok/profile-sources'),{mode:0o700});});
afterEach(()=>rmSync(root,{recursive:true,force:true}));
type Fencable={fenceKnownWriter(source:'user'|'agent'|'scheduler'):Promise<void>};
it('persists the original goal writer fence and rejects actual fresh CAS after owner reconstruction while preserving complete original bytes',async()=>{
 const directory=join(root,'goal-source'),store=new FileGoalStore(directory),state=createGoalState({sessionId:'goal-session',objective:'original',expectedEvidenceKinds:['answer'],now:1});await store.commit({sessionId:'goal-session',expectedRevision:null,next:state,events:[],turns:[],evidence:[]});const file=join(directory,'goal-session.goal.json'),before=readFileSync(file);
 const fence=(store as unknown as Fencable).fenceKnownWriter;expect(fence).toBeTypeOf('function');await fence.call(store,'user');expect(readdirSync(join(boundary.home,'.xiaok/profile-sources/writer-fences')).filter(name=>name.endsWith('.json'))).toHaveLength(1);
 const restarted=new FileGoalStore(directory);expect((await restarted.load('goal-session'))!.state).toEqual(state);await expect(restarted.commit({sessionId:'goal-session',expectedRevision:state.revision,next:{...state,revision:state.revision+1,objective:'forbidden'},events:[],turns:[],evidence:[]})).rejects.toThrow(/fenc/i);expect(readFileSync(file)).toEqual(before);
});

it('waits original goal IO and rejects new admission when fencing reenters the real atomic write callback',async()=>{
 const {writeFileAtomicallySync}=await import('../../../src/utils/atomic-file.js');const directory=join(root,'reentrant');let fencing:Promise<void>|undefined,settled=false;const store=new FileGoalStore(directory,(path,data,options)=>{fencing=(store as unknown as Fencable).fenceKnownWriter('user');void fencing.then(()=>settled=true,()=>settled=true);expect(settled).toBe(false);writeFileAtomicallySync(path,data,options);});const state=createGoalState({sessionId:'entered-goal',objective:'accepted',expectedEvidenceKinds:['answer'],now:1});await store.commit({sessionId:'entered-goal',expectedRevision:null,next:state,events:[],turns:[],evidence:[]});expect(fencing).toBeDefined();await fencing;await expect(store.commit({sessionId:'entered-goal',expectedRevision:1,next:{...state,revision:2},events:[],turns:[],evidence:[]})).rejects.toThrow('closed');expect((await store.load('entered-goal'))!.state.objective).toBe('accepted');
});

it('rejects non-user, borrowed owner and unsupported Goal fence before closing admission or touching fence metadata',async()=>{
 const store=new FileGoalStore(join(root,'authorized')),state=createGoalState({sessionId:'authorized',objective:'original',expectedEvidenceKinds:['answer'],now:1});await store.commit({sessionId:'authorized',expectedRevision:null,next:state,events:[],turns:[],evidence:[]});for(const source of ['agent','scheduler'] as const)await expect(store.fenceKnownWriter(source)).rejects.toThrow('request_source');await expect(Reflect.apply(store.fenceKnownWriter,store,['user','extra'])).rejects.toThrow('owner');let read=false;await expect(store.fenceKnownWriter.call({get rootDir(){read=true;return root;}} as unknown as FileGoalStore,'user')).rejects.toThrow('owner');expect(read).toBe(false);const platform=vi.spyOn(process,'platform','get').mockReturnValue('win32');try{await expect(store.fenceKnownWriter('user')).rejects.toThrow('platform');}finally{platform.mockRestore();}await store.commit({sessionId:'authorized',expectedRevision:state.revision,next:{...state,revision:state.revision+1},events:[],turns:[],evidence:[]});expect(readdirSync(join(boundary.home,'.xiaok/profile-sources'))).not.toContain('writer-fences');
});
