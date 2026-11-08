import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=name=>readFileSync(join(root,'.github','workflows',name),'utf8');
test('release is draft-only, serializes each selected tag and never cancels ongoing publication preparation',()=>{
 const s=read('desktop-release.yml');assert.doesNotMatch(s,/--draft=false|Publish GitHub Release as latest/);assert.match(s,/cancel-in-progress: false/);
 assert.match(s,/group:.*(?:RELEASE_TAG|github\.event\.inputs\.tag)/);
 assert.match(s,/desktop-release-identity\.mjs draft/);assert.match(s,/desktop-release-identity\.mjs verify-draft/);
});
test('all release checkout paths consume the selected tag or the single resolved SHA, never dispatch HEAD',()=>{
 const s=read('desktop-release.yml');const chunks=s.split(/- uses: actions\/checkout@v4/).slice(1);assert.equal(chunks.length,4);
 assert.match(chunks[0],/^\s+with:\s*\n\s+ref: refs\/tags\/\$\{\{ env\.RELEASE_TAG \}\}/);
 for(const chunk of chunks.slice(1))assert.match(chunk,/^\s+with:\s*\n\s+ref: \$\{\{ needs\.create-release\.outputs\.sha \}\}/);
 assert.match(s,/sha: \$\{\{ steps\.identity\.outputs\.sha \}\}/);
 assert.match(s,/verify-release:\s*\n\s+needs: \[create-release, build-mac, build-windows\]/);
 assert.doesNotMatch(s,/run:.*\$\{\{\s*(?:github\.event\.inputs\.tag|env\.RELEASE_TAG)/);
});
test('both upload paths use the fixed guard and original build, signing and asset checks remain',()=>{
 const s=read('desktop-release.yml');for(const command of ['upload-mac','upload-windows'])assert.match(s,new RegExp('desktop-release-identity\\.mjs '+command));
 for(const text of ['Package signed macOS app','Notarize macOS app','Verify macOS signature and notarization','Run packaged Windows Kimi K3 smoke','Build desktop','Test packaged runtime dependency gate'])assert.ok(s.includes(text),text);
 assert.doesNotMatch(s,/gh release upload/,'no unguarded sibling upload step');
});
test('every original sibling clone in both workflows pins the actual reviewed candidate',()=>{
 const expected={'kai-xiaok-plugins':'dd282c63829ba802f5e58a1d453090948b59779e',kswarm:'fdafa5a1558e8fd791aee1e97f9951e8841b99dd','intent-broker':'21defd02854fc38ae7526cdff9de3f46bf137311'};
 for(const file of ['desktop-release.yml','desktop-cross-platform.yml']){
  const s=read(file);for(const [repo,sha] of Object.entries(expected)){
   const clones=[...s.matchAll(new RegExp('git clone[^\\n]*github\\.com/kaisersong/'+repo+'\\.git[^\\n]*','g'))];assert.ok(clones.length>=1);
   for(const m of clones){const tail=s.slice(m.index+m[0].length).split('\n').slice(0,4).join('\n');assert.ok(tail.includes('origin '+sha),file+' '+repo+' every clone must be pinned');}
  }
 }
});

test('extracted signing presence and Team ID checks preserve every original negative boundary',{skip:process.platform==='win32'},()=>{
 const names=['MACOS_CERTIFICATE_P12_BASE64','MACOS_CERTIFICATE_PASSWORD','APPLE_TEAM_ID','APPLE_API_KEY_ID','APPLE_API_ISSUER','APPLE_API_KEY_P8_BASE64'];
 const env={PATH:process.env.PATH,HOME:process.env.HOME,...Object.fromEntries(names.map(name=>[name,'fixture-only']))};env.APPLE_TEAM_ID='Y9YR86UG94';
 const file=join(root,'.github/scripts/check-macos-signing-secrets.sh');const call=e=>spawnSync('bash',['--noprofile','--norc','-e','-o','pipefail',file],{env:e,encoding:'utf8'});
 assert.equal(call(env).status,0);
 for(const name of names){const copy={...env};delete copy[name];const r=call(copy);assert.notEqual(r.status,0);assert.ok(r.stderr.includes(name));assert.ok(!r.stderr.includes('fixture-only'));}
 const r=call({...env,APPLE_TEAM_ID:'wrong-team'});assert.notEqual(r.status,0);assert.match(r.stderr,/APPLE_TEAM_ID must be Y9YR86UG94/);
});
