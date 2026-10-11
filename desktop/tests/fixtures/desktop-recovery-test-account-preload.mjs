// Test infrastructure: the three fixed recovery fixtures inherit their parent's
// isolated account home. This does not issue an OS identity or a durable grant.
import os from 'node:os';
import {syncBuiltinESMExports} from 'node:module';
import {lstatSync,realpathSync} from 'node:fs';
import {basename,dirname,isAbsolute,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isMainThread} from 'node:worker_threads';
// Native CPU workers inherit --import but have their own entry and OS identity.
// Account forwarding belongs to the fixed main-thread recovery owners only.
if(isMainThread){
if(!['darwin','linux','win32'].includes(process.platform))throw Error('test_account_platform_denied');
const nativeUserInfo=os.userInfo,nativeIdentity=nativeUserInfo();
const same=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
function canonical(input,kind){
 if(typeof input!=='string'||!isAbsolute(input))throw Error('test_account_path_required');
 const stat=lstatSync(input),path=realpathSync(input);
 if(stat.isSymbolicLink()||!same(resolve(input),path)||!(kind==='directory'?stat.isDirectory():stat.isFile()))throw Error('test_account_path_denied');
 if(process.platform!=='win32'&&stat.uid!==nativeIdentity.uid)throw Error('test_account_owner_denied');
 return path;
}
const entries=[
 ['desktop-post-seal-owner.ts',/^(?:xiaok-post-seal-process-|xiaok-post-seal-recovery-adversarial-seed-|xiaok-post-seal-host-authority-seed-|xiaok-post-seal-ready-|xiaok-post-seal-goal-seed-)[A-Za-z0-9]{6}$/],
 ['desktop-post-seal-goal-recovery-owner.ts',/^xiaok-post-seal-goal-bdd-[A-Za-z0-9]{6}$/],
 ['desktop-source-recovery-owner.ts',/^xiaok-ma-recovery-[A-Za-z0-9]{6}$/],
];
const entry=canonical(process.argv[1],'file');
const match=entries.find(([name])=>same(entry,realpathSync(fileURLToPath(new URL('./'+name,import.meta.url)))));
if(!match)throw Error('test_account_entry_denied');
const root=canonical(process.argv[2],'directory'),accountRoot=canonical(process.argv[4],'directory'),home=canonical(process.argv[5],'directory');
const temp=realpathSync(os.tmpdir());
if(!same(dirname(root),temp)||!match[1].test(basename(root))
 ||!same(dirname(accountRoot),temp)||!/^xiaok-vitest-accounts-[A-Za-z0-9]{6}$/.test(basename(accountRoot))
 ||!same(dirname(home),accountRoot)||!/^account-[A-Za-z0-9]{6}$/.test(basename(home))
 ||same(home,realpathSync(nativeIdentity.homedir)))throw Error('test_account_namespace_denied');
os.userInfo=options=>{const info=nativeUserInfo(options);return {...info,homedir:Buffer.isBuffer(info.homedir)?Buffer.from(home):home};};
syncBuiltinESMExports();
}
