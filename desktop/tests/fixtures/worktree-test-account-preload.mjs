// Test infrastructure only. Forward the parent's isolated Vitest account to
// this one real process fixture; preserve every other native OS identity field.
import os from 'node:os';
import {syncBuiltinESMExports} from 'node:module';
import {lstatSync, realpathSync} from 'node:fs';
import {basename, dirname, isAbsolute, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

if(!['darwin','linux','win32'].includes(process.platform))throw Error('test_account_platform_denied');
const nativeUserInfo=os.userInfo;
const nativeIdentity=nativeUserInfo();
const same=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
function canonical(input,kind){
  if(typeof input!=='string'||!isAbsolute(input))throw Error('test_account_path_required');
  const stat=lstatSync(input),path=realpathSync(input);
  if(stat.isSymbolicLink()||!same(resolve(input),path)||!(kind==='directory'?stat.isDirectory():stat.isFile()))throw Error('test_account_path_denied');
  if(process.platform!=='win32'&&stat.uid!==nativeIdentity.uid)throw Error('test_account_owner_denied');
  return path;
}
const entry=canonical(process.argv[1],'file');
const expected=realpathSync(fileURLToPath(new URL('./multi-agent-worktree-owner.ts',import.meta.url)));
if(!same(entry,expected))throw Error('test_account_entry_denied');
const root=canonical(process.argv[2],'directory');
const accountRoot=canonical(process.argv[5],'directory');
const home=canonical(process.argv[6],'directory');
const temp=realpathSync(os.tmpdir());
if(!same(dirname(root),temp)||!/^xiaok-worktree-process-[A-Za-z0-9]{6}$/.test(basename(root))
  ||!same(dirname(accountRoot),temp)||!/^xiaok-vitest-accounts-[A-Za-z0-9]{6}$/.test(basename(accountRoot))
  ||!same(dirname(home),accountRoot)||!/^account-[A-Za-z0-9]{6}$/.test(basename(home))
  ||same(home,realpathSync(nativeIdentity.homedir)))throw Error('test_account_namespace_denied');

os.userInfo=options=>{
  const info=nativeUserInfo(options);
  return {...info,homedir:Buffer.isBuffer(info.homedir)?Buffer.from(home):home};
};
syncBuiltinESMExports();
