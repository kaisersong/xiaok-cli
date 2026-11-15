const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn, spawnSync} = require('node:child_process');
const windows = {skip: process.platform !== 'win32'};
const addon = () => require(process.env.XIAOK_WINDOWS_SECURITY_TEST_ADDON || '../../src/runtime/native/win32-x64/windows_owner_security.node');
function ps(script) {
  const result = spawnSync('powershell.exe', ['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')], {encoding:'utf8',env:{...process.env,PSModulePath:''},windowsHide:true});
  assert.equal(result.status,0,result.stderr);return result.stdout.trim();
}
test('ordinary Windows security addon protects only its current owner file', windows, () => {
  const api=addon(),root=fs.mkdtempSync(path.join(os.tmpdir(),'xiaok-owner-acl-')),file=path.join(root,'activity-owner.config.json'),other=path.join(root,'other.txt');
  try {
    fs.writeFileSync(file,'private');fs.writeFileSync(other,'unchanged');
    const quote=s=>s.replace(/'/g,"''");
    // Elevated CI may create Administrators-owned files: normalize only this fixture.
    ps(`$p='${quote(file)}';$a=[IO.File]::GetAccessControl($p);$a.SetOwner([Security.Principal.WindowsIdentity]::GetCurrent().User);[IO.File]::SetAccessControl($p,$a)`);
    const before=api.inspect(other);const protectedFile=api.protectFile(file);
    assert.equal(protectedFile.ownerSid,protectedFile.currentSid);assert.equal(protectedFile.protected,true);
    assert.deepEqual(protectedFile.allowSids,[protectedFile.currentSid]);assert.equal(fs.readFileSync(file,'utf8'),'private');
    assert.equal(api.inspect(other).sddl,before.sddl);
    const link=path.join(root,'hardlink.json');fs.linkSync(file,link);
    assert.throws(()=>api.protectFile(file),/windows_security/);fs.unlinkSync(link);
    assert.throws(()=>api.protectFile(root),/windows_security/);
    ps(`$p='${quote(file)}';$a=[IO.File]::GetAccessControl($p);$a.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule('Everyone','Read','Allow')));[IO.File]::SetAccessControl($p,$a)`);
    assert.ok(api.inspect(file).allowSids.includes('S-1-1-0'));
    api.protectFile(file);assert.deepEqual(api.inspect(file).allowSids,[protectedFile.currentSid]);
  } finally {fs.rmSync(root,{recursive:true,force:true,maxRetries:3});}
});
test('native process birth matches the original .NET ticks and rejects a dead PID', windows, async () => {
  const api=addon(),child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});
  const exited=new Promise(resolve=>child.once('exit',resolve));
  try {
    const birth=api.processBirth(child.pid);assert.match(birth,/^\d{18}$/);
    assert.equal(api.processBirth(child.pid),birth);
    assert.equal(ps(`(Get-Process -Id ${child.pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`),birth);
    assert.throws(()=>api.processBirth(-1),/windows_security/);
  } finally {child.kill();await exited;}
  assert.throws(()=>api.processBirth(child.pid),/windows_security/);
});
test('DACL tightening accepts the elevated default owner without treating it as user ownership', windows, () => {
  const api=addon(),root=fs.mkdtempSync(path.join(os.tmpdir(),'xiaok-default-owner-')),file=path.join(root,'private.json');
  try {
    fs.writeFileSync(file,'x');const before=api.inspect(file),after=api.protectFile(file);
    assert.equal(after.ownerSid,before.ownerSid);assert.equal(after.protected,true);assert.equal(after.protectionOwnerEligible,true);
    assert.deepEqual(after.allowSids,[after.currentSid]);
    if(before.ownerSid!==before.currentSid)assert.equal(before.ownerSid,'S-1-5-32-544');
  }finally{fs.rmSync(root,{recursive:true,force:true,maxRetries:3});}
});
test('private writes create a current-SID protected file before exposing its content', windows, () => {
  const api=addon(),root=fs.mkdtempSync(path.join(os.tmpdir(),'xiaok-private-birth-')),file=path.join(root,'secret.json');
  try {
    assert.equal(api.writePrivateFile(file,'{"value":"private"}',true),true);
    const value=api.inspect(file);assert.equal(value.ownerSid,value.currentSid);assert.equal(value.protected,true);assert.deepEqual(value.allowSids,[value.currentSid]);
    const snapshot=JSON.parse(ps(`$a=[IO.File]::GetAccessControl('${file.replace(/'/g,"''")}');@{owner=$a.GetOwner([Security.Principal.SecurityIdentifier]).Value;protected=$a.AreAccessRulesProtected;allow=@($a.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])|Where-Object {$_.AccessControlType -eq 'Allow'}|ForEach-Object {$_.IdentityReference.Value})}|ConvertTo-Json -Compress`));
    assert.equal(snapshot.owner,value.currentSid);assert.equal(snapshot.protected,true);assert.deepEqual(snapshot.allow,[value.currentSid]);
    assert.equal(api.writePrivateFile(file,'overwritten',true),false);assert.equal(fs.readFileSync(file,'utf8'),'{"value":"private"}');
    assert.equal(api.writePrivateFile(file,'next',false),true);assert.equal(fs.readFileSync(file,'utf8'),'next');
    const link=path.join(root,'link');fs.linkSync(file,link);assert.throws(()=>api.writePrivateFile(file,'bad',false),/windows_security/);assert.equal(fs.readFileSync(file,'utf8'),'next');
    const unsafe=path.join(root,'unsafe.json');fs.writeFileSync(unsafe,'unchanged');assert.throws(()=>api.writePrivateFile(unsafe,'bad',false),/windows_security/);assert.equal(fs.readFileSync(unsafe,'utf8'),'unchanged');
  }finally{fs.rmSync(root,{recursive:true,force:true,maxRetries:3});}
});
test('private directories give SQLite-created children only the current SID', windows, () => {
  const api=addon(),base=fs.mkdtempSync(path.join(os.tmpdir(),'xiaok-directory-')),root=path.join(base,'私有目录');
  try {
    assert.equal(api.createPrivateDirectory(root),true);assert.equal(api.createPrivateDirectory(root),false);
    const facts=api.protectDirectory(root);assert.equal(facts.directory,true);assert.equal(facts.protected,true);assert.deepEqual(facts.allowSids,[facts.currentSid]);
    const file=path.join(root,'database-wal');fs.writeFileSync(file,'private');
    assert.deepEqual(api.inspect(file).allowSids,[facts.currentSid]);
    const independent=JSON.parse(ps(`$a=[IO.File]::GetAccessControl('${file.replace(/'/g,"''")}');@($a.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])|Where-Object {$_.AccessControlType -eq 'Allow'}|ForEach-Object {$_.IdentityReference.Value})|ConvertTo-Json -Compress`));
    assert.deepEqual(Array.isArray(independent)?independent:[independent],[facts.currentSid]);
    assert.throws(()=>api.protectDirectory(file),/windows_security/);
  }finally{fs.rmSync(base,{recursive:true,force:true,maxRetries:3});}
});
