import {afterEach,expect,it} from 'vitest';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {CredentialStore,protectCredentialPath} from '../../src/utils/credential-store.js';

// 1.6.3 RC blocker: the DACL script must run for real on Windows. Mocked
// PowerShell hid that a SID string passed to FileSystemAccessRule is treated as
// an account name ("Some or all identity references could not be translated").
const roots:string[]=[];
afterEach(()=>{for(const p of roots.splice(0))rmSync(p,{recursive:true,force:true});});
function root(){const p=mkdtempSync(join(tmpdir(),'xiaok-credential-acl-'));roots.push(p);return p;}
function acl(path:string){
  const script=`$ErrorActionPreference='Stop'; $a=Get-Acl -LiteralPath $env:XIAOK_ACL_PROBE; $me=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; [pscustomobject]@{me=$me;protected=$a.AreAccessRulesProtected;allow=@($a.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])|?{$_.AccessControlType -eq 'Allow'}|%{$_.IdentityReference.Value}|Sort-Object -Unique)}|ConvertTo-Json -Compress`;
  const r=spawnSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{env:{...process.env,XIAOK_ACL_PROBE:path},encoding:'utf8',windowsHide:true});
  expect(r.status,r.stderr).toBe(0);return JSON.parse(r.stdout) as {me:string;protected:boolean;allow:string[]|string};
}

it(process.platform==='win32'?'applies the real Windows DACL to the credential directory and file (no mocked PowerShell)':'leaves POSIX credential paths to mode bits',()=>{
  const p=root(),dir=join(p,'credentials'),file=join(dir,'store.json');mkdirSync(dir);writeFileSync(file,'{}');
  if(process.platform!=='win32'){protectCredentialPath(dir,true);protectCredentialPath(file,false);return;}
  expect(()=>protectCredentialPath(dir,true)).not.toThrow();
  expect(()=>protectCredentialPath(file,false)).not.toThrow();
  for(const target of [dir,file]){
    const result=acl(target);expect(result.protected).toBe(true);
    expect([result.allow].flat().sort()).toEqual([result.me,'S-1-5-18','S-1-5-32-544'].sort());
  }
});

it('stores and reads back a secret through the real file vault on this platform',()=>{
  const p=root(),locked={get:()=>{throw Error('locked');},put:()=>{throw Error('locked');}};
  const id=randomUUID(),store=new CredentialStore(p,locked);
  store.put(id,'acl-canary');
  expect(new CredentialStore(p,locked).get(id)).toBe('acl-canary');
});
