import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync, copyFileSync, rmSync, readFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
export const project = fileURLToPath(new URL('../../../', import.meta.url));
export const helper = join(project, 'scripts', 'desktop-release-identity.mjs');
export function fixture({ annotated = false, tag = 'desktop-v1.6.3' } = {}) {
 const root = realpathSync(mkdtempSync(join(tmpdir(), 'xiaok-release-gate-')));
 const repo = join(root, 'checkout'), origin = join(root, 'origin.git'), bin = join(root, 'bin');
 mkdirSync(repo); mkdirSync(bin, {mode:0o700});
 const env = {...process.env, GIT_CONFIG_NOSYSTEM:'1', GIT_CONFIG_GLOBAL:join(root,'no-global-config'), GIT_TERMINAL_PROMPT:'0',
  XIAOK_CONFIG_DIR:join(root,'config'), RELEASE_TAG:tag, RELEASE_FAKE_GH_STATE:join(root,'gh-state.json'), RELEASE_FAKE_GH_LOG:join(root,'gh-argv.jsonl')};
 mkdirSync(env.XIAOK_CONFIG_DIR,{mode:0o700});
 const commands = [];
 const run = (file,args,options={}) => {
  const result = spawnSync(file,args,{cwd:repo,env,encoding:'utf8',...options});
  commands.push({file,args,pid:result.pid,status:result.status,signal:result.signal});
  return result;
 };
 const git = (...args) => {const r=run('git',args);if(r.status!==0)throw Error('fixture git '+args[0]+' failed: '+r.stderr);return r.stdout.trim();};
 git('init','--bare','--initial-branch=master',origin); git('init','--initial-branch=master');
 git('config','user.name','Release Gate Fixture');git('config','user.email','release-fixture@example.invalid');git('config','commit.gpgsign','false');git('config','tag.gpgsign','false');
 mkdirSync(join(repo,'desktop'));writeFileSync(join(repo,'package.json'),JSON.stringify({version:'1.6.3'}));writeFileSync(join(repo,'desktop','package.json'),JSON.stringify({version:'1.6.3'}));
 // Copy the actual production CLI, never a reimplementation. Missing before TDD stays missing.
 if(existsSync(helper)){mkdirSync(join(repo,'scripts'));copyFileSync(helper,join(repo,'scripts','desktop-release-identity.mjs'));}
 git('add','.');git('commit','-m','fixture initial');git('remote','add','origin',origin);git('push','origin','master');
 if(annotated)git('tag','-a',tag,'-m','annotated fixture');else git('tag',tag);
 git('push','origin','refs/tags/'+tag);
 const sha=git('rev-parse','HEAD');env.RELEASE_SHA=sha;
 const state={exists:true,draft:true,tag};writeFileSync(env.RELEASE_FAKE_GH_STATE,JSON.stringify(state));
 if(process.platform!=='win32'){
  const fake=join(bin,'gh');writeFileSync(fake,`#!${process.execPath}\n`+String.raw`
const fs=require('node:fs');const a=process.argv.slice(2),p=process.env.RELEASE_FAKE_GH_STATE;
fs.appendFileSync(process.env.RELEASE_FAKE_GH_LOG,JSON.stringify(a)+'\n');const s=JSON.parse(fs.readFileSync(p,'utf8'));
if(a[0]==='api'){
 if(a.includes('graphql')){
  const status=s.graphqlHttpStatus??s.httpStatus??200;
  process.stdout.write('HTTP/2.0 '+status+' Fixture\r\nContent-Type: application/json\r\n\r\n');
  let payload;
  if(status!==200)payload={message:'fixture failure'};
  else if(s.graphqlPayload!==undefined)payload=s.graphqlPayload;
  else if(s.postCreateLag&&s.created&&s.postCreateLag>0){
   s.postCreateLag-=1;fs.writeFileSync(p,JSON.stringify(s));
   payload={data:{repository:{release:null}}};
  }else{
   const reqTag=(a.find(x=>x.startsWith('tag='))||'').slice(4);
   const match=s.exists&&(!reqTag||s.tag===reqTag);
   payload={data:{repository:{release:match?{tagName:s.tag,isDraft:s.draft,isPrerelease:false}:null}}};
  }
  process.stdout.write(s.malformed?'not json':JSON.stringify(payload));process.exit(status===200?0:1);
 }
 const target=a[a.length-1];
 const reqTag=decodeURIComponent(target.split('/releases/tags/')[1]??'');
 const directVisible=s.exists&&(!s.draft||s.tag!==reqTag);
 const status=s.httpStatus??(s.malformed||Object.hasOwn(s,'body')?200:(directVisible?200:404));
 process.stdout.write('HTTP/2.0 '+status+' Fixture\r\nContent-Type: application/json\r\n\r\n');
 process.stdout.write(s.malformed?'not json':JSON.stringify(status===200?(Object.hasOwn(s,'body')?s.body:{tag_name:s.tag,draft:s.draft,prerelease:false}):{message:'fixture failure'}));process.exit(status===200?0:1);
}
if(a[0]==='release'&&a[1]==='view'){
 if(!s.exists)process.exit(1);const version=s.tag.slice('desktop-v'.length);
 process.stdout.write(JSON.stringify({tagName:s.tag,isDraft:s.draft,isPrerelease:false,url:'https://example.invalid/draft',assets:['latest-mac.yml','latest.yml','xiaok-'+version+'-arm64-mac.zip','xiaok-'+version+'-arm64.dmg','xiaok-setup-'+version+'.exe'].map(name=>({name}))}));process.exit(0);
}
if(a[0]==='release'&&a[1]==='download'){
 const name=a[a.indexOf('--pattern')+1],dest=a[a.indexOf('--dir')+1],version=s.metadataVersion??s.tag.slice('desktop-v'.length);
 const url=name==='latest-mac.yml'?'xiaok-'+s.tag.slice('desktop-v'.length)+'-arm64-mac.zip':'xiaok-setup-'+s.tag.slice('desktop-v'.length)+'.exe';
 fs.writeFileSync(require('node:path').join(dest,name),'version: '+version+'\nfiles:\n  - url: '+url+'\n');
 if(s.publishDuringDownload){s.draft=false;fs.writeFileSync(p,JSON.stringify(s));}process.exit(0);
}
if(a[0]==='release'&&a[1]==='create'){s.exists=true;s.created=true;s.draft=a.includes('--draft');s.tag=a[2];fs.writeFileSync(p,JSON.stringify(s));process.exit(0);}
if(a[0]==='release'&&a[1]==='upload'){
 if(s.publishDuringUpload)s.draft=false;
 if(s.moveTagDuringUpload){const m=s.moveTagDuringUpload;const r=require('node:child_process').spawnSync('git',['--git-dir',m.origin,'update-ref','refs/tags/'+s.tag,m.sha],{encoding:'utf8'});s.moveChild={pid:r.pid,status:r.status,signal:r.signal};if(r.status!==0){process.stderr.write(r.stderr);process.exit(79);}}
 fs.writeFileSync(p,JSON.stringify(s));process.exit(0);
}
process.stderr.write('Unexpected fake gh command');process.exit(78);
`);chmodSync(fake,0o700);env.PATH=bin+(process.platform==='win32'?';':':')+process.env.PATH;
 }
 const update = patch => {const s=JSON.parse(readFileSync(env.RELEASE_FAKE_GH_STATE,'utf8'));Object.assign(s,patch);writeFileSync(env.RELEASE_FAKE_GH_STATE,JSON.stringify(s));};
 const calls = () => existsSync(env.RELEASE_FAKE_GH_LOG)?readFileSync(env.RELEASE_FAKE_GH_LOG,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
 const invoke = (action,patch={}) => run(process.execPath,[helper,action],{env:{...env,...patch}});
 const close=()=>{console.info('[release-fixture-processes]',JSON.stringify({commands,reapedSynchronously:true}));rmSync(root,{recursive:true,force:true,maxRetries:4});};
 return {root,repo,origin,env,git,run,invoke,sha,tag,update,calls,close};
}
