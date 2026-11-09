import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { win32 as path } from 'node:path';
import * as launch from '../../scripts/evals/_desktop-runtime/windows-launch.mjs';

const root = 'C:\\halo-qa\\runs\\run-a';
function session() {
  return { sessionRoot: root, userData:path.join(root,'user-data'),home:path.join(root,'home'),config:path.join(root,'config'),temp:path.join(root,'temp'),workspace:path.join(root,'workspace'),logs:path.join(root,'logs'),debuggingPort:19222 };
}
const create = (extra={}) => launch.createWindowsProductLaunch({appPath:path.join(root,'bundle','xiaok.exe'),session:session(),platform:'win32',systemRoot:'C:\\Windows',...extra});

test('Windows guest launch uses a real exe and redirects every durable/writable root', () => {
  const value=create();
  assert.equal(value.command,path.join(root,'bundle','xiaok.exe'));
  assert.deepEqual(value.args,['--remote-debugging-address=127.0.0.1','--remote-debugging-port=19222',`--user-data-dir=${session().userData}`]);
  assert.equal(value.cwd,session().workspace);
  for(const name of ['HOME','USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP','XIAOK_CONFIG_DIR','KSWARM_DATA_ROOT','INTENT_BROKER_DB','INTENT_BROKER_LOCAL_CONFIG','INTENT_BROKER_HEARTBEAT_PATH']) {
    assert.equal(typeof value.env[name],'string',name);
    const relative=path.relative(root.toLowerCase(),value.env[name].toLowerCase());
    assert.ok(relative && relative!=='..' && !relative.startsWith('..\\') && !path.isAbsolute(relative),name);
  }
  assert.equal(value.env.XIAOK_DESKTOP_DISABLE_SINGLE_INSTANCE,'1');
  assert.equal(value.env.SystemRoot,'C:\\Windows');
  assert.equal(value.env.ELECTRON_RUN_AS_NODE,undefined);
});

test('does not inherit host credentials or profile variables', () => {
  const old=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='MUST_NOT_INHERIT';
  try {const value=create();assert.equal(value.env.OPENAI_API_KEY,undefined);assert.ok(!JSON.stringify(value).includes('MUST_NOT_INHERIT'));}
  finally {if(old===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=old;}
});

for(const key of ['home','userData','config','temp','workspace','logs']) {
  for(const escape of ['C:\\Users\\host','C:\\halo-qa\\runs\\run-a-sibling','D:\\halo-qa\\runs\\run-a','\\\\host\\profile']) {
    test(`refuses escaped guest ${key}: ${escape}`,()=>{
      assert.throws(()=>create({session:{...session(),[key]:escape}}),/PRODUCT_EVAL_WINDOWS_LAUNCH_CONTRACT_INVALID/);
    });
  }
}

test('accepts NTFS drive/path case variants and normalizes separators',()=>{
  const value=create({session:{...session(),home:'c:/HALO-QA/runs/run-a/home'}});
  assert.equal(value.env.USERPROFILE,'c:\\HALO-QA\\runs\\run-a\\home');
});

for(const appPath of ['C:\\qa\\xiaok.cmd','C:\\qa\\xiaok.bat','\\\\server\\qa\\xiaok.exe','/tmp/xiaok.exe','C:relative\\xiaok.exe','\\qa\\xiaok.exe','C:\\qa\\other.exe','C:\\Users\\host\\xiaok.exe','D:\\qa\\xiaok.exe']) {
  test(`rejects nonlocal/nonapplication executable ${appPath}`,()=>assert.throws(()=>create({appPath}),/PRODUCT_EVAL_WINDOWS_LAUNCH_CONTRACT_INVALID/));
}
for(const debuggingPort of [0,1023,65536,1.5,NaN])test(`rejects invalid debugging port ${debuggingPort}`,()=>assert.throws(()=>create({session:{...session(),debuggingPort}}),/PRODUCT_EVAL_WINDOWS_LAUNCH_CONTRACT_INVALID/));
test('refuses accidental host platform launch',()=>assert.throws(()=>create({platform:'darwin'}),/PRODUCT_EVAL_WINDOWS_ONLY/));

// The actual activity source supervisor resolves powershell.exe by name to
// obtain a child birth timestamp. A guest-safe PATH must retain that OS tool.
test('Windows guest env supports the real source-supervisor process birth probe', {skip:process.platform!=='win32'}, t=>{
  const probeRoot=mkdtempSync(path.join(tmpdir(),'halo-windows-birth-'));
  t.after(()=>rmSync(probeRoot,{recursive:true,force:true}));
  const current={sessionRoot:probeRoot,debuggingPort:19223};
  for(const name of ['userData','home','config','temp','workspace','logs']){current[name]=path.join(probeRoot,name);mkdirSync(current[name],{recursive:true});}
  const value=launch.createWindowsProductLaunch({appPath:path.join(probeRoot,'bundle','xiaok.exe'),session:current});
  const searchDirectories=value.env.PATH.split(path.delimiter);
  assert.ok(searchDirectories.includes(path.join(value.env.SystemRoot,'System32')));
  assert.ok(searchDirectories.includes(path.join(value.env.SystemRoot,'System32','WindowsPowerShell','v1.0')));
  assert.ok(searchDirectories.every(directory=>{const relative=path.relative(value.env.SystemRoot,directory);return path.isAbsolute(directory)&&relative&&relative!=='..'&&!relative.startsWith('..\\')&&!path.isAbsolute(relative);}));
  const broken=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','exit 0'],{cwd:current.workspace,env:{...value.env,PATH:path.join(value.env.SystemRoot,'System32')},encoding:'utf8',timeout:10000,windowsHide:true});
  assert.equal(broken.error?.code,'ENOENT','negative control must not resolve PowerShell via parent PATH');
  const child=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`(Get-Process -Id ${process.pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`],{cwd:current.workspace,env:value.env,encoding:'utf8',timeout:10000,windowsHide:true});
  assert.equal(child.error,undefined,child.error?.message);
  assert.equal(child.status,0,child.stderr);
  assert.match(child.stdout.trim(),/^\d+$/);
});
