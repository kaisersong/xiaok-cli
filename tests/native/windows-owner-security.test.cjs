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
test('native ACL facts distinguish current-user inheritable full control without parsing SDDL', windows, () => {
  const api=addon(),base=fs.mkdtempSync(path.join(os.tmpdir(),'xiaok-inheritable-acl-')),root=path.join(base,'private');
  const quote=s=>s.replace(/'/g,"''");
  try {
    assert.equal(api.createPrivateDirectory(root),true);
    const facts=api.inspect(root);
    const actual=JSON.parse(ps(`$a=[IO.Directory]::GetAccessControl('${quote(root)}');@($a.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])|ForEach-Object {@{sid=$_.IdentityReference.Value;rights=[int]$_.FileSystemRights;inheritance=[int]$_.InheritanceFlags;propagation=[int]$_.PropagationFlags;allow=($_.AccessControlType -eq 'Allow')}})|ConvertTo-Json -Compress`));
    const rules=Array.isArray(actual)?actual:[actual];
    assert(rules.some(rule=>rule.allow&&rule.sid===facts.currentSid&&rule.rights===2032127&&rule.inheritance===3&&rule.propagation===0));
    assert.equal(facts.currentUserInheritableFullControl,true);
    for(const [rights,inheritance] of [['Read',3],['FullControl',0],['FullControl',1],['FullControl',2]]) {
      ps(`$p='${quote(root)}';$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User;$a=New-Object Security.AccessControl.DirectorySecurity;$a.SetOwner($sid);$a.SetAccessRuleProtection($true,$false);$r=New-Object Security.AccessControl.FileSystemAccessRule($sid,[Security.AccessControl.FileSystemRights]::${rights},[Security.AccessControl.InheritanceFlags]${inheritance},[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow);$a.AddAccessRule($r);[IO.Directory]::SetAccessControl($p,$a)`);
      assert.equal(api.inspect(root).currentUserInheritableFullControl,false,`${rights}/${inheritance} is insufficient`);
      api.protectDirectory(root);
    }
  }finally{api.protectDirectory(root);fs.rmSync(base,{recursive:true,force:true,maxRetries:3});}
});
test('activity permission context captures before opening and checks fresh ACLs through held handles', windows, () => {
 const api=addon(),base=fs.mkdtempSync(path.join(os.tmpdir(),'xiaok-activity-permissions-')),root=path.join(base,'root'),file=path.join(root,'a.sqlite');let context;
 try {
  assert.equal(typeof api.createActivityPermissions,'function');
  context=api.createActivityPermissions(file);assert.throws(()=>context.verify(),/windows_security/);context.close();context=undefined;
  assert.equal(api.createPrivateDirectory(root),true);
  for(const suffix of ['', '.owner.sqlite','-wal','-shm'])assert.equal(api.writePrivateFile(file+suffix,'private',true),true);
  const before=api.inspect(file);context=api.createActivityPermissions(file);assert.equal(context.verify(),true);
  assert.throws(()=>context.verify.call({}),/windows_security/);
  assert.throws(()=>fs.renameSync(file,file+'.moved'));
  const q=file.replace(/'/g,"''");ps(`$p='${q}';$a=[IO.File]::GetAccessControl($p);$a.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule('Everyone','Read','Allow')));[IO.File]::SetAccessControl($p,$a)`);
  assert(api.inspect(file).allowSids.includes('S-1-1-0'));assert.equal(context.verify(),true);
  const after=api.inspect(file);assert.equal(after.identity,before.identity);assert.deepEqual(after.allowSids,[after.currentSid]);
  context.close();assert.throws(()=>context.verify(),/windows_security/);context.close();context=undefined;
  fs.renameSync(file,file+'.moved');assert.equal(fs.readFileSync(file+'.moved','utf8'),'private');
 }finally{context?.close();fs.rmSync(base,{recursive:true,force:true,maxRetries:3});}
});
test('activity permission context distinguishes absent sidecars from an invalid required file', windows,()=>{
 const api=addon(),base=fs.mkdtempSync(path.join(os.tmpdir(),'xiaok-activity-permission-absent-')),root=path.join(base,'root'),file=path.join(root,'a.sqlite');let context;
 try{
  assert.equal(api.createPrivateDirectory(root),true);for(const suffix of ['', '.owner.sqlite'])assert.equal(api.writePrivateFile(file+suffix,'private',true),true);
  context=api.createActivityPermissions(file);assert.equal(context.verify(),false);assert.throws(()=>fs.renameSync(root,root+'.moved'));context.close();context=undefined;
  fs.renameSync(root,root+'.moved');fs.renameSync(root+'.moved',root);
  const link=path.join(root,'link');fs.linkSync(file,link);context=api.createActivityPermissions(file);assert.throws(()=>context.verify(),/windows_security/);context.close();context=undefined;fs.unlinkSync(link);
 }finally{context?.close();fs.rmSync(base,{recursive:true,force:true,maxRetries:3});}
});

test('activity context accepts the existing inherited private-parent predicate', windows,()=>{
 const api=addon(),base=fs.mkdtempSync(path.join(os.tmpdir(),'xiaok-context-inherited-')),parent=path.join(base,'private'),root=path.join(parent,'inherited'),file=path.join(root,'a.sqlite');let context;
 try{
  assert.equal(api.createPrivateDirectory(parent),true);fs.mkdirSync(root);
  const facts=api.inspect(root);assert.equal(facts.protected,false);assert.equal(facts.protectionOwnerEligible,true);assert.equal(facts.currentUserInheritableFullControl,true);assert.deepEqual(facts.allowSids,[facts.currentSid]);
  for(const suffix of ['', '.owner.sqlite','-wal','-shm'])assert.equal(api.writePrivateFile(file+suffix,'private',true),true);
  context=api.createActivityPermissions(file);assert.equal(context.verify(),true);context.close();context=undefined;
 }finally{context?.close();fs.rmSync(base,{recursive:true,force:true,maxRetries:3});}
});
test('held activity context rejects a broadened parent or loss of inheritable full control',windows,()=>{
 const api=addon();
 for(const alteration of ['everyone','no-inheritance','inherit-only']){
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'xiaok-context-parent-negative-')),root=path.join(base,'root'),file=path.join(root,'a.sqlite');let context;
  try{
   api.createPrivateDirectory(root);for(const suffix of ['', '.owner.sqlite','-wal','-shm'])api.writePrivateFile(file+suffix,'private',true);
   context=api.createActivityPermissions(file);assert.equal(context.verify(),true);
   const q=root.replace(/'/g,"''");
   if(alteration==='everyone')ps(`$p='${q}';$a=[IO.Directory]::GetAccessControl($p);$a.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule('Everyone','Read','Allow')));[IO.Directory]::SetAccessControl($p,$a)`);
   else ps(`$p='${q}';$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User;$a=New-Object Security.AccessControl.DirectorySecurity;$a.SetOwner($sid);$a.SetAccessRuleProtection($true,$false);$a.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid,'ReadAndExecute,ChangePermissions',[Security.AccessControl.InheritanceFlags]0,[Security.AccessControl.PropagationFlags]0,'Allow')));${alteration==='inherit-only'?"$a.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl',[Security.AccessControl.InheritanceFlags]3,[Security.AccessControl.PropagationFlags]2,'Allow')));":''}[IO.Directory]::SetAccessControl($p,$a)`);
   if(alteration!=='everyone')assert.equal(api.inspect(root).currentUserInheritableFullControl,false,alteration+' fixture must be insufficient');
   assert.throws(()=>context.verify(),/windows_security/,alteration);api.protectDirectory(root);assert.throws(()=>context.verify(),/windows_security/,'failure remains latched');context.close();context=undefined;
  }finally{context?.close();api.protectDirectory(root);fs.rmSync(base,{recursive:true,force:true,maxRetries:3});}
 }
});
test('activity context normalizes pathname input and refuses an actual ancestor replacement',windows,()=>{
 const api=addon(),base=fs.mkdtempSync(path.join(os.tmpdir(),'xiaok-context-canonical-')),root=path.join(base,'私有目录'),file=path.join(root,'a.sqlite');let context,moved=false;
 try{
  api.createPrivateDirectory(root);for(const suffix of ['', '.owner.sqlite','-wal','-shm'])api.writePrivateFile(file+suffix,'private',true);
  context=api.createActivityPermissions(root+'\\..\\私有目录\\a.sqlite');assert.equal(context.verify(),true);
  try{fs.renameSync(base,base+'.moved');moved=true;}catch(error){assert(['EPERM','EACCES','EBUSY'].includes(error.code),'only actual sharing/access denial is accepted');}
  if(moved)assert.throws(()=>context.verify(),/windows_security/);else assert.equal(context.verify(),true);
  context.close();context=undefined;
 }finally{context?.close();fs.rmSync(moved?base+'.moved':base,{recursive:true,force:true,maxRetries:3});}
});
test('activity context observes newly created transient files and rejects actual transient hardlinks',windows,()=>{
 const api=addon(),base=fs.mkdtempSync(path.join(os.tmpdir(),'xiaok-context-transient-')),root=path.join(base,'root'),file=path.join(root,'a.sqlite'),journal=file+'-journal';let context;
 try{
  api.createPrivateDirectory(root);for(const suffix of ['', '.owner.sqlite','-wal','-shm'])api.writePrivateFile(file+suffix,'private',true);
  context=api.createActivityPermissions(file);assert.equal(context.verify(),true);
  fs.writeFileSync(journal,'actual journal');const q=journal.replace(/'/g,"''");
  ps(`$p='${q}';$a=[IO.File]::GetAccessControl($p);$a.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule('Everyone','Read','Allow')));[IO.File]::SetAccessControl($p,$a)`);
  assert(api.inspect(journal).allowSids.includes('S-1-1-0'));assert.equal(context.verify(),true);assert.deepEqual(api.inspect(journal).allowSids,[api.inspect(journal).currentSid]);assert.equal(fs.readFileSync(journal,'utf8'),'actual journal');
  fs.unlinkSync(journal);assert.equal(context.verify(),true);
  fs.linkSync(file,journal);assert.throws(()=>context.verify(),/windows_security/);context.close();context=undefined;fs.unlinkSync(journal);
 }finally{context?.close();fs.rmSync(base,{recursive:true,force:true,maxRetries:3});}
});
