import {setProfileTestHome} from '../../support/profile-home-env.js';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mkdirSync,mkdtempSync,realpathSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const account=vi.hoisted(()=>({home:'',uid:0,ownerUid:undefined as number|undefined}));
// Only OS account/ownership observations are virtualized. File IO, locks,
// source registration, serialization and the persistent fence are production.
vi.mock('node:os',async load=>{
 const actual=await load<typeof import('node:os')>();
 return {...actual,userInfo:()=>({...actual.userInfo(),homedir:account.home,uid:account.uid})};
});
vi.mock('node:fs',async load=>{
 const actual=await load<typeof import('node:fs')>();
 const remap=<T extends {uid:number|bigint}>(stat:T):T=>{
  const uid=account.ownerUid??account.uid;
  stat.uid=typeof stat.uid==='bigint'?BigInt(uid):uid;
  return stat;
 };
 return {...actual,
  lstatSync:((...args:Parameters<typeof actual.lstatSync>)=>remap(actual.lstatSync(...args)!)) as typeof actual.lstatSync,
  fstatSync:((...args:Parameters<typeof actual.fstatSync>)=>remap(actual.fstatSync(...args))) as typeof actual.fstatSync,
 };
});
vi.mock('../../../src/runtime/verification/migration-markers.js',()=>({readInstalledCurrentProfile:()=>({kind:'ordinary'})}));
import {FileSessionStore} from '../../../src/ai/runtime/session-store/file-store.js';
import {AgentSessionState} from '../../../src/ai/runtime/session.js';
import {createKnownDirectoryWriterFence} from '../../../src/runtime/verification/known-directory-writer-fence.js';

let root:string;
beforeEach(()=>{
 root=realpathSync(mkdtempSync(join(tmpdir(),'known-root-writer-')));
 account.home=join(root,'account');account.uid=0;account.ownerUid=undefined;
 mkdirSync(account.home,{mode:0o700});setProfileTestHome(account.home);
 vi.spyOn(process,'platform','get').mockReturnValue('linux');
 vi.spyOn(process,'getuid').mockReturnValue(0);
 vi.spyOn(process,'geteuid').mockReturnValue(0);
});
afterEach(()=>{vi.restoreAllMocks();rmSync(root,{recursive:true,force:true});});

it.each([0,1001])('saves and reloads a first K3 session as UID %i, then preserves durable fence rejection',async uid=>{
 account.uid=uid;vi.mocked(process.getuid!).mockReturnValue(uid);vi.mocked(process.geteuid!).mockReturnValue(uid);
 const directory=join(account.home,'.xiaok','sessions'),store=new FileSessionStore(directory);
 const original={...new AgentSessionState().exportSnapshot(),sessionId:'first-kimi',cwd:root,model:'k3'};
 await store.save(original);
 await store.save({...original,updatedAt:original.updatedAt+1});
 expect(await store.load('first-kimi')).toMatchObject({sessionId:'first-kimi',model:'k3'});
 const path=join(directory,'first-kimi.json'),before=readFileSync(path);
 await store.fenceKnownWriter('user');
 await expect(new FileSessionStore(directory).save(original)).rejects.toThrow('known_writer_fence_fenced');
 expect(readFileSync(path)).toEqual(before);
 expect(await store.load('first-kimi')).toMatchObject({sessionId:'first-kimi'});
});

it.each([undefined,-1,NaN,0.5,Number.MAX_SAFE_INTEGER+1])('rejects invalid real UID %s at the user boundary',uid=>{
 vi.mocked(process.getuid!).mockReturnValue(uid as number);
 expect(()=>createKnownDirectoryWriterFence(root,'session-root').assertOpen()).toThrow('known_writer_fence_user');
});

it.each(['effective','account'] as const)('rejects a root %s UID mismatch',kind=>{
 if(kind==='effective')vi.mocked(process.geteuid!).mockReturnValue(1001);else account.uid=1001;
 expect(()=>createKnownDirectoryWriterFence(root,'session-root').assertOpen()).toThrow('known_writer_fence_user');
});

it('still rejects a root home owned by another UID',()=>{
 account.ownerUid=1001;
 expect(()=>createKnownDirectoryWriterFence(root,'session-root').assertOpen()).toThrow('known_writer_fence_directory');
});
