import {afterEach,expect,it,vi} from 'vitest';
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
// The probe is a separate 5.1 process; a pwsh 7 parent's PSModulePath would break it too.
function probeEnv(){const env:NodeJS.ProcessEnv={};for(const [k,v] of Object.entries(process.env))if(k.toLowerCase()!=='psmodulepath')env[k]=v;return env;}
function acl(path:string){
  const script=`$ErrorActionPreference='Stop'; $a=(Get-Item -LiteralPath $env:XIAOK_ACL_PROBE -Force).GetAccessControl('Access'); $me=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; [pscustomobject]@{me=$me;protected=$a.AreAccessRulesProtected;allow=@($a.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])|?{$_.AccessControlType -eq 'Allow'}|%{$_.IdentityReference.Value}|Sort-Object -Unique)}|ConvertTo-Json -Compress`;
  const r=spawnSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{env:{...probeEnv(),XIAOK_ACL_PROBE:path},encoding:'utf8',windowsHide:true});
  expect(r.status,r.stderr).toBe(0);return JSON.parse(r.stdout) as {me:string;protected:boolean;allow:string[]|string};
}

it(process.platform==='win32'?'applies the real Windows DACL to the credential directory and file (no mocked PowerShell)':'leaves POSIX credential paths to mode bits',()=>{
  const p=root(),dir=join(p,'credentials'),file=join(dir,'store.json');mkdirSync(dir);writeFileSync(file,'{}');
  if(process.platform!=='win32'){protectCredentialPath(dir,true);protectCredentialPath(file,false);return;}
  // Real PowerShell, recorded so a failure reports the script's own stderr
  // instead of only credential_path_unsafe (no behaviour is replaced).
  for(const [target,directory] of [[dir,true],[file,false]] as const){
    let last:ReturnType<typeof spawnSync>|undefined;
    const real=((command:string,args:string[],options:Parameters<typeof spawnSync>[2])=>(last=spawnSync(command,args,{...options,encoding:'utf8'}))) as unknown as typeof spawnSync;
    try{protectCredentialPath(target,directory,'win32',real);}
    catch(error){throw new Error(`${(error as Error).message} for ${directory?'directory':'file'} ${target}: status=${last?.status} error=${String(last?.error??'')} stderr=${String(last?.stderr??'').trim()} stdout=${String(last?.stdout??'').trim()}`);}
    expect(last?.status).toBe(0);
    // A restart re-protects the same path; unelevated Set-Acl failed here with SeSecurityPrivilege.
    protectCredentialPath(target,directory);
  }
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

it('never hands a PowerShell 7 module path to Windows PowerShell 5.1 and avoids Set-Acl',()=>{
  const saved=process.env.PSModulePath;process.env.PSModulePath='C:\\Program Files\\PowerShell\\7\\Modules';
  try{
    const run=vi.fn(()=>({status:0}));protectCredentialPath('C:\\x\\credentials',true,'win32',run as never);
    const options=run.mock.calls[0][2] as {env:Record<string,string>};
    expect(Object.keys(options.env).filter(k=>k.toLowerCase()==='psmodulepath')).toEqual([]);
    const script=Buffer.from((run.mock.calls[0][1] as string[])[4],'base64').toString('utf16le');
    expect(script).not.toMatch(/Set-Acl|Get-Acl/);expect(script).toContain('SetAccessControl($acl)');
  }finally{if(saved===undefined)delete process.env.PSModulePath;else process.env.PSModulePath=saved;}
});
