const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const windows={skip:process.platform!=='win32'};
const addon=()=>require(process.env.XIAOK_WINDOWS_SECURITY_TEST_ADDON||'../../src/runtime/native/win32-x64/windows_owner_security.node');
function ps(script){const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
function fixture(){const api=addon(),base=fs.mkdtempSync(path.join(os.tmpdir(),'xiaok-profile-custody-')),root=path.join(base,'私有');assert.equal(api.createPrivateDirectory(root),true);return {api,base,root,cleanup(){fs.rmSync(base,{recursive:true,force:true,maxRetries:3});}};}
function everyone(file){ps(`$p='${file.replace(/'/g,"''")}';$a=[IO.File]::GetAccessControl($p);$sid=[Security.Principal.SecurityIdentifier]::new('S-1-1-0');$a.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,[Security.AccessControl.FileSystemRights]::Read,[Security.AccessControl.AccessControlType]::Allow));[IO.File]::SetAccessControl($p,$a)`);}
test('native profile custody holds exact paths, excludes writes and concurrent initialization',windows,()=>{
 const f=fixture();let lease,read;
 try{const file=path.join(f.root,'conversation-activity.sqlite');f.api.writePrivateFile(file,'fixture',true);lease=f.api.holdProfile(f.root,true);assert.match(lease.currentSid,/^S-1-/);assert.match(lease.rootIdentity,/^\d+:\d+:\d+$/);lease.assertCurrent();
  assert.throws(()=>Reflect.apply(lease.assertCurrent,{},[]),/windows_profile/);
  assert.throws(()=>fs.renameSync(file,file+'.moved'));assert.equal(fs.readFileSync(file,'utf8'),'fixture');
  assert.throws(()=>fs.openSync(file,'r+'));assert.throws(()=>f.api.holdProfile(f.root,true),/windows_profile/);
  read=f.api.holdProfile(f.root,false);read.assertCurrent();read.close();read=undefined;
  lease.close();assert.throws(()=>lease.assertCurrent(),/windows_profile/);lease=undefined;
  const next=f.api.holdProfile(f.root,true);next.assertCurrent();next.close();
 }finally{read?.close();lease?.close();f.cleanup();}
});
test('custody refuses Everyone and hardlinks without repairing the old ACL or data',windows,()=>{
 const f=fixture();try{const file=path.join(f.root,'conversation-activity.sqlite');f.api.writePrivateFile(file,'unchanged',true);const link=path.join(f.root,'unrelated-link');fs.linkSync(file,link);assert.throws(()=>f.api.holdProfile(f.root,true),/windows_profile/);fs.unlinkSync(link);
 everyone(file);const before=f.api.inspect(file).sddl;assert.throws(()=>f.api.holdProfile(f.root,true),/windows_profile/);assert.equal(f.api.inspect(file).sddl,before);assert.equal(fs.readFileSync(file,'utf8'),'unchanged');
 }finally{f.cleanup();}
});
test('custody rejects intermediate multi-agent junctions and elevated default owner exceptions',windows,()=>{
 const f=fixture();try{const other=path.join(f.base,'other');f.api.createPrivateDirectory(other);fs.symlinkSync(other,path.join(f.root,'multi-agent'),'junction');assert.throws(()=>f.api.holdProfile(f.root,true),/windows_profile/);fs.unlinkSync(path.join(f.root,'multi-agent'));
 const file=path.join(f.root,'conversation-activity.sqlite');fs.writeFileSync(file,'owner fixture');const facts=f.api.inspect(file);if(facts.ownerSid!==facts.currentSid){assert.equal(facts.ownerSid,'S-1-5-32-544');assert.equal(facts.protectionOwnerEligible,true);assert.throws(()=>f.api.holdProfile(f.root,true),/windows_profile/);}
 }finally{f.cleanup();}
});
test('a held lease detects ACL mutation and retains failure even if the ACL is repaired',windows,()=>{
 const f=fixture();let lease;try{const file=path.join(f.root,'conversation-activity.sqlite');f.api.writePrivateFile(file,'fixture',true);lease=f.api.holdProfile(f.root,true);lease.assertCurrent();everyone(file);assert.throws(()=>lease.assertCurrent(),/windows_profile/);f.api.protectFile(file);assert.throws(()=>lease.assertCurrent(),/windows_profile/);
 }finally{lease?.close();f.cleanup();}
});
test('atomic private publication never overwrites an existing profile or publishes partial bytes',windows,()=>{
 const f=fixture();try{const temporary=path.join(f.root,'.profile-fixture.tmp'),target=path.join(f.root,'continuity-profile.json');const content=JSON.stringify({version:2,profileId:'550e8400-e29b-41d4-a716-446655440000',osOwnerSid:f.api.inspect(f.root).currentSid});f.api.writePrivateFile(temporary,content,true);const lease=f.api.holdProfile(f.root,true);try{assert.equal(f.api.publishProfileFile(temporary,target),true);assert.equal(fs.existsSync(temporary),false);assert.equal(fs.readFileSync(target,'utf8'),content);const snapshot=f.api.inspect(target);assert.equal(snapshot.protected,true);assert.deepEqual(snapshot.allowSids,[snapshot.currentSid]);
 f.api.writePrivateFile(temporary,'replacement',true);assert.throws(()=>f.api.publishProfileFile(temporary,target),/windows_profile/);assert.equal(fs.readFileSync(target,'utf8'),content);assert.equal(fs.readFileSync(temporary,'utf8'),'replacement');}finally{lease.close();}
 const other=path.join(f.root,'unrelated.json');assert.throws(()=>f.api.publishProfileFile(temporary,other),/windows_profile/);assert.equal(fs.existsSync(other),false);
 }finally{f.cleanup();}
});
test('existing UUID observation permits a writer and trusted elevated sidecars but never metadata writes or new legacy adoption',windows,()=>{
 const f=fixture();let observer,fd;try{const file=path.join(f.root,'conversation-activity.sqlite'),wal=file+'-wal',profile=path.join(f.root,'continuity-profile.json');f.api.writePrivateFile(file,'fixture',true);fs.writeFileSync(wal,'sidecar');
 const facts=f.api.inspect(wal);if(facts.ownerSid!==facts.currentSid)assert.throws(()=>f.api.holdProfile(f.root,false,true),/windows_profile/);
 f.api.writePrivateFile(profile,JSON.stringify({version:2,profileId:'550e8400-e29b-41d4-a716-446655440000',osOwnerSid:facts.currentSid}),true);
 fd=fs.openSync(file,'r+');observer=f.api.holdProfile(f.root,false,true);observer.assertCurrent();assert.throws(()=>fs.openSync(profile,'r+'));assert.throws(()=>fs.renameSync(profile,profile+'.moved'));assert.throws(()=>f.api.holdProfile(f.root,true),/windows_profile/);
 }finally{observer?.close();if(fd!==undefined)fs.closeSync(fd);f.cleanup();}
});
test('atomic private publication preserves exact destination across allocation lengths without overwrite',windows,()=>{
 const f=fixture();
 try{
  for(let length=1;length<=48;length++){
   const root=path.join(f.root,'p'.repeat(length));assert.equal(f.api.createPrivateDirectory(root),true);
   const temporary=path.join(root,'.identity.tmp'),target=path.join(root,'continuity-profile.json'),bytes='fixture-'+length;
   f.api.writePrivateFile(temporary,bytes,true);assert.equal(f.api.publishProfileFile(temporary,target),true);
   assert.equal(fs.readFileSync(target,'utf8'),bytes);assert.deepEqual(fs.readdirSync(root),['continuity-profile.json']);
   f.api.writePrivateFile(temporary,'replacement',true);assert.throws(()=>f.api.publishProfileFile(temporary,target));
   assert.equal(fs.readFileSync(target,'utf8'),bytes);assert.equal(fs.readFileSync(temporary,'utf8'),'replacement');
  }
 }finally{f.cleanup();}
});
