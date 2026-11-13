import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, helper, project } from './fixtures/release-git-fixture.mjs';
const requireSuccess=r=>assert.equal(r.status,0,r.stderr);
const requireFailure=r=>{assert.notEqual(r.status,0,'original gate incorrectly accepted invalid release identity');assert.match(r.stderr,/\[release-identity\]/,'missing entry or setup errors cannot count as a guard rejection');};
const withRepo=(fn,options)=>{const f=fixture(options);try{return fn(f);}finally{f.close();}};
const posixOnly={skip:process.platform==='win32'?'Local fake-gh executable fixture is POSIX; production uses native gh.exe, not a .cmd shim':false};

for(const annotated of [false,true])test(`resolves actual ${annotated?'annotated':'lightweight'} remote tag to one full SHA`,()=>withRepo(f=>{
 const output=join(f.root,'outputs');const r=f.invoke('resolve',{GITHUB_OUTPUT:output});requireSuccess(r);
 assert.match(readFileSync(output,'utf8'),new RegExp('^sha='+f.sha+'$','m'));assert.equal(JSON.parse(r.stdout).sha,f.sha);
},{annotated}));
test('rejects a different actual HEAD',()=>withRepo(f=>{writeFileSync(join(f.repo,'next'),'x');f.git('add','.');f.git('commit','-m','next');requireFailure(f.invoke('check'));}));
for(const file of ['package.json','desktop/package.json'])test('rejects mismatched real version in '+file,()=>withRepo(f=>{
 writeFileSync(join(f.repo,file),JSON.stringify({version:'1.6.2'}));requireFailure(f.invoke('check'));
}));
test('rejects an actual tag outside fresh origin/master ancestry',()=>withRepo(f=>{
 f.git('checkout','--orphan','outside');writeFileSync(join(f.repo,'unrelated'),'x');f.git('add','.');f.git('commit','-m','outside');
 const other=f.git('rev-parse','HEAD');f.git('push','origin','outside');f.git('--git-dir',f.origin,'update-ref','refs/tags/'+f.tag,other);
 requireFailure(f.invoke('check',{RELEASE_SHA:other}));
}));
test('rejects a remote tag deletion while local tag still exists',()=>withRepo(f=>{
 f.git('--git-dir',f.origin,'update-ref','-d','refs/tags/'+f.tag);assert.equal(f.git('rev-parse','refs/tags/'+f.tag),f.sha);requireFailure(f.invoke('check'));
}));
test('fresh remote peel rejects moved tag despite unchanged local tag and expected HEAD',()=>withRepo(f=>{
 writeFileSync(join(f.repo,'next'),'x');f.git('add','.');f.git('commit','-m','remote next');const moved=f.git('rev-parse','HEAD');f.git('push','origin','master');
 f.git('checkout','--detach',f.sha);f.git('--git-dir',f.origin,'update-ref','refs/tags/'+f.tag,moved);
 assert.equal(f.git('rev-parse','refs/tags/'+f.tag),f.sha);const r=f.invoke('check');requireFailure(r);assert.match(r.stderr,/remote_tag/);
}));
for(const tag of ['-bad','desktop-v1.6.3;echo bad','desktop-v1.6.3\nsha=other','desktop-v../1.6.3','desktop-v01.6.3'])test('rejects invalid tag '+JSON.stringify(tag),()=>withRepo(f=>{
 requireFailure(f.invoke('check',{RELEASE_TAG:tag}));assert.deepEqual(f.calls(),[]);
}));
test('rejects missing or non-full expected SHA',()=>withRepo(f=>{for(const sha of ['',f.sha.slice(0,12),'x'.repeat(40)])requireFailure(f.invoke('check',{RELEASE_SHA:sha}));}));

test('actual draft-create workflow step rejects an existing published release',posixOnly,()=>withRepo(f=>{
 f.update({draft:false});const workflow=readFileSync(join(project,'.github/workflows/desktop-release.yml'),'utf8');
 const segment=workflow.split('- name: Create Draft GitHub Release')[1];assert.ok(segment,'original draft step must remain');
 const line=segment.match(/^\s+run: (.+)$/m)?.[1];assert.ok(line,'draft step must be a real command');
 // The old Actions expression is normalized only to its equivalent test-owned env access.
 const command=line.replaceAll('${{ env.RELEASE_TAG }}','${RELEASE_TAG}');
 const r=f.run('bash',['-e','-c',command]);requireFailure(r);
 assert.equal(f.calls().some(a=>a[0]==='release'&&a[1]==='create'),false);
}));
test('creates only an absent draft with existing remote tag, never latest/published',posixOnly,()=>withRepo(f=>{
 f.update({exists:false});requireSuccess(f.invoke('draft'));const calls=f.calls(),create=calls.find(a=>a[0]==='release'&&a[1]==='create');assert.ok(create);
 for(const option of ['--draft','--verify-tag','--latest=false'])assert.ok(create.includes(option));assert.equal(create[create.indexOf('--target')+1],f.sha);
 assert.ok(calls.filter(a=>a[0]==='api').length>=2);assert.equal(calls.some(a=>a.includes('--draft=false')),false);
}));
test('reuses an existing matching draft without creating anything',posixOnly,()=>withRepo(f=>{requireSuccess(f.invoke('draft'));assert.equal(f.calls().some(a=>a[1]==='create'),false);}));
for(const patch of [{httpStatus:401},{httpStatus:503},{malformed:true},{tag:'desktop-v1.6.2'},{body:null},{body:[]},{body:{}}])test('API failure cannot be mistaken for missing release '+JSON.stringify(patch),posixOnly,()=>withRepo(f=>{
 f.update(patch);requireFailure(f.invoke('draft'));assert.equal(f.calls().some(a=>a[1]==='create'),false);
}));
for(const platform of ['mac','windows'])test('upload '+platform+' checks identity and draft immediately before structured gh call',posixOnly,()=>withRepo(f=>{
 const out=join(f.repo,'desktop','release');mkdirSync(out);for(const name of ['xiaok-1.6.3-arm64.dmg','xiaok-1.6.3-arm64-mac.zip','latest-mac.yml','xiaok-setup-1.6.3.exe','latest.yml'])writeFileSync(join(out,name),'fixture');
 requireSuccess(f.invoke('upload-'+platform));const calls=f.calls();const upload=calls.find(a=>a[0]==='release'&&a[1]==='upload');assert.ok(upload);assert.ok(upload.includes('--clobber'));
 assert.ok(calls.findIndex(a=>a[0]==='api')<calls.indexOf(upload));f.update({draft:false});const before=f.calls().filter(a=>a[1]==='upload').length;requireFailure(f.invoke('upload-'+platform));assert.equal(f.calls().filter(a=>a[1]==='upload').length,before);
}));
test('moved tag blocks upload before any gh mutation',posixOnly,()=>withRepo(f=>{
 writeFileSync(join(f.repo,'next'),'x');f.git('add','.');f.git('commit','-m','new');const next=f.git('rev-parse','HEAD');f.git('push','origin','master');f.git('checkout','--detach',f.sha);f.git('--git-dir',f.origin,'update-ref','refs/tags/'+f.tag,next);
 requireFailure(f.invoke('upload-mac'));assert.equal(f.calls().some(a=>a[1]==='upload'),false);
}));

test('actual native gh --include loopback observations parse status, body and stderr without real credentials',async()=>{
 const {parseReleaseResponse}=await import('../../scripts/desktop-release-identity.mjs');
 const rows=JSON.parse(readFileSync(new URL('./fixtures/gh-api-local-observation.json',import.meta.url),'utf8'));
 assert.deepEqual(parseReleaseResponse(rows[0]),{tag_name:'desktop-v1.6.3',draft:true,prerelease:false});
 assert.equal(parseReleaseResponse(rows[1]),null);
 assert.equal(parseReleaseResponse({status:1,stdout:'',stderr:rows[1].stdout}),null);
 assert.throws(()=>parseReleaseResponse({status:1,stdout:'',stderr:'network failed'}),/status_unconfirmed/);
});
test('wrong-version stale assets refuse upload before any mutation',posixOnly,()=>withRepo(f=>{
 const out=join(f.repo,'desktop','release');mkdirSync(out);for(const name of ['xiaok-1.6.2-arm64.dmg','xiaok-1.6.3-arm64-mac.zip','latest-mac.yml'])writeFileSync(join(out,name),'fixture');
 requireFailure(f.invoke('upload-mac'));assert.equal(f.calls().some(a=>a[1]==='upload'),false);
}));

test('draft verifier invokes the unmodified original asset CLI and stays draft-only',posixOnly,()=>withRepo(f=>{
 const result=f.invoke('verify-draft');requireSuccess(result);assert.match(result.stdout,/verified prepublish/);
 assert.equal(f.calls().filter(a=>a[0]==='release'&&a[1]==='download').length,2);
 assert.ok(f.calls().filter(a=>a[0]==='api').length>=2);assert.equal(f.calls().some(a=>a[1]==='edit'),false);
}));
test('original asset metadata validation failure remains visible and cannot promote',posixOnly,()=>withRepo(f=>{
 f.update({metadataVersion:'1.6.2'});const result=f.invoke('verify-draft');requireFailure(result);assert.match(result.stderr,/version mismatch/);assert.equal(f.calls().some(a=>a[1]==='edit'),false);
}));
test('a release published out of band during original verification fails the final draft guard',posixOnly,()=>withRepo(f=>{
 f.update({publishDuringDownload:true});requireFailure(f.invoke('verify-draft'));assert.equal(f.calls().some(a=>a[1]==='edit'),false);
}));

for(const event of ['published','moved-tag'])test('post-upload check immediately rejects '+event+' interleaving after upload may already exist',posixOnly,()=>withRepo(f=>{
 if(event==='published')f.update({publishDuringUpload:true});
 else {writeFileSync(join(f.repo,'next'),'x');f.git('add','.');f.git('commit','-m','later remote commit');const next=f.git('rev-parse','HEAD');f.git('push','origin','master');f.git('checkout','--detach',f.sha);f.update({moveTagDuringUpload:{origin:f.origin,sha:next}});}
 const out=join(f.repo,'desktop','release');mkdirSync(out);for(const name of ['xiaok-1.6.3-arm64.dmg','xiaok-1.6.3-arm64-mac.zip','latest-mac.yml'])writeFileSync(join(out,name),'fixture');
 const result=f.invoke('upload-mac');requireFailure(result);
 assert.match(result.stderr,/upload may already have completed/);
 assert.equal(f.calls().filter(a=>a[0]==='release'&&a[1]==='upload').length,1);
 assert.equal(f.calls().some(a=>a[1]==='edit'||a[1]==='delete'),false);
 if(event==='moved-tag'){assert.match(result.stderr,/remote_tag_changed/);const state=JSON.parse(readFileSync(f.env.RELEASE_FAKE_GH_STATE,'utf8'));assert.equal(state.moveChild.status,0);assert.equal(state.moveChild.signal,null);}
 else assert.match(result.stderr,/draft_required/);
}));

test('multiple HTTP status blocks never turn an unknown 404-first response into absence',async()=>{
 const {parseReleaseResponse}=await import('../../scripts/desktop-release-identity.mjs');
 const redirect=JSON.parse(readFileSync(new URL('./fixtures/gh-api-local-redirect-observation.json',import.meta.url),'utf8'));
 assert.deepEqual(parseReleaseResponse(redirect),{tag_name:'desktop-v1.6.3',draft:true,prerelease:false});
 const rows=JSON.parse(readFileSync(new URL('./fixtures/gh-api-local-observation.json',import.meta.url),'utf8'));
 assert.throws(()=>parseReleaseResponse({status:1,stdout:rows[1].stdout+'\n'+rows[0].stdout,stderr:''}),/ambiguous/);
 assert.throws(()=>parseReleaseResponse({status:0,stdout:rows[0].stdout+'\n'+rows[0].stdout,stderr:''}),/ambiguous/);
});

test('list fallback handles paginated GitHub releases, detects duplicate drafts, and rejects non-200 /releases errors',posixOnly,()=>withRepo(f=>{
 f.update({listPages:[[{tag_name:'desktop-v1.6.2',draft:false,prerelease:false}],[{tag_name:f.tag,draft:true,prerelease:false}]]});
 requireSuccess(f.invoke('draft'));
 assert.equal(f.calls().some(a=>a[0]==='release'&&a[1]==='create'),false);
 assert.equal(f.calls().filter(a=>a[0]==='api'&&a.at(-1).includes('/releases?')).length,2);

 f.update({listPages:[[{tag_name:f.tag,draft:true,prerelease:false},{tag_name:f.tag,draft:true,prerelease:false}]]});
 const dup=f.invoke('draft');requireFailure(dup);assert.match(dup.stderr,/release_api_ambiguous/);

 f.update({listPages:null,listHttpStatus:404});
 const err404=f.invoke('draft');requireFailure(err404);assert.match(err404.stderr,/release_api_failed/);
}));
