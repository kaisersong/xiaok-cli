// Same isolated account contract as tests/support/profile-account.setup.mjs.
// Import this project's own Vitest runtime (desktop and root versions differ).
import {inject,vi} from 'vitest';
import {mkdtempSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
const account=vi.hoisted(()=>({home:undefined}));
const root=inject('profileTestAccountRoot');
if(typeof root!=='string'||!root)throw Error('test_profile_account_root_required');
account.home=realpathSync(mkdtempSync(join(root,'account-')));
vi.mock('node:os',async original=>{
 const actual=await original();
 const userInfo=options=>{
  if(!account.home)throw Error('test_profile_account_not_ready');
  const info=actual.userInfo(options);
  return {...info,homedir:Buffer.isBuffer(info.homedir)?Buffer.from(account.home):account.home};
 };
 return {...actual,userInfo,default:{...actual.default,userInfo}};
});
